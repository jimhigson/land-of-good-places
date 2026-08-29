/**
 * Derives the dimensional contract for the bridge redesign (#349 follow-up):
 * what sets the length today, and what Jim's "40% shorter" does to the slope.
 */
import {
  BRIDGE_RISE,
  BRIDGE_DECK_DEPTH,
  BRIDGE_DECK_SLAB,
  BRIDGE_SHELL_MIN,
  BRIDGE_ROAD_BED_DROP,
  TRAIN_CLEARANCE_Y,
  TRAIN_SWEPT_TOP_Y,
  RIDER_HEADROOM,
  FENCE_OFFSET,
} from './src/world/train/clearance.ts';
import {
  BRIDGE_RAMP_GRADIENT,
  DECK_HALF_LENGTH,
  MAX_RAMP_GRADIENT,
} from './src/world/train/bridgeFootprint.ts';
import { TRACK_CLEARANCE } from './src/world/train/route.ts';
import { BUILDING_STEP_UP, PLAYER_RADIUS } from './src/core/constants.ts';

const HUMP_BLEND = 0.15; // bridges.ts
const ARCH_CLEAR_HALF = TRACK_CLEARANCE + 0.5;
const PEAK = 1 / (1 - HUMP_BLEND); // trapezoid peak-slope multiplier

const f = (n: number, d = 3): string => n.toFixed(d);

console.log('--- vertical envelope (what sets the RISE) ---');
console.log(`TRAIN_SWEPT_TOP_Y        ${f(TRAIN_SWEPT_TOP_Y)}`);
console.log(`RIDER_HEADROOM         + ${f(RIDER_HEADROOM)}`);
console.log(`TRAIN_CLEARANCE_Y      = ${f(TRAIN_CLEARANCE_Y)}`);
console.log(`BRIDGE_DECK_DEPTH      + ${f(BRIDGE_DECK_DEPTH)}  (slab ${f(BRIDGE_DECK_SLAB)} + shell ${f(BRIDGE_SHELL_MIN)} + bed drop ${f(BRIDGE_ROAD_BED_DROP)})`);
console.log(`BRIDGE_RISE            = ${f(BRIDGE_RISE)}   <- deck surface above the ground under the track`);

console.log('\n--- horizontal envelope (what sets the LENGTH) ---');
console.log(`FENCE_OFFSET             ${f(FENCE_OFFSET)}  (fence line each side of the rail)`);
console.log(`DECK_HALF_LENGTH       = ${f(DECK_HALF_LENGTH)}  = FENCE_OFFSET + 1.2`);
console.log(`flat deck span         = ${f(DECK_HALF_LENGTH * 2)}`);
console.log(`BRIDGE_RAMP_GRADIENT   = ${f(BRIDGE_RAMP_GRADIENT)}  (inherited from ENTRANCE_RAMP)`);
const rampNow = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;
console.log(`ideal ramp run each side = ${f(rampNow)}`);
const totalNow = DECK_HALF_LENGTH * 2 + rampNow * 2;
console.log(`TOTAL LENGTH NOW       = ${f(totalNow)} m`);
console.log(`peak slope now         = ${f(BRIDGE_RAMP_GRADIENT * PEAK)}  (trapezoid peak = ${f(PEAK, 4)}x average)`);

console.log('\n--- the arch opening ---');
console.log(`TRACK_CLEARANCE          ${f(TRACK_CLEARANCE)}  (train swept half-width)`);
console.log(`ARCH_CLEAR_HALF        = ${f(ARCH_CLEAR_HALF)}  = TRACK_CLEARANCE + 0.5`);
console.log(`arch opening WIDTH     = ${f(ARCH_CLEAR_HALF * 2)} m  (along the rail)`);
console.log(`arch opening HEIGHT    = ${f(TRAIN_CLEARANCE_Y)} m  (soffit above the track bed)`);
console.log(`ARCH_SPAN_HALF         = ${f(DECK_HALF_LENGTH)}  (mouth-to-mouth ${f(DECK_HALF_LENGTH * 2)} m, across the rail)`);

console.log('\n--- playability ceilings (game numbers, not generator targets) ---');
console.log(`BUILDING_STEP_UP         ${f(BUILDING_STEP_UP)}  (one walking level)`);
console.log(`PLAYER_RADIUS            ${f(PLAYER_RADIUS)}`);
const NAV_CELL = 0.5;
const navLimit = BUILDING_STEP_UP / NAV_CELL;
console.log(`NavGrid cell             ${f(NAV_CELL)}`);
console.log(`NavGrid slope ceiling  = ${f(navLimit)}  = BUILDING_STEP_UP / cell  <- HARD: NPCs stop routing past this`);
console.log(`MAX_RAMP_GRADIENT        ${f(MAX_RAMP_GRADIENT)}  (today's cap, deliberately half the NavGrid ceiling)`);

console.log('\n--- Jim: 40% shorter, deck span fixed by the fence lines ---');
for (const cut of [0.4]) {
  const target = totalNow * (1 - cut);
  const rampNew = (target - DECK_HALF_LENGTH * 2) / 2;
  const gradNew = BRIDGE_RISE / rampNew;
  const peakNew = gradNew * PEAK;
  console.log(`target total length    = ${f(target)} m  (${cut * 100}% shorter than ${f(totalNow)})`);
  console.log(`  ramp run each side   = ${f(rampNew)} m   (was ${f(rampNow)})`);
  console.log(`  average gradient     = ${f(gradNew)}     (was ${f(BRIDGE_RAMP_GRADIENT)})  = ${f(gradNew * 100, 1)}%`);
  console.log(`  PEAK slope           = ${f(peakNew)}     (was ${f(BRIDGE_RAMP_GRADIENT * PEAK)})`);
  console.log(`  vs NavGrid ceiling ${f(navLimit)}: ${peakNew < navLimit ? 'OK, margin ' + f(navLimit - peakNew) : 'EXCEEDS by ' + f(peakNew - navLimit)}`);
  console.log(`  angle                = ${f((Math.atan(gradNew) * 180) / Math.PI, 1)} deg average, ${f((Math.atan(peakNew) * 180) / Math.PI, 1)} deg peak`);
}

console.log('\n--- what total length each candidate peak slope allows ---');
for (const peakTarget of [0.6, 0.8, 1.0, navLimit]) {
  const grad = peakTarget / PEAK;
  const ramp = BRIDGE_RISE / grad;
  const total = DECK_HALF_LENGTH * 2 + ramp * 2;
  console.log(
    `peak ${f(peakTarget)} -> avg ${f(grad)} -> ramp ${f(ramp)} -> total ${f(total)} m ` +
      `(${f((1 - total / totalNow) * 100, 1)}% shorter)`);
}
