# Dashboard export snapshot

Exported from Cloudflare Dashboard using Wrangler `init --from-dash outreach-x-signal-scout` on 2026-08-11. No deploy was performed during export.

## Identity
- Worker: `outreach-x-signal-scout`
- Cloudflare account observed during export: `Offflinerpsy@gmail.com's Account`
- Prior runtime verification account ID: `0609100baf768271ea2811c9a9ee2b16`
- Prior active version: `36d8640c-0981-43a3-b2ef-33c21ea394b7`
- Scheduler was independently verified as `[]` before this manual export.

## Committed runtime files
- `src/index.js` — SHA-256 `4797447b9ca654161610679ed91479474cc75dde2c632bcacbe453afc3fe3c65` — 250030 bytes
- `wrangler.jsonc` — SHA-256 `ae098b53c7fc9bd0cf8ab6ac8e0ad1cd45a814e385c921ce349ae21d1ae877c7` — 1728 bytes
- `package.json` — SHA-256 `bd426a9d617eee66a7f49d46efcdb86ba52db38248c77dccdd52f009d7a98e62` — 243 bytes

## Exported but intentionally not required for first source snapshot
- `package-lock.json` — SHA-256 `a1e58c5967df70a26de9236474da4b4154247146920f06f3e12e5f92c6d769e1`
- `.editorconfig`, `.prettierrc`, `AGENTS.md`, generated `.gitignore`

## Secret scan
No secret values were found in the uploaded project. The literal text `-----BEGIN PRIVATE KEY-----` exists only inside source code that parses a runtime private-key secret; no PEM body/value is present. Runtime secret values remain outside Git.

## Safety
This directory is a source-of-truth snapshot only. Do not deploy it until the exported `wrangler.jsonc` bindings/vars are reconciled against current Cloudflare production state and the migration freeze rules. In particular, the exported file contains `SCHEDULED_WRITES_ENABLED=true`, while the Cloudflare scheduler was independently verified as `[]`; those are different control surfaces and must not be conflated.
