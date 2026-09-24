import { REAL_PROBE_RADIUS } from '../../src/world/train/bridgeFootprint';
import { ROUTES, distanceToPath, routeCurve } from '../../src/world/pathGraph';
import { shapesOverlap, type Claim, type GroundClaims } from '../../src/boot/groundClaims';
import { type CollisionWorld } from '../../src/world/Collision';
import { refusal, type FeatureBuilder, type Increment, type Refusal } from '../boot/featureBuilder';
import { isInEntranceGateOpening } from '../../src/world/entrance/layout';
import { PLAYER_RADIUS } from '../../src/core/constants';
import { PARK_LAYOUT } from '../../src/world/parkLayout';
import { RAIL_CORRIDOR_CLEARANCE, distanceToRailCorridor } from '../../src/world/train/plan';
import { isInBridgeFootprint } from '../../src/world/train/bridgeKeepout';
import { clearOfCruiser } from '../../src/world/Scenery';
import { onRideExit } from './sceneryBuilders';
import { ANCHORS } from '../../src/world/anchors';
import { STALL_STANDS } from '../../src/minigames/stallPlacement';
import { CatmullRomCurve3 } from 'three';
import { LAMP_RADIUS, type LampDecision } from '../../src/world/LampPosts';
/**
 * **The lamp posts' builder.** Moved verbatim from `src/world/LampPosts.ts`,
 * which keeps the decision type and draws the lamps. Build-time only.
 */

// ---------------------------------------------------------------- placement

/**
 * Metres between lamps along a path.
 *
 * The family asked for a lamp "every few metres along every path". Ten is what
 * that turns into once the pool size is accounted for: {@link LIGHT_DISTANCE}
 * puts usable light about 20 m out from a lamp, so at 10 m apart the pools
 * overlap two-deep along a path and a child is never walking into the dark
 * between two of them. Tighter than this and the park reads as a runway.
 */
const LAMP_SPACING = 10;


/**
 * Extra clearance beyond a route's half-width, so a lamp stands *just past the
 * kerb* rather than on it.
 *
 * Not a look-nice number. `NavGrid` fattens every collider by the walker's
 * radius before deciding a cell is walkable (0.62 m) and a lamp's collider is
 * 0.22 m, so a lamp reaches 0.84 m into the lattice. At 1.1 m past the kerb it
 * cannot eat into the paving at all — which is the whole dodgems-arch lesson
 * (`minigames/dodgems/plot.ts`): two posts at 1.35 m inflated shut and
 * pocketed the doorway behind them. A lamp must never pinch a path.
 */
const EDGE_GAP = 1.1;


/** Kept clear of every plot the layout placed, on top of its own radius. */
const ANCHOR_MARGIN = 1.2;


/** Nothing paved within this of a lamp — see {@link EDGE_GAP} for the 0.84. */
const LAMP_PATH_GAP = 0.95;


/**
 * Doormats and stand points are sacred.
 *
 * A waypoint at a stall counter or an anchor's entrance has to stay reachable,
 * and a lamp standing in front of one pockets it exactly the way the dodgems
 * arch did. Generous on purpose: there is always another lamp 10 m along, and
 * skipping one costs nothing.
 */
const DOORMAT_CLEARANCE = 2.6;


/** Clear of anything already solid — walls, trunks, bushes, the fountain. */
const SOLID_CLEARANCE = 0.8;


/** No two lamps closer than this. */
const LAMP_GAP = 4;


/** How far past a bridge's exact footprint a lamp keeps — see the call site
 * in {@link lampFits} for the reasoning. `REAL_PROBE_RADIUS` rather than a
 * hand-assembled `PLAYER_RADIUS + 0.3`: the bridge search probes its ramps
 * at exactly that radius, so a lamp placed clear of anything smaller still
 * blocks the search 0.2 m short of what it demands (PR #330's traces found
 * lamp bases the single dominant cause of blocked ramp reach — a live "two
 * definitions of one thing"). */
const LAMP_BRIDGE_MARGIN = LAMP_RADIUS + REAL_PROBE_RADIUS;


