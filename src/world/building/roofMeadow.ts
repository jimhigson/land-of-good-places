import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z, PLAYER_RADIUS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { softMaterial } from './parts';
import { BENCH_CLEAR_RADIUS, deckBenchSpots, keepOutsFor, type KeepOut } from './dressing';
import {
  insideInterior,
  TOP_DECK,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
} from './layout';

/**
 * **The long grass on the roof garden** (issue #406).
 *
 * Jim, 30 August 2026: *"there should be wild animals of the same kinds as you
 * can have for pets roaming in the long grass."* This is the long grass. The
 * animals are in `WildPets.ts`, and they roam **this** region — one definition
 * of where the meadow is, asked by the thing that draws it and by the thing
 * that walks around in it, so a creature can never be found standing on bare
 * paving pretending to be hidden.
 *
 * ## Why it is a lawn with an edge, and not grass over the whole roof
 *
 * The roof has been reported sparse three times and answered twice with more
 * scenery. The temptation on the third go is to cover the plate — but grass
 * everywhere reads as *neglect*, and it would swallow the ten benches, the
 * pavilion and the slide's boarding marker, all of which are 0.44 m furniture
 * against 0.85 m grass.
 *
 * A meadow with a visible boundary reads as **deliberate**: a lawn somebody
 * let grow long, in a garden that is otherwise swept. It also gives the wild
 * animals somewhere that is legibly *theirs* — a child can see where the
 * animals live, which is most of why the roof becomes worth crossing.
 *
 * ## The region is derived, never written down
 *
 * #403 is halving the castle's floor area as this is written, and a hand-typed
 * patch centre would be a hole in the meadow or a meadow through the slide
 * entry the day it lands. So the patches are **found**: every candidate cell
 * scores its distance to the nearest thing it must keep off, and the patch
 * centres are the roomiest cells, greedily and deterministically. Shrink the
 * roof and the meadow moves to wherever the room now is.
 *
 * What it keeps off, all of it asked rather than restated:
 *
 * - **{@link keepOutsFor}** — the stairs, the lift lobby, the roundel, the
 *   pavilion, the ginormous slide's roof entry and the grown-up who waits by
 *   it. That list is the castle's one register of "somewhere a child must be
 *   able to stand", and `check:castle` already holds it to that.
 * - **{@link deckBenchSpots}** — the roof's own ten benches, which are placed
 *   by a seeded rejection sample and so exist nowhere as a list until asked.
 * - **The parapet trough border**, via {@link PARAPET_INSET}: the existing roof
 *   planting sits at 2.3 m in, so the grass starts outside it rather than
 *   growing up through it.
 *
 * ## Cost
 *
 * Two draw calls: one `InstancedMesh` of turf quads and one of grass tufts.
 * Neither casts a shadow. The roof garden goes from three draw calls to five,
 * and adding a burrow or a hundred more blades costs neither of them.
 */

/** How far in from the parapet the grass starts — clear of the trough border
 *  (planted at 2.3 m in, 0.8 m deep, with a crown that spills over the rim). */
const PARAPET_INSET = 3.9;

/** Grid pitch of the meadow, in metres. Every cell is one turf quad and one
 *  tuft, so this is simultaneously the density of both. */
export const MEADOW_CELL = 1.05;

/**
 * How tall a blade stands.
 *
 * The creatures are {@link PET_RENDER_HEIGHT} (1.46 m) and the brief asks for
 * them to be *half-hidden*. At 0.85 m a pet's head and ears clear the grass
 * while its body is in it — which is the thing worth seeing, because a
 * creature you can only half see is a creature worth walking over to. Any
 * taller and the animals vanish, which fails the whole point of putting them
 * there; any shorter and it is a lawn rather than long grass.
 *
 * On a 2.12 m child it comes to just above the knee.
 */
export const MEADOW_GRASS_HEIGHT = 0.85;

/**
 * Sides on a turf disc, and the radius that follows from it.
 *
 * The radius is **derived**: a disc has to reach a cell's furthest corner
 * (`MEADOW_CELL × √2 ÷ 2`) along its *flat edge*, which sits at
 * `R × cos(π / segments)` — so `R` is that corner distance divided back out,
 * plus a couple of centimetres of slack. Writing it as a literal is what put a
 * grid of pink specks through the first lawn.
 */
