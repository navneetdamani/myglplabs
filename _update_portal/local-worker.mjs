import{spawnSync}from'node:child_process';import{readFile}from'node:fs/promises';import{fileURLToPath}from'node:url';
import{generate}from'./local-generator.mjs';
export async function tick(config,transport=fetch,planner=generate){
 const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.origin!==config.origin)throw Error('Use the exact HTTPS portal origin');
 if(!/^[a-zA-Z0-9_-]{43,128}$/.test(config.token))throw Error('Invalid local worker credential');
 const api=async(path,data)=>{const response=await transport(config.origin+path,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Portal worker request failed ('+response.status+')');return response.json();};
 const{job}=await api('/api/worker/claim',{});if(!job)return{status:'idle'};
 let proposal;
 try{proposal=await planner(job,{executable:config.codex,model:config.model});}
 catch{await api('/api/worker/results/'+job.id,{lease:job.lease,deferred:true});return{status:'waiting-for-chatgpt'};}
 await api('/api/worker/results/'+job.id,{lease:job.lease,proposal});return{status:'submitted'};
}
async function loadConfig(path){
 const c=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
 if(process.platform!=='win32')throw Error('This installation uses Windows protected credentials');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./unlock-worker.ps1',import.meta.url)),'-CredentialPath',c.credentialPath],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('Unable to unlock the local worker credential');
 return{...c,token:result.stdout.trim()};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const path=process.argv[2];if(!path)throw Error('Local worker configuration path required');
 const c=await loadConfig(path);
 let polling=false;const poll=async()=>{if(polling)return;polling=true;try{const state=await tick(c);if(state.status!=='idle')console.log(new Date().toISOString()+' '+state.status);}catch{console.log(new Date().toISOString()+' Waiting for portal or ChatGPT; paid API fallback is disabled.');}finally{polling=false;}};
 await poll();if(!process.argv.includes('--once'))setInterval(poll,60000);
}
