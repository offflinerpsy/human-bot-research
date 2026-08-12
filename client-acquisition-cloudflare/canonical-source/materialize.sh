#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$ROOT/outreach-x-signal-scout.zip"
OUT="$ROOT/worktree"
EXPECTED_ZIP_BYTES="73491"
EXPECTED_ZIP_SHA="9c27db026c4cebd609d2ef92badba2b626917c5ec77e8d91d58df43a2e2de98e"
EXPECTED_INDEX_BYTES="250030"
EXPECTED_INDEX_SHA="4797447b9ca654161610679ed91479474cc75dde2c632bcacbe453afc3fe3c65"

cat "$ROOT"/chunks/part-*.b64 | tr -d '\r\n' | base64 --decode > "$ZIP"
actual_zip_bytes="$(wc -c < "$ZIP" | tr -d ' ')"
[ "$actual_zip_bytes" = "$EXPECTED_ZIP_BYTES" ] || { echo "ZIP byte mismatch: $actual_zip_bytes" >&2; exit 11; }
echo "$EXPECTED_ZIP_SHA  $ZIP" | sha256sum -c -

rm -rf "$OUT"
mkdir -p "$OUT"
unzip -q "$ZIP" -d "$OUT"
INDEX="$OUT/outreach-x-signal-scout/src/index.js"
actual_index_bytes="$(wc -c < "$INDEX" | tr -d ' ')"
[ "$actual_index_bytes" = "$EXPECTED_INDEX_BYTES" ] || { echo "index.js byte mismatch: $actual_index_bytes" >&2; exit 12; }
echo "$EXPECTED_INDEX_SHA  $INDEX" | sha256sum -c -

echo "CANONICAL_SOURCE_MATERIALIZE_PASS"

if [ -f "$ROOT/RUN_V2_DOFREE_PREVIEW_CANARY_ONCE" ]; then
  SOURCE="$ROOT/v2-entry-v3.js"
  STANDALONE="$ROOT/v2-preview-standalone.js"
  TEMPLATE="$ROOT/wrangler.preview.template.jsonc"
  RUNTIME_CONFIG="$ROOT/wrangler.preview.runtime.jsonc"
  OUTPUT="$ROOT/.acq2-preview-upload.jsonl"
  HEALTH_OUT="$ROOT/.acq2-preview-health.json"
  CANARY_OUT="$ROOT/.acq2-preview-canary.json"
  PREVIEW_ALIAS="acq2v2smoke"
  SCRIPT_NAME="outreach-x-signal-scout"
  ACCOUNT_ID="0609100baf768271ea2811c9a9ee2b16"

  [ -f "$SOURCE" ] && [ -f "$TEMPLATE" ] || { echo "ACQ2_PREVIEW_INPUT_MISSING" >&2; exit 41; }

  grep -v -E 'legacyWorker|LegacyOpsTelemetry' "$SOURCE" > "$STANDALONE"
  if grep -q -E 'legacyWorker|LegacyOpsTelemetry|OpsTelemetry' "$STANDALONE"; then
    echo "ACQ2_DOFREE_TRANSFORM_FAILED" >&2
    exit 42
  fi
  grep -q 'client-acquisition-v2/run' "$STANDALONE" || { echo "ACQ2_STANDALONE_RUN_ROUTE_MISSING" >&2; exit 43; }
  grep -q 'client-acquisition-v2/health' "$STANDALONE" || { echo "ACQ2_STANDALONE_HEALTH_ROUTE_MISSING" >&2; exit 44; }

  NONCE="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
  EXPIRES="$(( $(date +%s) + 300 ))"
  sed -e "s/__ACQ2_CANARY_TOKEN__/$NONCE/g" -e "s/__ACQ2_CANARY_EXPIRES_AT__/$EXPIRES/g" "$TEMPLATE" > "$RUNTIME_CONFIG"
  if grep -q '__ACQ2_' "$RUNTIME_CONFIG"; then
    echo "ACQ2_PREVIEW_CONFIG_SUBSTITUTION_FAILED" >&2
    exit 45
  fi

  rm -f "$OUTPUT" "$HEALTH_OUT" "$CANARY_OUT"
  WRANGLER_OUTPUT_FILE_PATH="$OUTPUT" npx wrangler@4.121.0 versions upload --config "$RUNTIME_CONFIG" --preview-alias "$PREVIEW_ALIAS" --message "ACQ2 corrected DO-free preview smoke canary"

  readarray -t META < <(node - "$OUTPUT" "$PREVIEW_ALIAS" <<'NODE'
const fs = require('fs');
const path = process.argv[2], alias = process.argv[3];
if (!fs.existsSync(path)) { console.error('ACQ2_PREVIEW_OUTPUT_MISSING'); process.exit(46); }
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
let version = '';
const strings = [];
function walk(v) {
  if (typeof v === 'string') { strings.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) walk(x); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
}
for (const line of lines) {
  let p; try { p = JSON.parse(line); } catch { continue; }
  walk(p);
  if (p.type === 'version-upload' && p.version_id) version = String(p.version_id);
}
if (!version) { console.error('ACQ2_PREVIEW_VERSION_ID_MISSING'); process.exit(47); }
const urls = strings.filter(x => /^https:\/\//i.test(x) && /workers\.dev/i.test(x));
const preferred = urls.find(x => x.toLowerCase().includes(alias.toLowerCase())) || urls[0] || '';
process.stdout.write(version + '\n' + preferred + '\n');
NODE
)
  CANARY_VERSION="${META[0]:-}"
  PREVIEW_URL="${META[1]:-}"
  [ -n "$CANARY_VERSION" ] || { echo "ACQ2_PREVIEW_VERSION_PARSE_FAILED" >&2; exit 48; }

  if [ -z "$PREVIEW_URL" ]; then
    TOKEN="${CLOUDFLARE_API_TOKEN:-}"
    [ -n "$TOKEN" ] || { echo "ACQ2_PREVIEW_URL_AND_BUILD_TOKEN_MISSING" >&2; exit 49; }
    SUBDOMAIN_JSON="$(curl -fsS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "Authorization: Bearer $TOKEN")"
    SUBDOMAIN="$(node - "$SUBDOMAIN_JSON" <<'NODE'
const p = JSON.parse(process.argv[2]);
const value = p?.result?.subdomain;
if (!p.success || !value) { console.error('ACQ2_ACCOUNT_SUBDOMAIN_MISSING'); process.exit(50); }
process.stdout.write(String(value));
NODE
)"
    PREVIEW_URL="https://${PREVIEW_ALIAS}-${SCRIPT_NAME}.${SUBDOMAIN}.workers.dev"
  fi
  PREVIEW_URL="${PREVIEW_URL%/}"

  HEALTH_CODE="$(curl --max-time 45 -sS -o "$HEALTH_OUT" -w '%{http_code}' "$PREVIEW_URL/client-acquisition-v2/health" \
    -H "x-acq2-canary-token: $NONCE" -H 'Accept: application/json')"
  [ "$HEALTH_CODE" = "200" ] || { echo "ACQ2_PREVIEW_HEALTH_HTTP_$HEALTH_CODE" >&2; exit 51; }
  node - "$CANARY_VERSION" "$HEALTH_OUT" <<'NODE'
