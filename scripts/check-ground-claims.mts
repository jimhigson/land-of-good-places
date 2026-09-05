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
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import type { Capsule, Claim } from '../src/boot/groundClaims.ts';

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
// Probe 2: exactly one feature has claimed ground, it is the road, and every
// claim it made is a corridor.
//
// **What this covers, honestly**: at step 1 the road is the ONLY production
// placer, so "one feature" is the whole registry. It will stop being one the
// moment step 2 lands, and the assertion below is written to fail loudly then
// rather than silently widen — a check that quietly accepts more than it was
// written for is how the next agent inherits a false belief.
// ---------------------------------------------------------------------------
const features = worldRegistry.committedFeatures();
if (features.length !== 1 || features[0] !== ROAD_FEATURE) {
  fouls.push(
    `the registry on the built park holds features [${features.join(', ')}] — step 1 makes the ` +
      `road the one and only production placer, so this should be exactly ["${ROAD_FEATURE}"]. ` +
      'If a later step has added a placer, widen this probe deliberately rather than deleting it',
  );
}
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
    '(two: the road turns a corner at the gate, and a capsule is a straight segment)',
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
  const spurIndex = entranceRoadSegments().findIndex((s) => s.name === 'entrance-road-gateway');
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
  said.push(`the registry's corridor is byte-identical to entranceRoadClaims(): ${ownerKeys.join('  ')}`);
}

// ---------------------------------------------------------------------------
// Probe 5: the owner's output IS the road that was drawn.
//
// Probe 4 proves the registry and the owner agree; on its own that would be
// satisfied by an owner nothing draws from. This measures the **ribbon in the
// scene**: its world-space extents, which are the centreline swept
// `ROAD_HALF_WIDTH` either side.
//
// **The one tolerance in this file, and why it is not a fudge.** Mesh positions
// are a `Float32Array`, so a metre value read back off geometry carries about
// seven significant digits and cannot be compared byte-for-byte with the
// owner's float64. The residual is reported on every run rather than merely
// bounded, so a drift that grows shows up as a number changing long before it
// crosses the threshold.
// ---------------------------------------------------------------------------
const FLOAT32_SLACK = 1e-3;
let measuredRibbons = 0;
let worstResidual = 0;
let worstResidualNote = '';

park.scene.updateMatrixWorld(true);
const segments = entranceRoadSegments();
for (const [index, claim] of roadClaims.entries()) {
  const shape = claim.shape as Capsule;
  // Which ribbon this claim is, taken from the owner's own ordering rather
  // than inferred from the numbers — see probe 2b.
  const segment = segments[index];
  if (!segment) {
    fouls.push(
      `the registry holds a corridor claim at index ${index} that the owner does not produce — ` +
        'the registry and `entranceRoadSegments()` no longer describe the same road',
    );
    continue;
  }
  const name = segment.name;
  const alongX = segment.along === 'x';
  const mesh = park.scene.getObjectByName(name);
  if (!mesh || !('geometry' in mesh)) {
    fouls.push(
      `the registry claims a corridor for "${name}" but no such mesh is in the scene — the ` +
        'claim describes a road nobody drew',
    );
    continue;
  }
  const geometry = (mesh as { geometry: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getZ: (i: number) => number } } }).geometry;
  const position = geometry.getAttribute('position');
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    minX = Math.min(minX, position.getX(i));
    maxX = Math.max(maxX, position.getX(i));
    minZ = Math.min(minZ, position.getZ(i));
    maxZ = Math.max(maxZ, position.getZ(i));
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) {
    fouls.push(`"${name}" has no finite vertices — nothing was measured, so nothing was proved`);
    continue;
  }
  measuredRibbons += 1;

  // What the claim says the ribbon's own bounding box must be.
  const expected = alongX
    ? {
        minX: Math.min(shape.x1, shape.x2),
        maxX: Math.max(shape.x1, shape.x2),
        minZ: shape.z1 - ROAD_HALF_WIDTH,
        maxZ: shape.z1 + ROAD_HALF_WIDTH,
      }
    : {
        minX: shape.x1 - ROAD_HALF_WIDTH,
        maxX: shape.x1 + ROAD_HALF_WIDTH,
        minZ: Math.min(shape.z1, shape.z2),
        maxZ: Math.max(shape.z1, shape.z2),
      };
  for (const [edge, drawn, claimed] of [
    ['minX', minX, expected.minX],
    ['maxX', maxX, expected.maxX],
    ['minZ', minZ, expected.minZ],
    ['maxZ', maxZ, expected.maxZ],
  ] as const) {
    const residual = Math.abs(drawn - claimed);
    if (residual > worstResidual) {
      worstResidual = residual;
      worstResidualNote = `${name}.${edge}: drawn ${drawn.toFixed(6)} vs claimed ${claimed.toFixed(6)}`;
    }
    if (residual > FLOAT32_SLACK) {
      fouls.push(
        `the road's claim does not describe the road that was drawn — "${name}" ${edge} is ` +
          `${drawn.toFixed(4)} in the scene and the corridor claims ${claimed.toFixed(4)}, ` +
          `${residual.toFixed(4)} m apart. A child walks on the mesh; every later placer ` +
          'negotiates against the claim',
      );
    }
  }
}
if (measuredRibbons !== roadClaims.length) {
  fouls.push(
    `only ${measuredRibbons} of ${roadClaims.length} claimed corridor runs were measured ` +
      'against a real mesh — the rest asserted nothing',
  );
}
said.push(
  `both ribbons measured against their claim; worst edge residual ${worstResidual.toExponential(2)} m ` +
    `(${worstResidualNote}) — float32 mesh positions, slack ${FLOAT32_SLACK}`,
);

// ---------------------------------------------------------------------------
for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error(`\ncheck:ground-claims FAILED — ${fouls.length} problem(s):`);
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:ground-claims passed');
