/**
 * **The road's claim is the road.**
 *
 * Stage 3, step 1 of the round-robin rework makes the entrance road the first
 * production placer: `boot/parkGeneration.ts` creates the park's one
 * {@link GroundClaims} registry, a `roadCorridor` task claims the road's
 * corridor into it during the round-robin, and `World` takes that same registry
 * out of `boot/groundClaimsPrewarm.ts`'s letterbox and re-commits the road once
 * the paths it is measured against exist.
 *
 * Three things can go silently wrong with that, and each has a probe here:
 *
 * 1. **Two registries.** If `World` made its own instead of taking the
 *    generator's, everything would still work and every claim the round-robin
 *    negotiated would be thrown away — invisibly, because the registry a check
 *    reads would be full and correct. Probe 3 asserts object identity.
 * 2. **The claim drifts from the road.** The whole design exists to stop the
 *    corridor being written down twice; a claim built by re-typing what
 *    `Entrance.ts` draws would read correctly and be wrong the first time
 *    either moved. Probe 4 compares the registry against
 *    `entranceRoadClaims()` with **no tolerance at all**, and probe 5 compares
 *    it against the ribbon actually in the scene.
 * 3. **The registry is empty.** A claim nobody commits is the check-that-cannot
 *    -fail in its purest form. Probe 2 counts what is actually in there.
 *
 * This drives a **real** `ParkGeneration` to completion and then builds a
 * **real** `World`, in that order and in one process, which is exactly the
 * order the game does it in — the letterbox hand-over is the thing under test,
 * so a harness that skipped the generator would prove nothing about it.
 *
 * `headless-canvas.mjs` must be imported before anything that paints.
 */
import './headless-canvas.mjs';
import { ParkGeneration, GENERATION_BUDGET_MS } from '../src/boot/parkGeneration.ts';
import {
  ROAD_FEATURE,
  entranceRoadClaims,
  entranceRoadSegments,
} from '../src/world/entrance/roadCorridor.ts';
import { RAIL_RACE_FEATURE } from '../src/world/railRace/feature.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import type { Capsule, Claim } from '../src/boot/groundClaims.ts';
import { FLOAT32_SLACK, collectRoadRibbons, measureRoadRibbons } from './road-ribbon-measure.mts';

const fouls: string[] = [];
const said: string[] = [];

const nextFrame = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Generate the park exactly as the ride loop does.
// ---------------------------------------------------------------------------
const generation = new ParkGeneration();
const MAX_FRAMES = 6000;
let frames = 0;
while (!generation.ready && generation.failed === null && frames < MAX_FRAMES) {
  generation.advance(GENERATION_BUDGET_MS);
  frames += 1;
  await nextFrame();
}
if (generation.failed !== null) {
  console.error(`check:ground-claims: generation failed: ${generation.failed.message}`);
  process.exit(1);
}
if (!generation.ready) {
  console.error(`check:ground-claims: generation never finished in ${MAX_FRAMES} frames`);
  process.exit(1);
}
said.push(`park generated in ${frames} frames`);

const generatorRegistry = generation.groundClaims;

// ---------------------------------------------------------------------------
// Probe 1: the round-robin claimed the road, during generation, before any
// World existed. If this is empty the task never ran and every probe below
// would be measuring only the re-commit World makes.
// ---------------------------------------------------------------------------
const claimedDuringGeneration = generatorRegistry.claimsOf(ROAD_FEATURE);
if (claimedDuringGeneration.length === 0) {
  fouls.push(
    `nothing was claimed under the feature "${ROAD_FEATURE}" during generation — the ` +
      'roadCorridor scheduler task never committed, so the road takes no part in the ' +
      'round-robin and every probe below is only measuring World',
  );
} else {
  said.push(
    `the round-robin claimed ${claimedDuringGeneration.length} corridor run(s) for ` +
      `"${ROAD_FEATURE}" before any World existed`,
  );
}

// ---------------------------------------------------------------------------
// Now the World. It must take the generator's registry out of the letterbox.
// ---------------------------------------------------------------------------
const { buildHeadlessPark } = await import('./park-harness.mts');
const park = buildHeadlessPark();
const worldRegistry = park.world.groundClaims;

