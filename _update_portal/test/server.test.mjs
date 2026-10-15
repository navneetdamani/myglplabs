import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store, digest } from '../store.mjs';
import { createServer,config,setupServer } from '../server.mjs';
const c={origin:'https://portal.example',emails:['editor@example.com'],adminId:'owner',clientId:'client',clientSecret:'secret'};
async function withServer(fn,transport,overrides={}) {
  const s=new Store(':memory:'),g={main:async()=>'main',json:async path=>path==='/user'?{id:2,login:'editor'}:[{email:'editor@example.com',verified:true}]};
  const w={paused:()=>false,pause:()=>{}},server=createServer({...c,...overrides},s,g,w,transport);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const raw=await s.session('2','editor','editor@example.com'),csrf=s.db.prepare('SELECT csrf FROM sessions').get().csrf;
  try{await fn({s,g,base,raw,csrf});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await s.close();}
}
test('anonymous access denied; UI has security headers',()=>withServer(async({base})=>{
  assert.equal((await fetch(`${base}/api/requests`)).status,401);
  const ui=await fetch(base);assert.equal(ui.status,200);assert.match(ui.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(ui.headers.get('Cache-Control'),'no-store');
}));
test('origin and CSRF enforced; submissions idempotent; editor cannot administer',()=>withServer(async({base,raw,csrf,s})=>{
  const h={'Cookie':`__Host-session=${raw}`,'Content-Type':'application/json','Idempotency-Key':'unique-key-00000001'},payload=JSON.stringify({prompt:'Please improve the headline'});
  assert.equal((await fetch(`${base}/api/requests`,{method:'POST',headers:h,body:payload})).status,403);
  const headers={...h,Origin:c.origin,'X-CSRF-Token':csrf};
  const first=await fetch(`${base}/api/requests`,{method:'POST',headers,body:payload});assert.equal(first.status,202);
  const second=await fetch(`${base}/api/requests`,{method:'POST',headers,body:payload});assert.deepEqual(await first.json(),await second.json());
  assert.equal((await s.list('2',false)).length,1);
  assert.equal((await fetch(`${base}/api/pause`,{method:'POST',headers,body:'{"paused":true}'})).status,403);
  assert.equal((await fetch(`${base}/api/audit`,{headers:h})).status,403);
}));
test('removed email invalidates session; other users cannot see requests',()=>withServer(async({base,raw,s})=>{
  await s.submit('other','Another private request','private-key-000001');
  const response=await fetch(`${base}/api/requests`,{headers:{Cookie:`__Host-session=${raw}`}});assert.deepEqual(await response.json(),[]);
  s.db.prepare('UPDATE sessions SET email=?').run('revoked@example.com');
  assert.equal((await fetch(`${base}/api/me`,{headers:{Cookie:`__Host-session=${raw}`}})).status,401);
}));
test('OAuth state, verified email, one-use callback and secure session cookie',()=>withServer(async({base,g})=>{
  const login=await fetch(`${base}/auth/login`,{redirect:'manual'}),auth=new URL(login.headers.get('location'));
  assert.equal(auth.searchParams.get('scope'),'user:email');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  const state=auth.searchParams.get('state'),url=`${base}/auth/callback?state=${state}&code=test-code`,headers={Cookie:`__Host-oauth=${state}`};
  assert.equal((await fetch(url,{redirect:'manual'})).status,403);
  const callback=await fetch(url,{headers,redirect:'manual'});assert.equal(callback.status,302);
  assert.match(callback.headers.get('set-cookie'),/__Host-session=.*Secure; HttpOnly; SameSite=Lax/);
  assert.equal((await fetch(url,{headers,redirect:'manual'})).status,403);
},async()=>({ok:true,json:async()=>({access_token:'test-access-token'})})));
test('unverified allowed email is rejected',()=>withServer(async({base,g})=>{
  g.json=async path=>path==='/user'?{id:2,login:'editor'}:[{email:'editor@example.com',verified:false}];
  const login=await fetch(`${base}/auth/login`,{redirect:'manual'}),state=new URL(login.headers.get('location')).searchParams.get('state');
  assert.equal((await fetch(`${base}/auth/callback?state=${state}&code=test`,{headers:{Cookie:`__Host-oauth=${state}`},redirect:'manual'})).status,403);
},async()=>({ok:true,json:async()=>({access_token:'test-access-token'})})));
test('startup fails closed without configuration',()=>assert.throws(()=>config({}),/Missing configuration/));
test('setup mode exposes no login or mutating routes',async()=>{
  const server=setupServer(0);await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.match(await(await fetch(base)).text(),/Administrator setup in progress/);
    assert.deepEqual(await(await fetch(`${base}/healthz`)).json(),{ok:true,mode:'setup'});
    for(const path of ['/auth/login','/api/requests','/api/audit'])assert.equal((await fetch(`${base}${path}`)).status,503);
    assert.equal((await fetch(`${base}/api/requests`,{method:'POST',body:'{}'})).status,503);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('administrator exports complete records without tokens; editors cannot export',()=>withServer(async({base,raw,s})=>{
  const id=await s.submit('2','Keep this private request','private-export-key');
  assert.equal((await fetch(`${base}/api/export`,{headers:{Cookie:`__Host-session=${raw}`}})).status,403);
  const admin=await s.session('owner','owner','');
  await s.run('INSERT INTO oauth VALUES(?,?,?)','private-hash','private-verifier',Date.now()+60000);
  const response=await fetch(`${base}/api/export`,{headers:{Cookie:`__Host-session=${admin}`}});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.requests[0].id,id);assert.ok(result.audit.some(r=>r.event==='records-exported'));
  assert.equal(result.sessions,undefined);assert.equal(result.oauth,undefined);
  assert.ok(!JSON.stringify(result).includes('private-verifier'));assert.ok(!JSON.stringify(result).includes(admin));
}));
test('expired pilot rejects new requests',()=>withServer(async({base,raw,csrf,s})=>{
  const response=await fetch(`${base}/api/requests`,{method:'POST',headers:{Cookie:`__Host-session=${raw}`,Origin:c.origin,'X-CSRF-Token':csrf,'Content-Type':'application/json','Idempotency-Key':'expired-pilot-key'},body:JSON.stringify({prompt:'Do not publish this change'})});
  assert.equal(response.status,403);assert.equal((await s.list('2',false)).length,0);
},undefined,{pilotEndsAt:Date.now()-1000}));
