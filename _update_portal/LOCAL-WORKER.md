# Subscription-backed local worker

The hosted portal collects authorized website requests and manages GitHub checks, merge, deployment, audit and rollback. AI generation runs on the owner's Windows computer using the installed Codex CLI signed in with ChatGPT. The production server has no paid API inference implementation. There is no fallback to an OpenAI API key, automatic credit purchase, or account sharing with editors.

Requests wait while the computer is off/asleep/disconnected or Codex is unavailable/limited. The local process polls once per minute while running. Plan usage is shared with the owner's other Codex activity. Free Render and database expiry limits still apply. No hosting upgrade is authorized.

## Authentication and boundaries

- A random local worker credential is encrypted with Windows DPAPI CurrentUser and stored in a directory whose inherited access is removed; only the owner and SYSTEM have access. Render stores only its SHA-256 hash in LOCAL_WORKER_TOKEN_SHA256. The plaintext is never stored in a repository, passed to the model, or logged.
- Worker HTTPS endpoints use bearer authentication, bounded rate limits, short-lived single-use job leases, exact target/authorization checks, and server-side proposal validation. An editor's browser session cannot use worker endpoints. Revoked editors and requests for other targets are refused.
- The generator receives only the request and public marketing JSON. Its child environment excludes API keys, GitHub credentials, the worker credential, and other application environment values. Codex uses its existing protected ChatGPT sign-in with forced_login_method=chatgpt.
- Each generation uses a fresh temporary directory, read-only sandbox, no user config or rules, and disabled shell, browser/computer, apps, plugins, hooks, web search, memory, collaboration, image and dependency tools. Unexpected tool items invalidate the result. The broker independently validates the JSON before writing GitHub changes. Temporary schema/output files are removed afterward.
- GitHub App credentials stay in Render. The local worker cannot choose the repository, modify workflows, merge a branch, bypass CI or change its own permissions through the job protocol.

## Installation

Run the reviewed init-local-worker.ps1 with an installation directory, portal origin, Codex executable path and source directory. On systems that block local scripts, use only the specifically approved process-scoped RemoteSigned policy; do not change machine/user execution policy. The setup emits only the worker hash and configuration path. Save the hash in Render and retain SETUP_MODE=true until configuration is verified.

The protected installation contains local-worker.mjs, local-generator.mjs, policy.mjs, unlock-worker.ps1 and worker-config.json. Start node with local-worker.mjs and the configuration path. --once performs one claim cycle. A per-user, least-privilege Windows scheduled task can start it at sign-in; it must use the owner's interactive account so ChatGPT authentication and DPAPI remain available. Do not configure the task with a stored password or run it as SYSTEM.

To stop processing, stop/disable that task or pause publishing in the portal. To revoke the local worker, clear or rotate LOCAL_WORKER_TOKEN_SHA256 in Render; no editor or website access needs to change. Keep the installation until a replacement is tested. No ChatGPT password or session token is copied to Render or shared with Deepak.