// ---------------------------------------------------------------------------
// Probe 2: only declared production placers have claimed ground, in the order
// they are declared to commit in, and every claim the road made is a corridor.
//
// **What this covers, honestly**: the list below is the whole roster of
// placers. Step 1 asserted `[road]` alone; step 2 widened it to `[road,
// railRace]`; the backtracking rework widened it to all fourteen. The next
// placer widens it again the same way, by hand — a check that quietly accepts
// more than it was written for is how the next agent inherits a false belief.
//
// Proved red both ways at the commit that widened it, against the canonical
// seed's registry `[layout, cruiser, train, slide, crossings, pathGraph, road,
// fountain, walls, trees, bushes, lamps, railRace]`: dropping `'lamps'` from
// the roster fouls it as an undeclared placer, and swapping `'walls'` and
// `'trees'` in the roster fouls `trees` as committing out of order.
//
// Re-proved the same two ways when `'stalls'` was added: dropping it fouls
// `stalls` as an undeclared placer, and moving it after `'fountain'` fouls it
// as committing out of order. This probe caught the stalls feature the first
// time it was ever able to run — it had been blocked by the `railRace/hazards.ts`
// module-scope TDZ until #682 — which is the whole argument for a roster
// written out by hand.
// ---------------------------------------------------------------------------
// One rail race at two scales is one feature — see `src/world/railRace/feature.ts`.
//
// **Widened for the backtracking rework**, which is what a "later step has
// added a placer" looks like. Every park feature now decides through a
// `FeatureBuilder` in one of two `ParkSolve` drivers, and each of them claims
// ground: the plan solve (`world/parkPlan.ts`) runs during generation, then the
// world solve (`world/worldPhase.ts`) runs inside the `World` constructor. So
// the list below is those two drivers' build orders, concatenated — written out
// by hand, deliberately, rather than read back off either driver, because a
// probe that asks the code under test what to expect cannot fail.
//
// **Why this is a subsequence test and not an equality test, and what that
// costs.** A placer that legitimately places *nothing* commits nothing and so
// does not appear: on the canonical seed `fairyLights` builds 0 poles, because
// the fairy ring (radius 13.5 round the plaza) lands exactly on the main loop,
// so every pole is "on a path" and skipped. That is pre-existing and true on
// the base too. Asserting exact equality would therefore fail on a seed for a
// reason that is not a fault, and asserting nothing would accept a stranger.
// So: **no feature may appear that is not on the list, and the ones that do
// appear must be in the list's order** — an unknown placer and a placer
// committing out of order are both still fouls. The price is that this probe
// cannot see a placer that has silently stopped claiming anything at all, so it
// says on every run which declared placers committed nothing, by name.
const EXPECTED_FEATURES = [
  // world/parkPlan.ts's coarse builders, in order.
  'layout',
  'cruiser',
  'train',
  'slide',
  'crossings',
  'pathGraph',
  ROAD_FEATURE,
  // world/worldPhase.ts's builders, in order.
  //
  // **`stalls` is first, and it is new.** Until the stalls feature builder
  // (`world/stallsFeature.ts`) landed, a booth was the one thing in the park
  // that put something on the ground without claiming it: its spot came from
  // the layout, its body became four wall colliders, and the registry never
  // heard of it — so nothing could ever name a stall as the thing in its way.
  // It claims now (four wall capsules per booth plus its stand spot), which is
  // exactly the "a later step has added a placer" this roster's own comment
  // asks to be widened by hand for.
  'stalls',
  'fountain',
  'walls',
  'trees',
  'bushes',
  'fairyLights',
  'lamps',
  RAIL_RACE_FEATURE,
];
const features = worldRegistry.committedFeatures();
const strangers = features.filter((feature) => !EXPECTED_FEATURES.includes(feature));
if (strangers.length > 0) {
  fouls.push(
    `the registry on the built park holds feature(s) [${strangers.join(', ')}] that are not ` +
      `declared placers — the declared list, in commit order, is [${EXPECTED_FEATURES.join(', ')}]. ` +
      'If a later step has added a placer, widen this probe deliberately rather than deleting it',
  );
}
let previous = -1;
const outOfOrder: string[] = [];
for (const feature of features) {
  const at = EXPECTED_FEATURES.indexOf(feature);
  if (at === -1) continue;
  if (at < previous) outOfOrder.push(feature);
  previous = at;
}
if (outOfOrder.length > 0) {
  fouls.push(
    `these placers committed out of the declared build order: [${outOfOrder.join(', ')}] — ` +
      `the registry holds [${features.join(', ')}] against a declared order of ` +
      `[${EXPECTED_FEATURES.join(', ')}]. Commit order is load-bearing: a feature that claims ` +
      'ground before the one it was meant to defer to has skipped the negotiation',
  );
}
const silent = EXPECTED_FEATURES.filter((feature) => !features.includes(feature));
said.push(
  `${features.length} of ${EXPECTED_FEATURES.length} declared placers committed ground, in ` +
    `declared order` +
    (silent.length === 0
      ? ' — every declared placer is covered on this seed'
      : `; this probe asserts NOTHING about [${silent.join(', ')}], which committed no claim at ` +
        'all on this seed (a placer that places nothing is indistinguishable here from one that ' +
        'has silently stopped claiming)'),
);
const roadClaims = worldRegistry.claimsOf(ROAD_FEATURE);
const notCorridor = roadClaims.filter((claim) => claim.kind !== 'corridor');
if (notCorridor.length > 0) {
  fouls.push(
    `the road committed ${notCorridor.length} claim(s) that are not corridors ` +
      `(${notCorridor.map((c) => c.kind).join(', ')}) — a road is a thing that travels, so ` +
      'paths and stand spots must be welcome on it and only a declared crossing may cross it',
  );
}
said.push(
  `the built park's registry holds ${roadClaims.length} corridor run(s) for "${ROAD_FEATURE}" ` +
    '(one per pair of the arc\'s own stations, plus the gateway approach: a capsule is a ' +
    'straight segment, and the kerb is a curve)',
);

