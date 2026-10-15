import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { Store, digest, token } from './store.mjs';
import { GitHub } from './github.mjs';
import { Worker } from './worker.mjs';
import { acquireStore,handoffServer } from './handoff.mjs';

export function config(env=process.env) {
  const required = ['PORTAL_ORIGIN','ALLOWED_EMAILS','GITHUB_OAUTH_CLIENT_ID','GITHUB_OAUTH_CLIENT_SECRET',
    'GITHUB_APP_ID','GITHUB_INSTALLATION_ID','GITHUB_APP_PRIVATE_KEY','LOCAL_WORKER_TOKEN_SHA256'];
  for (const name of required) if (!env[name]) throw Error(`Missing configuration: ${name}`);
  if(!/^[a-f0-9]{64}$/.test(env.LOCAL_WORKER_TOKEN_SHA256))throw Error('Invalid local worker configuration');
  const origin = new URL(env.PORTAL_ORIGIN);
  if (origin.protocol!=='https:' || origin.origin!==env.PORTAL_ORIGIN) throw Error('PORTAL_ORIGIN must be an HTTPS origin');
  const pilotEndsAt=env.PILOT_ENDS_AT ? Date.parse(env.PILOT_ENDS_AT) : null;
  if(env.PILOT_ENDS_AT && !Number.isFinite(pilotEndsAt))throw Error('Invalid pilot expiration');
  if(env.RENDER==='true' && (!env.DATABASE_URL || !pilotEndsAt))throw Error('Hosted pilot requires PostgreSQL and an expiration');
  const emails=env.ALLOWED_EMAILS.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length || emails.some(s=>!s.includes('@'))) throw Error('Configure allowed emails');
  return {origin:origin.origin,emails,adminId:'258078742',clientId:env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret:env.GITHUB_OAUTH_CLIENT_SECRET,appId:env.GITHUB_APP_ID,installationId:env.GITHUB_INSTALLATION_ID,
    appKey:env.GITHUB_APP_PRIVATE_KEY.replaceAll('\\n','\n'),aiMode:'local-chatgpt',workerTokenHash:env.LOCAL_WORKER_TOKEN_SHA256,
    autoPublish:env.AUTO_PUBLISH==='true',port:Number(env.PORT || 10000),dataDir:env.DATA_DIR || '/var/data',
    databaseUrl:env.DATABASE_URL,pilotEndsAt};
}
const fail = (status,message) => { throw Object.assign(Error(message),{status}); };
function cookie(req,name) { return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1) || ''; }
const same = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req,maxBytes=10000) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'JSON required');
  let text='';
  for await (const chunk of req) { text+=chunk; if (Buffer.byteLength(text)>maxBytes) fail(413,'Request too large'); }
  try { return JSON.parse(text); } catch { fail(400,'Invalid JSON'); }
}
export function createServer(c,s,g,worker,transport=fetch) {
  const publicFiles = new Map(['/','/app.js','/style.css'].map(path=>[path,readFileSync(new URL(`./public/${path==='/'?'index.html':path.slice(1)}`,import.meta.url))]));
  return http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const redirect=(url,cookieValue)=>{if(cookieValue)res.setHeader('Set-Cookie',cookieValue);res.writeHead(302,{Location:url});res.end();};
    try {
      const url=new URL(req.url,c.origin),path=url.pathname;
      if (req.method==='GET' && path==='/healthz') return json(200,{ok:true});
      if (req.method==='GET' && publicFiles.has(path)) {
        res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8'});
        return res.end(publicFiles.get(path));
      }
      if (req.method==='GET' && path==='/auth/login') {
        await s.limit(`login:${req.socket.remoteAddress}`,120,60000);
        const state=token(),verifier=token();
        await s.run('DELETE FROM oauth WHERE expires < ?',Date.now());
        await s.run('INSERT INTO oauth VALUES(?,?,?)',digest(state),verifier,Date.now()+600000);
        const auth=new URL('https://github.com/login/oauth/authorize');
        auth.search=new URLSearchParams({client_id:c.clientId,redirect_uri:`${c.origin}/auth/callback`,scope:'user:email',state,
          code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        return redirect(auth.href,`__Host-oauth=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`);
      }
      if (req.method==='GET' && path==='/auth/callback') {
        const state=url.searchParams.get('state'),code=url.searchParams.get('code');
        if (!state || !code || code.length>512 || !same(state,cookie(req,'__Host-oauth'))) fail(403,'Invalid login state');
        const pending=await s.one('DELETE FROM oauth WHERE hash=? AND expires>? RETURNING verifier',digest(state),Date.now());
        if(!pending) fail(403,'Login expired or already used');
        const exchange=await transport('https://github.com/login/oauth/access_token',{
          method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
          body:JSON.stringify({client_id:c.clientId,client_secret:c.clientSecret,code,code_verifier:pending.verifier,redirect_uri:`${c.origin}/auth/callback`})});
        if(!exchange.ok) fail(502,'Login provider unavailable');
        const auth=await exchange.json(); if(!auth.access_token) fail(403,'Login failed');
        const profile=await g.json('/user','GET',undefined,auth.access_token);
        const emails=await g.json('/user/emails','GET',undefined,auth.access_token);
        const email=emails.find(e=>e.verified && c.emails.includes(e.email.toLowerCase()))?.email.toLowerCase() || '';
        const uid=String(profile.id);
        if(uid!==c.adminId && !email) { await s.audit(uid,'','access-denied'); fail(403,'This account is not authorized'); }
        const session=await s.session(uid,profile.login,email);
        res.setHeader('Set-Cookie',[`__Host-session=${session}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800`,
          '__Host-oauth=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
        return redirect('/');
      }
      if(path.startsWith('/api/worker/')) {
        const bearer=req.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]{43,128})$/)?.[1];
        if(!bearer||!c.workerTokenHash||!same(digest(bearer),c.workerTokenHash))fail(401,'Worker authorization required');
        if(req.method!=='POST')fail(405,'POST required');
        await s.limit('local-worker:api',90,60000);
        const input=await body(req,30000);
        if(path==='/api/worker/claim') {
          await s.run("INSERT INTO settings VALUES('local-worker-seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(Date.now()));
          return json(200,{job:await worker.claim()});
        }
        const result=path.match(/^\/api\/worker\/results\/([a-f0-9-]{36})$/);
        if(result){await worker.complete(result[1],input);return json(200,{ok:true});}
        fail(404,'Not found');
      }
      const user=await s.one('SELECT * FROM sessions WHERE hash=? AND expires>?',digest(cookie(req,'__Host-session')),Date.now());
      if(!user || user.uid!==c.adminId && !c.emails.includes(user.email)) fail(401,'Sign in to continue');
      const admin=user.uid===c.adminId;
      await s.limit(`api:${user.uid}`,120,60000);
      if(req.method!=='GET') {
        if(req.headers.origin!==c.origin || !same(req.headers['x-csrf-token'],user.csrf)) fail(403,'Invalid request origin or token');
      }
      if(req.method==='GET' && path==='/api/me') return json(200,{login:user.login,csrf:user.csrf,admin,autoPublish:c.autoPublish,aiMode:'local-chatgpt',workerOnline:Date.now()-Number((await s.one("SELECT value FROM settings WHERE key='local-worker-seen'"))?.value||0)<120000,paused:await worker.paused(),pilotEndsAt:c.pilotEndsAt});
      if(req.method==='POST' && path==='/auth/logout') {
        await s.run('DELETE FROM sessions WHERE hash=?',user.hash);await s.audit(user.uid,'','logout');
        res.setHeader('Set-Cookie','__Host-session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');return json(200,{ok:true});
      }
      if(req.method==='GET' && path==='/api/requests') return json(200,await s.list(user.uid,admin));
      if(req.method==='POST' && path==='/api/requests') {
        if(c.pilotEndsAt && Date.now()>=c.pilotEndsAt)fail(403,'Pilot expired. Export records and contact the administrator.');
        const input=await body(req),key=req.headers['idempotency-key'];
        if(typeof input.prompt!=='string' || input.prompt.trim().length<10 || input.prompt.length>4000 || /\x00/.test(input.prompt)) fail(400,'Describe a change in 10–4000 characters');
        if(typeof key!=='string' || !/^[a-zA-Z0-9-]{16,64}$/.test(key)) fail(400,'Idempotency key required');
        return json(202,{id:await s.submit(user.uid,input.prompt.trim(),key,{editorEmail:user.email,targetRepo:'navneetdamani/myglplabs'})});
      }
      if(req.method==='GET' && path==='/api/audit') {
        if(!admin) fail(403,'Administrator access required');
        return json(200,await s.all('SELECT * FROM audit ORDER BY seq DESC LIMIT 500'));
      }
      if(req.method==='GET' && path==='/api/export') {
        if(!admin)fail(403,'Administrator access required');
        const snapshot=await s.transaction(async()=>{
          await s.verifyAudit();await s.audit(user.uid,'','records-exported');
          return {version:1,exportedAt:new Date().toISOString(),requests:await s.all('SELECT * FROM requests ORDER BY created,id'),
            audit:await s.all('SELECT * FROM audit ORDER BY seq'),settings:await s.all('SELECT * FROM settings')};
        });
        return json(200,snapshot);
      }
      if(req.method==='POST' && path==='/api/pause') {
        if(!admin) fail(403,'Administrator access required');
        const input=await body(req);if(typeof input.paused!=='boolean') fail(400,'paused must be boolean');
        await s.run("INSERT INTO settings VALUES('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",String(input.paused));
        await s.audit(user.uid,'',input.paused?'publishing-paused':'publishing-resumed');return json(200,{ok:true});
      }
      const rollback=path.match(/^\/api\/requests\/([a-f0-9-]{36})\/rollback$/);
      if(req.method==='POST' && rollback) {
        if(!admin) fail(403,'Administrator access required');
        await body(req);
        if(c.pilotEndsAt && Date.now()>=c.pilotEndsAt)fail(403,'Pilot expired');
        const target=await s.get(rollback[1]);
        if(!target || !['deployed','deployment-failed'].includes(target.status) || target.data.rollbackOf) fail(409,'Request is not eligible for rollback');
        if(await g.main()!==target.data.merged) fail(409,'Main advanced; manual revert required');
        const id=await s.rollback(user.uid,target.id);
        return json(202,{id});
      }
      fail(404,'Not found');
    } catch(error) {
      const status=error.status || 500;
      // Never log bodies, OAuth codes, URLs, environment values or upstream errors.
      if(status===500) console.error(JSON.stringify({requestId,event:'request-failed'}));
      json(status,{error:status===500?'Service error; use the request ID when contacting the administrator':error.message,requestId});
    }
  });
}
export function setupServer(port) {
  const css=readFileSync(new URL('./public/style.css',import.meta.url));
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if(req.url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true,"mode":"setup"}');}
    if(req.method==='GET' && req.url==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css);}
    if(req.method==='GET' && req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portal setup · My GLP Labs</title><link rel="stylesheet" href="/style.css"></head><body><main><div class="eyebrow">MY GLP LABS · FREE PILOT</div><h1>Your update workspace<br><em>is being configured.</em></h1><section class="panel"><h2>Administrator setup in progress</h2><p>Sign-in, update requests and automatic publishing are disabled until the secure account connections are configured.</p><p>Your public website continues to run on GitHub Pages.</p></section></main></body></html>');}
    res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Administrator setup is incomplete"}');
  });
  return server.listen(port,'0.0.0.0');
}
if(process.argv[1]===fileURLToPath(import.meta.url) && process.env.SETUP_MODE==='true') {
  setupServer(Number(process.env.PORT || 10000));console.log('Setup mode: login and publishing disabled');
} else if(process.argv[1]===fileURLToPath(import.meta.url)) {
  let standby;
  try {
  const c=config();
  let s;if(c.databaseUrl)s=await acquireStore(()=>Store.postgres(c.databaseUrl),()=>{standby=handoffServer(c.port);console.log('Waiting for previous portal instance to drain');});else{mkdirSync(c.dataDir,{recursive:true,mode:0o700});s=new Store(`${c.dataDir}/portal.sqlite`);}
  const g=new GitHub(c),w=new Worker(c,s,g);await w.recover();
  const ready=createServer(c,s,g,w),server=standby||ready;
  if(standby){standby.removeAllListeners('request');standby.on('request',ready.listeners('request')[0]);}
  server.requestTimeout=20000;server.headersTimeout=10000;
  if(!standby)server.listen(c.port,'0.0.0.0',()=>console.log('Portal ready'));else console.log('Portal ready');
  const timer=setInterval(()=>w.tick().catch(()=>console.error('Worker failed safely')),15000);
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{
    clearInterval(timer);server.close(async()=>{await s.close();process.exit(0);});
    setTimeout(()=>process.exit(0),10000).unref();
  });
  }catch{if(standby)standby.close();console.error('Portal startup failed; verify private configuration and database access');process.exitCode=1;}
}

