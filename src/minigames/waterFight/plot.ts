import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { addOutline, decal, softMaterial, solid, toonMaterial } from '../../art/style/materials';
import { ANCHORS_BY_ID } from '../../world/anchors';
import { terrainHeight } from '../../world/terrain';
import type { AnchorPlots } from '../../world/AnchorPlots';
import type { CollisionWorld } from '../../world/Collision';

/**
 * Dresses the `waterFight` anchor plot — the doorway into the garden.
 *
 * That plot has stood since day one with a "coming soon" sign on it. This takes
 * the sign down and puts a water-fight corner there instead: a mown lawn,
 * paddling pools, a hedge, a sprinkler, and a rack of **very big water guns**
 * waiting by the path. The thing you actually walk up to is a fun-fair stall
 * like any other — one row in `minigames/stalls.ts`, standing inside this plot —
 * so everything here is the shop window around that door.
 *
 * Deliberately *not* the whole game. GAME_DESIGN's rule for mini-games is that
 * each lives in its own little world rather than in the park's space, and a
 * fight needs a garden six children can run about in without meeting a shop.
 *
 * **Scope note.** This function and its single call in `World.ts` are the only
 * things the water fight adds to the park. Everything else is under
 * `minigames/waterFight/`. It is deliberately static: the plot needs no ticking,
 * so nothing has to be registered with the world's update order either.
 */

/** How far the props keep from the path spur and the stall's counter, in metres. */
const STALL_CLEARANCE = 4.2;

/** How thick the mown-lawn slab is, and how far its middle sits off the plot's
 * own origin — so its top surface is at {@link LAWN_TOP}. One definition, read
 * by the slab that is built and by the ground query every prop stands on. */
const LAWN_THICKNESS = 0.08;
const LAWN_MID = 0.05;

/** Top of the mown lawn, in plot-local metres. */
const LAWN_TOP = LAWN_MID + LAWN_THICKNESS / 2;

