import test from 'node:test';
import assert from 'node:assert/strict';
import { Store,digest,postgresOptions } from '../store.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
test('idempotency, private history and per-user quota',async()=>{
  const s=new Store(':memory:');try{
    const id=await s.submit('one','A sufficiently long prompt','unique-key-000001');
    assert.equal(await s.submit('one','A different prompt','unique-key-000001'),id);
    assert.equal((await s.list('two',false)).length,0);assert.equal((await s.list('two',true)).length,1);
    for(let i=0;i<4;i++)await s.submit('one','A sufficiently long prompt',`unique-key-${i}`);
    await assert.rejects(s.submit('one','Another prompt','last-key'),/Rate limit/);
    assert.equal((await s.list('one',false)).length,5);
  }finally{await s.close();}
});
test('global daily spending quota and transactional limits',async()=>{
  const s=new Store(':memory:');try{
    for(let i=0;i<20;i++){const id=await s.submit(`u${i}`,'A long enough update',`key-${i}`);await s.state(id,'failed',{});}
    await assert.rejects(s.submit('extra','A long enough update','key-extra'),/Rate limit/);
    assert.equal(await s.one("SELECT count FROM quota WHERE key='submit:extra'"),undefined);
  }finally{await s.close();}
});
test('audit is linked and append only; session tokens are hashed',async()=>{
  const s=new Store(':memory:');try{
    const raw=await s.session('1','owner','owner@example.com');
    assert.equal((await s.one('SELECT hash FROM sessions')).hash,digest(raw));await s.audit('1','','test');
    const rows=await s.all('SELECT * FROM audit ORDER BY seq');assert.equal(rows[1].previous,rows[0].hash);
    await s.verifyAudit();await assert.rejects(s.run("UPDATE audit SET event='tampered'"),/Append only/);
    await assert.rejects(s.run('DELETE FROM audit'),/Append only/);
  }finally{await s.close();}
});
test('audit verification detects altered rows',async()=>{
  const s=new Store(':memory:');try{
    await s.audit('owner','','event');s.db.exec('DROP TRIGGER audit_no_update');s.db.exec("UPDATE audit SET event='tampered'");
    await assert.rejects(s.verifyAudit(),/integrity/);
  }finally{await s.close();}
});
test('requests, sessions, audit and pause survive database reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'portal-test-')),path=join(dir,'test.sqlite');try{
    const s=new Store(path),id=await s.submit('one','Persist this update','persistent-key-1');
    const session=await s.session('one','editor','editor@example.com');await s.run("INSERT INTO settings VALUES('paused','true')");await s.close();
    const reopened=new Store(path);try{
      assert.equal((await reopened.get(id)).status,'queued');
      assert.ok(await reopened.one('SELECT * FROM sessions WHERE hash=?',digest(session)));
      assert.equal((await reopened.one('SELECT value FROM settings')).value,'true');await reopened.verifyAudit();
    }finally{await reopened.close();}
  }finally{
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('portal-test-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
test('concurrent submissions and audit writes serialize without quota bypass',async()=>{
  const s=new Store(':memory:');try{
    const results=await Promise.allSettled(Array.from({length:12},(_,i)=>s.submit('one','Concurrent update request',`concurrent-key-${i}`)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal((await s.list('one',false)).length,5);await s.verifyAudit();
  }finally{await s.close();}
});
test('external PostgreSQL requires verified TLS; private Render endpoints stay private',()=>{
  assert.deepEqual(postgresOptions('postgres://u:p@db.oregon-postgres.render.com/db').ssl,{rejectUnauthorized:true});
  assert.equal(postgresOptions('postgres://u:p@dpg-private-a/db').ssl,false);
  assert.throws(()=>postgresOptions('postgres://u:p@evil.example/db?sslmode=disable'),/TLS/);
});