/** Top of the finial: base + shaft + housing + cap, with their overlaps. */
const LAMP_TOP = 3.6;


interface LampSlot {
  readonly curve: ReturnType<typeof routeCurve>;
  readonly closed: boolean;
  readonly t: number;
  readonly preferred: 1 | -1;
  readonly nudge: number;
  readonly offset: number;
}


function lampSlots(): LampSlot[] {
  const slots: LampSlot[] = [];
  let side = 0;
  for (const route of ROUTES) {
    const curve = routeCurve(route);
    const length = curve.getLength();
    if (length < LAMP_SPACING * 0.5) continue;
    const count = Math.max(1, Math.round(length / LAMP_SPACING));
    const offset = route.width / 2 + EDGE_GAP;
    for (let i = 0; i < count; i += 1) {
      const t = route.closed ? i / count : (i + 0.5) / count;
      side += 1;
      const preferred: 1 | -1 = side % 2 === 0 ? 1 : -1;
      const nudge = (1 / count) * 0.25;
      slots.push({ curve, closed: route.closed, t, preferred, nudge, offset });
    }
  }
  return slots;
}


/** The ladder of spots one slot tries, nearest the path first — the order the placer always used. */
function* slotCandidates(slot: LampSlot): Generator<readonly [number, number], void, void> {
  for (const reach of [slot.offset, slot.offset + 2.2, slot.offset + 3.4]) {
    for (const along of [0, slot.nudge, -slot.nudge]) {
      for (const trySide of [slot.preferred, -slot.preferred as 1 | -1]) {
        const at = slot.closed ? (slot.t + along + 1) % 1 : Math.min(1, Math.max(0, slot.t + along));
        const candidate = offsetFromCurve(slot.curve, at, reach, trySide);
        if (candidate) yield candidate;
      }
    }
  }
}


function lampClaim(x: number, z: number, radius: number): Claim {
  return { kind: 'footprint', shape: { shape: 'disc', x, z, radius } };
}


/**
 * **Lamp posts, as a feature builder.** One increment is one slot along a
 * drawn route (`LAMP_SPACING` apart); its ladder of spots is the one the placer
 * always climbed, and a spot must pass {@link lampFits} against the real
 * collision world *and* be clear, with the placer's own `SOLID_CLEARANCE`, of
 * every claim in the registry — a tree's trunk, a bush, a fairy pole, a wall.
 *
 * A slot whose every spot is refused only by claims returns an **optional**
 * refusal naming the blockers, so the driver first asks them to step aside (a
 * tree moves rather than a lamp being lost) and only then leaves the slot out,
 * which is what the old placer did silently. Correction the other way: a lamp
 * asked to step aside re-climbs its own ladder, clear of the asker.
 */
