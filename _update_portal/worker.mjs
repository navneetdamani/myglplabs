import { FILES,validateProposal } from './policy.mjs';
import { digest,token } from './store.mjs';
import { plan } from './agent.mjs';
export class Worker {
  constructor(config,store,github,planner=plan) { Object.assign(this,{config,store,github,planner}); }
  async paused() { return (await this.store.one("SELECT value FROM settings WHERE key='paused'"))?.value === 'true'; }
  pause() { return this.store.run("INSERT INTO settings VALUES('paused','true') ON CONFLICT(key) DO UPDATE SET value='true'"); }
  async recover() {
    for (const r of await this.store.all("SELECT id FROM requests WHERE status='planning'")) {
      await this.store.state(r.id,'failed',{reason:'Interrupted during planning. Inspect any orphan branch before resubmitting.'});
    }
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Free database expiry is a hard stop, including for rollback; never silently renew paid resources.
      if (this.config.pilotEndsAt && Date.now() >= this.config.pilotEndsAt) { await this.pause(); return; }
      for(const r of await this.store.all("SELECT id,data FROM requests WHERE status='awaiting-local'"))if(JSON.parse(r.data).localLeaseExpires<Date.now())await this.store.state(r.id,'failed',{reason:'Local processing was interrupted. Resubmit when the computer is available.',localLeaseHash:null,files:null});
      // Finish the current merge/deployment before planning any following change.
      const row = await this.store.one("SELECT id FROM requests WHERE status IN ('checking','deploying') ORDER BY created LIMIT 1")
        || await this.store.one("SELECT id FROM requests WHERE status='queued-rollback' ORDER BY created LIMIT 1")
        || (this.config.aiMode!=='local-chatgpt' && !await this.paused() && await this.store.one("SELECT id FROM requests WHERE status='queued' ORDER BY created LIMIT 1"));
      if (row) await this.process(await this.store.get(row.id));
    } finally { this.busy = false; }
  }
  async claim() {
    if(this.busy||await this.paused()||this.config.pilotEndsAt&&Date.now()>=this.config.pilotEndsAt)return null;
    this.busy=true;
    try {
      if(await this.store.one("SELECT id FROM requests WHERE status IN ('checking','deploying','planning','awaiting-local','queued-rollback') LIMIT 1"))return null;
      const rows=await this.store.all("SELECT id,data FROM requests WHERE status='queued' ORDER BY created LIMIT 20");
      const row=rows.find(r=>!(JSON.parse(r.data).nextAttempt>Date.now()));if(!row)return null;
      const request=await this.store.get(row.id);
      if(request.data.targetRepo!=='navneetdamani/myglplabs'||request.uid!==this.config.adminId&&!this.config.emails?.includes(request.data.editorEmail)){await this.store.state(request.id,'failed',{reason:'Request authorization or website target is no longer valid'});return null;}
      const base=await this.github.main(),files=await this.github.files(base,FILES),lease=token();
      await this.store.limit('local-worker:claims',40,86400000);
      await this.store.state(request.id,'awaiting-local',{base,files,localLeaseHash:digest(lease),localLeaseExpires:Date.now()+900000});
      return{id:request.id,prompt:request.prompt,files,lease};
    }finally{this.busy=false;}
  }
  async complete(id,input) {
    if(this.busy)throw Object.assign(Error('Worker busy'),{status:409});
    this.busy=true;
    try {
      const request=await this.store.get(id);
      if(!request||request.status!=='awaiting-local'||typeof input.lease!=='string'||digest(input.lease)!==request.data.localLeaseHash||Date.now()>=request.data.localLeaseExpires)throw Object.assign(Error('Worker lease invalid or expired'),{status:409});
      if(this.config.pilotEndsAt&&Date.now()>=this.config.pilotEndsAt)throw Object.assign(Error('Pilot expired'),{status:403});
      if(request.data.targetRepo!=='navneetdamani/myglplabs'||request.uid!==this.config.adminId&&!this.config.emails?.includes(request.data.editorEmail)){await this.store.state(id,'failed',{reason:'Request authorization or website target is no longer valid',localLeaseHash:null,files:null});return;}
      if(input.deferred===true){await this.store.state(id,'queued',{nextAttempt:Date.now()+1800000,reason:'Waiting for the local ChatGPT worker. No paid API fallback.',localLeaseHash:null,files:null});return;}
      try {
        const edits=validateProposal(input.proposal,request.data.files);
        if(await this.github.main()!==request.data.base)throw Error('Main advanced; submit a new request against current website');
        await this.store.state(id,'planning',{localLeaseHash:null,files:null});
        const proposal=await this.github.proposal(id,request.data.base,edits);
        await this.store.state(id,'checking',{...proposal,started:Date.now(),reason:null});
      }catch(error){await this.store.state(id,'failed',{reason:error.message,localLeaseHash:null,files:null});}
    }finally{this.busy=false;}
  }
  async process(r) {
    const {store:s,github:g,config:c} = this;
    try {
      if (['queued','queued-rollback'].includes(r.status)) {
        await s.state(r.id,'planning',{});
        const base = await g.main();
        let proposal;
        if (r.data.rollbackOf) {
          const target = await s.get(r.data.rollbackOf);
          if (!target?.data.merged || base !== target.data.merged) throw Error('Rollback refused: main has advanced. Manual revert is required.');
          proposal = await g.proposal(r.id,base,[],target.data.baseTree);
        } else {
          const files = await g.files(base,FILES);
          const edits = await this.planner(c,r.prompt,files);
          proposal = await g.proposal(r.id,base,edits);
        }
        await s.state(r.id,'checking',{...proposal,started:Date.now()});
        return;
      }
      if (r.status==='checking') {
        const data = {...r.data,id:r.id};
        const gate = await g.mergeGate(data);
        // Reconcile a merge whose response was lost, including after process restart.
        if (gate?.merged) { await s.state(r.id,'deploying',{merged:gate.merged,deployStarted:Date.now()}); return; }
        if (Date.now()-r.data.started > 3600000) throw Error('Checks timed out; merge disabled');
        if (!gate?.ready || !c.autoPublish || await this.paused() && !r.data.rollbackOf) return;
        await s.audit('system',r.id,'merge-authorized',{head:r.data.head,base:r.data.base});
        try {
          const merged = await g.merge(data);
          await s.state(r.id,'deploying',{merged,deployStarted:Date.now()});
        } catch {
          // Leave checking for bounded reconciliation; never retry a model or bypass checks.
          await s.audit('system',r.id,'merge-response-uncertain');
        }
        return;
      }
      if (r.status==='deploying') {
        const deployment = await g.deployment(r.data.merged);
        if (deployment?.ok) {
          await s.state(r.id,'deployed',{deployment:deployment.url});
          if (r.data.rollbackOf) await s.state(r.data.rollbackOf,'rolled-back',{rollback:r.id});
        } else if (deployment && !deployment.ok || Date.now()-r.data.deployStarted > 1800000) {
          await this.pause();
          await s.state(r.id,'deployment-failed',{reason:'Pages deployment failed or timed out; publishing paused. Administrator rollback is available.'});
        }
      }
    } catch (error) {
      // Internal errors are fixed strings; never store upstream response bodies or credentials.
      const safe = /^(GitHub |AI |Main advanced|Only visible|CSS cannot|Invalid proposal|Duplicate|File outside|Unsafe CSS|Invalid CSS|Unparsed CSS|Required branch|Pull request|Check provenance|Too many checks|Automated checks|Checks timed|Rollback refused|Unexpected repository)/.test(error.message)
        ? error.message.slice(0,220) : 'Request failed safely; administrator review required';
      await s.state(r.id,'failed',{reason:safe});
    }
  }
}
