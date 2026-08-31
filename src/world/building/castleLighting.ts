import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BUILDING_WALL_THICKNESS,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  PLAYER_RADIUS,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng } from '../../core/mathUtils';
import { toonMaterial, decal } from '../../art/style/materials';
import { castleSootTexture } from '../../core/textures';
import { softMaterial } from './parts';
import { BEAM_UNDERSIDE, SCONCE_HEADROOM, SCONCE_MOUNT_Y } from './castleFabric';
import {
  HALL_DECK,
  insideInterior,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  onPlate,
  TOP_DECK,
} from './layout';
import { keepOutsFor } from './dressing';

/**
 * **Fire in the castle** (issues #363 and #376).
 *
 * Jim, 29 August 2026: *"Castle is better but still feels very sparse."* The
 * room's biggest single absence was not furniture — it was that **nothing in it
 * emitted or moved.** Every surface was lit by one fixed directional key from
 * the same corner of the sky for ever, which reads as a render rather than a
 * place.
 *
 * `HANDOFF-castle-interior-363.md` §7 designed this and never built it. What
 * follows is that design, with the two places it needed correcting marked.
 *
 * ## No lights. Not one.
 *
 * Issue #251 records the shadow pass at 57% of draw calls, and the cutaway
 * fader shows **every** storey up to the one the player is on — not just that
 * one — so `PointLight`s parented per storey would accumulate to thirty by the
 * roof. The whole cost of "warm and flickering" is instead paid by an emissive
 * material, which costs a uniform rather than a render pass.
 *
 * ## Two draw calls per storey, and the design said one
 *
 * The design asked for a single instanced mesh of flames. It is **two**: an
 * outer flame and a brighter inner core, because one flat cone in one colour
 * reads as an orange traffic cone rather than as fire, and a second material is
 * the only way to get two tones out of an instanced mesh without a custom
 * shader (which ART_DIRECTION §5's effects rule forbids for exactly the reason
 * it would apply here — one more thing to keep in step with the park's
 * lighting). So the honest figure is **two instanced meshes per enclosed
 * storey, eight in the whole building, and zero lights** — see the measurement
 * in `HANDOFF-castle-interior-376.md` §5 rather than trusting this sentence.
 *
 * ## The trap that would have eaten the flicker
 *
 * `FloorFader.addLayer` **claims materials by identity and clones any material
 * a later layer already uses.** One flame material shared across five storeys
 * would therefore be silently cloned four times; the per-frame write would land
 * on the original; and four storeys out of five would not flicker, with the
 * code, the material and the mesh all looking correct on inspection. That is
 * the hood-face bug's exact shape.
 *
 * So {@link CastleFire} keeps **a distinct pair of materials per storey** and
 * writes the ones it actually handed to the mesh. The design wanted per-storey
 * materials anyway, for the unrelated reason that a whole wall of torches
 * should breathe together — this is why it is not merely a preference.
 */

// --------------------------------------------------------------- anchors

/** The inner face of the north and south walls, in interior-local metres. */
const WALL_FACE_Z = INTERIOR_HALF_Z - BUILDING_WALL_THICKNESS / 2;
/** The inner face of the east and west walls. */
const WALL_FACE_X = INTERIOR_HALF_X - BUILDING_WALL_THICKNESS / 2;

/**
 * **Where a torch's fire is** — the offset from a wall bracket's back plate to
 * the **base of the flame**, in the game's frame: `out` along the bracket's own
 * +Z (away from the wall), `up` from {@link SCONCE_MOUNT_Y}.
 *
 * ## This constant deliberately changes hands
 *
 * `HANDOFF-castle-interior-363.md` §4.4 had the **Artist** report a
 * `SCONCE_CUP_OFFSET` which the Engineer would then type into `castleFabric.ts`
 * — marked "provisional", which is what a value is called when everyone already
 * knows it is a second copy. It then went stale within a day: the Artist's
 * second round moved it 0.3025 → 0.2475 and the reconciliation log had to say
 * out loud that the typed figure "must not be used".
 *
 * The fix is not a better copy, it is **one owner**. The flame is built here,
 * so where the flame sits is decided here, and the sconce's cup is authored to
 * land on this number. The figures are the Artist's own measured ones, adopted
 * as mine, so nothing already built has moved — but there is now no second
 * definition left to go stale, and `check:castle` measures the sconce against
 * this when batch 1 is wired.
 */
/**
 * How far the cup stands off the wall. **Split out of {@link CASTLE_TORCH_CUP}
 * as a plain number so `art/blend/castle_build.py` can read it** (#368 wiring).
 *
 * The comment above says the sconce "is authored to land on this number", and
 * until this split that was true only in the sense that a person had checked.
 * `ts_const` reads exactly one grammar — `export const NAME = <number>;` — so
 * an object literal is unreadable to the asset side and the Artist had no
 * choice but to type the figure. Two numbers that match because somebody
 * compared them are this repo's most-cited bug; two numbers where one is *read*
 * cannot drift. `castle_build.py` now asserts its measured cup mouth against
 * these to a millimetre. **Keep both plain numeric exports.**
 */
export const CASTLE_TORCH_CUP_OUT = 0.2475;

/** How far the cup's mouth stands above the mount. See {@link CASTLE_TORCH_CUP_OUT}. */
export const CASTLE_TORCH_CUP_UP = 0.285;

export const CASTLE_TORCH_CUP = { out: CASTLE_TORCH_CUP_OUT, up: CASTLE_TORCH_CUP_UP } as const;

/**
 * How tall a flame is.
 *
 * Sized by a constraint rather than by eye. A sconce must fit inside
 * {@link SCONCE_HEADROOM} measured up from {@link SCONCE_MOUNT_Y}, or the
 * timber wall-plate hides it from the 38° camera — the fault the 3D Artist
 * caught before forty torches were placed under a beam that would have hidden
 * every one. The flame's base already sits {@link CASTLE_TORCH_CUP}`.up` above
 * the mount, so this is what is left, less a centimetre so the tip is not
 * exactly on the line.
 *
 * `check:castle` measures the built flame against both the headroom and the
 * plate's real sightline, so this cannot quietly stop fitting.
 */