const TURF_SEGMENTS = 16;
const TURF_RADIUS = ((MEADOW_CELL * Math.SQRT2) / 2 / Math.cos(Math.PI / TURF_SEGMENTS)) + 0.02;

/** How many separate patches of long grass. */
const PATCH_COUNT = 3;

/** Nominal patch radius, before the edge wobble. */
const PATCH_RADIUS = 8.4;

// ------------------------------------------- how far a drawn tuft reaches
//
// The numbers below are the *drawn* extents of one clump, and they exist so
// {@link KEEP_OUT_MARGIN} can be derived from them instead of guessed. Keep
// them beside `tuftGeometry` and `buildRoofMeadow`'s instance loop, which are
// their only other readers.

/** How far a tuft's instance is jittered off its cell centre, per axis, so
 *  three hundred clumps do not read as a grid. Worst case is both axes at
 *  once, hence the diagonal. */
const TUFT_JITTER = MEADOW_CELL * 0.44;
const TUFT_JITTER_RADIAL = TUFT_JITTER * Math.SQRT2;

/** The largest an instance is scaled in XZ. */
const TUFT_MAX_SCALE = 1.18;

/**
 * How far the furthest blade tip stands from the clump's own origin, before
 * that scale: the widest a blade springs from the middle (`spread` 0.16), plus
 * how far the tallest blade's tip travels when it leans (`sin(0.3)` over
 * `MEADOW_GRASS_HEIGHT × 1.16`), plus the fattest blade's own half-width
 * (radius 0.1, scaled 1.3 across).
 */
const TUFT_BLADE_REACH = 0.16 + Math.sin(0.3) * (MEADOW_GRASS_HEIGHT * 1.16) + 0.1 * 1.3;

/** The whole footprint of one drawn clump, measured from its cell's centre. */
const TUFT_REACH = TUFT_JITTER_RADIAL + TUFT_BLADE_REACH * TUFT_MAX_SCALE;

/**
 * Breathing room between a meadow **cell centre** and anything in
 * {@link keepOutsFor} — **derived from what is drawn, not chosen**.
 *
 * It was a typed `1.0`, and `check:castle` caught what that misses: it
 * measures **a prop's whole footprint** against `keep-out radius +
 * PLAYER_RADIUS`, and a cell centre is not a footprint. A tuft is jittered off
 * its centre and then leans and splays on top of that, so the grass a child
 * walks into stands up to {@link TUFT_REACH} further out than the point this
 * margin was protecting. Deck 2's grass came within **8.08 m** of the
 * pavilion's keep-out where **8.22 m** was needed — 0.14 m, and a margin
 * nobody could have arrived at by choosing a rounder number.
 *
 * `PLAYER_RADIUS` is the game's, not the generator's, exactly as the procgen
 * rules require: what matters is whether a child fits, not whether the
 * generator hit its own target.
 */
const KEEP_OUT_MARGIN = PLAYER_RADIUS + TUFT_REACH;

/**
 * How much room the trampoline gets, beyond its own pad.
 *
 * **The shafts this used to probe against no longer exist.** `BUILDING_SHAFTS`,
 * `DECK_HOLES` and `deckIsSolid` were deleted when the castle's floors became
 * three disjoint spaces (#377/#380): a shaft is a hole through a slab so that
 * something can travel between two storeys, and there are no two storeys left
 * to travel between. That deletion removed the whole class of fault this
 * feature tripped over three times — the meadow grew through the
 * helter-skelter's helix on its first run and `check:castle` said so.
 *
 * One neighbour survives the split, and it is a *surface* rather than a hole:
 * the trampoline is a toy on the roof garden now. It is not in
 * {@link keepOutsFor} — that list predates the trampoline being a roof
 * fixture — so the meadow names it here rather than growing 0.85 m grass up
 * through a pad a child bounces on. The pad is {@link TRAMPOLINE_RADIUS}
 * across; the margin is a stride, so she can land off the edge of it into
 * paving rather than into grass she cannot see her feet through.
 */
const TRAMPOLINE_MARGIN = 1.6;

export interface MeadowCell {
  readonly x: number;
  readonly z: number;
}

