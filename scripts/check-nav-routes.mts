/**
 * **Can a tap get you between the levels of a room?**
 *
 * ```
 * npm run check:nav-routes
 * ```
 *
 * Jim, playing the deployed game (8 August 2026): *"went up to mezzanine
 * level, then tapping back on the lower level didn't path find correctly down
 * the stairs."* Keys descended fine — the stair's walk surfaces are sound —
 * so the failure was the **route**, and the mirror case (floor → deck) failed
 * too, one organ earlier: the tap's pick ray sailed through the visible deck
 * and buried the target at y = 0 inside the gallery's solid mass.
 *
 * Jim's ruling that followed: *"Route planning in general needs to work
 * between levels. It can't be a purely 2D algo."* — see
 * ARCHITECTURE-DECISIONS.md Decision 11. These probes hold the router to it,
 * measured on the real built hotel, with every coordinate **derived from the
 * lobby's own plan** (`layout.ts`) rather than typed in beside it.
 *
 * The lobby is the **imperial composition** now — two mirrored curves to a
 * landing at 3.84, one straight flight on to the gallery at 5.44 — which is
 * the exact multi-flight case Decision 11 named as its test: each flight is
 * one declared edge, and floor → gallery must fall out as a **multi-hop**
 * (curve, landing, straight flight) with no further declaration.
 *
 * 1. **Floor → gallery,** and it must pass BOTH a curve's floor mouth and
 *    the straight flight — the multi-hop, upward.
 * 2. **Gallery → floor,** the same chain downward — Jim's exact report.
 * 3. **Floor → landing:** one hop, ending on the intermediate level.
 * 4. **Gallery → floor just over the balustrade.** The cruellest case: the
 *    tapped point is 1.2 m away planar and 5.44 m down. The route must go the
 *    long way round through both flights, never "arrive" on the deck edge.
 * 5. **The pick lands on what you see** — the gallery's top surface from an
 *    iso ray, not the hollow beneath it.
 * 6. **The pick sees through the arch.** A ray through the open archway must
 *    land on the walk-through floor a child can plainly see (y ≈ 0), not
 *    snap 3.84 m up onto the landing's front edge. Proven red against the
 *    unbounded pick march (this file, 9 Aug 2026): it answered y = 3.84 at
 *    the arch mouth.
 *
 * The original single-stair probes were proven RED against the 2D router
 * (8 failures, 3.20 m vertical errors); the multi-hop probes here were proven
 * red again by deleting the connector registration in `Hotel.buildMezzanine`.
 * The park's own single-level routing is guarded separately by `check:park`.
 */