// ---------------------------------------------------------------------------
// Probe 2b: the re-commit is load-bearing, and this says by how much.
//
// The road's spur stops where the plaza's paving starts, and paving is
// published by `buildPaths()` INSIDE `new World(...)` — after every scheduler
// rung has run. So the round-robin's claim honestly runs the spur the whole way
// in, and `World` refines it once there is a park to measure against. If these
// two ever print the same number on every seed, the re-commit has become
// decorative and this probe is the thing that will say so.
// ---------------------------------------------------------------------------
{
  // Paired by the owner's own index rather than by guessing an axis off the
  // geometry: `entranceRoadSegments()` names the runs, and claim `i` is
  // segment `i` because `entranceRoadClaims()` maps one to one over it. A
  // geometric guess quietly stops finding the spur the moment anything moves,
  // which is exactly when this probe matters most.
  const spurIndex = entranceRoadSegments().findIndex((s) => s.name === 'entrance-gateway-path');
  const spurAtGeneration = claimedDuringGeneration[spurIndex]?.shape as Capsule | undefined;
  const spurAtBuild = roadClaims[spurIndex]?.shape as Capsule | undefined;
  if (!spurAtGeneration || !spurAtBuild) {
    fouls.push('no gateway spur was claimed at one of the two moments — nothing to compare');
  } else {
    said.push(
      `the gateway spur ran to z=${spurAtGeneration.z2.toFixed(2)} when the round-robin claimed ` +
        `it (no paving published yet) and to z=${spurAtBuild.z2.toFixed(2)} once Garden had ` +
        'drawn the paths — the re-commit is what makes the registry describe the drawn road',
    );
    if (spurAtBuild.z2 < spurAtGeneration.z2) {
      fouls.push(
        `the built road's spur (z=${spurAtBuild.z2.toFixed(2)}) reaches FURTHER in than the ` +
          `ground the round-robin claimed (z=${spurAtGeneration.z2.toFixed(2)}). The ` +
          'generation-time claim is meant to be the conservative one; a placer that negotiated ' +
          'against it could have taken ground the road then took back',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Probe 3: ONE instance. World took the generator's registry; it did not make
// a second one.
// ---------------------------------------------------------------------------
if (worldRegistry !== generatorRegistry) {
  fouls.push(
    "the World's claims registry is NOT the object the generator claimed against — it made its " +
      'own, so everything the round-robin negotiated was silently discarded. Check that ' +
      "`groundClaimsPrewarm.ts`'s letterbox was filled before `new World(...)` and that nothing " +
      'took it first',
  );
} else {
  said.push("World's registry is identically the generator's (===), not a second instance");
}

// ---------------------------------------------------------------------------
// Probe 4: the claim IS the owner's output. No tolerance — byte equality of
// every number, because these must come from the same call, not from two
// calculations that agree to some number of places.
// ---------------------------------------------------------------------------
const asKey = (claim: Claim): string => {
  const s = claim.shape;
  if (s.shape !== 'capsule') return `${claim.kind}:disc(${s.x},${s.z},${s.radius})`;
  return `${claim.kind}:capsule(${s.x1},${s.z1},${s.x2},${s.z2},${s.halfWidth})`;
};
const fromOwner = entranceRoadClaims();
const ownerKeys = fromOwner.map(asKey);
const registryKeys = roadClaims.map(asKey);
if (ownerKeys.length !== registryKeys.length || ownerKeys.some((k, i) => k !== registryKeys[i])) {
  fouls.push(
    'the road corridor in the registry is NOT what `entranceRoadClaims()` returns:\n' +
      `    registry: ${registryKeys.join('  ')}\n` +
      `    owner:    ${ownerKeys.join('  ')}\n` +
      '    They must be the same call, not two definitions kept in step by hand',
  );
} else {
  // Summarised, not listed. The arc is sampled at its own station spacing, so
  // this is 143 capsules on the canonical seed; printing them all buried every
  // other line of this check's output. The equality above is over the whole
  // list — what is printed is evidence of the shape of it, not the comparison.
  said.push(
    `the registry's corridor is byte-identical to entranceRoadClaims(), all ${ownerKeys.length} ` +
      `run(s) — first ${ownerKeys[0]}, last ${ownerKeys[ownerKeys.length - 1]}`,
  );
}

// ---------------------------------------------------------------------------
// Probe 5: the owner's output IS the road that was drawn.
//
// Probe 4 proves the registry and the owner agree; on its own that would be
// satisfied by an owner nothing draws from. This measures the **ribbons in the
// scene**, vertex by vertex, against the claims' own geometry.
//
// **It used to be a bounding-box comparison, and #498's curve ended that.**
// When the road was two axis-aligned runs, "the claim is the ribbon" could be
// settled by comparing four numbers. The bounding box of an arc is mostly
// ground the arc does not hold, so on a curve that comparison measures a
// different shape — and it would have gone on passing while saying so. The
// measurement now lives in `road-ribbon-measure.mts`, shared with the procgen
// invariant that asks the same question on every other pool seed, and its
// header sets out why exactly one of the two directions is an equality.
// ---------------------------------------------------------------------------
park.scene.updateMatrixWorld(true);
const segments = entranceRoadSegments();
const ribbons = collectRoadRibbons(park.scene, segments);
const measurement = measureRoadRibbons(segments, roadClaims, ribbons);
fouls.push(...measurement.fouls);
if (measurement.verticesTested === 0) {
  fouls.push(
    'no ribbon vertices were tested at all, so probe 5 proved nothing — the road claims ground ' +
      'and nothing was found drawn on it',
  );
}
said.push(
  `${measurement.runsMeasured} of ${roadClaims.length} claimed runs are backed by a drawn ` +
    `ribbon, over ${ribbons.length} mesh(es) and ${measurement.verticesTested} vertices; the ` +
    `worst any drawn vertex lies outside every claim is ${measurement.worstOutside.toExponential(2)} m ` +
    `(${measurement.worstOutsideNote}) against a float32 slack of ${FLOAT32_SLACK}`,
);
said.push(
  `the claim reaches at most ${measurement.worstOvershoot.toFixed(3)} m past the ribbon at a run's ` +
    `own end (${measurement.worstOvershootNote}) — reported, not thresholded: the gateway ` +
    "approach's claim is deliberately the envelope round a staircase of trimmed columns",
);

// ---------------------------------------------------------------------------
for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error(`\ncheck:ground-claims FAILED — ${fouls.length} problem(s):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:ground-claims passed');
