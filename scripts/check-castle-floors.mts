import './headless-canvas.mjs';
import { BUILDING_STEP_UP, PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  CASTLE_FLOORS,
  CASTLE_MALL,
  CASTLE_ROOF,
  CASTLE_FLOOR_RADIUS,
  FLOOR_SPACE_SPACING,
  castleFloorAt,
  floorX,
  floorZ,
  type CastleFloor,
} from '../src/world/building/floors.ts';
import {
  BUILDING_BASE_Y,
  LIFT_DOOR_Z,
  LIFT_STAND_X,
  insideInterior,
} from '../src/world/building/layout.ts';
import { SLIDE_PLAN } from '../src/world/slide/plan.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { castleEntranceBand, castleExitBand } from '../src/world/building/Building.ts';
import { bandContains } from '../src/world/tapSpacing.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';

/**
 * **The castle's three floors are reachable, disjoint, and joined only by the
 * lift.**
 *
 * ARCHITECTURE-DECISIONS Decision 3 asks for exactly this and says why it is
 * not optional: *"the scattered-connection positions are authored numbers, and
 * authored numbers rot — that is exactly what the S2 boot validator exists for;
 * do not ship S2 without it."*
 *
 * The numbers this guards are the ones a future edit will break silently. A
 * lift alcove moved a metre into a wall, an arrival point left at a
 * pre-#403 coordinate, a floor built at the wrong offset — none of these throw,
 * none of these fail to render, and every one of them is a child standing in a
 * wall or falling through the world with the game looking perfectly healthy.
 *
 * ## What it asserts
 *
 * 1. **Connectivity.** The portal graph joins the garden to every floor *and
 *    back*, using only the portals that actually exist.
 * 2. **Arrivals are on walkable ground**, within one step of the floor.
 * 3. **No arrival sits inside a trigger**, with a player's own radius of
 *    margin, so a doorway cannot ping-pong.
 * 4. **The floors do not overlap** — the whole point of the split, and the
 *    thing that makes height-blind collision harmless.
 * 5. **The ginormous slide still launches from the roof garden**, which is
 *    #380's one non-negotiable.
 *
 * ## Proved red
 *
 * Every clause has been watched failing by deliberate mutation; the transcript
 * and the geometry it was taken against are in HANDOFF-castle-floor-split.md.
 * A check nobody has seen fail has not been shown to check anything, and — per
 * CLAUDE.md — a red-run transcript with no geometry beside it goes stale the
 * moment the geometry moves.
 */

let failures = 0;
function fail(message: string): void {
  console.error(`  ✗ ${message}`);
  failures += 1;
}

const surfaces = new WalkSurfaces();

// ---------------------------------------------------------------------------
// The portal graph, as data — every way between two spaces that exists.
// ---------------------------------------------------------------------------

interface Portal {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Where the traveller ends up, in world metres. */
  readonly arriveX: number;
  readonly arriveZ: number;
}

/**
 * **The lift, and the front door. That is the whole graph.**
 *
 * Jim, 29 August 2026: *"there are too many ways between the floors right now.
 * Let's reduce it to just the lift."* Six ways became one, and this list is
 * where that ruling is actually enforced rather than merely described: if
 * anybody adds a second route between two floors, clause 6 below says so.
 */
const portals: Portal[] = [];

// The front door, both ways. Only the mall has one.
portals.push({
  id: 'door:garden->mall',
  from: SPACE_GARDEN,
  to: CASTLE_MALL.space,
  arriveX: floorX(CASTLE_MALL, 0),
  arriveZ: floorZ(CASTLE_MALL, CASTLE_MALL.halfZ - 6.5),
});
const exitBand = castleExitBand();
portals.push({
  id: 'door:mall->garden',
  from: CASTLE_MALL.space,
  to: SPACE_GARDEN,
  // `leaveInterior` puts her just outside the facade; the entrance band is the
  // thing she is stood in front of, and it is in the garden.
  arriveX: castleEntranceBand().centreX,
  arriveZ: castleEntranceBand().centreZ,
});

