import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { INDOOR_UP } from '../../world/terrain';
import { upFor } from '../../world/up';
import { PALETTE, TAU, clamp01 } from '../style/bridge';
import { decal } from '../style/materials';

/**
 * The "I'm going here!" marker — the ring that appears under a tapped spot.
 *
 * Unlit on purpose. It is a *marker*, like the plot signs and the fairy-light
 * bulbs: it has to read at midnight as clearly as at noon, so it uses
 * `MeshBasicMaterial` rather than the toon ramp (ART_DIRECTION §2, and the same
 * rule `AnchorPlots` follows). It also never casts or receives a shadow — a
 * shadow under a piece of UI would look like a hole in the grass.
 *
 * Everything is authored around the origin on the ground plane facing +Z, per
 * the asset contract, so a caller only ever sets the position — through
 * {@link TapMarker.show} or {@link TapMarker.moveTo}, never `root.position`
 * directly, because those are also where the marker is leaned onto the ground.
 *
 * **Why the lean is not optional.** The ring and the disc are authored flat and
 * `rotation.x = -PI/2`'d, which is only ever correct if something downstream
 * leans them (`LampPosts.instanceAt` is the model). Nothing did: the root went
 * straight into the scene, so on the sphere the ring lay in the world XZ plane
 * against ground that leans 10.5 degrees at 40 m and 45.5 degrees at the park's
 * rim. Half of a 0.62 m ring buried in the hillside, half floating, sliced by
 * the grass — on every tap beyond about 20 m, which makes this the most-seen
 * radial fault in the game.
 */

/** How far above the surface the ring floats, to keep it out of z-fighting. */
const HOVER = 0.06;

const RING_RADIUS = 0.62;

const _up = /* @__PURE__ */ new Vector3();

export class TapMarker {
  readonly root = new Group();
  /** Total height in metres — trivial here, but the asset contract asks for it. */
  readonly height = 0.2;

  private readonly ring: Mesh;
  private readonly disc: Mesh;
  private readonly dots: Mesh[] = [];
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly discMaterial: MeshBasicMaterial;
  private readonly dotMaterial: MeshBasicMaterial;

  private strength = 0;
  private spin = 0;
  private running = false;

  constructor() {
    this.root.name = 'tap-marker';
    this.root.visible = false;
    // Drawn after the world so it is never lost inside the grass it sits on.
    this.root.renderOrder = 4;

    this.ringMaterial = markerMaterial(PALETTE.markerPink);
    this.discMaterial = markerMaterial(PALETTE.blossomWhite);
    this.dotMaterial = markerMaterial(PALETTE.markerLemon);

    this.ring = decal(new Mesh(new TorusGeometry(RING_RADIUS, 0.085, 8, 30), this.ringMaterial));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = HOVER;

    this.disc = decal(new Mesh(new CircleGeometry(0.3, 22), this.discMaterial));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = HOVER;

    this.root.add(this.ring, this.disc);

    // Three little sweets orbiting the ring. Cheap, and they turn a flat target
    // reticle into something that belongs in a sweet-shop park.
    const dotGeometry = new SphereGeometry(0.075, 10, 8);
    for (let i = 0; i < 3; i += 1) {
      const dot = decal(new Mesh(dotGeometry, this.dotMaterial));
      dot.scale.set(1, 0.8, 1);
      this.dots.push(dot);
      this.root.add(dot);
    }
  }

  /**
   * Shows or hides the marker, and says whether the destination is a *thing*
   * (the lift, a slide, the grown-up) rather than a patch of ground — the ring
   * goes lemon-yellow for a thing, which is the same "come and press this"
   * colour the ride entrance signs use.
   *
   * `running` is the double-tap "run there" — the ring pops bigger and its
   * sweets spin and breathe faster, so a running errand reads differently
   * from a stroll before the character has even set off.
   */
  show(x: number, y: number, z: number, interactive: boolean, running = false): void {
    this.placeAt(x, y, z);
    this.root.visible = true;
    this.running = running;
    this.ringMaterial.color.setHex(interactive ? PALETTE.markerLemon : PALETTE.markerPink);
    this.dotMaterial.color.setHex(interactive ? PALETTE.markerPink : PALETTE.markerLemon);
  }

