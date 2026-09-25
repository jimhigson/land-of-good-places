import {
  alongBoundary,
  PARK_BOUNDARY,
  TERRAIN_EDGE_RADIUS,
  type EdgeStation,
  type ParkBoundary,
} from './boundary';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  TERRAIN_RADIUS,
  TERRAIN_HEIGHT_SCALE,
  TERRAIN_SEGMENTS,
} from '../core/constants';
import { PALETTE } from '../core/palette';
import { Rng } from '../core/mathUtils';
import { grassTexture, pinkStoneTexture } from '../core/textures';
import { placeOnSphere, terrainHeight } from './terrain';
import { buildPaths } from './pathGraph';
import type { CollisionWorld } from './Collision';
import { ENTRANCE_GATE_HALF_WIDTH, entranceGateFrame } from './entrance/layout';
import { parkGateFeet } from './entrance/gateArch';

/**
 * The ground itself: grassy terrain, the winding paths and the pink stone
 * boundary wall.
 *
 * Everything here is static — built once, never updated — so it is a plain
 * builder rather than a GameSystem.
 */
/**
 * Half the width the boundary masonry occupies about the park's outline, in
 * metres — the pillar caps, which are the widest part of it.
 *
 * Exported because anything asking "is this thing clear of the park wall?" has
 * to measure against the *widest* stone, not the collision half-width (0.45)
 * that only the physics sees. A rail passing 0.5 m outside the outline would
 * clear the collider and still be driven straight through a pillar cap.
 *
 * Exported rather than copied, deliberately. This session alone has produced
 * four bugs of the form "the same number declared twice, then diverging" —
 * two stall stand points (#114), two `ParkBoundary` types, two `circleBoundary`
 * functions, and a `BRIDGE_RISE` that no longer matched the locomotive it was
 * supposed to clear. A number that describes built geometry belongs to the
 * module that builds it.
 */
export const BOUNDARY_MASONRY_HALF_WIDTH = 0.86;

/**
 * Half-thickness of the boundary wall as **collision** sees it — what a child
 * is actually stopped by, as opposed to the stone she can see.
 *
 * Narrower than {@link BOUNDARY_MASONRY_HALF_WIDTH} because the pillar caps
 * bulge past the run of blocks and nothing needs to collide with a decorative
 * bulge. Both numbers are real and they answer different questions: "could a
 * child be standing here?" is this one, "is there stone here?" is that one.
 */
export const BOUNDARY_WALL_COLLISION_HALF = 0.45;

export class Garden {
  readonly group = new Group();

  constructor(collision: CollisionWorld) {
    this.group.name = 'garden';

    this.group.add(buildTerrain());
    for (const mesh of buildPaths()) this.group.add(mesh);
    this.group.add(buildBoundaryWall(collision));
  }
}

/**
 * Rolling grass, built as a disc that ends a little way past the boundary wall.
 *
 * Why a disc and not an endless plane? Because the camera is orthographic and
 * tilted 38° down, so it only ever shows about 36 metres of ground depth — an
 * endless plane fills the frame completely and you never see the sky, which
 * would waste the entire day/night cycle. Ending the ground at
 * {@link TERRAIN_RADIUS} turns the park into a diorama on a hilltop: walk near
 * the edge and the sunset, the stars and the distant hills come into view.
 *
 * The visible cut edge is masked by the treeline in `Scenery`.
 */
