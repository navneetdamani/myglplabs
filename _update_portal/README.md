# My GLP Labs website update portal

Private request portal for `navneetdamani/myglplabs`, separate from the public GitHub Pages website. This service uses a tool-less OpenAI coding step to propose complete file edits. The model cannot execute commands, browse URLs, access credentials, call GitHub, merge, or change its policy. Trusted application code validates each edit, creates the branch and pull request, verifies checks, and merges through GitHub's protected-branch API.

## Supported automatic changes

Only `content/site-editor.json`: thirteen marketing headings/captions and two accent colors. The website imports these values as escaped React text and validated CSS color values. Initial values preserve the existing appearance. The schema is fixed; new keys, markup, links, control characters, oversized copy, clinical/pricing/security keywords and colors with worse button contrast are refused. Application code, clinical text, safety/legal notices, pricing, intake, patient screens, data access, forms, links, assets and infrastructure are outside automatic edit scope. Broader changes need a separately reviewed developer PR. The keyword filter is conservative and is not a substitute for clinical/editorial review of claims.

The policy reduces prompt-injection authority through fixed tools and edit permissions. It is not a claim that an AI can recognize every malicious instruction or guarantee editorial quality. Authorized editors can change public copy and styling. All allowed files and request text are sent to the configured OpenAI API project; no credentials or private request history are sent. `store:false` is set; the API account's applicable data-retention terms still apply.

## Approved free pilot

`render.yaml` defines one **free** Docker web service and one **free Render PostgreSQL 17** database, both in Oregon. There is no paid persistent disk. The public website stays on its existing GitHub Pages deployment. Use the assigned HTTPS Render URL initially; a custom subdomain requires separate DNS setup. The owner approved a 30-day free pilot. OpenAI inference is separately metered, and Render's bandwidth/build limits still apply; this is not a promise of unlimited free usage.

The portal starts with **`SETUP_MODE=true` and `AUTO_PUBLISH=false`**. Setup mode serves only a locked setup page and health endpoint; login, requests and publishing are unavailable. All private records, sessions, quotas and audit events use `DATABASE_URL` after activation. No SQLite fallback is permitted for the hosted pilot. SQLite remains available for local tests only. A PostgreSQL advisory lock enforces exactly one active instance per database, and asynchronous transactions serialize quotas and audit-chain updates.

Free web services sleep after fifteen minutes without inbound traffic, so processing can pause until the next visit. The app does not use artificial keep-alive traffic. Queued/checking/deploying requests resume from durable PostgreSQL state; interrupted planning fails safely for review. **Free PostgreSQL expires thirty days after provisioning**, regardless of whether setup is complete. The service sets `PILOT_ENDS_AT` to one day before that expiry and then rejects new requests and stops all worker actions, including rollback. Set this from the actual database expiry, not from the activation date. Export records before the database expires. No automatic paid upgrade or renewal is configured.

## Account setup and essential permissions

