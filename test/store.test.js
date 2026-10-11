import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, addDays, today } from '../store.js';

const input = (days=10) => ({ name: 'זוג בדיקה', date: addDays(today(), days), location: 'ירושלים', phone: '0501234567', email: 'couple@example.com' });
function memory(t) { const store=createStore(':memory:');t.after(()=>store.db.close());return store; }
test('pending reservations block duplicate dates; rejection releases them',t=>{
  const store=memory(t),request=input();const row=store.create(request);
  assert.deepEqual(store.unavailable(),[request.date]);
  assert.throws(()=>store.create(request),error=>error.status===409);
  store.update(row.id,{status:'rejected'});
  assert.deepEqual(store.unavailable(),[]);assert.equal(store.create(request).status,'pending');
});
test('approval, return date, reminder log, and return tracking',t=>{
  const store=memory(t),request=input(),{id}=store.create(request);
  assert.equal(store.get(id).return_date,addDays(request.date,2));
  assert.equal(store.update(id,{status:'approved',return_date:addDays(request.date,3)}).status,'approved');
  assert.ok(store.recordMessage(id,'reminder').reminder_at);
  assert.ok(store.recordMessage(id,'donation').donation_at);
  assert.equal(store.update(id,{status:'returned'}).status,'returned');
  assert.throws(()=>store.update(id,{status:'approved'}));
});
test('invalid dates, incomplete contact details, and unsafe donation URLs are rejected',t=>{
  const store=memory(t);
  for(const patch of [{date:'2027-02-30'},{date:addDays(today(),-1)},{date:addDays(today(),731)},{name:''},{location:''},{phone:'abc'},{email:''},{email:'not-an-email'},{email:'a@example.com\r\nBcc: other@example.com'}])assert.throws(()=>store.create({...input(),...patch}));
  const {id}=store.create(input());assert.throws(()=>store.update(id,{return_date:addDays(input().date,-1)}));
  for(const url of ['javascript:alert(1)','http://example.com','not a url'])assert.throws(()=>store.saveSettings({donation_url:url}));
  assert.equal(store.saveSettings({donation_url:'https://example.com/donate'}).donation_url,'https://example.com/donate');
});
test('cancellation releases approved dates and invalid transitions cannot restore them',t=>{
  const store=memory(t),{id}=store.create(input());store.update(id,{status:'approved'});store.update(id,{status:'cancelled'});
  assert.deepEqual(store.unavailable(),[]);assert.throws(()=>store.update(id,{status:'approved'}));
});
test('requests and settings survive reopening the database',t=>{
  const dir=mkdtempSync(join(tmpdir(),'chupah-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'test.sqlite');
  const first=createStore(path);const {id}=first.create(input());first.saveSettings({donation_url:'https://example.com/donate'});first.db.close();
  const second=createStore(path);t.after(()=>second.db.close());assert.equal(second.get(id).name,input().name);assert.equal(second.settings().donation_url,'https://example.com/donate');
});
