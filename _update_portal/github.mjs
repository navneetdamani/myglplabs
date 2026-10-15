import { createSign } from 'node:crypto';
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
export class GitHub {
  constructor(config, transport = fetch) { this.c = config; this.fetch = transport; }
  async json(path, method = 'GET', body, auth) {
    const res = await this.fetch(`https://api.github.com${path}`, {
      method, headers: {'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'myglplabs-update-portal','Content-Type':'application/json',Authorization:`Bearer ${auth || await this.access()}`},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(30000)
    });
    if (!res.ok) throw Error(`GitHub ${method} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }
  async access() {
    if (this.cached && this.cached.expires > Date.now()+60000) return this.cached.token;
    const now = Math.floor(Date.now()/1000);
    const raw = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iat:now-60,exp:now+540,iss:this.c.appId})}`;
    const signature = createSign('RSA-SHA256').update(raw).sign(this.c.appKey,'base64url');
    const res = await this.json(`/app/installations/${this.c.installationId}/access_tokens`,'POST',{
      repository_ids:[1350958571], permissions:{contents:'write',pull_requests:'write',checks:'read',actions:'read',administration:'read'}
    },`${raw}.${signature}`);
    this.cached = {token:res.token,expires:Date.parse(res.expires_at)};
    return res.token;
  }
  repo(path,method,body) { return this.json(`/repos/navneetdamani/myglplabs${path}`,method,body); }
  async main() { return (await this.repo('/git/ref/heads/main')).object.sha; }
  async files(sha, paths) {
    const result = {};
    for (const path of paths) {
      const r = await this.repo(`/contents/${path}?ref=${sha}`);
      if (r.type !== 'file' || r.size > 80000 || r.encoding !== 'base64') throw Error('Unexpected repository file');
      result[path] = Buffer.from(r.content,'base64').toString('utf8');
    }
    return result;
  }
  async proposal(id,base,edits,rollbackTree) {
    const parent = await this.repo(`/git/commits/${base}`);
    const tree = rollbackTree || (await this.repo('/git/trees','POST',{
      base_tree:parent.tree.sha,tree:edits.map(e=>({path:e.path,mode:'100644',type:'blob',content:e.content}))
    })).sha;
    const commit = await this.repo('/git/commits','POST',{message:`Portal update ${id}`,tree,parents:[base]});
    const branch = `portal/change-${id}`;
    await this.repo('/git/refs','POST',{ref:`refs/heads/${branch}`,sha:commit.sha});
    const pr = await this.repo('/pulls','POST',{title:`Website update ${id}`,body:`Private portal request ${id}. Details remain in the portal.`,head:branch,base:'main'});
    return {base,head:commit.sha,pr:pr.number,url:pr.html_url,baseTree:parent.tree.sha};
  }
  async mergeGate(data) {
    const pr = await this.repo(`/pulls/${data.pr}`);
    if (pr.draft || pr.head.sha !== data.head || pr.head.repo?.id !== 1350958571 ||
        pr.base.ref !== 'main' || pr.head.ref !== `portal/change-${data.id}`) throw Error('Pull request identity changed');
    if (pr.merged) return {merged:pr.merge_commit_sha};
    if (pr.state !== 'open') throw Error('Pull request identity changed');
    if (await this.main() !== data.base) throw Error('Main advanced; submit a new request against current website');
    const protection = await this.repo('/branches/main/protection');
    const required = protection.required_status_checks;
    if (!protection.enforce_admins?.enabled || !required?.strict ||
        !required.checks?.some(x=>x.context==='site-checks' && x.app_id===15368)) throw Error('Required branch protection is missing');
    const checks = await this.repo(`/commits/${data.head}/check-runs?per_page=100`);
    if (checks.total_count > 100) throw Error('Too many checks; manual review required');
    const relevant = checks.check_runs.filter(c=>c.name==='site-checks' && c.app?.id===15368);
    if (!relevant.length) return null;
    const check = relevant.sort((a,b)=>b.id-a.id)[0];
    const run = await this.repo(`/actions/runs/${check.details_url?.match(/\/actions\/runs\/(\d+)/)?.[1] || 'invalid'}`);
    if (run.head_sha !== data.head || run.path !== '.github/workflows/portal-checks.yml' || run.event !== 'pull_request') throw Error('Check provenance mismatch');
    if (check.status !== 'completed' || run.status !== 'completed') return null;
    if (check.conclusion !== 'success' || run.conclusion !== 'success') throw Error('Automated checks failed');
    if (pr.mergeable_state !== 'clean') return null;
    return {ready:true};
  }
  async merge(data) {
    // The SHA precondition and strict branch protection close races after the gate.
    const res = await this.repo(`/pulls/${data.pr}/merge`,'PUT',{merge_method:'squash',sha:data.head});
    if (!res.merged) throw Error('Merge rejected');
    return res.sha;
  }
  async deployment(sha) {
    const runs = await this.repo(`/actions/runs?head_sha=${sha}&per_page=100`);
    const run = runs.workflow_runs.filter(r=>r.path==='.github/workflows/deploy-pages.yml' && r.head_branch==='main').sort((a,b)=>b.id-a.id)[0];
    if (!run || run.status !== 'completed') return null;
    return {ok:run.conclusion==='success',url:run.html_url};
  }
}
