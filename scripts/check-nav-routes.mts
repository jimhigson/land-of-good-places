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
 * lobby's own plan** (`layout.ts`) rather than typed in beside it:
 *
 * 1. **Deck → floor.** From the gallery deck, a route to the open lobby floor
 *    must reach it (planar *and* vertical), and must pass through the stair's
 *    mouth — the one way down a room whose deck stands on a solid mass.
 * 2. **Floor → deck.** The mirror climb, same assertions upward.
 * 3. **Deck → floor just over the balustrade.** The cruellest case: the
 *    tapped point is 2.5 m away planar and 3.2 m down. The route must go the
 *    long way round through the mouth, never "arrive" on the deck edge above
 *    the target — which is exactly what shipped: the marker jumped to the
 *    player's own feet and she never moved.
 * 4. **The pick lands on what you see.** An iso-camera ray at the deck's top
 *    surface must stop there (y ≈ deck height), not pass through it to the
 *    hollow at y = 0 behind the mass's front face.
 *
 * Proven RED against the 2D router before the level-aware one landed: probes
 * 1–3 ended their routes on the wrong level (3.20 m vertical error, no
 * waypoint near the mouth) and probe 4 buried the pick 3.2 m under the deck's
 * visible surface. The park's own single-level routing is guarded separately
 * and unchanged by this file: `check:park` walks entrance-to-everywhere
 * routes on every build.
 *
 * The castle is deliberately absent: its floors change by the stair MENU and
 * the lifts (`Game.openStairMenu`, `GlassLift`, `Bubble` — scripted walks and
 * portals, not tap routes), so there is no cross-deck tap route to hold it
 * to. Its within-deck taps ride the same lattice the park probes cover.
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
  PLAYER_RADIUS,
} from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { LOBBY } from '../src/world/hotel/layout.ts';

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

const navGrid = new NavGrid(park.world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);

// ---------------------------------------------------------------- the plan
// Everything below is derived from LOBBY's own declaration. If the stair
// moves, these move with it; nothing here can go stale.
const plan = LOBBY.mezzanine;
if (!plan) throw new Error('the lobby no longer declares a mezzanine — retire or rewrite this probe');
const { stair } = plan;
const midRadius = (stair.innerRadius + stair.outerRadius) / 2;
const world = (x: number, z: number): { x: number; z: number } => ({
  x: LOBBY.originX + x,
  z: LOBBY.originZ + z,
});

/** The stair's mouth: where its arc meets the floor, one stride out. */
const mouth = world(
  stair.centreX - Math.sin(stair.fromAngle) * midRadius + Math.cos(stair.fromAngle) * 1.2,
  stair.centreZ + Math.cos(stair.fromAngle) * midRadius + Math.sin(stair.fromAngle) * 1.2,
);

/** A point on the deck, mid-gallery, clear of the balustrade band. */
const deckPoint = world((plan.minX + plan.maxX) / 2, (plan.minZ + plan.maxZ) / 2);
/** Open lobby floor, on the room's centreline toward the front door. */
const floorPoint = world(0, LOBBY.halfZ - 4);
/** Floor just past the balustrade, right below the deck's edge. */
const overRail = world((plan.minX + plan.maxX) / 2, plan.maxZ + 1.2);

const DECK_Y = plan.height;
const FLOOR_Y = 0;

// -------------------------------------------------------------- the router
const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

interface Route {
  readonly count: number;
  readonly reachedGoal: boolean;
  readonly end: { x: number; z: number };
  readonly endY: number;
  readonly viaMouth: boolean;
}

function route(
  from: { x: number; z: number },
  fromY: number,
  to: { x: number; z: number },
  toY: number,
): Route {
  const count = navGrid.findRoute(from.x, from.z, to.x, to.z, park.sample, fromY, out);
  const endX = count > 0 ? (out[(count - 1) * 2] ?? NaN) : from.x;
  const endZ = count > 0 ? (out[(count - 1) * 2 + 1] ?? NaN) : from.z;
  let viaMouth = false;
  for (let i = 0; i < count; i += 1) {
    const wx = out[i * 2] ?? NaN;
    const wz = out[i * 2 + 1] ?? NaN;
    if (Math.hypot(wx - mouth.x, wz - mouth.z) <= 1.6) viaMouth = true;
  }
  return {
    count,
    reachedGoal: navGrid.lastRouteReachedGoal,
    end: { x: endX, z: endZ },
    endY: park.sample(endX, endZ, toY),
    viaMouth,
  };
}

function assertRoute(label: string, r: Route, to: { x: number; z: number }, toY: number): void {
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
  check(r.viaMouth, `${label}: route passes through the stair mouth`);
}

console.log('— level-aware tap routes, measured on the built lobby —');

// 1. Deck → floor: Jim's exact report.
assertRoute('deck → floor', route(deckPoint, DECK_Y, floorPoint, FLOOR_Y), floorPoint, FLOOR_Y);

// 2. Floor → deck: the mirror climb.
assertRoute('floor → deck', route(floorPoint, FLOOR_Y, deckPoint, DECK_Y), deckPoint, DECK_Y);

// 3. Deck → floor just over the rail: must go the long way round.
assertRoute(
  'deck → floor over the rail',
  route(deckPoint, DECK_Y, overRail, FLOOR_Y),
  overRail,
  FLOOR_Y,
);

// 4. The pick: an iso-camera ray at the deck's visible top must land on it.
{
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  // The camera sits at focus + (+X, +Y, +Z): back the ray out along that
  // offset and aim it at the deck's top surface, exactly as a tap does.
  const target = new Vector3(deckPoint.x, DECK_Y, deckPoint.z);
  const back = new Vector3(1, Math.tan(pitch) * Math.SQRT2, 1).normalize().multiplyScalar(60);
  const origin = target.clone().add(back);
  const ray = new Ray(origin, target.clone().sub(origin).normalize());
  const hit = new Vector3();
  const found = pickWalkablePoint(ray, park.sample, FLOOR_Y, hit);
  check(
    found && Math.abs(hit.y - DECK_Y) <= 0.62 && Math.hypot(hit.x - deckPoint.x, hit.z - deckPoint.z) <= 1.2,
    `pick from the floor lands on the deck's top (hit ${found ? `(${hit.x.toFixed(1)}, ${hit.y.toFixed(2)}, ${hit.z.toFixed(1)})` : 'nothing'}, wanted y ≈ ${DECK_Y})`,
  );
}

if (failures.length > 0) {
  console.error(`\ncheck:nav-routes — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('\ncheck:nav-routes — all green');
