import test from 'node:test';import assert from 'node:assert/strict';
import{acquireStore,handoffServer}from'../handoff.mjs';
test('rolling handoff waits for exclusive DB ownership before returning a store',async()=>{
 let opens=0,standby=0,waits=0;const store={exclusive:true};
 const result=await acquireStore(async()=>{if(++opens<3)throw Object.assign(Error('busy'),{code:'PORTAL_ACTIVE'});return store;},()=>{standby++;},async()=>{waits++;});
 assert.equal(result,store);assert.equal(standby,1);assert.equal(waits,2);
});
test('handoff does not retry authentication, audit or other database failures',async()=>{
 let announced=false;await assert.rejects(acquireStore(async()=>{throw Error('database failure');},()=>{announced=true;}),/database failure/);assert.equal(announced,false);
});
test('handoff has a bounded deadline and cannot bypass a held lock',async()=>{
 let opens=0;await assert.rejects(acquireStore(async()=>{opens++;throw Object.assign(Error('busy'),{code:'PORTAL_ACTIVE'});},()=>{},async()=>{},2),/busy/);assert.equal(opens,3);
});
test('standby accepts health probes but rejects every browser and worker request',async()=>{
 const server=handoffServer(0);await new Promise(resolve=>server.on('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const [path,method]of [['/','GET'],['/auth/login','GET'],['/api/worker/claim','POST'],['/api/requests','POST'],['/healthz','POST']]){const r=await fetch(origin+path,{method});assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');}const r=await fetch(origin+'/healthz');assert.deepEqual(await r.json(),{ok:true,mode:'handoff'});}finally{await new Promise(resolve=>server.close(resolve));}
});