function buildTerrain(): Mesh {
  const rings = TERRAIN_SEGMENTS;
  const segments = 128;
  const vertexCount = (rings + 1) * (segments + 1);

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colours = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  const tint = new Color();
  const grass = new Color(PALETTE.grass);
  const grassLight = new Color(PALETTE.grassLight);
  const grassDark = new Color(PALETTE.grassDark);

  for (let ring = 0; ring <= rings; ring += 1) {
    // Squared distribution puts more detail where the player actually walks.
    const radius = Math.pow(ring / rings, 1.35) * TERRAIN_EDGE_RADIUS;
    for (let segment = 0; segment <= segments; segment += 1) {
      const index = ring * (segments + 1) + segment;
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = terrainHeight(x, z);

      positions[index * 3] = x;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = z;

      // UVs come from world position so the grass tiles at a constant scale
      // instead of smearing out towards the rim.
      uvs[index * 2] = x / GRASS_TILE_METRES;
      uvs[index * 2 + 1] = z / GRASS_TILE_METRES;

      // High ground catches more light, hollows read cooler and darker.
      const t = height / (TERRAIN_HEIGHT_SCALE * 1.3);
      if (t >= 0) tint.copy(grass).lerp(grassLight, Math.min(1, t));
      else tint.copy(grass).lerp(grassDark, Math.min(1, -t));

      // A slow wobble breaks up the regularity of the sine hills.
      const wobble = 0.94 + 0.12 * Math.sin(x * 0.31 + z * 0.27);
      colours[index * 3] = tint.r * wobble;
      colours[index * 3 + 1] = tint.g * wobble;
      colours[index * 3 + 2] = tint.b * wobble;
    }
  }

  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * stride + segment;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new MeshStandardMaterial({
    map: grassTexture(1),
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The cute pink stone boundary wall: two courses of cobbles laid in a ring,
 * with fatter pillars capped by rounded knobs at regular intervals.
 */
function buildBoundaryWall(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'boundary-wall';

  // Laid out along the park's own edge. Every number below that used to be an
  // angle is now a distance walked round the outline, because on a boundary
  // running from 57 m to 110 m an even angular step is not an even spacing:
  // it would bond the masonry at the pinch and stretch it into a picket fence
  // at the bulge.
  const blockWidth = BOUNDARY_BLOCK_WIDTH;
  const courses = 2;
  // The gate's opening, cut along the edge itself and closed onto the arch's
  // piers — see {@link gateOpening}. A block is kept only if its whole length
  // is clear of the opening, never just its middle.
  const opening = gateOpening(PARK_BOUNDARY);
  const courseStations = [
    alongBoundary(PARK_BOUNDARY, blockWidth).filter((st) => opening.clears(st, blockWidth / 2)),
    // Half a block along the edge, which is what makes alternate courses bond.
    alongBoundary(PARK_BOUNDARY, blockWidth, blockWidth / 2).filter((st) =>
      opening.clears(st, blockWidth / 2),
    ),
  ];
  // The pieces that close each course onto the gate: a trimmed block from the
  // course's last whole one to the wall's end, then the return to the pier.
  const closing = courseStations.map((stations, course) =>
    closingPieces(opening, stations, blockWidth, course),
  );
  const courseHeight = 0.62;

  const blockGeometry = new BoxGeometry(blockWidth * 0.96, courseHeight, 0.7);
  const blockMaterial = new MeshStandardMaterial({
    map: pinkStoneTexture(1, 1),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
  });
  const instanceCount = courseStations.reduce(
    (sum, stations, course) => sum + stations.length + closing[course]!.length,
    0,
  );
  const blocks = new InstancedMesh(blockGeometry, blockMaterial, instanceCount);
  blocks.name = 'boundary-blocks';
  blocks.castShadow = true;
  blocks.receiveShadow = true;

  const matrix = new Matrix4();
  const positionVector = new Vector3();
  const quaternion = new Quaternion();
  const flatVector = new Vector3();
  const scale = new Vector3(1, 1, 1);
  const rng = new Rng(0x5701e);
  const colour = new Color();

  let index = 0;
  const pieceScale = new Vector3(1, 1, 1);
  for (let course = 0; course < courses; course += 1) {
    const stations = courseStations[course] as EdgeStation[];
    // Each course lays its own stations once. It used to lay the longer
    // course's count on both, wrapping the shorter one round, which stacked a
    // second block exactly inside the first whenever the two differed.
    for (let i = 0; i < stations.length; i += 1) {
      const station = stations[i] as EdgeStation;
      const { x, z } = station;
      const y = terrainHeight(x, z) + courseHeight * (course + 0.5);
      flatVector.set(x, y, z);
      // The box's long axis is X and must lie *along* the edge. `alongBoundary`
      // hands back the yaw that does it; pointing it across instead turns the
      // wall into a ring of separate tombstones.
      //
      // Every course of every block is placed from the ground under it, so the
      // whole ring leans outward with the sphere and the courses stay stacked
      // square on each other instead of shearing as the wall runs downhill.
      placeOnSphere(flatVector, station.yaw, positionVector, quaternion);
      matrix.compose(positionVector, quaternion, scale);
      blocks.setMatrixAt(index, matrix);
      // Gentle per-block colour jitter so the ring isn't a flat pink band.
      const shade = 0.9 + rng.unit() * 0.2;
      colour.setRGB(shade, shade * 0.98, shade);
      blocks.setColorAt(index, colour);
      index += 1;
    }
    for (const piece of closing[course]!) {
      const y = terrainHeight(piece.x, piece.z) + courseHeight * (course + 0.5);
      flatVector.set(piece.x, y, piece.z);
      placeOnSphere(flatVector, piece.yaw, positionVector, quaternion);
      pieceScale.set(piece.length / blockWidth, 1, 1);
      matrix.compose(positionVector, quaternion, pieceScale);
      blocks.setMatrixAt(index, matrix);
      const shade = 0.9 + rng.unit() * 0.2;
      colour.setRGB(shade, shade * 0.98, shade);
      blocks.setColorAt(index, colour);
      index += 1;
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  group.add(blocks);

  // Pillars with rounded caps — the gate's own two posts stand in `Entrance.ts`,
  // so the ring's regular pillars keep out of the opening like everything else.
  const pillarStations = alongBoundary(
    PARK_BOUNDARY,
    PARK_BOUNDARY.perimeter / PILLAR_TARGET_COUNT,
  ).filter((st) => opening.clears(st, PILLAR_HALF_WIDTH));
  const pillarCount = pillarStations.length;
  const pillarGeometry = new BoxGeometry(2 * PILLAR_HALF_WIDTH, 2.1, 2 * PILLAR_HALF_WIDTH);
  const pillarMaterial = new MeshStandardMaterial({
    map: pinkStoneTexture(1, 1),
    roughness: 0.85,
    metalness: 0,
  });
  const pillars = new InstancedMesh(pillarGeometry, pillarMaterial, pillarCount);
  pillars.castShadow = true;
  pillars.receiveShadow = true;

  const capGeometry = new SphereGeometry(BOUNDARY_MASONRY_HALF_WIDTH, 14, 10);
  const capMaterial = new MeshStandardMaterial({
    color: PALETTE.stonePinkLight,
    roughness: 0.6,
    metalness: 0,
  });
  const caps = new InstancedMesh(capGeometry, capMaterial, pillarCount);
  caps.castShadow = true;

  for (let i = 0; i < pillarCount; i += 1) {
    const station = pillarStations[i] as EdgeStation;
    const { x, z } = station;
    const ground = terrainHeight(x, z);

    flatVector.set(x, ground + 1.05, z);
    placeOnSphere(flatVector, station.yaw, positionVector, quaternion);
    matrix.compose(positionVector, quaternion, scale);
    pillars.setMatrixAt(i, matrix);

    flatVector.set(x, ground + 2.15, z);
    placeOnSphere(flatVector, station.yaw, positionVector, quaternion);
    matrix.compose(positionVector, quaternion, SQUASHED_CAP);
    caps.setMatrixAt(i, matrix);
  }
  pillars.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  group.add(pillars, caps);

  // The wall is solid **except through the arch**. The collision polygon walks
  // the same outline the blocks do, at a coarser step — one segment per ~2 m
  // of edge, so the chord never bows further from the drawn masonry than the
  // masonry is thick — stops at exactly the two points the drawn wall stops
  // at, and carries on from each of them to its pier, the same way the drawn
  // returns do. So the hole you can see is the hole you can walk through, and
  // it is the arch and nothing beside it.
  //
  // It used to skip every segment inside a strip squared to the gate. The
  // boundary is pinned *through* the gate but not square to it — seed 0
  // crosses at about 35 degrees — so the strip stopped the wall metres short
  // of the piers: 3.16 m and 2.68 m of clear ground beside the arch on seed 0,
  // a hole in the park wall wider than a child on six of the sixteen parks.
  // `theWallClosesOntoTheGate` (test/procgen/invariants.ts) is what sees it.
  const collisionStations = alongBoundary(PARK_BOUNDARY, 2)
    .filter((st) => opening.clears(st, COLLISION_END_MIN))
    .sort((a, b) => opening.fromToEnd(a.s) - opening.fromToEnd(b.s));
  const chain: { x: number; z: number }[] = [
    opening.ends[1],
    ...collisionStations,
    opening.ends[0],
  ];
  for (let i = 1; i < chain.length; i += 1) {
    const a = chain[i - 1]!;
    const b = chain[i]!;
    collision.addWall(a.x, a.z, b.x, b.z, BOUNDARY_WALL_COLLISION_HALF);
  }
  for (let side = 0; side < 2; side += 1) {
    const end = opening.ends[side]!;
    const pier = opening.piers[side]!;
    if (Math.hypot(pier.x - end.x, pier.z - end.z) < RETURN_MIN_LENGTH) continue;
    collision.addWall(end.x, end.z, pier.x, pier.z, BOUNDARY_WALL_COLLISION_HALF);
  }

  return group;
}

/*
 * A note for anyone tempted to add distant scenery (hills, mountains, a skyline)
 * beyond the park: it does not work the way you expect under an orthographic
 * camera. There is no perspective convergence, so a point `d` metres further
 * away at height `h` lands at `d*sin(pitch) + h*cos(pitch)` up the screen —
 * distance pushes things *up and off the top of the frame*, not towards a
 * horizon. An earlier build had a ring of big hills here; all that was ever
 * visible was their sunken flanks filling the gap above the crest with green.
 * If you want a horizon, paint it into the Sky shader instead.
 */

/**
 * How many pillars the ring would carry if it had no gate in it.
 *
 * The two or three that fall in the opening are dropped, so the built count is
 * a little lower — spacing is what matters here, not the total.
 */
const PILLAR_TARGET_COUNT = 28;

/**
 * **The gate's opening in the boundary wall, and how the wall closes onto the
 * arch either side of it.**
 *
 * Issue #195 cut the first hole here (the gate had been an arch over unbroken
 * masonry — Jim watched the bus drive through it); #481 made it the arch's own
 * width in metres. Both cut it as a strip squared to the gate. But the park's
 * edge is a spline pinned *through* the gate at (0, 60), not square to it —
 * seed 0 crosses at about 35 degrees — so a strip squared to the gate stops the
 * wall wherever the slanted edge happens to leave the strip: (5.85, 64.13) east
 * and (-5.78, 56.36) west on seed 0, metres from piers standing at (+-4.3, 60).
 * The gap between each pier and its wall end measured 3.16 m and 2.68 m clear on
 * seed 0, and wider than a child's 1.24 m on six of the sixteen parks.
 *
 * So the opening is cut **along the edge's own line**: from where the edge
 * crosses the gate, out each way until it has passed the pier's line across the
 * gateway (`|across| >= ENTRANCE_GATE_HALF_WIDTH`). That is the whole of the
 * gap in the ring, whatever angle the edge crosses at. From each of those two
 * wall ends a **return** runs to its pier — the wall turning to meet the gate —
 * so the ring is closed onto the arch and the arch is the only way through.
 *
 * The ends sit on or beyond the pier's line and a return runs straight to the
 * pier's centre, so no masonry comes inside the pier faces: the 7 m the arch
 * promises between them is untouched. `theGateIsAHoleInTheWall` holds that,
 * and `theWallClosesOntoTheGate` holds the closure.
 */
interface GateOpening {
  /**
   * The two wall ends: `[0]` behind the gate crossing along the edge (decreasing
   * arc length), `[1]` ahead of it.
   */
  readonly ends: readonly [{ x: number; z: number }, { x: number; z: number }];
  /** The pier each end closes onto, same order. */
  readonly piers: readonly [{ x: number; z: number }, { x: number; z: number }];
  /** True if a piece `halfLength` either side of this station is clear of the opening. */
  clears(station: EdgeStation, halfLength: number): boolean;
  /** Arc length from `ends[1]` forward round the ring to `s` — for ordering the wall. */
  fromToEnd(s: number): number;
  /** Signed arc length from the gate crossing to `s`, in `[-P/2, P/2)`. */
  rel(s: number): number;
  /** Signed arc position of the two ends, `[0]` negative and `[1]` positive. */
  readonly span: readonly [number, number];
  /** The point on the edge at signed arc position `rel`. */
  pointAt(rel: number): { x: number; z: number };
}

/**
 * How far a wall end may be walked along the edge looking for the pier's line
 * before the park is declared unbuildable. A return is a short piece of wall
 * turning to meet the gate; an edge so nearly parallel to the way in that it
 * has not passed the pier inside this is not a gate in a wall at all.
 */
const GATE_OPENING_MAX_WALK = 30;

/** Step along the edge used to find the opening's ends. */
const GATE_OPENING_STEP = 0.05;

function gateOpening(boundary: ParkBoundary): GateOpening {
  const fine = alongBoundary(boundary, GATE_OPENING_STEP);
  const count = fine.length;
  const perimeter = fine[0]!.perimeter;
  const ds = perimeter / count;
  const at = (k: number): EdgeStation => fine[((k % count) + count) % count]!;

  // Where the edge crosses the gate. The boundary is pinned to pass exactly
  // through it (`generateParkBoundary`), so this is the nearest station.
  let gate = 0;
  let nearest = Infinity;
  for (let k = 0; k < count; k += 1) {
    const { across, along } = entranceGateFrame(fine[k]!.x, fine[k]!.z);
    const d = Math.hypot(across, along);
    if (d < nearest) {
      nearest = d;
      gate = k;
    }
  }

  const walk = (direction: 1 | -1): number => {
    for (let k = 1; k * ds <= GATE_OPENING_MAX_WALK; k += 1) {
      const st = at(gate + direction * k);
      if (Math.abs(entranceGateFrame(st.x, st.z).across) >= ENTRANCE_GATE_HALF_WIDTH) return k;
    }
    throw new Error(
      `gateOpening: the park's edge runs ${GATE_OPENING_MAX_WALK} m from the gate without ` +
        `passing the gate pier's line (${ENTRANCE_GATE_HALF_WIDTH} m off the axis) — it is ` +
        'running along the way in rather than across it, and no wall can close onto the arch',
    );
  };
  const back = at(gate - walk(-1));
  const ahead = at(gate + walk(1));
  const gateS = at(gate).s;
  const rel = (s: number): number => {
    const d = (((s - gateS) % perimeter) + perimeter + perimeter / 2) % perimeter;
    return d - perimeter / 2;
  };
  const from = rel(back.s);
  const to = rel(ahead.s);

  const feet = parkGateFeet();
  const pierFor = (end: { x: number; z: number }): { x: number; z: number } => {
    const side = Math.sign(entranceGateFrame(end.x, end.z).across);
    return feet.find((f) => Math.sign(entranceGateFrame(f.x, f.z).across) === side) ?? feet[0];
  };

  return {
    ends: [
      { x: back.x, z: back.z },
      { x: ahead.x, z: ahead.z },
    ],
    piers: [pierFor(back), pierFor(ahead)],
    clears: (station, halfLength) => {
      const r = rel(station.s);
      return r - halfLength >= to || r + halfLength <= from;
    },
    fromToEnd: (s) => (((rel(s) - to) % perimeter) + perimeter) % perimeter,
    rel,
    span: [from, to],
    pointAt: (r) => {
      const st = at(gate + Math.round(r / ds));
      return { x: st.x, z: st.z };
    },
  };
}

interface ClosingPiece {
  readonly x: number;
  readonly z: number;
  /** Yaw putting the block's long axis along the piece, as `alongBoundary`'s. */
  readonly yaw: number;
  /** Length of stone this piece stands for, before the mortar gap. */
  readonly length: number;
}

/** Shorter than this, a trimmed block or a return is left out as a sliver. */
const RETURN_MIN_LENGTH = 0.1;

/**
 * A collision station this close to a wall end is dropped, so the chain does
 * not grow a sliver segment between the station and the end itself.
 */
const COLLISION_END_MIN = 0.2;

function piece(a: { x: number; z: number }, b: { x: number; z: number }): ClosingPiece {
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    yaw: Math.atan2(-(b.z - a.z), b.x - a.x),
    length: Math.hypot(b.x - a.x, b.z - a.z),
  };
}

/**
 * The blocks that close one course onto the gate, both sides: a block trimmed
 * to fill from the course's last whole block to the wall's end (whole blocks
 * sit on fixed stations, so the last one stops up to a block short), then the
 * return from the wall's end to the pier, split into block-sized pieces —
 * half a piece out of step on the upper course, so the return bonds like the
 * rest of the wall.
 */
function closingPieces(
  opening: GateOpening,
  kept: readonly EdgeStation[],
  blockWidth: number,
  course: number,
): ClosingPiece[] {
  const pieces: ClosingPiece[] = [];
  for (let side = 0; side < 2; side += 1) {
    const endRel = opening.span[side]!;
    // The nearest kept block on this side, and where its inner end is.
    let lastEdge = side === 0 ? -Infinity : Infinity;
    for (const st of kept) {
      const r = opening.rel(st.s);
      if (side === 0 && r < endRel + 1e-6) lastEdge = Math.max(lastEdge, r + blockWidth / 2);
      if (side === 1 && r > endRel - 1e-6) lastEdge = Math.min(lastEdge, r - blockWidth / 2);
    }
    if (Number.isFinite(lastEdge) && Math.abs(endRel - lastEdge) >= RETURN_MIN_LENGTH) {
      pieces.push(piece(opening.pointAt(lastEdge), opening.pointAt(endRel)));
    }

    const end = opening.ends[side]!;
    const pier = opening.piers[side]!;
    const length = Math.hypot(pier.x - end.x, pier.z - end.z);
    if (length < RETURN_MIN_LENGTH) continue;
    const n = Math.max(1, Math.round(length / blockWidth));
    const cuts: number[] = [0];
    for (let i = 1; i < n; i += 1) cuts.push(course % 2 === 0 ? i / n : (i - 0.5) / n);
    if (course % 2 === 1 && n > 1) cuts.push((n - 0.5) / n);
    cuts.push(1);
    for (let i = 1; i < cuts.length; i += 1) {
      const t0 = cuts[i - 1]!;
      const t1 = cuts[i]!;
      if (t1 - t0 < 1e-6) continue;
      pieces.push(
        piece(
          { x: end.x + (pier.x - end.x) * t0, z: end.z + (pier.z - end.z) * t0 },
          { x: end.x + (pier.x - end.x) * t1, z: end.z + (pier.z - end.z) * t1 },
        ),
      );
    }
  }
  return pieces;
}

/**
 * **How long one drawn block of the boundary wall is**, along the edge.
 *
 * Exported because it is a *geometric fact about the built wall*: the park
 * facts carry it, and anything sizing a probe against the masonry reads it here.
 *
 * The invariant that proves no masonry stands in the gate's opening
 * (`theGateIsAHoleInTheWall`) used to derive a worst-case reach from this and
 * {@link BOUNDARY_MASONRY_HALF_WIDTH}, having once read the wall's own gate
 * margin constant and gone blind with it — zeroing the margin moved the code
 * *and the check together*, and the suite stayed green with stone in the
 * gateway. It now reads every block's real corners off its instance matrix and
 * the block's own geometry, which holds whatever policy lays the wall: a
 * worst-case reach assumed every block lies along the edge, and the returns
 * that close the wall onto the piers do not.
 */
export const BOUNDARY_BLOCK_WIDTH = 1.7;

/** Half the side of a boundary pillar, square in plan. */
const PILLAR_HALF_WIDTH = 0.75;

const SQUASHED_CAP = new Vector3(1, 0.72, 1);

/** Metres of ground covered by one repeat of the grass texture. */
const GRASS_TILE_METRES = 6;