/**
 * The largest a single flame's seeded size jitter may make it.
 *
 * **This constant exists because `check:castle` went red the first time it ran**
 * and the failure was mine: {@link FLAME_HEIGHT} was derived exactly to fill
 * {@link SCONCE_HEADROOM}, and then every instance was multiplied by up to 1.14
 * to stop forty identical flames looking like forty identical flames. So the
 * tallest flame on every storey stood 2.73 m against a 2.70 m budget — a budget
 * *published to the 3D Artist*, who is sizing a sconce to it.
 *
 * The jitter is now part of the derivation rather than applied after it. The
 * arithmetic was never the problem; having two steps that each looked right on
 * its own was.
 */
const FLAME_SCALE_MAX = 1.14;

const FLAME_HEIGHT = (SCONCE_HEADROOM - CASTLE_TORCH_CUP.up - 0.01) / FLAME_SCALE_MAX;

/**
 * How wide a flame is at its base.
 *
 * Not derived from anything — unlike {@link FLAME_HEIGHT}, nothing constrains a
 * flame's *width*, and the first value (0.13 m) was chosen to look like a torch
 * next to a real one. It looked like a spark. A flame in this park is a chunky
 * painted toy flame (ART_DIRECTION §1), and it is seen from ten metres.
 */
const FLAME_RADIUS = 0.155;

/**
 * How far a torch and its soot reach along the wall from their anchor.
 *
 * Half the soot mark's width, which is the widest of the four meshes an anchor
 * places — so this is what has to clear a keep-out, not the anchor point.
 */
const TORCH_REACH = 0.5;

/** Roughly how far apart torches sit round the perimeter. */
const TORCH_SPACING = 5.2;

/**
 * A place on a wall that something hangs on: a torch, its soot, a banner.
 *
 * `yaw` rotates a +Z-facing part so its front points **into the room**, which is
 * the same convention every wall-mounted asset in the batch-1 and batch-2
 * contracts is authored to. `out` is the unit vector along that facing, so a
 * caller can push a thing off the wall without re-deriving the trigonometry.
 */
export interface WallAnchor {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly out: { readonly x: number; readonly z: number };
}

/**
 * Every place on this storey's walls where a torch goes.
 *
 * **The single definition**, and that is the point of it existing at all: the
 * flame, the bracket and the soot mark above it are three separate meshes in
 * three separate draw calls, and three lists of positions kept in step by hand
 * is the bug this repo hits more than any other. They read this.
 *
 * ## What it refuses, and why it reuses somebody else's rule to refuse it
 *
 * A wall anchor is rejected inside any of `dressing.ts`'s
 * {@link keepOutsFor} discs. Those exist for *floor* furniture, and a torch at
 * 2.10 m blocks nobody — so this is not about collision. It is that every one
 * of those discs marks somewhere the wall is already spoken for: a shop unit
 * built against it, the front door, the lift lobby, the stairs. A torch behind
 * a shop's signage is not a hazard, it is just wrong, and the list of places
 * the wall is busy already exists. Writing a second one here is how it would
 * fall out of step the first time a shop moved.
 */
export function castleTorchAnchors(deck: number): WallAnchor[] {
  if (deck >= TOP_DECK) return [];
  const blocked = keepOutsFor(deck);
  const anchors: WallAnchor[] = [];

  const consider = (anchor: WallAnchor): void => {
    // Nothing on a wall that has no floor under it to stand and look at it
    // from. Asked of the deck that was built rather than of the hole list.
    if (!insideInterior(anchor.x + anchor.out.x, anchor.z + anchor.out.z)) return;
    // The **same margin `check:castle` measures against**, plus the bracket's
    // own reach off the wall. It was bare `k.radius` until the check found two
    // torches a few centimetres inside a shop's queue: a builder that clears a
    // keep-out by less than the checker demands is a check that fails on a good
    // day and a torch behind a shop sign on a bad one.
    if (
      blocked.some(
        (k) =>
          Math.hypot(anchor.x - k.x, anchor.z - k.z) < k.radius + PLAYER_RADIUS + TORCH_REACH,
      )
    ) {
      return;
    }
    // And nothing on the chimney breast. The fireplace is 4.70 m of stone
    // standing proud of the north wall, and a sconce anchored on that stretch
    // of wall is a bracket buried inside a pier: measured before this guard
    // existed, one torch stood at x = -7.85 with the east jamb occupying
    // -8.10..-7.55 at exactly that wall face, and it was drawn *inside* it.
    //
    // Derived from the chimneypiece's own half-widths rather than from a
    // hand-typed span, so widening the fireplace moves the torches rather than
    // re-burying them. `TORCH_REACH` is added for the same reason it is added
    // to a keep-out above: what has to clear the stone is the widest mesh the
    // anchor places, not the anchor point.
    if (onChimneyBreast(deck, anchor)) return;
    anchors.push(anchor);
  };

  // The two long walls (north and south), running along X.
  const alongX = spread(-INTERIOR_HALF_X, INTERIOR_HALF_X);
  for (const x of alongX) {
    consider({ x, z: -WALL_FACE_Z, yaw: 0, out: { x: 0, z: 1 } });
    // The front door is a gap in the south wall on the ground floor: there is
    // no wall there to fix a bracket to.
    const inDoorway = deck === 0 && x > INTERIOR_DOOR_MIN_X - 1 && x < INTERIOR_DOOR_MAX_X + 1;
    if (!inDoorway) consider({ x, z: WALL_FACE_Z, yaw: Math.PI, out: { x: 0, z: -1 } });
  }

  // The two short walls (east and west), running along Z.
  const alongZ = spread(-INTERIOR_HALF_Z, INTERIOR_HALF_Z);
  for (const z of alongZ) {
    consider({ x: -WALL_FACE_X, z, yaw: Math.PI / 2, out: { x: 1, z: 0 } });
    // The lift door is a gap in the east wall on *every* deck.
    const inLiftDoor = z > LIFT_DOOR_MIN_Z - 1 && z < LIFT_DOOR_MAX_Z + 1;
    if (!inLiftDoor) consider({ x: WALL_FACE_X, z, yaw: -Math.PI / 2, out: { x: -1, z: 0 } });
  }

  return anchors;
}

