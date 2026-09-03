#!/bin/bash
# TEMP: check:park over the whole sixteen-seed pool, one line per seed.
cd "$(dirname "$0")/.."
for s in canonical 5 11 24 115 128 131 208 225 267 274 288 326 346 428 451; do
  if [ "$s" = canonical ]; then unset LGP_SEED; else export LGP_SEED=$s; fi
  out=$(node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-park.mts 2>&1)
  code=$?
  note=$(echo "$out" | grep -oE '(poi\.stranded|poi\.nospot|route\.unreachable)[^ ]*: *[0-9]+' | tr '\n' ' ')
  [ -z "$note" ] && note=$(echo "$out" | tail -3 | tr '\n' ' ')
  echo "$s exit=$code $note"
done
