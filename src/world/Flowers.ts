import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { Rng, TAU, clamp01, lerp, smoothstep } from '../core/mathUtils';
import { toonMaterial } from '../art/style/materials';
import { createFlowerPickEffect, type FlowerPickEffect } from '../art/effects/flowerSparkle';
import { terrainHeight } from './terrain';
import { isOnPath } from './paths';
import { ANCHORS } from './anchors';
import type { InteractZone } from './interact';
import type { FrameContext, GameSystem } from '../core/types';
import { FLOWER_COLOURS, FLOWER_HEX, gameStore } from '../state';

/**
 * Living, pickable flowers.
 *
 * This replaces the old static flower scatter in `Scenery.ts` (decorative,
 * planted once and never touched again) with a small population that keeps
 * itself alive: every flower grows continuously from a seedling to a full
 * bloom, a bloom can be picked (it joins the inventory and can be worn in the
 * player's hair — see `entities/WornFlower.ts`), and picking one starts a
 * fresh seedling elsewhere after a short pause. The meadow never runs empty
 * and never grows past its cap.
 *
 * Three decisions carry the whole system, the same three the rest of the
 * park's foliage runs on (see ART_DIRECTION.md §7 "Instancing"):
 *
 *  - **One InstancedMesh per part** (stem, head), sized to the population cap
 *    and never resized. A "picked" flower is not removed from the buffer —
 *    it is scaled to nothing until it respawns, which is why the mesh count
 *    never has to change.
 *  - **No per-flower objects.** Every flower is a row across a handful of
 *    typed arrays (struct-of-arrays), not a `Group` or a `Mesh` — four hundred
 *    of those would be four hundred scene-graph nodes for something that only
 *    ever needs a position, a colour and a couple of numbers.
 *  - **Growth is read off one continuous number per flower** (`growth`,
 *    0 → 1 over `GROWTH_SECONDS`), and only flowers that are still changing
 *    — growing, or mid-wiggle — touch the instance buffers each frame. A
 *    fully bloomed, settled flower costs nothing until it is picked.
 */

/** How many flowers are alive at once — the population cap. Roughly the old
 *  static scatter's count (430), rounded down for the extra per-frame cost
 *  of a living system. */
export const FLOWER_POPULATION = 400;

/**
 * Real seconds for one flower to grow from a just-planted seedling to a full
 * bloom. Long enough that growth is a background thing you notice over a
 * session, short enough that watching one for a minute or two visibly
 * changes it — Eleri's brief was "slowly but noticeably".
 *
 * For a time-lapse check in the browser, drop this to single digits, watch a
 * few flowers bloom, then put it back before committing — see PROGRESS-FLOWERS.md.
 */
const GROWTH_SECONDS = 165;

/** Real seconds a picked flower's slot waits before a new seedling appears. */
const RESPAWN_DELAY_MIN = 5;
const RESPAWN_DELAY_MAX = 16;

/** How close (metres, planar) the player must be to pick or prod a flower. */
const PICK_RADIUS = 1.3;

/** How long the "not yet!" bud wiggle lasts, in seconds. */
const WIGGLE_SECONDS = 0.4;

/** Scatter radius, matching the old decorative flowers' footprint. */
const SCATTER_RADIUS = 55;

const STAGE_GROWING = 0;
const STAGE_BLOOMED = 1;
const STAGE_PICKED = 2;

export class Flowers implements GameSystem {
  readonly name = 'flowers';
  readonly group = new Group();

  private readonly count = FLOWER_POPULATION;
  private readonly rng = new Rng(0xf7010e);

  private readonly posX = new Float32Array(this.count);
  private readonly posZ = new Float32Array(this.count);
  private readonly groundY = new Float32Array(this.count);
  private readonly rotY = new Float32Array(this.count);
  private readonly colourIndex = new Uint8Array(this.count);
  private readonly widthTarget = new Float32Array(this.count);
  private readonly stemHeightTarget = new Float32Array(this.count);
  private readonly growth = new Float32Array(this.count);
  private readonly stage = new Uint8Array(this.count);
  private readonly respawnTimer = new Float32Array(this.count);
  private readonly wiggle = new Float32Array(this.count);

  private readonly stems: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly pickEffect: FlowerPickEffect;

  // Scratch objects, reused every frame — nothing here allocates in the loop.
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchQuaternion = new Quaternion();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchColour = new Color();

  constructor() {
    this.group.name = 'flowers';

    const stemGeometry = new CylinderGeometry(0.02, 0.028, 1, 4);
    const headGeometry = new SphereGeometry(1, 7, 5);

    this.stems = new InstancedMesh(stemGeometry, toonMaterial(0xffffff), this.count);
    this.stems.name = 'living-flower-stems';
    this.stems.castShadow = false;
    this.stems.receiveShadow = false;

    this.heads = new InstancedMesh(headGeometry, toonMaterial(0xffffff), this.count);
    this.heads.name = 'living-flower-heads';
    this.heads.castShadow = false;
    this.heads.receiveShadow = false;

    this.group.add(this.stems, this.heads);

    this.pickEffect = createFlowerPickEffect();
    this.group.add(this.pickEffect.root);

    for (let i = 0; i < this.count; i += 1) {
      this.spawnAt(i, true);
      this.writeMatrix(i);
    }
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    if (this.stems.instanceColor) this.stems.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }

