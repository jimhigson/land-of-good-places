#!/bin/bash
B=http://127.0.0.1:5742
run() { node run.mjs "$1" "$B" "$2" "$3" "$4" > /dev/null 2>&1; echo "$1 exit=$?"; }
run a-library '/library?sit=1&story=now' 40 '{"trace":true,"traceCpu":true,"walk":"none","warm":0}'
run a-castle /castle 25 '{"trace":true,"traceCpu":true,"walk":"square"}'
run a-reptile-cpu /reptile-house 25 '{"cpu":true,"heap":true,"walk":"square"}'
run a-railrace-cpu /rail-race 25 '{"cpu":true,"heap":true,"walk":"ride"}'
run a-library-cpu '/library?sit=1&story=now' 30 '{"cpu":true,"heap":true,"walk":"none","warm":20}'
run a-phone-park-cpu /spawn 25 '{"cpu":true,"walk":"square","phone":true,"throttle":4}'
run g-reptile /reptile-house 20 '{"walk":"square","inject":{"gpuFinish":true}}'
run g-park /spawn 20 '{"walk":"square","inject":{"gpuFinish":true}}'
run g-phone-park /spawn 20 '{"walk":"square","phone":true,"inject":{"gpuFinish":true}}'
