import { Group } from 'three';
import { PALETTE } from '../core/palette';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from '../world/Collision';
import { pressZone, type InteractZone } from '../world/interact';
import { terrainHeight } from '../world/terrain';
import { highlightObject } from '../world/highlight';
import { createDodgems } from './dodgems/Dodgems';
import { createSpookyHouse } from './spookyHouse/SpookyHouse';
import { createWaterFight } from './waterFight/WaterFight';
import { createStallProp, type StallProp } from './stallProp';
import { STALL_PICK_RADIUS, STALL_PLACEMENTS, STALL_STANDS_BY_ID } from './stallPlacement';
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
    id: 'skyCruiser',
    title: 'Sky Cruiser',
    cta: 'Float up high!',
    glyph: '\u{1F6A0}',
    accent: PALETTE.markerSky,
    stripe: PALETTE.buildingWall,
    ...STALL_PLACEMENTS.skyCruiser,
  },
  {
    id: 'railRacer',
    // The id stays `railRacer` — it is a save key and the prefix
    // `world/interact.ts` reads its default verb off — but the booth now
    // advertises the ride it actually boards. The chip says "Race the carts!":
    // there is somebody to beat, which is the whole point of it.
    title: 'The Rail Race!',
    cta: 'Race the carts!',
    glyph: '🎢',
    accent: PALETTE.markerPink,
    stripe: PALETTE.buildingWall,
    // On the lawn just off the north-east kerb of the fountain plaza: a few
    // seconds' walk from where the game starts you, clear of every anchor plot,
    // clear of the hand-authored wall runs, and — checked in the running game —
    // with no scattered tree or bush within four metres.
    ...STALL_PLACEMENTS.railRacer,
    // A shade east of +Z: the counter, the awning stripes and the sign all face
    // the default camera, and the stand point in front of it sits between the
    // booth and the plaza, so walking up is a straight line from the fountain.
    //
    // No `create`: this booth boards a real ride in the real park rather than
    // opening a mini-game world. `Game.boardRide` routes it to
    // `world.railRace.requestBoard()` — see `MiniGameHost.checkStalls`, which
    // offers every stall to `boardRide` before it opens anything.
  },
  {
    id: 'spookyHouse',
    title: 'The Spooky House',
    cta: 'Go in… eek!',
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
    ...STALL_PLACEMENTS.spookyHouse,
    // Every anchor sign and every other stall in this park uses a yaw near
    // +0.2–0.3 regardless of where it stands, because the isometric camera
    // never rotates (GAME_DESIGN.md #16) — "face the camera" is the same
    // absolute direction everywhere on the map, not a direction relative to
    // wherever a child is walking from.

    create: createSpookyHouse,
  },
  {
    id: 'waterFight',
    title: 'Water Fight!',
    cta: 'Big water fight!',
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
    ...STALL_PLACEMENTS.waterFight,
    // Turned towards the path rather than square down +Z. The counter still
    // meets the isometric camera at an angle you can read the sign from, and —
    // the number that actually mattered — the stand point ends up *between* the
    // path and the booth, so walking up is a straight line that never scrapes
    // along the side of it.

    create: createWaterFight,
  },
  {
    id: 'spaceFerrisWheel',
    title: 'Space Ferris Wheel',
    cta: 'Up to space!',
    glyph: '🎡',
    accent: PALETTE.markerLilac,
    stripe: PALETTE.markerSky,
    // The one stall that is not a stall: this is the ferris wheel's ticket
    // kiosk, and it stands *exactly* where the plot's "coming soon" sign stood
    // — same spot, same yaw — because that sign has now come true. Putting it
    // on the anchor's own entrance also means the path spur already leads here,
    // and the placeholder's collision post ends up inside the booth's own walls
    // instead of being left behind as an invisible obstacle on the lawn.
    ...STALL_PLACEMENTS.spaceFerrisWheel,
    // No `create`: this booth boards a **world ride** now
    // (`world/ferrisWheel/FerrisWheelRide.ts`), so `MiniGameHost.boardRide`
    // takes it before a mini-game would ever be built — same as the Sky
    // Cruiser's and the Rail Race's booths.
    // The only stall behind which you sit in a seat and turn your head, so the
    // only one that needs iOS asked about the motion sensors while the opening
    // press is still a gesture. See `StallDefinition.firstPerson`.
    firstPerson: true,
  },
  {
    id: 'dodgems',
    title: 'Dodgems!',
    cta: 'Bump the cars!',
    glyph: '🚗',
    accent: PALETTE.markerPink,
    stripe: PALETTE.markerLemon,
    // The ticket kiosk for the ride standing in the `dodgems` anchor plot: just
    // outside the bumper wall, a couple of metres from the doorway in it, and
    // right where the path spur from the garden arrives. Checked against the
    // ride's own geometry (`dodgems/plot.ts`): the booth and the point a child
    // stands at are both clear of the barrier, and the walk from the end of the
    // path to the counter is a straight line across open grass.
    ...STALL_PLACEMENTS.dodgems,
    // Same rule the rail racer follows: the counter faces the default camera,
    // and the stand point in front of it ends up between the kiosk and the
    // ride's doorway rather than inside the rink.

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

  /**
   * "Open this booth" — wired by `Game` to `MiniGameHost.enter`, which either
   * boards the world ride behind the booth or drops the curtain on its
   * mini-game.
   *
   * A settable hook rather than a constructor argument, in the same idiom as
   * `MiniGameHost.boardRide` and `.riding`: the stalls are built with the world,
   * long before the mini-game framework that runs them exists.
   */
  onEnter: ((stallId: string) => void) | null = null;

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

      // Taken from `STALL_STANDS`, not recomputed here. This used to derive its
      // own from `STALL_STAND_DISTANCE`, which was harmless only for as long as
      // every booth used that one distance — the moment a placement sets its
      // own `standDistance`, a locally-recomputed stand point silently stops
      // agreeing with the one `world/paths.ts` runs the paving to. That is
      // exactly the split this whole change exists to close (issue #114), so it
      // must not be left open here.
      const stand = STALL_STANDS_BY_ID.get(definition.id);
      if (!stand) throw new Error(`MiniGameStalls: no stand point for '${definition.id}'`);
      instances.push({
        definition,
        x,
        z,
        booth: prop.root,
        standX: stand.x,
        standZ: stand.z,
      });
    }
    this.stalls = instances;
  }

  /**
   * Tap targets, one per stall (see `world/interact.ts`).
   *
   * One action each, and it names this booth by id. `MiniGameHost` used to find
   * the booth itself, by sweeping every stall for one within its own `REACH`;
   * that second opinion about who a press was meant for is what GitHub issue
   * #122 removed. The keyboard and touch paths still meet in one place —
   * `Selection.commit` — before anything game-specific happens.
   *
   * The chip's label is the stall's own {@link StallDefinition.cta}: since the
   * sign card was removed (10 August 2026) that call to action ("Race the
   * carts!") is the only text shown over the booth, written once in {@link
   * STALLS} above.
   */
  interactZones(): InteractZone[] {
    return this.stalls.map((stall) =>
      pressZone(
        {
          id: `stall:${stall.definition.id}`,
          label: stall.definition.title,
          x: stall.x,
          y: terrainHeight(stall.x, stall.z),
          z: stall.z,
          pickRadius: STALL_PICK_RADIUS,
          standX: stall.standX,
          standZ: stall.standZ,
          // The whole booth lights up in rainbow when it is selected — see
          // GAME_DESIGN.md's HIGHLIGHT RULE and `world/highlight.ts`. `props` is
          // filled in step with `stalls` in the constructor above, one prop per
          // instance, in order.
          highlight: highlightObject(stall.booth),
        },
        () => this.onEnter?.(stall.definition.id),
        stall.definition.glyph,
        stall.definition.cta,
      ),
    );
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