/**
 * Is this wall anchor on the fireplace's stone?
 *
 * See {@link castleTorchAnchors}'s call site. Note it asks about the **wall**
 * the hearth is on, not merely about the plan distance: the chimney is against
 * `-WALL_FACE_Z` and a torch on the opposite wall 30 m away is not on it.
 */
function onChimneyBreast(deck: number, anchor: WallAnchor): boolean {
  if (deck !== CASTLE_HEARTH.deck) return false;
  if (Math.abs(anchor.z - CASTLE_HEARTH.z) > 3) return false;
  const stone = HEARTH_OPENING_HALF_WIDTH + HEARTH_JAMB_WIDTH + TORCH_REACH;
  return Math.abs(anchor.x - CASTLE_HEARTH.x) < stone;
}

/** Evenly spaced points along a wall, inset from the corners at both ends. */
function spread(min: number, max: number): number[] {
  const usable = max - min - TORCH_SPACING;
  const count = Math.max(1, Math.round(usable / TORCH_SPACING));
  const step = usable / count;
  const points: number[] = [];
  for (let i = 0; i <= count; i += 1) points.push(min + TORCH_SPACING / 2 + i * step);
  return points;
}

/**
 * **The hearth** — where the fire burns and, therefore, where the cat sleeps.
 *
 * Exported because the Artist's chimneypiece (batch 2, B1) is built *round*
 * this rather than the fire being placed inside a chimneypiece somebody else
 * positioned. Same rule as {@link CASTLE_TORCH_CUP}: the thing that emits owns
 * where it is, and the shell agrees with it.
 *
 * Against the north wall, west of the middle.
 *
 * **On the great hall's floor, which is `HALL_DECK` and no longer 0** (#380).
 * This was `deck: 0` and had to move with everything else that makes the hall a
 * hall — `castleDecor.ts`'s hearthside surround, coat of arms and portcullis,
 * and `castleFurniture.ts`'s throne and feast. It was found *after* those had
 * moved, by looking at the built scene: `castle-hearth-logs-0` was standing at
 * world x=600 — in the middle of the mall's market — while its own stone
 * surround was 300 m away at x=900 in the hall. Every check was green, because
 * a fire without a fireplace breaks no assertion.
 *
 * That is the exact failure `castleFurniture.ts`'s note was written to prevent
 * ("so the two move together rather than one being found later on the wrong
 * floor"), and it still caught only two of the three owners. **There are three
 * things that make the hall a hall and they live in three files.**
 */
export const CASTLE_HEARTH = { deck: HALL_DECK, x: onPlate(-14), z: -WALL_FACE_Z + 0.55 } as const;

/** Where the braziers stand: the open middle of the plate, on the lower decks. */
const BRAZIER_SPOTS: readonly { readonly x: number; readonly z: number }[] = [
  { x: 12, z: 8 },
  { x: -20, z: -14 },
  { x: 4, z: -16 },
  { x: 22, z: 16 },
].map(({ x, z }) => ({ x: onPlate(x), z: onPlate(z) }));

// ------------------------------------------------------------- geometry

/**
 * A flame: a squashed six-sided cone with its base on y = 0.
 *
 * Six sides, not twenty. At the distance a child sees a torch from, the
 * silhouette is the whole of it, and a faceted cone catches the toon ramp's
 * bands in a way a smooth one does not — the flame reads as *lit* rather than
 * as a flat orange triangle. ART_DIRECTION §1's chunkiness, applied to fire.
 */
function flameGeometry(height: number, radius: number): BufferGeometry {
  const cone = new ConeGeometry(radius, height, 6, 1);
  cone.translate(0, height / 2, 0);
  return cone;
}

/**
 * The iron bracket a torch burns in, built from primitives.
 *
 * **This is a placeholder with a stated succession.** Batch 1's authored sconce
 * (`sconce-`, PR #368) replaces it the day that batch is wired into the game —
 * which is not this branch, because #368 contains no placement code at all (see
 * `HANDOFF-castle-interior-376.md` §0). Until then a flame on a bare wall looks
 * like a bug, and the room is being screenshotted for Jim now.
 *
 * It carries **no dimension of its own that anything else reads.** The cup is
 * placed at {@link CASTLE_TORCH_CUP}, the same constant the flame is placed at,
 * so deleting this function moves nothing. That is the whole reason a
 * placeholder is safe here: it is a consumer of the contract, never a second
 * author of it.
 */
function bracketGeometry(): BufferGeometry {
  const plate = new BoxGeometry(0.18, 0.34, 0.07);
  plate.translate(0, 0.02, 0.035);

  const arm = new BoxGeometry(0.06, 0.06, CASTLE_TORCH_CUP.out);
  arm.translate(0, 0.12, CASTLE_TORCH_CUP.out / 2);

  const cup = new CylinderGeometry(0.095, 0.055, 0.19, 8);
  cup.translate(0, CASTLE_TORCH_CUP.up - 0.095, CASTLE_TORCH_CUP.out);

  return mergeGeometries([plate, arm, cup], false) ?? plate;
}

/** A brazier: a shallow bowl on three splayed legs. */
const BRAZIER_BOWL_Y = 0.86;

