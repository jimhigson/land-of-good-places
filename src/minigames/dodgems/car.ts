import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { clamp01, damp, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { createKid } from '../../art/models/kid';
import { createRipika } from '../../art/models/ripika';
import type { Expression } from '../../art/style/faces';
import type { CreatureHandle } from '../../art/style/asset';

/**
 * One dodgem: a fat rubber bumper ring, a rounded tub to sit in, a wobbly pole
 * with a star on top, and a cute driver.
 *
 * The driver is the park's own `createKid` / `createRipika` — not a copy —
 * shrunk on a *wrapper* group, because the asset contract reserves `root.scale`
 * for gameplay squash-and-stretch and this car squashes on every bump
 * (ART_DIRECTION.md §7).
 *
 * The pole exists for one reason: it is the part that moves. A car body sliding
 * across a floor is hard to read at this camera distance, but a two-metre pole
 * whipping about as the car turns and shuddering when it is bonked tells you
 * exactly how fast you are going and exactly how hard you just hit something.
 */

/** How tall the drivers end up. The park's kid is 2.12 m. */
const KID_DRIVER_SCALE = 0.62;
/** RiPika is shorter to start with, so it needs less taking down. */
const RIPIKA_DRIVER_SCALE = 0.78;

export type DriverKind =
  | { readonly kind: 'kid'; readonly hair: number; readonly outfit: number; readonly hairStyle: 'bunches' | 'bob' | 'short' }
  | { readonly kind: 'ripika' };

export interface CarOptions {
  readonly body: number;
  readonly driver: DriverKind;
}

export interface CarModel {
  readonly root: Group;
  readonly driver: CreatureHandle;
  /** Total height including the pole and its star — used to hang name pills. */
  readonly height: number;
  /**
   * Per-frame animation.
   *
   * `speed` is m/s, `turn` is how hard the nose is swinging round to face the
   * way the car is travelling (-1..1, signed; 1 = slewing flat out), `squash`
   * is 0..1 of "just got walloped".
   */
  animate(dt: number, elapsed: number, speed: number, turn: number, squash: number): void;
  setExpression(expression: Expression): void;
  dispose(): void;
}

export function createCar(options: CarOptions): CarModel {
  const root = new Group();
  root.name = 'dodgems:car';

  const bodyColour = options.body;
  const bodyMaterial = toonMaterial(bodyColour);
  const deepMaterial = toonMaterial(new Color(bodyColour).multiplyScalar(0.82).getHex());
  const bumperMaterial = toonMaterial(PALETTE.buildingWall);
  const trimMaterial = toonMaterial(PALETTE.buildingTrim);
  const metalMaterial = toonMaterial(PALETTE.woodLight);
  const starMaterial = toonMaterial(PALETTE.markerLemon, {
    emissive: PALETTE.markerLemon,
    emissiveIntensity: 0.5,
  });

  // `chassis` is what leans, squashes and shudders; `root` only ever holds the
  // car's position and heading, so the physics never has to undo an animation.
  const chassis = new Group();
  root.add(chassis);

  // --- bumper ---------------------------------------------------------------
  // A fat torus squashed flat. It is the widest thing on the car, which is what
  // makes a bump look like rubber meeting rubber rather than paint meeting paint.
  const bumper = solid(new Mesh(new TorusGeometry(0.96, 0.26, 10, 28), bumperMaterial));
  bumper.rotation.x = Math.PI / 2;
  bumper.scale.set(1, 1.06, 1);
  bumper.position.y = 0.3;
  chassis.add(bumper);
  addOutline(bumper, 0.022);

  // --- tub ------------------------------------------------------------------
  // Tall enough to read from above: the first pass had a tub so shallow that a
  // car was a cream ring with a head in the middle of it.
  const tub = solid(new Mesh(new RoundedBoxGeometry(1.44, 0.92, 1.7, 5, 0.32), bodyMaterial));
  tub.position.y = 0.66;
  chassis.add(tub);
  addOutline(tub, 0.024);

  // A pale stripe down the flank so a car reads as *painted metal* and so the
  // five cars are still telling themselves apart when they are all in a heap.
  for (const side of [-1, 1] as const) {
    const stripe = decal(new Mesh(new RoundedBoxGeometry(0.1, 0.2, 1.3, 3, 0.08), trimMaterial));
    stripe.position.set(side * 0.72, 0.68, 0.02);
    chassis.add(stripe);
  }

  // The back of the seat, so the driver has something to be thrown against.
  const seat = solid(new Mesh(new RoundedBoxGeometry(1.1, 0.72, 0.28, 4, 0.12), deepMaterial));
  seat.position.set(0, 1.16, -0.6);
  chassis.add(seat);

  // Nose and tail bulges: the tub alone is a bar of soap.
  const nose = solid(new Mesh(new SphereGeometry(0.42, 16, 12), deepMaterial));
  nose.scale.set(1.5, 0.7, 0.9);
  nose.position.set(0, 0.7, 0.82);
  chassis.add(nose);

  // --- wheels ---------------------------------------------------------------
  const wheelGeometry = new CylinderGeometry(0.2, 0.2, 0.18, 10);
  const wheelMaterial = toonMaterial(PALETTE.ink);
  const wheels: Mesh[] = [];
  for (const x of [-0.6, 0.6]) {
    for (const z of [-0.52, 0.52]) {
      const wheel = solid(new Mesh(wheelGeometry, wheelMaterial));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.2, z);
      chassis.add(wheel);
      wheels.push(wheel);
    }
  }

  // --- steering wheel -------------------------------------------------------
  const column = solid(new Mesh(new CylinderGeometry(0.06, 0.06, 0.44, 8), metalMaterial));
  column.position.set(0, 1.14, 0.5);
  column.rotation.x = 0.5;
  chassis.add(column);

  const steeringWheel = solid(new Mesh(new TorusGeometry(0.24, 0.055, 8, 18), metalMaterial));
  steeringWheel.position.set(0, 1.33, 0.6);
  steeringWheel.rotation.x = 1.05;
  chassis.add(steeringWheel);

  // --- pole and star --------------------------------------------------------
  const pole = new Group();
  pole.position.set(0, 1.2, -0.7);
  chassis.add(pole);

  const poleMesh = solid(new Mesh(new CylinderGeometry(0.045, 0.06, 2.0, 8), metalMaterial));
  poleMesh.position.y = 1.0;
  pole.add(poleMesh);

  const star = decal(new Mesh(new ConeGeometry(0.26, 0.5, 5), starMaterial));
  star.position.y = 2.16;
  pole.add(star);

  const spark = decal(
    new Mesh(
      new SphereGeometry(0.14, 10, 8),
      toonMaterial(PALETTE.fairyWarm, { emissive: PALETTE.fairyWarm, emissiveIntensity: 1 }),
    ),
  );
  spark.position.y = 1.95;
  pole.add(spark);

  // --- driver ---------------------------------------------------------------
  const driverWrapper = new Group();
  const driver: CreatureHandle =
    options.driver.kind === 'ripika'
      ? createRipika()
      : createKid({
          hair: options.driver.hair,
          outfit: options.driver.outfit,
          hairStyle: options.driver.hairStyle,
          backpack: false,
        });
  driverWrapper.scale.setScalar(
    options.driver.kind === 'ripika' ? RIPIKA_DRIVER_SCALE : KID_DRIVER_SCALE,
  );
  // Sunk into the tub so only the top half shows — the whole joke of a dodgem
  // is a big head sticking out of a small car.
  driverWrapper.position.set(0, options.driver.kind === 'ripika' ? 0.96 : 0.66, -0.12);
  driverWrapper.add(driver.root);
  chassis.add(driverWrapper);

  driver.setExpression('happy');
  // Hands on the wheel, arms forward, for the whole ride.
  if (driver.limbs) {
    driver.limbs.leftArm.rotation.x = -1.25;
    driver.limbs.rightArm.rotation.x = -1.25;
    driver.limbs.leftArm.rotation.z = 0.24;
    driver.limbs.rightArm.rotation.z = -0.24;
  }

  let lean = 0;
  let squashNow = 0;
  let expression: Expression = 'happy';

  return {
    root,
    driver,
    height: 3.2,

    animate(dt: number, elapsed: number, speed: number, turn: number, squash: number): void {
      // Lean into the corner. Damped rather than driven straight from `turn`,
      // so a car flicked sideways by a bump rocks instead of snapping.
      //
      // 0.34 is unchanged, but `turn` no longer means what it did: it was
      // radians of nose-vs-velocity drift, a couple of tenths in ordinary
      // driving, and is now a 0..1 fraction of the maximum slew rate that pins
      // at 1 through a decisive change of direction. Same multiplier, so the
      // lean is roughly three times deeper than it used to be in the gentle
      // cases. Deliberate — see the note in `Dodgems.animate` — and this is
      // the number to lower if the family says the cars heel over too far.
      lean = damp(lean, clamp01(Math.abs(speed) / 6) * turn * 0.34, 0.1, dt);
      chassis.rotation.z = -lean;
      chassis.rotation.x = clamp01(speed / 7) * 0.06;

      squashNow = damp(squashNow, clamp01(squash), 0.07, dt);
      // Squash and stretch on the *chassis*, never on `root`.
      chassis.scale.set(1 + squashNow * 0.2, 1 - squashNow * 0.22, 1 + squashNow * 0.12);

      const spin = speed * dt * 5;
      for (const wheel of wheels) wheel.rotation.y -= spin;

      // The pole whips against the turn and shudders after a bump.
      pole.rotation.z = lean * 1.9 + Math.sin(elapsed * 26) * 0.16 * squashNow;
      pole.rotation.x = -clamp01(speed / 7) * 0.1 + Math.sin(elapsed * 31) * 0.14 * squashNow;
      star.rotation.y += dt * 2.4;
      spark.scale.setScalar(lerp(0.6, 1.5, 0.5 + 0.5 * Math.sin(elapsed * 9)));

      // The driver gets thrown about a bit. Cheap, and it is what sells the bump.
      driver.body.rotation.z = lean * 0.9;
      driver.body.rotation.x = squashNow * 0.4 - clamp01(speed / 7) * 0.08;
      driver.head.rotation.z = -lean * 1.2 + Math.sin(elapsed * 22) * 0.3 * squashNow;
      driverWrapper.position.y =
        (options.driver.kind === 'ripika' ? 0.96 : 0.66) + squashNow * 0.12;
    },

    setExpression(next: Expression): void {
      // Texture swap: only ever on a transition (ART_DIRECTION.md §3).
      if (next === expression) return;
      expression = next;
      driver.setExpression(next);
    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
      bodyMaterial.dispose();
      deepMaterial.dispose();
      bumperMaterial.dispose();
      trimMaterial.dispose();
      metalMaterial.dispose();
      starMaterial.dispose();
      wheelMaterial.dispose();
    },
  };
}
