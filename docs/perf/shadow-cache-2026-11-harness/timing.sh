#!/bin/sh
# Cache off/on pairs on a production build (pnpm run build && vite preview --port $PORT),
# no ?perf=1; then the overlay check. BASE=http://127.0.0.1:<port> ./timing.sh
cd "$(dirname "$0")"
run() { node perf2.mjs "$@" 2>&1 | tail -1; }
for i in 1 2 3; do
  run sp-stand-off-$i '/spawn?pos=0,10' 15 '{"cache":0}'
  run sp-stand-on-$i '/spawn?pos=0,10' 15 '{"cache":1}'
  run sp-walk-off-$i '/spawn?pos=0,10' 15 '{"cache":0,"walk":"square"}'
  run sp-walk-on-$i '/spawn?pos=0,10' 15 '{"cache":1,"walk":"square"}'
  run sp-race-off-$i '/rail-race' 15 '{"cache":0,"walk":"race"}'
  run sp-race-on-$i '/rail-race' 15 '{"cache":1,"walk":"race"}'
  run sp-phone4x-off-$i '/spawn?pos=0,10' 15 '{"cache":0,"phone":true,"throttle":4}'
  run sp-phone4x-on-$i '/spawn?pos=0,10' 15 '{"cache":1,"phone":true,"throttle":4}'
done
run sp-noon-off '/spawn?pos=0,10' 15 '{"cache":0,"time":0.5}'
run sp-noon-on '/spawn?pos=0,10' 15 '{"cache":1,"time":0.5}'
run sp-pm-off '/spawn?pos=0,10' 15 '{"cache":0,"time":0.66}'
run sp-pm-on '/spawn?pos=0,10' 15 '{"cache":1,"time":0.66}'
# the ?perf=1 overlay, after its GPU-name fix: must not invent missed frames
node perf.mjs overlay-on '/spawn?pos=0,10' 15 '{"cache":1}' 2>&1 | tail -1
node perf.mjs overlay-off '/spawn?pos=0,10' 15 '{"cache":0}' 2>&1 | tail -1
echo BATCH2 DONE