// The lift: every floor to every other floor, which is what "any-floor portal"
// means. Each arrival is that floor's own alcove.
for (const from of CASTLE_FLOORS) {
  for (const to of CASTLE_FLOORS) {
    if (from.index === to.index) continue;
    portals.push({
      id: `lift:${from.index}->${to.index}`,
      from: from.space,
      to: to.space,
      arriveX: floorX(to, LIFT_STAND_X),
      arriveZ: floorZ(to, LIFT_DOOR_Z),
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Connectivity: the garden reaches every floor, and every floor gets back.
// ---------------------------------------------------------------------------

function reachableFrom(start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const portal of portals) {
      if (portal.from !== here || seen.has(portal.to)) continue;
      seen.add(portal.to);
      queue.push(portal.to);
    }
  }
  return seen;
}

const fromGarden = reachableFrom(SPACE_GARDEN);
for (const floor of CASTLE_FLOORS) {
  if (!fromGarden.has(floor.space)) {
    fail(
      `connectivity: '${floor.name}' (${floor.space}) cannot be reached from the garden at all. ` +
        `A child who walks into the castle can never get to it.`,
    );
  }
  const back = reachableFrom(floor.space);
  if (!back.has(SPACE_GARDEN)) {
    fail(
      `connectivity: from '${floor.name}' (${floor.space}) there is no way back to the garden. ` +
        `That is a child stranded on a floor she cannot leave — #377's one non-negotiable.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Every arrival is on walkable ground.
// ---------------------------------------------------------------------------

for (const portal of portals) {
  const ground = surfaces.sample(portal.arriveX, portal.arriveZ, BUILDING_BASE_Y + 1);
  const expected = portal.to === SPACE_GARDEN ? ground : BUILDING_BASE_Y;
  if (portal.to !== SPACE_GARDEN && Math.abs(ground - expected) > BUILDING_STEP_UP) {
    fail(
      `arrival: '${portal.id}' lands at (${portal.arriveX.toFixed(2)}, ` +
        `${portal.arriveZ.toFixed(2)}) where the walkable surface is ${ground.toFixed(3)} m, ` +
        `${Math.abs(ground - expected).toFixed(3)} m from the floor at ${expected.toFixed(3)} m — ` +
        `more than one step (${BUILDING_STEP_UP} m). She arrives inside the floor or above it.`,
    );
  }
  // And it must be in the space the portal claims to lead to, or the play
  // bounds are bound to one floor and she is standing on another.
  const landedIn = spaceAt(portal.arriveX, portal.arriveZ);
  if (landedIn !== portal.to) {
    fail(
      `arrival: '${portal.id}' claims to land in '${portal.to}' but (${portal.arriveX.toFixed(2)}, ` +
        `${portal.arriveZ.toFixed(2)}) is in '${landedIn}'.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. No arrival sits inside a trigger that would send her back.
// ---------------------------------------------------------------------------

const bands = [castleEntranceBand(), castleExitBand()];
for (const portal of portals) {
  for (const band of bands) {
    // A player's own radius of margin: she is a body, not a point, and a
    // trigger she is merely *touching* fires just as well as one she is
    // centred in.
    for (const [dx, dz] of [
      [0, 0],
      [PLAYER_RADIUS, 0],
      [-PLAYER_RADIUS, 0],
      [0, PLAYER_RADIUS],
      [0, -PLAYER_RADIUS],
    ]) {
      if (!bandContains(band, portal.arriveX + dx, portal.arriveZ + dz)) continue;
      // The garden-bound door legitimately arrives in front of the entrance —
      // `SPACE_COOLDOWN` is the backstop there and always has been. Everything
      // else is a ping-pong waiting to happen.
      if (portal.id === 'door:mall->garden' && band.what === castleEntranceBand().what) continue;
      fail(
        `ping-pong: '${portal.id}' arrives inside ${band.what}. She lands on a trigger and is ` +
          `sent straight back, or bounces between the two as soon as the cooldown lapses.`,
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The floors are disjoint — no two share any ground.
// ---------------------------------------------------------------------------

for (let i = 0; i < CASTLE_FLOORS.length; i += 1) {
  for (let j = i + 1; j < CASTLE_FLOORS.length; j += 1) {
    const a = CASTLE_FLOORS[i]!;
    const b = CASTLE_FLOORS[j]!;
    const gap = Math.hypot(a.originX - b.originX, a.originZ - b.originZ);
    // Two radii, because `castleFloorAt` claims everything within
    // `CASTLE_FLOOR_RADIUS` of an origin: closer than that and one floor's
    // circle swallows part of another's, and a position stops having one
    // answer.
    if (gap < CASTLE_FLOOR_RADIUS * 2) {
      fail(
        `overlap: '${a.name}' and '${b.name}' are ${gap.toFixed(1)} m apart, closer than the ` +
          `${CASTLE_FLOOR_RADIUS * 2} m their own radius test needs. Their spaces intersect, so ` +
          `a position has no single answer — and indoor collision is height-blind, which means ` +
          `a counter on one floor becomes an invisible wall on the other. That is the entire ` +
          `bug class this split exists to remove.`,
      );
    }
  }
}

// Every corner of every plate resolves to its own floor, and to nothing else.
for (const floor of CASTLE_FLOORS) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = floorX(floor, sx * floor.halfX);
      const z = floorZ(floor, sz * floor.halfZ);
      const found = castleFloorAt(x, z);
      if (found?.index !== floor.index) {
        fail(
          `overlap: '${floor.name}' corner (${sx * floor.halfX}, ${sz * floor.halfZ}) resolves to ` +
            `'${found?.name ?? 'nowhere'}' rather than to its own floor.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The ginormous slide still launches from the roof garden.
// ---------------------------------------------------------------------------

{
  const x = floorX(CASTLE_ROOF, SLIDE_PLAN.entryX);
  const z = floorZ(CASTLE_ROOF, SLIDE_PLAN.entryZ);
  const where = castleFloorAt(x, z);
  if (where?.index !== CASTLE_ROOF.index) {
    fail(
      `slide: the ginormous slide's boarding pad resolves to '${where?.name ?? 'nowhere'}', not ` +
        `to the roof garden. #380 makes the roof its launch point and calls that ` +
        `non-negotiable.`,
    );
  }
  if (!insideInterior(SLIDE_PLAN.entryX, SLIDE_PLAN.entryZ)) {
    fail(
      `slide: the boarding pad at floor-local (${SLIDE_PLAN.entryX.toFixed(2)}, ` +
        `${SLIDE_PLAN.entryZ.toFixed(2)}) is off the roof's plate — a child would have to stand ` +
        `on thin air to board.`,
    );
  }
  const ground = surfaces.sample(x, z, BUILDING_BASE_Y + 1);
  if (Math.abs(ground - BUILDING_BASE_Y) > BUILDING_STEP_UP) {
    fail(
      `slide: the boarding pad's ground samples to ${ground.toFixed(3)} m, ` +
        `${Math.abs(ground - BUILDING_BASE_Y).toFixed(3)} m off the roof's own floor.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. The lift is the ONLY way between floors.
// ---------------------------------------------------------------------------

{
  const between = portals.filter(
    (p) => p.from !== SPACE_GARDEN && p.to !== SPACE_GARDEN,
  );
  const notLift = between.filter((p) => !p.id.startsWith('lift:'));
  if (notLift.length > 0) {
    fail(
      `routes: ${notLift.length} way(s) between floors are not the lift ` +
        `(${notLift.map((p) => p.id).join(', ')}). Jim, 29 August 2026: "there are too many ways ` +
        `between the floors right now. Let's reduce it to just the lift."`,
    );
  }
  process.stderr.write(
    `check:castle-floors — routes: ${between.length} inter-floor portals, all of them the lift. ` +
      `The stairs, the escalator, the trampoline's shaft and the helter-skelter are gone.\n`,
  );
}

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\ncheck:castle-floors — ${failures} failure(s).`);
  process.exit(1);
}

console.log(
  `check:castle-floors OK — ${CASTLE_FLOORS.length} floors ${FLOOR_SPACE_SPACING} m apart ` +
    `(${CASTLE_FLOORS.map((f) => f.name).join(', ')}), ${portals.length} portals, every floor ` +
    `reachable from the garden and able to get back, every arrival on walkable ground in the ` +
    `space it claims and clear of every trigger by ${PLAYER_RADIUS} m, no two floors sharing ` +
    `ground, and the ginormous slide launching from the roof garden.`,
);
