import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { BUILDING_FLOOR_HEIGHT, ESCALATOR_SPEED } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { createFloorArrow } from './FloorArrows';
import { interiorMaterial } from './parts';
import {
  escalatorRamp,
  ESCALATOR_DIRECTION_Z,
  regionContains,
  TOP_DECK,
  type RampDefinition,
} from './layout';

// Fewer, chunkier steps read far better at iso distance and on small screens
// than the original fine-grained tread (GAME_DESIGN.md item 31a) — this is
// more than double the old per-step depth (run / STEP_COUNT) over the same
// run. See `BELT_RATE` below for why the ride doesn't speed up as a result.
const STEP_COUNT = 10;
const LEGACY_STEP_COUNT = 22;

/**
 * How fast the belt visually crawls, in "whole run" fractions per second.
 *
 * `placeSteps` used to advance each step by `1 / STEP_COUNT` of the run every
 * time `phase` cycled 0..1, which tied the belt's apparent speed to the step
 * count: fewer (bigger) steps would each cover more ground per cycle and the
 * ride would look faster. `phase` now tracks progress across the *whole* run
 * directly (see `placeSteps`), advancing at this fixed rate instead — kept
 * numerically identical to the old STEP_COUNT=22 behaviour so the ride speed
 * is unchanged, only the step count/size is.
 */
const BELT_RATE = ESCALATOR_SPEED * (0.5 / LEGACY_STEP_COUNT);

/**
 * The escalators — one going up per storey, like a real shopping centre.
 *
 * The steps are an instanced mesh that creeps along the slope and wraps round,
 * which costs one draw call a flight and reads perfectly at iso distance. The
 * player is carried by {@link carry}, a nudge applied after they have moved:
 * stand still and you still arrive at the top.
 */
export class Escalators {
  private readonly stepMeshes: { mesh: InstancedMesh; ramp: RampDefinition; base: number }[] = [];
  private readonly ramps: RampDefinition[] = [];
  private phase = 0;

  constructor(floorGroups: readonly Group[]) {
    for (let deck = 0; deck < TOP_DECK; deck += 1) {
      const floor = floorGroups[deck];
      if (!floor) continue;

      const ramp = escalatorRamp(deck);
      this.ramps.push(ramp);

      const group = new Group();
      group.name = `escalator-${deck}`;
      floor.add(group);

      const base = deck * BUILDING_FLOOR_HEIGHT;
      group.add(buildDeckPlate(ramp, base));
      group.add(buildBalustrades(ramp, base));

      const steps = buildSteps(ramp);
      group.add(steps);
      this.stepMeshes.push({ mesh: steps, ramp, base });

      group.add(buildDirectionArrows(ramp, base));
    }
  }

  update(dt: number): void {
    this.phase = (this.phase + dt * BELT_RATE) % 1;
    for (const entry of this.stepMeshes) placeSteps(entry.mesh, entry.ramp, entry.base, this.phase);
  }

