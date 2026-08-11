# Workers Builds cutover — fail-closed settings

This directory is the Git root for the verified `outreach-x-signal-scout` snapshot.

## Cloudflare connection target
- Existing Worker: `outreach-x-signal-scout`
- Repository: `offflinerpsy/human-bot-research`
- Root directory: `client-acquisition-cloudflare/canonical-source`

## Initial build settings
- Build command: `bash ./materialize.sh`
- Deploy command: `npx wrangler@4.121.0 versions upload --config ./wrangler.safe.jsonc`
- Non-production deploy command: same `versions upload` command

Do NOT use `wrangler deploy` during cutover. `versions upload` creates a version without promoting it to the active production deployment.

## Safety state in wrangler.safe.jsonc
- `DRY_RUN=true`
- `SCHEDULED_WRITES_ENABLED=false`
- `SCHEDULED_WRITE_SOURCES=""`
- `triggers.crons=[]`
- `keep_vars=true`
- KV binding: `OUTREACH_SCOUT_STATE` → `8dfe48a6e81443e9b24f50a14e62ecb7`
- Durable Object binding: `OPS_TELEMETRY` → class `OpsTelemetry`

The existing encrypted Cloudflare secrets are not stored in Git. Do not add secret values to this repository.

## Promotion gate
A production deployment is forbidden until the uploaded version passes source hash verification, bindings/config verification, regression checks, and the bounded CLIENT ACQUISITION V2 canary gate. The live cron schedule must remain empty until explicitly reopened.

## Connection status
- 2026-08-11: Owner confirmed Cloudflare Workers Builds connection completed.
- This commit intentionally acts as the first post-connection build trigger.
- Expected outcome: materialize PASS + `versions upload` only; no production promotion.
