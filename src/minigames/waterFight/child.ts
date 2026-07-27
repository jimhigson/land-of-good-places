import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Color,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { angleDelta, clamp01, damp, lerp } from '../../core/mathUtils';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import { createKid, type KidHandle } from '../../art/models/kid';
import { applyWalk } from '../../art/style/asset';
import { NameLabel } from '../../ui/NameLabel';

/**
 * A child in the water fight, holding a **very big water gun**.
 *
 * The kid is the park's own `createKid` — not a copy and not a variant — so the
 * children in the garden are recognisably the same children who wander the park.
 * Everything this file adds is the two things the water fight needs that the
 * park's kid does not have: a gun far too large for them, and hair that gets
 * comically soaked.
 *
 * **The gun is deliberately absurd.** Eleri's brief says "very big water guns",
 * and a water gun scaled sensibly for a two-metre child reads as a toy pistol
 * from the game's camera. This one is 1.4 m of tank, pump and barrel, held in
 * both hands, and it is the single clearest thing on screen — which is what a
 * child needs in order to tell at a glance who is about to squirt whom.
 *
 * **Soaked hair is a costume, not a penalty.** It appears the moment you are
 * splashed, lasts a few seconds and does nothing at all except look funny: a
 * flattened wet cap, six drips hanging off it, and a giggle. In normal mode
 * being splashed has no cost of any kind, so the only feedback it is allowed to
 * give is a joke.
 */

/** How long the drippy hair hangs around after a soaking, in seconds. */
export const SOAK_SECONDS = 3.4;

/** How far above the feet the gun's muzzle sits, before aiming. */
const GUN_HEIGHT = 1.02;

export interface ChildOptions {
  readonly hair: number;
  readonly outfit: number;
  /** The gun's tank colour — this is how you tell the children apart. */
  readonly gun: number;
  readonly hairStyle?: 'bunches' | 'bob' | 'short';
  /** Only the player gets a floating pill, same as the rail racer's "YOU". */
  readonly label?: { readonly text: string; readonly accent: number };
}

export interface ChildModel {
  readonly root: Group;
  readonly kid: KidHandle;
  /** True while the drippy hair is on. */
  readonly soaked: boolean;
  /** Writes the muzzle's world position into `out` and returns it. */
  muzzleWorld(out: Vector3): Vector3;
  /** Writes the middle of the head's world position into `out`. */
  headWorld(out: Vector3): Vector3;
  /** Where the child should be looking. Turned towards, never snapped. */
  setFacing(yaw: number): void;
  /** 0 = gun down, 1 = tank full and about to let go. */
  setCharge(amount: number): void;
  /** Splashed! Drippy hair and a giggle for a few seconds. */
  soak(): void;
  /** Arms up at the end of the round. */
  setCheering(cheering: boolean): void;
  /** `speed01` is 0..1 of a running child, and drives the walk cycle. */
  update(dt: number, elapsed: number, speed01: number): void;
  dispose(): void;
}

