import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
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
  private readonly strings: Line[] = [];
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
    const cableMaterial = new LineBasicMaterial({
      color: 0x6b5a4a,
      transparent: true,
      opacity: 0.75,
      fog: true,
    });

    const bulbsPerString = 9;
    const bulbPositions: Vector3[] = [];

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

      const geometry = new BufferGeometry().setFromPoints(points);
      const line = new Line(geometry, cableMaterial);
      this.group.add(line);
      this.strings.push(line);

      // Real lights only on every other string. Each one costs every lit
      // fragment in the scene, and five warm pools around the plaza already
      // reads as "the fairy lights are on".
      if (i % 2 === 0) {
        const middle = points[Math.floor(points.length / 2)] as Vector3;
        const light = new PointLight(rng.pick(bulbColours), 0, 21, 1.6);
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
      light.intensity = lit * 11 * flicker;
      light.visible = lit > 0.02;
    }

    const cableOpacity = 0.35 + lit * 0.4;
    for (const line of this.strings) {
      (line.material as LineBasicMaterial).opacity = cableOpacity;
    }
  }

  dispose(): void {
    this.bulbMaterial.dispose();
    this.bulbs.geometry.dispose();
    for (const line of this.strings) line.geometry.dispose();
  }
}
