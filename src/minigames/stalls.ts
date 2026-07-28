import { Group } from 'three';
import { PALETTE } from '../core/palette';
import { placedEntry } from '../world/parkLayout';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from '../world/Collision';
import type { InteractZone } from '../world/interact';
import { terrainHeight } from '../world/terrain';
import { highlightObject } from '../world/highlight';
import { ANCHORS_BY_ID } from '../world/anchors';
import { createDodgems } from './dodgems/Dodgems';
import { createSpaceFerrisWheel } from './ferrisWheel/SpaceFerrisWheel';
import { createRailRacer } from './railRacer/RailRacer';
import { createSpookyHouse } from './spookyHouse/SpookyHouse';
import { createWaterFight } from './waterFight/WaterFight';
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
    position: [placedEntry('stall.railRacer').x, placedEntry('stall.railRacer').z],
    // A shade east of +Z: the counter, the awning stripes and the sign all face
    // the default camera, and the stand point in front of it sits between the
    // booth and the plaza, so walking up is a straight line from the fountain.
    facing: 0.3,
    create: createRailRacer,
  },
  {
    id: 'spookyHouse',
    title: 'The Spooky House',
    subtitle: 'ooOOoo... just for giggles!',
    glyph: '👻',
    accent: PALETTE.markerLilac,
    stripe: PALETTE.markerMint,
    // A short walk north-east of the fountain plaza, clear of every anchor
    // plot, the Rail Racer stall and every hand-authored wall run in
    // `Scenery.ts` by several metres. The scenery scatter is seeded (see
    // `Scenery.ts`), not something a builder can predict by eye from the
    // coordinate tables alone — an earlier choice out on the open lawn at
    // [40, 0] *looked* clear on paper but turned out to have a bush planted
    // right on top of it once the seeded scatter actually ran, so this spot
    // was checked the same way, against the real instanced tree/bush
    // positions read out of the running game, and also checked that the
    // straight line tap-to-move walks from the spawn point clears the
    // fountain by a wide margin rather than grazing its collision circle.
    position: [placedEntry('stall.spookyHouse').x, placedEntry('stall.spookyHouse').z],
    // Every anchor sign and every other stall in this park uses a yaw near
    // +0.2–0.3 regardless of where it stands, because the isometric camera
    // never rotates (GAME_DESIGN.md #16) — "face the camera" is the same
    // absolute direction everywhere on the map, not a direction relative to
    // wherever a child is walking from.
    facing: 0.25,
    create: createSpookyHouse,
  },
  {
    id: 'waterFight',
    title: 'Water Fight!',
    subtitle: 'very big water guns',
    glyph: '💦',
    accent: PALETTE.markerMint,
    stripe: PALETTE.markerSky,
    // The one stall that stands *inside* an anchor plot rather than clear of
    // one. That is not the exception it looks like: the water fight owns the
    // `waterFight` plot (see `waterFight/plot.ts`, which takes its "coming
    // soon" sign down and dresses it), so this booth is the doorway into the
    // ride the plot was reserved for, not a stall squatting on somebody else's
    // building site.
    // Well inside the plot, and specifically clear of where the garden path
    // stops: `world/paths.ts` runs its water-fight spur on to [-25, 20], which
    // the first placement sat almost exactly on top of. Two metres of open
    // grass now separate the path's last step from the nearest corner of the
    // booth.
    position: [placedEntry('stall.waterFight').x, placedEntry('stall.waterFight').z],
    // Turned towards the path rather than square down +Z. The counter still
    // meets the isometric camera at an angle you can read the sign from, and —
    // the number that actually mattered — the stand point ends up *between* the
    // path and the booth, so walking up is a straight line that never scrapes
    // along the side of it.
    facing: 1.35,
    create: createWaterFight,
  },
  {
    id: 'spaceFerrisWheel',
    title: 'Space Ferris Wheel',
    subtitle: 'all the way up to space!',
    glyph: '🎡',
    accent: PALETTE.markerLilac,
    stripe: PALETTE.markerSky,
    // The one stall that is not a stall: this is the ferris wheel's ticket
    // kiosk, and it stands *exactly* where the plot's "coming soon" sign stood
    // — same spot, same yaw — because that sign has now come true. Putting it
    // on the anchor's own entrance also means the path spur already leads here,
    // and the placeholder's collision post ends up inside the booth's own walls
    // instead of being left behind as an invisible obstacle on the lawn.
    position: ANCHORS_BY_ID.ferrisWheel.entrance,
    facing: ANCHORS_BY_ID.ferrisWheel.signYaw,
    create: createSpaceFerrisWheel,
  },
  {
    id: 'dodgems',
    title: 'Dodgems!',
    subtitle: 'bonk the wobbly tree!',
    glyph: '🚗',
    accent: PALETTE.markerPink,
    stripe: PALETTE.markerLemon,
    // The ticket kiosk for the ride standing in the `dodgems` anchor plot: just
    // outside the bumper wall, a couple of metres from the doorway in it, and
    // right where the path spur from the garden arrives. Checked against the
    // ride's own geometry (`dodgems/plot.ts`): the booth and the point a child
    // stands at are both clear of the barrier, and the walk from the end of the
    // path to the counter is a straight line across open grass.
    position: [placedEntry('stall.dodgems').x, placedEntry('stall.dodgems').z],
    // Same rule the rail racer follows: the counter faces the default camera,
    // and the stand point in front of it ends up between the kiosk and the
    // ride's doorway rather than inside the rink.
    facing: 0.3,
    create: createDodgems,
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
  /**
   * The booth's own geometry. Here so the thing and its tap target cannot
   * drift apart — the HIGHLIGHT RULE outlines this exact group when the stall
   * is about to be used (see `world/highlight.ts`).
   */
  readonly booth: Group;
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
        booth: prop.root,
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
      // The whole booth lights up in rainbow when you can use it (GAME_DESIGN's
      // HIGHLIGHT RULE). `props` is filled in step with `stalls` in the
      // constructor above, one prop per instance, in order.
      // The whole booth lights up in rainbow when you can use it — see
      // GAME_DESIGN.md's HIGHLIGHT RULE and `world/highlight.ts`.
      highlight: highlightObject(stall.booth),
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
