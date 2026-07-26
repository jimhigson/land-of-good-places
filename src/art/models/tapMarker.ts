import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
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
 * the asset contract, so a caller only ever sets `root.position`.
 */

/** How far above the surface the ring floats, to keep it out of z-fighting. */
const HOVER = 0.06;

const RING_RADIUS = 0.62;

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
   */
  show(x: number, y: number, z: number, interactive: boolean): void {
    this.root.position.set(x, y, z);
    this.root.visible = true;
    this.ringMaterial.color.setHex(interactive ? PALETTE.markerLemon : PALETTE.markerPink);
    this.dotMaterial.color.setHex(interactive ? PALETTE.markerPink : PALETTE.markerLemon);
  }

  /** Moves the ring without restarting its pop-in — for a moving target. */
  moveTo(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  hide(): void {
    this.root.visible = false;
    this.strength = 0;
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

    this.spin += dt * 1.1;
    const breathe = 1 + Math.sin(elapsed * 4.2) * 0.07;
    const pop = 0.55 + this.strength * 0.45;
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
