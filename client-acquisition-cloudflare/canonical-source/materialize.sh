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

if [ -f "$ROOT/RUN_V2_001_PERCENT_CANARY_ONCE" ]; then
  ACCOUNT_ID="0609100baf768271ea2811c9a9ee2b16"
  SCRIPT_NAME="outreach-x-signal-scout"
  API_ROOT="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers"
  TOKEN="${CLOUDFLARE_API_TOKEN:-}"
  [ -n "$TOKEN" ] || { echo "ACQ2_CLOUDFLARE_BUILD_TOKEN_MISSING" >&2; exit 21; }

  PRE_DEPLOY="$ROOT/.acq2-pre-deploy.json"
  WORKER_SUBDOMAIN="$ROOT/.acq2-worker-subdomain.json"
  ACCOUNT_SUBDOMAIN="$ROOT/.acq2-account-subdomain.json"
  UPLOAD_OUT="$ROOT/.acq2-version-upload.jsonl"
  SPLIT_OUT="$ROOT/.acq2-split-deployment.json"
  HEALTH_OUT="$ROOT/.acq2-health.json"
  CANARY_OUT="$ROOT/.acq2-canary.json"
  ROLLBACK_OUT="$ROOT/.acq2-rollback.json"
  rm -f "$PRE_DEPLOY" "$WORKER_SUBDOMAIN" "$ACCOUNT_SUBDOMAIN" "$UPLOAD_OUT" "$SPLIT_OUT" "$HEALTH_OUT" "$CANARY_OUT" "$ROLLBACK_OUT"

  curl -fsS "$API_ROOT/scripts/$SCRIPT_NAME/deployments" -H "Authorization: Bearer $TOKEN" > "$PRE_DEPLOY"
  OLD_VERSION="$(node - "$PRE_DEPLOY" <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const deployments = p?.result?.deployments || [];
const active = deployments[0];
if (!p.success || !active || !Array.isArray(active.versions) || active.versions.length !== 1) {
  console.error('ACQ2_PREDEPLOY_TOPOLOGY_UNSAFE'); process.exit(22);
}
const v = active.versions[0];
if (!v.version_id || Math.abs(Number(v.percentage) - 100) > 0.0001) {
  console.error('ACQ2_PREDEPLOY_NOT_SINGLE_100'); process.exit(23);
}
process.stdout.write(String(v.version_id));
NODE
)"

  curl -fsS "$API_ROOT/scripts/$SCRIPT_NAME/subdomain" -H "Authorization: Bearer $TOKEN" > "$WORKER_SUBDOMAIN"
  node - "$WORKER_SUBDOMAIN" <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!p.success || p?.result?.enabled !== true) {
  console.error('ACQ2_WORKERS_DEV_DISABLED'); process.exit(24);
}
NODE

  curl -fsS "$API_ROOT/subdomain" -H "Authorization: Bearer $TOKEN" > "$ACCOUNT_SUBDOMAIN"
  SUBDOMAIN="$(node - "$ACCOUNT_SUBDOMAIN" <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const value = p?.result?.subdomain;
if (!p.success || !value) { console.error('ACQ2_ACCOUNT_SUBDOMAIN_MISSING'); process.exit(25); }
process.stdout.write(String(value));
NODE
)"
  TARGET="https://${SCRIPT_NAME}.${SUBDOMAIN}.workers.dev"

  WRANGLER_OUTPUT_FILE_PATH="$UPLOAD_OUT" npx wrangler@4.121.0 versions upload --config "$ROOT/wrangler.canary.jsonc" --message "ACQ2 bounded 0.01-percent smoke canary"
  CANARY_VERSION="$(node - "$UPLOAD_OUT" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
if (!fs.existsSync(path)) { console.error('ACQ2_CANARY_OUTPUT_MISSING'); process.exit(26); }
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
let version = '';
for (const line of lines) {
  let p; try { p = JSON.parse(line); } catch { continue; }
  if (p.type === 'version-upload' && p.version_id) version = String(p.version_id);
}
if (!version) { console.error('ACQ2_CANARY_VERSION_ID_MISSING'); process.exit(27); }
process.stdout.write(version);
NODE
)"
  [ "$CANARY_VERSION" != "$OLD_VERSION" ] || { echo "ACQ2_CANARY_VERSION_COLLISION" >&2; exit 28; }

  CANARY_DEPLOYMENT_CREATED=0
  rollback() {
    if [ "$CANARY_DEPLOYMENT_CREATED" != "1" ]; then return 0; fi
    local body current
    body="$(node - "$OLD_VERSION" <<'NODE'
const old = process.argv[2];
process.stdout.write(JSON.stringify({
  strategy: 'percentage',
  versions: [{ percentage: 100, version_id: old }],
  annotations: { 'workers/message': 'ACQ2 bounded smoke canary rollback', 'workers/triggered_by': 'deployment' }
}));
NODE
)"
    curl -fsS -X POST "$API_ROOT/scripts/$SCRIPT_NAME/deployments" \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      --data "$body" > "$ROLLBACK_OUT" || return 81
    node - "$ROLLBACK_OUT" <<'NODE' || return 82
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!p.success) process.exit(1);
NODE
    current="$(curl -fsS "$API_ROOT/scripts/$SCRIPT_NAME/deployments" -H "Authorization: Bearer $TOKEN")" || return 83
    node - "$OLD_VERSION" "$current" <<'NODE' || return 84
