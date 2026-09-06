#!/bin/bash
# Runs park-digest.mts once per pool seed, each in its own process (module
# caches make a second park in one process a lie), into $1/<seed>.txt
set -u
out="$1"
mkdir -p "$out"
seeds="20260728 5 11 24 115 128 131 208 225 267 274 288 326 346 428 451"
for seed in $seeds; do
  LGP_SEED="$seed" node --import ./scripts/ts-extension-resolver-register.mjs \
    scripts/park-digest.mts > "$out/$seed.txt" 2> "$out/$seed.err"
  code=$?
  echo "$seed exit=$code $(head -1 "$out/$seed.txt")"
done