/**
 * How much bigger a brazier's fire is than a torch's.
 *
 * A wall torch's flame is capped hard by {@link SCONCE_HEADROOM} — the timber
 * hides anything taller — but a brazier stands in the open middle of the plate
 * under 3.30 m of ceiling, so nothing constrains it but taste. It is the fire
 * that has to carry a 60 × 44 m room, so it gets to be a bonfire.
 */
const BRAZIER_FLAME_SCALE = 2.5;

function brazierGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const leg = new CylinderGeometry(0.06, 0.05, BRAZIER_BOWL_Y, 6);
    const angle = (i / 3) * Math.PI * 2;
    leg.rotateX(0.13 * Math.cos(angle));
    leg.rotateZ(-0.13 * Math.sin(angle));
    leg.translate(Math.cos(angle) * 0.22, BRAZIER_BOWL_Y / 2, Math.sin(angle) * 0.22);
    parts.push(leg);
  }
  const bowl = new CylinderGeometry(0.52, 0.3, 0.3, 10);
  bowl.translate(0, BRAZIER_BOWL_Y + 0.15, 0);
  parts.push(bowl);
  const rim = new CylinderGeometry(0.56, 0.56, 0.07, 10);
  rim.translate(0, BRAZIER_BOWL_Y + 0.3, 0);
  parts.push(rim);
  return mergeGeometries(parts, false) ?? bowl;
}

/**
 * **How big the fireplace is.** Jim asked for a *large* one (#413), and at child
 * scale that is settled by the ruling that governs everything else in this room:
 * *"it doesn't matter if things are a realistic size, only that they are easily
 * recognisable as what they are."*
 *
 * 3.60 m across the opening and 2.20 m to the lintel — wider than the feast
 * table is long is too much, and narrower than a child is tall stops reading as
 * a fireplace and starts reading as an oven. A 2.12 m child can walk into it
 * upright, which is the size a six-year-old wants a fireplace to be.
 */
const HEARTH_OPENING_HALF_WIDTH = 1.8;
const HEARTH_OPENING_HEIGHT = 2.2;

/**
 * How far the firebox reaches into the room from the wall face.
 *
 * 1.10 m, and it is the fire that sets it rather than taste: the flames stand
 * at {@link CASTLE_HEARTH}`.z`, which is a published constant this file does
 * not get to move, and the widest of them measures 0.67 m across. A 0.90 m
 * firebox left 3 cm between the fire and the stone at the back; 1.10 m leaves
 * the flames inside their own fireplace with margin, which is the thing
 * `check:castle` now asserts.
 */
const HEARTH_DEPTH = 1.1;

/** How wide each stone pier beside the opening is. */
const HEARTH_JAMB_WIDTH = 0.55;

/** How deep the lintel across the opening is, top to bottom. */
const HEARTH_LINTEL_DEPTH = 0.42;

/**
 * **Where the chimney stops — derived from the timber, not chosen.**
 *
 * The hearth is against a wall, so the ceiling that applies to it is
 * {@link BEAM_UNDERSIDE} (3.08 m) rather than the room's 3.30 m: the wall-plate
 * hangs in a {@link BEAM_WIDTH} band round the perimeter, and `check:castle`'s
 * prop assertion measures a near-wall prop against the lower of the two. Three
 * centimetres under it, so the stone is not exactly on the line — the same
 * margin the soot mark takes for the same reason.
 */
const HEARTH_TOP = BEAM_UNDERSIDE - 0.03;

/** How wide the flue is where it meets the timber. */
const HEARTH_FLUE_HALF_WIDTH = 0.85;

/**
 * **The bank of flames in the hearth**: how far each sits from the middle, and
 * how big it is, as a multiple of {@link FLAME_HEIGHT}.
 *
 * Tallest in the middle and falling away to the sides, which is the shape a
 * fire actually is and the shape three equal cones were not. Seven rather than
 * three because the opening is 3.6 m wide: the same three flames that filled a
 * bare patch of wall are a candle in a fireplace this size.
 */
const HEARTH_FLAMES: readonly (readonly [offset: number, scale: number])[] = [
  [-1.16, 2.6],
  [-0.78, 3.5],
  [-0.39, 4.4],
  [0, 5.0],
  [0.39, 4.4],
  [0.78, 3.5],
  [1.16, 2.6],
];

/**
 * How wide every flame in the hearth is, as a multiple of {@link FLAME_RADIUS}
 * — **one width for all seven, while their heights differ.**
 *
 * That is what makes the bank read as one fire rather than as seven cones of
 * graded size: overlapping tongues of the same thickness, of different heights,
 * is what a fire looks like. 2.5 puts each at 0.67 m across, so seven of them
 * pitched 0.39 m apart overlap into a continuous 2.6 m mass inside a 3.6 m
 * opening — and each stays inside the firebox's depth, which is the constraint
 * that actually decides this number. See {@link FlameSpot.radial}.
 */
const HEARTH_FLAME_WIDTH = 2.5;

/** How high off the hearthstone the flames start — the top of the log pile. */
const HEARTH_FLAME_BASE = 0.52;

/** How far the hearthstone is laid out into the room. */
const HEARTH_STONE_DEPTH = 1.6;

/**
 * The hearth's log pile — three crossed logs the fire sits in.
 *
 * Mine rather than the Artist's, and the split is deliberate: the chimneypiece
 * is a sculpted stone hood and belongs in Blender, but what actually burns has
 * to sit at exactly {@link CASTLE_HEARTH} with the flames, and a second author
 * for that is a second formula to keep in step.
 */
function logPileGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rng = new Rng(0x106);
  // Nine logs, not five, and half as long again. The pile is sized off the
  // opening it sits in rather than off nothing: five 1.1 m logs looked like a
  // campfire that had wandered indoors once there were 3.6 m of fireplace round
  // them, which is the same fault as a flame that is correct in the inspector
  // and invisible in the game — a dimension judged against no context at all.
  //
  // **The yaw spread is 0.25 rad and not the 1.1 it was, and that is a fix
  // rather than a preference.** A 2 m log turned 1.1 rad off the opening's axis
  // projects a metre front-to-back; measured on the built pile, it spanned
  // z -15.84..-13.70 against a firebox of -15.33..-14.23 — half a metre through
  // the back of the chimney and half a metre out across the hearthstone, and it
  // was plainly visible in the first screenshot as a log growing out of the
  // stone. It was wrong before this branch too, at 1.1 m of overhang; there was
  // simply no fireplace for it to stick out of. `check:castle` measures the pile
  // against the opening now, so this cannot come back quietly.
  //
  // Logs laid *across* the opening is also what a fire looks like.
  for (let i = 0; i < 9; i += 1) {
    const log = new CylinderGeometry(0.15, 0.14, rng.range(1.4, 1.9), 7);
    log.rotateZ(Math.PI / 2);
    log.rotateY(rng.range(-0.25, 0.25));
    log.translate(rng.range(-0.5, 0.5), 0.16 + i * 0.05, rng.range(-0.15, 0.15));
    parts.push(log);
  }
  const first = parts[0];
  if (!first) throw new Error('castleLighting: the log pile built nothing.');
  return mergeGeometries(parts, false) ?? first;
}

/**
 * **The fireplace's opening, published** — the box a hearth flame must burn
 * inside, in the floor group's own frame.
 *
 * Exported so `check:castle` can assert exactly that, which is the assertion
 * #412 says nobody had. Its account of the bug is worth repeating, because this
 * constant is the answer to it: when the great hall moved storeys, the hearth's
 * *fire* was left behind on the mall's plate — `castle-hearth-logs-0` burning
 * at world x = 600 in the middle of the market while the stone it belongs to
 * stood 300 m away — and **every check was green, because a fire without a
 * fireplace breaks no assertion.**
 *
 * There is now one, and it is not a name check: it measures every flame
 * instance against this box. A fire that leaves its fireplace fails whether it
 * left by moving, by growing, or by the fireplace moving out from under it.
 *
 * Derived from {@link CASTLE_HEARTH} and the two numbers below rather than
 * typed, so the stone and the flames cannot be moved apart — which is the
 * other half of the same lesson. One owner for both halves.
 */
export const CASTLE_HEARTH_OPENING = {
  halfWidth: HEARTH_OPENING_HALF_WIDTH,
  height: HEARTH_OPENING_HEIGHT,
  /** How far the firebox reaches into the room from the wall face. */
  depth: HEARTH_DEPTH,
} as const;

/**
 * The name the chimneypiece's group takes, so a check can go and look for the
 * fireplace rather than being told one was built. See {@link CASTLE_HEARTH_OPENING}.
 */
export function castleHearthSurroundName(deck: number): string {
  return `castle-hearth-surround-${deck}`;
}

/**
 * How many flames burn in the hearth — **exported so that a fireplace which has
 * lost its fire fails as loudly as a fire which has lost its fireplace.**
 *
 * Both directions matter and #412 only ever demonstrated one of them. A check
 * that asserted "no flame is outside the opening" would be perfectly satisfied
 * by a hearth with nothing burning in it at all.
 */
export const CASTLE_HEARTH_FLAME_COUNT = HEARTH_FLAMES.length;

/**
 * **The chimneypiece** — jambs, lintel, hood, fireback and hearthstone, built
 * from primitives round {@link CASTLE_HEARTH}.
 *
 * Jim, 31 August 2026: *"a large fireplace with a roaring fire"*. Before this
 * there was **no fireplace at all**: `CASTLE_HEARTH` was a log pile and three
 * flame cones against a bare pink wall, and `castleDecor.ts`'s `hearthside()`
 * added a sleeping cat and a woodpile beside them. The chimneypiece its own doc
 * comment refers to — "the Artist's chimneypiece, batch 2 B1", which the hearth
 * is placed so as to be built *round* — was never authored.
 *
 * ## Why it is built here, in the fire's own file
 *
 * Because of #412 and the 300 m fire. The rule that came out of that is *if you
 * add anything with two halves, make one owner responsible for both* — and a
 * fireplace and its fire are the canonical two halves. So the stone is emitted
 * from inside the same `if (deck === CASTLE_HEARTH.deck)` block that places the
 * logs and the flames, out of the same constant, in the same group. There is no
 * arrangement of edits that moves one without the other, which is a stronger
 * guarantee than any amount of care.
 *
 * ## What decides its size
 *
 * The height. This is against a wall, so the ceiling that applies is
 * `BEAM_UNDERSIDE` (3.08 m) and not the room's 3.30 m — the timber wall-plate
 * hangs in a {@link BEAM_WIDTH} band round the perimeter and `check:castle`'s
 * prop assertion measures a near-wall prop against it. The hood therefore stops
 * at {@link HEARTH_TOP}, which is derived from `BEAM_UNDERSIDE` rather than
 * chosen, so a beam that ever moves takes the chimney with it.
 */
