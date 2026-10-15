import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
export const digest = s => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
const schema = `
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, uid TEXT, login TEXT, email TEXT, csrf TEXT, expires BIGINT);
  CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, verifier TEXT, expires BIGINT);
  CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, count INTEGER, expires BIGINT);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, uid TEXT, prompt TEXT, created BIGINT,
    status TEXT, data TEXT NOT NULL DEFAULT '{}', idempotency TEXT, UNIQUE(uid,idempotency));`;
const auditFields = 'time BIGINT, uid TEXT, request_id TEXT, event TEXT, detail TEXT, previous TEXT, hash TEXT';
export const postgresSchema = `${schema}
  CREATE TABLE IF NOT EXISTS audit (seq BIGSERIAL PRIMARY KEY, ${auditFields});
  CREATE OR REPLACE FUNCTION portal_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Append only'; END; $$;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='portal_audit_no_mutation') THEN
      CREATE TRIGGER portal_audit_no_mutation BEFORE UPDATE OR DELETE OR TRUNCATE ON audit
        FOR EACH STATEMENT EXECUTE FUNCTION portal_audit_append_only();
    END IF;
  END; $$;`;
export function postgresOptions(url) {
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)) throw Error('Invalid database URL');
  const internal=/^dpg-[a-z0-9-]+$/.test(parsed.hostname) || parsed.hostname.endsWith('.internal') || ['localhost','127.0.0.1'].includes(parsed.hostname);
  if(parsed.searchParams.has('sslmode') || parsed.searchParams.has('ssl')) throw Error('Configure TLS using DATABASE_URL without SSL query overrides');
  return {connectionString:url,ssl:internal?false:{rejectUnauthorized:true},connectionTimeoutMillis:10000,
    query_timeout:15000,statement_timeout:15000,application_name:'myglplabs-portal'};
}
export class Store {
  constructor(path,client=null) {
    this.client=client;this.context=new AsyncLocalStorage();this.tail=Promise.resolve();
    if(client) return;
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      ${schema} CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, ${auditFields});
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Append only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Append only'); END;`);
    this.verifyRows(this.db.prepare('SELECT * FROM audit ORDER BY seq').all());
  }
  static async postgres(url) {
    pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Unsafe database integer');return n;});
    const client=new pg.Client(postgresOptions(url));
    client.on('error',()=>console.error('Database connection unavailable'));
    await client.connect();
    try {
      const lock=await client.query('SELECT pg_try_advisory_lock(1350958571) AS acquired');
      if(!lock.rows[0].acquired)throw Object.assign(Error('Another portal instance is active'),{code:'PORTAL_ACTIVE'});
      await client.query(postgresSchema);
      const store=new Store(null,client);await store.verifyAudit();return store;
    }catch(error){await client.end();throw error;}
  }
  exclusive(fn) {
    if(this.context.getStore()===this)return fn();
    const task=this.tail.then(()=>this.context.run(this,fn));this.tail=task.catch(()=>{});return task;
  }
  async query(sql,args=[],kind='all') {
    return this.exclusive(async()=>{
      if(this.client){let i=0;const result=await this.client.query(sql.replace(/\?/g,()=>`$${++i}`),args);
        return kind==='one'?result.rows[0]:kind==='run'?{changes:result.rowCount}:result.rows;
      }
      return this.db.prepare(sql)[kind==='one'?'get':kind==='run'?'run':'all'](...args);
    });
  }
  one(sql,...args){return this.query(sql,args,'one');}
  all(sql,...args){return this.query(sql,args);}
  run(sql,...args){return this.query(sql,args,'run');}
  async transaction(fn) {
    if(this.inTransaction && this.context.getStore()===this)return fn();
    return this.exclusive(async()=>{
      await this.run(this.client?'BEGIN':'BEGIN IMMEDIATE');this.inTransaction=true;
      try{const result=await fn();await this.run('COMMIT');return result;}
      catch(error){await this.run('ROLLBACK');throw error;}
      finally{this.inTransaction=false;}
    });
  }
  audit(uid,id,event,detail={}) {
    return this.transaction(async()=>{
      const previous=(await this.one('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1'))?.hash || '';
      const time=Date.now(),data=JSON.stringify(detail),hash=digest(JSON.stringify([time,uid,id,event,data,previous]));
      await this.run('INSERT INTO audit(time,uid,request_id,event,detail,previous,hash) VALUES(?,?,?,?,?,?,?)',time,uid,id,event,data,previous,hash);
    });
  }
  verifyRows(rows) {
    let previous='';for(const r of rows){
      if(r.previous!==previous || r.hash!==digest(JSON.stringify([r.time,r.uid,r.request_id,r.event,r.detail,r.previous])))throw Error('Audit integrity check failed');
      previous=r.hash;
    }
  }
  async verifyAudit(){this.verifyRows(await this.all('SELECT * FROM audit ORDER BY seq'));}
  limit(key,max,windowMs) {
    return this.transaction(async()=>{
      const now=Date.now();await this.run('DELETE FROM quota WHERE expires < ?',now);
      const row=await this.one('SELECT count FROM quota WHERE key=?',key);
      if(row?.count>=max)throw Object.assign(Error('Rate limit reached. Please try later.'),{status:429});
      await this.run('INSERT INTO quota VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=quota.count+1',key,now+windowMs);
    });
  }
  submit(uid,prompt,key,data={}) {
    return this.transaction(async()=>{
      const old=await this.one('SELECT id FROM requests WHERE uid=? AND idempotency=?',uid,key);if(old)return old.id;
      await this.limit(`submit:${uid}`,5,3600000);await this.limit('global:submit',20,86400000);
      if((await this.one("SELECT COUNT(*) AS n FROM requests WHERE status IN ('queued','planning','checking','deploying')")).n>=20)throw Object.assign(Error('Queue is full'),{status:429});
      const id=randomUUID();await this.run('INSERT INTO requests(id,uid,prompt,created,status,idempotency,data) VALUES(?,?,?,?,?,?,?)',id,uid,prompt,Date.now(),'queued',key,JSON.stringify(data));
      await this.audit(uid,id,'submitted',{promptHash:digest(prompt)});return id;
    });
  }
  async get(id){const r=await this.one('SELECT * FROM requests WHERE id=?',id);return r && {...r,data:JSON.parse(r.data)};}
  state(id,status,data) {
    return this.transaction(async()=>{
      const r=await this.get(id);await this.run('UPDATE requests SET status=?,data=? WHERE id=?',status,JSON.stringify({...r.data,...data}),id);
      await this.audit('system',id,status,data);
    });
  }
  async list(uid,admin){return(await this.all(`SELECT id,uid,prompt,created,status,data FROM requests ${admin?'':'WHERE uid=?'} ORDER BY created DESC LIMIT 100`,...(admin?[]:[uid]))).map(r=>({...r,data:JSON.parse(r.data)}));}
  session(uid,login,email) {
    return this.transaction(async()=>{
      const raw=token();await this.run('DELETE FROM sessions WHERE expires < ?',Date.now());
      await this.run('INSERT INTO sessions VALUES(?,?,?,?,?,?)',digest(raw),uid,login,email,token(),Date.now()+8*3600000);
      await this.audit(uid,'','login');return raw;
    });
  }
  rollback(uid,targetId) {
    return this.transaction(async()=>{
      const target=await this.get(targetId);
      if(!target || !['deployed','deployment-failed'].includes(target.status) || target.data.rollbackOf)throw Object.assign(Error('Request is not eligible for rollback'),{status:409});
      await this.limit(`rollback:${uid}`,3,3600000);
      if(await this.one("SELECT id FROM requests WHERE status IN ('planning','checking','deploying','awaiting-local','queued-rollback') LIMIT 1"))throw Object.assign(Error('Another change is active'),{status:409});
      const id=randomUUID();await this.run('INSERT INTO requests(id,uid,prompt,created,status,data,idempotency) VALUES(?,?,?,?,?,?,?)',id,uid,'Administrator rollback',Date.now(),'queued-rollback',JSON.stringify({rollbackOf:target.id}),`rollback-${target.id}`);
      await this.run("INSERT INTO settings VALUES('paused','true') ON CONFLICT(key) DO UPDATE SET value='true'");
      await this.audit(uid,id,'rollback-requested',{target:target.id});return id;
    });
  }
  async close(){await this.tail;if(this.client)await this.client.end();else this.db.close();}
}

