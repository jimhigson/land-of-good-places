#!/bin/bash
# TEMP: check:park across the whole sixteen-seed pool, one line per seed.
# Prints the exit code and the poi.stranded / route.unreachable counts.
cd "$(dirname "$0")/.." || exit 1
for s in "" 5 11 24 115 128 131 208 225 267 274 288 326 346 428 451; do
  out=$(LGP_SEED=$s node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-park.mts 2>&1)
  code=$?
  name=${s:-canonical}
  fails=$(echo "$out" | grep -oE '(poi\.stranded|route\.unreachable|poi\.nospot)[: ]+[0-9]+' | tr '\n' ' ')
  echo -e "$name\texit=$code\t$fails"
done
