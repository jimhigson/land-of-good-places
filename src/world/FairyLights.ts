import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { clamp01, Rng, TAU } from '../core/mathUtils';
import { terrainHeight } from './terrain';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';

/**
 * Strings of fairy lights slung between wooden poles around the plaza.
 *
 * The bulbs are emissive spheres — cheap, and they read beautifully against a
 * dusk sky. Only a handful of real {@link PointLight}s are used (WebGL gets
 * unhappy with dozens), placed at the middle of each string so the ground
 * actually catches a warm pool of light.
 *
 * The whole rig fades in and out with {@link nightFactor}, which the DayNight
 * system sets each frame.
 */

/**
 * The plaza ring's share of "make the lit area three times bigger in radius".
 *
 * Same reasoning as the lamp posts, and the same trap — tripling `distance`
 * alone would have changed nothing visible, because three.js's `1/d^decay`
 * term had already taken the light to nothing well inside the old cut-off.
 * Decay 1.6 → 1.0, intensity solved (11 → 5.69) to hold the brightness
 * directly under a string exactly where it was. Ground pool 13.8 m → 39.8 m,
 * and the ratio holds between 2.9× and 3.0× across every visibility threshold
 * tested.
 */
const LIGHT_INTENSITY = 5.69;
const LIGHT_DECAY = 1.0;
const LIGHT_DISTANCE = 63;

/**
 * How many of the ten strings carry a real light — down from five.
 *
 * This is what pays for `LampPosts` going 3 → 5, so the park's total
 * point-light count does not move. It is the right side of the trade: these
 * five sit on a ring only 13.5 m across and each now washes about 40 m, so
 * they were lighting the same plaza five times over, while the lamp posts are
 * strung out along a ring road well over a hundred metres round and genuinely
 * needed the reach.
 */
const REAL_LIGHTS = 3;

/**
 * Radius of the cable, in metres — a cord about 5 cm thick, matching the
 * tree-to-tree garlands exactly (`TreeLights.WIRE_RADIUS`, where the reasoning
 * is written out in full).
 *
 * Short version: these were `Line`s, and the family reported the string
 * between the lights as very faint. WebGL ignores `LineBasicMaterial.linewidth`
 * on essentially every platform, so a line is always one device pixel however
 * it is configured. The only way to give the cable presence is to make it
 * geometry, so it is a tube.
 */
const CABLE_RADIUS = 0.025;

/** Faces around the cable. See `TreeLights.WIRE_SIDES`. */
const CABLE_SIDES = 5;

export class FairyLights implements GameSystem {
  readonly name = 'fairyLights';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully lit. Set by World from DayNight. */
  nightFactor = 0;

  private readonly bulbs: InstancedMesh;
  private readonly bulbMaterial: MeshBasicMaterial;
  private readonly bulbColours: Color[] = [];
  private readonly bulbBase: Color[] = [];
  private readonly lights: PointLight[] = [];
  private readonly strings: Mesh[] = [];
  private readonly bulbMatrix = new Matrix4();
  private readonly scratchColour = new Color();