function chimneypiece(): Group {
  const group = new Group();
  group.name = castleHearthSurroundName(CASTLE_HEARTH.deck);
  group.position.set(CASTLE_HEARTH.x, 0, -WALL_FACE_Z);

  // **Carved grey stone, not the wall's own pink** — and this came out of
  // looking at a rendered frame, which is the only thing that was ever going to
  // settle it. Built in `PALETTE.stonePinkDark` (0xf0a3c1) the chimneypiece was
  // the same colour as the masonry it stands against *and* nearly the same
  // colour as the fire in it: a large fireplace with a roaring fire read as a
  // pale pink shape with slightly oranger pink shapes inside it. Correct in
  // every measurement and flat on screen.
  //
  // `ART.statueStone` is the park's own carved grey — a rose-leaning grey
  // chosen precisely so that carved stone can stand on pink cobble without
  // reading as a hole in the picture (see its note in `artPalette.ts`). This is
  // that same material doing that same job, so it is a reuse rather than
  // ART_DIRECTION §5's forbidden second opinion about a colour the world
  // already names. The hood takes the step below it so the chimney reads as
  // built of parts rather than extruded.
  const stone = softMaterial(ART.statueStone, 0.85);
  const hoodStone = softMaterial(ART.statueStoneMid, 0.85);
  const soot = softMaterial(PALETTE.ink, 0.6);

  const block = (
    name: string,
    geometry: BufferGeometry,
    material: MeshToonMaterial,
  ): void => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // The two piers the opening is between. Their inner faces *are* the opening's
  // edges, which is what makes CASTLE_HEARTH_OPENING a description of the built
  // stone rather than a second opinion about it.
  for (const side of [-1, 1]) {
    const jamb = new BoxGeometry(HEARTH_JAMB_WIDTH, HEARTH_OPENING_HEIGHT, HEARTH_DEPTH);
    jamb.translate(
      side * (HEARTH_OPENING_HALF_WIDTH + HEARTH_JAMB_WIDTH / 2),
      HEARTH_OPENING_HEIGHT / 2,
      HEARTH_DEPTH / 2,
    );
    block('castle-hearth-jamb', jamb, stone);
  }

  // The lintel across the top of the opening.
  const lintelWidth = (HEARTH_OPENING_HALF_WIDTH + HEARTH_JAMB_WIDTH) * 2;
  const lintel = new BoxGeometry(lintelWidth, HEARTH_LINTEL_DEPTH, HEARTH_DEPTH + 0.14);
  lintel.translate(0, HEARTH_OPENING_HEIGHT + HEARTH_LINTEL_DEPTH / 2, (HEARTH_DEPTH + 0.14) / 2);
  block('castle-hearth-lintel', lintel, stone);

  // The hood: a tapered slab from the lintel up to the timber. Four sides, so
  // it is a chunky painted trapezoid rather than a cone — ART_DIRECTION §1.
  const hoodBottom = HEARTH_OPENING_HEIGHT + HEARTH_LINTEL_DEPTH;
  const hoodHeight = HEARTH_TOP - hoodBottom;
  const hood = new CylinderGeometry(HEARTH_FLUE_HALF_WIDTH, lintelWidth / 2, hoodHeight, 4, 1);
  // A four-sided cylinder is a diamond in plan; an eighth turn squares it up.
  hood.rotateY(Math.PI / 4);
  // Scaled on Z alone so the square section becomes the chimney's own oblong —
  // deep enough to sit over the firebox, no deeper.
  hood.scale(1, 1, (HEARTH_DEPTH + 0.14) / lintelWidth);
  hood.translate(0, hoodBottom + hoodHeight / 2, (HEARTH_DEPTH + 0.14) / 2);
  block('castle-hearth-hood', hood, hoodStone);

  // The fireback: the sooted plate the fire burns against. Flat against the
  // wall face, which is where this group's own origin is.
  const back = new BoxGeometry(HEARTH_OPENING_HALF_WIDTH * 2, HEARTH_OPENING_HEIGHT, 0.12);
  back.translate(0, HEARTH_OPENING_HEIGHT / 2, 0.06);
  block('castle-hearth-back', back, soot);

  // The hearthstone, laid out into the room. Under the ankle threshold
  // `check:castle` exempts floor treatment at, because it is floor treatment.
  const slab = new BoxGeometry(lintelWidth + 0.5, 0.06, HEARTH_STONE_DEPTH);
  slab.translate(0, 0.03, HEARTH_STONE_DEPTH / 2);
  block('castle-hearth-stone', slab, stone);

  return group;
}

// ------------------------------------------------------------- the system

/** One flame, in the frame the storey's floor group is drawn in. */
interface FlameSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How tall, as a multiple of {@link FLAME_HEIGHT}. */
  readonly scale: number;
  /**
   * How **wide**, as a multiple of {@link FLAME_RADIUS} — omitted for a flame
   * that simply scales, which is every wall torch and every brazier.
   *
   * It exists because the hearth's fire cannot scale. A torch's flame is a
   * squat cone and multiplying it by five gives a squat cone five times the
   * size: measured, the middle of the hearth's roaring fire came out **1.34 m
   * across**, which is wider than the firebox is deep and burst through both
   * the fireback and the opening. A roaring fire is *tall*, not fat, and those
   * are two numbers rather than one.
   *
   * `exactOptionalPropertyTypes` is on, so this is omitted rather than set to
   * `undefined` where it does not apply.
   */
  readonly radial?: number;
}

interface DeckFire {
  readonly outer: MeshToonMaterial;
  readonly core: MeshToonMaterial;
  /** Its own phase, so five storeys of fire do not pulse in lockstep. */
  readonly phase: number;
}

/**
 * The emissive a flame settles at. The flicker rides on top of this.
 *
 * **Both numbers were raised after looking at a rendered frame**, which is the
 * only way this was ever going to be settled. At the values the design implied
 * (1.15 and 1.7) a torch read as a small brown-orange dot on a pink wall from
 * the distance a child actually plays at: correct in the material inspector,
 * invisible in the game. A toon ramp's darkest band already sits at 0.42, so an
 * emissive term has to clear a fair amount of shading before it looks self-lit
 * at all.
 */
const FLAME_BASE_EMISSIVE = 1.75;
const CORE_BASE_EMISSIVE = 2.45;

/**
 * Every fire in the castle, and the one number per storey that makes it flicker.
 *
 * Built by {@link dress} once per storey during construction — **before**
 * `Building` hands the floor groups to the `FloorFader`, which is what stops
 * the fader cloning these materials out from under {@link update}.
 */
export class CastleFire {
  private readonly decks: DeckFire[] = [];