export interface RoofMeadow {
  /** Every grid cell that is long grass. Also where the wild pets may stand. */
  readonly cells: readonly MeadowCell[];
  /** True if this world-XZ point is inside the long grass. */
  contains(x: number, z: number): boolean;
  /**
   * How much room this point has before it reaches anything the garden must
   * keep off — a keep-out, a bench, the parapet — in metres, negative inside.
   *
   * Exposed because **the grass and the burrows measure against the same
   * keep-outs**, and handing out the number rather than a second copy of the
   * rule is what stops the two drifting.
   *
   * The threshold this is measured at is the *tuft's* — {@link KEEP_OUT_MARGIN}
   * is `PLAYER_RADIUS + TUFT_REACH`, and a tuft reaches further than a burrow
   * mound does, because it is jittered off its cell centre and then leans and
   * splays. So a cell with any clearance at all can already hold a mound; see
   * {@link roofBurrows}, which used to add `BURROW_RADIUS + PLAYER_RADIUS` on
   * top of this and was charging the burrow for the tuft's jitter twice.
   */
  clearanceAt(x: number, z: number): number;
}

const meadowCache = new Map<number, RoofMeadow>();

/**
 * The meadow's *shape*, with no geometry built — what `WildPets.ts` asks so it
 * can keep its creatures in the grass, and what {@link buildRoofMeadow} asks so
 * it can draw them in the same place.
 *
 * Cached per deck because both callers want it and the search is a few
 * thousand distance tests; it is pure and deterministic, so one answer is the
 * only answer.
 */
export function roofMeadow(deck: number): RoofMeadow {
  const cached = meadowCache.get(deck);
  if (cached) return cached;
  const built = findMeadow(deck);
  meadowCache.set(deck, built);
  return built;
}

function findMeadow(deck: number): RoofMeadow {
  const isRoof = deck === TOP_DECK;
  const blocked: KeepOut[] = [...keepOutsFor(deck)];
  // The benches are sampled against the *castle's* keep-out list, so this has
  // to be added after they are asked for or the two would disagree about what
  // the roof contains.
  const benches = deckBenchSpots(deck, blocked, isRoof);
  if (isRoof) {
    blocked.push({
      x: TRAMPOLINE_X,
      z: TRAMPOLINE_Z,
      radius: TRAMPOLINE_RADIUS + TRAMPOLINE_MARGIN,
    });
  }

  /** How far this point is from the nearest thing the grass must keep off —
   *  negative when it is inside one. The parapet counts as a thing. */
  const clearance = (x: number, z: number): number => {
    let best = Math.min(
      INTERIOR_HALF_X - PARAPET_INSET - Math.abs(x),
      INTERIOR_HALF_Z - PARAPET_INSET - Math.abs(z),
    );
    for (const k of blocked) {
      best = Math.min(best, Math.hypot(x - k.x, z - k.z) - (k.radius + KEEP_OUT_MARGIN));
    }
    for (const b of benches) {
      best = Math.min(best, Math.hypot(x - b.x, z - b.z) - BENCH_CLEAR_RADIUS);
    }
    return best;
  };

  // Every cell the grass is *allowed* to occupy, with its roominess.
  const free: { x: number; z: number; room: number }[] = [];
  const halfX = Math.floor((INTERIOR_HALF_X - PARAPET_INSET) / MEADOW_CELL);
  const halfZ = Math.floor((INTERIOR_HALF_Z - PARAPET_INSET) / MEADOW_CELL);
  for (let ix = -halfX; ix <= halfX; ix += 1) {
    for (let iz = -halfZ; iz <= halfZ; iz += 1) {
      const x = ix * MEADOW_CELL;
      const z = iz * MEADOW_CELL;
      // The plate has no holes in it any more, but the loop bounds are a grid
      // and the plate is a rectangle: ask the plate rather than trusting the
      // arithmetic that generated the indices.
      if (!insideInterior(x, z)) continue;
      const room = clearance(x, z);
      if (room <= 0) continue;
      free.push({ x, z, room });
    }
  }

  // Patch centres: the roomiest free cells, greedily, kept apart so three
  // patches are three patches rather than one blob counted three times.
  const centres: { x: number; z: number }[] = [];
  const byRoom = [...free].sort((a, b) => b.room - a.room || a.x - b.x || a.z - b.z);
  for (const cell of byRoom) {
    if (centres.length >= PATCH_COUNT) break;
    if (centres.some((c) => Math.hypot(cell.x - c.x, cell.z - c.z) < PATCH_RADIUS * 1.5)) continue;
    centres.push({ x: cell.x, z: cell.z });
  }

  // A wobbly edge, so a patch reads as a lawn rather than as a crop circle.
  // Seeded per patch and evaluated from the angle, so it is a property of the
  // shape and every caller gets the same boundary.
  const wobble = centres.map((_, i) => new Rng(0x6a55 + i * 131).range(0, Math.PI * 2));
  const radiusAt = (index: number, angle: number): number => {
    const phase = wobble[index] ?? 0;
    return PATCH_RADIUS * (0.78 + 0.22 * (0.5 + 0.5 * Math.sin(angle * 3 + phase)));
  };

  const contains = (x: number, z: number): boolean => {
    for (let i = 0; i < centres.length; i += 1) {
      const c = centres[i];
      if (!c) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d <= radiusAt(i, Math.atan2(dz, dx))) return true;
    }
    return false;
  };

  const cells = free
    .filter((cell) => contains(cell.x, cell.z))
    .map(({ x, z }): MeadowCell => ({ x, z }));

  return {
    cells,
    clearanceAt: clearance,
    // Asked of a creature's live position, which is never on a grid point, so
    // it must be the *shape* test and not a cell lookup — but it must also
    // agree with `cells`, which is why both go through the same `contains`
    // and the same `clearance`.
    contains: (x, z) => clearance(x, z) > 0 && contains(x, z),
  };
}

