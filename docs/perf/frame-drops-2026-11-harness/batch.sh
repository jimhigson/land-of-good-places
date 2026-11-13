#!/bin/bash
# $1 = prefix, $2 = base, $3 = extra opts json fragment (e.g. "traceCpu":true)
P=$1; B=$2; X=$3
run() { node run.mjs "$P-$1" "$B" "$2" "$3" "{\"trace\":true,$X$4}" > /dev/null 2>&1; echo "$P-$1 exit=$?"; }
run park /spawn 25 '"walk":"square"'
run longrun /spawn 45 '"walk":"line"'
run library '/library?sit=1&story=now' 40 '"walk":"none","warm":0'
run reptile /reptile-house 25 '"walk":"square"'
run castle /castle 25 '"walk":"square"'
run railrace /rail-race 30 '"walk":"ride"'
run skycruiser /sky-cruiser 30 '"walk":"ride"'
run phone-park /spawn 25 '"walk":"square","phone":true,"throttle":4'
run phone-library '/library?sit=1&story=now' 40 '"walk":"none","warm":0,"phone":true,"throttle":4'
