import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Sphere,
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
 * - **A part's instances are packed, and its bounds are live.** `commit` only
 *   records what a member shows; `flush` then writes, for every part variant,
 *   just the members actually wearing it into slots `0..count-1`, and sets that
 *   mesh's bounding sphere to the union of exactly those instances. So a mesh
 *   draws no zero-scaled stand-ins for children wearing a different face or
 *   hair, and three.js's ordinary frustum culling — main pass and shadow pass
 *   alike — skips a part whose children are all off screen, or a whole crowd
 *   in a space she is not in (step 4 of docs/perf/FRAME-DROPS-2026-11.md).
 *
 *   Culling used to be off here, and rightly: three.js computes an
 *   `InstancedMesh`'s sphere once, from where its instances *were*, and these
 *   walk about — a stale sphere makes children blink out at the screen edge.
 *   The sphere is now rebuilt in the same `flush` that uploads the matrices it
 *   bounds, so it can never be a frame behind them. `check:crowd-cull` holds
 *   both halves of that: nobody on screen culled, nobody off screen drawn.
 *
 *   The cost of packing is that **slot ≠ member**: an instance id from a
 *   raycast or `getMatrixAt` does not name a child. Nothing asks today; ask the
 *   crowd, not the buffer, if something ever needs to.
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
const scratchMatrix = new Matrix4();
const scratchSphere = new Sphere();
/**
 * Metres added to each part's packed bounding sphere. The sphere is exact for
 * the geometry as committed; this is slack for nothing in particular — no crowd
 * material displaces vertices — so it is kept to a hand's breadth, where it
 * cannot make a whole part's culling meaningless.
 */
const BOUNDS_MARGIN = 0.1;

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
  /**
   * What each member showed at its last `commit`, per part: the variant drawn,
   * or -1 for none. Indexed `member * parts + part`. Kept apart from
   * {@link CrowdMember.variant}/`shown`, which callers may change between
   * commits; the buffer only ever reflects what was committed.
   */
  private readonly committedChoice: Int16Array;
  /** Each member's committed part matrices, 16 floats per `member * parts + part`. */
  private readonly committedMatrix: Float32Array;
  /** Each member's colour per part, 3 floats per `member * parts + part`. */
  private readonly colour: Float32Array;
  /** Which member each packed slot held at the last flush, per variant mesh. */
  private readonly slotMember = new Map<InstancedMesh, Int32Array>();
  /** A colour changed since the last flush, so every packed colour is rewritten. */
  private coloursDirty = true;

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
        // Culled, against a sphere `flush` rebuilds from the live instances —
        // see the class doc.
        mesh.frustumCulled = true;
        mesh.boundingSphere = new Sphere();
        mesh.renderOrder = source.renderOrder;
        // Nobody is drawn until a member is committed into it.
        for (let i = 0; i < capacity; i += 1) {
          mesh.setMatrixAt(i, ZERO_MATRIX);
          mesh.setColorAt(i, scratchColour.setHex(0xffffff));
        }
        mesh.count = 0;
        mesh.visible = false;
        this.slotMember.set(mesh, new Int32Array(capacity).fill(-1));
        this.group.add(mesh);
        return mesh;
      });
      parts.push({ source, variants });
    }

    this.parts = parts;
    this.committedChoice = new Int16Array(capacity * parts.length).fill(-1);
    this.committedMatrix = new Float32Array(capacity * parts.length * 16);
    this.colour = new Float32Array(capacity * parts.length * 3).fill(1);
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
    if (!this.parts[partIndex]) return;
    scratchColour.setHex(colour);
    const at = (member.index * this.parts.length + partIndex) * 3;
    this.colour[at] = scratchColour.r;
    this.colour[at + 1] = scratchColour.g;
    this.colour[at + 2] = scratchColour.b;
    this.coloursDirty = true;
    this.dirty = true;
  }

  /**
   * Recomputes the member's world transforms and records what it shows. Call
   * once per frame per member, after posing the skeleton; `flush` then writes
   * the buffers.
   */
  commit(member: CrowdMember): void {
    member.root.updateMatrixWorld(true);

    const partTotal = this.parts.length;
    const base = member.index * partTotal;
    for (let p = 0; p < partTotal; p += 1) {
      const part = this.parts[p];
      const proxy = member.proxies[p];
      if (!part || !proxy) continue;
      const variant = member.variant[p] ?? 0;
      const chosen = member.shown[p] && variant < part.variants.length ? variant : -1;
      this.committedChoice[base + p] = chosen;
      if (chosen >= 0) this.committedMatrix.set(proxy.matrixWorld.elements, (base + p) * 16);
    }
    this.dirty = true;
  }

  /**
   * Packs every part variant's buffer with the members wearing it, rebuilds its
   * bounding sphere from exactly those instances, and flags the upload. Call
   * once, after every `commit`.
   */
  flush(): void {
    if (!this.dirty) return;
    const partTotal = this.parts.length;
    const memberTotal = this.members.length;
    const coloursDirty = this.coloursDirty;
    for (let p = 0; p < partTotal; p += 1) {
      const part = this.parts[p];
      if (!part) continue;
      const geometrySphere = part.source.geometry.boundingSphere ?? computeSphere(part.source);
      for (let v = 0; v < part.variants.length; v += 1) {
        const mesh = part.variants[v];
        const slots = mesh ? this.slotMember.get(mesh) : undefined;
        if (!mesh || !slots) continue;
        const matrices = mesh.instanceMatrix.array as Float32Array;
        const colours = mesh.instanceColor?.array as Float32Array | undefined;
        const sphere = mesh.boundingSphere ?? (mesh.boundingSphere = new Sphere());
        let count = 0;
        let recoloured = false;
        for (let m = 0; m < memberTotal; m += 1) {
          const at = m * partTotal + p;
          if (this.committedChoice[at] !== v) continue;
          // Element by element: a `subarray` view here would allocate per instance per frame.
          for (let e = 0; e < 16; e += 1) matrices[count * 16 + e] = this.committedMatrix[at * 16 + e]!;
          if (colours && (coloursDirty || slots[count] !== m)) {
            colours[count * 3] = this.colour[at * 3]!;
            colours[count * 3 + 1] = this.colour[at * 3 + 1]!;
            colours[count * 3 + 2] = this.colour[at * 3 + 2]!;
            recoloured = true;
          }
          slots[count] = m;
          scratchMatrix.fromArray(matrices, count * 16);
          scratchSphere.copy(geometrySphere).applyMatrix4(scratchMatrix);
          if (count === 0) sphere.copy(scratchSphere);
          else sphere.union(scratchSphere);
          count += 1;
        }
        if (count > 0) sphere.radius += BOUNDS_MARGIN;
        else sphere.makeEmpty();
        mesh.count = count;
        mesh.visible = count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (recoloured && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.coloursDirty = false;
    this.dirty = false;
  }

  dispose(): void {
    for (const part of this.parts) {
      for (const variant of part.variants) variant.dispose();
    }
  }
}

// ------------------------------------------------------------------ helpers

/** A prototype mesh's geometry sphere, computed once and cached on the geometry. */
function computeSphere(source: Mesh): Sphere {
  source.geometry.computeBoundingSphere();
  return source.geometry.boundingSphere ?? new Sphere();
}

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