const old = process.argv[2];
const p = JSON.parse(process.argv[3]);
const active = (p?.result?.deployments || [])[0];
if (!active || active.versions?.length !== 1 || active.versions[0]?.version_id !== old || Math.abs(Number(active.versions[0]?.percentage) - 100) > 0.0001) process.exit(1);
NODE
  }
  on_exit() {
    local rc=$?
    trap - EXIT
    if [ "$CANARY_DEPLOYMENT_CREATED" = "1" ]; then
      if ! rollback; then echo "ACQ2_CRITICAL_ROLLBACK_FAILED" >&2; exit 91; fi
    fi
    exit "$rc"
  }
  trap on_exit EXIT

  SPLIT_BODY="$(node - "$OLD_VERSION" "$CANARY_VERSION" <<'NODE'
const old = process.argv[2], canary = process.argv[3];
process.stdout.write(JSON.stringify({
  strategy: 'percentage',
  versions: [
    { percentage: 99.99, version_id: old },
    { percentage: 0.01, version_id: canary }
  ],
  annotations: { 'workers/message': 'ACQ2 bounded 0.01-percent smoke canary', 'workers/triggered_by': 'deployment' }
}));
NODE
)"
  curl -fsS -X POST "$API_ROOT/scripts/$SCRIPT_NAME/deployments" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data "$SPLIT_BODY" > "$SPLIT_OUT"
  CANARY_DEPLOYMENT_CREATED=1
  node - "$OLD_VERSION" "$CANARY_VERSION" "$SPLIT_OUT" <<'NODE'
const fs = require('fs');
const old = process.argv[2], canary = process.argv[3];
const p = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
if (!p.success) { console.error('ACQ2_SPLIT_DEPLOYMENT_API_FAILED'); process.exit(29); }
const versions = p?.result?.versions || [];
const a = versions.find(v => v.version_id === old), b = versions.find(v => v.version_id === canary);
if (!a || !b || Math.abs(Number(a.percentage) - 99.99) > 0.0001 || Math.abs(Number(b.percentage) - 0.01) > 0.0001) {
  console.error('ACQ2_SPLIT_DEPLOYMENT_WEIGHTS_INVALID'); process.exit(30);
}
NODE

  sleep 3
  OVERRIDE_HEADER="${SCRIPT_NAME}=\"${CANARY_VERSION}\""
  HEALTH_CODE="$(curl --max-time 30 -sS -o "$HEALTH_OUT" -w '%{http_code}' "$TARGET/client-acquisition-v2/health" \
    -H "Cloudflare-Workers-Version-Overrides: $OVERRIDE_HEADER" -H 'Accept: application/json')"
  [ "$HEALTH_CODE" = "200" ] || { echo "ACQ2_HEALTH_HTTP_$HEALTH_CODE" >&2; exit 31; }
  node - "$CANARY_VERSION" "$HEALTH_OUT" <<'NODE'
const fs = require('fs'), expected = process.argv[2];
const p = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (p.workerVersion !== expected) { console.error('ACQ2_VERSION_OVERRIDE_NOT_APPLIED'); process.exit(32); }
if (p.suppressionContract !== 'PASS') { console.error('ACQ2_SUPPRESSION_SELFTEST_FAILED'); process.exit(33); }
if (p.manualAuthConfigured !== true) { console.error('ACQ2_MANUAL_AUTH_NOT_CONFIGURED'); process.exit(34); }
if (p.stagingWrite !== 'armed_token_protected') { console.error('ACQ2_CANARY_WRITE_NOT_ARMED'); process.exit(35); }
NODE

  CANARY_CODE="$(curl --max-time 120 -sS -o "$CANARY_OUT" -w '%{http_code}' "$TARGET/__acq2_smoke_canary_9f5c2e7a1d4b6c8e3f0a5b7d2c9e4f61" \
    -H "Cloudflare-Workers-Version-Overrides: $OVERRIDE_HEADER" -H 'Accept: application/json')"
  [ "$CANARY_CODE" = "200" ] || { echo "ACQ2_CANARY_HTTP_$CANARY_CODE" >&2; exit 36; }
  CANARY_STATUS="$(node - "$CANARY_OUT" <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const allowed = new Set(['READY_FOR_GPT_WRITTEN','CANARY_NO_PROMOTION','CANARY_IDEMPOTENT_EXISTING']);
if (!allowed.has(String(p.status || ''))) {
  console.error(`ACQ2_CANARY_UNACCEPTED_STATUS_${String(p.status || 'MISSING')}`); process.exit(37);
}
process.stdout.write(String(p.status));
NODE
)"

  rollback
  CANARY_DEPLOYMENT_CREATED=0
  trap - EXIT
  echo "ACQ2_001_PERCENT_CANARY_PASS status=$CANARY_STATUS old=$OLD_VERSION canary=$CANARY_VERSION"
fi