  update({ dt, input, playerPosition }: FrameContext): void {
    let matrixDirty = false;

    for (let i = 0; i < this.count; i += 1) {
      let changed = false;

      if (this.stage[i] === STAGE_PICKED) {
        const timer = (this.respawnTimer[i] ?? 0) - dt;
        this.respawnTimer[i] = timer;
        if (timer <= 0) {
          this.spawnAt(i, false);
          changed = true;
        }
      }

      if (this.stage[i] === STAGE_GROWING) {
        const next = (this.growth[i] ?? 0) + dt / GROWTH_SECONDS;
        const clamped = next >= 1 ? 1 : next;
        this.growth[i] = clamped;
        changed = true;
        if (clamped >= 1) {
          this.stage[i] = STAGE_BLOOMED;
          const colour = FLOWER_COLOURS[this.colourIndex[i] ?? 0] ?? 'yellow';
          this.paintColour(i, FLOWER_HEX[colour]);
        }
      }

      if ((this.wiggle[i] ?? 0) > 0) {
        const next = (this.wiggle[i] ?? 0) - dt / WIGGLE_SECONDS;
        this.wiggle[i] = next <= 0 ? 0 : next;
        changed = true;
      }

      if (changed) {
        this.writeMatrix(i);
        matrixDirty = true;
      }
    }

    if (matrixDirty) {
      this.stems.instanceMatrix.needsUpdate = true;
      this.heads.instanceMatrix.needsUpdate = true;
    }

    this.pickEffect.update(dt);

    if (input.justPressed('interact')) {
      const nearest = this.nearestWithin(playerPosition.x, playerPosition.z, PICK_RADIUS);
      if (nearest !== null) this.tryInteract(nearest, playerPosition);
    }
  }

  /**
   * One tap target per live flower — hidden (picked, awaiting respawn) ones
   * are left out so a tap cannot land on thin air.
   *
   * Built fresh on request rather than cached, same as the stalls: this is
   * only ever read when the player actually taps the world, not once a frame.
   */
  interactZones(): InteractZone[] {
    const zones: InteractZone[] = [];
    for (let i = 0; i < this.count; i += 1) {
      if (this.stage[i] === STAGE_PICKED) continue;
      zones.push({
        id: `flower:${i}`,
        label: 'flower',
        x: this.posX[i] ?? 0,
        y: this.groundY[i] ?? 0,
        z: this.posZ[i] ?? 0,
        pickRadius: 0.9,
        standX: this.posX[i] ?? 0,
        standZ: this.posZ[i] ?? 0,
        pressInteract: true,
      });
    }
    return zones;
  }

  dispose(): void {
    this.stems.geometry.dispose();
    this.heads.geometry.dispose();
    (this.stems.material as { dispose(): void }).dispose();
    (this.heads.material as { dispose(): void }).dispose();
    this.pickEffect.dispose();
  }

  // -------------------------------------------------------------- internals

  /** Bloomed → picked. Growing → a wiggle of resistance. Nothing else reacts. */
  private tryInteract(index: number, playerPosition: Vector3): void {
    if (this.stage[index] === STAGE_BLOOMED) {
      this.pick(index, playerPosition);
    } else if (this.stage[index] === STAGE_GROWING) {
      this.wiggle[index] = 1;
    }
  }

