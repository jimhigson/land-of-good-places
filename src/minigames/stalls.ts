import { Group } from 'three';
import { PALETTE } from '../core/palette';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from '../world/Collision';
import type { InteractZone } from '../world/interact';
import { terrainHeight } from '../world/terrain';
import { createRailRacer } from './railRacer/RailRacer';
import { createStallProp, STALL_STAND_DISTANCE, type StallProp } from './stallProp';
import type { StallDefinition } from './types';

/**
 * The fairground stalls in the garden — the doorways into the mini-games.
 *
 * **Adding a game is two steps**: implement `MiniGame` (see `types.ts`), then
 * add a row to {@link STALLS} below. The booth, its collision, its tap target
 * and the whole enter/play/exit journey come for free.
 *
 * Placement rules, learned the hard way by everything else in this park:
 *
 * - Stay clear of every anchor plot in `world/anchors.ts` — the scenery scatter
 *   and the wall pass both honour `boundingRadius`, and a stall that crosses one
 *   will be standing in a ride later. Mind the hand-authored wall runs in
 *   `Scenery.ts` too; they are not in any table a builder can query.
 * - **Face the counter roughly down +Z.** The isometric camera looks from the
 *   +X/+Z corner, so a booth facing the other way shows the player its back —
 *   which is exactly the mistake the anchor signs' `signYaw` exists to avoid.
 *   That means putting the stall on the far side of whatever the child walks
 *   from, so "towards them" and "towards the camera" are the same direction.
 * - The stand point in front of the counter must be reachable in a straight
 *   line: tap-to-move does not path-find, and it gives up after a couple of
 *   seconds of scraping along the side of a booth.
 */

export const STALLS: readonly StallDefinition[] = [
  {
    id: 'railRacer',
    title: 'Rail Racer!',
    subtitle: 'hold on, let go, whoosh!',
    glyph: '🎢',
    accent: PALETTE.markerPink,
    stripe: PALETTE.buildingWall,
    // On the lawn just off the north-east kerb of the fountain plaza: a few
    // seconds' walk from where the game starts you, clear of every anchor plot,
    // clear of the hand-authored wall runs, and — checked in the running game —
    // with no scattered tree or bush within four metres.
    position: [9.8, -4.8],
    // A shade east of +Z: the counter, the awning stripes and the sign all face
    // the default camera, and the stand point in front of it sits between the
    // booth and the plaza, so walking up is a straight line from the fountain.
    facing: 0.3,
    create: createRailRacer,
  },
];

/** A stall as built into the world: its definition plus where to stand. */
export interface StallInstance {
  readonly definition: StallDefinition;
  /** World position of the booth itself. */
  readonly x: number;
  readonly z: number;
  /** Where a child stands to be served. */
  readonly standX: number;
  readonly standZ: number;
}

export class MiniGameStalls implements GameSystem {
  readonly name = 'stalls';
  readonly group = new Group();
  readonly stalls: readonly StallInstance[];

  private readonly props: StallProp[] = [];

  constructor(collision: CollisionWorld) {
    this.group.name = 'stalls';

    const instances: StallInstance[] = [];
    for (const definition of STALLS) {
      const [x, z] = definition.position;
      const ground = terrainHeight(x, z);

      const prop = createStallProp(definition);
      prop.root.position.set(x, ground, z);
      prop.root.rotation.y = definition.facing;
      this.group.add(prop.root);
      this.props.push(prop);

      // The booth is solid; the paved apron in front of it is not, so a child
      // can run right up to the counter.
      addBoothCollision(collision, x, z, definition.facing);

      const forwardX = Math.sin(definition.facing);
      const forwardZ = Math.cos(definition.facing);
      instances.push({
        definition,
        x,
        z,
        standX: x + forwardX * STALL_STAND_DISTANCE,
        standZ: z + forwardZ * STALL_STAND_DISTANCE,
      });
    }
    this.stalls = instances;
  }

  /**
   * Tap targets, one per stall (see `world/interact.ts`).
   *
   * `pressInteract` is true, so tapping the booth walks the character to the
   * counter and then fires exactly the same action the E key raises — the
   * keyboard and touch paths meet before anything game-specific happens.
   */
  interactZones(): InteractZone[] {
    return this.stalls.map((stall) => ({
      id: `stall:${stall.definition.id}`,
      label: stall.definition.title,
      x: stall.x,
      y: terrainHeight(stall.x, stall.z),
      z: stall.z,
      pickRadius: 3.2,
      standX: stall.standX,
      standZ: stall.standZ,
      pressInteract: true,
    }));
  }

  update({ elapsed }: FrameContext): void {
    for (const prop of this.props) prop.update(elapsed);
  }

  dispose(): void {
    for (const prop of this.props) prop.dispose();
  }
}

/**
 * Four walls around the booth body, rotated with it.
 *
 * `CollisionWorld.addRectangle` is axis-aligned and these booths are not, so
 * the corners are rotated by hand. Collision is height-blind (see
 * `Collision.ts`), which is fine here: the whole thing is one storey.
 */
function addBoothCollision(collision: CollisionWorld, x: number, z: number, yaw: number): void {
  const halfWidth = 2.1;
  const front = 1.35;
  const back = -1.3;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const toWorld = (lx: number, lz: number): [number, number] => [
    x + lx * cos + lz * sin,
    z - lx * sin + lz * cos,
  ];

  const frontLeft = toWorld(-halfWidth, front);
  const frontRight = toWorld(halfWidth, front);
  const backLeft = toWorld(-halfWidth, back);
  const backRight = toWorld(halfWidth, back);

  collision.addWall(frontLeft[0], frontLeft[1], frontRight[0], frontRight[1], 0.3);
  collision.addWall(backLeft[0], backLeft[1], backRight[0], backRight[1], 0.3);
  collision.addWall(frontLeft[0], frontLeft[1], backLeft[0], backLeft[1], 0.3);
  collision.addWall(frontRight[0], frontRight[1], backRight[0], backRight[1], 0.3);
}