// ------------------------------------------------------------------- burrows

/**
 * How many burrows the long grass has.
 *
 * Five, against a live population of four (see `WildPets.ts`): there must
 * always be at least one hole that is *not* the one a creature came out of,
 * because the whole shape of the thing is "pops out of one, dives into a
 * different one". Four burrows and four creatures could deadlock into every
 * hole being spoken for.
 */
export const BURROW_COUNT = 5;

/**
 * How far apart two burrows would *like* to be — far enough that a creature
 * crossing between them is a *journey* a child can watch and cut off, rather
 * than a hop, and far enough that two holes do not read as one wide patch of
 * bare earth.
 *
 * **A preference, not a gate.** It was a gate, and the castle floor split
 * (#377/#380) is what showed why that was wrong. The meadow's own placement
 * absorbed the split exactly as it was designed to — it found new room and
 * moved — but this number did not move with it, and six metres of compulsory
 * spacing on the smaller plate silently returned **three** burrows where
 * {@link BURROW_COUNT} asks for five. Nothing was red. A hole that is never dug
 * looks precisely like a roof, and half the meadow had no burrow in it at all.
 *
 * That is the general trap in derived placement: deriving the *positions* is
 * only half of it, because a hard threshold measured against the old floor is
 * still a typed-in number, and it fails by producing *less* rather than by
 * failing. So the count is now the requirement and the spacing is what gets
 * relaxed to meet it, down to {@link BURROW_MIN_SPACING}.
 */
const BURROW_SPACING = 6;

/**
 * The spacing below which two burrows stop being two burrows.
 *
 * Two mounds {@link BURROW_RADIUS} across need to leave a child room to walk
 * between them, and `WildPets.burrowAwayFrom` treats anything within 2 m of a
 * creature as "the hole it came out of" — so holes closer together than that
 * would make one unreachable as a destination. Four metres clears both with
 * room over. If even this cannot seat {@link BURROW_COUNT}, fewer and
 * better-spaced burrows is the right answer and the meadow simply has fewer.
 */
export const BURROW_MIN_SPACING = 4;

/** The mound's outer radius — what a creature aims at, and what the grass and
 *  the tap target are sized from. */
export const BURROW_RADIUS = 0.85;

export interface Burrow {
  readonly x: number;
  readonly z: number;
}

const burrowCache = new Map<number, readonly Burrow[]>();

/**
 * Where the burrows are — derived from the meadow, never typed.
 *
 * Same discipline as the meadow itself: these come out of {@link roofMeadow}'s
 * own cells, so a burrow is always *in* the long grass by construction rather
 * than by a coordinate somebody checked once. When the castle's floor split
 * (#377/#380) took the roof plate down to 21.21 x 15.56 m half-extents, the
 * meadow did move and the burrows moved with it — though see
 * {@link BURROW_SPACING} for the half of that claim which did *not* hold.
 *
 * This used to re-test each candidate against `BUILDING_SHAFTS` on top of what
 * the meadow already excluded, because a burrow is a hole a creature walks
 * *into* and a burrow inside the helter-skelter's shaft would be a creature
 * vanishing down a slide rather than a tuft of grass clipping a wall. **There
 * are no shafts now** (#377/#380), so that second test is gone with them and
 * the meadow's own clearance is the whole answer.
 */