  constructor(collision: CollisionWorld) {
    this.group.name = 'fairy-lights';
    const rng = new Rng(0x11a17);

    // --- poles, arranged in a ring around the fountain plaza --------------
    const poleCount = 10;
    const ringRadius = 13.5;
    const poleHeight = 4.4;
    const poles: Vector3[] = [];

    const poleMaterial = new MeshStandardMaterial({
      color: PALETTE.woodDark,
      roughness: 0.9,
      metalness: 0,
    });
    const poleGeometry = new CylinderGeometry(0.11, 0.17, poleHeight, 8);
    const knobGeometry = new SphereGeometry(0.22, 10, 8);
    const knobMaterial = new MeshStandardMaterial({
      color: PALETTE.stonePink,
      roughness: 0.6,
      metalness: 0,
    });

    for (let i = 0; i < poleCount; i += 1) {
      const angle = (i / poleCount) * TAU;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      const ground = terrainHeight(x, z);

      const pole = new Mesh(poleGeometry, poleMaterial);
      pole.position.set(x, ground + poleHeight / 2, z);
      pole.castShadow = true;
      pole.receiveShadow = true;
      this.group.add(pole);

      const knob = new Mesh(knobGeometry, knobMaterial);
      knob.position.set(x, ground + poleHeight + 0.12, z);
      knob.castShadow = true;
      this.group.add(knob);

      poles.push(new Vector3(x, ground + poleHeight - 0.25, z));
      collision.addCircle(x, z, 0.28);
    }

    // --- the strings themselves -------------------------------------------
    const bulbColours = [
      PALETTE.fairyWarm,
      PALETTE.fairyPink,
      PALETTE.fairyMint,
      PALETTE.fairyBlue,
    ];
    const cableMaterial = new MeshBasicMaterial({
      color: 0x6b5a4a,
      transparent: true,
      opacity: 0.75,
      fog: true,
    });

    const bulbsPerString = 9;
    const bulbPositions: Vector3[] = [];

    // Which strings get one, spread as evenly as three divides into ten.
    const LIT_STRINGS = new Set<number>();
    for (let k = 0; k < REAL_LIGHTS; k += 1) {
      LIT_STRINGS.add(Math.round((k * poleCount) / REAL_LIGHTS) % poleCount);
    }

    for (let i = 0; i < poleCount; i += 1) {
      const from = poles[i] as Vector3;
      const to = poles[(i + 1) % poleCount] as Vector3;
      const points: Vector3[] = [];

      for (let s = 0; s <= bulbsPerString + 1; s += 1) {
        const t = s / (bulbsPerString + 1);
        // Catenary-ish sag: a parabola is close enough and much cheaper.
        const sag = Math.sin(t * Math.PI) * 1.15;
        const point = new Vector3().lerpVectors(from, to, t);
        point.y -= sag;
        points.push(point);
        if (s > 0 && s <= bulbsPerString) {
          bulbPositions.push(point.clone().add(new Vector3(0, -0.18, 0)));
        }
      }

      // The sag points already lie on the parabola, so the Catmull-Rom through
      // them stays on it — the curve exists only because `TubeGeometry` wants
      // one. One tube segment per sag point is plenty for a 9 m span.
      const geometry = new TubeGeometry(
        new CatmullRomCurve3(points),
        points.length,
        CABLE_RADIUS,
        CABLE_SIDES,
        false,
      );
      const cable = new Mesh(geometry, cableMaterial);
      cable.castShadow = false;
      cable.receiveShadow = false;
      this.group.add(cable);
      this.strings.push(cable);

      // Real lights on three of the ten strings — see REAL_LIGHTS. Each one
      // costs every lit fragment in the scene, so the ring carries as few as
      // will do the job, and with the pool trebled three of them cover the
      // plaza several times over.
      if (LIT_STRINGS.has(i)) {
        const middle = points[Math.floor(points.length / 2)] as Vector3;
        const light = new PointLight(rng.pick(bulbColours), 0, LIGHT_DISTANCE, LIGHT_DECAY);
        light.position.copy(middle);
        this.group.add(light);
        this.lights.push(light);
      }
    }

    // --- bulbs as one instanced mesh ---------------------------------------
    // Unlit and opaque. Transparent bulbs turned into ghostly grey discs in
    // daylight; solid beads that simply brighten after dark read far better,
    // and per-instance colour does all the work.
    this.bulbMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      fog: true,
    });
    const bulbGeometry = new SphereGeometry(0.145, 8, 6);
    this.bulbs = new InstancedMesh(bulbGeometry, this.bulbMaterial, bulbPositions.length);
    this.bulbs.name = 'fairy-bulbs';

    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1.25, 1);
    bulbPositions.forEach((position, index) => {
      this.bulbMatrix.compose(position, quaternion, scale);
      this.bulbs.setMatrixAt(index, this.bulbMatrix);
      const base = new Color(bulbColours[index % bulbColours.length] as number);
      this.bulbBase.push(base);
      const current = base.clone();
      this.bulbColours.push(current);
      this.bulbs.setColorAt(index, current);
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.group.add(this.bulbs);
  }

  update({ elapsed }: FrameContext): void {
    const lit = clamp01(this.nightFactor);

    if (this.bulbs.instanceColor) {
      // Each bulb breathes on its own phase so the strings shimmer gently
      // instead of pulsing in unison.
      for (let i = 0; i < this.bulbColours.length; i += 1) {
        const base = this.bulbBase[i];
        const target = this.bulbColours[i];
        if (!base || !target) continue;
        // Dull beads by day, bright and twinkling once the sun goes down.
        const flicker = 0.78 + 0.22 * Math.sin(elapsed * 2.1 + i * 0.9);
        this.scratchColour.copy(base).multiplyScalar(flicker * (0.42 + lit * 0.58));
        target.copy(this.scratchColour);
        this.bulbs.setColorAt(i, target);
      }
      this.bulbs.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      if (!light) continue;
      const flicker = 0.85 + 0.15 * Math.sin(elapsed * 1.7 + i * 2.3);
      light.intensity = lit * LIGHT_INTENSITY * flicker;
      light.visible = lit > 0.02;
    }

    const cableOpacity = 0.35 + lit * 0.4;
    for (const cable of this.strings) {
      (cable.material as MeshBasicMaterial).opacity = cableOpacity;
    }
  }

  dispose(): void {
    this.bulbMaterial.dispose();
    this.bulbs.geometry.dispose();
    for (const line of this.strings) line.geometry.dispose();
  }
}
