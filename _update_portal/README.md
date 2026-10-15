# My GLP Labs website update portal

Private request portal for navneetdamani/myglplabs and myglplabs.com. Editors use an exact verified-email GitHub allowlist; the repository owner (GitHub ID 258078742) administers publishing, export and rollback. Editor addresses and credentials are configured privately in Render.

## Existing ChatGPT subscription

AI generation runs on the owner's Windows computer through ChatGPT-authenticated Codex. The hosted service has no paid API inference implementation or API-key fallback. Requests wait while the computer is asleep/offline or the subscription is limited. The owner's ChatGPT credentials stay on that computer, and editors do not receive account access. See LOCAL-WORKER.md for the encrypted credential, job lease, tool restrictions and installation details.

The server accepts a validated proposal from the authenticated local worker, creates a branch and PR, verifies strict main protection and exact-head CI, merges only after successful checks, then tracks the existing deploy-pages.yml workflow. The local model cannot choose GitHub actions, use repository credentials, or authorize its own merge.

## Automatic edit scope

Only content/site-editor.json: thirteen existing marketing headings/captions and two accent colors. React renders escaped text and validated color values. Initial values preserve existing content and appearance. Fixed-schema validation refuses extra keys, markup, links, control characters, oversized copy, clinical/pricing/security keywords and worse button contrast. Application code, clinical/legal text, prices, patient screens, forms, data access, links, assets and infrastructure are protected. Unsupported requests fail closed. This conservative filter does not guarantee editorial quality or detect every inappropriate claim; broader/clinical changes require a separately reviewed developer PR. Do not submit patient details, credentials or other private account data.

## Security and persistence

Secure HttpOnly sessions, OAuth state/PKCE, exact verified email checks, CSRF/origin protections and per-user/global rate limits protect submissions. Removing an email invalidates its access after configuration takes effect; local jobs recheck editor authorization. Idempotency prevents duplicate submissions. The private PostgreSQL audit is hash-linked and append-only, verified at startup and export. Audit export excludes sessions and credentials. An advisory lock and serialized transactions enforce one active server and protect quotas/audit integrity. SQLite is for local tests only; hosted operation requires PostgreSQL and a configured expiry.

The local worker has a separate bearer credential: DPAPI-encrypted on Windows, hash only in Render. The server issues bounded single-use leases and validates every output against its own stored source. The model subprocess receives no broker credential or GitHub/API key. New user requests are capped at five per editor/hour and twenty globally/day; local claims have a further forty/day limit. No automatic paid purchases, API fallback or hosting upgrade are configured.

## Repository and deployment permissions

The GitHub App selects only navneetdamani/myglplabs (repository ID 1350958571). Contents and Pull requests read/write; Actions, Checks, Administration and Metadata read-only. No workflow-write, secrets, account, organization or bypass permission. Short-lived installation tokens are restricted again to that repository. GitHub cannot restrict Contents access to paths, so reviewed broker code and deployment integrity remain essential.

GitHub OAuth is separate, requesting user:email only. The portal origin and callback must match exactly; do not use personal access tokens or share credentials. SETUP_MODE=true exposes only setup/health. AUTO_PUBLISH=false prevents merges during setup/testing. Only LOCAL_WORKER_TOKEN_SHA256 is needed for AI connection; OPENAI_API_KEY and OPENAI_MODEL are unused and must not be used as fallbacks.

Classic main protection must require PRs, the site-checks status explicitly from GitHub Actions app 15368, up-to-date branches and administrator enforcement. Force pushes, deletion and bypass are disabled. Required review count may be zero for authorized automation; stronger existing review rules must not be bypassed. CI checks edit scope, portal security, real PostgreSQL integration and the complete Next.js production build. The broker verifies repository/head/base identities, trusted workflow path/event, successful checks and unchanged main. Merge uses a SHA precondition. The site keeps its Actions-based .github/workflows/deploy-pages.yml Pages deployment. A successful workflow does not independently prove DNS/CDN propagation or editorial correctness; inspect the actual website.

## Free pilot and rollback

The existing free Render web service and PostgreSQL 17 database in Oregon are reused. No paid disk or automatic upgrade. Free-service sleep/usage limits apply. Database expiry is thirty days from provisioning; PILOT_ENDS_AT must be set to the actual expiry minus one day. That cutoff stops submissions, inference dispatch and all worker actions including rollback. Export private records before expiry; JSON export is not a restorable database backup. No backup destination or expiration reminder is configured.

Pause prevents new merges. Administrator rollback is allowed only for the most recent portal deployment while main is still its recorded merge commit. It creates a new checked PR restoring the recorded previous tree, never force-pushes, and leaves publishing paused. Deployment failure also pauses processing. Interrupted generation fails safely; local availability/plan errors defer requests without a paid fallback.

## Acceptance

Before activation verify authenticated sign-in, private history/export, local ChatGPT generation, restricted GitHub access, exact-head CI/protection, successful Pages deployment, a harmless formatting-only publish, and checked rollback. The owner must approve publishing. Use SETUP_MODE and AUTO_PUBLISH to keep incomplete deployments closed. Keep credentials out of Git, chat, screenshots and logs.