export function roofBurrows(deck: number): readonly Burrow[] {
  const cached = burrowCache.get(deck);
  if (cached) return cached;

  const meadow = roofMeadow(deck);
  const cells = meadow.cells;
  const chosen: Burrow[] = [];
  /**
   * How much room a burrow needs **beyond what the grass around it already
   * has** — which, now that {@link KEEP_OUT_MARGIN} is derived, is none.
   *
   * `check:castle` measures a prop's whole footprint against
   * `keep-out radius + PLAYER_RADIUS`. For a mound that footprint is
   * {@link BURROW_RADIUS}, flat on the ground and centred on its cell. For a
   * tuft it is {@link TUFT_REACH} — larger, because a tuft is jittered off its
   * cell centre *and then* leans and splays. `clearanceAt` is measured against
   * the tuft's requirement, so **a cell that can hold grass can already hold a
   * mound**, and asking for `BURROW_RADIUS + PLAYER_RADIUS` on top of it was
   * charging the burrow for the tuft's jitter a second time.
   *
   * That double charge cost real burrows rather than being merely untidy: it
   * took the roof from five holes to four the moment the margin became honest.
   * The subtraction below is what the two footprints actually differ by, and
   * it clamps at zero rather than going negative, so a burrow is never allowed
   * *closer* than the grass it sits in.
   *
   * Still asked of {@link RoofMeadow.clearanceAt} rather than re-derived from
   * the keep-out list, which is the part that was always right: one
   * measurement, two thresholds, no second copy of the list to fall out of
   * step.
   */
  const needed = Math.max(0, BURROW_RADIUS - TUFT_REACH);
  const eligible = cells.filter((cell) => meadow.clearanceAt(cell.x, cell.z) >= needed);

  /**
   * **Farthest-point selection, not first-fit.**
   *
   * Walking the meadow's cells in their own order and taking the first that
   * clears its neighbours is the obvious loop, and it put all five burrows in
   * one corner: cells are generated `x` ascending, so the greedy pass fills the
   * westernmost patch and never reaches the others. Measured — the five landed
   * in x ∈ [-9.6, 1.2], on a plate 60 m across.
   *
   * That matters more than tidiness. The roof garden is the floor with no
   * shops and no hall, and #403's engineer still calls it *"a flat lilac
   * plain"*; five holes huddled in one quarter leave three quarters of it
   * exactly as empty as before. Spreading them is most of what makes the deck
   * feel inhabited, and it is also what makes a creature's walk from one
   * burrow to another cross the roof rather than shuffle across a corner.
   *
   * So: start at the roomiest cell, then repeatedly take the eligible cell
   * **farthest from everything chosen so far**. Deterministic, no seed needed,
   * and it naturally lands one burrow per patch before doubling up.
   */
  let first: { x: number; z: number } | null = null;
  let bestRoom = -Infinity;
  for (const cell of eligible) {
    const room = meadow.clearanceAt(cell.x, cell.z);
    if (room > bestRoom) {
      bestRoom = room;
      first = cell;
    }
  }

  const seatAt = (spacing: number): Burrow[] => {
    if (!first) return [];
    const seated: Burrow[] = [{ x: first.x, z: first.z }];
    while (seated.length < BURROW_COUNT) {
      let pick: { x: number; z: number } | null = null;
      let bestDistance = -Infinity;
      for (const cell of eligible) {
        let nearest = Infinity;
        for (const b of seated) nearest = Math.min(nearest, Math.hypot(cell.x - b.x, cell.z - b.z));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          pick = cell;
        }
      }
      // Nothing left that is far enough from what is already down.
      if (!pick || bestDistance < spacing) break;
      seated.push({ x: pick.x, z: pick.z });
    }
    return seated;
  };

  /**
   * **Take the roomiest arrangement that seats them all**, relaxing the
   * spacing a metre at a time rather than accepting a short count.
   *
   * The first pass is the one that used to be the whole function, so a roof
   * with room for five well-spaced burrows gets exactly what it always got and
   * this loop stops after one iteration. It is only a smaller or busier
   * meadow that pays for the extra passes, and it pays a few thousand distance
   * tests once at construction.
   */
  let seated = seatAt(BURROW_SPACING);
  for (
    let spacing = BURROW_SPACING - 1;
    seated.length < BURROW_COUNT && spacing >= BURROW_MIN_SPACING;
    spacing -= 1
  ) {
    const relaxed = seatAt(spacing);
    if (relaxed.length > seated.length) seated = relaxed;
  }
  chosen.push(...seated);

  burrowCache.set(deck, chosen);
  return chosen;
}

