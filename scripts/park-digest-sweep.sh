#!/bin/bash
# Runs park-digest.mts once per pool seed, each in its own process (module
# caches make a second park in one process a lie), into $1/<seed>.txt
set -u
out="$1"
mkdir -p "$out"
# **Derived, not listed.** A hand-typed seed list goes stale the moment the pool
# changes -- this copy still named 267 and 288 after #589 retired them, so a
# sweep would have measured two parks that no longer exist and missed none that
# do. PARK_SEED_POOL is the owner; ask it.
seeds="$(node --import ./scripts/ts-extension-resolver-register.mjs --input-type=module \
  -e "import { PARK_SEED_POOL } from './src/world/parkSeedPool.ts'; console.log(PARK_SEED_POOL.join(' '));")"
for seed in $seeds; do
  LGP_SEED="$seed" node --import ./scripts/ts-extension-resolver-register.mjs \
    scripts/park-digest.mts > "$out/$seed.txt" 2> "$out/$seed.err"
  code=$?
  echo "$seed exit=$code $(head -1 "$out/$seed.txt")"
done