export function dressWaterFightPlot(plots: AnchorPlots, collision: CollisionWorld): void {
  const anchor = ANCHORS_BY_ID.waterFight;
  const [centreX, centreZ] = anchor.position;
  const ground = terrainHeight(centreX, centreZ);
  const rng = new Rng(0x77a7e5);

  const root = new Group();
  root.name = 'waterfight:plot';
  // The anchor group's origin is the plot centre with y on the ground, so
  // everything below is authored around (0, 0, 0) — see ARCHITECTURE.md,
  // "Dropping a build into an anchor plot".
  plots.getGroup('waterFight').add(root);
  plots.setPlaceholderVisible('waterFight', false);

  const materials = {
    grass: softMaterial(PALETTE.grassLight, 0.8),
    water: softMaterial(PALETTE.waterTop, 0.26),
    hedge: toonMaterial(PALETTE.leafMid),
    hedgeLight: toonMaterial(PALETTE.leafLight),
    pipe: toonMaterial(PALETTE.markerMint),
    gunBody: toonMaterial(PALETTE.markerPink),
    gunTank: toonMaterial(PALETTE.waterTop),
    gunTrim: toonMaterial(PALETTE.blossomWhite),
    post: toonMaterial(PALETTE.wood),
    board: toonMaterial(PALETTE.woodLight),
  };

  /** Local height of the ground under a plot-local point. */
  const localGround = (x: number, z: number): number =>
    terrainHeight(centreX + x, centreZ + z) - ground;

  /**
   * The height a **paddling pool** stands at: whichever of the ground and the
   * mown lawn is actually on top under it.
   *
   * The pools used to stand on the terrain alone, and the lawn is a *flat* slab
   * laid over terrain that rolls ±0.32 m across this plot (measured, on every
   * seed). On the low ground the lawn floats above the terrain, so a pool
   * placed on the terrain was placed *under the lawn* — and on the canonical
   * seed that put a pool's water disc exactly in the lawn's own top plane:
   * 16.48 m² of coplanar face, the fifth-worst seam in the game (#472),
   * strobing inside a pool a child stands half a metre from.
   *
   * `Math.max` rather than a stand-off: not a gap being maintained, but the
   * honest answer to "how high is the ground here?" where two surfaces are
   * drawn and only the higher one is seen. Nothing has to be kept in step,
   * because nothing is being tracked — the question is asked afresh under each
   * pool.
   *
   * Only the pools, deliberately. A pool is the one prop here with a wide flat
   * **horizontal** face — the water — and a horizontal face is the only kind
   * that can land in the lawn's own horizontal plane. Lifting the hedges and
   * the gun rack to the same line instead put *their* undersides in the plane
   * of the park terrain on seed 115, which is trading one seam for another.
   */
  const poolGround = (x: number, z: number): number => Math.max(localGround(x, z), LAWN_TOP);

  const [entranceX, entranceZ] = anchor.entrance;
  const doorX = entranceX - centreX;
  const doorZ = entranceZ - centreZ;
  /** Keeps a prop off the arrival path and out of the stall's way. */
  const clearOfDoor = (x: number, z: number, extent: number): boolean =>
    Math.hypot(x - doorX, z - doorZ) > STALL_CLEARANCE + extent;

  // --- a mown lawn where the plot markings used to be --------------------------
  const halfX = anchor.footprint.kind === 'rect' ? anchor.footprint.halfX : 10;
  const halfZ = anchor.footprint.kind === 'rect' ? anchor.footprint.halfZ : 10;
  const lawn = new Mesh(
    new RoundedBoxGeometry(halfX * 2, LAWN_THICKNESS, halfZ * 2, 3, 0.8),
    materials.grass,
  );
  lawn.position.y = LAWN_MID;
  lawn.receiveShadow = true;
  root.add(lawn);

  // --- paddling pools ------------------------------------------------------------
  // Placed by hand rather than scattered: they have to stay off the path spur
  // arriving at the anchor entrance and clear of the stall counter.
  const pools: readonly (readonly [number, number, number, number])[] = [
    [-6.5, -4.2, 2.3, PALETTE.markerLemon],
    [-7.5, 3.4, 1.9, PALETTE.markerSky],
    [1.2, 5.4, 2.1, PALETTE.markerLilac],
    [5.4, -5.6, 1.7, PALETTE.markerMint],
  ];

  for (const [x, z, radius, rimColour] of pools) {
    if (!clearOfDoor(x, z, radius)) continue;
    const y = poolGround(x, z);

    const rim = solid(new Mesh(new TorusGeometry(radius, 0.2, 9, 30), toonMaterial(rimColour)));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, y + 0.2, z);
    root.add(rim);
    addOutline(rim, 0.016);

    const surface = new Mesh(new CircleGeometry(radius, 28), materials.water);
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(x, y + 0.16, z);
    surface.receiveShadow = true;
    root.add(surface);

    // A small circle at the middle, not the whole pool: children should be able
    // to paddle in these, not be walled out of them.
    collision.addCircle(centreX + x, centreZ + z, radius * 0.3);
  }

  // --- hedges to duck behind ------------------------------------------------------
  for (const [x, z, extent] of [
    [-2.6, -6.2, 2.4],
    [7.2, 2.6, 1.8],
  ] as const) {
    if (!clearOfDoor(x, z, extent)) continue;
    const y = localGround(x, z);

    const body = solid(new Mesh(new RoundedBoxGeometry(extent * 2, 1.2, 1.1, 4, 0.26), materials.hedge));
    body.position.set(x, y + 0.6, z);
    root.add(body);
    addOutline(body, 0.02);
    collision.addRectangle(centreX + x, centreZ + z, extent, 0.55);

    const puffs = Math.round(extent * 2);
    for (let i = 0; i < puffs; i += 1) {
      const puff = decal(new Mesh(new SphereGeometry(0.55, 12, 9), materials.hedgeLight));
      puff.scale.set(1.1, 0.6, 1);
      puff.position.set(
        x + ((i + 0.5) / puffs - 0.5) * extent * 1.8,
        y + 1.22,
        z + rng.range(-0.08, 0.08),
      );
      root.add(puff);
    }
  }

  // --- a sprinkler ----------------------------------------------------------------
  const sprinklerX = -8.4;
  const sprinklerZ = 6.4;
  const sprinklerY = localGround(sprinklerX, sprinklerZ);
  const stem = solid(new Mesh(new CylinderGeometry(0.07, 0.09, 0.8, 8), materials.pipe));
  stem.position.set(sprinklerX, sprinklerY + 0.4, sprinklerZ);
  root.add(stem);
  const sprinklerHead = solid(new Mesh(new SphereGeometry(0.2, 12, 9), materials.pipe));
  sprinklerHead.scale.set(1, 0.7, 1);
  sprinklerHead.position.set(sprinklerX, sprinklerY + 0.85, sprinklerZ);
  root.add(sprinklerHead);

  // NO SIGN. There was a "Water Fight! / come and get soaked" board on two
  // posts standing exactly where the path spur arrives, and it was here for two
  // reasons: to name the ride, and — the note that used to live here — because
  // the placeholder's own sign posts were still registered in the collision
  // world, so a plot with no visible board would have grown an invisible
  // obstacle. Both reasons are now gone. The family had every sign in the park
  // taken out on 28 July 2026, and `AnchorPlots` no longer registers that
  // collider either (it went with the board it held up), so the spot the spur
  // arrives at is simply open grass. The ride names itself on its stall's sign
  // card, and the rack of enormous water guns two metres away says the rest.

  // --- the rack of very big water guns ----------------------------------------------
  // Right where the path spur arrives, so a child walking up meets three
  // enormous water guns before they meet anything else.
  const rackX = doorX - 2.6;
  const rackZ = doorZ - 1.4;
  const rackY = localGround(rackX, rackZ);

  for (const offset of [-0.85, 0.85]) {
    const leg = solid(new Mesh(new CylinderGeometry(0.09, 0.11, 1.5, 8), materials.post));
    leg.position.set(rackX + offset, rackY + 0.75, rackZ);
    root.add(leg);
  }
  const bar = solid(new Mesh(new CylinderGeometry(0.07, 0.07, 2, 8), materials.post));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(rackX, rackY + 1.42, rackZ);
  root.add(bar);
  collision.addCircle(centreX + rackX, centreZ + rackZ, 0.9);

  for (let i = 0; i < 3; i += 1) {
    const gun = new Group();
    gun.position.set(rackX + (i - 1) * 0.62, rackY + 0.86, rackZ - 0.12);
    // Propped barrel-up against the rail rather than lying along it: laid flat
    // they point straight away from the isometric camera and read as three
    // pipes, and the whole reason this prop is here is that a child should see
    // a water gun from across the park.
    gun.rotation.x = -1.05;
    gun.rotation.z = rng.range(-0.18, 0.18);
    root.add(gun);

    const housing = solid(new Mesh(new RoundedBoxGeometry(0.26, 0.3, 0.9, 4, 0.1), materials.gunBody));
    gun.add(housing);
    addOutline(housing, 0.016);

    const barrel = solid(new Mesh(new CylinderGeometry(0.09, 0.1, 0.45, 10), materials.gunTrim));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.62;
    gun.add(barrel);

    const tank = decal(new Mesh(new CylinderGeometry(0.16, 0.16, 0.55, 12), materials.gunTank));
    tank.rotation.x = Math.PI / 2;
    tank.position.y = 0.26;
    gun.add(tank);
  }
}
