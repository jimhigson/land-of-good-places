/**
 * **The radial conversion did not cost a child anywhere she has to be able to
 * stand** — `CLAUDE.md`'s first rule, asked of the collision rewrite.
 *
 * Two questions, and they need different instruments, because the two halves of
 * the world are different.
 *
 * ## 1. Indoors, nothing changed at all — and that is provable exactly
 *
 * `keepOutsFor` is the single owner of where a child must be able to stand, and
 * every disc it declares is on a **castle deck**: a flat interior space
 * hundreds of metres from the park's origin. `world/up.ts` branches on
 * `spaceAt` precisely so those keep plain `+Y`, so the honest assertion for the
 * keep-outs is not a flood fill — it is that the three helpers this work
 * introduced are the **identity** in an interior, to the last bit.
 *
 * That is worth more than a reachability probe would be. A flood fill over an
 * interior would answer "yes, still reachable" whether or not the frame was
 * right, because a lattice with eight neighbours routes round almost anything;
 * this project has had clean, decisive, wrong answers from exactly that shape,
 * and one was found on this very branch by an engineer deleting the space
 * branch and watching all three rooms still route. An exact-equality assertion
 * cannot do that. If a single interior coordinate stops being untouched, this
 * says so with the number.
 *
 * ## 2. Outdoors, an absolute top does NOT yet mean what it was registered to
 * mean — and this clause measures how far out it goes wrong
 *
 * **`CollisionWorld` is unchanged on this branch.** The conversion was written,
 * measured, and reverted, because it regressed two procgen invariants and the
 * reason is in `train/fence.ts` rather than in the collision code — see
 * HANDOFF-radial-collide.md. So the clause below is a **measurement with a
 * recorded expectation**, not a regression guard on shipped behaviour: it
 * reports the radius at which the shipped world-`y` comparison starts
 * disagreeing with the height a child actually has, so the number cannot
 * quietly change while nobody is looking.
 *
 * The outdoor half is where the change is real, and the thing that must not
 * break is the pairing: a collider whose top was taken from a *local* surface,
 * against a child standing on that same local surface. Before, both sides were
 * world `y` at two different columns, so the difference was mostly planet — the
 * railway fences (`train/fence.ts`) and bridge seams (`train/bridges.ts`) are
 * exactly that, pinned to a local road surface out where the lean is worst.
 *
 * The finding it records: approached from the **inward** side — from the middle
 * of the park, which is uphill in world `y` — a 1.1 m fence pinned to its own
 * local surface stops being solid at **d = 80 m** for a child 3 m back, and at
 * **d = 157 m** for one 1.2 m back. She walks through it. Approached from
 * outward the two frames agree everywhere, which is why a probe that only came
 * at it downhill would report all clear.
 *
 * Run: `pnpm run check:radial-solidity`
 */
import { terrainHeight } from '../src/world/terrain.ts';
import { footColumn, liftAlongUp, standHeight, walkHeight, isOutdoors } from '../src/world/up.ts';
import { keepOutsFor } from '../src/world/building/dressing.ts';
import { CASTLE_FLOORS } from '../src/world/building/floors.ts';
import { Vector3 } from 'three';

let failed = false;
const note = (line: string): void => process.stderr.write(`${line}\n`);

note('check:radial-solidity');
note('');

// ---------------------------------------------------------------------------
// 1. Indoors: the identity, exactly.
// ---------------------------------------------------------------------------

// Where the keep-out discs actually are. Read from `keepOutsFor` itself rather
// than from a list here, so this can never drift from the owner.
//
// **`keepOutsFor` returns deck-LOCAL coordinates, not world ones.** The first
// version of this file fed them straight to `spaceAt` and was told all 351 of
// them were out in the garden — `(19.2, 5.0)` is a perfectly ordinary spot on
// the grass as well as a spot on the mall floor. The control caught it; the
// identity assertion underneath it had "failed" by 2.32 m, which is the planet,
// measured at a point the keep-out has nothing to do with. Each floor's own
// origin is the transform, and `floors.ts` owns it.
const DECKS = CASTLE_FLOORS;
const keepOutPoints: { x: number; z: number; deck: number }[] = [];
for (const floor of DECKS) {
  const deck = floor.index;
  for (const local of keepOutsFor(deck)) {
    const disc = {
      x: floor.originX + local.x,
      z: floor.originZ + local.z,
      radius: local.radius,
    };
    // The centre, and eight points on the rim — a disc is an area, and a
    // conversion that was right at one point and wrong a metre away is the
    // failure being guarded.
    keepOutPoints.push({ x: disc.x, z: disc.z, deck });
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      keepOutPoints.push({
        x: disc.x + Math.cos(a) * disc.radius,
        z: disc.z + Math.sin(a) * disc.radius,
        deck,
      });
    }
  }
}

// CONTROL: these must genuinely be interior coordinates. If `spaceAt` ever
// stopped calling them interiors the identity assertion below would be testing
// the wrong claim — and would still pass, on the wrong grounds.
const strays = keepOutPoints.filter((p) => isOutdoors(p.x, p.z));
note(
  `CONTROL (the keep-outs are indoors): ${keepOutPoints.length} points read from keepOutsFor ` +
    `across ${DECKS.length} decks; ${strays.length} of them are in SPACE_GARDEN.`,
);
if (keepOutPoints.length < 20) {
  note('CONTROL FAILED: keepOutsFor returned almost nothing — this clause is asserting about nothing.');
  failed = true;
}
if (strays.length > 0) {
  note(
    `CONTROL FAILED: ${strays.length} keep-out points are outdoors, e.g. ` +
      `(${strays[0]?.x.toFixed(1)}, ${strays[0]?.z.toFixed(1)}). The identity claim below does not hold for them.`,
  );
  failed = true;
}

