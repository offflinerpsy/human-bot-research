# Dashboard export snapshot

The owner exported `outreach-x-signal-scout` with Cloudflare's official `wrangler init --from-dash` flow and explicitly selected **NO DEPLOY**.

The small `package.json` and `wrangler.jsonc` files in this directory are retained as inspection-only metadata from that export.

## Important

An earlier attempt to store the large `src/index.js` and then the ZIP directly through the ChatGPT GitHub connector was truncated by the connector. Those large direct artifacts are **not canonical and must not be used for deployment**.

The canonical byte-preserving snapshot is now stored under:

`client-acquisition-cloudflare/canonical-source/`

That snapshot consists of seven base64 chunks whose Git blob SHAs were precomputed locally from the exact uploaded archive and matched by GitHub on creation. `CANONICAL_SOURCE_MANIFEST.txt` records the expected ZIP and extracted `src/index.js` hashes. `materialize.sh` reconstructs and verifies them fail-closed before any later build can use the source.

No Cloudflare deployment or configuration mutation was performed during this migration.
