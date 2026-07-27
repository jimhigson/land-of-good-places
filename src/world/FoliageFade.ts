import { Group, Mesh, MeshToonMaterial, Vector3 } from 'three';
import { damp } from '../core/mathUtils';
import { toonMaterial } from '../art/style/materials';
import { PLAYER_RADIUS } from '../core/constants';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import { FOLIAGE_GEOMETRY, type FoliageOccluder, type Scenery } from './Scenery';

/**
 * Fades out any tree standing between the camera and the player.
 *
 * The camera is fixed now (design feedback #16 — no more rotating round a
 * tree that's in the way), so a trunk or canopy that happens to line up with
 * the player used to hide them completely, for as long as they stood there —
 * observed live, repeatedly, once the camera stopped moving. This is the
 * standard isometric-game fix: nothing here is a real occlusion query (no
 * raycast against the actual meshes, no render-to-texture silhouette test),
 * just a cheap distance check against the camera→player line, because that is
 * all a tree in the way actually needs.
 *
 * ### How a tree fades
 *
 * `Scenery`'s foliage is instanced — one draw call for every trunk in the
 * park, another for every round canopy, another for every cone — and an
 * `InstancedMesh` has no per-instance opacity to animate. So instead of
 * trying to fade the instance itself, the moment a tree starts occluding:
 *
 *  1. Its instance(s) are hidden (`Scenery.setTreeHidden`) — a degenerate
 *     matrix, not a removal, so this costs nothing per frame.
 *  2. A translucent look-alike — built from the exact same unit geometry,
 *     positioned, scaled and coloured to match — takes its place from a small
 *     fixed pool of standâ€‘ins (see `FADE_POOL_SIZE`).
 *  3. The stand-in starts at full opacity, identical to how the instanced
 *     original just looked, so the swap itself is invisible, then eases down
 *     to `MIN_ALPHA` — never fully gone, which would read as the tree
 *     vanishing rather than getting out of the way.
 *
 * When the tree stops occluding the process runs in reverse, and once the
 * stand-in is back to full opacity the original instance is restored and the
 * stand-in is freed — the swap the other way is just as invisible, because it
 * only ever happens once the two look identical again.
 *
 * Only trees participate (see `Scenery.foliageOccluders`) — bushes are short
 * enough that they rarely fully hide a standing child, and the building's
 * interior is a separate space entirely (design feedback #30c), so nothing
 * about it can ever occlude the player in the park.
 */

/** How many trees may be mid-fade at once. Generous for a fixed isometric view — normally 0 or 1. */
const FADE_POOL_SIZE = 6;

/** Largest number of parts (trunk + canopy/cone blobs) any tree has. See `Scenery.buildFoliage`. */
const MAX_PARTS = 4;

/** How translucent a fully-occluding tree gets. Never 0 — a tree that vanishes reads as a bug. */
const MIN_ALPHA = 0.26;

/** Seconds for the opacity to close half the remaining distance to its target. */
const FADE_HALF_LIFE = 0.16;

/**
 * Trees further than this from the player are never considered, however they
 * line up — the cheap reject that keeps this a distance test rather than a
 * real query. A tree that could hide the player is always close to them; one
 * lining up with the sightline from much further away is background scenery,
 * not something "in the way".
 */
const NEAR_PLAYER_RADIUS = 9;
const NEAR_PLAYER_RADIUS_SQ = NEAR_PLAYER_RADIUS * NEAR_PLAYER_RADIUS;

/**
 * How much slack the sightline test gives a tree's own bounding radius, in
 * metres — the player's own girth plus a little forgiveness so the fade
 * begins a touch before the tree is dead centre on the line, rather than
 * flickering right at the geometric edge of "in the way".
 */
const SIGHTLINE_MARGIN = PLAYER_RADIUS + 0.35;

/**
 * Never treat a tree at (or past) the player themselves as "in front of"
 * them — only the segment strictly between the camera and the player counts.
 */
const MAX_LINE_T = 0.985;

interface FadeSlot {
  /** Index into `Scenery.foliageOccluders`, or -1 while this slot is free. */
  occluderIndex: number;
  alpha: number;
  readonly meshes: readonly Mesh[];
  readonly materials: readonly MeshToonMaterial[];
}

export class FoliageFade implements GameSystem {
  readonly name = 'foliageFade';
  readonly group = new Group();

  private readonly slots: FadeSlot[] = [];
  /** Which slot (if any) each occluder currently occupies. -1 = not fading. */
  private readonly occluderSlot: Int32Array;

  constructor(
    private readonly scenery: Scenery,
    private readonly camera: IsoCamera,
  ) {
    this.group.name = 'foliage-fade';
    this.occluderSlot = new Int32Array(scenery.foliageOccluders.length).fill(-1);

    for (let s = 0; s < FADE_POOL_SIZE; s += 1) {
      const meshes: Mesh[] = [];
      const materials: MeshToonMaterial[] = [];
      for (let p = 0; p < MAX_PARTS; p += 1) {
        const material = toonMaterial(0xffffff, { transparent: true, depthWrite: false, opacity: 1 });
        const mesh = new Mesh(FOLIAGE_GEOMETRY.trunk, material);
        mesh.visible = false;
        mesh.castShadow = true;
        this.group.add(mesh);
        meshes.push(mesh);
        materials.push(material);
      }
      this.slots.push({ occluderIndex: -1, alpha: 1, meshes, materials });
    }
  }