import './headless-canvas.mjs';
import { Ray, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import { pickWalkablePoint } from '../src/world/pickWalkable.ts';
import { circleBoundary } from '../src/world/boundary.ts';
import {
  CAMERA_PITCH_DEGREES,
  HOTEL_PLAY_RADIUS,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';
import { damp } from '../src/core/mathUtils.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { LOBBY, mezzanineWalkConnectors } from '../src/world/hotel/layout.ts';

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`);
  if (!ok) failures.push(what);
};

const park = buildHeadlessPark();

// The lobby's own play bounds, exactly as `Hotel.boundTo` sets them.
park.world.collision.setPlayBounds(
  circleBoundary(HOTEL_PLAY_RADIUS, LOBBY.originX, LOBBY.originZ),
);

const navGrid = new NavGrid(
  park.world.collision,
  PLAYER_RADIUS,
  JUMP_APEX_HEIGHT,
  () => park.world.building.surfaces.connectors,
);

// ---------------------------------------------------------------- the plan
// Everything below is derived from LOBBY's own declaration. If a flight
// moves, these move with it; nothing here can go stale.
const plan = LOBBY.mezzanine;
if (!plan) throw new Error('the lobby no longer declares a mezzanine — retire or rewrite this probe');
const world = (x: number, z: number): { x: number; z: number } => ({
  x: LOBBY.originX + x,
  z: LOBBY.originZ + z,
});

// The flights' walk paths — the same derivation `Hotel.buildMezzanine`
// registers, asked of the same owner. Two curves then the straight flight.
const paths = mezzanineWalkConnectors(plan);
if (paths.length !== 3) throw new Error(`expected 3 stair walk paths, got ${paths.length}`);
const curveMouths = paths.slice(0, 2).map((path) => {
  const p = path[0];
  if (!p) throw new Error('empty curve walk path');
  return world(p.x, p.z);
});
// "Via the straight flight" is membership of the flight's own plan rectangle,
// not proximity to its connector endpoint: the 3.6 m flight is wide enough
// that the (cell, level) lattice can climb its ramp slices in any lane
// (Decision 11 — a ramp joins its levels by being walkable, no declaration
// needed), so a route may ascend it a stride away from the declared path.
const straightRect = {
  minX: plan.straight.centreX - plan.straight.walkWidth / 2,
  maxX: plan.straight.centreX + plan.straight.walkWidth / 2,
  minZ: plan.maxZ,
  maxZ: plan.straight.frontZ,
};

/** A point on the gallery deck, in the east bay, clear of nook furniture. */
const deckPoint = world(6, (plan.minZ + plan.maxZ) / 2);
/** Open lobby floor, on the room's centreline toward the front door. */
const floorPoint = world(0, LOBBY.halfZ - 4);
/** The landing's open stage, between the arch rail and the grand flight. */
const landingPoint = world(0, (plan.landing.maxZ + plan.straight.frontZ) / 2);
/** Floor just past the gallery's front balustrade, right below its edge. */
const overRail = world(6, plan.maxZ + 1.2);
/** Walk-through floor under the arch, visible from the camera through it. */
const archPoint = world(0, plan.landing.maxZ - 1.5);

const DECK_Y = plan.height;
const LANDING_Y = plan.landing.height;
const FLOOR_Y = 0;

// -------------------------------------------------------------- the router
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

interface Route {
  readonly count: number;
  readonly reachedGoal: boolean;
  readonly end: { x: number; z: number };
  readonly endY: number;
  readonly viaCurveMouth: boolean;
  readonly viaStraight: boolean;
  readonly points: readonly { x: number; z: number }[];
}

function route(
  from: { x: number; z: number },
  fromY: number,
  to: { x: number; z: number },
  toY: number,
): Route {
  const count = navGrid.findRoute(from.x, from.z, fromY, to.x, to.z, toY, park.sample, out);
  const endX = count > 0 ? (out[(count - 1) * 2] ?? NaN) : from.x;
  const endZ = count > 0 ? (out[(count - 1) * 2 + 1] ?? NaN) : from.z;
  let viaCurveMouth = false;
  let viaStraight = false;
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const wx = out[i * 2] ?? NaN;
    const wz = out[i * 2 + 1] ?? NaN;
    points.push({ x: wx, z: wz });
    if (curveMouths.some((m) => Math.hypot(wx - m.x, wz - m.z) <= 1.6)) viaCurveMouth = true;
    const lx = wx - LOBBY.originX;
    const lz = wz - LOBBY.originZ;
    if (
      lx >= straightRect.minX - 0.6 &&
      lx <= straightRect.maxX + 0.6 &&
      lz >= straightRect.minZ - 0.6 &&
      lz <= straightRect.maxZ + 0.6
    ) {
      viaStraight = true;
    }
  }
  return {
    count,
    reachedGoal: navGrid.lastRouteReachedGoal,
    end: { x: endX, z: endZ },
    // The level the route itself says it ends on — never re-derived from a
    // sampler that could flatter the wrong level into looking right.
    endY: navGrid.lastRouteEndY,
    viaCurveMouth,
    viaStraight,
    points,
  };
}

/**
 * Walks a route's smoothed waypoints with the real resolver and the player's
 * own ground damp — the flesh of the walk, not the graph of it. Returns the
 * body's final position, or where it wedged when a leg could not be finished.
 *
 * Exists because a route can be valid end-to-end while a *leg* of it is
 * unwalkable: the lattice crossed the grand flight's unstamped flank
 * sideways, so the route stepped onto the flight from the landing beside it
 * instead of climbing it, and the live walk ground against the gallery rail
 * at 3.84 m for ever, seeking a 5.44 m waypoint (9 Aug 2026). Every route
 * probe above stayed green through that, because they ask where a route
 * *ends* and never whether its legs can be *walked*.
 */
function walkRoute(
  from: { x: number; z: number },
  fromY: number,
  r: Route,
): { x: number; z: number; y: number; wedgedAt: number } {
  const dt = 1 / 60;
  const position = new Vector3(from.x, fromY, from.z);
  let wedgedAt = -1;
  for (let leg = 0; leg < r.points.length; leg += 1) {
    const wp = r.points[leg]!;
    let arrived = false;
    for (let step = 0; step < 60 * 12; step += 1) {
      const dx = wp.x - position.x;
      const dz = wp.z - position.z;
      const planar = Math.hypot(dx, dz);
      if (planar < 0.4) {
        arrived = true;
        break;
      }
      const stride = Math.min(PLAYER_MAX_SPEED * dt, planar);
      park.world.collision.resolveMovement(
        position,
        (dx / planar) * stride,
        (dz / planar) * stride,
        PLAYER_RADIUS,
        0,
        dt,
      );
      const floor = park.sample(position.x, position.z, position.y);
      position.y = damp(position.y, floor, 0.04, dt);
      if (position.y - floor > 0.5) position.y = floor;
    }
    if (!arrived) {
      wedgedAt = leg;
      break;
    }
  }
  return { x: position.x, z: position.z, y: position.y, wedgedAt };
}

function assertRoute(
  label: string,
  r: Route,
  to: { x: number; z: number },
  toY: number,
  via: { curve?: boolean; straight?: boolean },
): void {
  const planarGap = Math.hypot(r.end.x - to.x, r.end.z - to.z);
  const verticalGap = Math.abs(r.endY - toY);
  check(
    r.count > 0 && planarGap <= 1.6,
    `${label}: route ends ${planarGap.toFixed(2)} m planar from the target (waypoints: ${r.count})`,
  );
  check(
    verticalGap <= 0.62,
    `${label}: route ends ${verticalGap.toFixed(2)} m vertical from the target's level`,
  );
  if (via.curve) check(r.viaCurveMouth, `${label}: route passes a curve's floor mouth`);
  if (via.straight) {
    check(r.viaStraight, `${label}: route passes the straight flight (the multi-hop)`);
  }
}

