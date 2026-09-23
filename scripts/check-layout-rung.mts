/**
 * **`check:layout-rung` — the layout's doormat rung, proved red on purpose.**
 *
 * ```
 * pnpm run check:layout-rung
 * ```
 *
 * `parkLayout.ts` asks, after every whole-park draw, whether a child could
 * reach every doormat on the park as it stands (plots and boundary), on the
 * same `NavGrid` the children walk; a refusal redraws the refused entry, then
 * the plots it collided with, then the whole park. A rung nobody has watched
 * fire is indistinguishable from one that cannot, so this check makes it
 * fire two ways, every run:
 *
 * 1. **Geometry.** The real park's placement is probed (control: zero
 *    refusals, on a seed that solves). Then a door is put outside the
 *    boundary — `poi.nospot`, the boundary named. Then four walls ring a
 *    doormat with their faces beyond the router's arrival exemption —
 *    `poi.stranded`, every wall named and nothing else. Then a plot is put
 *    squarely on a doormat *inside* that exemption — and must NOT refuse,
 *    because a footprint is not solid (seed 1's ball pit). Blockers
 *    come from the plot table by geometry, so a plot this names is one the
 *    solver would redraw.
 * 2. **Machinery.** A child process solves the canonical layout with
 *    `LGP_LAYOUT_REFUSE=hotel:40` (refuse the hotel's doormat the first
 *    forty times it is probed; a forced refusal names the nearest plot as a
 *    pretend blocker and says `forced`) and its trace must show all three
 *    rungs — the hotel's own redraws, that blocker's redraws, decision zero
 *    — and still end `solved`. The hook is a `globalThis.process.env` read, which does
 *    not exist in a browser, so this is not a switch a shipped park can reach.
 *
 * Reads the geometry it proves against off the layout it built, and prints
 * it, so the transcript in a PR carries the input with the verdict.
 */
import { spawnSync } from 'node:child_process';

import { PARK_LAYOUT, probeDoormats, type PlacedEntry } from '../src/world/parkLayout.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { ARRIVAL_EXEMPT_NEAR } from '../src/world/streetRules.ts';

const failures: string[] = [];
const said: string[] = [];

const placed = [...PARK_LAYOUT.entries.values()];

// ------------------------------------------------------------- 1. geometry

// Control first: the park that solved must probe clean, or the mutations
// below prove nothing.
const control = probeDoormats(placed);
said.push(`control: ${placed.length} doormats on seed ${PARK_LAYOUT.seed}, ${control.length} refusal(s)`);
if (control.length > 0) {
  failures.push(
    `control failed: the solved layout probes with ${control.length} refusal(s): ` +
      control.map((r) => `${r.entry} ${r.kind}`).join(', '),
  );
}

const hotel = placed.find((entry) => entry.id === 'hotel');
if (!hotel) throw new Error('check:layout-rung: no hotel in the layout');

/** A synthetic square plot, as the solver would carry it. */
function plot(id: string, x: number, z: number, half: number): PlacedEntry {
  return {
    id,
    x,
    z,
    footprint: { kind: 'rect', halfX: half, halfZ: half },
    boundingRadius: half * Math.SQRT2,
    entranceX: x,
    entranceZ: z + half + 1.4,
    signYaw: 0,
  };
}

// The probe exempts, for each door, every plot within ARRIVAL_EXEMPT_NEAR of
// it — the router's own arrival exemption, and the lesson of seed 1 (a
// footprint is not solid; the castle's door stands inside the walkable ball
// pit by design). So a synthetic plot must stand beyond that reach to be an
// obstacle here at all, and "nowhere to stand" can only come from the
// boundary.

// (a) a door outside the park: nowhere within reach to stand, blocker the boundary.
const outside: PlacedEntry = {
  ...hotel,
  id: 'outsider',
  entranceX: 0,
  entranceZ: PARK_BOUNDARY.extent.maxZ + 20,
};
const squashed = probeDoormats([...placed, outside]).filter((r) => r.entry === 'outsider');
said.push(
  `a door 20 m outside the boundary at (0, ${outside.entranceZ.toFixed(1)}): ` +
    (squashed[0]
      ? `${squashed[0].kind}, blockers=[${squashed[0].blockers.join(',')}], non-plot=[${squashed[0].nonPlotBlockers.join(',')}]`
      : 'NO REFUSAL'),
);
if (!squashed[0]) failures.push('a door outside the boundary produced no refusal');
else {
  if (squashed[0].kind !== 'poi.nospot') failures.push(`expected poi.nospot, got ${squashed[0].kind}`);
  if (!squashed[0].nonPlotBlockers.includes('boundary')) failures.push('the boundary is not named for a door outside it');
}