/**
 * Draws the burrows: a ring of turned earth with a dark mouth in it.
 *
 * Two instanced meshes for however many holes there are. The mouth is a flat
 * disc rather than a modelled tunnel — at this camera you never see into it,
 * and a creature is hidden by the grass long before it reaches the hole.
 */
export function buildBurrows(deck: number): Group | null {
  const burrows = roofBurrows(deck);
  if (burrows.length === 0) return null;

  const group = new Group();
  group.name = `castle-roof-burrows-${deck}`;

  const mounds = new InstancedMesh(
    // Wider at the bottom than the top: a heap of earth, not a plant pot.
    new CylinderGeometry(BURROW_RADIUS * 0.72, BURROW_RADIUS, 0.24, 12),
    softMaterial(PALETTE.barkDark, 0.85),
    burrows.length,
  );
  mounds.name = `castle-roof-burrow-mounds-${deck}`;
  mounds.castShadow = false;
  mounds.receiveShadow = true;

  const mouthGeometry = new CircleGeometry(BURROW_RADIUS * 0.52, 14);
  mouthGeometry.rotateX(-Math.PI / 2);
  const mouths = new InstancedMesh(mouthGeometry, softMaterial(PALETTE.ink, 0.9), burrows.length);
  mouths.name = `castle-roof-burrow-mouths-${deck}`;
  mouths.castShadow = false;
  mouths.receiveShadow = false;

  const matrix = new Matrix4();
  const flat = new Quaternion();
  const position = new Vector3();
  const unit = new Vector3(1, 1, 1);
  burrows.forEach((burrow, index) => {
    position.set(burrow.x, 0.12, burrow.z);
    matrix.compose(position, flat, unit);
    mounds.setMatrixAt(index, matrix);
    // Just proud of the mound's flat top (0.24), so it reads as a hole in the
    // earth rather than z-fighting with it.
    position.set(burrow.x, 0.245, burrow.z);
    matrix.compose(position, flat, unit);
    mouths.setMatrixAt(index, matrix);
  });
  mounds.instanceMatrix.needsUpdate = true;
  mouths.instanceMatrix.needsUpdate = true;

  group.add(mounds, mouths);
  return group;
}

// ------------------------------------------------------------------ geometry

/**
 * One clump of grass: five tapered blades, leaning out and away from each
 * other. Merged into a single geometry so a clump is one instance rather than
 * five, which is what keeps the whole meadow to one draw call.
 *
 * Tapered cylinders rather than cones, for the reason RiPika's ears are
 * (`ripika.ts`): a needle-sharp point is the fastest way to make something
 * cute look spiky, and ART_DIRECTION §1 asks for chunky.
 */
function tuftGeometry(): BufferGeometry {
  const blades: BufferGeometry[] = [];
  // Seeded here, not passed in: every clump shares one geometry (that is what
  // keeps the meadow to one draw call), so this randomness runs **once** and
  // must be identical on every reload — ART_DIRECTION §7's no-`Math.random()`
  // rule.
  const rng = new Rng(0x6a55c1);
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    // **Jittered, not evenly radial.** Three shapes failed before this one:
    //
    // 1. Thin blades leaning 0.22–0.38 rad read as a *wire tripod* — a little
    //    spider standing on a lawn.
    // 2. Chunky, near-upright and seven of them within 0.1 m of the centre
    //    fused into a solid cone: a field of tiny fir trees.
    // 3. Five *evenly spaced* angles with matched leans made a symmetrical
    //    fan — which from the game camera is a row of little **teepees**.
    // 4. Jittering the bearings fixed the teepee but leaning them up to
    //    0.62 rad and starting them up to 0.26 m apart splayed each clump into
    //    a **spiky starburst** — a field of thistles, or caltrops.
    //
    // A real clump is lopsided *and mostly upright*: blades at uneven
    // bearings, springing from close together, most standing nearly straight
    // with one or two arching over, and no two the same height. So the jitter
    // stays (it is what killed the teepee) and the splay comes back in.
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.55, 0.55);
    const lean = rng.range(0.05, 0.3);
    const height = MEADOW_GRASS_HEIGHT * rng.range(0.76, 1.16);
    // A cone, not a tapered cylinder: a flat top face however small is a
    // speck of specular in a field of hundreds.
    const blade = new CylinderGeometry(0, rng.range(0.062, 0.1), height, 5);
    blade.scale(1.3, 1, 0.55);
    blade.translate(0, height / 2, 0);
    blade.rotateZ(lean);
    blade.rotateY(angle);
    const spread = rng.range(0.05, 0.16);
    blade.translate(Math.cos(angle) * spread, 0, -Math.sin(angle) * spread);
    blades.push(blade);
  }
  const first = blades[0];
  if (!first) throw new Error('roofMeadow: the grass tuft built nothing.');
  return mergeGeometries(blades, false) ?? first;
}

