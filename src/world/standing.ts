import { Vector3 as Vector3Impl, type Vector3 } from 'three';
import { JUMP_CLEARANCE_GRACE, type CollisionWorld } from './Collision';
import type { GroundSampler } from '../entities/Player';
import { carryFrom, stepCeilingAt } from './building/stepReach';
import { PLAYER_RADIUS } from '../core/constants';
import { KID_HEIGHT } from '../art/models/kidHeight';

/**
 * **Where her feet come to rest at `(x, z)`, reached from height `y`** — the
 * higher of the ground there (the terrain, a castle floor, a ramp, a bridge
 * deck: whatever the walk sampler says) and the top of the highest solid whose
 * footprint covers the point, within the same one-step reach.
 *
 * Jim, 17 Oct 2026: *"anything should be jumpable with no special 'floor'
 * being marked to make it so."* This is the whole of that, for the feet: a
 * solid's top is somewhere to land because the solid is solid. Nothing
 * registers a floor on top of a bench, a crate or a garden wall; the
 * `CollisionWorld` that stops her walking through one is asked where its top
 * is ({@link CollisionWorld.highestTopAt}) and that is the answer.
 *
 * The one owner of the rule, for everything that moves her: `Player`'s own
 * ground query, and `scripts/playerSim.mts`, the measuring rigs' copy of her
 * movement, which must land where she lands or measure a different girl.
 *
 * The reach is {@link stepCeilingAt}'s, the same one the walk sampler spends,
 * measured from the same reference — so a top is in reach exactly when a deck
 * at that height would be, and a jump that has carried her feet within a step
 * of a top, over it, puts her on it — and only where she fits under whatever
 * hangs over it ({@link solidStepCeiling}).
 *
 * Deliberately **not** what the route lattice, the crowd or the park generator
 * stand on. They ask the walk sampler alone (`WalkSurfaces.sample`), the
 * ground: nobody else in the park jumps, so a solid's top is somewhere only
 * she can be, and keeping it out of their world keeps every route, every
 * crowd walk and every generated park exactly what it was. See
 * HANDOFF-engine-solids.md, "who stands on what".
 */
export function standingHeight(ground: number, collision: CollisionWorld, x: number, z: number, y: number): number {
  if (!collision.anyTopToStandOn()) return ground;
  // The step's own reach first: headroom only ever lowers it, so where no top
  // stands over the ground within a step, none does within less, and the
  // underside over her (`ceilingAt`) need not be asked — most of the park,
  // most of the time.
  const step = stepCeilingAt(x, z, y);
  if (collision.highestTopAt(x, z, step) <= ground) return ground;
  const top = collision.highestTopAt(x, z, solidStepCeiling(collision, x, z, y, step));
  return top > ground ? top : ground;
}

/**
 * **Her feet's sampler** — `ground`'s surface, or the top of a solid within a
 * step, whichever is higher: {@link standingHeight} over a whole sampler. What
 * `Player` stands on (`groundAt`), what her lattice reads its levels from
 * (`NavGrid`'s `standsOnSolids`), and what a check that asks the put-down rule
 * "as `Player` asks it" must hand the rule.
 */
export function feetSampler(ground: GroundSampler, collision: CollisionWorld): GroundSampler {
  return (x, z, y) => standingHeight(ground(x, z, y), collision, x, z, y);
}

/**
 * **The highest solid top she can step or come down onto at `(x, z)`, from
 * `reference`** — one step's reach ({@link stepCeilingAt}, the walk sampler's
 * own), and no higher than leaves room for her whole body under whatever hangs
 * over the point (`CollisionWorld.ceilingAt`, the underside her rising head
 * stops at in {@link riseUnder}).
 *
 * **Headroom.** A bench under a bus shelter's canopy, a cart under its
 * parasol: a top she cannot stand on without her head inside the solid above
 * it is not somewhere to stand. Measured against the reach rather than after
 * it, so the lateral rule (`resolve`'s `'stepped'`), her feet
 * ({@link standingHeight}) and her lattice all refuse the same tops — such a
 * top is a side she bumps, not a step she takes and is then shoved off by the
 * thing over it. The one owner of the rule for everything that stands on
 * solids.
 */
export function solidStepCeiling(collision: CollisionWorld, x: number, z: number, reference: number, step = stepCeilingAt(x, z, reference)): number {
  return Math.min(step, collision.ceilingAt(x, z, reference) - KID_HEIGHT);
}

/**
 * **How deep inside something solid a body may stand and still be standing
 * there, metres** — deeper than this, held for `Player`'s wait, is a wedge.
 * `resolve` ends in exact contact, so ordinary contact is far below it.
 */