const fs = require('fs'), expected = process.argv[2];
const p = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (p.workerVersion !== expected) { console.error('ACQ2_PREVIEW_VERSION_MISMATCH'); process.exit(52); }
if (p.suppressionContract !== 'PASS') { console.error('ACQ2_PREVIEW_SUPPRESSION_SELFTEST_FAILED'); process.exit(53); }
if (p.manualAuthConfigured !== true) { console.error('ACQ2_PREVIEW_MANUAL_AUTH_NOT_CONFIGURED'); process.exit(54); }
if (p.stagingWrite !== 'armed_token_protected') { console.error('ACQ2_PREVIEW_WRITE_NOT_ARMED'); process.exit(55); }
NODE

  CANARY_CODE="$(curl --max-time 120 -sS -o "$CANARY_OUT" -w '%{http_code}' "$PREVIEW_URL/__acq2_preview_smoke_7c9142e86b0d4f12a3f5c978e6d1b420" \
    -H "x-acq2-canary-token: $NONCE" -H 'Accept: application/json')"
  [ "$CANARY_CODE" = "200" ] || { echo "ACQ2_PREVIEW_CANARY_HTTP_$CANARY_CODE" >&2; exit 56; }
  CANARY_STATUS="$(node - "$CANARY_OUT" <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const allowed = new Set(['READY_FOR_GPT_WRITTEN','CANARY_NO_PROMOTION','CANARY_IDEMPOTENT_EXISTING']);
if (!allowed.has(String(p.status || ''))) {
  console.error(`ACQ2_PREVIEW_UNACCEPTED_STATUS_${String(p.status || 'MISSING')}`); process.exit(57);
}
process.stdout.write(String(p.status));
NODE
)"
  echo "ACQ2_DOFREE_PREVIEW_CANARY_PASS status=$CANARY_STATUS version=$CANARY_VERSION"
fi
