import type { Group, Material, Mesh, Object3D } from 'three';
import { BUILDING_FADE_SECONDS } from '../../core/constants';

interface FadeMaterial extends Material {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface FloorLayer {
  readonly group: Group;
  readonly materials: FadeMaterial[];
  readonly baseOpacity: number[];
  readonly baseTransparent: boolean[];
  readonly baseDepthWrite: boolean[];
  amount: number;
  target: number;
}

/**
 * The Theme Park cutaway.
 *
 * When the player walks into the building, every floor above the one they are
 * standing on fades away, so the camera looks straight down into the storey they
 * are actually on. Step outside and the whole tower comes back.
 *
 * Materials are *claimed* by the first floor that uses one and cloned for any
 * later floor, which means the builders upstream can share materials freely
 * without one floor's fade bleeding into another's.
 */
export class FloorFader {
  private readonly layers: FloorLayer[] = [];
  private readonly claimed = new Set<Material>();

  /**
   * @param hiddenAmount what "hidden" means for this fader, 0…1.
   *
   * The castle wants 0: you are inside it, and a storey above your head is
   * simply in the way. The hotel lobby's gallery is not — it is the thing the
   * room is *for*, and a child walking under the arch should still see it
   * overhead while she can see herself through it. So it ghosts rather than
   * vanishes. Same fade, same material claiming, same timing; one number.
   */
  private readonly hiddenAmount: number;

  constructor(hiddenAmount = 0) {
    this.hiddenAmount = hiddenAmount;
  }

  /** Registers a floor group. Call once per floor, bottom to top, once built. */
  addLayer(group: Group): void {
    const materials: FadeMaterial[] = [];
    const substitutes = new Map<Material, Material>();

    group.traverse((object: Object3D) => {
      const mesh = object as Mesh;
      const isDrawable =
        mesh.isMesh === true ||
        (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true;
      if (!isDrawable || !mesh.material) return;

      const single = !Array.isArray(mesh.material);
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const replacement: Material[] = [];

      for (const material of list) {
        let target = substitutes.get(material);
        if (!target) {
          target = this.claimed.has(material) ? material.clone() : material;
          substitutes.set(material, target);
          this.claimed.add(target);
          materials.push(target as FadeMaterial);
        }
        replacement.push(target);
      }

      mesh.material = single ? (replacement[0] as Material) : replacement;
    });

    this.layers.push({
      group,
      materials,
      baseOpacity: materials.map((material) => material.opacity),
      baseTransparent: materials.map((material) => material.transparent),
      baseDepthWrite: materials.map((material) => material.depthWrite),
      amount: 1,
      target: 1,
    });
  }

  /**
   * Shows layers `0..highest` and hides everything above.
   * Pass `null` to show the whole building.
   */
  setVisibleUpTo(highest: number | null): void {
    for (let index = 0; index < this.layers.length; index += 1) {
      const layer = this.layers[index];
      if (!layer) continue;
      layer.target = highest === null || index <= highest ? 1 : this.hiddenAmount;
    }
  }

  update(dt: number): void {
    const step = BUILDING_FADE_SECONDS > 0 ? dt / BUILDING_FADE_SECONDS : 1;
    for (const layer of this.layers) {
      if (layer.amount === layer.target) continue;
      const delta = layer.target - layer.amount;
      layer.amount += Math.sign(delta) * Math.min(Math.abs(delta), step);
      applyFade(layer);
    }
  }
}

function applyFade(layer: FloorLayer): void {
  const amount = layer.amount;
  layer.group.visible = amount > 0.002;
  for (let i = 0; i < layer.materials.length; i += 1) {
    const material = layer.materials[i];
    if (!material) continue;
    const base = layer.baseOpacity[i] ?? 1;
    const wasTransparent = material.transparent;
    if (amount >= 0.998) {
      material.opacity = base;
      material.transparent = layer.baseTransparent[i] ?? false;
      material.depthWrite = layer.baseDepthWrite[i] ?? true;
    } else {
      material.opacity = base * amount;
      material.transparent = true;
      material.depthWrite = false;
    }
    // **`transparent` is a shader define, not a uniform.** `opacity` alone is
    // picked up every frame, but turning `transparent` on after a material has
    // compiled needs a recompile, and without it three.js keeps drawing the
    // opaque program: the deck stays solid on screen while every number on the
    // material says it is a ghost. That is precisely what QA measured in the
    // imperial lobby — she painted 0.4% of her own silhouette under the arch
    // against 29-37% in the open, with 420 of the group's 436 materials still
    // at `version` 1, and the 16 that *did* look right being the ones some
    // other code had already dirtied. Flagged only on the frame the flag
    // actually changes, so the ordinary case costs nothing.
    if (material.transparent !== wasTransparent) material.needsUpdate = true;
  }
}