const HEIGHTS = [0, 0.5, 1.28, 3, 18] as const;
let worstIndoor = 0;
const scratch = new Vector3();
for (const p of keepOutPoints) {
  for (const y of HEIGHTS) {
    worstIndoor = Math.max(worstIndoor, Math.abs(walkHeight(p.x, y, p.z) - y));
    footColumn(p.x, y, p.z, 1.28, scratch);
    worstIndoor = Math.max(
      worstIndoor,
      Math.abs(scratch.x - p.x),
      Math.abs(scratch.z - p.z),
      Math.abs(scratch.y - (y - 1.28)),
    );
    liftAlongUp(p.x, y, p.z, 1.28, scratch);
    worstIndoor = Math.max(
      worstIndoor,
      Math.abs(scratch.x - p.x),
      Math.abs(scratch.z - p.z),
      Math.abs(scratch.y - (y + 1.28)),
    );
  }
}
note(
  `INDOORS: worst departure from the identity across ${keepOutPoints.length} keep-out points ` +
    `x ${HEIGHTS.length} heights = ${worstIndoor.toExponential(2)} m. Must be exactly 0.`,
);
if (worstIndoor !== 0) {
  note('FAILED: an interior coordinate is being moved by the radial helpers.');
  failed = true;
}

// CONTROL: the same three helpers must NOT be the identity outdoors, or the
// clause above is passing because they do nothing at all, anywhere.
const outdoorShift = Math.abs(walkHeight(157, 5, 0) - 5);
note(
  `CONTROL (the helpers are not inert): outdoors at d=157 m, walkHeight moves a height by ` +
    `${outdoorShift.toFixed(3)} m. Must be non-zero, or the identity above is vacuous.`,
);
if (!(outdoorShift > 0.5)) {
  note('CONTROL FAILED: the helpers do nothing outdoors either. The indoor result means nothing.');
  failed = true;
}
note('');

// ---------------------------------------------------------------------------
// 2. Outdoors: how far out a world-`y` absolute top stops meaning a height.
// Measured and reported. NOT asserted against shipped behaviour — see the
// docblock: the conversion that would fix it is reverted on this branch.
// ---------------------------------------------------------------------------

/** A fence's top above the surface it is pinned to, as `train/fence.ts` uses. */
const FENCE_HEIGHT = 1.1;
/** `Collision.ts`'s own JUMP_CLEARANCE_GRACE, restated for the model below. */
const GRACE = 0.15;

let ghosts = 0;
let probes = 0;
const firstGhostAt: number[] = [];
note('OUTDOORS: a 1.1 m fence pinned to its own local surface, approached from inward.');
for (const d of [0, 40, 80, 120, 157]) {
  for (const back of [1.2, 3.0]) {
    const surface = terrainHeight(d, 0);
    const top = surface + FENCE_HEIGHT;
    const mx = d - back;
    const my = terrainHeight(mx, 0);
    // What the shipped comparison decides: two world `y`s, two columns.
    const shippedSolid = !(my + GRACE >= top);
    // What a height above the ground says — both terms radial, planet cancelled.
    const trueSolid = !(standHeight(mx, my, 0) + GRACE >= standHeight(d, top, 0));
    probes += 1;
    if (shippedSolid !== trueSolid) {
      ghosts += 1;
      firstGhostAt.push(d);
    }
    note(
      `  d=${d.toString().padStart(3)} m, standing ${back.toFixed(1)} m inward: ` +
        `shipped says ${shippedSolid ? 'solid' : 'GHOST'}, height-above-ground says ${trueSolid ? 'solid' : 'ghost'}` +
        (shippedSolid !== trueSolid ? '   <-- she walks through a 1.1 m fence' : ''),
    );
  }
}
note(
  `  ${ghosts} of ${probes} probes disagree` +
    (ghosts > 0 ? `, the nearest at d = ${Math.min(...firstGhostAt)} m from the park's middle.` : '.'),
);
note(
  '  This is a MEASUREMENT, not a gate. `CollisionWorld` is unchanged on this ' +
    'branch and these ghosts are live in the game today. The expectation ' +
    'recorded when this was written: 4 of 10 disagree, nearest at 80 m. If ' +
    'that number moves, something changed — find out what before trusting it.',
);
if (ghosts === 0) {
  note(
    '  NOTE: no disagreement found at all. Either CollisionWorld was fixed (in ' +
      'which case turn this clause into an assertion) or this probe stopped ' +
      'reaching the case. It is not evidence of correctness on its own.',
  );
}
note('');
note(
  'What this check does NOT cover: the indoor clause proves the helpers are ' +
    'inert in an interior, which is a property of `world/up.ts` and not of any ' +
    'collision behaviour; the outdoor clause models `clearsTop` rather than ' +
    'calling `resolve`, so it would not notice `CollisionWorld` changing ' +
    'underneath it. Both are honest about what they are. The real gate is the ' +
    'one that cannot be written yet: the same two probes against the park\'s ' +
    'own fences and bridge seams, which needs `new World` to build again ' +
    '(a railD 0.0 crossing throw, first bad at merge 502ec802, not from this work).',
);

if (failed) {
  note('');
  note('check:radial-solidity FAILED');
}
process.exit(failed ? 1 : 0);
