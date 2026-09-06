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
 *    refusals, on a seed that solves). Then a *synthetic* plot is dropped on
 *    one doormat — the refusal must name that entry, be `poi.nospot`, and
 *    name the synthetic plot as its only blocker. Then synthetic plots box a
 *    doormat in at a distance — `poi.stranded`, every wall the pocket presses
 *    on named and nothing else. Blockers
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

// (a) a plot squarely on the hotel's doormat: nowhere within reach to stand.
// A CIRCLE, deliberately — a CollisionWorld rectangle is four walls round a
// hollow middle (CLAUDE.md), so a rectangle here would leave standable,
// unreachable ground inside it and read as `poi.stranded` instead.
const onDoormat: PlacedEntry = {
  id: 'boxer',
  x: hotel.entranceX,
  z: hotel.entranceZ,
  footprint: { kind: 'circle', radius: 3 },
  boundingRadius: 3,
  entranceX: hotel.entranceX,
  entranceZ: hotel.entranceZ + 4.4,
  signYaw: 0,
};
const squashed = probeDoormats([...placed, onDoormat]).filter((r) => r.entry === 'hotel');
said.push(
  `boxer, a 3 m circle on the hotel doormat (${hotel.entranceX.toFixed(1)}, ${hotel.entranceZ.toFixed(1)}): ` +
    (squashed[0]
      ? `${squashed[0].kind}, blockers=[${squashed[0].blockers.join(',')}]`
      : 'NO REFUSAL'),
);
if (!squashed[0]) failures.push('a plot on the hotel doormat produced no refusal for the hotel');
else {
  if (squashed[0].kind !== 'poi.nospot') failures.push(`expected poi.nospot, got ${squashed[0].kind}`);
  if (squashed[0].blockers.join(',') !== 'boxer') failures.push(`expected exactly the covering plot named, got [${squashed[0].blockers.join(',')}]`);
}

// (b) four plots boxing the doormat in at 4 m: standable ground inside the
// box, none of it reachable. Every wall of the box must be named.
const gap = 4;
const box = [
  plot('box-n', hotel.entranceX, hotel.entranceZ - gap - 1, 1),
  plot('box-s', hotel.entranceX, hotel.entranceZ + gap + 1, 1),
  plot('box-e', hotel.entranceX + gap + 1, hotel.entranceZ, 1),
  plot('box-w', hotel.entranceX - gap - 1, hotel.entranceZ, 1),
];
// Two-metre plots four metres out leave 1 m gaps at the corners for a 1.24 m
// child — the walker radius fattens each plot's stamp past the corner, so
// the box is closed on the grid. Corner plots make it closed by geometry too.
// Not every corner need be NAMED: the hotel's own stamp reaches into the box
// on its side, and a corner plot buried in it never bounds the pocket — the
// derivation names what the pocket presses on, and only that.
const corners = [
  plot('box-ne', hotel.entranceX + gap, hotel.entranceZ - gap, 1),
  plot('box-nw', hotel.entranceX - gap, hotel.entranceZ - gap, 1),
  plot('box-se', hotel.entranceX + gap, hotel.entranceZ + gap, 1),
  plot('box-sw', hotel.entranceX - gap, hotel.entranceZ + gap, 1),
];
const boxed = probeDoormats([...placed, ...box, ...corners]).filter((r) => r.entry === 'hotel');
said.push(
  `eight 2 m plots boxing the hotel doormat at ${gap} m: ` +
    (boxed[0] ? `${boxed[0].kind}, blockers=[${boxed[0].blockers.join(',')}]` : 'NO REFUSAL'),
);
if (!boxed[0]) failures.push('a doormat boxed in by eight plots produced no refusal');
else {
  if (boxed[0].kind !== 'poi.stranded') failures.push(`expected poi.stranded (standable but unreachable), got ${boxed[0].kind}`);
  const named = new Set(boxed[0].blockers);
  for (const wall of box) {
    if (!named.has(wall.id)) failures.push(`box wall ${wall.id} is not named as a blocker`);
  }
  const synthetic = new Set([...box, ...corners].map((wall) => wall.id));
  for (const id of named) {
    if (!synthetic.has(id)) failures.push(`'${id}' is named as bounding the box, but only the box does`);
  }
}

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
