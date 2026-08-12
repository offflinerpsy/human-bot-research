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

# One-time, marker-gated canary. `wrangler dev --remote` uploads code only to a
# temporary Cloudflare preview environment; it does not promote the Worker.
# The marker is committed only for the bounded canary build and removed after
# its receipt is inspected. Normal builds never enter this branch.
if [ -f "$ROOT/RUN_V2_REMOTE_CANARY_ONCE" ]; then
  CANARY_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
  HEALTH_FILE="$(mktemp)"
  RESPONSE_FILE="$(mktemp)"
  DEV_LOG="$(mktemp)"

  cleanup_canary() {
    if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
      kill "$DEV_PID" 2>/dev/null || true
      wait "$DEV_PID" 2>/dev/null || true
    fi
    rm -f "$HEALTH_FILE" "$RESPONSE_FILE" "$DEV_LOG"
  }
  trap cleanup_canary EXIT

  npx wrangler@4.121.0 dev --remote \
    --config "$ROOT/wrangler.safe.jsonc" \
    --port 8787 \
    --show-interactive-dev-session=false \
    --var "RESEARCH_CONTROL_SECRET:$CANARY_TOKEN" \
    --var "CLIENT_ACQUISITION_V2_WRITE_ENABLED:true" \
    --var "KEENABLE_MCP_URL:https://api.keenable.ai/mcp" \
    --var "LEAD_OUTREACH_SPREADSHEET_ID:1fXHlnCqsw6KvKub4UtqHyb5MwUUPvqTZ9QvPp1IPG-E" \
    >"$DEV_LOG" 2>&1 &
  DEV_PID=$!

  READY=0
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error "http://127.0.0.1:8787/client-acquisition-v2/health" >"$HEALTH_FILE" 2>/dev/null; then
      READY=1
      break
    fi
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "REMOTE_CANARY_DEV_EXITED" >&2
      cat "$DEV_LOG" >&2
      exit 31
    fi
    sleep 2
  done
  [ "$READY" = "1" ] || { echo "REMOTE_CANARY_DEV_NOT_READY" >&2; cat "$DEV_LOG" >&2; exit 32; }

  python3 - "$HEALTH_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
assert data.get("suppressionContract") == "PASS", data
assert data.get("manualAuthConfigured") is True, data
assert data.get("legacyRunPreserved") is True, data
print("REMOTE_CANARY_HEALTH_PASS")
PY

  curl --fail --silent --show-error \
    -X POST \
    -H "x-run-token: $CANARY_TOKEN" \
    "http://127.0.0.1:8787/client-acquisition-v2/run?write=1" \
    >"$RESPONSE_FILE"

  python3 - "$RESPONSE_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
status = data.get("status")
allowed = {"CANARY_NO_PROMOTION", "READY_FOR_GPT_WRITTEN", "CANARY_IDEMPOTENT_EXISTING", "CANARY_IDEMPOTENT_RACE"}
assert status in allowed, data
assert data.get("suppressionContract") == "PASS", data
assert int(data.get("businessesInspected", 0)) <= 10, data
assert int(data.get("deepPreflightSites", 0)) <= 5, data
assert int(data.get("candidateSitePageReads", 0)) <= 15, data
assert int(data.get("written", 0)) <= 1, data
if status == "READY_FOR_GPT_WRITTEN":
    assert data.get("written") == 1, data
    assert data.get("idempotency") == "PASS", data
    assert data.get("replayDuplicateWrites") == 0, data
elif status == "CANARY_NO_PROMOTION":
    assert data.get("readyForGpt") == 0, data
    assert data.get("written") == 0, data
print(
    "REMOTE_CANARY_PASS"
    f" status={status}"
    f" businesses={data.get('businessesInspected', 0)}"
    f" deep={data.get('deepPreflightSites', 0)}"
    f" page_reads={data.get('candidateSitePageReads', 0)}"
    f" ready={data.get('readyForGpt', 0)}"
    f" written={data.get('written', 0)}"
    f" candidate={data.get('candidateId', '')}"
    f" finding={data.get('findingType', '')}"
)
PY

  cleanup_canary
  trap - EXIT
fi