1. The free pilot and workspace were approved. Keep automatic publishing disabled until credentials, branch protection and live acceptance tests are verified; do not merge this implementation into main merely to serve the pilot setup page. Direct service creation can deploy the review branch without changing the public website.
2. Create a GitHub OAuth App. Homepage: the portal HTTPS origin. Callback: `https://YOUR-PORTAL/auth/callback`. The app requests only `user:email`, never repository scope. Enter its client ID and secret only in Render secret settings. Editors sign in using a GitHub account containing an **exact, verified** allowlisted email address. No Gmail password or inbox access is required.
3. Create a dedicated GitHub App and install it on **only `navneetdamani/myglplabs`**. Repository permissions: Contents **read/write**, Pull requests **read/write**, Checks **read**, Actions **read**, Administration **read**, and implicit Metadata **read**. No organization, account, workflows-write, administration-write, secrets or deployments permissions. Webhooks are unnecessary. Keep it out of all branch-rule bypass lists. The server signs short-lived installation tokens restricted again to repository ID `1350958571` and these permissions. Never use a personal access token.
4. Enter the GitHub App ID, installation ID and RSA private key as Render secrets. Newlines may be real or escaped `\n`. Installations cannot narrow Contents permission to paths; the application edit validator is the path boundary. Keep its code and deployment trusted and reviewed.
5. Create a restricted OpenAI project service-account API key with access to Responses inference and the chosen model only; configure the project budget/alerts and model limits in the platform. Enter `OPENAI_API_KEY` and an available structured-output-capable `OPENAI_MODEL` as Render secrets. Do not enter secrets into Git, this chat, requests, screenshots, logs, or workflow files. The app imposes five requests per editor per hour and twenty requests globally per rolling daily window, with one inference call per request and an output token cap; provider budgets and pricing must be configured separately.
6. Set `PORTAL_ORIGIN` to the exact HTTPS origin with no trailing slash; `ALLOWED_EMAILS` to the approved comma-separated email list. The initial administrator is repository owner GitHub ID `258078742`. Review that identity before deployment; administrator changes require reviewed source/config changes. Removing an allowlisted email invalidates its sessions on the next request after config takes effect. Sessions expire after eight hours. To revoke all sessions immediately, delete their rows using a trusted service shell.
7. Use the existing free database and free service in the confirmed workspace, or use the Blueprint for a fresh deployment after reviewing its resource bindings. Do not create a second free database: Render permits only one per workspace. Set `DATABASE_URL` from the database's **internal connection URL** in Render secret settings; never paste it in chat. The external connection URL requires verified TLS; the same-region internal endpoint uses Render's private network. The Blueprint uses `fromDatabase` to inject the internal URL without committing credentials. Set `PILOT_ENDS_AT` to the actual expiry minus one day. Verify all settings, then set `SETUP_MODE=false` to enable authenticated login. Keep `AUTO_PUBLISH=false` until the publishing checks below pass. Source files stay root-owned and the container runs as user `node`.

## Required protected-branch setup

After this workflow is on main and has run, configure **classic branch protection** for `main`:

- Require pull requests before merging. Set required approving reviews to zero for this automation, or use a separate review workflow and accept that automatic merges wait for it.
- Require status check **`site-checks`**, explicitly from the **GitHub Actions** app (ID `15368`). Require branches to be up to date before merging.
- Enforce rules for administrators; do not grant the portal app bypass permission. Disable force pushes and branch deletion. Restrict direct pushes if the repository plan supports it.
- Keep the existing Actions-based Pages source and `.github/workflows/deploy-pages.yml` deployment workflow. Ensure squash merging is allowed. CI builds the full Next.js static export as well as testing portal security and edit scope. The broker tracks successful completion of that exact deployment workflow for the merged commit. GitHub's native auto-merge setting can remain off: this service explicitly calls the merge API only after its gate passes.

The server reads branch protection through the app's read-only Administration permission and refuses automatic merging if strict required checks, the expected check source or administrator enforcement are absent. Rulesets alone do not satisfy this implementation's classic-protection verification. The current chat GitHub connector could not read the repository's protection settings; they are **unverified** until an administrator configures them and the deployed app confirms them.

Each merge gate checks the expected PR, branch, repository, main branch SHA, head SHA, check-run app identity, workflow path and event, run SHA, successful conclusions, and mergeability. The merge API supplies the checked head SHA; strict GitHub protection closes concurrent-base-change races. Missing, pending, skipped, cancelled, failed, ambiguous or untrusted checks never count as success. Changes to main while a request is pending cause a safe failure and require resubmission.

## Verification before enabling publishing

Use `pnpm@11.25.0 install --frozen-lockfile --ignore-scripts`, then `node --test test/*.test.mjs` and `node check-site.mjs` from this directory on Node 24.19.0. CI uses pinned action commits, read-only repository access and no secrets. Automated website PRs additionally compare every changed file against their base under the edit policy.

Before setting `AUTO_PUBLISH=true`, test on a non-production repository with its own installation and adjusted hard-coded repository/identity constants:

1. Authorized verified-email login succeeds; other accounts and unverified emails fail. Confirm OAuth callback and session cookies on real HTTPS.
2. A harmless copy request produces the expected branch/PR; public PR title/body contain only the opaque request ID. Confirm rejected HTML/script/workflow edits never publish.
3. Failed or pending CI, missing protection, changed PR head and stale main prevent merging. Re-run the genuine CI check to test recovery.
4. Enable automatic publishing only after approval, then test a harmless update end to end through CI, merge and Pages. Deployment status currently means successful GitHub Pages workflow completion; it does not guarantee website correctness or independently verify DNS/CDN propagation. Review the actual site.
5. Exercise administrator pause, restart persistence and latest-update rollback. Verify the public site returns to the prior content and the portal stays paused afterwards.

Local tests use mocked GitHub/OpenAI responses and a real temporary HTTP server/SQLite database. CI additionally provisions a disposable PostgreSQL 17 service and runs persistence, concurrent-quota, append-only audit, SQL compatibility and single-worker-lock integration tests against it. Local PostgreSQL tests run only with `PG_TEST_URL` pointing to an isolated database named `portal_test`; never use the hosted pilot database for destructive tests. Tests do not substitute for actual OAuth, live inference, branch protection or Pages acceptance testing.

## Pause, rollback and recovery

The administrator can pause merges or request rollback from history. Rollback is permitted only when `main` is still exactly the recorded merged commit, and no other change is active. It creates a new PR restoring the previous tree, runs the same checks, and goes through the protected merge gate. It never force-pushes or resets main. New normal requests stay paused until an administrator resumes publishing. Rollback still needs `AUTO_PUBLISH=true`; if disabled, it waits for approved activation or a manual reviewed merge.

A failed/timed-out Pages workflow pauses publishing and marks the deployment failed. The administrator must explicitly request rollback; automatic rollback on a transient deployment failure is intentionally not enabled. If main has advanced, a developer must prepare a targeted revert and check it rather than overwrite newer work. If Pages itself is unavailable, a revert cannot restore the serving layer until Pages recovers.

The worker reconciles an uncertain merge from PR state before further merging. Interrupted planning fails safely and may leave an orphan branch/PR for administrator review. Do not resubmit blindly after a crash: inspect history and GitHub first. Checks time out after one hour and deployments after thirty minutes. API failures fail closed; no retries bypass policy.

## Audit, backups and operations

Audit events are append-only through database triggers and hash-linked, with integrity verification on startup. PostgreSQL blocks UPDATE, DELETE and TRUNCATE of audit records. The administrator can download the most recent 500 events or use **Export all records** (`GET /api/export`) for a consistent JSON snapshot of all requests, the full audit chain and settings. The snapshot excludes session/OAuth tokens and credentials. Store exports privately and externally retain the latest audit hash to detect truncation. A database administrator can replace the database and hash chain; this is not externally immutable storage.

Requests contain private text at rest in PostgreSQL; Render account and database administrator access remain sensitive. Session tokens are hashed; OAuth tokens are not persisted. Logs omit request bodies, credentials, OAuth codes and upstream error bodies. Keep dashboard/request-URL access restricted because OAuth authorization codes can appear in provider access logs. Rotate app keys, OAuth secrets and API keys after suspected exposure.

Free Render PostgreSQL has no managed backups. Export all private records **before expiry**, and use `pg_dump` through a securely configured external database connection for a restorable PostgreSQL backup. The Blueprint disables external IP access by default; an administrator must temporarily allow the specific backup client's IP if using external pg_dump. The direct-created pilot's database network settings must also be reviewed before activation. A JSON export preserves records but is not a complete database image or an automatic restore workflow. Back up before upgrades; revoke old sessions/OAuth state and reconcile active requests against GitHub before resuming restored data. No backup destination or paid upgrade is provisioned.

Dependencies and Docker base image versions are pinned by package lock or version tag; schedule reviewed security updates. Docker and CI PostgreSQL image tags are not digest-pinned. A hosted container build/smoke test and real OAuth/inference tests are required before activation. There is no external alerting integration: the dashboard records failures and pauses, so an operator must monitor it and export before expiry. No notifications, expiration reminders, keep-alive pings or paid renewals are automatically scheduled.

## Reference documentation

- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI agent credential boundaries](https://developers.openai.com/api/docs/guides/agents-api/environments/security)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks), [pricing](https://render.com/pricing)