  /**
   * How far to shove a walker standing on an escalator this frame, in metres
   * along +Z. Returns 0 when they are not on one.
   */
  carry(localX: number, localZ: number, worldY: number, buildingBaseY: number, dt: number): number {
    for (const ramp of this.ramps) {
      if (!regionContains(ramp.footprint, localX, localZ)) continue;
      const span = ramp.to - ramp.from;
      const t = span === 0 ? 0 : clamp01((localZ - ramp.from) / span);
      const surface = buildingBaseY + ramp.yFrom + (ramp.yTo - ramp.yFrom) * t;
      if (Math.abs(worldY - surface) > 0.5) continue;
      // Only between the ends: the flat lead-in and the landing shouldn't drag.
      if (t <= 0.001 || t >= 0.999) continue;
      return ESCALATOR_DIRECTION_Z * ESCALATOR_SPEED * dt;
    }
    return 0;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The solid ramp under the steps — also what stops you seeing through it. */
function buildDeckPlate(ramp: RampDefinition, base: number): Mesh {
  const run = ramp.to - ramp.from;
  const rise = ramp.yTo - ramp.yFrom;
  const length = Math.hypot(run, rise);
  const width = ramp.footprint.maxX - ramp.footprint.minX;

  const mesh = new Mesh(
    new BoxGeometry(width, 0.5, length),
    interiorMaterial(PALETTE.escalatorRail, 0.75),
  );
  mesh.receiveShadow = true;
  mesh.position.set(
    (ramp.footprint.minX + ramp.footprint.maxX) / 2,
    ramp.yFrom + rise / 2 - base - 0.34,
    ramp.from + run / 2,
  );
  mesh.rotation.x = -Math.atan2(rise, run);
  return mesh;
}

function buildSteps(ramp: RampDefinition): InstancedMesh {
  const width = ramp.footprint.maxX - ramp.footprint.minX - 0.7;
  const run = Math.abs(ramp.to - ramp.from);
  // Chunkier in both directions a step reads as "big" in: deeper (the tread
  // running up the slope) and taller (the riser), not just more spread out.
  const steps = new InstancedMesh(
    new BoxGeometry(width, 0.34, (run / STEP_COUNT) * 0.92),
    interiorMaterial(PALETTE.escalatorStep, 0.55),
    STEP_COUNT,
  );
  steps.castShadow = false;
  steps.receiveShadow = true;
  return steps;
}

function placeSteps(mesh: InstancedMesh, ramp: RampDefinition, base: number, phase: number): void {
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const centreX = (ramp.footprint.minX + ramp.footprint.maxX) / 2;

  for (let i = 0; i < STEP_COUNT; i += 1) {
    // Steps crawl from the bottom to the top and reappear at the bottom.
    // `phase` already tracks progress across the whole run (see `BELT_RATE`),
    // so each step just needs its own fixed offset into that run before
    // wrapping — no division/mod by STEP_COUNT needed here any more.
    const t = (i / STEP_COUNT + phase) % 1;
    const z = ramp.from + (ramp.to - ramp.from) * t;
    const y = ramp.yFrom + (ramp.yTo - ramp.yFrom) * t - base;
    position.set(centreX, y + 0.17, z);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * A "this way up" chevron painted on the solid floor at each end, just
 * outside the sloped run itself (GAME_DESIGN.md item 31b) — one where you
 * step on, one where you step off, both pointing the same way the belt
 * actually carries you.
 *
 * `escalatorRamp` always runs `from` (the lower, entry end) to `to` (the
 * upper, exit end) along -Z (see `ESCALATOR_DIRECTION_Z`), and
 * `createFloorArrow()` points -Z unrotated, so no extra `rotation.y` is
 * needed at either end here — unlike the stairs, whose switchback reverses
 * direction partway up (see `Stairs.ts`).
 */
function buildDirectionArrows(ramp: RampDefinition, base: number): Group {
  const group = new Group();
  group.name = 'escalator-arrows';
  const centreX = (ramp.footprint.minX + ramp.footprint.maxX) / 2;
  const inset = 0.9;

  const bottom = createFloorArrow();
  bottom.position.set(centreX, ramp.yFrom - base + 0.02, ramp.from + inset);
  group.add(bottom);

  const top = createFloorArrow();
  top.position.set(centreX, ramp.yTo - base + 0.02, ramp.to - inset);
  group.add(top);

  return group;
}

/** A pastel balustrade each side, with a darker handrail on top. */
function buildBalustrades(ramp: RampDefinition, base: number): InstancedMesh {
  const run = ramp.to - ramp.from;
  const rise = ramp.yTo - ramp.yFrom;
  const length = Math.hypot(run, rise);
  const angle = -Math.atan2(rise, run);

  const rails = new InstancedMesh(
    new BoxGeometry(0.24, 1.05, length),
    interiorMaterial(PALETTE.buildingTrim, 0.72),
    2,
  );
  rails.castShadow = false;
  rails.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();

  [ramp.footprint.minX + 0.12, ramp.footprint.maxX - 0.12].forEach((x, index) => {
    position.set(x, ramp.yFrom + rise / 2 - base + 0.5, ramp.from + run / 2);
    matrix.compose(position, rotation, scale);
    rails.setMatrixAt(index, matrix);
  });
  rails.instanceMatrix.needsUpdate = true;
  return rails;
}