  /**
   * Adds this storey's fire to its floor group.
   *
   * The roof terrace is genuinely outdoors under the real sun and gets none.
   */
  dress(deck: number, floor: Group): void {
    if (deck >= TOP_DECK) return;

    const group = new Group();
    group.name = `castle-fire-${deck}`;
    const spots: FlameSpot[] = [];
    const rng = new Rng(0x71e + deck * 131);

    // --- wall torches --------------------------------------------------
    const anchors = castleTorchAnchors(deck);
    if (anchors.length > 0) {
      const brackets = new InstancedMesh(
        bracketGeometry(),
        softMaterial(PALETTE.ink, 0.7),
        anchors.length,
      );
      brackets.name = `castle-torch-bracket-${deck}`;
      brackets.castShadow = false;
      brackets.receiveShadow = true;

      const matrix = new Matrix4();
      const rotation = new Quaternion();
      const axis = new Vector3(0, 1, 0);
      const unit = new Vector3(1, 1, 1);
      const position = new Vector3();
      anchors.forEach((anchor, index) => {
        rotation.setFromAxisAngle(axis, anchor.yaw);
        position.set(anchor.x, SCONCE_MOUNT_Y, anchor.z);
        matrix.compose(position, rotation, unit);
        brackets.setMatrixAt(index, matrix);
        spots.push({
          x: anchor.x + anchor.out.x * CASTLE_TORCH_CUP.out,
          y: SCONCE_MOUNT_Y + CASTLE_TORCH_CUP.up,
          z: anchor.z + anchor.out.z * CASTLE_TORCH_CUP.out,
          // A row of forty identical flames reads as a row of forty identical
          // flames. Seeded, so it is the same wall on every reload.
          scale: rng.range(2 - FLAME_SCALE_MAX, FLAME_SCALE_MAX),
        });
      });
      brackets.instanceMatrix.needsUpdate = true;
      group.add(brackets, sootMarks(deck, anchors));
    }

    // --- braziers, for the middle of the plate that no wall torch reaches --
    const standing = BRAZIER_SPOTS.filter(
      (spot) => deck < 3 && insideInterior(spot.x, spot.z) && clearOfKeepOuts(deck, spot),
    );
    if (standing.length > 0) {
      const braziers = new InstancedMesh(
        brazierGeometry(),
        softMaterial(PALETTE.ink, 0.72),
        standing.length,
      );
      braziers.name = `castle-brazier-${deck}`;
      braziers.castShadow = false;
      braziers.receiveShadow = true;
      const matrix = new Matrix4();
      const identity = new Quaternion();
      const unit = new Vector3(1, 1, 1);
      const position = new Vector3();
      standing.forEach((spot, index) => {
        position.set(spot.x, 0, spot.z);
        matrix.compose(position, identity, unit);
        braziers.setMatrixAt(index, matrix);
        spots.push({ x: spot.x, y: BRAZIER_BOWL_Y + 0.24, z: spot.z, scale: BRAZIER_FLAME_SCALE });
      });
      braziers.instanceMatrix.needsUpdate = true;
      group.add(braziers);
    }

    // --- the hearth ----------------------------------------------------
    //
    // **The stone and the fire are emitted together, from one block, out of one
    // constant.** #412: the hall changed storeys, the fire was left behind, and
    // it burned 300 m from its own surround with every check green. The rule
    // that came out of it is that a thing with two halves gets one owner, and
    // this `if` is that owner. See `chimneypiece`.
    if (deck === CASTLE_HEARTH.deck) {
      group.add(chimneypiece());
      const logs = new InstancedMesh(logPileGeometry(), softMaterial(PALETTE.barkDark, 0.8), 1);
      logs.name = `castle-hearth-logs-${deck}`;
      logs.castShadow = false;
      logs.receiveShadow = true;
      logs.setMatrixAt(
        0,
        new Matrix4().compose(
          new Vector3(CASTLE_HEARTH.x, 0, CASTLE_HEARTH.z),
          new Quaternion(),
          new Vector3(1, 1, 1),
        ),
      );
      logs.instanceMatrix.needsUpdate = true;
      group.add(logs);
      // **Roaring**, which is seven flames banked across the opening rather
      // than three in the middle of a wall — and it is roaring *within* the
      // budget, not by spending past it.
      //
      // The budget is worth stating, because the obvious one is the wrong one.
      // `SCONCE_HEADROOM` (2.70 m) is a **wall torch's** ceiling: `check:castle`
      // assertion 7 loops `i < anchors.length`, and these spots are pushed onto
      // the same instance list *after* the wall torches, so they are outside
      // it. What actually constrains a hearth flame is assertion 6's prop test,
      // which measures every instance against `BEAM_UNDERSIDE` — 3.08 m, since
      // the hearth is within `BEAM_WIDTH` of a wall.
      //
      // The tallest flame here reaches 0.52 + 0.2675 x 5.0 = **1.86 m**, which
      // is under its own 2.20 m lintel with 34 cm to spare and less than two
      // thirds of the ceiling it is allowed. So no threshold was relaxed and
      // none needed to be: the binding constraint on a castle fire is the size
      // of its own fireplace, and this fireplace is now large enough to hold a
      // large fire.
      for (const [offset, scale] of HEARTH_FLAMES) {
        spots.push({
          x: CASTLE_HEARTH.x + offset,
          y: HEARTH_FLAME_BASE,
          // Staggered front to back as well as side to side, so the bank reads
          // as a fire with depth rather than as a row of cones on a line.
          z: CASTLE_HEARTH.z + Math.cos(offset * 2.3) * 0.06,
          scale,
          radial: HEARTH_FLAME_WIDTH,
        });
      }
    }

    if (spots.length === 0) return;

    // --- the fire itself: two instanced meshes, no lights ---------------
    // The cone is *painted* amber and *emits* a deeper red — see
    // {@link ART.castleFlameDeep}. Emitting its own colour at 1.75 clipped both
    // the red and the green channel and left a flat lemon yellow with no fire
    // in it; a redder emissive at the same intensity lands on hot orange-red
    // and gives the cream core something to be the middle of.
    const outer = toonMaterial(PALETTE.slideChuteDeep, {
      emissive: ART.castleFlameDeep,
      emissiveIntensity: FLAME_BASE_EMISSIVE,
    });
    const core = toonMaterial(ART.jetpackFlameCore, {
      emissive: ART.jetpackFlameCore,
      emissiveIntensity: CORE_BASE_EMISSIVE,
    });

    group.add(
      flameMesh(`castle-flame-${deck}`, flameGeometry(FLAME_HEIGHT, FLAME_RADIUS), outer, spots),
      // The core is shorter and thinner so the outer flame reads as a sheath
      // round it rather than as a second cone in the same place.
      flameMesh(`castle-flamecore-${deck}`, flameGeometry(FLAME_HEIGHT * 0.5, FLAME_RADIUS * 0.4), core, spots),
    );

    this.decks.push({ outer, core, phase: rng.range(0, Math.PI * 2) });
    floor.add(group);
  }