export const WEDGE_DEPTH = 0.05;

/**
 * **How deep inside something that holds her she stands at `position`, with
 * her feet on `feetY`** — the one owner of "is she wedged?", for `Player`'s
 * wedge rescue and for every check that asks whether a landing left her
 * stuck (`check:solids`' census counts any such landing a failure).
 *
 * Inside a body below its top and above its base, her whole height asked, as
 * `resolve` asks it. Not a top she stands on, and not anything within a step
 * of her feet, **however narrow its top**: a step she walks up onto or hops
 * clear of holds nobody. The library armchair's rolled arms stand 0.36 m over
 * its seat, too narrow a crown to stand on, and on the seat her body — 1.24 m
 * across, against a 0.86 m seat — reaches 0.19 m into each: counted as a
 * wedge, they popped her out of the chair half a second after she landed in
 * it (QA on PR #722, round two).
 */
export function wedgeDepth(collision: CollisionWorld, position: Vector3, feetY: number): number {
  return collision.deepestSolidOverlap(position, PLAYER_RADIUS, 0, (x, z) => solidStepCeiling(collision, x, z, feetY), KID_HEIGHT, position.y, true);
}

/** Scratch body for {@link dropWedges}. */
const dropProbe = new Vector3Impl();

/**
 * **Would walking off here drop her somewhere she does not fit?** — her body
 * stood on the ground below at `(x, z)`, pushed out of whatever it is in as
 * `resolve` would push it, and still {@link wedgeDepth} deep in something.
 *
 * Walking off a top into a crack narrower than she is — off a low wall into
 * the slot before the bush behind it, off a bush between two more — is a
 * drop into a wedge, and held there by the stick, the rescue that lifts her
 * out puts her back where the same stick walks her in again: seed 5's wall
 * and bush at (−35.9, −9.2), five times in four seconds (QA on PR #722). A
 * body 1.24 m across does not fall into a 0.8 m slot: she stays on the top,
 * at its edge, as she would on a ledge over a gap too narrow to step into.
 */
export function dropWedges(collision: CollisionWorld, x: number, z: number, groundY: number, fromY = groundY): boolean {
  // Down from just under where things begin to hold her to the ground, a
  // quarter-metre at a time, pushed at each height by what holds her there —
  // as the drop itself pushes her: a bush she comes down beside shoves her
  // clear of itself, into whatever is next to it. Squeezed at any height on
  // the way down is a crack. A whole second's escort at each height: where
  // pushing ends, not how fast.
  const start = Math.max(groundY, fromY - JUMP_CLEARANCE_GRACE - 0.02);
  dropProbe.set(x, start, z);
  for (let y = start; ; y = Math.max(groundY, y - DROP_STAGE)) {
    dropProbe.y = y;
    collision.resolve(dropProbe, PLAYER_RADIUS, 0, 1, undefined, KID_HEIGHT, y);
    if (wedgeDepth(collision, dropProbe, y) > WEDGE_DEPTH) return true;
    if (y <= groundY) return false;
  }
}

/** Scratch body for {@link liftOutOfSqueeze}. */
const liftProbe = new Vector3Impl();

/**
 * **Lifts her out of a squeeze in the air** — the backstop to
 * {@link crackFloor}, for a descent that pushes her into a crack the
 * prediction did not see (a run that keeps her moving as she falls). Squeezed
 * where she is now — pushed as `resolve` pushes her and still wedged — she is
 * put on the lowest top of what squeezes her at which she fits, where the
 * push there leaves her; that height is returned, for her to land at — never
 * higher than `highest`, the highest her feet have been this flight. `null`
 * when she is not squeezed, or fits nowhere over it (the wedge rescue's).
 */
export function liftOutOfSqueeze(collision: CollisionWorld, position: Vector3, highest: number): number | null {
  if (wedgeDepth(collision, position, position.y) <= WEDGE_DEPTH) return null;
  liftProbe.copy(position);
  collision.resolve(liftProbe, PLAYER_RADIUS, 0, 1, undefined, KID_HEIGHT, liftProbe.y);
  if (wedgeDepth(collision, liftProbe, liftProbe.y) <= WEDGE_DEPTH) return null;
  for (const top of collision.topsReached(position.x, position.z, PLAYER_RADIUS, position.y)) {
    // Only what this flight came down past: never up onto a pylon she was
    // never over (seed 5: a ring of bushes round the Sky Cruiser's pylon).
    if (top > highest + JUMP_CLEARANCE_GRACE) break;
    liftProbe.set(position.x, top, position.z);
    collision.resolve(liftProbe, PLAYER_RADIUS, 0, 1, undefined, KID_HEIGHT, top);
    if (wedgeDepth(collision, liftProbe, top) > WEDGE_DEPTH) continue;
    position.set(liftProbe.x, top, liftProbe.z);
    return top;
  }
  return null;
}

