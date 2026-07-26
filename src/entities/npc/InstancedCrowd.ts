import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  type Material,
} from 'three';

/**
 * Many copies of one authored model, for a handful of draw calls.
 *
 * The park's children are all `createKid()` — the same model the player wears —
 * but a kid is about twenty-five little meshes, and twelve of them drawn the
 * ordinary way would be three hundred draw calls on their own. That is the
 * entire frame budget spent on background characters.
 *
 * So the crowd is built **by reading a prototype**, not by re-authoring one:
 *
 * 1. Build one throwaway kid. Never add it to the scene.
 * 2. Walk it. Every mesh becomes one `InstancedMesh` holding that part for
 *    every member of the crowd — one draw call per *part*, not per *child*.
 * 3. Every member gets a **skeleton**: a mirror of the prototype's hierarchy
 *    made of empty `Object3D`s, with a proxy standing in for each mesh. Animate
 *    the skeleton exactly as you would animate the real model.
 * 4. Each frame, `commit()` copies each proxy's world matrix into its part's
 *    instance slot.
 *
 * The payoff is that the crowd inherits whatever the model file produces. Retune
 * the kid's proportions, move a bunch of hair, add a pocket — the crowd picks it
 * up on the next reload with no changes here, because nothing in this file knows
 * what a kid *is*.
 *
 * Two costs are worth knowing about:
 *
 * - **Per-instance colour replaces per-part material.** Every part is drawn with
 *   one shared material, tinted per instance via `instanceColor`. That is what
 *   makes the whole crowd share materials; it also means a member's colours are
 *   set once at spawn, not swapped per frame.
 * - **Instanced meshes are not frustum-culled here.** An `InstancedMesh`'s
 *   bounding sphere is computed from where its instances *were*, and these ones
 *   walk about; culling against a stale sphere makes children blink out of
 *   existence at the screen edge. At one draw call per part it is not a trade
 *   worth making.
 */

/** One part of the prototype, and the instanced mesh (or meshes) that draw it. */
interface CrowdPart {
  readonly source: Mesh;
  /**
   * One instanced mesh per material variant. A member shows exactly one of
   * them; the rest get a zero matrix for that member. This is how the same
   * face patch is drawn neutral for most children and happy for the one
   * currently waving, without a per-child material.
   */
  readonly variants: readonly InstancedMesh[];
}

/** A member's animatable copy of the prototype. Pose it, then `commit`. */
export interface CrowdMember {
  readonly index: number;
  /** Root of the skeleton. Position and rotate this like any other model root. */
  readonly root: Object3D;
  /** Empty stand-ins for the prototype's meshes, in part order. */
  readonly proxies: readonly Object3D[];
  /** Which material variant each part currently uses. */
  readonly variant: Uint8Array;
  /** Per-part visibility. A hidden part is drawn with a zero matrix. */
  readonly shown: Uint8Array;
}

export interface CrowdOptions {
  /**
   * Chooses the material(s) for a prototype mesh. Return more than one to make
   * that part switchable per member (see {@link CrowdMember.variant}).
   * Returning an empty array drops the part from the crowd entirely.
   */
  materialsFor(source: Mesh): readonly Material[];
  /**
   * Whether this part casts a shadow. Defaults to nothing casting.
   *
   * Shadow casting is not free — `renderer.info.render.calls` counts the shadow
   * pass, so every caster is drawn twice. A crowd wants this on for the two or
   * three parts that carry the silhouette and off for the rest: a child's
   * shadow is a head and a body, and nobody has ever looked at the ground for
   * their hair bobbles.
   */
  castShadowFor?(source: Mesh): boolean;
  receiveShadow?: boolean;
}

const ZERO_MATRIX = new Matrix4().makeScale(0, 0, 0);
const scratchColour = new Color();

export class InstancedCrowd {
  readonly group = new Group();
  /** How many meshes the prototype contributed. Also the draw-call count. */
  readonly partCount: number;

  private readonly parts: readonly CrowdPart[];
  private readonly sources: readonly Mesh[];
  private readonly prototype: Object3D;
  private readonly capacity: number;
  private readonly members: CrowdMember[] = [];
  private dirty = true;

