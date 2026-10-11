const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const baseDate = new Date(today + 'T12:00:00'), monthDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
const maxDate = new Date(Date.parse(today + 'T12:00:00Z') + 730 * 86400000).toISOString().slice(0,10);
let unavailable = new Set(), loaded = false, selected = '';
const calendar = document.querySelector('#calendar'), message = document.querySelector('#booking-message');
function render() {
  document.querySelector('#month').textContent = monthDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  calendar.replaceChildren();
  for (let i=0; i<monthDate.getDay(); i++) calendar.append(document.createElement('span'));
  const days = new Date(monthDate.getFullYear(),monthDate.getMonth()+1,0).getDate();
  for(let day=1;day<=days;day++) {
    const date = new Date(monthDate.getFullYear(),monthDate.getMonth(),day), key = dateKey(date);
    const button = document.createElement('button'); button.type='button'; button.className='day' + (key===selected?' selected':'');
    button.textContent=day; button.disabled=!loaded || key<today || key>maxDate || unavailable.has(key);
    button.setAttribute('aria-label', date.toLocaleDateString('he-IL') + (unavailable.has(key)?' — התאריך תפוס':''));
    button.setAttribute('aria-pressed', String(key===selected));
    button.addEventListener('click',()=>{ selected=key; document.querySelector('#chosen-date').value=key; document.querySelector('#selected-label').textContent=date.toLocaleDateString('he-IL'); render(); });
    calendar.append(button);
  }
  document.querySelector('#previous').disabled=dateKey(monthDate).slice(0,7)<=today.slice(0,7);
  document.querySelector('#next').disabled=dateKey(monthDate).slice(0,7)>=maxDate.slice(0,7);
}
async function availability(){
  try { const response=await fetch('/api/availability'); if(!response.ok)throw Error(); unavailable=new Set((await response.json()).unavailable);loaded=true;render(); }
  catch { loaded=false;render();message.textContent='לא ניתן לטעון תאריכים. רעננו את הדף ונסו שוב';message.className='message error'; }
}
document.querySelector('#previous').onclick=()=>{monthDate.setMonth(monthDate.getMonth()-1);render();};
document.querySelector('#next').onclick=()=>{monthDate.setMonth(monthDate.getMonth()+1);render();};
document.querySelector('#booking-form').addEventListener('submit',async event=>{
  event.preventDefault();message.className='message';message.textContent='';
  if(!selected){message.textContent='בחרו תחילה תאריך פנוי בלוח השנה';message.className='message error';return;}
  const button=document.querySelector('#submit-booking');button.disabled=true;
  try {
    const response=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    message.textContent='הבקשה התקבלה! התאריך נשמר וממתין לאישור. ניצור עמכם קשר לתיאום. מזל טוב!';message.className='message success';
    event.target.reset();selected='';document.querySelector('#selected-label').textContent='';await availability();
  }catch(error){message.textContent=error.message||'לא ניתן לשלוח את הבקשה';message.className='message error';await availability();}
  finally{button.disabled=false;}
});
render();availability();