/** How far {@link dropWedges} comes down between pushes, metres. */
const DROP_STAGE = 0.25;

/**
 * **How far the ground under her may drop in one frame and be the ground, not
 * an edge** — metres. A sprint down the park's steepest slope over a long
 * frame drops it less; a step off anything solid drops it more, and a step
 * down is asked {@link dropWedges} before she takes it.
 */
export const STEP_DOWN_ASKED = 0.1;

/** Scratch body for {@link crackFloor}. */
const crackProbe = new Vector3Impl();

/**
 * **Where a descent from `fromY` to `toY` at `(x, z)`, down to `groundY`,
 * stops, because below is a crack she does not fit** — the highest top of
 * what her body reaches into there, no higher than she was (and the clearance
 * grace) — or `null`, where she fits on down or nothing stands to stop her.
 *
 * The hop's half of {@link dropWedges}: a hop over a low wall into the slot
 * before a bush, a jump into the crack between two bushes, came down a
 * body's width into whatever stood either side and waited there for the
 * wedge rescue (QA on PR #722: seed 5's wall and bush, and the census's own
 * landings once it stopped discarding them). She comes down on the bush, or
 * the wall, instead: on what is there, never in it.
 */
export function crackFloor(collision: CollisionWorld, x: number, z: number, fromY: number, toY: number, groundY: number): number | null {
  // The tops she has just come down past — clear of her feet at the frame's
  // start (within the clearance grace), holding her now. Only as she passes
  // one is there a choice to make: once she is below, it is the drop's.
  const top = collision.highestTopReached(x, z, PLAYER_RADIUS, toY + JUMP_CLEARANCE_GRACE, fromY + JUMP_CLEARANCE_GRACE);
  if (!Number.isFinite(top) || top <= groundY) return null;
  crackProbe.set(x, toY, z);
  if (wedgeDepth(collision, crackProbe, toY) <= WEDGE_DEPTH) return null;
  // Would she fit where this fall ends, pushed as the fall would push her?
  return dropWedges(collision, x, z, groundY, toY) ? top : null;
}

/** Scratch body for {@link nearestFit}. */
const fitProbe = new Vector3Impl();
/** The rings {@link nearestFit} searches, metres out from where she is. */
const FIT_RINGS = [0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1] as const;
const FIT_BEARINGS = 16;

/**
 * **The nearest place, at her height and within a metre, where she is not
 * wedged** — the last word on a squeeze that nothing before it settled: two
 * lamp posts and a wall's end on seed 5, between which a hop off a bush came
 * straight down. `resolve` pushes her out of one body at a time, and between
 * two closer than she is wide each push is undone by the other; this asks for
 * where she fits, all of them at once. Moves `position` there and says so;
 * leaves her be, and says not, where she fits already or fits nowhere near
 * (the wedge rescue's). `fits`, if given, says whether a spot is somewhere
 * she may be put — on her own floor, not over a drop.
 */
export function nearestFit(
  collision: CollisionWorld,
  position: Vector3,
  feetY: number,
  fits: (x: number, z: number) => boolean = () => true,
): boolean {
  if (wedgeDepth(collision, position, feetY) <= WEDGE_DEPTH) return false;
  for (const ring of FIT_RINGS) {
    for (let b = 0; b < FIT_BEARINGS; b += 1) {
      const a = (b / FIT_BEARINGS) * Math.PI * 2;
      fitProbe.set(position.x + Math.cos(a) * ring, position.y, position.z + Math.sin(a) * ring);
      if (wedgeDepth(collision, fitProbe, feetY) > WEDGE_DEPTH) continue;
      if (!fits(fitProbe.x, fitProbe.z)) continue;
      position.x = fitProbe.x;
      position.z = fitProbe.z;
      return true;
    }
  }
  return false;
}

/**
 * How far ahead of her centre, along the way she is walking, a step up is
 * looked for: just past her front edge (`PLAYER_RADIUS` and a hand's breadth).
 */
export const STEP_LOOKAHEAD = PLAYER_RADIUS + 0.1;

/** How many points along her front half {@link walkingOntoStep} asks, from her middle to {@link STEP_LOOKAHEAD}. */
export const STEP_SAMPLES = 8;

