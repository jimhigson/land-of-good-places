import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { clamp01, damp, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { createKid, type KidHandle } from '../../art/models/kid';
import type { Expression } from '../../art/style/faces';
import { NameLabel } from '../../ui/NameLabel';

/**
 * A rider: a little cart on the rail with a kid standing on it.
 *
 * The kid is the park's own `createKid` — not a copy, not a variant — wrapped in
 * a group and scaled down to about 1.2 m so four of them fit on screen together.
 * The scale goes on the *wrapper*, because the asset contract reserves
 * `root.scale` for gameplay squash-and-stretch (ART_DIRECTION.md §7) and the
 * duck pose uses exactly that.
 *
 * The pose is the game's second teaching channel. Holding the button stands the
 * rider up with their hair streaming back; letting go folds them into a tuck.
 * A child watching another rider can see what that rider is *doing*, which is
 * how "let go here" gets learned by copying rather than by reading.
 */

/** How tall the riders end up. The park's kid is 1.86 m. */
const RIDER_SCALE = 0.64;

export interface RacerOptions {
  readonly hair: number;
  readonly outfit: number;
  readonly cart: number;
  /** Bunches for the player, other styles for the rivals — tell them apart. */
  readonly hairStyle?: 'bunches' | 'bob' | 'short';
  /**
   * Only the player gets one: the floating name pill the park already puts
   * above a walking character (`ui/NameLabel`), reused here so a race full of
   * near-identical carts still has one unmistakable "that's me".
   */
  readonly label?: { readonly text: string; readonly accent: number };
}

export interface RacerModel {
  readonly root: Group;
  readonly kid: KidHandle;
  /** 0 = standing tall and pedalling, 1 = tucked down and coasting. */
  setDuck(amount: number, dt: number): void;
  /** Spins the wheels and leans into the speed. */
  setSpeed(speed: number, dt: number): void;
  /** Wobble after a bonk, 1 = just hit, 0 = recovered. */
  setWobble(amount: number, elapsed: number): void;
  setExpression(expression: Expression): void;
  /** Arms up, big cheer — the finish line. */
  setCheering(cheering: boolean): void;
  dispose(): void;
}

export function createRacer(options: RacerOptions): RacerModel {
  const root = new Group();
  root.name = 'railracer:rider';

  const cartMaterial = toonMaterial(options.cart);
  const cartDarkMaterial = toonMaterial(PALETTE.woodDark);
  const metalMaterial = toonMaterial(PALETTE.buildingTrim);

  // --- the cart -------------------------------------------------------------
  const cart = new Group();
  root.add(cart);

  const body = solid(new Mesh(new RoundedBoxGeometry(1.5, 0.5, 1.15, 4, 0.16), cartMaterial));
  body.position.y = 0.55;
  cart.add(body);
  addOutline(body, 0.018);

  const floor = solid(new Mesh(new BoxGeometry(1.3, 0.1, 0.95), cartDarkMaterial));
  floor.position.y = 0.78;
  cart.add(floor);

  const wheelGeometry = new CylinderGeometry(0.24, 0.24, 0.16, 12);
  const wheels: Mesh[] = [];
  for (const x of [-0.5, 0.5]) {
    for (const z of [-0.45, 0.45]) {
      const wheel = solid(new Mesh(wheelGeometry, metalMaterial));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.24, z);
      cart.add(wheel);
      wheels.push(wheel);
    }
  }

  // Handlebar to hang onto, and a little flag at the back so you can pick your
  // rider out of a pack from across the screen.
  const barPost = solid(new Mesh(new CylinderGeometry(0.06, 0.06, 0.75, 8), metalMaterial));
  barPost.position.set(0.62, 1.05, 0);
  cart.add(barPost);

  const bar = solid(new Mesh(new CylinderGeometry(0.055, 0.055, 0.86, 8), metalMaterial));
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.62, 1.4, 0);
  cart.add(bar);

  const flagPole = solid(new Mesh(new CylinderGeometry(0.04, 0.04, 1.1, 6), cartDarkMaterial));
  flagPole.position.set(-0.66, 1.2, 0);
  cart.add(flagPole);

  const flag = decal(new Mesh(new ConeGeometry(0.16, 0.42, 3), cartMaterial));
  flag.position.set(-0.66, 1.72, 0);
  flag.rotation.z = -0.35;
  cart.add(flag);

  const nose = solid(new Mesh(new SphereGeometry(0.22, 14, 10), cartMaterial));
  nose.scale.set(1.4, 0.9, 1);
  nose.position.set(0.8, 0.6, 0);
  cart.add(nose);

  // --- the rider ------------------------------------------------------------
  const kid = createKid({
    hair: options.hair,
    outfit: options.outfit,
    hairStyle: options.hairStyle ?? 'bunches',
    backpack: false,
  });

  const rider = new Group();
  rider.scale.setScalar(RIDER_SCALE);
  rider.rotation.y = Math.PI / 2; // the kid faces +Z; the rail runs along +X
  rider.position.set(-0.05, 0.83, 0);
  rider.add(kid.root);
  cart.add(rider);

  // --- the name pill ---------------------------------------------------------
  // Same sprite the park hangs over a walking character's head, just scaled
  // down with the rest of the rider so it keeps the same proportion to its
  // owner. Rivals get `options.label` left undefined, so only the player's
  // cart carries one — the whole point of it.
  let nameLabel: NameLabel | null = null;
  if (options.label) {
    nameLabel = new NameLabel(options.label.text, options.label.accent);
    nameLabel.sprite.scale.multiplyScalar(RIDER_SCALE);
    nameLabel.sprite.position.set(0, 0.83 + RIDER_SCALE * kid.height + 0.32, 0);
    cart.add(nameLabel.sprite);
  }

  let duck = 0;
  let lean = 0;
  let expression: Expression = 'happy';
  kid.setExpression('happy');

  return {
    root,
    kid,

    setDuck(amount: number, dt: number): void {
      duck = damp(duck, clamp01(amount), 0.06, dt);

      // Tuck: the whole rider drops and folds forward, arms straight out over
      // the handlebar, knees bent. Nothing here is a keyframe animation — four
      // damped numbers do the entire pose.
      rider.position.y = lerp(0.83, 0.62, duck);
      kid.body.rotation.x = lerp(-0.12 - lean * 0.2, 0.72, duck);
      kid.head.rotation.x = lerp(0.02, -0.42, duck);
      kid.limbs.leftArm.rotation.x = lerp(-1.15, -1.72, duck);
      kid.limbs.rightArm.rotation.x = lerp(-1.15, -1.72, duck);
      kid.limbs.leftArm.rotation.z = lerp(0.18, 0.3, duck);
      kid.limbs.rightArm.rotation.z = lerp(-0.18, -0.3, duck);
      kid.limbs.leftLeg.rotation.x = lerp(0.05, 0.5, duck);
      kid.limbs.rightLeg.rotation.x = lerp(-0.05, 0.42, duck);
    },

    setSpeed(speed: number, dt: number): void {
      lean = damp(lean, clamp01(speed / 16), 0.12, dt);
      // Wheels turn at the speed the cart is actually doing, so a slow crawl
      // never looks like it is skidding.
      const spin = (speed / 0.24) * dt;
      for (const wheel of wheels) wheel.rotation.y -= spin;
      cart.rotation.z = -lean * 0.05;
      flag.rotation.z = -0.35 - lean * 0.5;
    },

    setWobble(amount: number, elapsed: number): void {
      const wobble = clamp01(amount);
      cart.rotation.x = Math.sin(elapsed * 34) * 0.22 * wobble;
      cart.position.y = Math.abs(Math.sin(elapsed * 26)) * 0.09 * wobble;
      kid.head.rotation.z = Math.sin(elapsed * 30) * 0.35 * wobble;
    },

    setExpression(next: Expression): void {
      // A texture swap, so it must only ever fire on a transition.
      if (next === expression) return;
      expression = next;
      kid.setExpression(next);
    },

    setCheering(cheering: boolean): void {
      if (!cheering) return;
      kid.limbs.leftArm.rotation.x = -2.6;
      kid.limbs.rightArm.rotation.x = -2.6;
      kid.limbs.leftArm.rotation.z = 0.55;
      kid.limbs.rightArm.rotation.z = -0.55;
      kid.body.rotation.x = -0.1;
    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
      cartMaterial.dispose();
      cartDarkMaterial.dispose();
      metalMaterial.dispose();
      nameLabel?.dispose();
    },
  };
}
