import { ConeGeometry, Group, Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { visibleTop } from '../style/measure';
import { blob, stub, type AssetHandle } from '../style/asset';

/**
 * The jet pack. Eleri's own ask, in her words: *"add a shop that sells a jet
 * pack, and when you use it your pet gets one too."*
 *
 * ## Why this is built like a hat and not like a backpack
 *
 * `art/models/backpacks.ts` writes the test down itself: *a hat is a separate
 * asset mounted on an anchor, because hats are sold in a shop, stood on display
 * stands and swapped mid-game; a backpack is part of the body, chosen once in
 * the creator, never bought and never taken off.*
 *
 * The jet pack is sold in the toy shop, stands on the toy shop's counter, and
 * is taken on and off from the backpack drawer. Three out of three in the hat
 * column — so it is a factory returning an `AssetHandle`, mounted on an anchor,
 * exactly like `hats.ts`, and **not** a tagged-part rig sewn into the kid.
 *
 * ## The origin is the mount point, not the base
 *
 * Same deliberate reading of the asset contract `hats.ts` makes, for the same
 * reason: a hat's origin is the crown of the head so that
 * `hatAnchor.add(hat.root)` needs no offset maths. Here the origin is **the
 * point that sits against the middle of the wearer's back**, so
 *
 * ```ts
 * kid.jetpackAnchor.add(createJetpack().root);   // no offset maths
 * ```
 *
 * Geometry therefore runs both above and below y = 0 — the tanks rise past the
 * shoulders and the nozzles hang below the harness. `height` is measured from
 * the origin to the top, which is what a display plinth wants; `check:assets`
 * knows this family by its `gear.` id prefix and checks only the height half of
 * the contract, exactly as it does for `hat.`.
 *
 * ## Everything here is in metres, in the kid's `body` space
 *
 * Unlike a hat — which is authored in head units, because a hat is only ever
 * the right size relative to the skull under it — a jet pack is sized against a
 * *back*, and the torso is not scaled by anything. So these are the same metres
 * `backpacks.ts` uses, and the harness deliberately reuses that file's own
 * strap position: it is the same pair of straps over the same pair of
 * shoulders, and two files disagreeing about where a child's shoulders are is
 * how a strap ends up floating.
 */

/** Where the straps sit, copied from `backpacks.ts` — the same shoulders. */
const STRAP_Y = 0.08;
const STRAP_Z = 0.16;

/** Centre line of each tank, either side of the spine. */
const TANK_X = 0.115;
/** How far the tanks stand off the back plate. */
const TANK_Z = -0.15;

export interface JetpackHandle extends AssetHandle {
  /**
   * How hard it is firing, 0..1. Drives the painted flames and nothing else —
   * the flight physics live in `entities/Player.ts`, because assets never
   * contain behaviour (ART_DIRECTION.md §7).
   *
   * Cheap enough to call every frame: it writes two scales and two `visible`
   * flags, and touches no material and no texture.
   */
  setThrust(amount: number): void;
}

/**
 * One jet pack, ready to mount on a back or stand on a shop counter.
 *
 * `scale` shrinks the whole thing for a smaller wearer — the parade's pets are
 * between 0.7 m and 1.5 m tall, and a life-size jet pack on a mouse is a mouse
 * carrying a wardrobe. It is baked into the geometry through an inner group
 * rather than written onto `root.scale`, which the contract reserves for the
 * caller's pop-in (and which `check:assets` fails an asset for spending).
 */
export function createJetpack(scale = 1): JetpackHandle {
  const root = new Group();
  root.name = 'gear.jetpack';

  const fit = new Group();
  fit.name = 'gear.jetpack:fit';
  fit.scale.setScalar(scale);
  root.add(fit);

  const tankMaterial = toonMaterial(ART.jetpackTank);
  const tankDarkMaterial = toonMaterial(ART.jetpackTankDark);
  const trimMaterial = toonMaterial(ART.jetpackTrim);
  const nozzleMaterial = toonMaterial(ART.jetpackNozzle);

  // --- the harness -----------------------------------------------------------
  // A soft plate against the back, so the tanks are strapped to something
  // rather than stuck to a jumper.
  const plate = solid(new Mesh(new RoundedBoxGeometry(0.28, 0.3, 0.09, 4, 0.045), trimMaterial));
  plate.position.set(0, 0, -0.04);
  addOutline(plate, 0.016);
  fit.add(plate);

  for (const side of [-1, 1] as const) {
    const strap = solid(new Mesh(new RoundedBoxGeometry(0.07, 0.36, 0.08, 3, 0.03), trimMaterial));
    strap.position.set(side * 0.17, STRAP_Y, STRAP_Z);
    strap.rotation.x = -0.12;
    fit.add(strap);
  }

  // --- the tanks -------------------------------------------------------------
  // Capsules rather than cylinders: no sharp edges anywhere in this park, and a
  // rounded end is what makes a tank read as a stuffed toy rocket.
  for (const side of [-1, 1] as const) {
    const tank = stub(0.085, 0.17, tankMaterial);
    tank.position.set(side * TANK_X, 0.01, TANK_Z);
    addOutline(tank, 0.016);
    fit.add(tank);

    // The nose cone on top. Tilted a couple of degrees outwards — nothing in
    // this park is plumb (ART_DIRECTION §4).
    const nose = solid(new Mesh(new ConeGeometry(0.085, 0.11, 14), tankDarkMaterial));
    nose.position.set(side * TANK_X, 0.19, TANK_Z);
    nose.rotation.z = side * -0.06;
    fit.add(nose);

    // A stripe round the middle, standing proud of the tank so it reads as a
    // painted band rather than an intersection (ART_DIRECTION §5).
    const band = decal(blob(0.089, trimMaterial, [1, 0.34, 1], 14));
    band.position.set(side * TANK_X, 0.0, TANK_Z);
    fit.add(band);

    // The nozzle it fires out of, hanging below the harness.
    const nozzle = solid(new Mesh(new ConeGeometry(0.08, 0.11, 14), nozzleMaterial));
    // Cones point +Y; this one points down.
    nozzle.rotation.x = Math.PI;
    nozzle.position.set(side * TANK_X, -0.2, TANK_Z);
    fit.add(nozzle);
  }

  // --- the fin ---------------------------------------------------------------
  // One, off to the left, because every silhouette in this park gets one
  // asymmetric feature (ART_DIRECTION §4).
  const fin = solid(new Mesh(new RoundedBoxGeometry(0.05, 0.16, 0.13, 3, 0.024), toonMaterial(PALETTE.flowerYellow)));
  fin.position.set(-TANK_X - 0.08, 0.02, TANK_Z - 0.04);
  fin.rotation.z = -0.18;
  fit.add(fin);

  // --- the flames ------------------------------------------------------------
  // Painted flames, in two bands, drawn as ordinary toon cones — pigment, never
  // light (ART_DIRECTION, "Effects"). `decal` so they neither cast nor catch a
  // shadow. Hidden at rest, which is also what keeps them out of the measured
  // height below.
  const flames: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const outer = decal(new Mesh(new ConeGeometry(0.075, 0.26, 12), toonMaterial(ART.jetpackFlame)));
    outer.rotation.x = Math.PI;
    outer.position.set(side * TANK_X, -0.34, TANK_Z);
    outer.visible = false;
    fit.add(outer);
    flames.push(outer);

    const core = decal(new Mesh(new ConeGeometry(0.042, 0.15, 10), toonMaterial(ART.jetpackFlameCore)));
    core.rotation.x = Math.PI;
    core.position.set(side * TANK_X, -0.29, TANK_Z);
    core.visible = false;
    fit.add(core);
    flames.push(core);
  }

  let thrust = 0;

  const setThrust = (amount: number): void => {
    thrust = amount <= 0 ? 0 : amount >= 1 ? 1 : amount;
    const lit = thrust > 0.02;
    for (const flame of flames) {
      flame.visible = lit;
      if (lit) flame.scale.set(1, thrust, 1);
    }
  };

  return {
    root,
    // Measured off the geometry just built, never hand-written — a written-down
    // height is a claim and a measured one is a fact.
    height: visibleTop(root),
    setThrust,
    update: (_dt, elapsed) => {
      if (thrust <= 0.02) return;
      // A quick flicker, so the flame is alive rather than a cone stuck on.
      // Each flame gets its own beat, or the two look like one wide flame.
      flames.forEach((flame, index) => {
        const wobble = 1 + Math.sin(elapsed * 26 + index * 1.7) * 0.16;
        flame.scale.set(1, thrust * wobble, 1);
      });
    },
  };
}