  constructor(prototype: Object3D, capacity: number, options: CrowdOptions) {
    this.capacity = capacity;
    this.prototype = prototype;
    this.group.name = 'crowd';

    const sources = collectParts(prototype);
    this.sources = sources;

    const parts: CrowdPart[] = [];
    for (const source of sources) {
      const materials = options.materialsFor(source);
      const variants = materials.map((material) => {
        const mesh = new InstancedMesh(source.geometry, material, capacity);
        mesh.name = `crowd:${source.name || source.geometry.type}`;
        mesh.castShadow = options.castShadowFor?.(source) ?? false;
        mesh.receiveShadow = options.receiveShadow ?? false;
        // See the note in the class doc: these walk, so a cached bounding
        // sphere would cull them at the wrong moment.
        mesh.frustumCulled = false;
        mesh.renderOrder = source.renderOrder;
        // Everything starts hidden; `commit` reveals a member's parts.
        for (let i = 0; i < capacity; i += 1) {
          mesh.setMatrixAt(i, ZERO_MATRIX);
          mesh.setColorAt(i, scratchColour.setHex(0xffffff));
        }
        this.group.add(mesh);
        return mesh;
      });
      parts.push({ source, variants });
    }

    this.parts = parts;
    this.partCount = parts.reduce((total, part) => total + part.variants.length, 0);
  }

  /** The prototype meshes, in the order a member's proxies follow. */
  get partSources(): readonly Mesh[] {
    return this.sources;
  }

  /**
   * Adds a member and hands back its skeleton.
   *
   * Throws past `capacity` rather than silently dropping a child — a park that
   * is quietly one kid short is a bug nobody notices for a week.
   */
  spawn(): CrowdMember {
    const index = this.members.length;
    if (index >= this.capacity) {
      throw new Error(`InstancedCrowd: capacity ${this.capacity} exhausted`);
    }

    const proxies: Object3D[] = [];
    const root = cloneSkeleton(this.prototype, proxies);

    const member: CrowdMember = {
      index,
      root,
      proxies,
      variant: new Uint8Array(this.parts.length),
      shown: new Uint8Array(this.parts.length).fill(1),
    };
    this.members.push(member);
    return member;
  }

  /** Tints one part of one member. Colours are multiplied into the material. */
  setPartColour(member: CrowdMember, partIndex: number, colour: number): void {
    const part = this.parts[partIndex];
    if (!part) return;
    scratchColour.setHex(colour);
    for (const variant of part.variants) {
      variant.setColorAt(member.index, scratchColour);
      if (variant.instanceColor) variant.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Recomputes the member's world transforms and writes them into the instance
   * buffers. Call once per frame per member, after posing the skeleton.
   */
  commit(member: CrowdMember): void {
    member.root.updateMatrixWorld(true);

    for (let p = 0; p < this.parts.length; p += 1) {
      const part = this.parts[p];
      const proxy = member.proxies[p];
      if (!part || !proxy) continue;
      const chosen = member.shown[p] ? member.variant[p] : -1;
      for (let v = 0; v < part.variants.length; v += 1) {
        const variant = part.variants[v];
        if (!variant) continue;
        variant.setMatrixAt(member.index, v === chosen ? proxy.matrixWorld : ZERO_MATRIX);
      }
    }
    this.dirty = true;
  }

  /** Flushes the instance buffers to the GPU. Call once, after every `commit`. */
  flush(): void {
    if (!this.dirty) return;
    for (const part of this.parts) {
      for (const variant of part.variants) variant.instanceMatrix.needsUpdate = true;
    }
    this.dirty = false;
  }

  dispose(): void {
    for (const part of this.parts) {
      for (const variant of part.variants) variant.dispose();
    }
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Every mesh in the prototype that the crowd should draw, in traversal order.
 *
 * `MeshBasicMaterial` meshes are skipped, which on a character means the
 * inverted-hull outlines. That is deliberate and it is the house rule, not an
 * optimisation: ART_DIRECTION reserves ink outlines for the character the
 * camera is following. Outlining a dozen background children turns the middle
 * distance into a colouring book.
 */
function collectParts(prototype: Object3D): Mesh[] {
  const parts: Mesh[] = [];
  prototype.traverse((object) => {
    if (object instanceof Mesh && !isOutlineMesh(object)) parts.push(object);
  });
  return parts;
}

/** An ink outline: the only `MeshBasicMaterial` a character model ever uses. */
function isOutlineMesh(mesh: Mesh): boolean {
  return mesh.material instanceof MeshBasicMaterial;
}

/**
 * Mirrors a model's hierarchy with empty objects.
 *
 * Meshes become empty proxies too — same local transform, no geometry — and are
 * pushed onto `proxies` in the same order {@link collectParts} walks, so proxy
 * *i* is the stand-in for part *i*. Outline meshes are skipped on both sides,
 * which keeps those two orders in step.
 */
function cloneSkeleton(node: Object3D, proxies: Object3D[]): Object3D {
  const copy = new Object3D();
  copy.name = node.name;
  copy.position.copy(node.position);
  copy.quaternion.copy(node.quaternion);
  copy.scale.copy(node.scale);
  if (node instanceof Mesh && !isOutlineMesh(node)) proxies.push(copy);

  for (const child of node.children) {
    if (child instanceof Mesh && isOutlineMesh(child)) continue;
    copy.add(cloneSkeleton(child, proxies));
  }

  return copy;
}