  update(context: FrameContext): void {
    const { dt, playerPosition } = context;
    const occluders = this.scenery.foliageOccluders;
    const cameraPosition = this.camera.camera.position;

    for (let i = 0; i < occluders.length; i += 1) {
      const occluder = occluders[i];
      if (!occluder) continue;

      const slotIndex = this.occluderSlot[i] ?? -1;
      const dxPlayer = occluder.x - playerPosition.x;
      const dzPlayer = occluder.z - playerPosition.z;
      const nearPlayer = dxPlayer * dxPlayer + dzPlayer * dzPlayer < NEAR_PLAYER_RADIUS_SQ;

      // Fast path: almost every tree, almost every frame — not currently
      // fading and nowhere near the player, so it cannot possibly be hiding
      // them. Skips the sightline maths entirely.
      if (slotIndex === -1 && !nearPlayer) continue;

      const wantsFade = nearPlayer && this.onSightline(cameraPosition, playerPosition, occluder);

      if (slotIndex === -1) {
        if (wantsFade) this.beginFade(i, occluder);
        continue;
      }

      const slot = this.slots[slotIndex];
      if (!slot) continue;
      slot.alpha = damp(slot.alpha, wantsFade ? MIN_ALPHA : 1, FADE_HALF_LIFE, dt);
      for (let p = 0; p < MAX_PARTS; p += 1) {
        if (slot.meshes[p]?.visible) {
          const material = slot.materials[p];
          if (material) material.opacity = slot.alpha;
        }
      }

      if (!wantsFade && slot.alpha > 0.995) this.endFade(i);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      for (const material of slot.materials) material.dispose();
    }
    // `FOLIAGE_GEOMETRY` is shared with `Scenery`'s own instanced meshes and
    // outlives this system — nothing here owns it, so nothing here disposes it.
  }

  // -------------------------------------------------------------- internals

  /**
   * The cheap "camera→player line" test the file doc promises: closest point
   * on the segment from the camera to the player to this tree's bounding
   * sphere, in full 3D (not flattened to the ground plane) so the camera's
   * pitch is honoured for free. `t` outside (0, {@link MAX_LINE_T}) means the
   * tree is not between the two at all — behind the camera, or at (or past)
   * the player.
   */
  private onSightline(camera: Vector3, player: Vector3, occluder: FoliageOccluder): boolean {
    const abx = player.x - camera.x;
    const aby = player.y - camera.y;
    const abz = player.z - camera.z;
    const lengthSquared = abx * abx + aby * aby + abz * abz;
    if (lengthSquared < 1e-6) return false;

    const apx = occluder.x - camera.x;
    const apy = occluder.centreY - camera.y;
    const apz = occluder.z - camera.z;
    const t = (apx * abx + apy * aby + apz * abz) / lengthSquared;
    if (t <= 0 || t >= MAX_LINE_T) return false;

    const dx = occluder.x - (camera.x + abx * t);
    const dy = occluder.centreY - (camera.y + aby * t);
    const dz = occluder.z - (camera.z + abz * t);
    const limit = occluder.radius + SIGHTLINE_MARGIN;
    return dx * dx + dy * dy + dz * dz < limit * limit;
  }

  private beginFade(occluderIndex: number, occluder: FoliageOccluder): void {
    const slotIndex = this.slots.findIndex((slot) => slot.occluderIndex === -1);
    if (slotIndex === -1) return; // pool exhausted — vanishingly rare; that tree just stays solid

    const slot = this.slots[slotIndex];
    if (!slot) return;
    slot.occluderIndex = occluderIndex;
    slot.alpha = 1; // matches how the instanced original looked a moment ago — nothing pops
    this.occluderSlot[occluderIndex] = slotIndex;

    for (let p = 0; p < MAX_PARTS; p += 1) {
      const mesh = slot.meshes[p];
      const material = slot.materials[p];
      const part = occluder.parts[p];
      if (!mesh || !material) continue;
      if (!part) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.geometry = FOLIAGE_GEOMETRY[part.kind];
      mesh.position.copy(part.position);
      mesh.scale.copy(part.scale);
      mesh.rotation.y = part.rotationY;
      material.color.setHex(part.colour).multiplyScalar(part.shade);
      material.opacity = slot.alpha;
    }

    this.scenery.setTreeHidden(occluderIndex, true);
  }

  private endFade(occluderIndex: number): void {
    const slotIndex = this.occluderSlot[occluderIndex] ?? -1;
    if (slotIndex === -1) return;
    const slot = this.slots[slotIndex];
    if (slot) {
      slot.occluderIndex = -1;
      for (const mesh of slot.meshes) mesh.visible = false;
    }
    this.occluderSlot[occluderIndex] = -1;
    this.scenery.setTreeHidden(occluderIndex, false);
  }
}