  /** Moves the ring without restarting its pop-in — for a moving target. */
  moveTo(x: number, y: number, z: number): void {
    this.placeAt(x, y, z);
  }

  /**
   * Stands the marker on the ground under `(x, y, z)` — position *and* lean,
   * because on a sphere those are one operation and splitting them is how the
   * ring came to lie at 45 degrees to the grass it marks.
   *
   * The orientation is **assigned**, never pre-multiplied. `moveTo` runs every
   * frame while the character chases a moving target, and a pre-multiply there
   * re-inherits the previous frame's tilt and compounds it until the marker
   * tumbles — the exact failure `world/up.ts`'s `faceOnGround` docblock records
   * measuring on the player. The marker has no yaw of its own (the ring and
   * disc are radially symmetric and the orbiting sweets are placed in local
   * space), so there is nothing for an assignment to lose, and indoors `upFor`
   * hands back plain `+Y` and this collapses to the identity.
   */
  private placeAt(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
    this.root.quaternion.setFromUnitVectors(INDOOR_UP, upFor(x, y, z, _up));
  }

  hide(): void {
    this.root.visible = false;
    this.strength = 0;
    this.running = false;
    this.applyStrength();
  }

  /**
   * `visible` drives a springy pop in and a quick fade out, so the ring never
   * simply blinks away when the character arrives.
   */
  update(dt: number, elapsed: number, visible: boolean): void {
    const target = visible ? 1 : 0;
    // Pops in fast, fades out a touch slower: appearing should feel instant,
    // disappearing should feel like the marker was used up.
    const rate = visible ? 9 : 6;
    this.strength += (target - this.strength) * clamp01(rate * dt);

    if (this.strength < 0.01) {
      if (this.root.visible) this.root.visible = false;
      return;
    }
    this.root.visible = true;

    // Running spins and breathes noticeably faster, and sits a size class
    // bigger overall — the same trick a bigger, quicker-pulsing "you are
    // here" reticle uses in any map UI, just built from the sweets already
    // orbiting the ring.
    this.spin += dt * (this.running ? 2.4 : 1.1);
    const breathe =
      1 + Math.sin(elapsed * (this.running ? 7 : 4.2)) * (this.running ? 0.12 : 0.07);
    const pop = (this.running ? 0.68 : 0.55) + this.strength * 0.45;
    this.root.scale.setScalar(pop * breathe);

    for (let i = 0; i < this.dots.length; i += 1) {
      const dot = this.dots[i];
      if (!dot) continue;
      const angle = this.spin + (TAU * i) / this.dots.length;
      dot.position.set(
        Math.cos(angle) * RING_RADIUS,
        HOVER + 0.1 + Math.sin(elapsed * 5 + i) * 0.05,
        Math.sin(angle) * RING_RADIUS,
      );
    }

    this.applyStrength();
  }

  dispose(): void {
    this.ring.geometry.dispose();
    this.disc.geometry.dispose();
    this.dots[0]?.geometry.dispose();
    this.ringMaterial.dispose();
    this.discMaterial.dispose();
    this.dotMaterial.dispose();
  }

  private applyStrength(): void {
    this.ringMaterial.opacity = this.strength * 0.95;
    this.discMaterial.opacity = this.strength * 0.55;
    this.dotMaterial.opacity = this.strength;
  }
}

function markerMaterial(colour: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    transparent: true,
    // Off, so the three overlapping pieces never carve each other up as they
    // fade, and so the ring reads on top of whatever it is lying on.
    depthWrite: false,
    toneMapped: false,
  });
}
