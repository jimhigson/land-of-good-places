/**
 * **Every interior's way out has a doorway frame — drawn round the exit, solid
 * where it is drawn, and narrowing nothing.**
 *
 * ```
 * pnpm run check:doorframes
 * ```
 *
 * Jim, 11 November 2026: *"in the game when in interior spaces the exit to
 * outside is usually a door in a hidden wall, with no visual indicator where
 * the door is."* `src/art/models/doorFrames.ts` stands a frame round each way
 * out; this holds every one of them, in the real built park, to four things:
 *
 * 1. **Round the exit, from the exit's owner.** The frame's opening is the
 *    room's own gap (`DOOR_HALF`, `reptileDoorGap()`, `libraryDoorGap()`,
 *    `INTERIOR_DOOR_MIN_X..MAX_X`) and the room's exit band stands between its
 *    posts.
 * 2. **Solid where it is drawn.** Each post's collider is its drawn footprint,
 *    measured off the meshes in the scene (never the figures that placed
 *    them), to the lintel's top; the lintel's is banded from its drawn
 *    underside to its drawn top. A hatted child walks under every lintel, and
 *    the castle's frame fits under its ceiling.
 * 3. **Marched at, and stopped.** A player-sized body is marched at every
 *    post from sixteen bearings, at 5 cm and at `PLAYER_LONGEST_STEP`, and
 *    never ends inside the drawn post. Control: the same march with that
 *    post's collider taken out must end inside it.
 * 4. **The opening stays walkable, both ways.** Lanes 5 cm apart across the
 *    whole gap are walked from 3 m inside to 3 m outside and back, at 5 cm and
 *    at `PLAYER_LONGEST_STEP`, by the real `CollisionWorld`, first with the
 *    frame's solids taken out and then with them in: every lane that got
 *    through without the frame must get through with it. Control: a frame
 *    narrowed by 0.3 m a side, registered in place of the real one, must lose
 *    lanes — or the instrument cannot see a narrowing at all.
 *
 * Coverage — rooms, lanes, marches — is written to stderr on every run.
 */
import './headless-canvas.mjs';
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS } from '../src/core/constants.ts';
import { INTERIOR_DOOR_MAX_X, INTERIOR_DOOR_MIN_X } from '../src/world/building/layout.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { buildDoorFrame, registerDoorFrameSolids, type PlacedDoorFrame } from '../src/art/models/doorFrames.ts';
import { castleExitBand } from '../src/world/building/Building.ts';
import { CASTLE_CEILING_CLEAR } from '../src/world/building/castleFabric.ts';
import { DOOR_HALF, LOBBY, hotelDoorBands } from '../src/world/hotel/layout.ts';
import { reptileDoorGap, reptileExitBand } from '../src/world/reptileHouse/shell.ts';
import { libraryDoorGap, libraryExitBand } from '../src/world/library/shell.ts';
import type { PortalBand } from '../src/world/tapSpacing.ts';
import type { BoxCollider, CollisionWorld } from '../src/world/Collision.ts';

const failures: string[] = [];
const say = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
const fail = (line: string): void => {
  failures.push(line);
};

const park = buildHeadlessPark();
const { world, scene } = park;
const collision: CollisionWorld = world.collision;
scene.updateMatrixWorld(true);
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

const lobbyExit = hotelDoorBands(LOBBY).find((band) => band.kind === 'exit');
if (!lobbyExit) throw new Error('check:doorframes: the lobby has no exit band');

interface Room {
  readonly name: string;
  readonly placed: PlacedDoorFrame;
  /** The exit's gap, local X, straight from the room's own owner. */
  readonly gap: readonly [number, number];
  readonly band: PortalBand;
}

const rooms: Room[] = [
  { name: 'hotel lobby', placed: world.hotel.exitDoorFrame, gap: [-DOOR_HALF, DOOR_HALF], band: lobbyExit },
  { name: 'Reptile House', placed: world.reptileHouse.exitDoorFrame, gap: reptileDoorGap(), band: reptileExitBand() },
  { name: 'library', placed: world.library.exitDoorFrame, gap: libraryDoorGap(), band: libraryExitBand() },
  { name: 'castle', placed: world.building.exitDoorFrame, gap: [INTERIOR_DOOR_MIN_X, INTERIOR_DOOR_MAX_X], band: castleExitBand() },
];