// (b) four long thin plots ringing the hotel's doormat, their faces 12 m out —
// beyond the arrival exemption, so genuine obstacles — leave standable ground
// inside and no way in: `poi.stranded`, and every wall of the ring named.
const face = ARRIVAL_EXEMPT_NEAR + 5;
const ring: PlacedEntry[] = [
  { ...plot('ring-n', hotel.entranceX, hotel.entranceZ - face - 1, 1), footprint: { kind: 'rect', halfX: face + 2, halfZ: 1 } },
  { ...plot('ring-s', hotel.entranceX, hotel.entranceZ + face + 1, 1), footprint: { kind: 'rect', halfX: face + 2, halfZ: 1 } },
  { ...plot('ring-e', hotel.entranceX + face + 1, hotel.entranceZ, 1), footprint: { kind: 'rect', halfX: 1, halfZ: face + 2 } },
  { ...plot('ring-w', hotel.entranceX - face - 1, hotel.entranceZ, 1), footprint: { kind: 'rect', halfX: 1, halfZ: face + 2 } },
];
const boxed = probeDoormats([...placed, ...ring]).filter((r) => r.entry === 'hotel');
said.push(
  `four walls ringing the hotel doormat with faces ${face} m out: ` +
    (boxed[0] ? `${boxed[0].kind}, blockers=[${boxed[0].blockers.join(',')}]` : 'NO REFUSAL'),
);
if (!boxed[0]) failures.push('a doormat ringed by four walls produced no refusal');
else {
  if (boxed[0].kind !== 'poi.stranded') failures.push(`expected poi.stranded (standable but unreachable), got ${boxed[0].kind}`);
  const named = new Set(boxed[0].blockers);
  for (const wall of ring) {
    if (!named.has(wall.id)) failures.push(`ring wall ${wall.id} is not named as a blocker`);
  }
  const synthetic = new Set(ring.map((wall) => wall.id));
  for (const id of named) {
    if (!synthetic.has(id)) failures.push(`'${id}' is named as bounding the ring, but only the ring does`);
  }
}

// (c) the exemption itself, proved: a plot squarely on the doormat but within
// the arrival reach is NOT an obstacle — the ball pit case — so no refusal.
const onDoormat: PlacedEntry = {
  id: 'pit',
  x: hotel.entranceX,
  z: hotel.entranceZ,
  footprint: { kind: 'circle', radius: 3 },
  boundingRadius: 3,
  entranceX: hotel.entranceX,
  entranceZ: hotel.entranceZ + 4.4,
  signYaw: 0,
};
const exempted = probeDoormats([...placed, onDoormat]).filter((r) => r.entry === 'hotel');
said.push(`a 3 m plot on the hotel doormat (inside the ${ARRIVAL_EXEMPT_NEAR} m arrival exemption): ${exempted.length} refusal(s)`);
if (exempted.length > 0) failures.push('a plot within the arrival exemption refused the door it stands on — seed 1 again');

// ------------------------------------------------------------ 2. machinery

// The trace is on stderr (vitest hides stdout on passing runs; this is a plain
// Node script and reads both). `hotel:40` refuses the hotel's doormat the
// first forty times it is probed: twelve attempts on its own candidates (rung
// 1), then the pretend blocker's twelve (rung 2), then decision zero (rung 3)
// and a fresh draw that is refused a few more times — all three rungs must
// appear and the solve must still end. The geometry half above is what proves
// real blockers are named; this proves the ladder climbs.
const child = spawnSync(
  process.execPath,
  [
    '--no-warnings',
    '--import',
    './scripts/ts-extension-resolver-register.mjs',
    '--input-type=module',
    '-e',
    'await import("./src/world/parkLayout.ts");',
  ],
  {
    env: { ...process.env, LGP_LAYOUT_REFUSE: 'hotel:40' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
const traceLines = `${child.stdout}\n${child.stderr}`
  .split('\n')
  .filter((line) => line.startsWith('layout-trace:'));
const has = (pattern: RegExp): number => traceLines.filter((line) => pattern.test(line)).length;
const refusals = has(/ refusal .*entry=hotel/);
const rungOne = has(/ redraw .*rung=1 entry=hotel/);
const rungTwo = has(/ redraw .*rung=2 /);
const decisionZero = has(/ decision-zero /);
const solved = has(/ solved /);
said.push(
  `machinery (LGP_LAYOUT_REFUSE=hotel:40, seed ${PARK_LAYOUT.seed}): ${refusals} refusal(s), ` +
    `${rungOne} rung-1 redraw(s), ${rungTwo} rung-2 redraw(s), ${decisionZero} decision zero(s), solved=${solved}` +
    (child.status === 0 ? '' : `, child exit ${child.status}`),
);
if (child.status !== 0) failures.push(`the forced-refusal solve exited ${child.status}: ${child.stderr.slice(-400)}`);
// A floor, not an exact count: how many probes happen before the fortieth
// depends on the canonical layout (a dead-end draw probes nothing), which the
// base moves under this check. Thirty is past rung 1 (12) and a full rung 2.
if (refusals < 30) failures.push(`expected at least 30 forced refusals of the hotel, saw ${refusals}`);
if (rungTwo < 1) failures.push('expected the pretend blocker to be redrawn on rung 2 once the hotel ran out');
if (rungOne < 11) failures.push(`expected the hotel to exhaust its candidates on rung 1 (11 redraws), saw ${rungOne}`);
if (decisionZero < 1) failures.push('expected decision zero to be reached after the hotel exhausted its supply');
if (solved !== 1) failures.push(`expected exactly one solved line, saw ${solved}`);

// ------------------------------------------------------------------ verdict

for (const line of said) console.log(`  ${line}`);
if (failures.length > 0) {
  console.error(`check:layout-rung: ${failures.length} failure(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log('check:layout-rung OK — the doormat rung refuses on geometry, names its blockers, and unwinds.');
