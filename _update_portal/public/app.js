const $=id=>document.getElementById(id);
let me,key=crypto.randomUUID(),busy=false;
async function api(path,method='GET',data,headers={}) {
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf || '',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  return result;
}
function message(text){$('message').textContent=text;}
function node(tag,text,className){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function safeLink(url,label){const u=new URL(url);if(u.origin!=='https://github.com')throw Error('Unexpected link');const a=node('a',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}
async function refresh(){
  const rows=await api('/api/requests');$('history').replaceChildren();
  if(!rows.length)$('history').append(node('p','Your first update starts here.'));
  for(const r of rows){
    const record=node('article','','record'),title=node('strong',r.prompt.slice(0,120));
    title.append(node('small',`${r.id.slice(0,8)} · ${new Date(r.created).toLocaleString()}`));record.append(title,node('span',r.status==='awaiting-local'?'working on your computer':r.status.replaceAll('-',' '),'badge'));
    if(r.data.url)record.append(safeLink(r.data.url,'View change ↗'));
    if(r.data.deployment)record.append(safeLink(r.data.deployment,'Deployment ↗'));
    if(r.data.reason)record.append(node('p',r.data.reason,'reason'));
    if(me.admin && ['deployed','deployment-failed'].includes(r.status) && !r.data.rollbackOf){
      const b=node('button','Roll back');b.onclick=async()=>{
        if(!confirm('Create a checked rollback of this update? Publishing will pause.'))return;
        b.disabled=true;try{await api(`/api/requests/${r.id}/rollback`,'POST',{});message('Rollback queued. Publishing is paused.');await refresh();}catch(e){message(e.message);}finally{b.disabled=false;}
      };record.append(b);
    }
    $('history').append(record);
  }
}
async function start(){
  try{me=await api('/api/me');$('workspace').hidden=false;$('logout').hidden=false;$('admin').hidden=!me.admin;
    $('publishing').textContent=!me.autoPublish?'Publishing is awaiting administrator activation.':me.paused?'Publishing is paused.':'Automatic publishing is active. All checks must pass.';
    if(me.aiMode==='local-chatgpt')$('publishing').textContent+=me.workerOnline?' Your computer is connected. Using the owner’s ChatGPT plan.':' Waiting for the owner’s computer. Requests remain queued; paid API fallback is disabled.';
    if(me.pilotEndsAt)$('publishing').textContent+=` Free pilot processing ends ${new Date(me.pilotEndsAt).toLocaleString()}. Export records before database expiry.`;
    await refresh();
  }catch(e){$('login').hidden=false;}
}
$('request').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('submit').disabled=true;message('Submitting…');
  try{await api('/api/requests','POST',{prompt:$('prompt').value},{'Idempotency-Key':key});key=crypto.randomUUID();$('prompt').value='';message('Your update is queued. You can track its progress below.');await refresh();}catch(e){message(e.message);}finally{busy=false;$('submit').disabled=false;}
};
$('logout').onclick=async()=>{try{await api('/auth/logout','POST',{});location.reload();}catch(e){message(e.message);}};
$('refresh').onclick=()=>refresh().catch(e=>message(e.message));
for(const [id,paused]of [['pause',true],['resume',false]])$(id).onclick=async()=>{try{await api('/api/pause','POST',{paused});$('publishing').textContent=paused?'Publishing is paused.':'Publishing is resumed, subject to deployment configuration.';message('Publishing preference saved.');}catch(e){message(e.message);}};
$('audit').onclick=async()=>{try{const rows=await api('/api/audit');const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download='portal-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message(e.message);}};
$('export').onclick=async()=>{try{const snapshot=await api('/api/export');const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download='portal-private-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message(e.message);}};
start();setInterval(()=>{if(me&&!document.hidden)refresh().catch(e=>message(e.message));},15000);
