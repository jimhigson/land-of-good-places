import { Group, Mesh, MeshToonMaterial, Vector3 } from 'three';
import { damp } from '../core/mathUtils';
import { toonMaterial } from '../art/style/materials';
import {
  CAPSULE_SAMPLES,
  MAX_LINE_T,
  NEAR_PLAYER_RADIUS,
  SIGHTLINE_MARGIN,
} from './foliageFadeTuning';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import { type FoliageOccluder, type Scenery } from './Scenery';
// The geometry itself comes from the tree model both the park and the cat bus's
// lane build from — sharing the object is what makes a stand-in pixel-identical.
import { FOLIAGE_GEOMETRY } from './treeModel';

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
 * ### Trees are not the only things in the way
 *
 * They were, for a while, and this file used to say so. The RiPika fountain
 * statue (#121) ended that: at 4x it hides a standing child anywhere within
 * 10.6 m of the fountain — 32.8 m² of walkable plaza, measured on the built
 * park — which is precisely the complaint above, arriving by a different route.
 *
 * So there are two kinds of occluder now, and the split is about **how a thing
 * fades**, not about what it is:
 *
 *  - **Instanced foliage** (`Scenery.foliageOccluders`) needs the stand-in
 *    machinery above, because an `InstancedMesh` has no per-instance opacity.
 *  - **{@link SightlineOccluder}** — anything that owns its own meshes and can
 *    therefore just turn its own materials down. It registers itself with
 *    {@link FoliageFade.addOccluder} and is handed an alpha; nothing here needs
 *    to know what it is.
 *
 * Registering a category rather than special-casing the statue matters: the
 * next tall thing in the park is one `setFade` away from getting out of the
 * way, instead of being one more patch to this file.
 *
 * Bushes still do not participate — they are short enough that they rarely
 * fully hide a standing child — and the building's interior is a separate
 * space entirely (design feedback #30c), so nothing about it can ever occlude
 * the player in the park.
 */

/**
 * Something that can hide the player and can fade itself out of the way.
 *
 * Modelled as an upright **capsule** rather than the sphere a tree gets,
 * because the things that need this are tall: one sphere round an 8 m statue
 * has to be ~4.4 m across to contain it, and would then start fading whenever
 * the player walked anywhere near the fountain rather than only when the statue
 * was actually in front of them. A capsule tracks a tall silhouette closely for
 * two extra numbers.
 *
 * A tree is the degenerate case (`halfHeight` 0) and takes the same path.
 */
export interface SightlineOccluder {
  readonly x: number;
  readonly z: number;
  /** Vertical centre of the occluding volume, in world space. */
  readonly centreY: number;
  /** Half the occluder's height. 0 makes this a plain sphere, as a tree is. */
  readonly halfHeight: number;
  /** Horizontal radius of the capsule. */
  readonly radius: number;
  /** 1 = fully solid; {@link MIN_ALPHA} = faded as far as this system ever goes. */
  setFade(alpha: number): void;
}

/** How many trees may be mid-fade at once. Generous for a fixed isometric view — normally 0 or 1. */
const FADE_POOL_SIZE = 6;

/** Largest number of parts (trunk + canopy/cone blobs) any tree has. See `Scenery.buildFoliage`. */
const MAX_PARTS = 4;

/** How translucent a fully-occluding tree gets. Never 0 — a tree that vanishes reads as a bug. */
const MIN_ALPHA = 0.26;

/** Seconds for the opacity to close half the remaining distance to its target. */
const FADE_HALF_LIFE = 0.16;

// The four numbers tuning the sightline test live in `foliageFadeTuning.ts`, so
// that `scripts/check-statue-occlusion.mts` can import the same definitions
// instead of keeping copies that go stale silently. That module's header has the
// full reasoning, including why they cannot simply be exported from this file.
const NEAR_PLAYER_RADIUS_SQ = NEAR_PLAYER_RADIUS * NEAR_PLAYER_RADIUS;

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

  /**
   * Self-fading occluders, with the alpha each is currently eased to.
   *
   * No pool and no stand-ins: these own their meshes, so they are simply told
   * an alpha. That is the whole reason the two lists are separate — the pool
   * above exists only because instanced foliage cannot be faded in place.
   */
  private readonly selfFading: { readonly occluder: SightlineOccluder; alpha: number }[] = [];

  private readonly scenery: Scenery;
  private readonly camera: IsoCamera;

  constructor(
    scenery: Scenery,
    camera: IsoCamera,
  ) {
    this.scenery = scenery;
    this.camera = camera;
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

    // Self-fading occluders. Same sightline rule, no pool — see `selfFading`.
    for (const entry of this.selfFading) {
      const { occluder } = entry;
      const dx = occluder.x - playerPosition.x;
      const dz = occluder.z - playerPosition.z;
      // The cheap reject has to allow for the occluder's own size, and
      // **height matters more than girth** — which is the one thing the tree
      // path's flat 9 m gets away with only because trees are short.
      //
      // The camera looks down at 38°, so a point H above the player's head
      // occludes them from about H/tan(38°) ≈ 1.28·H further away
      // horizontally. The statue's top is ~8.3 m over a child's head, which is
      // ~10.6 m of horizontal reach — nowhere near the 9 m a trunk needs.
      //
      // Measured, not reasoned: with a flat 9 m + radius this left 1.5 m² of
      // ground where the child was still hidden and the statue never faded, at
      // 11.7–12.7 m out. `2 * halfHeight` covers the 38° case with room to
      // spare, and costs nothing — the reject still discards the whole park
      // bar one object, and there is no pool to exhaust.
      const reach = NEAR_PLAYER_RADIUS + occluder.radius + 2 * occluder.halfHeight;
      const nearPlayer = dx * dx + dz * dz < reach * reach;

      const wantsFade = nearPlayer && this.capsuleOnSightline(cameraPosition, playerPosition, occluder);
      const target = wantsFade ? MIN_ALPHA : 1;

      // `damp` approaches its target asymptotically and never quite arrives, so
      // without the snap below this would keep writing materials every frame
      // for the whole life of the park. Snap, then skip once settled.
      if (entry.alpha === target) continue;
      entry.alpha = damp(entry.alpha, target, FADE_HALF_LIFE, dt);
      if (Math.abs(entry.alpha - target) < 0.002) entry.alpha = target;
      occluder.setFade(entry.alpha);
    }
  }

  /**
   * Registers something that fades itself — see {@link SightlineOccluder}.
   *
   * Call once at construction. There is no pool to exhaust and no per-frame
   * cost beyond one distance check, so anything tall enough to hide a child is
   * welcome here.
   */
  addOccluder(occluder: SightlineOccluder): void {
    this.selfFading.push({ occluder, alpha: 1 });
    occluder.setFade(1);
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
    return this.pointOnSightline(
      camera,
      player,
      occluder.x,
      occluder.centreY,
      occluder.z,
      occluder.radius,
    );
  }

  /** {@link onSightline} for one point and radius, so a capsule can reuse it. */
  private pointOnSightline(
    camera: Vector3,
    player: Vector3,
    x: number,
    y: number,
    z: number,
    radius: number,
  ): boolean {
    const abx = player.x - camera.x;
    const aby = player.y - camera.y;
    const abz = player.z - camera.z;
    const lengthSquared = abx * abx + aby * aby + abz * abz;
    if (lengthSquared < 1e-6) return false;

    const apx = x - camera.x;
    const apy = y - camera.y;
    const apz = z - camera.z;
    const t = (apx * abx + apy * aby + apz * abz) / lengthSquared;
    if (t <= 0 || t >= MAX_LINE_T) return false;

    const dx = x - (camera.x + abx * t);
    const dy = y - (camera.y + aby * t);
    const dz = z - (camera.z + abz * t);
    const limit = radius + SIGHTLINE_MARGIN;
    return dx * dx + dy * dy + dz * dz < limit * limit;
  }

  /**
   * The capsule version: samples the occluder's own vertical axis and asks the
   * point test at each height.
   *
   * Sampling rather than solving segment-to-segment distance in closed form,
   * deliberately. This is a fade *trigger*, not a physics query — the file doc
   * is explicit that none of this is a real occlusion test — and the existing
   * `SIGHTLINE_MARGIN` already blurs the edge by more than the sampling error.
   * {@link CAPSULE_SAMPLES} at 9 puts a sample every 1.03 m up an 8.24 m
   * statue, comfortably finer than its 2.4 m radius, so the line cannot thread
   * between two samples.
   */
  private capsuleOnSightline(
    camera: Vector3,
    player: Vector3,
    occluder: SightlineOccluder,
  ): boolean {
    if (occluder.halfHeight <= 0) {
      return this.pointOnSightline(
        camera,
        player,
        occluder.x,
        occluder.centreY,
        occluder.z,
        occluder.radius,
      );
    }
    for (let i = 0; i < CAPSULE_SAMPLES; i += 1) {
      const f = (i / (CAPSULE_SAMPLES - 1)) * 2 - 1;
      const y = occluder.centreY + f * occluder.halfHeight;
      if (this.pointOnSightline(camera, player, occluder.x, y, occluder.z, occluder.radius)) {
        return true;
      }
    }
    return false;
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
