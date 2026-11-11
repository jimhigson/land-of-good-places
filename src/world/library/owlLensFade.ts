import { Mesh, Vector3, type Material, type Object3D } from 'three';
import { smoothstep } from '../../core/mathUtils';

/**
 * **The owl fades as she passes the lens** — QA of #736, 26 Oct 2026: story
 * time's shot comes down the moment the child sits, so it is already held
 * when the owl flies to her chair, and from cushion 3 her flight went straight
 * through the eye: for about a fifth of a second the inside of an owl filled
 * half a laptop's screen (61% measured) and two-thirds of a phone's. From
 * cushion 1 she brushed past, a quarter of the frame. The fix chosen on 11 Nov
 * 2026: fade her out smoothly while she is close to the camera, and back.
 *
 * ## How close is close
 *
 * Her nearest drawn surface is bounded by one sphere round her middle — her
 * feet to her tallest breath ({@link LibraryOwl.top}) and her widest wingbeat
 * ({@link LibraryOwl.flightRadius}) — so the distance from the eye to that
 * sphere is never more than the distance to her. She is whole while it is
 * {@link OWL_FADE_FULL} or more, gone at {@link OWL_FADE_GONE} or less, and
 * in between eases on a smoothstep of the distance: the fade is as smooth as
 * her flight. Perched on her chair, or at her desk, she is metres outside the
 * band from any eye story time chooses, so it never touches her while she
 * reads (`check:library` holds that).
 *
 * ## Only as she is drawn
 *
 * {@link apply} swaps each of her meshes' materials for its own faded copy,
 * just before the frame is drawn, and {@link restore} puts the originals back
 * straight after. Between frames she is exactly as she was — her materials
 * untouched, and so every stand-in cloned from her (`storyStage` shares her
 * materials), the shot's solver (which counts a see-through mesh as hiding
 * nothing) and every check reading her see the owl, never a ghost of her.
 * The copies keep writing depth, so a half-faded owl shows her front and not
 * her own outline and far wing through her body.
 */
export class OwlLensFade {
  private readonly owl: OwlLensFadeOwl;
  /** The sphere round her middle: its height over her feet and its radius. */
  private readonly middle: number;
  private readonly reach: number;
  private readonly faded = new Map<Material, Material>();
  private readonly swapped: { mesh: Mesh; material: Material | Material[] }[] = [];
  private hidden = false;
  private readonly centre = new Vector3();
  /** The alpha she was last drawn at by {@link apply}: 1 whole, 0 gone. */
  alpha = 1;

  constructor(owl: OwlLensFadeOwl) {
    this.owl = owl;
    this.middle = owl.top / 2;
    this.reach = Math.hypot(owl.top / 2, owl.flightRadius);
  }

  /** How far the eye at `eye` is outside the sphere round her (metres; negative inside it). */
  clearance(eye: Readonly<Vector3>): number {
    const root = this.owl.handle.root;
    root.updateWorldMatrix(true, false);
    this.centre.set(0, this.middle, 0).applyMatrix4(root.matrixWorld);
    return this.centre.distanceTo(eye) - this.reach;
  }

  /** How whole she is drawn from an eye at `eye`: 1 whole, 0 gone. */
  alphaFor(eye: Readonly<Vector3>): number {
    return smoothstep(OWL_FADE_GONE, OWL_FADE_FULL, this.clearance(eye));
  }

  /** Fades her for the frame about to be drawn from `eye`. Pair with {@link restore} once it is drawn. */
  apply(eye: Readonly<Vector3>): number {
    this.restore();
    const alpha = this.alphaFor(eye);
    this.alpha = alpha;
    if (alpha >= 1) return alpha;
    const root = this.owl.handle.root;
    if (alpha <= 0) {
      if (root.visible) {
        root.visible = false;
        this.hidden = true;
      }
      return alpha;
    }
    root.traverse((node: Object3D) => {
      if (!(node instanceof Mesh)) return;
      const material = node.material as Material | Material[];
      this.swapped.push({ mesh: node, material });
      node.material = Array.isArray(material) ? material.map((m) => this.fadedCopy(m, alpha)) : this.fadedCopy(material, alpha);
    });
    return alpha;
  }

  /** Her own materials back, and her shown if {@link apply} hid her. */
  restore(): void {
    for (const { mesh, material } of this.swapped) mesh.material = material;
    this.swapped.length = 0;
    if (this.hidden) {
      this.owl.handle.root.visible = true;
      this.hidden = false;
    }
  }

  /** `material`'s faded copy, made once and kept in step with it (a face's map changes as she blinks). */
  private fadedCopy(material: Material, alpha: number): Material {
    let copy = this.faded.get(material);
    if (!copy) {
      copy = material.clone();
      copy.transparent = true;
      copy.depthWrite = true;
      this.faded.set(material, copy);
    }
    const map = (material as Material & { map?: unknown }).map;
    if (map !== undefined) (copy as Material & { map?: unknown }).map = map;
    copy.visible = material.visible;
    copy.opacity = material.opacity * alpha;
    return copy;
  }
}

/** What {@link OwlLensFade} reads of the owl. */
export interface OwlLensFadeOwl {
  readonly handle: { readonly root: Object3D };
  readonly top: number;
  readonly flightRadius: number;
}

/** Metres from the eye to the sphere round her at which she is wholly drawn — further than any wingtip can reach the lens from. */
export const OWL_FADE_FULL = 1.5;
/** Metres from the eye to that sphere at which she is gone — the lens is then inside her reach. */
export const OWL_FADE_GONE = 0.25;