export function lampBuilder(collision: CollisionWorld, claims: GroundClaims, out: LampDecision[]): FeatureBuilder {
  let slots: LampSlot[] | null = null;
  /** Slot index per committed section, so a claim index maps back to a slot. */
  const sections: number[] = [];
  const placed = (): (readonly [number, number])[] =>
    out.flatMap((lamp) => (lamp === 'forgone' ? [] : [[lamp.x, lamp.z] as const]));
  const probe = (x: number, z: number): Claim => lampClaim(x, z, LAMP_RADIUS + SOLID_CLEARANCE);
  const increment = (x: number, z: number, verb: string): Increment => ({
    claims: [lampClaim(x, z, LAMP_RADIUS)],
    label: `lamp ${verb} (${x.toFixed(1)}, ${z.toFixed(1)})`,
  });

  /** Try a slot's ladder; the first spot both worlds allow, or the first registry refusal. */
  const climb = (
    slot: LampSlot,
    exclude: number,
    keepClearOf: readonly Claim[],
  ): { spot: readonly [number, number] } | { blockers: readonly string[]; claim: Claim } | null => {
    const others = placed().filter((_, i) => i !== exclude);
    let refused: { blockers: readonly string[]; claim: Claim } | null = null;
    for (const [x, z] of slotCandidates(slot)) {
      if (!lampFits(x, z, others, collision)) continue;
      const claim = probe(x, z);
      const blockers = claims.blockers('lamps', [claim]).map((b) => b.feature);
      if (blockers.length > 0 || keepClearOf.some((other) => shapesOverlap(claim.shape, other.shape))) {
        refused ??= { blockers, claim };
        continue;
      }
      return { spot: [x, z] };
    }
    return refused;
  };

  return {
    name: 'lamps',
    deps: ['walls', 'trees', 'bushes', 'fountain', 'fairyLights'],
    movable: true,
    *advance() {
      slots ??= lampSlots();
      while (out.length < slots.length) {
        const slot = slots[out.length] as LampSlot;
        const found = climb(slot, -1, []);
        if (found && 'spot' in found) {
          const [x, z] = found.spot;
          sections.push(out.length);
          out.push({ x, z });
          return increment(x, z, 'at');
        }
        if (found) {
          return refusal(
            `lamps: slot ${out.length} refused at every spot; first by ${found.blockers.join(', ')}`,
            { blockers: found.blockers, claims: [found.claim], optional: true },
          );
        }
        // Nothing fixed lets a lamp stand here: left out, as the placer always did.
        out.push('forgone');
      }
      return 'done';
    },
    back() {
      const slot = sections.pop();
      if (slot === undefined) return;
      out.length = slot;
    },
    forgo() {
      out.push('forgone');
    },
    supply: () => 1,
    accommodate(claimIndex: number, _attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal {
      const section = claims.sectionOfClaim('lamps', claimIndex);
      const slot = sections[section];
      const lamp = slot === undefined ? undefined : out[slot];
      if (slot === undefined || !lamp || lamp === 'forgone' || !slots) return refusal(`lamps: no lamp owns claim ${claimIndex}`);
      const placedIndex = placed().findIndex(([x, z]) => x === lamp.x && z === lamp.z);
      const found = climb(slots[slot] as LampSlot, placedIndex, keepClearOf);
      if (found && 'spot' in found && (found.spot[0] !== lamp.x || found.spot[1] !== lamp.z)) {
        const [x, z] = found.spot;
        out[slot] = { x, z };
        return increment(x, z, `moved from (${lamp.x.toFixed(1)}, ${lamp.z.toFixed(1)}) to`);
      }
      return refusal(`lamps: slot ${slot} has no other spot to move to`);
    },
    reset() {
      out.length = 0;
      sections.length = 0;
      slots = null;
    },
  };
}


function lampFits(
  x: number,
  z: number,
  placed: readonly (readonly [number, number])[],
  collision: CollisionWorld,
): boolean {
  // **Out of the park's own front doorway** (issue #481). Asking
  // `entrance/layout.ts`, which is the one owner of where the way in is — the
  // same predicate the boundary masonry, the play clamp and the bridge
  // pipeline ask. A lamp is a `LAMP_RADIUS` post and a child is
  // `PLAYER_RADIUS` wide, so both come off the aperture: what must survive is
  // the arch's full opening, not the lamp's own centre clearing it.
  //
  // Measured on `main` with the masonry and the clamp already fixed, a lamp
  // still stood inside the arch on two pool seeds — `(-1.96, 59.53)` on 428,
  // 0.47 m inside the gate line and 2 m across it, and `(3.73, 58.91)` on 131.
  // This file's own rule is that a lamp which does not fit is skipped rather
  // than forced, so this costs a lamp and nothing else.
  if (isInEntranceGateOpening(x, z, LAMP_RADIUS + PLAYER_RADIUS)) return false;

  // Off the paving of *every* path, not just the one being walked: routes
  // cross, and the offset that clears one can land on another.
  if (distanceToPath(x, z) < LAMP_PATH_GAP) return false;

  // Out of every plot the solver placed — the stalls too, not just the five
  // big anchors. `anchor.trespass` in check:park has no allowance at all.
  for (const entry of PARK_LAYOUT.entries.values()) {
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + ANCHOR_MARGIN) return false;
  }

  // Off the railway. This one number also buys the station platforms, which
  // do not exist yet when lamps are built (see `World`) — the corridor is
  // wider than they are. A bridge's own deck and ramps (issue #116) are a
  // separate check below: unlike a platform they can run well past the
  // corridor's own width, along whichever path drew them, so one fixed
  // radius from the centre line cannot cover them.
  //
  // A tighter margin than `isInBridgeFootprint`'s own default: that default
  // is sized for the widest thing `Scenery.ts` builds near a bridge (a
  // 0.34 m-thick stone wall), but a lamp's own base is a 0.22 m circle
  // (`LAMP_RADIUS`) — 0.22 + `PLAYER_RADIUS` (0.62) = 0.84 m of genuine
  // overlap risk, not 0.96 m. The full 2 m default pushed a lamp back far
  // enough to strand two whole seeds' worth of a bridge-adjacent spur
  // 25-36 m dark (`everyPathIsLit`, issue #116) for no safety this smaller
  // margin does not already cover.
  if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) return false;
  if (isInBridgeFootprint(x, z, LAMP_BRIDGE_MARGIN)) return false;

  // And out from under the Sky Cruiser wherever it flies low. The station
  // spurs it now lights (issue #241 spread the plots, so paths follow them
  // everywhere) can run right along the coaster's boarding ramp, and a lamp
  // is 3.5 m of pole and housing under a rail that dips to 1 m — the
  // procgen sweep caught the car passing straight through one on three of
  // the five seeds. The whole finished curve is known by lamp time; only
  // its low stretches matter, because the cruise floor clears a lamp.
  if (!clearOfCruiser(x, z, LAMP_RADIUS + 0.8, LAMP_TOP)) return false;

  // Never where a ride sets a child down — the same list the scenery keeps
  // off. A lamp is thinner than a tree and stood on the ferris exit anyway
  // (seed 2, the exit-clear invariant).
  if (onRideExit(x, z, LAMP_RADIUS + 0.4)) return false;

  // Never in front of a door.
  for (const anchor of ANCHORS) {
    const [ex, ez] = anchor.entrance;
    if (Math.hypot(x - ex, z - ez) < DOORMAT_CLEARANCE) return false;
  }
  for (const stand of STALL_STANDS) {
    if (Math.hypot(x - stand.x, z - stand.z) < DOORMAT_CLEARANCE) return false;
  }

  // And clear of everything already built. Asking the collision world is the
  // honest version of this: it knows where `Scenery` actually put its walls
  // and trunks, which no table here could.
  let clear = true;
  const needed = LAMP_RADIUS + SOLID_CLEARANCE;
  collision.forEachCircle((cx, cz, radius) => {
    if (Math.hypot(x - cx, z - cz) < radius + needed) clear = false;
  });
  collision.forEachWall((x1, z1, x2, z2, halfThickness) => {
    if (pointToSegment(x, z, x1, z1, x2, z2) < halfThickness + needed) clear = false;
  });
  if (!clear) return false;

  return !placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < LAMP_GAP);
}


function pointToSegment(
  x: number,
  z: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-12) return Math.hypot(x - x1, z - z1);
  let t = ((x - x1) * dx + (z - z1) * dz) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}


/**
 * Samples the curve at `t` and steps `offset` metres off it, perpendicular to
 * the tangent, on the requested side.
 *
 * `side` rather than "whichever points away from the plaza": the family asked
 * for lamps down both sides of a path, and always choosing the outward side
 * lights one verge and leaves the other dark. Whether the candidate is
 * *allowed* is {@link lampFits}'s business, not this function's.
 */
function offsetFromCurve(
  curve: CatmullRomCurve3,
  t: number,
  offset: number,
  side: 1 | -1,
): [number, number] | null {
  const point = curve.getPoint(t);
  const tangent = curve.getTangent(t);
  const nx = -tangent.z;
  const nz = tangent.x;
  const length = Math.hypot(nx, nz);
  if (!Number.isFinite(length) || length < 1e-9) return null;

  return [point.x + (nx / length) * offset * side, point.z + (nz / length) * offset * side];
}
