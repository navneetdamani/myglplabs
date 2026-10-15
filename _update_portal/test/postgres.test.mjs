import test from 'node:test';
import assert from 'node:assert/strict';
import { Store,digest } from '../store.mjs';
test('real PostgreSQL persists state and enforces quota, audit and worker isolation',{skip:!process.env.PG_TEST_URL},async()=>{
  const url=process.env.PG_TEST_URL;
  // CI supplies an isolated throwaway database, never the hosted pilot database.
  if(new URL(url).pathname!=='/portal_test')throw Error('Integration tests require an isolated portal_test database');
  let s=await Store.postgres(url);
  let id,session;
  try{
    id=await s.submit('pg-editor','PostgreSQL persistent update','pg-idempotency-key');
    assert.equal(await s.submit('pg-editor','Duplicate update','pg-idempotency-key'),id);
    assert.equal((await s.list('different-editor',false)).length,0);
    session=await s.session('pg-editor','editor','editor@example.com');
    assert.ok(await s.one('SELECT hash FROM sessions WHERE hash=?',digest(session)));
    const results=await Promise.allSettled(Array.from({length:10},(_,i)=>s.submit('pg-editor','Concurrent update request',`pg-quota-${i}`)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,4);
    await assert.rejects(s.run("UPDATE audit SET event='tampered'"),/Append only/);
    await assert.rejects(s.run('DELETE FROM audit'),/Append only/);
    await assert.rejects(s.run('TRUNCATE audit'),/Append only/);
    await assert.rejects(Store.postgres(url),/Another portal instance/);
    await s.state(id,'checking',{base:'base',head:'head'});await s.verifyAudit();
    await s.close();s=await Store.postgres(url);
    assert.equal((await s.get(id)).status,'checking');
    assert.equal((await s.get(id)).data.head,'head');
    assert.ok(await s.one('SELECT hash FROM sessions WHERE hash=?',digest(session)));
    await s.verifyAudit();
  }finally{await s.close();}
});