  private pick(index: number, playerPosition: Vector3): void {
    const colour = FLOWER_COLOURS[this.colourIndex[index] ?? 0] ?? 'yellow';
    const x = this.posX[index] ?? 0;
    const z = this.posZ[index] ?? 0;
    const y = this.groundY[index] ?? 0;
    const hex = FLOWER_HEX[colour];

    gameStore.collectFlower(colour);

    // The flight target is read live every frame of the flourish, so it keeps
    // heading for the player even if they walk off immediately after picking.
    this.pickEffect.burst(x, y, z, hex, () => playerPosition);

    this.stage[index] = STAGE_PICKED;
    this.respawnTimer[index] = this.rng.range(RESPAWN_DELAY_MIN, RESPAWN_DELAY_MAX);
    this.wiggle[index] = 0;
    this.writeMatrix(index); // scales it to nothing until it respawns
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  /** Nearest live (not-picked) flower within `radius`, or null. */
  private nearestWithin(x: number, z: number, radius: number): number | null {
    let best: number | null = null;
    let bestDistance = radius;
    for (let i = 0; i < this.count; i += 1) {
      if (this.stage[i] === STAGE_PICKED) continue;
      const dx = (this.posX[i] ?? 0) - x;
      const dz = (this.posZ[i] ?? 0) - z;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Plants (or replants) slot `index` somewhere new: a fresh seedling, a
   * random colour, a random target size, always clear of paths and anchor
   * plots — the same placement rules the old decorative scatter used.
   */
  private spawnAt(index: number, initial: boolean): void {
    const point = this.pickSpawnPoint();
    this.posX[index] = point.x;
    this.posZ[index] = point.z;
    this.groundY[index] = terrainHeight(point.x, point.z);
    this.rotY[index] = this.rng.range(0, TAU);
    this.colourIndex[index] = this.rng.int(0, FLOWER_COLOURS.length - 1);
    this.widthTarget[index] = this.rng.range(0.17, 0.27);
    this.stemHeightTarget[index] = this.rng.range(0.18, 0.32);
    this.wiggle[index] = 0;
    this.respawnTimer[index] = 0;

    // At boot, stagger growth so the meadow starts full of variety rather than
    // every flower being a seedling on the same clock. A respawn always starts
    // fresh — that is the whole point of "a new seedling sprouts elsewhere".
    const seedGrowth = initial
      ? this.rng.chance(0.6)
        ? this.rng.range(0.82, 1.05)
        : this.rng.range(0, 0.82)
      : 0;
    this.growth[index] = clamp01(seedGrowth);
    this.stage[index] = this.growth[index] >= 1 ? STAGE_BLOOMED : STAGE_GROWING;
    this.paintColour(
      index,
      this.stage[index] === STAGE_BLOOMED
        ? FLOWER_HEX[FLOWER_COLOURS[this.colourIndex[index]] ?? 'yellow']
        : PALETTE.leafDeep,
    );
  }

  /** Somewhere clear of paths and every reserved anchor plot. */
  private pickSpawnPoint(): { x: number; z: number } {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = this.rng.range(0, TAU);
      const distance = Math.sqrt(this.rng.unit()) * SCATTER_RADIUS;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (isOnPath(x, z, 0.5)) continue;
      if (this.insideAnyAnchor(x, z, 0.5)) continue;
      return { x, z };
    }
    // Fell through every attempt (shouldn't happen with this much open lawn) —
    // the plaza edge is always clear of both paths and plots.
    return { x: 0, z: 12 };
  }

  private insideAnyAnchor(x: number, z: number, margin: number): boolean {
    for (const anchor of ANCHORS) {
      const dx = x - anchor.position[0];
      const dz = z - anchor.position[1];
      if (Math.hypot(dx, dz) < anchor.boundingRadius + margin) return true;
    }
    return false;
  }

  /**
   * Composes both instances' matrices from a flower's current state.
   *
   * Growth drives two things at once, which is what makes it read as a plant
   * opening rather than just getting bigger: the stem rises first
   * (`smoothstep(0, 0.55, t)`), then the head fills out and flattens from a
   * round, closed bud into the same flat bloom shape the old decorative
   * flowers used (`smoothstep(0.55, 1, t)`).
   */
  private writeMatrix(index: number): void {
    const t = this.growth[index] ?? 0;
    const picked = this.stage[index] === STAGE_PICKED;
    const x = this.posX[index] ?? 0;
    const z = this.posZ[index] ?? 0;
    const groundY = this.groundY[index] ?? 0;
    const rotY = this.rotY[index] ?? 0;

    if (picked) {
      this.scratchQuaternion.identity();
      this.scratchScale.set(0, 0, 0);
      this.scratchPosition.set(x, groundY, z);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      this.stems.setMatrixAt(index, this.scratchMatrix);
      this.heads.setMatrixAt(index, this.scratchMatrix);
      return;
    }

    const stemT = smoothstep(0, 0.55, t);
    const openT = smoothstep(0.55, 1, t);
    const overall = lerp(0.1, 1, smoothstep(0.04, 0.8, t));
    const flatten = lerp(0.92, 0.5, openT);
    const stemHeight = Math.max(0.015, (this.stemHeightTarget[index] ?? 0.2) * Math.max(stemT, 0.08));
    const width = (this.widthTarget[index] ?? 0.2) * overall;
    // A wiggle jitters the head's yaw and gives it a brief extra flare — the
    // "no, not yet!" of a bud that got prodded before it was ready.
    const wig = this.wiggle[index] ?? 0;
    const wiggleYaw = Math.sin(wig * TAU * 2.5) * wig * 0.6;
    const wiggleFlare = 1 + wig * 0.18;

    this.scratchQuaternion.setFromAxisAngle(UP, rotY);
    this.scratchPosition.set(x, groundY + stemHeight / 2, z);
    this.scratchScale.set(1, stemHeight, 1);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    this.stems.setMatrixAt(index, this.scratchMatrix);

    this.scratchQuaternion.setFromAxisAngle(UP, rotY + wiggleYaw);
    this.scratchPosition.set(x, groundY + stemHeight, z);
    this.scratchScale.set(width * wiggleFlare, width * flatten * wiggleFlare, width * wiggleFlare);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    this.heads.setMatrixAt(index, this.scratchMatrix);
  }

  private paintColour(index: number, hex: number): void {
    this.scratchColour.setHex(hex);
    this.heads.setColorAt(index, this.scratchColour);
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    // Stems stay leaf-green throughout — only the head announces the colour.
    this.scratchColour.setHex(PALETTE.leafDeep);
    this.stems.setColorAt(index, this.scratchColour);
    if (this.stems.instanceColor) this.stems.instanceColor.needsUpdate = true;
  }
}

const UP = new Vector3(0, 1, 0);
