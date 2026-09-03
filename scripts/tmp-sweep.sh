#!/bin/bash
# temporary: sixteen-seed check:park sweep, one line per seed
cd "$(dirname "$0")/.." || exit 1
for s in canonical 5 11 24 115 128 131 208 225 267 274 288 326 346 428 451; do
  if [ "$s" = canonical ]; then
    out=$(node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-park.mts 2>&1)
  else
    out=$(LGP_SEED=$s node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-park.mts 2>&1)
  fi
  code=$?
  summary=$(printf '%s' "$out" | grep -oE '(poi\.stranded|route\.unreachable|poi\.nospot)[^ ]*[: ]+[0-9]+' | tr '\n' ' ')
  if [ -z "$summary" ] && [ $code -ne 0 ]; then
    summary=$(printf '%s' "$out" | grep -iE '^(FAIL|✗|Error)' | head -3 | tr '\n' ' ')
  fi
  echo "seed $s exit=$code $summary"
done