  /**
   * The flicker: **one `emissiveIntensity` per storey per frame**, and nothing
   * else touched.
   *
   * No geometry is written, no matrix is recomposed and no material is
   * recompiled — changing `emissiveIntensity` on a `MeshToonMaterial` writes a
   * uniform. This is as close to free as a per-frame effect gets, which is the
   * entire reason the design chose it over lights.
   *
   * Two sine terms at frequencies with no common period, so the fire never
   * repeats a pattern a child could notice. The core is driven at a different
   * frequency from the sheath so the flame's *middle* seems to move inside it.
   */
  update(elapsed: number): void {
    for (const fire of this.decks) {
      const t = elapsed + fire.phase;
      const wobble = Math.sin(t * 7.3) * 0.16 + Math.sin(t * 2.9) * 0.1;
      fire.outer.emissiveIntensity = FLAME_BASE_EMISSIVE + wobble;
      fire.core.emissiveIntensity =
        CORE_BASE_EMISSIVE + Math.sin(t * 5.1) * 0.24 + Math.sin(t * 11.7) * 0.12;
    }
  }
}

function flameMesh(
  name: string,
  geometry: BufferGeometry,
  material: MeshToonMaterial,
  spots: readonly FlameSpot[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, spots.length);
  mesh.name = name;
  // A self-lit thing is a decal by ART_DIRECTION §7's table: it casts no shadow
  // and catches none. It would also be pure cost in the shadow pass, which
  // issue #251 has at 57% of draw calls.
  decal(mesh);
  const matrix = new Matrix4();
  const identity = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  spots.forEach((spot, index) => {
    position.set(spot.x, spot.y, spot.z);
    const wide = spot.radial ?? spot.scale;
    scale.set(wide, spot.scale, wide);
    matrix.compose(position, identity, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * A soot mark on the wall above every torch.
 *
 * The cheapest thing on the whole list — one 256² texture and one instanced
 * quad per storey — and it is what sells the room as having burned for a
 * century rather than having been switched on this morning.
 *
 * **Placed from the same {@link castleTorchAnchors} list as the flames.** Not
 * from a second sweep round the perimeter: a torch that moves takes its stain
 * with it, and `check:castle` asserts the two agree instance for instance.
 */
function sootMarks(deck: number, anchors: readonly WallAnchor[]): InstancedMesh {
  const marks = new InstancedMesh(
    // Authored in the XY plane facing +Z, which is the same convention as every
    // wall-mounted asset in the contract.
    new PlaneGeometry(0.95, SOOT_HEIGHT),
    toonMaterial(PALETTE.ink, {
      map: castleSootTexture(),
      transparent: true,
      opacity: 0.4,
    }),
    anchors.length,
  );
  marks.name = `castle-soot-${deck}`;
  decal(marks);
  marks.renderOrder = 1;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const unit = new Vector3(1, 1, 1);
  const position = new Vector3();
  anchors.forEach((anchor, index) => {
    rotation.setFromAxisAngle(axis, anchor.yaw);
    // Just off the wall, or it z-fights with the coursing behind it.
    position.set(
      anchor.x + anchor.out.x * SOOT_STANDOFF,
      SCONCE_MOUNT_Y + SOOT_RISE,
      anchor.z + anchor.out.z * SOOT_STANDOFF,
    );
    matrix.compose(position, rotation, unit);
    marks.setMatrixAt(index, matrix);
  });
  marks.instanceMatrix.needsUpdate = true;
  return marks;
}

const SOOT_STANDOFF = 0.02;
const SOOT_HEIGHT = 0.8;

/**
 * Middle of the stain, measured up from {@link SCONCE_MOUNT_Y}.
 *
 * **Derived from the top down, not chosen.** The timber wall-plate is flush
 * against the wall and its underside is at {@link BEAM_UNDERSIDE}, so a stain
 * that reached past it would be hidden behind a beam — and, worse, would be
 * *partly* hidden, which reads as the texture having been cut off. So the top
 * of the plume is put a centimetre under the timber and the middle follows from
 * the height. Its bottom then lands at 2.26 m, which is inside the flame, which
 * is where a stain should start.
 *
 * `check:castle` measures the built quad against `BEAM_UNDERSIDE` rather than
 * trusting this arithmetic.
 */
const SOOT_RISE = BEAM_UNDERSIDE - 0.01 - SOOT_HEIGHT / 2 - SCONCE_MOUNT_Y;

function clearOfKeepOuts(deck: number, spot: { x: number; z: number }): boolean {
  return keepOutsFor(deck).every((k) => Math.hypot(spot.x - k.x, spot.z - k.z) >= k.radius + 0.9);
}
