import {
  Color,
  Frustum,
  type BufferGeometry,
  type Camera,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Sphere,
  type Material,
} from 'three';
import {
  LOD_DEFAULT_VIEWPORT_HEIGHT_PX,
  LOD_FULL,
  LOD_LOW,
  lowDetailGeometry,
  nextLodLevel,
  projectedDiameterPx,
} from '../../core/instancedLod';

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
 *   Then, immediately before a draw, `cullCrowdsFor` trims every part that
 *   casts no shadow to the children whose own sphere touches that camera's
 *   frustum — per child, so a child half over the edge is drawn whole. The
 *   shadow-casting parts keep everybody (see {@link InstancedCrowd.cullTo}).
 *
 *   The cost of packing is that **slot ≠ member**: an instance id from a
 *   raycast or `getMatrixAt` does not name a child. Nothing asks today; ask the
 *   crowd, not the buffer, if something ever needs to.
 * - **Every part is drawn at one of two levels of detail, chosen per child per
 *   draw** (step 16 of the same plan). Beside each part variant's mesh sits a
 *   second one over `lowDetailGeometry` of the same prototype geometry — a
 *   quarter of the triangles, derived at load, so there is still only the one
 *   model. `cullTo` asks how wide each child is drawn through the camera it is
 *   given and puts her in exactly one of the two; under the ordinary camera a
 *   child is ~23 px tall and always in the far one. The choice has hysteresis
 *   (`core/instancedLod.ts` owns the thresholds), and a child who is off
 *   screen — kept only for the shadow she throws onto it — is always the far
 *   level, so the shadow pass draws full detail only for the few children the
 *   main pass is drawing at full detail too. A crowd nobody ever calls
 *   `cullTo` on (a preview, a mini-game) stays at full detail, as before.
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
  /**
   * The far level of each variant, same order: the same material over
   * `lowDetailGeometry` of the same source. `null` where the part is too small
   * to have one, and then `variants[v]` draws every child at both levels.
   */
  readonly low: readonly (InstancedMesh | null)[];
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
const cullSphere = new Sphere();
const cullFrustum = new Frustum();
const cullMatrix = new Matrix4();
/**
 * What {@link InstancedCrowd.cullTo} needs to size a child on screen: see
 * `projectedDiameterPx` in `core/instancedLod.ts`.
 */
export interface CrowdLodView {
  /** `projection × view` of the camera about to draw. */
  readonly viewProjection: Matrix4;
  /** `projection.elements[5] × viewport height in device px / 2`. */
  pixelsPerUnitAtW1: number;
}
/** The one view {@link cullCrowdsFor} fills in per draw; shares {@link cullMatrix}. */
const lodView: CrowdLodView = { viewProjection: cullMatrix, pixelsPerUnitAtW1: 0 };
/** Every crowd not yet disposed — what {@link cullCrowdsFor} walks. */
const LIVE_CROWDS = new Set<InstancedCrowd>();
/**
 * Metres added to every sphere the crowd is culled by (a part's packed bounds,
 * a child's own sphere, a part tested on its own). The spheres are exact for
 * the geometry as committed; this is slack against float32 rounding in the
 * instance buffer and nothing else — no crowd material displaces vertices — so
 * it is a hand's breadth, where it cannot make culling meaningless.
 * `check:crowd-cull` reads it rather than keeping a number of its own.
 */
