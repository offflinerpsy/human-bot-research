# Canonical Cloudflare Dashboard export snapshot

Exported on 2026-08-11 with Cloudflare's official `wrangler init --from-dash outreach-x-signal-scout` flow. The owner explicitly chose **no deploy** during export.

## Canonical binary artifact

`outreach-x-signal-scout.zip`

- ZIP bytes: `73491`
- ZIP SHA-256: `9c27db026c4cebd609d2ef92badba2b626917c5ec77e8d91d58df43a2e2de98e`
- Git blob SHA: `42d1f84af550cf954ea660e843cd97e5e0c0f5ba`

The ZIP is the canonical immutable transport snapshot. It contains the exact Dashboard-generated project and is preferred over passing the 250 KB Worker source through text-oriented connector calls.

## Source identity inside the ZIP

- `src/index.js`: 250030 bytes; SHA-256 `4797447b9ca654161610679ed91479474cc75dde2c632bcacbe453afc3fe3c65`
- `wrangler.jsonc`: 1728 bytes; SHA-256 `ae098b53c7fc9bd0cf8ab6ac8e0ad1cd45a814e385c921ce349ae21d1ae877c7`
- `package.json`: 243 bytes; SHA-256 `bd426a9d617eee66a7f49d46efcdb86ba52db38248c77dccdd52f009d7a98e62`
- `package-lock.json`: SHA-256 `a1e58c5967df70a26de9236474da4b4154247146920f06f3e12e5f92c6d769e1`

## Runtime identity observed before export

- Cloudflare account ID: `0609100baf768271ea2811c9a9ee2b16`
- Worker: `outreach-x-signal-scout`
- Active deployment: `45818099-f39a-4a7f-a012-7de324efcd29`
- Active version: `36d8640c-0981-43a3-b2ef-33c21ea394b7`
- Scheduler: `[]`

## Secret scan

No secret values were found in the uploaded project. The string `-----BEGIN PRIVATE KEY-----` appears only as source-code logic for parsing a runtime secret; no private-key body/value is present. Runtime secrets remain outside Git.

## Safety / deployment boundary

A prior connector attempt to store `src/index.js` as one oversized text payload produced an invalid Git copy. That standalone path is removed in the corrective commit and MUST NOT be used as source truth.

Do not deploy this snapshot until `wrangler.jsonc` is reconciled against the current frozen production controls. The exported application variable `SCHEDULED_WRITES_ENABLED=true` is not the same control surface as Cloudflare Cron Triggers; the independently verified scheduler remains `[]`.

Permanent target after reconciliation: ChatGPT Web -> GitHub -> Cloudflare Workers Builds -> Worker. No GitHub Actions and no standing Codex/Hermes dependency.