export function createChild(options: ChildOptions): ChildModel {
  const root = new Group();
  root.name = 'waterfight:child';

  const kid = createKid({
    hair: options.hair,
    outfit: options.outfit,
    hairStyle: options.hairStyle ?? 'bunches',
    // No backpack: it would be under water within ten seconds, and it fights
    // with the gun's tank for the same bit of the silhouette.
    backpack: false,
  });
  root.add(kid.root);

  const gunMaterial = toonMaterial(options.gun);
  const gunDarkMaterial = toonMaterial(new Color(options.gun).multiplyScalar(0.82).getHex());
  const tankMaterial = toonMaterial(PALETTE.waterTop, { transparent: true, opacity: 0.85 });
  const waterMaterial = toonMaterial(PALETTE.waterDeep);
  const trimMaterial = toonMaterial(PALETTE.blossomWhite);
  const hairWetMaterial = toonMaterial(new Color(options.hair).multiplyScalar(0.72).getHex());
  const dripMaterial = toonMaterial(PALETTE.waterTop, { transparent: true, opacity: 0.9 });

  // --- the very big water gun --------------------------------------------------
  // Parented to the kid's *body* rather than to a hand, so the whole thing stays
  // put while the arms swing through the walk cycle. The arms are then posed on
  // to it, which is much steadier than trying to carry a metre and a half of
  // plastic on a swinging limb.
  const gun = new Group();
  gun.position.set(0.16, GUN_HEIGHT, 0.16);
  kid.body.add(gun);

  const housing = solid(
    new Mesh(new RoundedBoxGeometry(0.3, 0.34, 1.02, 4, 0.11), gunMaterial),
  );
  housing.position.set(0, 0, 0.28);
  gun.add(housing);
  addOutline(housing, 0.018);

  const barrel = solid(new Mesh(new CylinderGeometry(0.1, 0.11, 0.52, 12), gunDarkMaterial));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.95);
  gun.add(barrel);

  const nozzle = solid(new Mesh(new ConeGeometry(0.14, 0.22, 12), trimMaterial));
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.03, 1.28);
  gun.add(nozzle);
  addOutline(nozzle, 0.014);

  // The tank: a fat see-through drum lying along the top, with a coloured slug
  // of water inside it that rises as the shot charges. It is the charge meter,
  // and it is on the object doing the charging rather than in the HUD, because
  // a six-year-old is looking at the gun.
  const tank = new Mesh(new CylinderGeometry(0.19, 0.19, 0.66, 14), tankMaterial);
  tank.rotation.x = Math.PI / 2;
  tank.position.set(0, 0.3, 0.28);
  gun.add(tank);

  const tankWater = decal(new Mesh(new CylinderGeometry(0.155, 0.155, 0.6, 12), waterMaterial));
  tankWater.rotation.x = Math.PI / 2;
  tankWater.position.set(0, 0.3, 0.28);
  gun.add(tankWater);

  for (const z of [-0.02, 0.58]) {
    const band = decal(new Mesh(new TorusGeometry(0.2, 0.03, 7, 18), gunDarkMaterial));
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.3, z);
    gun.add(band);
  }

  const grip = solid(new Mesh(new RoundedBoxGeometry(0.13, 0.3, 0.16, 3, 0.05), gunDarkMaterial));
  grip.position.set(0, -0.24, 0.42);
  gun.add(grip);

  const pump = solid(new Mesh(new CylinderGeometry(0.07, 0.07, 0.34, 8), trimMaterial));
  pump.rotation.x = Math.PI / 2;
  pump.position.set(0, -0.12, -0.12);
  gun.add(pump);

  const muzzle = new Group();
  muzzle.position.set(0, 0.03, 1.44);
  gun.add(muzzle);

  // --- drippy soaked hair --------------------------------------------------------
  // Hung off the head group, which means it rides every head turn and head bob
  // for free. Hidden until somebody scores a hit on this child.
  const soak = new Group();
  soak.visible = false;
  soak.scale.setScalar(0.01);
  kid.head.add(soak);

  const wetCap = decal(
    new Mesh(new SphereGeometry(0.71, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairWetMaterial),
  );
  wetCap.scale.set(1.02, 0.92, 1.02);
  wetCap.position.y = 0.03;
  soak.add(wetCap);

  // Six strands plastered down over the ears and forehead. Their lengths are
  // hand-picked and uneven — a symmetrical soaking looks like a swimming cap.
  const strandLengths = [0.34, 0.22, 0.4, 0.26, 0.3, 0.38];
  const strands: Mesh[] = [];
  strandLengths.forEach((length, index) => {
    const angle = (index / strandLengths.length) * Math.PI * 2 + 0.4;
    const strand = decal(new Mesh(new SphereGeometry(0.085, 10, 8), hairWetMaterial));
    strand.scale.set(1, length / 0.085 / 2, 1);
    strand.position.set(Math.sin(angle) * 0.6, -0.16 - length * 0.4, Math.cos(angle) * 0.6);
    soak.add(strand);
    strands.push(strand);
  });

  // Three droplets hanging off the ends, which is the bit that actually reads
  // as *dripping* rather than as darker hair.
  const drips: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 1.1;
    const drip = decal(new Mesh(new SphereGeometry(0.075, 10, 8), dripMaterial));
    drip.scale.set(1, 1.5, 1);
    drip.position.set(Math.sin(angle) * 0.58, -0.62, Math.cos(angle) * 0.58);
    soak.add(drip);
    drips.push(drip);
  }

  // --- the name pill ---------------------------------------------------------------
  let nameLabel: NameLabel | null = null;
  if (options.label) {
    nameLabel = new NameLabel(options.label.text, options.label.accent);
    nameLabel.sprite.position.set(0, kid.height + 0.34, 0);
    root.add(nameLabel.sprite);
  }

  // --- state ------------------------------------------------------------------------
  let facing = 0;
  let facingTarget = 0;
  let charge = 0;
  let chargeShown = 0;
  let soakLeft = 0;
  let soakShown = 0;
  let walkPhase = 0;
  let cheering = false;
  /** Counts down the startled "oh!" before the giggle takes over. */
  let startled = 0;
  kid.setExpression('happy');

  return {
    root,
    kid,

    get soaked(): boolean {
      return soakLeft > 0;
    },

    muzzleWorld(out: Vector3): Vector3 {
      return muzzle.getWorldPosition(out);
    },

    headWorld(out: Vector3): Vector3 {
      return kid.head.getWorldPosition(out);
    },

    setFacing(yaw: number): void {
      facingTarget = yaw;
    },

    setCharge(amount: number): void {
      charge = clamp01(amount);
    },

    soak(): void {
      soakLeft = SOAK_SECONDS;
      // "Oh!" for a third of a second, then the giggle. Two frames of surprise
      // is what turns being splashed into a joke rather than a status effect —
      // a child who is already laughing as the water arrives has not reacted
      // to anything.
      if (startled <= 0) kid.setExpression('surprised');
      startled = 0.34;
    },

    setCheering(next: boolean): void {
      cheering = next;
    },

    update(dt: number, elapsed: number, speed01: number): void {
      // --- turning ---------------------------------------------------------
      // Damped through the shortest arc, so a child spinning to answer a splash
      // never takes the long way round.
      facing += angleDelta(facing, facingTarget) * (1 - Math.pow(2, -dt / 0.09));
      root.rotation.y = facing;

      // --- walking ---------------------------------------------------------
      walkPhase = (walkPhase + dt * (0.9 + speed01 * 1.5)) % 1;
      applyWalk(kid.limbs, kid.body, walkPhase, speed01, 0.7, 0.075);

      // --- holding the gun -------------------------------------------------
      chargeShown = damp(chargeShown, charge, 0.06, dt);
      // Both arms come up on to the gun. Written *after* `applyWalk`, which
      // sets the same rotations — the pose wins over the stride, so a child
      // running in to squirt still has the gun levelled.
      if (!cheering) {
        const raise = lerp(-0.9, -1.28, chargeShown);
        kid.limbs.leftArm.rotation.x = raise;
        kid.limbs.rightArm.rotation.x = raise;
        // Uneven on purpose: the left hand is out on the pump, the right is on
        // the grip, which is how a child actually holds something this big.
        kid.limbs.leftArm.rotation.z = 0.42;
        kid.limbs.rightArm.rotation.z = -0.16;
      }

      // The gun tips up as it charges and the tank fills — the two halves of
      // "something big is about to happen".
      gun.rotation.x = lerp(0.06, -0.2, chargeShown);
      gun.position.y = GUN_HEIGHT + chargeShown * 0.06;
      tankWater.scale.set(1, 1, lerp(0.22, 1, chargeShown));
      // The kid leans back into the charge, and shakes a little at the top.
      const strain = chargeShown > 0.85 ? Math.sin(elapsed * 40) * 0.012 : 0;
      kid.body.rotation.x = -chargeShown * 0.12 + strain;

      if (cheering) {
        kid.limbs.leftArm.rotation.x = -2.5;
        kid.limbs.rightArm.rotation.x = -2.5;
        kid.limbs.leftArm.rotation.z = 0.5;
        kid.limbs.rightArm.rotation.z = -0.5;
        gun.rotation.x = -1.1;
      }

      // --- being soaked ----------------------------------------------------
      if (startled > 0) {
        startled -= dt;
        if (startled <= 0) kid.setExpression('happy');
      }
      if (soakLeft > 0) {
        soakLeft -= dt;
        if (soakLeft <= 0) soakLeft = 0;
      }
      const soakTarget = soakLeft > 0 ? 1 : 0;
      // In fast, out slow: the joke has to land on the frame you are hit.
      soakShown = damp(soakShown, soakTarget, soakTarget > soakShown ? 0.03 : 0.16, dt);
      if (soakShown < 0.02) {
        soak.visible = false;
      } else {
        soak.visible = true;
        soak.scale.setScalar(soakShown);
        // The drips slide down their strands and bob, which is most of what
        // makes the hair read as wet rather than as a hat.
        for (let i = 0; i < drips.length; i += 1) {
          const drip = drips[i];
          if (!drip) continue;
          drip.position.y = -0.62 - Math.abs(Math.sin(elapsed * 2.4 + i * 1.9)) * 0.14;
          drip.scale.y = 1.5 + Math.sin(elapsed * 2.4 + i * 1.9) * 0.35;
        }
        for (let i = 0; i < strands.length; i += 1) {
          const strand = strands[i];
          if (!strand) continue;
          strand.rotation.z = Math.sin(elapsed * 3 + i) * 0.07;
        }
        // The giggle: a fast little shake of the whole child. It is on top of
        // the walk bob rather than instead of it, so a child can giggle while
        // running away.
        const giggle = soakShown * (soakLeft > 0 ? 1 : 0.4);
        kid.body.rotation.z = Math.sin(elapsed * 17) * 0.055 * giggle;
        kid.head.rotation.z = Math.sin(elapsed * 17 + 0.6) * 0.09 * giggle;
        kid.body.position.y += Math.abs(Math.sin(elapsed * 8.5)) * 0.045 * giggle;
      }
    },

    dispose(): void {
      nameLabel?.dispose();
      disposeTree(root);
      gunMaterial.dispose();
      gunDarkMaterial.dispose();
      tankMaterial.dispose();
      waterMaterial.dispose();
      trimMaterial.dispose();
      hairWetMaterial.dispose();
      dripMaterial.dispose();
    },
  };
}
