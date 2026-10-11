import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore, today, addDays } from '../store.js';
import { emailContent, createEmailSender, createEmailWorker } from '../email.js';

const booking = () => ({ name: 'זוג בדיקה', date: addDays(today(),10), location: 'ירושלים', phone: '0501234567', email: 'couple@example.com' });
function memory(t) { const store=createStore(':memory:');t.after(()=>store.db.close());return store; }

test('booking requires a single valid email; duplicate requests do not enqueue extra mail',t=>{
  const store=memory(t);
  for(const email of ['', 'name', 'name@example', 'a@b.com,other@example.com', 'a@b.com\nBcc: other@b.com'])assert.throws(()=>store.create({...booking(),email}));
  const {id}=store.create(booking());assert.equal(store.get(id).email,booking().email);
  assert.equal(store.emailStatus().length,1);assert.equal(store.emailStatus()[0].kind,'received');
  assert.throws(()=>store.create(booking()));assert.equal(store.emailStatus().length,1);
});
test('unconfigured email stays queued and does not block reservation',async t=>{
  const store=memory(t);store.create(booking());const worker=createEmailWorker(store,null);
  await worker.flush();assert.equal(worker.configured,false);assert.equal(store.emailStatus()[0].status,'pending');assert.equal(store.emailStatus()[0].attempts,0);
});
test('receipt and approval are delivered once, with latest return date',async t=>{
  const store=memory(t),{id}=store.create(booking()),sent=[];
  const worker=createEmailWorker(store,async(job,row)=>sent.push({kind:job.kind,...row}));
  await worker.flush();await worker.flush();assert.equal(sent.length,1);assert.equal(sent[0].email,booking().email);
  store.update(id,{status:'approved'});store.update(id,{return_date:addDays(booking().date,5)});
  await worker.flush();assert.equal(sent.length,2);assert.equal(sent[1].kind,'approved');assert.equal(sent[1].return_date,addDays(booking().date,5));
  store.update(id,{status:'approved'});await worker.flush();assert.equal(sent.length,2);
  assert.ok(store.emailStatus().every(job=>job.status==='sent'&&job.sent_at));
});
test('SMTP failures preserve booking, retry with a limit, and allow manual retry',async t=>{
  const store=memory(t),{id}=store.create(booking());const worker=createEmailWorker(store,async()=>{throw Object.assign(Error('secret content'),{code:'ECONNECTION'});});
  for(let attempt=0;attempt<5;attempt++){store.db.exec("UPDATE email_jobs SET next_attempt='2000-01-01'");await worker.flush();}
  const [job]=store.emailStatus();assert.equal(job.status,'failed');assert.equal(job.attempts,5);assert.equal(job.last_error,'ECONNECTION');assert.equal(store.get(id).status,'pending');
  store.retryEmail(job.id);const successful=createEmailWorker(store,async()=>{});await successful.flush();assert.equal(store.emailStatus()[0].status,'sent');
  assert.throws(()=>store.retryEmail(job.id));
});
test('cancelling a request suppresses unsent approval mail',async t=>{
  const store=memory(t),{id}=store.create(booking());store.update(id,{status:'approved'});store.update(id,{status:'cancelled'});
  let calls=0;await createEmailWorker(store,async()=>calls++).flush();assert.equal(calls,0);assert.ok(store.emailStatus().every(job=>job.status==='cancelled'));
});
test('email content separates receipt from approval and escapes HTML input',()=>{
  const row={...booking(),return_date:addDays(booking().date,2),name:'<script>alert(1)</script>',location:'<img src=x onerror=alert(1)>'};
  const received=emailContent('received',row),approved=emailContent('approved',row);
  assert.match(received.text,/ממתין לאישור/);assert.match(approved.text,/אושרה/);assert.match(approved.text,/תאריך ההחזרה/);
  assert.ok(!received.html.includes('<script>'));assert.ok(!received.html.includes('<img'));assert.ok(received.html.includes('&lt;script&gt;'));
});
test('sender uses one recipient, TLS and both message formats',async()=>{
  let options,message;
  const sender=createEmailSender({SMTP_HOST:'smtp.example.com',EMAIL_FROM:'memorial@example.com'},config=>{options=config;return{sendMail:async data=>{message=data;return{accepted:['couple@example.com']};}};});
  await sender({id:'test-message',kind:'received'},booking());assert.deepEqual(message.to,{address:'couple@example.com'});assert.equal(options.requireTLS,true);assert.ok(message.text&&message.html);assert.match(message.messageId,/test-message/);
  assert.equal(createEmailSender({}),null);
  assert.throws(()=>createEmailSender({SMTP_HOST:'smtp.example.com',EMAIL_FROM:'bad'}));
});
test('old bookings migrate without losing data; queued emails survive restart',t=>{
  const dir=mkdtempSync(join(tmpdir(),'chupah-mail-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'test.sqlite');
  const old=new DatabaseSync(path);old.exec(`CREATE TABLE bookings (id TEXT PRIMARY KEY,name TEXT NOT NULL,date TEXT NOT NULL,location TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',return_date TEXT NOT NULL,created_at TEXT NOT NULL,reminder_at TEXT,donation_at TEXT)`);
  old.prepare('INSERT INTO bookings (id,name,date,location,phone,return_date,created_at) VALUES (?,?,?,?,?,?,?)').run('old','בקשה קיימת',addDays(today(),20),'ירושלים','0501234567',addDays(today(),22),new Date().toISOString());old.close();
  const first=createStore(path);assert.equal(first.get('old').email,'');assert.equal(first.get('old').name,'בקשה קיימת');first.update('old',{status:'approved'});assert.equal(first.emailStatus().length,0);
  first.create(booking());first.db.close();const second=createStore(path);t.after(()=>second.db.close());assert.equal(second.emailStatus()[0].status,'pending');assert.equal(second.list().length,2);
});
