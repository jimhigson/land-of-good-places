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
 *    underside to its drawn top, and every crest's over its drawn box. Every
 *    lintel's underside is over her head at the top of a jump (KID_HEIGHT +
 *    JUMP_SPEED² / 2g), so nothing in the frame is in reach but its posts. The
 *    castle's gatehouse top stands past the room's 3.30 m ceiling on purpose,
 *    in the wall's line where there is none, and clears the porch roof
 *    outside, which hides everything lower from the camera.
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
 * 5. **A jump through goes through.** On three lanes, both ways, taking off
 *    from 2.5 m before the wall line to 0.5 m past it, at 60 and 30 frames a
 *    second, a run-and-jump moved exactly as `Player` moves her in the air
 *    must end where the same jump ends with the frame's solids out. Proved red
 *    on the first lintels (3.25 m, the castle's 3.02 m, against a 3.40 m head):
 *    36, 48, 36 and 90 of 156 jumps changed. Control, every run: a lintel
 *    slung 0.15 m under that head must change some.
 *
 * 6. **A tap in the doorway takes her out.** Taps all over each opening are
 *    steered past the exit band's inner edge (`entities/doorwayTap.ts`): on her
 *    floor, every arrival inside the band, reached by a clear walk; a tap off
 *    the opening is left alone. Control: walking to the tapped floor itself
 *    (what stranded her under the hotel's arch in QA) must stop short.
 *
 * Coverage — rooms, lanes, marches, jumps, taps — is written to stderr on every run.
 */
import './headless-canvas.mjs';
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { GRAVITY, JUMP_SPEED, MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_MAX_SPEED, PLAYER_RADIUS } from '../src/core/constants.ts';
import { KID_HEIGHT } from '../src/art/models/kidHeight.ts';
import { INTERIOR_DOOR_MAX_X, INTERIOR_DOOR_MIN_X } from '../src/world/building/layout.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { buildDoorFrame, registerDoorFrameSolids, type PlacedDoorFrame } from '../src/art/models/doorFrames.ts';
import { castleExitBand } from '../src/world/building/Building.ts';
import { DOOR_HALF, LOBBY, hotelDoorBands } from '../src/world/hotel/layout.ts';
import { reptileDoorGap, reptileExitBand } from '../src/world/reptileHouse/shell.ts';
import { libraryDoorGap, libraryExitBand } from '../src/world/library/shell.ts';
import { distanceToBand, type PortalBand } from '../src/world/tapSpacing.ts';
import { DOORWAY_TAP_PAST_EDGE, doorwayTapReach, doorwayTapTarget } from '../src/entities/doorwayTap.ts';
import { ARRIVE_RADIUS } from '../src/entities/TapNavigator.ts';
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

/** Her head at the top of a jump: `Player` moves a KID_HEIGHT body in the air, feet on the arc. */
const HEAD_AT_APEX = KID_HEIGHT + (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

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
  return [...placed.solids.posts, placed.solids.lintel, placed.solids.crest];
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
    // flat-ok: the interiors are flat plates at their own far origins, off the planet; a frame's drawn box is upright there
    if (Math.abs(drawn.min.y - floorY) > TOL) fail(`${room.name}: post ${index} stands at ${drawn.min.y.toFixed(3)}, the floor at ${floorY.toFixed(3)}`);
  }
  const lintel = union(frameMeshes(placed, 'lintel').map(drawnBounds));
  const lintelSolid = placed.solids.lintel;
  // flat-ok: the interiors are flat plates at their own far origins, off the planet; the lintel's drawn box is upright there
  const [lintelBottom, lintelTopDrawn] = [lintel.min.y, lintel.max.y];
  if (Math.abs(lintelSolid.baseHeight - lintelBottom) > TOL || Math.abs(lintelSolid.topHeight - lintelTopDrawn) > TOL) {
    fail(`${room.name}: the lintel's collider band ${lintelSolid.baseHeight.toFixed(3)}..${lintelSolid.topHeight.toFixed(3)} is not its drawn ${lintelBottom.toFixed(3)}..${lintelTopDrawn.toFixed(3)}`);
  }
  for (const box of placed.solids.posts) {
    if (Math.abs(box.topHeight - lintelTopDrawn) > TOL) fail(`${room.name}: a post's collider tops out at ${box.topHeight.toFixed(3)}, the lintel over it at ${lintelTopDrawn.toFixed(3)}`);
  }
  const clear = lintelBottom - floorY;
  if (clear < TALLEST_CHILD_HEIGHT) fail(`${room.name}: the lintel is ${clear.toFixed(3)} m over the floor, under the tallest child (${TALLEST_CHILD_HEIGHT})`);
  const everything = union(frameMeshes(placed, '').map(drawnBounds));
  const frameTall = everything.max.y - floorY; // flat-ok: the interiors are flat plates at their own far origins, off the planet
  if (clear < HEAD_AT_APEX) fail(`${room.name}: the lintel's underside is ${clear.toFixed(3)} m over the floor, under her head at the top of a jump (${HEAD_AT_APEX.toFixed(3)} m)`);
  // The crest's collider is its drawn box.
  {
    const drawn = union(frameMeshes(placed, 'crest').map(drawnBounds));
    const box = placed.solids.crest;
    // flat-ok: the interiors are flat plates at their own far origins, off the planet
    const [drawnBottom, drawnTop] = [drawn.min.y, drawn.max.y];
    const off = Math.max(
      Math.abs(box.cx - box.halfX - drawn.min.x),
      Math.abs(box.cx + box.halfX - drawn.max.x),
      Math.abs(box.cz - box.halfZ - drawn.min.z),
      Math.abs(box.cz + box.halfZ - drawn.max.z),
      Math.abs(box.baseHeight - drawnBottom),
      Math.abs(box.topHeight - drawnTop),
    );
    if (off > TOL) fail(`${room.name}: the crest's collider is ${off.toFixed(3)} m off its drawn box`);
  }
  // **The castle's way out must be seen past its porch roof.** From the game's
  // camera the roof just outside hides everything at the door lower than its
  // own top, so the frame's gatehouse top must start above it — measured off
  // both meshes in the scene.
  if (frame.style === 'castle') {
    let roofTop = Number.NaN;
    scene.traverse((node) => {
      if (node instanceof Mesh && node.name === 'interior-porch-roof') roofTop = drawnBounds(node).max.y; // flat-ok: the interior's flat far-off plate
    });
    const parapet = union(frameMeshes(placed, 'crest-parapet').map(drawnBounds));
    const parapetBottom = parapet.min.y; // flat-ok: the interior's flat far-off plate
    if (!Number.isFinite(roofTop)) fail('castle: no interior-porch-roof mesh in the scene to measure the gatehouse top against');
    else if (parapetBottom <= roofTop) fail(`castle: the gatehouse top starts at ${parapetBottom.toFixed(3)}, under the porch roof's top ${roofTop.toFixed(3)} — the camera cannot see it`);
    else say(`  gatehouse top from ${(parapetBottom - floorY).toFixed(2)} m, over the porch roof's top at ${(roofTop - floorY).toFixed(2)} m`);
  }
  say(`  posts' colliders on their drawn footprints; lintel ${clear.toFixed(2)} m clear (tallest child ${TALLEST_CHILD_HEIGHT}), frame ${frameTall.toFixed(2)} m tall`);

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
  const kept = without.size - lost.length;
  say(
    `  ${kept} of ${without.size} lane-walks that get through without the frame get through with it, ${withFrame.size - kept} more besides ` +
      `(lanes ${LANE_SPACING} m apart across the gap, both ways, at ${STRIDES.map((s) => s.toFixed(2)).join(' and ')} m)`,
  );

  // Control: a frame narrowed by 0.3 m a side in place of the real one.
  {
    for (const solid of solidsOf(placed)) collision.removeBox(solid);
    const narrowed = buildDoorFrame(frame.style, { ...frame.opening, minX: frame.opening.minX + 0.3, maxX: frame.opening.maxX - 0.3 });
    const control = registerDoorFrameSolids(collision, narrowed, ox, oz, placed.originY);
    const throughNarrow = lanesThrough(room);
    for (const solid of [...control.posts, control.lintel, control.crest]) collision.removeBox(solid);
    for (const solid of solidsOf(placed)) collision.restoreBox(solid);
    const lostNarrow = [...without].filter((lane) => !throughNarrow.has(lane)).length;
    if (lostNarrow === 0) fail(`${room.name}: CONTROL — a frame 0.6 m narrower lost no lanes; the walk cannot see a narrowed opening`);
    say(`  control: a frame 0.3 m narrower a side loses ${lostNarrow} of ${without.size} lane-walks — red, as it must be`);
  }
}


// ---------------------------------------------- 5. a jump through goes through
//
// Player's airborne movement: `moverHeight` is KID_HEIGHT and the feet ride
// the jump's arc (no `feetY`), so at the apex her head is KID_HEIGHT +
// JUMP_SPEED² / 2g over the floor — the band a lintel must stay above. The
// PR #743 review found 63 of 312 jumps stopped dead in mid-air at lintels
// whose undersides were 3.25 m (3.02 m in the castle) against a 3.40 m head.
const JUMP_DTS = [1 / 60, 1 / 30] as const;

/** Runs at the doorway, hops at `jumpAt` (world z), and reports where she ended and where (if anywhere) she was stopped dead. */
function jumpRun(placed: PlacedDoorFrame, x: number, dir: number, jumpAt: number, dt: number): { endZ: number; stoppedAt: number } {
  const wallZ = placed.originZ + placed.frame.opening.z;
  const floor = placed.originY + placed.frame.opening.floorY;
  const at = new Vector3(x, floor, wallZ - dir * WALK_DEPTH);
  let vy = 0;
  let air = false;
  let jumped = false;
  let stoppedAt = Number.NaN;
  for (let i = 0; i < Math.ceil((2 * WALK_DEPTH + 2) / (PLAYER_MAX_SPEED * dt)); i += 1) {
    if (!jumped && dir * (at.z - jumpAt) >= 0) {
      jumped = true;
      air = true;
      vy = JUMP_SPEED;
    }
    let y = floor;
    if (air) {
      vy -= GRAVITY * dt;
      y = Math.max(floor, at.y + vy * dt);
      if (y <= floor) {
        air = false;
        vy = 0;
      }
    }
    const before = at.z;
    at.y = y;
    collision.resolveMovement(at, 0, dir * PLAYER_MAX_SPEED * dt, PLAYER_RADIUS, 0, dt, undefined, undefined, KID_HEIGHT, air ? undefined : floor);
    at.y = y;
    if (Math.abs(at.z - before) < 1e-4 && Number.isNaN(stoppedAt)) stoppedAt = at.z - wallZ;
    if (dir * (at.z - (wallZ + dir * WALK_DEPTH)) >= 0) break;
  }
  return { endZ: at.z - wallZ, stoppedAt };
}

/** Every jump lane × direction × take-off × frame rate whose run differs from the same run with the frame's solids out. */
function jumpsChanged(room: Room, solids: readonly BoxCollider[]): { changed: string[]; runs: number } {
  const { placed } = room;
  const wallZ = placed.originZ + placed.frame.opening.z;
  const centre = placed.originX + (room.gap[0] + room.gap[1]) / 2;
  const changed: string[] = [];
  let runs = 0;
  for (const offset of [-0.4, 0, 0.4]) {
    for (const dir of [1, -1]) {
      for (let before = -0.5; before <= 2.5 + 1e-9; before += 0.25) {
        for (const dt of JUMP_DTS) {
          const jumpAt = wallZ - dir * before;
          for (const solid of solids) collision.removeBox(solid);
          const free = jumpRun(placed, centre + offset, dir, jumpAt, dt);
          for (const solid of solids) collision.restoreBox(solid);
          const framed = jumpRun(placed, centre + offset, dir, jumpAt, dt);
          runs += 1;
          const differs =
            Math.abs(free.endZ - framed.endZ) > 0.02 ||
            Number.isNaN(free.stoppedAt) !== Number.isNaN(framed.stoppedAt) ||
            Math.abs(free.stoppedAt - framed.stoppedAt) > 0.02;
          if (differs) {
            changed.push(
              `${dir > 0 ? 'out' : 'in'} lane ${offset} jumping ${before.toFixed(2)} m before the wall at 1/${Math.round(1 / dt)} s: ` +
                `ended ${framed.endZ.toFixed(2)} m past the wall line${Number.isNaN(framed.stoppedAt) ? '' : `, stopped dead ${framed.stoppedAt.toFixed(2)} m from it`} ` +
                `(without the frame: ended ${free.endZ.toFixed(2)}${Number.isNaN(free.stoppedAt) ? ', never stopped' : `, stopped ${free.stoppedAt.toFixed(2)}`})`,
            );
          }
        }
      }
    }
  }
  return { changed, runs };
}

for (const room of rooms) {
  const { placed } = room;
  const { changed, runs } = jumpsChanged(room, solidsOf(placed));
  if (changed.length > 0) fail(`${room.name}: the frame changes ${changed.length} of ${runs} jumps through the doorway — ${changed.slice(0, 4).join('; ')}`);
  // Control: a lintel slung under her head at the apex, in place of the real
  // one, must stop jumps — or the instrument cannot see a low lintel at all.
  const floor = placed.originY + placed.frame.opening.floorY;
  for (const solid of solidsOf(placed)) collision.removeBox(solid);
  const low = collision.addBox(
    placed.originX + (placed.frame.opening.minX + placed.frame.opening.maxX) / 2,
    placed.originZ + placed.frame.opening.z,
    (placed.frame.opening.maxX - placed.frame.opening.minX) / 2,
    placed.frame.lintelHalfZ,
    0,
    0,
    floor + HEAD_AT_APEX + 0.3,
    false,
    true,
    floor + HEAD_AT_APEX - 0.15,
  );
  const control = jumpsChanged(room, [low]);
  collision.removeBox(low);
  for (const solid of solidsOf(placed)) collision.restoreBox(solid);
  if (control.changed.length === 0) fail(`${room.name}: CONTROL — a lintel 0.15 m under her head at the apex stopped no jump; the jump lane cannot see a low lintel`);
  say(
    `${room.name}: ${runs - changed.length} of ${runs} jumps through the doorway go exactly as they do with no frame ` +
      `(head ${HEAD_AT_APEX.toFixed(2)} m at the apex, lintel from ${(placed.solids.lintel.baseHeight - floor).toFixed(2)} m); ` +
      `control: a lintel 0.15 m under that head changes ${control.changed.length}`,
  );
}

// ---------------------------------------------- 6. a tap in the doorway takes her out
//
// QA on #743: a tap in the hotel's or the Reptile House's doorway walked her
// under the arch and stopped her there — `TapNavigator` calls her arrived
// within ARRIVE_RADIUS of the tapped floor, and the exit band's inner edge
// is 0.6 m in from the wall. `doorwayTapTarget` moves such a tap past that
// edge; this holds it, for taps all over each opening, to: the target is on
// floor she can stand on; every stop that counts as arriving there is inside
// the band (so the walk ends by crossing into it); a straight walk in from
// the room gets there; and a tap off the opening is left alone. The real
// finger is `scripts/qa-doorway-tap.mjs`.
{
  const exits = world.doorwayExits;
  if (exits.length !== rooms.length) fail(`World.doorwayExits lists ${exits.length} ways out, this check ${rooms.length}`);
  for (const { placed, band } of exits) {
    const name = rooms.find((r) => r.placed === placed)?.name ?? placed.frame.style;
    const o = placed.frame.opening;
    const wallZ = placed.originZ + o.z;
    const out = Math.sign(o.z) || 1;
    const floor = placed.originY + o.floorY;
    const reach = doorwayTapReach(placed);
    let taps = 0;
    let bad = 0;
    let controlShort = 0;
    const firstBad: string[] = [];
    for (let x = placed.originX + o.minX + 0.05; x <= placed.originX + o.maxX - 0.05 + 1e-9; x += 0.2) {
      for (let inward = -placed.frame.lintelHalfZ; inward <= reach + 1e-9; inward += 0.1) {
        const tapZ = wallZ - out * inward;
        const target = doorwayTapTarget(exits, x, floor, tapZ);
        taps += 1;
        const why: string[] = [];
        if (!target) why.push('no target');
        else {
          const shortest = { x: target.x, z: target.z - out * ARRIVE_RADIUS };
          if (distanceToBand(band, shortest.x, shortest.z) > 0) why.push(`a stop ${ARRIVE_RADIUS} m short (${(shortest.z - wallZ).toFixed(2)} m off the wall) is outside the band`);
          const ground = park.sample(target.x, target.z, floor + 0.5);
          if (Math.abs(ground - floor) > 0.05) why.push(`the target's floor is at ${(ground - floor).toFixed(2)} m, not the room's`);
          const at = new Vector3(target.x, floor, wallZ - out * WALK_DEPTH);
          for (let i = 0; i < 200 && Math.hypot(target.x - at.x, target.z - at.z) > ARRIVE_RADIUS; i += 1) {
            const dz = target.z - at.z;
            const step = Math.sign(dz) * Math.min(0.2, Math.abs(dz));
            collision.resolveMovement(at, 0, step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA, undefined, undefined, TALLEST_CHILD_HEIGHT, floor);
            at.y = floor;
          }
          // Arriving, or being stopped anywhere inside the band on the way, both
          // take her out: the room's trigger is entering the band.
          if (Math.hypot(target.x - at.x, target.z - at.z) > ARRIVE_RADIUS && distanceToBand(band, at.x, at.z) > 0) {
            why.push(`a walk from the room stops ${Math.hypot(target.x - at.x, target.z - at.z).toFixed(2)} m short of it, outside the band`);
          }
        }
        // The control, the old behaviour: walk to the tapped floor itself.
        if (distanceToBand(band, x, tapZ - out * ARRIVE_RADIUS) > 0) controlShort += 1;
        if (why.length > 0) {
          bad += 1;
          if (firstBad.length < 3) firstBad.push(`tap ${(x - placed.originX).toFixed(2)}, ${inward.toFixed(2)} m in: ${why.join('; ')}`);
        }
      }
    }
    if (bad > 0) fail(`${name}: ${bad} of ${taps} taps in the doorway would not take her out — ${firstBad.join(' | ')}`);
    if (controlShort === 0) fail(`${name}: CONTROL — walking to the tapped floor itself would always end in the band; the clause measures nothing`);
    // A tap that lands on the frame itself — its tops are standable, so a
    // finger aimed at the opening often lands on the lintel or the crest
    // (QA's library tap landed on the open book, 1.08 m in) — goes out too.
    let onFrame = 0;
    const left = placed.frame.posts[0];
    const right = placed.frame.posts[1];
    if (left && right) {
      const lintelTop = floor + placed.frame.lintelTop;
      // Just inside each edge of the frame's plan, and across its middle.
      const zs = [placed.frame.crest.minZ + 0.01, o.z - placed.frame.lintelHalfZ + 0.01, o.z, o.z + placed.frame.lintelHalfZ - 0.01, placed.frame.crest.maxZ - 0.01];
      for (let lx = left.minX + 0.01; lx <= right.maxX - 0.01 + 1e-9; lx += 0.25) {
        for (const lz of zs) {
          const target = doorwayTapTarget(exits, placed.originX + lx, lintelTop, placed.originZ + lz);
          onFrame += 1;
          if (!target || distanceToBand(band, target.x, target.z - out * ARRIVE_RADIUS) > 0) {
            fail(`${name}: a tap on the frame's top at ${lx.toFixed(2)}, ${(o.z - lz).toFixed(2)} m in does not take her out`);
          }
        }
      }
    }
    // A tap off the opening is an ordinary tap.
    const offs = [
      [placed.originX + o.minX - 0.3, wallZ - out * 0.3],
      [placed.originX + o.maxX + 0.3, wallZ - out * 0.3],
      [placed.originX + (o.minX + o.maxX) / 2, wallZ - out * (reach + 0.3)],
    ] as const;
    for (const [x, z] of offs) {
      if (doorwayTapTarget(exits, x, floor, z)) fail(`${name}: a tap off the opening at ${(x - placed.originX).toFixed(2)}, ${((wallZ - z) * out).toFixed(2)} m in is steered out of the room`);
    }
    say(
      `${name}: ${taps - bad} of ${taps} taps across the doorway (to ${reach.toFixed(2)} m in) end in the band, on her floor, reached from the room ` +
        `(aimed ${DOORWAY_TAP_PAST_EDGE.toFixed(2)} m past its inner edge), and ${onFrame} on the frame's own top; control: walking to the tapped floor itself stops short of the band on ${controlShort}`,
    );
  }
}

say(`\n${rooms.length} interiors with a way out to the park, each with its frame: ${rooms.map((r) => r.name).join(', ')}`);
if (failures.length > 0) {
  console.error(`\n✗ check:doorframes — ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  process.exit(1);
}
console.log('\n✓ check:doorframes — every way out has its frame, round the exit, solid where drawn, and narrowing nothing.\n');
process.exit(0);