console.log('— level-aware tap routes, measured on the built imperial lobby —');

// 1. Floor → gallery: the multi-hop up, through a curve AND the grand flight.
assertRoute(
  'floor → gallery',
  route(floorPoint, FLOOR_Y, deckPoint, DECK_Y),
  deckPoint,
  DECK_Y,
  { curve: true, straight: true },
);

// 2. Gallery → floor: Jim's exact report, two flights down.
assertRoute(
  'gallery → floor',
  route(deckPoint, DECK_Y, floorPoint, FLOOR_Y),
  floorPoint,
  FLOOR_Y,
  { curve: true, straight: true },
);

// 3. Floor → landing: one hop, ending on the intermediate level.
assertRoute(
  'floor → landing',
  route(floorPoint, FLOOR_Y, landingPoint, LANDING_Y),
  landingPoint,
  LANDING_Y,
  { curve: true },
);

// 4. Gallery → floor just over the rail: must go the long way round.
assertRoute(
  'gallery → floor over the rail',
  route(deckPoint, DECK_Y, overRail, FLOOR_Y),
  overRail,
  FLOOR_Y,
  { curve: true, straight: true },
);

// 4b. **The route's legs are walkable flesh.** The live repro: a tap on the
// gallery's east lane beside the grand flight. The route was valid — and its
// smoothed chord cut across the landing beside the flight's ramp, wedging the
// walk against the gallery rail at 3.84 m (see `walkRoute`'s header). So the
// smoothed waypoints are *walked*, with the resolver and the ground damp, and
// the body must genuinely arrive on the gallery. Proven red by taking
// `navStamped` off the grand flight's flanks: wedged on leg 18 at
// (2.8, 3.84, −5.7) local, exactly the live symptom.
{
  const eastLane = world(2.9, -9.2);
  const r = route(floorPoint, FLOOR_Y, eastLane, DECK_Y);
  const walked = walkRoute(floorPoint, FLOOR_Y, r);
  const planar = Math.hypot(walked.x - eastLane.x, walked.z - eastLane.z);
  check(
    walked.wedgedAt === -1 && planar <= 1.0 && Math.abs(walked.y - DECK_Y) <= 0.62,
    `walking the floor → gallery-east route arrives (body at (${(walked.x - LOBBY.originX).toFixed(1)}, ` +
      `${walked.y.toFixed(2)}, ${(walked.z - LOBBY.originZ).toFixed(1)}) local` +
      `${walked.wedgedAt >= 0 ? `, wedged on leg ${walked.wedgedAt}` : ''})`,
  );
}

// A tap ray exactly as the game casts one: backed out along the iso camera's
// own offset, aimed at the target.
function isoRayAt(target: Vector3): Ray {
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const back = new Vector3(1, Math.tan(pitch) * Math.SQRT2, 1).normalize().multiplyScalar(60);
  const origin = target.clone().add(back);
  return new Ray(origin, target.clone().sub(origin).normalize());
}

// 5. The pick: an iso-camera ray at the deck's visible top must land on it.
{
  const target = new Vector3(deckPoint.x, DECK_Y, deckPoint.z);
  const hit = new Vector3();
  // Infinity: the lobby is an open-topped room, everything in it is visible.
  const found = pickWalkablePoint(isoRayAt(target), park.sample, Infinity, hit);
  check(
    found && Math.abs(hit.y - DECK_Y) <= 0.62 && Math.hypot(hit.x - deckPoint.x, hit.z - deckPoint.z) <= 1.2,
    `pick from the floor lands on the gallery's top (hit ${found ? `(${hit.x.toFixed(1)}, ${hit.y.toFixed(2)}, ${hit.z.toFixed(1)})` : 'nothing'}, wanted y ≈ ${DECK_Y})`,
  );
}

// 6. The pick sees through the arch: a ray at the walk-through floor visible
// under the landing lands on that floor, not on the landing's front edge
// 3.84 m above it. The ray genuinely passes through the archway (it enters
// below the soffit); only the pick's own march could get this wrong, and
// did — the unbounded version answered y = 3.84 here.
{
  const target = new Vector3(archPoint.x, 0, archPoint.z);
  const hit = new Vector3();
  const found = pickWalkablePoint(isoRayAt(target), park.sample, Infinity, hit);
  check(
    found && Math.abs(hit.y - FLOOR_Y) <= 0.3 && Math.hypot(hit.x - archPoint.x, hit.z - archPoint.z) <= 1.2,
    `pick through the arch lands on the walk-through floor (hit ${found ? `(${hit.x.toFixed(1)}, ${hit.y.toFixed(2)}, ${hit.z.toFixed(1)})` : 'nothing'}, wanted y ≈ 0)`,
  );
}

if (failures.length > 0) {
  console.error(`\ncheck:nav-routes — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('\ncheck:nav-routes — all green');
