import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { BUILDING_FLOOR_HEIGHT } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { interiorMaterial } from './parts';
import { stairFlights, TOP_DECK, type RampDefinition } from './layout';

/** Rise of a single tread. Chunky, because everything in this park is chunky. */
const TREAD_RISE = 0.3;

/**
 * The stairs: a switchback flight per storey, in the north-west shaft.
 *
 * The treads are geometry only — what the player actually walks on is the pair
 * of ramp surfaces declared in `layout.ts`, clamped at each end so the top of
 * flight A and the bottom of flight B share the half-landing automatically.
 */
export class Stairs {
  constructor(floorGroups: readonly Group[]) {
    for (let deck = 0; deck < TOP_DECK; deck += 1) {
      const floor = floorGroups[deck];
      if (!floor) continue;

      const group = new Group();
      group.name = `stairs-${deck}`;
      floor.add(group);

      const [flightA, flightB] = stairFlights(deck);
      const bottom = deck * BUILDING_FLOOR_HEIGHT;
      group.add(buildTreads(flightA, bottom), buildStringer(flightA, bottom));
      group.add(buildTreads(flightB, bottom), buildStringer(flightB, bottom));
      group.add(buildLanding(flightA, flightB, bottom));
      group.add(buildBalustrade(flightA, flightB, bottom));
      group.add(buildHandrails(flightA, bottom), buildHandrails(flightB, bottom));
    }
  }
}

/**
 * One instanced mesh per flight: every tread is the same slab.
 *
 * Thin slabs with a gap between them, riding on a solid stringer. An earlier
 * version extruded each tread all the way down to the floor to save a mesh, and
 * from above the whole flight read as one grey ramp — the shadow between the
 * treads is the only thing that says "stairs".
 */
function buildTreads(flight: RampDefinition, groupBase: number): InstancedMesh {
  const rise = flight.yTo - flight.yFrom;
  const count = Math.max(2, Math.round(Math.abs(rise) / TREAD_RISE));
  const run = flight.to - flight.from;
  const width = flight.footprint.maxX - flight.footprint.minX - 0.45;
  const depth = Math.abs(run) / count;

  const treads = new InstancedMesh(
    new BoxGeometry(width, 0.24, depth * 0.82),
    interiorMaterial(PALETTE.buildingFloor, 0.8),
    count,
  );
  treads.castShadow = false;
  treads.receiveShadow = true;

  const centreX = (flight.footprint.minX + flight.footprint.maxX) / 2;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  for (let i = 0; i < count; i += 1) {
    const t = (i + 1) / count;
    const top = flight.yFrom + rise * t - groupBase;
    const z = flight.from + run * (t - 0.5 / count);
    position.set(centreX, top - 0.12, z);
    matrix.compose(position, rotation, scale);
    treads.setMatrixAt(i, matrix);
  }
  treads.instanceMatrix.needsUpdate = true;
  return treads;
}

/** The solid slope the treads sit on, so you cannot see through the flight. */
function buildStringer(flight: RampDefinition, groupBase: number): Mesh {
  const run = flight.to - flight.from;
  const rise = flight.yTo - flight.yFrom;
  const length = Math.hypot(run, rise);
  const width = flight.footprint.maxX - flight.footprint.minX - 0.2;

  const mesh = new Mesh(
    new BoxGeometry(width, 0.55, length),
    interiorMaterial(PALETTE.buildingTrim, 0.82),
  );
  mesh.receiveShadow = true;
  mesh.position.set(
    (flight.footprint.minX + flight.footprint.maxX) / 2,
    flight.yFrom + rise / 2 - groupBase - 0.42,
    flight.from + run / 2,
  );
  mesh.rotation.x = -Math.atan2(rise, run);
  return mesh;
}

/**
 * The half-landing where the switchback turns.
 *
 * Derived from the flights rather than typed in, so moving the stairwell — as
 * the roomier interior did, by fourteen metres — cannot leave the landing behind
 * in the old shaft.
 */
function buildLanding(
  flightA: RampDefinition,
  flightB: RampDefinition,
  groupBase: number,
): Mesh {
  const top = flightA.yTo - groupBase;
  const width = flightB.footprint.maxX - flightA.footprint.minX;
  const mesh = new Mesh(
    new BoxGeometry(width, 0.28, 1.1),
    interiorMaterial(PALETTE.buildingFloorAlt, 0.8),
  );
  mesh.receiveShadow = true;
  mesh.position.set(
    (flightA.footprint.minX + flightB.footprint.maxX) / 2,
    top - 0.14,
    flightA.to - 0.45,
  );
  return mesh;
}

/**
 * Chunky pastel balustrade posts, both sides of both flights.
 *
 * Posts alone used to stand only on each flight's outer edge, on the
 * understanding that the other edge was "the middle" and therefore safe. It is
 * not: this is a switchback, so at any given point along it the two flights
 * are mid-climb by different amounts, and the shared inner edge between them
 * is a bigger drop than either outer one. Every edge gets posts.
 */
function buildBalustrade(
  flightA: RampDefinition,
  flightB: RampDefinition,
  groupBase: number,
): InstancedMesh {
  const posts = new InstancedMesh(
    new BoxGeometry(0.18, 1, 0.18),
    interiorMaterial(PALETTE.buildingTrim, 0.7),
    44,
  );
  posts.castShadow = false;
  posts.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  let index = 0;

  for (const flight of [flightA, flightB]) {
    for (const edgeX of [flight.footprint.minX + 0.2, flight.footprint.maxX - 0.2]) {
      for (let i = 0; i < 11; i += 1) {
        const t = i / 10;
        const z = flight.from + (flight.to - flight.from) * t;
        const top = flight.yFrom + (flight.yTo - flight.yFrom) * t - groupBase;
        scale.set(1, 1.05, 1);
        position.set(edgeX, top + 0.52, z);
        matrix.compose(position, rotation, scale);
        posts.setMatrixAt(index, matrix);
        index += 1;
      }
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  return posts;
}

/**
 * A solid handrail bar along each edge of one flight, matching the escalator's
 * treatment (`Escalators.ts`'s `buildBalustrades`) so the two ways up read as
 * the same family of furniture. The posts above are decoration; this is the
 * part that reads, from a child's eye height, as "you cannot fall off here."
 *
 * The matching collision walls live in `Building.ts` (`addRampSideWalls`),
 * registered straight from this flight's footprint so the solid rail and the
 * invisible one can never disagree about where the edge is.
 */
function buildHandrails(flight: RampDefinition, groupBase: number): InstancedMesh {
  const run = flight.to - flight.from;
  const rise = flight.yTo - flight.yFrom;
  const length = Math.hypot(run, rise);
  const angle = -Math.atan2(rise, run);

  const rails = new InstancedMesh(
    new BoxGeometry(0.22, 0.95, length),
    interiorMaterial(PALETTE.buildingTrim, 0.72),
    2,
  );
  rails.castShadow = false;
  rails.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  [flight.footprint.minX + 0.11, flight.footprint.maxX - 0.11].forEach((x, index) => {
    position.set(x, flight.yFrom + rise / 2 - groupBase + 0.46, flight.from + run / 2);
    matrix.compose(position, rotation, scale);
    rails.setMatrixAt(index, matrix);
  });
  rails.instanceMatrix.needsUpdate = true;
  return rails;
}
