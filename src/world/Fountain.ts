import {
  BufferAttribute,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { pinkStoneTexture } from '../core/textures';
import { toonMaterial } from '../art/style/materials';
import { terrainHeight } from './terrain';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';

/**
 * The wishing fountain in the middle of the plaza.
 *
 * Water is not a shader: the surface is a ring mesh whose vertices are nudged
 * every frame by a couple of sine waves. That keeps it compatible with the
 * scene's fog and shadows for free, and it costs about a thousand vertex writes
 * a frame — nothing.
 *
 * Coin-tossing arrives in a later step. When you build it, the rim radius and
 * water height are exposed as {@link rimRadius} and {@link waterLevel}.
 */
export class Fountain implements GameSystem {
  readonly name = 'fountain';
  readonly group = new Group();

  /** Centre of the fountain in world space. */
  readonly centre: Vector3;
  readonly rimRadius = 4.2;
  readonly waterLevel: number;

  /** 0 in daylight, 1 at night. Set by the DayNight system each frame. */
  nightFactor = 0;

  private readonly waterGeometry: RingGeometry;
  private readonly waterBase: Float32Array;
  private readonly waterMaterial: MeshStandardMaterial;
  private readonly jets: Mesh[] = [];
  private readonly glow: PointLight;

  constructor(collision: CollisionWorld, x = 0, z = 0) {
    this.group.name = 'fountain';
    const groundY = terrainHeight(x, z);
    this.centre = new Vector3(x, groundY, z);
    this.group.position.copy(this.centre);
    this.waterLevel = groundY + 0.82;

    // Stonework is a toy object, so it bands with everything else in the park.
    // The water below is deliberately NOT toon-shaded — see `waterMaterial`.
    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(6, 1) });
    const trimMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- basin -----------------------------------------------------------
    const basinWall = new Mesh(
      new CylinderGeometry(this.rimRadius, this.rimRadius + 0.22, 1.05, 40, 1, true),
      stoneMaterial,
    );
    basinWall.position.y = 0.52;
    basinWall.castShadow = true;
    basinWall.receiveShadow = true;
    this.group.add(basinWall);

    const rim = new Mesh(new TorusGeometry(this.rimRadius + 0.06, 0.22, 10, 44), trimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.05;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(rim);

    const floor = new Mesh(
      new CylinderGeometry(this.rimRadius, this.rimRadius, 0.16, 40),
      toonMaterial(PALETTE.stonePinkDark),
    );
    floor.position.y = 0.08;
    floor.receiveShadow = true;
    this.group.add(floor);

    // --- water -----------------------------------------------------------
    this.waterGeometry = new RingGeometry(0.42, this.rimRadius - 0.08, 44, 7);
    this.waterGeometry.rotateX(-Math.PI / 2);
    const positions = this.waterGeometry.getAttribute('position') as BufferAttribute;
    this.waterBase = Float32Array.from(positions.array);

    // Water stays MeshStandardMaterial on purpose: banding a transparent
    // rippling surface looks broken, and the faint specular is what sells it.
    this.waterMaterial = new MeshStandardMaterial({
      color: PALETTE.waterTop,
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.86,
      emissive: PALETTE.waterDeep,
      emissiveIntensity: 0.12,
    });
    const water = new Mesh(this.waterGeometry, this.waterMaterial);
    water.name = 'fountain-water';
    water.position.y = 0.82;
    water.receiveShadow = true;
    this.group.add(water);

    // --- pedestal and upper bowl -----------------------------------------
    const column = new Mesh(new CylinderGeometry(0.42, 0.62, 1.7, 16), stoneMaterial);
    column.position.y = 0.95;
    column.castShadow = true;
    column.receiveShadow = true;
    this.group.add(column);

    const bowl = new Mesh(new CylinderGeometry(1.35, 0.55, 0.42, 24), trimMaterial);
    bowl.position.y = 1.95;
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    this.group.add(bowl);

    const bowlWater = new Mesh(
      new CylinderGeometry(1.2, 1.2, 0.06, 24),
      this.waterMaterial,
    );
    bowlWater.position.y = 2.14;
    this.group.add(bowlWater);

    const finial = new Mesh(new SphereGeometry(0.42, 16, 12), trimMaterial);
    finial.position.y = 2.5;
    finial.castShadow = true;
    this.group.add(finial);

    const spout = new Mesh(new SphereGeometry(0.26, 14, 10), this.waterMaterial);
    spout.position.y = 2.86;
    this.group.add(spout);

    // --- falling water ----------------------------------------------------
    // Four thin tapered streams arcing from the upper bowl into the basin.
    const jetMaterial = new MeshStandardMaterial({
      color: PALETTE.waterFoam,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.1,
      emissive: PALETTE.waterTop,
      emissiveIntensity: 0.25,
    });
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const jet = new Mesh(new CylinderGeometry(0.05, 0.12, 1.3, 7, 1, true), jetMaterial);
      jet.position.set(Math.cos(angle) * 1.22, 1.45, Math.sin(angle) * 1.22);
      jet.rotation.z = Math.cos(angle) * 0.16;
      jet.rotation.x = -Math.sin(angle) * 0.16;
      this.group.add(jet);
      this.jets.push(jet);
    }

    // A hint of light in the water so the fountain still reads after dark.
    this.glow = new PointLight(PALETTE.waterTop, 0, 9, 2);
    this.glow.position.y = 1.2;
    this.group.add(this.glow);

    collision.addCircle(x, z, this.rimRadius + 0.25);
  }

  update({ dt, elapsed }: FrameContext): void {
    // Ripples: two crossing waves plus a radial ring travelling outwards.
    const positions = this.waterGeometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;
    for (let i = 0; i < positions.count; i += 1) {
      const index = i * 3;
      const x = this.waterBase[index] ?? 0;
      const z = this.waterBase[index + 2] ?? 0;
      const radius = Math.hypot(x, z);
      const ripple =
        Math.sin(radius * 3.1 - elapsed * 3.4) * 0.028 +
        Math.sin(x * 1.9 + elapsed * 2.1) * 0.016 +
        Math.sin(z * 2.3 - elapsed * 1.7) * 0.016;
      array[index + 1] = ripple;
    }
    positions.needsUpdate = true;

    // Jets wobble and shimmer rather than being rigid tubes.
    for (let i = 0; i < this.jets.length; i += 1) {
      const jet = this.jets[i];
      if (!jet) continue;
      const phase = elapsed * 5 + i * 1.1;
      jet.scale.y = 1 + Math.sin(phase) * 0.07;
      const material = jet.material as MeshStandardMaterial;
      material.opacity = 0.48 + Math.sin(phase * 1.3) * 0.08;
    }

    this.waterMaterial.emissiveIntensity = 0.12 + this.nightFactor * 0.55;
    // `dt` is unused for the ripple maths (it is driven by `elapsed`), but the
    // light eases so a sudden nightfall doesn't pop.
    this.glow.intensity += (this.nightFactor * 6 - this.glow.intensity) * Math.min(1, dt * 3);
  }

  dispose(): void {
    this.waterGeometry.dispose();
    this.waterMaterial.dispose();
  }
}