const TOL = 0.01;

/** A mesh's own drawn bounds in the world — its geometry only, never its outline hull. */
function drawnBounds(mesh: Mesh): Box3 {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) throw new Error(`${mesh.name}: no bounding box`);
  return box.clone().applyMatrix4(mesh.matrixWorld);
}

function frameMeshes(placed: PlacedDoorFrame, role: string): Mesh[] {
  const out: Mesh[] = [];
  placed.frame.group.traverse((node) => {
    if (node instanceof Mesh && node.name.startsWith(`doorframe-${placed.frame.style}-${role}`)) out.push(node);
  });
  return out;
}

function union(boxes: readonly Box3[]): Box3 {
  const out = new Box3();
  for (const box of boxes) out.union(box);
  return out;
}

/** Distance in plan from (x, z) to a rectangle, 0 inside. */
function toRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/** Walks a body from (x, z0) to (x, z1) at `stride`; true if it got there. */
function walk(x: number, z0: number, z1: number, y: number, stride: number): boolean {
  const at = new Vector3(x, y, z0);
  const direction = Math.sign(z1 - z0);
  const steps = Math.ceil(Math.abs(z1 - z0) / stride) + 40;
  for (let i = 0; i < steps; i += 1) {
    const left = z1 - at.z;
    if (left * direction <= 0) return true;
    const step = direction * Math.min(stride, Math.abs(left));
    collision.resolveMovement(at, 0, step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA, undefined, undefined, TALLEST_CHILD_HEIGHT, y);
    at.y = y;
  }
  return (z1 - at.z) * direction <= 0.02;
}

const STRIDES = [0.05, PLAYER_LONGEST_STEP] as const;
const LANE_SPACING = 0.05;
const WALK_DEPTH = 3;

/** Every lane × direction × stride that gets through, as keys. */
function lanesThrough(room: Room): Set<string> {
  const { placed } = room;
  const centre = placed.originX + (room.gap[0] + room.gap[1]) / 2;
  const half = (room.gap[1] - room.gap[0]) / 2;
  const wallZ = placed.originZ + placed.frame.opening.z;
  const y = placed.originY + placed.frame.opening.floorY;
  const through = new Set<string>();
  for (let offset = -half; offset <= half + 1e-9; offset += LANE_SPACING) {
    for (const stride of STRIDES) {
      if (walk(centre + offset, wallZ - WALK_DEPTH, wallZ + WALK_DEPTH, y, stride)) through.add(`out ${offset.toFixed(2)} @${stride.toFixed(2)}`);
      if (walk(centre + offset, wallZ + WALK_DEPTH, wallZ - WALK_DEPTH, y, stride)) through.add(`in ${offset.toFixed(2)} @${stride.toFixed(2)}`);
    }
  }
  return through;
}

function solidsOf(placed: PlacedDoorFrame): BoxCollider[] {
  return [...placed.solids.posts, placed.solids.lintel];
}

