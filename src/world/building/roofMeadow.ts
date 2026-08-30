import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { softMaterial } from './parts';
import { BENCH_CLEAR_RADIUS, deckBenchSpots, keepOutsFor, type KeepOut } from './dressing';
import { BUILDING_SHAFTS, deckIsSolid, regionContains, TOP_DECK } from './layout';

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
export const MEADOW_CELL = 1.2;

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

/** How many separate patches of long grass. */
const PATCH_COUNT = 3;

/** Nominal patch radius, before the edge wobble. */
const PATCH_RADIUS = 8.4;

/** Breathing room between a meadow cell and anything in {@link keepOutsFor}. */
const KEEP_OUT_MARGIN = 1.0;

/**
 * Offsets a cell is probed at against every shaft, in metres.
 *
 * The tuft is jittered up to `MEADOW_CELL * 0.3` off its cell centre and its
 * blades lean 0.13 m out, so the drawn clump reaches about 0.5 m — and
 * `check:castle` samples a prop's whole footprint, not its origin. 1.1 m
 * covers that with room to spare, which is what a shaft deserves.
 */
const SHAFT_PROBE = [-1.1, 0, 1.1] as const;

export interface MeadowCell {
  readonly x: number;
  readonly z: number;
}

export interface RoofMeadow {
  /** Every grid cell that is long grass. Also where the wild pets may stand. */
  readonly cells: readonly MeadowCell[];
  /** True if this world-XZ point is inside the long grass. */
  contains(x: number, z: number): boolean;
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
  const blocked: KeepOut[] = keepOutsFor(deck);
  const benches = deckBenchSpots(deck, blocked, deck === TOP_DECK);

  /** How far this point is from the nearest thing the grass must keep off —
   *  negative when it is inside one. The parapet counts as a thing. */
  const clearance = (x: number, z: number): number => {
    // A shaft comes down through **every** storey, hole in the floor or not:
    // the helter-skelter's helix, the bubble's tube and the trampoline's well
    // are all structure standing in that column, and `keepOutsFor` only lists
    // the helter's *entry* and only on the deck you board it from. The first
    // version of this meadow grew straight through the helter shaft on the
    // roof and `check:castle` said so, which is the check doing exactly the
    // job it was written for. A region test rather than a distance, because a
    // shaft is a rectangle or a circle and there is no radius to subtract.
    for (const shaft of BUILDING_SHAFTS) {
      for (const dx of SHAFT_PROBE) {
        for (const dz of SHAFT_PROBE) {
          if (regionContains(shaft.region, x + dx, z + dz)) return -1;
        }
      }
    }
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
      if (!deckIsSolid(deck, x, z)) continue;
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
    // Asked of a creature's live position, which is never on a grid point, so
    // it must be the *shape* test and not a cell lookup — but it must also
    // agree with `cells`, which is why both go through the same `contains`
    // and the same `clearance`.
    contains: (x, z) => clearance(x, z) > 0 && contains(x, z),
  };
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
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    const lean = 0.22 + (i % 2) * 0.16;
    const height = MEADOW_GRASS_HEIGHT * (i % 2 === 0 ? 1 : 0.78);
    const blade = new CylinderGeometry(0.022, 0.062, height, 4);
    blade.translate(0, height / 2, 0);
    blade.rotateZ(lean);
    blade.rotateY(angle);
    blade.translate(Math.cos(angle) * 0.13, 0, -Math.sin(angle) * 0.13);
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

  const turfGeometry = new PlaneGeometry(MEADOW_CELL * 1.5, MEADOW_CELL * 1.5);
  turfGeometry.rotateX(-Math.PI / 2);
  const turf = new InstancedMesh(
    turfGeometry,
    softMaterial(PALETTE.grassDark, 0.8),
    meadow.cells.length,
  );
  turf.name = `castle-roof-turf-${deck}`;
  turf.castShadow = false;
  turf.receiveShadow = true;

  const tufts = new InstancedMesh(
    tuftGeometry(),
    softMaterial(PALETTE.grass, 0.75),
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
      cell.x + rng.range(-MEADOW_CELL * 0.3, MEADOW_CELL * 0.3),
      0.03,
      cell.z + rng.range(-MEADOW_CELL * 0.3, MEADOW_CELL * 0.3),
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
