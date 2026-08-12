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
