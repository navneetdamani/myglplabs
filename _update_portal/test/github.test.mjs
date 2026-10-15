import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../github.mjs';
function gateFixture(overrides={}) {
  const g=new GitHub({}),data={id:'request',pr:1,head:'head',base:'base'};
  const pr={state:'open',draft:false,head:{sha:'head',ref:'portal/change-request',repo:{id:1350958571}},base:{ref:'main'},mergeable_state:'clean'};
  const fixtures={
    '/pulls/1':pr,
    '/git/ref/heads/main':{object:{sha:'base'}},
    '/branches/main/protection':{enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:'site-checks',app_id:15368}]}},
    '/commits/head/check-runs?per_page=100':{total_count:1,check_runs:[{id:1,name:'site-checks',app:{id:15368},status:'completed',conclusion:'success',details_url:'https://github.com/navneetdamani/myglplabs/actions/runs/7/job/8'}]},
    '/actions/runs/7':{head_sha:'head',path:'.github/workflows/portal-checks.yml',event:'pull_request',status:'completed',conclusion:'success'},
    ...overrides
  };
  g.repo=async path=>{assert.ok(path in fixtures,`Unexpected API call ${path}`);return fixtures[path];};
  return {g,data,fixtures,pr};
}
test('exact head with trusted successful CI passes gate',async()=>{const f=gateFixture();assert.deepEqual(await f.g.mergeGate(f.data),{ready:true});});
test('stale base is refused',async()=>{const f=gateFixture({'/git/ref/heads/main':{object:{sha:'new-base'}}});await assert.rejects(f.g.mergeGate(f.data),/Main advanced/);});
test('missing branch protection is refused',async()=>{const f=gateFixture({'/branches/main/protection':{}});await assert.rejects(f.g.mergeGate(f.data),/Required branch/);});
test('spoofed check name from a different app is insufficient',async()=>{
  const f=gateFixture();f.fixtures['/commits/head/check-runs?per_page=100'].check_runs[0].app.id=99;assert.equal(await f.g.mergeGate(f.data),null);
});
test('skipped CI is not success',async()=>{
  const f=gateFixture();f.fixtures['/commits/head/check-runs?per_page=100'].check_runs[0].conclusion='skipped';await assert.rejects(f.g.mergeGate(f.data),/Automated checks failed/);
});
test('wrong workflow path is refused',async()=>{
  const f=gateFixture();f.fixtures['/actions/runs/7'].path='.github/workflows/untrusted.yml';await assert.rejects(f.g.mergeGate(f.data),/provenance/);
});
test('changed pull request head is refused even when manually merged',async()=>{
  const f=gateFixture();f.pr.merged=true;f.pr.head.sha='other';await assert.rejects(f.g.mergeGate(f.data),/identity/);
});
test('merge sends expected SHA and never writes main ref directly',async()=>{
  const g=new GitHub({});let call;
  g.repo=async(...args)=>{call=args;return {merged:true,sha:'merged'};};
  assert.equal(await g.merge({pr:1,head:'exact-head'}),'merged');
  assert.deepEqual(call,['/pulls/1/merge','PUT',{merge_method:'squash',sha:'exact-head'}]);
});
test('GitHub error bodies and tokens are not exposed',async()=>{
  const g=new GitHub({},async()=>({ok:false,status:403,text:async()=>'secret-value'}));
  await assert.rejects(g.json('/user','GET',undefined,'secret-token'),e=>e.message==='GitHub GET failed (403)');
});