export const CROWD_BOUNDS_MARGIN = 0.1;

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
  /**
   * Each member's committed box in the crowd's frame — min x, y, z, max x, y,
   * z — enclosing every part she shows (min x is `Infinity` if she shows
   * nothing). Built in `commit` from each part's {@link partReach}.
   */
  private readonly memberBox: Float32Array;
  /**
   * How far each part's geometry reaches from its own origin: its bounding
   * sphere's centre distance plus radius, in the part's frame.
   */
  private readonly partReach: Float32Array;
  /** Scratch box for {@link pack}. */
  private readonly packBox = new Float32Array(6);
  /** Scratch for {@link cullTo}: whether each member is kept for this draw. */
  private readonly keep: Uint8Array;
  /**
   * Each member's level of detail (`LOD_FULL` / `LOD_LOW`), as the last
   * {@link cullTo} with a view left it — kept between draws because the choice
   * has hysteresis. Full until a camera says otherwise.
   */
  private readonly level: Uint8Array;

  constructor(prototype: Object3D, capacity: number, options: CrowdOptions) {
    this.capacity = capacity;
    this.prototype = prototype;
    this.group.name = 'crowd';

    const sources = collectParts(prototype);
    this.sources = sources;

    const parts: CrowdPart[] = [];
    for (const source of sources) {
      const materials = options.materialsFor(source);
      const lowGeometry = lowDetailGeometry(source.geometry);
      const build = (material: Material, geometry: BufferGeometry, suffix: string): InstancedMesh => {
        const mesh = new InstancedMesh(geometry, material, capacity);
        mesh.name = `crowd:${source.name || source.geometry.type}${suffix}`;
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
      };
      const variants = materials.map((material) => build(material, source.geometry, ''));
      const low = materials.map((material) =>
        lowGeometry === source.geometry ? null : build(material, lowGeometry, ':low'),
      );
      parts.push({ source, variants, low });
    }

    this.parts = parts;
    this.committedChoice = new Int16Array(capacity * parts.length).fill(-1);
    this.committedMatrix = new Float32Array(capacity * parts.length * 16);
    this.colour = new Float32Array(capacity * parts.length * 3).fill(1);
    this.memberBox = new Float32Array(capacity * 6).fill(Infinity);
    this.partReach = new Float32Array(parts.map((part) => {
      const sphere = geometrySphereOf(part.source);
      return sphere.center.length() + sphere.radius;
    }));
    this.keep = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity).fill(LOD_FULL);
    LIVE_CROWDS.add(this);
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
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let p = 0; p < partTotal; p += 1) {
      const part = this.parts[p];
      const proxy = member.proxies[p];
      if (!part || !proxy) continue;
      const variant = member.variant[p] ?? 0;
      const chosen = member.shown[p] && variant < part.variants.length ? variant : -1;
      this.committedChoice[base + p] = chosen;
      if (chosen < 0) continue;
      const e = proxy.matrixWorld.elements;
      this.committedMatrix.set(e, (base + p) * 16);
      // The part lies within `reach` of its own origin in its own frame, so
      // within reach × its largest scale of that origin here — a cube that
      // costs one square root, where transforming its sphere costs three.
      const scaleSq = Math.max(
        e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!,
        e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!,
        e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!,
      );
      const reach = this.partReach[p]! * Math.sqrt(scaleSq);
      const x = e[12]!, y = e[13]!, z = e[14]!;
      if (x - reach < minX) minX = x - reach;
      if (y - reach < minY) minY = y - reach;
      if (z - reach < minZ) minZ = z - reach;
      if (x + reach > maxX) maxX = x + reach;
      if (y + reach > maxY) maxY = y + reach;
      if (z + reach > maxZ) maxZ = z + reach;
    }
    const b = member.index * 6;
    if (minX === Infinity) {
      this.memberBox[b] = Infinity;
    } else {
      this.memberBox[b] = minX;
      this.memberBox[b + 1] = minY;
      this.memberBox[b + 2] = minZ;
      this.memberBox[b + 3] = maxX;
      this.memberBox[b + 4] = maxY;
      this.memberBox[b + 5] = maxZ;
    }
    this.dirty = true;
  }

  /**
   * Packs every part variant's buffer with the members wearing it, rebuilds its
   * bounding sphere round exactly those children, and flags the upload. Call
   * once, after every `commit`.
   *
   * This alone is always correct to draw: every committed member is in. A
   * renderer that then calls {@link cullTo} with the camera it is about to draw
   * through gets the non-shadow parts trimmed to the children on screen.
   */
  flush(): void {
    if (!this.dirty) return;
    const partTotal = this.parts.length;
    for (let p = 0; p < partTotal; p += 1) {
      const part = this.parts[p];
      if (!part) continue;
      for (let v = 0; v < part.variants.length; v += 1) this.pack(p, v, null);
    }
    this.coloursDirty = false;
    this.dirty = false;
  }

  /**
   * **Trims the crowd to the children `camera` can see**, for the draw about
   * to happen through it. Call after `flush`, immediately before
   * `renderer.render` — `cullCrowdsFor` is how `Game` does it.
   *
   * A child is kept whole if anything of her touches the frustum, so a child
   * half over the screen edge is drawn complete — culling is per child, never
   * per part. Her committed box decides the clear cases; one whose box straddles
   * the frustum is decided part by part, against each part's exact sphere.
   *
   * **Shadow-casting parts are left alone.** The same buffer feeds the shadow
   * pass, and a child just off the screen still throws her shadow onto it; the
   * shadow camera is not the view camera and there is more than one shadow
   * light (the sun, the castle's key). Those parts keep every member and their
   * union sphere, which three.js culls per pass on its own.
   *
   * **Given `view`, it also chooses every child's level of detail** for this
   * draw, by how wide her sphere is drawn through it (see the class doc). A
   * child off screen is the far level. Without `view` the levels stay as they
   * were.
   */
  cullTo(frustum: Frustum, view?: CrowdLodView): void {
    const memberTotal = this.members.length;
    const toWorld = this.group.matrixWorld;
    const scale = toWorld.getMaxScaleOnAxis();
    let levelChanged = false;
    for (let m = 0; m < memberTotal; m += 1) {
      if (!this.memberShows(m)) {
        this.keep[m] = 0;
        continue;
      }
      this.sphereOfBox(m * 6, this.memberBox, cullSphere);
      cullSphere.center.applyMatrix4(toWorld);
      cullSphere.radius *= scale;
      const inside = sphereSide(frustum, cullSphere);
      if (view) {
        const c = cullSphere.center;
        const level =
          inside === -1
            ? LOD_LOW
            : nextLodLevel(
                this.level[m]!,
                projectedDiameterPx(view.viewProjection, view.pixelsPerUnitAtW1, c.x, c.y, c.z, cullSphere.radius),
              );
        if (level !== this.level[m]) {
          this.level[m] = level;
          levelChanged = true;
        }
      }
      // Wholly in or wholly out is decided by the child's own sphere; one
      // straddling the frustum asks her parts, so a child whose union sphere
      // pokes into the frame with nothing of her in it is not drawn.
      this.keep[m] = inside === 1 ? 1 : inside === -1 ? 0 : this.anyPartMeets(frustum, m, toWorld, scale) ? 1 : 0;
    }
    for (let p = 0; p < this.parts.length; p += 1) {
      const part = this.parts[p];
      if (!part) continue;
      for (let v = 0; v < part.variants.length; v += 1) {
        if (part.variants[v]?.castShadow) {
          // Everybody stays in; only which level's mesh holds her can change.
          if (levelChanged) this.pack(p, v, null);
          continue;
        }
        this.pack(p, v, this.keep);
      }
    }
  }

  /** Whether member `m` showed anything at her last commit. */
  private memberShows(m: number): boolean {
    return m < this.members.length && this.memberBox[m * 6] !== Infinity;
  }

  /** The sphere round the box at `box[o..o+5]`, plus {@link CROWD_BOUNDS_MARGIN}. */
  private sphereOfBox(o: number, box: Float32Array, out: Sphere): void {
    const hx = (box[o + 3]! - box[o]!) / 2;
    const hy = (box[o + 4]! - box[o + 1]!) / 2;
    const hz = (box[o + 5]! - box[o + 2]!) / 2;
    out.center.set(box[o]! + hx, box[o + 1]! + hy, box[o + 2]! + hz);
    out.radius = Math.sqrt(hx * hx + hy * hy + hz * hz) + CROWD_BOUNDS_MARGIN;
  }

  /** Whether any part member `m` shows meets `frustum`, each part padded by {@link CROWD_BOUNDS_MARGIN}. */
  private anyPartMeets(frustum: Frustum, m: number, toWorld: Matrix4, scale: number): boolean {
    const partTotal = this.parts.length;
    for (let p = 0; p < partTotal; p += 1) {
      const at = m * partTotal + p;
      const part = this.parts[p];
      if (!part || this.committedChoice[at]! < 0) continue;
      scratchMatrix.fromArray(this.committedMatrix, at * 16);
      cullSphere.copy(geometrySphereOf(part.source)).applyMatrix4(scratchMatrix).applyMatrix4(toWorld);
      cullSphere.radius += CROWD_BOUNDS_MARGIN * scale;
      if (frustum.intersectsSphere(cullSphere)) return true;
    }
    return false;
  }

  /**
   * Writes one part variant's buffers — each child wearing it into the mesh of
   * her own level of detail, and into no other.
   */
  private pack(p: number, v: number, keep: Uint8Array | null): void {
    const part = this.parts[p];
    const full = part?.variants[v];
    if (!part || !full) return;
    const low = part.low[v] ?? null;
    // No far level for this part: the one mesh holds every child at any level.
    this.packInto(full, p, v, keep, low ? LOD_FULL : -1);
    if (low) this.packInto(low, p, v, keep, LOD_LOW);
  }

  /**
   * Writes one mesh's buffer: the members wearing variant `v` of part `p` at
   * `level` (any level if negative) — and, given `keep`, only those kept —
   * into slots `0..count-1`, its bounding sphere the sphere round those
   * children's boxes.
   */
  private packInto(mesh: InstancedMesh, p: number, v: number, keep: Uint8Array | null, level: number): void {
    const slots = this.slotMember.get(mesh);
    if (!slots) return;
    const partTotal = this.parts.length;
    const memberTotal = this.members.length;
    const coloursDirty = this.coloursDirty;
    const matrices = mesh.instanceMatrix.array as Float32Array;
    const colours = mesh.instanceColor?.array as Float32Array | undefined;
    const sphere = mesh.boundingSphere ?? (mesh.boundingSphere = new Sphere());
    let count = 0;
    let recoloured = false;
    const box = this.packBox;
    box[0] = box[1] = box[2] = Infinity;
    box[3] = box[4] = box[5] = -Infinity;
    for (let m = 0; m < memberTotal; m += 1) {
      const at = m * partTotal + p;
      if (this.committedChoice[at] !== v) continue;
      if (keep && !keep[m]) continue;
      if (level >= 0 && this.level[m] !== level) continue;
      // Element by element: a `subarray` view here would allocate per instance per frame.
      for (let e = 0; e < 16; e += 1) matrices[count * 16 + e] = this.committedMatrix[at * 16 + e]!;
      if (colours && (coloursDirty || slots[count] !== m)) {
        colours[count * 3] = this.colour[at * 3]!;
        colours[count * 3 + 1] = this.colour[at * 3 + 1]!;
        colours[count * 3 + 2] = this.colour[at * 3 + 2]!;
        recoloured = true;
      }
      slots[count] = m;
      // The mesh's bounds are the box round its children's own boxes: no
      // transform per instance, and never smaller than any part it draws.
      const b = m * 6;
      for (let k = 0; k < 3; k += 1) {
        if (this.memberBox[b + k]! < box[k]!) box[k] = this.memberBox[b + k]!;
        if (this.memberBox[b + 3 + k]! > box[3 + k]!) box[3 + k] = this.memberBox[b + 3 + k]!;
      }
      count += 1;
    }
    if (count > 0) this.sphereOfBox(0, box, sphere);
    else sphere.makeEmpty();
    // A slot past `count` is remembered as holding whoever it last held, and
    // skips its colour write when she comes back. That is only true while her
    // colour has not changed in the meantime — and children now move between a
    // part's two level meshes all the time — so a recolour forgets them.
    if (coloursDirty) slots.fill(-1, count);
    mesh.count = count;
    mesh.visible = count > 0;
    // An empty mesh is not drawn, so there is nothing to upload for it: under
    // the ordinary camera that is every full-detail mesh, every frame.
    if (count > 0) mesh.instanceMatrix.needsUpdate = true;
    if (recoloured && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    LIVE_CROWDS.delete(this);
    for (const part of this.parts) {
      for (const variant of part.variants) variant.dispose();
      for (const variant of part.low) variant?.dispose();
    }
  }
}