/**
 * Draws the long grass: a turf quad and a grass clump per meadow cell, two
 * instanced meshes, no shadows.
 *
 * The turf is not decoration on top of decoration — without it the roof's pink
 * paving shows between the clumps and the meadow reads as weeds pushing
 * through a patio. It is one flat quad per cell, slightly oversized so
 * neighbours overlap and no seam of pink survives.
 */
export function buildRoofMeadow(deck: number): Group | null {
  const meadow = roofMeadow(deck);
  if (meadow.cells.length === 0) return null;

  const group = new Group();
  group.name = `castle-roof-meadow-${deck}`;

  /**
   * **A disc, not a square — and sized off its *inradius*, not its radius.**
   *
   * Square turf tiles gave the lawn a stair-stepped edge that read as an
   * unfinished tilemap and threw away the wobbly patch outline the region goes
   * to the trouble of computing. Discs scallop instead of stepping.
   *
   * The sizing then went wrong in a way worth writing down. A cell's furthest
   * corner is `MEADOW_CELL × √2 ÷ 2` = 0.849 m away, so a 0.852 m radius looks
   * like it covers — but an `InstancedMesh` disc is a **polygon**, and a
   * 12-gon's flat edge sits at `R × cos(15°)` = 0.823 m. That 26 mm shortfall
   * showed up on screen as a **regular grid of pink specks** through the lawn:
   * the paving, seen through the diagonal gaps between neighbouring tiles.
   *
   * So the radius is derived from the coverage it has to give
   * ({@link TURF_SEGMENTS} and the half-diagonal), never guessed — the polygon
   * count and the radius can no longer disagree.
   */
  const turfGeometry = new CircleGeometry(TURF_RADIUS, TURF_SEGMENTS);
  turfGeometry.rotateX(-Math.PI / 2);
  const turf = new InstancedMesh(
    turfGeometry,
    softMaterial(PALETTE.leafDeep, 0.8),
    meadow.cells.length,
  );
  turf.name = `castle-roof-turf-${deck}`;
  turf.castShadow = false;
  turf.receiveShadow = true;

  const tufts = new InstancedMesh(
    tuftGeometry(),
    softMaterial(PALETTE.grassLight, 0.75),
    meadow.cells.length,
  );
  tufts.name = `castle-roof-grass-${deck}`;
  tufts.castShadow = false;
  tufts.receiveShadow = true;

  const rng = new Rng(0x6a5511 + deck);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3();
  const flat = new Quaternion();

  meadow.cells.forEach((cell, index) => {
    // The turf lies flat and unrotated: a rotated quad would show its corners
    // past its neighbour's edge, which is a seam of pink paving.
    position.set(cell.x, 0.02, cell.z);
    scale.setScalar(1);
    matrix.compose(position, flat, scale);
    turf.setMatrixAt(index, matrix);

    // The clumps do turn, and vary in size, or three hundred identical tufts
    // read as wallpaper.
    rotation.setFromAxisAngle(axis, rng.range(0, Math.PI * 2));
    position.set(
      cell.x + rng.range(-MEADOW_CELL * 0.44, MEADOW_CELL * 0.44),
      0.03,
      cell.z + rng.range(-MEADOW_CELL * 0.44, MEADOW_CELL * 0.44),
    );
    const size = rng.range(0.82, 1.18);
    scale.set(size, rng.range(0.86, 1.14), size);
    matrix.compose(position, rotation, scale);
    tufts.setMatrixAt(index, matrix);
  });
  turf.instanceMatrix.needsUpdate = true;
  tufts.instanceMatrix.needsUpdate = true;

  group.add(turf, tufts);
  return group;
}