for (const room of rooms) {
  const { placed } = room;
  const { frame } = placed;
  const ox = placed.originX;
  const oz = placed.originZ;
  const floorY = placed.originY + frame.opening.floorY;
  say(`\n${room.name} — ${frame.style} frame, gap ${(room.gap[1] - room.gap[0]).toFixed(2)} m`);

  // ---------------------------------------------- 1. round the exit, from its owner
  if (Math.abs(frame.opening.minX - room.gap[0]) > 1e-9 || Math.abs(frame.opening.maxX - room.gap[1]) > 1e-9) {
    fail(`${room.name}: the frame's opening ${frame.opening.minX.toFixed(3)}..${frame.opening.maxX.toFixed(3)} is not the room's gap ${room.gap[0].toFixed(3)}..${room.gap[1].toFixed(3)}`);
  }
  const posts = frameMeshes(placed, 'post');
  const sides = [-1, 1].map((sign) => union(posts.filter((m) => sign * (drawnBounds(m).getCenter(new Vector3()).x - (ox + (room.gap[0] + room.gap[1]) / 2)) > 0).map(drawnBounds)));
  const [left, right] = sides as [Box3, Box3];
  const innerLeft = left.max.x;
  const innerRight = right.min.x;
  if (Math.abs(innerLeft - (ox + room.gap[0])) > TOL || Math.abs(innerRight - (ox + room.gap[1])) > TOL) {
    fail(`${room.name}: the drawn posts' inner faces are at ${innerLeft.toFixed(3)} and ${innerRight.toFixed(3)}, the gap's edges at ${(ox + room.gap[0]).toFixed(3)} and ${(ox + room.gap[1]).toFixed(3)}`);
  }
  const bandLo = room.band.centreX - room.band.halfAcross;
  const bandHi = room.band.centreX + room.band.halfAcross;
  const bandMid = room.band.centreX;
  if (bandMid < innerLeft || bandMid > innerRight) {
    fail(`${room.name}: the exit band (x ${bandLo.toFixed(2)}..${bandHi.toFixed(2)}) is not between the posts (${innerLeft.toFixed(2)}..${innerRight.toFixed(2)})`);
  }
  say(`  opening ${innerLeft.toFixed(3)}..${innerRight.toFixed(3)} = the gap's own edges; exit band centred at x ${bandMid.toFixed(3)}`);

  // ---------------------------------------------- 2. solid where it is drawn
  for (const [index, drawn] of sides.entries()) {
    const box = placed.solids.posts[index];
    if (!box) {
      fail(`${room.name}: post ${index} has no collider`);
      continue;
    }
    const solid = { minX: box.cx - box.halfX, maxX: box.cx + box.halfX, minZ: box.cz - box.halfZ, maxZ: box.cz + box.halfZ };
    const off = Math.max(
      Math.abs(solid.minX - drawn.min.x),
      Math.abs(solid.maxX - drawn.max.x),
      Math.abs(solid.minZ - drawn.min.z),
      Math.abs(solid.maxZ - drawn.max.z),
    );
    if (off > TOL) fail(`${room.name}: post ${index}'s collider is ${off.toFixed(3)} m off its drawn footprint`);
    if (Math.abs(drawn.min.y - floorY) > TOL) fail(`${room.name}: post ${index} stands at ${drawn.min.y.toFixed(3)}, the floor at ${floorY.toFixed(3)}`);
  }
  const lintel = union(frameMeshes(placed, 'lintel').map(drawnBounds));
  const lintelSolid = placed.solids.lintel;
  if (Math.abs(lintelSolid.baseHeight - lintel.min.y) > TOL || Math.abs(lintelSolid.topHeight - lintel.max.y) > TOL) {
    fail(`${room.name}: the lintel's collider band ${lintelSolid.baseHeight.toFixed(3)}..${lintelSolid.topHeight.toFixed(3)} is not its drawn ${lintel.min.y.toFixed(3)}..${lintel.max.y.toFixed(3)}`);
  }
  for (const box of placed.solids.posts) {
    if (Math.abs(box.topHeight - lintel.max.y) > TOL) fail(`${room.name}: a post's collider tops out at ${box.topHeight.toFixed(3)}, the lintel over it at ${lintel.max.y.toFixed(3)}`);
  }
  const clear = lintel.min.y - floorY;
  if (clear < TALLEST_CHILD_HEIGHT) fail(`${room.name}: the lintel is ${clear.toFixed(3)} m over the floor, under the tallest child (${TALLEST_CHILD_HEIGHT})`);
  const everything = union(frameMeshes(placed, '').map(drawnBounds));
  if (frame.style === 'castle' && everything.max.y - floorY > CASTLE_CEILING_CLEAR) {
    fail(`castle: the frame reaches ${(everything.max.y - floorY).toFixed(3)} m, the ceiling is at ${CASTLE_CEILING_CLEAR}`);
  }
  say(`  posts' colliders on their drawn footprints; lintel ${clear.toFixed(2)} m clear (tallest child ${TALLEST_CHILD_HEIGHT}), frame ${(everything.max.y - floorY).toFixed(2)} m tall`);

  // ---------------------------------------------- 3. marched at, and stopped
  const march = (rect: { minX: number; maxX: number; minZ: number; maxZ: number }, bearing: number, stride: number): number => {
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const at = new Vector3(cx + Math.sin(bearing) * 3, floorY, cz + Math.cos(bearing) * 3);
    for (let i = 0; i < Math.ceil(3.5 / stride) + 20; i += 1) {
      const dx = cx - at.x;
      const dz = cz - at.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) break;
      const s = Math.min(stride, d);
      collision.resolveMovement(at, (dx / d) * s, (dz / d) * s, PLAYER_RADIUS, 0, MAX_FRAME_DELTA, undefined, undefined, TALLEST_CHILD_HEIGHT, floorY);
      at.y = floorY;
    }
    return toRect(at.x, at.z, rect);
  };
  let marches = 0;
  let closest = Infinity;
  for (const [index, drawn] of sides.entries()) {
    const rect = { minX: drawn.min.x, maxX: drawn.max.x, minZ: drawn.min.z, maxZ: drawn.max.z };
    for (let b = 0; b < 16; b += 1) {
      for (const stride of STRIDES) {
        const d = march(rect, (b / 16) * Math.PI * 2, stride);
        marches += 1;
        closest = Math.min(closest, d);
        if (d < PLAYER_RADIUS - 0.02) fail(`${room.name}: a march at post ${index} from ${(b * 22.5).toFixed(1)}° at ${stride.toFixed(2)} m ended ${d.toFixed(3)} m from it — inside her own radius`);
      }
    }
  }
  // Control: the left post's collider out, and a march straight at it from
  // inside the room must now end inside the drawn post.
  {
    const box = placed.solids.posts[0];
    if (box) {
      collision.removeBox(box);
      const rect = { minX: left.min.x, maxX: left.max.x, minZ: left.min.z, maxZ: left.max.z };
      const d = march(rect, Math.PI, 0.05);
      collision.restoreBox(box);
      if (d >= PLAYER_RADIUS - 0.02) fail(`${room.name}: CONTROL — with the post's collider out, a march still stopped ${d.toFixed(3)} m from it; the march cannot see a missing collider`);
      say(`  ${marches} marches at the posts, closest body edge ${(closest - PLAYER_RADIUS).toFixed(3)} m off the stone; control (collider out) reached ${d.toFixed(3)} m — inside`);
    }
  }

  // ---------------------------------------------- 4. the opening stays walkable
  for (const solid of solidsOf(placed)) collision.removeBox(solid);
  const without = lanesThrough(room);
  for (const solid of solidsOf(placed)) collision.restoreBox(solid);
  const withFrame = lanesThrough(room);
  const lost = [...without].filter((lane) => !withFrame.has(lane));
  const centreLanes = [...without].filter((lane) => / -?0\.0[0-4] @/.test(lane) || / 0\.00 @/.test(lane));
  if (without.size === 0 || centreLanes.length === 0) fail(`${room.name}: no lane through the doorway's middle gets through even without the frame — the walk measures nothing`);
  if (lost.length > 0) fail(`${room.name}: the frame blocks ${lost.length} lane(s) that got through without it: ${lost.slice(0, 6).join(', ')}`);
  say(`  ${withFrame.size} of ${without.size} lane-walks that get through without the frame get through with it (lanes ${LANE_SPACING} m apart, both ways, at ${STRIDES.map((s) => s.toFixed(2)).join(' and ')} m)`);

  // Control: a frame narrowed by 0.3 m a side in place of the real one.
  {
    for (const solid of solidsOf(placed)) collision.removeBox(solid);
    const narrowed = buildDoorFrame(frame.style, { ...frame.opening, minX: frame.opening.minX + 0.3, maxX: frame.opening.maxX - 0.3 });
    const control = registerDoorFrameSolids(collision, narrowed, ox, oz, placed.originY);
    const throughNarrow = lanesThrough(room);
    for (const solid of [...control.posts, control.lintel]) collision.removeBox(solid);
    for (const solid of solidsOf(placed)) collision.restoreBox(solid);
    const lostNarrow = [...without].filter((lane) => !throughNarrow.has(lane)).length;
    if (lostNarrow === 0) fail(`${room.name}: CONTROL — a frame 0.6 m narrower lost no lanes; the walk cannot see a narrowed opening`);
    say(`  control: a frame 0.3 m narrower a side loses ${lostNarrow} of ${without.size} lane-walks — red, as it must be`);
  }
}

say(`\n${rooms.length} interiors with a way out to the park, each with its frame: ${rooms.map((r) => r.name).join(', ')}`);
if (failures.length > 0) {
  console.error(`\n✗ check:doorframes — ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
console.log('\n✓ check:doorframes — every way out has its frame, round the exit, solid where drawn, and narrowing nothing.\n');
process.exit(0);
