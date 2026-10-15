import { FILES } from './policy.mjs';
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
      // Finish the current merge/deployment before planning any following change.
      const row = await this.store.one("SELECT id FROM requests WHERE status IN ('checking','deploying') ORDER BY created LIMIT 1")
        || await this.store.one("SELECT id FROM requests WHERE status='queued-rollback' ORDER BY created LIMIT 1")
        || (!await this.paused() && await this.store.one("SELECT id FROM requests WHERE status='queued' ORDER BY created LIMIT 1"));
      if (row) await this.process(await this.store.get(row.id));
    } finally { this.busy = false; }
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
