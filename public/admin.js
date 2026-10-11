const $=selector=>document.querySelector(selector);
const statuses={pending:'ממתינה לאישור',approved:'מאושרת',returned:'הוחזרה',rejected:'נדחתה',cancelled:'בוטלה'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
const dateLabel=date=>new Date(date+'T12:00:00').toLocaleDateString('he-IL');
let bookings=[],settings={};
async function api(path,method='GET',body){
  const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok){if(response.status===401){$('#dashboard').hidden=true;$('#login').hidden=false;}throw Error(data.error);}
  return data;
}
function notify(text,error=false){$('#admin-message').textContent=text;$('#admin-message').className='message '+(error?'error':'success');}
function element(tag,text,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
async function load(){
  const data=await api('/api/admin/bookings');bookings=data.bookings;settings=data.settings;
  $('#login').hidden=true;$('#dashboard').hidden=false;$('#donation-url').value=settings.donation_url||'';render();
}
async function update(id,body){try{await api('/api/admin/bookings/'+id,'PATCH',body);await load();notify('הבקשה עודכנה');}catch(e){notify(e.message,true);}}
function action(text,callback,primary=false){const button=element('button',text,primary?'button':'secondary');button.type='button';button.onclick=async()=>{button.disabled=true;try{await callback();}finally{button.disabled=false;}};return button;}
function whatsappLink(row,message,text){
  let phone=row.phone.replace(/\D/g,'');if(phone.startsWith('0'))phone='972'+phone.slice(1);
  const a=element('a',text);a.href='https://wa.me/'+phone+'?text='+encodeURIComponent(message);a.target='_blank';a.rel='noopener';return a;
}
function messageControls(row,type,text,message){
  const wrap=element('div',null,'message-actions');wrap.append(whatsappLink(row,message,text));
  if(row[type+'_at'])wrap.append(element('span','סומן שנשלח: '+new Date(row[type+'_at']).toLocaleDateString('he-IL'),'muted'));
  wrap.append(action('סימון שנשלח',async()=>{try{await api('/api/admin/bookings/'+row.id+'/messages','POST',{type});await load();notify('השליחה תועדה');}catch(e){notify(e.message,true);}}));return wrap;
}
function render(){
  const stats=$('#stats');stats.replaceChildren();
  for(const [label,count] of [['ממתינות לאישור',bookings.filter(r=>r.status==='pending').length],['מאושרות',bookings.filter(r=>r.status==='approved').length],['להחזרה היום / באיחור',bookings.filter(r=>r.status==='approved'&&r.return_date<=today()).length],['הוחזרו',bookings.filter(r=>r.status==='returned').length]]){const el=element('div',label,'stat');el.prepend(element('strong',String(count)));stats.append(el);}
  const filter=$('#filter').value,term=$('#search').value.trim().toLowerCase();
  const rows=bookings.filter(r=>(filter==='all'||filter===r.status||(filter==='due'&&r.status==='approved'&&r.return_date<=today()))&&`${r.name} ${r.location} ${r.phone}`.toLowerCase().includes(term));
  const list=$('#requests');list.replaceChildren();
  if(!rows.length){list.append(element('div',bookings.length?'אין בקשות התואמות לחיפוש':'עדיין אין בקשות. בקשות חדשות יופיעו כאן.','empty'));return;}
  for(const row of rows){
    const card=element('article',null,'request'),details=element('div'),controls=element('div',null,'request-controls');
    details.append(element('span',statuses[row.status],'badge '+row.status),element('h3',row.name),element('p','חתונה: '+dateLabel(row.date)),element('p','מיקום: '+row.location));
    const phone=element('a',row.phone);phone.href='tel:'+row.phone;phone.dir='ltr';details.append(phone);
    details.append(element('p','בקשה התקבלה: '+new Date(row.created_at).toLocaleDateString('he-IL'),'muted'));
    if(row.status==='approved'&&row.return_date<=today())details.append(element('p',row.return_date<today()?'החופה באיחור להחזרה':'החופה מיועדת להחזרה היום','overdue'));
    const label=element('label','תאריך החזרה'),input=element('input');input.type='date';input.value=row.return_date;input.min=row.date;input.setAttribute('aria-label','תאריך החזרה עבור '+row.name);label.append(input);controls.append(label);
    const actions=element('div',null,'request-actions');
    if(['pending','approved'].includes(row.status))actions.append(action('שמירת תאריך החזרה',()=>update(row.id,{return_date:input.value})));
    else input.disabled=true;
    if(row.status==='pending'){
      actions.append(action('אישור הבקשה',()=>update(row.id,{status:'approved',return_date:input.value}),true));
      actions.append(action('דחייה',()=>{if(confirm('לדחות את הבקשה ולשחרר את התאריך?'))return update(row.id,{status:'rejected'});}));
    }
    if(row.status==='approved')actions.append(action('החופה הוחזרה',()=>update(row.id,{status:'returned'}),true));
    if(['pending','approved'].includes(row.status))actions.append(action('ביטול',()=>{if(confirm('לבטל את הבקשה ולשחרר את התאריך?'))return update(row.id,{status:'cancelled'});}));
    controls.append(actions);
    if(row.status==='approved'){
      controls.append(whatsappLink(row,`שלום ${row.name}, בקשתכם להשאלת החופה לזכר ירון צ׳יטיז הי״ד בתאריך ${dateLabel(row.date)} אושרה. נשמח לתאם איסוף. תאריך ההחזרה: ${dateLabel(row.return_date)}. מזל טוב!`,'שליחת הודעת אישור ב־WhatsApp ↗'));
      controls.append(messageControls(row,'reminder','תזכורת החזרה ב־WhatsApp ↗',`שלום ${row.name}, מזל טוב! תזכורת להחזיר את החופה לזכר ירון צ׳יטיז הי״ד עד ${dateLabel(row.return_date)}. נשמח לתאם את ההחזרה כדי שהחופה תמשיך לשמח זוגות נוספים. תודה רבה!`));
    }
    if(['approved','returned'].includes(row.status)){
      if(settings.donation_url)controls.append(messageControls(row,'donation','שליחת קישור לתרומה ב־WhatsApp ↗',`שלום ${row.name}, תודה שבחרתם להינשא תחת החופה לזכר ירון צ׳יטיז הי״ד. אם תרצו לתמוך בהמשך המיזם, ניתן לתרום כאן: ${settings.donation_url}\nהתרומה לבחירתכם בלבד. תודה ומזל טוב!`));
      else controls.append(element('p','הוסיפו קישור תרומה בהגדרות כדי לשלוח אותו לזוג.','muted'));
    }
    card.append(details,controls);list.append(card);
  }
}
$('#login-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/api/login','POST',Object.fromEntries(new FormData(event.target)));event.target.reset();$('#login-message').textContent='';await load();}catch(e){$('#login-message').textContent=e.message;}finally{button.disabled=false;}};
$('#logout').onclick=async()=>{try{await api('/api/admin/logout','POST',{});bookings=[];settings={};$('#requests').replaceChildren();$('#dashboard').hidden=true;$('#login').hidden=false;}catch(e){notify(e.message,true);}};
$('#filter').onchange=render;$('#search').oninput=render;
$('#refresh').onclick=()=>load().catch(e=>notify(e.message,true));
$('#settings-form').onsubmit=async event=>{event.preventDefault();try{settings=await api('/api/admin/settings','PATCH',Object.fromEntries(new FormData(event.target)));render();notify('קישור התרומה נשמר');}catch(e){notify(e.message,true);}};
load().catch(()=>{});