/**
 * **Is she walking straight into a solid she can step up onto?** — a top
 * within one step of the surface she stands on, under any point of the
 * stretch from her middle to just past her front edge in the direction she is
 * walking (`dirX`/`dirZ`, a unit vector).
 *
 * A step up onto a 0.44 m bench is the step up onto a 0.44 m deck: one step,
 * `BUILDING_STEP_UP`, the same reach the walk sampler has always spent on the
 * castle's porch and the hotel's stairs. Floors are not a special kind of
 * thing any more, so neither is stepping onto one.
 *
 * Asked along the way she is walking, never beside her, for the one reason
 * that makes it look right: walking *into* a bench she climbs it, and walking
 * *past* one she brushes along its side — a bench beside her is a side to
 * slide along, never something her body sinks into; once her middle is over
 * the top, the sampler stands her on it.
 *
 * **The whole stretch, not its far end** (PR #722's QA). A top narrower than
 * that stretch — the reptile house's foyer log, standable ±0.2 m either side
 * of its line — is under the point past her front edge only for the first
 * part of the way in: asked there alone, she was let in while that point was
 * over the log, shoved back out the moment it had passed beyond it, and let
 * in again, eight times a second, never climbing. Under any point of her
 * front half, it is a step for the whole of the way in, and she stands on it.
 */
export function walkingOntoStep(
  collision: CollisionWorld,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  reference: number,
  samples = STEP_SAMPLES,
): boolean {
  if (!collision.anyTopToStandOn()) return false;
  const carry = carryFrom(x, z, reference);
  for (let i = 1; i <= samples; i += 1) {
    const along = (STEP_LOOKAHEAD * i) / samples;
    const aheadX = x + dirX * along;
    const aheadZ = z + dirZ * along;
    const from = carry(aheadX, aheadZ);
    // A top over the surface she stands on: a step *up*. The top she is
    // already on — her own wall's, met by the near half of the stretch — is
    // not one, or walking along a wall she would sink into a bench beside it.
    // Asked within the step's reach first, as `standingHeight` does: headroom
    // only lowers it, so where nothing stands over her floor within a step the
    // underside over the point need not be asked.
    //
    // Asked of the body she is walking into (`stepTopAt`), not of where its
    // top is drawn: a garden wall's top drawn out along the planet's lean
    // starts beyond its face, and pressed against that face she was never
    // over it (QA on PR #722, seed 5's stone wall at (−49.6, 61.6)).
    const step = stepCeilingAt(aheadX, aheadZ, from);
    if (collision.stepTopAt(aheadX, aheadZ, step) <= from + STEP_ABOVE) continue;
    if (collision.stepTopAt(aheadX, aheadZ, solidStepCeiling(collision, aheadX, aheadZ, from, step)) > from + STEP_ABOVE) return true;
  }
  return false;
}

/**
 * **Where a teleport that gives no height stands her** (`Player.teleport`, a
 * `/spawn?pos=x,z` link): on the walk surface at `(x, z)` — the highest floor
 * there — or a top she could step onto from it. Never a roof: asked from the
 * floor, a canopy over it is out of a step's reach (QA on PR #722 — asked from
 * `Infinity`, the station-bench link stood her on the station's awning and
 * another on the reptile house's roof).
 */
export function teleportHeight(ground: GroundSampler, collision: CollisionWorld, x: number, z: number): number {
  const floor = ground(x, z, Infinity);
  return standingHeight(ground(x, z, floor), collision, x, z, floor);
}

/** How far over the surface she stands on a top must be to be a step up rather than where she is: float noise and the clearance grace's flat edge. */
const STEP_ABOVE = 0.02;

/**
 * **One frame of vertical motion in the air, and a head that stops at an
 * underside** — moves `position.y` by `velocity·dt` and returns the vertical
 * velocity she keeps.
 *
 * A solid that begins above the ground (a canopy, a deck's rail) is a ceiling
 * to a body moving up into it: rising, the top of her head (`bodyHeight` above
 * her feet) may not pass the lowest underside over her
 * (`CollisionWorld.ceilingAt`), and meeting one takes her upward speed away,
 * so she drops back rather than standing with her head through a roof. The
 * sides of such a solid are the lateral rule's (`resolve`, given her height);
 * this is the one direction that rule cannot see. `Player` and
 * `scripts/playerSim.mts` both rise through here.
 */
export function riseUnder(collision: CollisionWorld, position: Vector3, velocity: number, dt: number, bodyHeight: number): number {
  const head = position.y + bodyHeight;
  position.y += velocity * dt;
  if (velocity <= 0) return velocity;
  const ceiling = collision.ceilingAt(position.x, position.z, head - 1e-6);
  if (position.y + bodyHeight <= ceiling) return velocity;
  position.y = ceiling - bodyHeight;
  return 0;
}