// ------------------------------------------------------------------ helpers

/** A prototype mesh's geometry sphere, computed once and cached on the geometry. */
function geometrySphereOf(source: Mesh): Sphere {
  if (!source.geometry.boundingSphere) source.geometry.computeBoundingSphere();
  return source.geometry.boundingSphere ?? EMPTY_SPHERE;
}
const EMPTY_SPHERE = new Sphere();

/**
 * **Trim every crowd drawn in `scene` to what `camera` sees** — call it
 * immediately before `renderer.render(scene, camera)`, as `Game.render` does.
 *
 * Crowds in another scene (a preview, a mini-game) are left exactly as their
 * own `flush` packed them, which is always correct to draw. A crowd whose
 * `flush` has not run since its last `commit` is trimmed against its last
 * flush, which is the buffer the renderer would upload anyway.
 *
 * `viewportHeightPx` is the height, in device pixels, of what is being drawn
 * into (`renderer.domElement.height`): each child's level of detail is chosen
 * by how many of those pixels she covers. A caller with no renderer to ask
 * gets `LOD_DEFAULT_VIEWPORT_HEIGHT_PX`.
 */
export function cullCrowdsFor(
  scene: Object3D,
  camera: Camera,
  viewportHeightPx: number = LOD_DEFAULT_VIEWPORT_HEIGHT_PX,
): void {
  // Parents too: a ride's camera rides on something. Both of these repeat work
  // `render` is about to do anyway, so they cannot disagree with it.
  camera.updateWorldMatrix(true, false);
  cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cullFrustum.setFromProjectionMatrix(cullMatrix, camera.coordinateSystem, camera.reversedDepth);
  lodView.pixelsPerUnitAtW1 = (camera.projectionMatrix.elements[5]! * viewportHeightPx) / 2;
  for (const crowd of LIVE_CROWDS) {
    // Not in this scene, or switched off (an interior she is not in): not drawn
    // by this render at all, so there is nothing to trim.
    if (!drawnIn(crowd.group, scene)) continue;
    crowd.group.updateWorldMatrix(true, false);
    crowd.cullTo(cullFrustum, lodView);
  }
}

/** 1 if `sphere` is wholly inside `frustum`, -1 if wholly outside, 0 if it straddles a plane. */
function sphereSide(frustum: Frustum, sphere: Sphere): number {
  let side = 1;
  for (const plane of frustum.planes) {
    const distance = plane.distanceToPoint(sphere.center);
    if (distance < -sphere.radius) return -1;
    if (distance < sphere.radius) side = 0;
  }
  return side;
}

/** Whether `object` and all its ancestors are visible and it hangs from `scene`. */
function drawnIn(object: Object3D, scene: Object3D): boolean {
  let at: Object3D | null = object;
  while (at) {
    if (!at.visible) return false;
    if (at === scene) return true;
    at = at.parent;
  }
  return false;
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
