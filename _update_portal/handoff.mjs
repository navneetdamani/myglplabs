import http from 'node:http';
export function handoffServer(port){
  // Render must see the replacement listener before it drains the previous instance.
  // No sessions, submissions or worker routes are available until the DB lock transfers.
  return http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Retry-After','5');
    const health=req.method==='GET'&&req.url==='/healthz';res.writeHead(health?200:503);
    res.end(JSON.stringify(health?{ok:true,mode:'handoff'}:{error:'Portal restarting; please retry shortly'}));
  }).listen(port,'0.0.0.0');
}
export async function acquireStore(open,onStandby,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=120){
  let announced=false;
  for(let attempt=0;;attempt++){
    try{return await open();}catch(error){
      if(error.code!=='PORTAL_ACTIVE'||attempt>=attempts)throw error;
      if(!announced){await onStandby();announced=true;}
      await delay(1000);
    }
  }
}

