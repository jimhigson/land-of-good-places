import { CapsuleGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from 'three';
import { PALETTE } from '../../core/palette';
import { castAndReceive, softMaterial } from './parts';

/**
 * The cuddly grown-up who waits at the top of the ginormous slide.
 *
 * Deliberately much simpler than the player's own model — a dozen meshes rather
 * than thirty — because it is only ever seen standing about or whooshing past.
 * Same chibi rules though: enormous head, tiny limbs, permanent kind face.
 */
export class GrownUp {
  readonly root = new Group();
  readonly body = new Group();
  readonly head = new Group();
  readonly height = 2.2;

  private blink = 0;
  private blinkTimer = 2;
  private readonly eyes: Mesh[] = [];

  constructor() {
    this.root.name = 'grown-up';
    this.root.add(this.body);

    const coat = softMaterial(PALETTE.grownUpCoat, 0.7);
    const skin = softMaterial(PALETTE.skin, 0.62);
    const dark = softMaterial(PALETTE.eyeDark, 0.3);

    const torso = castAndReceive(new Mesh(new CapsuleGeometry(0.4, 0.5, 6, 16), coat));
    torso.position.y = 0.85;
    torso.scale.set(1.05, 1, 0.94);
    this.body.add(torso);

    const scarf = castAndReceive(
      new Mesh(new TorusGeometry(0.31, 0.09, 8, 18), softMaterial(PALETTE.grownUpScarf, 0.62)),
    );
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.3;
    this.body.add(scarf);

    for (const side of [-1, 1] as const) {
      const arm = castAndReceive(new Mesh(new CapsuleGeometry(0.12, 0.34, 5, 10), coat));
      arm.position.set(side * 0.46, 0.94, 0);
      arm.rotation.z = side * 0.16;
      this.body.add(arm);

      const hand = castAndReceive(new Mesh(new SphereGeometry(0.14, 12, 9), skin));
      hand.position.set(side * 0.52, 0.62, 0);
      this.body.add(hand);

      const leg = castAndReceive(
        new Mesh(new CapsuleGeometry(0.15, 0.3, 5, 10), softMaterial(PALETTE.buildingTrimDeep, 0.7)),
      );
      leg.position.set(side * 0.2, 0.32, 0);
      this.body.add(leg);
    }

    this.head.position.y = 1.62;
    this.body.add(this.head);

    const skull = castAndReceive(new Mesh(new SphereGeometry(0.46, 20, 15), skin));
    skull.scale.set(1, 0.96, 0.98);
    this.head.add(skull);

    const hair = castAndReceive(
      new Mesh(
        new SphereGeometry(0.475, 20, 15, 0, Math.PI * 2, 0, Math.PI * 0.52),
        softMaterial(PALETTE.hair, 0.75),
      ),
    );
    hair.rotation.x = -0.1;
    this.head.add(hair);

    for (const side of [-1, 1] as const) {
      const eye = new Mesh(new SphereGeometry(0.075, 12, 9), dark);
      eye.position.set(side * 0.17, -0.02, 0.4);
      eye.scale.set(0.9, 1.1, 0.5);
      this.head.add(eye);
      this.eyes.push(eye);

      const cheek = new Mesh(new SphereGeometry(0.09, 10, 8), softMaterial(PALETTE.cheek, 0.6));
      cheek.position.set(side * 0.29, -0.14, 0.33);
      cheek.scale.set(1.1, 0.7, 0.3);
      this.head.add(cheek);
    }

    const smile = new Mesh(new TorusGeometry(0.07, 0.018, 6, 14, Math.PI), dark);
    smile.position.set(0, -0.17, 0.42);
    smile.rotation.z = Math.PI;
    smile.scale.set(1.2, 1, 1);
    this.head.add(smile);
  }

  /** Idle breathing, blinking, and a happy little hop when `excited`. */
  update(dt: number, elapsed: number, excited: boolean): void {
    const bounce = excited ? Math.abs(Math.sin(elapsed * 5)) * 0.14 : 0;
    this.body.position.y = Math.sin(elapsed * 1.7) * 0.02 + bounce;
    this.body.rotation.z = Math.sin(elapsed * 1.1) * 0.02;
    this.head.rotation.z = Math.sin(elapsed * 1.4) * 0.05;

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.4 + Math.random() * 3;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    const scale = 1 - this.blink * 0.9;
    for (const eye of this.eyes) eye.scale.y = 1.1 * scale;
  }
}
