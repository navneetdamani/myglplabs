import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.mjs';
import { Worker } from '../worker.mjs';
async function fixture() {
  const s=new Store(':memory:'),id=await s.submit('owner','Change a headline','unique-key-0000001');let merges=0;
  const g={main:async()=>'base',files:async()=>({}),proposal:async()=>({base:'base',head:'head',pr:1,baseTree:'old-tree'}),mergeGate:async()=>({ready:true}),merge:async()=>{merges++;return 'merged';},deployment:async()=>({ok:true,url:'https://github.com/run'})};
  const w=new Worker({autoPublish:true},s,g,async()=>[]);
  return {s,id,g,w,merges:()=>merges};
}
test('full queue → branch → checks → merge → deployment',async()=>{
  const f=await fixture();try{await f.w.tick();assert.equal((await f.s.get(f.id)).status,'checking');await f.w.tick();assert.equal(f.merges(),1);assert.equal((await f.s.get(f.id)).status,'deploying');await f.w.tick();assert.equal((await f.s.get(f.id)).status,'deployed');}finally{await f.s.close();}
});
test('pending checks never merge',async()=>{
  const f=await fixture();try{f.g.mergeGate=async()=>null;await f.w.tick();await f.w.tick();assert.equal(f.merges(),0);assert.equal((await f.s.get(f.id)).status,'checking');}finally{await f.s.close();}
});
test('failed checks never merge',async()=>{
  const f=await fixture();try{f.g.mergeGate=async()=>{throw Error('Automated checks failed');};await f.w.tick();await f.w.tick();assert.equal(f.merges(),0);assert.equal((await f.s.get(f.id)).status,'failed');}finally{await f.s.close();}
});
test('configuration and administrator pause block publishing',async()=>{
  const f=await fixture();try{f.w.config.autoPublish=false;await f.w.tick();await f.w.tick();assert.equal(f.merges(),0);f.w.config.autoPublish=true;await f.w.pause();await f.w.tick();assert.equal(f.merges(),0);}finally{await f.s.close();}
});
test('uncertain merge reconciles without duplicate generation',async()=>{
  const f=await fixture();try{await f.w.tick();f.g.merge=async()=>{throw Error('connection reset');};await f.w.tick();assert.equal((await f.s.get(f.id)).status,'checking');f.g.mergeGate=async()=>({merged:'merged'});await f.w.tick();assert.equal((await f.s.get(f.id)).status,'deploying');}finally{await f.s.close();}
});
test('deployment failure pauses queue',async()=>{
  const f=await fixture();try{await f.w.tick();await f.w.tick();f.g.deployment=async()=>({ok:false});await f.w.tick();assert.equal((await f.s.get(f.id)).status,'deployment-failed');assert.equal(await f.w.paused(),true);}finally{await f.s.close();}
});
test('rollback fails if main advanced',async()=>{
  const f=await fixture();try{await f.s.state(f.id,'queued-rollback',{rollbackOf:'missing'});await f.w.tick();assert.equal((await f.s.get(f.id)).status,'failed');assert.equal(f.merges(),0);}finally{await f.s.close();}
});
test('restart fails interrupted planning safely',async()=>{
  const f=await fixture();try{await f.s.state(f.id,'planning',{});await f.w.recover();assert.equal((await f.s.get(f.id)).status,'failed');}finally{await f.s.close();}
});
test('latest-update rollback creates a checked revert and remains paused',async()=>{
  const f=await fixture();try{
    await f.s.state(f.id,'deployed',{base:'base',baseTree:'prior-tree',merged:'current-main'});
    const id=await f.s.submit('owner','Administrator rollback','unique-rollback-key');
    await f.s.state(id,'queued-rollback',{rollbackOf:f.id});await f.w.pause();f.g.main=async()=>'current-main';
    let proposalArgs;
    f.g.proposal=async(...args)=>{proposalArgs=args;return {base:'current-main',head:'revert-head',pr:2,baseTree:'current-tree'};};
    await f.w.tick();assert.deepEqual(proposalArgs,[id,'current-main',[],'prior-tree']);
    assert.equal((await f.s.get(id)).status,'checking');await f.w.tick();assert.equal(f.merges(),1);
    await f.w.tick();assert.equal((await f.s.get(f.id)).status,'rolled-back');assert.equal(await f.w.paused(),true);
  }finally{await f.s.close();}
});
test('expired free pilot stops all processing and persists pause',async()=>{
  const f=await fixture();try{
    f.w.config.pilotEndsAt=Date.now()-1000;await f.w.tick();
    assert.equal((await f.s.get(f.id)).status,'queued');assert.equal(f.merges(),0);assert.equal(await f.w.paused(),true);
  }finally{await f.s.close();}
});
