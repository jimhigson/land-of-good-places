import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { PALETTE, Rng, TAU } from '../style/bridge';
import { ART } from '../style/artPalette';
import { starGeometry } from '../style/shapes';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import { blob, type AssetHandle } from '../style/asset';
import { visibleTop } from '../style/measure';

/**
 * The shoes — what the kid has on her feet, chosen in the character creator.
 *
 * ## Why this is a rig and not a `createShoe(kind)` asset
 *
 * A hat is a **separate asset mounted on an anchor**, because a hat is bought in
 * a shop, worn, and taken off again — `WornHat.ts` swaps one for another at
 * runtime. Shoes are not that. They are chosen once, never bought and never
 * removed, which is the relationship *hair* has with the head, so this file is
 * modelled on `hair.ts` and on the backpack rig: parts tagged with the kinds
 * that show them, one `setKind` flipping `visible`, and materials handed in by
 * `createKid` so `setShoeColour` keeps working.
 *
 * There is one thing shoes do that neither hair nor a backpack does, and it is
 * the reason this cannot be a single anchor: **`applyWalk` rotates
 * `limbs.leftLeg` and `limbs.rightLeg` every frame**, and a shoe has to swing
 * with the leg it is on. So every part is built twice, once per leg pivot, and
 * {@link ShoeRig} owns a pair. Anything hung off a single point on the body
 * would slide off the foot the moment she walked.
 *
 * {@link createShoe} exists as well, and returns a normal `AssetHandle`, but it
 * is for **showing** a shoe — a picker swatch, a shop stand — not for wearing
 * one. It builds the same parts around a copy of the foot.
 *
 * ## The foot underneath
 *
 * `kid.ts` builds each foot as `blob(0.175, shoeMat, [1, 0.78, 1.28])` — a
 * squashed sphere with semi-axes **(0.175, 0.1365, 0.224) m**, sitting at
 * `(0, -0.22, 0.045)` in its leg pivot. That blob *is* the shoe today: it is
 * painted `ART.kidShoe` and there is nothing else down there.
 *
 * Every shoe here keeps that blob and dresses it, which matters for one kind in
 * particular: **a sandal has to show the foot**, so `'sandal'` paints the blob
 * `PALETTE.skin` and adds a sole and a strap over it, while the others paint it
 * the chosen shoe colour. That is why {@link ShoeRig} owns `setKind` *and* the
 * foot's material, rather than only toggling meshes.
 *
 * Everything below is in **metres, in the foot's own frame**: `+x` points
 * outward (away from the other foot), `+y` up, `+z` forward. `emitPair` mirrors
 * it onto the left leg.
 */

/** The foot blob's semi-axes, from `kid.ts`. Every shape here is cut to these. */
const FOOT = { x: 0.175, y: 0.1365, z: 0.224 } as const;

/** Where that blob sits inside its leg pivot, again from `kid.ts`. */
const FOOT_AT = { x: 0, y: -0.22, z: 0.045 } as const;

export type ShoeKind = 'plain' | 'ripika' | 'sandal' | 'sparkle';

export const SHOE_KINDS: readonly ShoeKind[] = ['plain', 'ripika', 'sandal', 'sparkle'];

/**
 * The kinds a **background child** in the crowd may wear.
 *
 * `kidCrowd.ts` bakes one instanced draw call per mesh on the prototype kid, so
 * every extra shoe part that the crowd can show costs a draw call for the whole
 * park. The themed shoes are the player's; the crowd gets the plain pair and
 * sandals, which between them add two.
 */
export const CROWD_SHOE_KINDS: readonly ShoeKind[] = ['plain', 'sandal'];

// -----------------------------------------------------------------------------
// Geometry. All of it is cut from the foot's own ellipsoid, so a part hugs by
// construction rather than being positioned by eye against a shape that may
// since have changed — the lesson `hoodShell.ts` records from the hair tufts.
// -----------------------------------------------------------------------------

/** A point on the foot's surface, scaled, and its outward normal. */
function footSurface(
  scale: number,
  theta: number,
  phi: number,
): { point: Vector3; normal: Vector3 } {
  const a = FOOT.x * scale;
  const b = FOOT.y * scale;
  const c = FOOT.z * scale;
  const point = new Vector3(
    a * Math.sin(theta) * Math.cos(phi),
    b * Math.cos(theta),
    c * Math.sin(theta) * Math.sin(phi),
  );
  const normal = new Vector3(
    point.x / (a * a),
    point.y / (b * b),
    point.z / (c * c),
  ).normalize();
  return { point, normal };
}

function build(positions: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Quads over a (u, v) grid. */
function grid(indices: number[], nu: number, nv: number, base = 0, flip = false): void {
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = base + j * (nu + 1) + i;
      const b = base + (j + 1) * (nu + 1) + i;
      const c = base + (j + 1) * (nu + 1) + i + 1;
      const d = base + j * (nu + 1) + i + 1;
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
}

/**
 * The sole: the bottom of the foot's own ellipsoid, grown a little.
 *
 * A slab under the foot would leave a straight edge against a round foot and a
 * gap at the toe. Taking the foot's own bottom means the sole wraps up the
 * sides exactly as far as `yHi` says and no further.
 */
export function shoeSoleGeometry(scale = 1.03, yHi = -0.34, seg = 30, rings = 12): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const t0 = Math.acos(Math.max(-1, Math.min(1, yHi)));
  const t1 = Math.PI;
  for (let j = 0; j <= rings; j += 1) {
    const theta = t0 + (t1 - t0) * (j / rings);
    for (let i = 0; i <= seg; i += 1) {
      const { point } = footSurface(scale, theta, (i / seg) * TAU);
      positions.push(point.x, point.y, point.z);
    }
  }
  grid(indices, seg, rings);
  return build(positions, indices);
}

/**
 * The toe cap.
 *
 * Its back rim turns **inward** to a ring tucked inside the foot before it
 * closes. Closing it with a fan straight to the axis instead puts a cone across
 * the foot's own surface, and the intersection shows as a row of notches all
 * round the rim — visible in the first render of the RiPika shoe.
 */
export function shoeToeCapGeometry(
  zCut: number,
  scale = 1.03,
  seg = 30,
  rings = 12,
  inner = 0.955,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const c = FOOT.z * scale;
  const zt = zCut / c;
  for (let j = 0; j <= rings; j += 1) {
    const s = Math.acos(Math.max(-1, Math.min(1, 1 - (j / rings) * (1 - zt))));
    for (let i = 0; i <= seg; i += 1) {
      const phi = (i / seg) * TAU;
      positions.push(
        FOOT.x * scale * Math.sin(s) * Math.cos(phi),
        FOOT.y * scale * Math.sin(s) * Math.sin(phi),
        c * Math.cos(s),
      );
    }
  }
  grid(indices, seg, rings);

  const rim = rings * (seg + 1);
  const si = Math.acos(Math.max(-1, Math.min(1, zCut / (FOOT.z * inner))));
  const start = positions.length / 3;
  for (let i = 0; i <= seg; i += 1) {
    const phi = (i / seg) * TAU;
    positions.push(
      FOOT.x * inner * Math.sin(si) * Math.cos(phi),
      FOOT.y * inner * Math.sin(si) * Math.sin(phi),
      zCut,
    );
  }
  for (let i = 0; i < seg; i += 1) {
    indices.push(rim + i, start + i, start + i + 1, rim + i, start + i + 1, rim + i + 1);
  }
  const apex = positions.length / 3;
  positions.push(0, 0, zCut - 0.02);
  for (let i = 0; i < seg; i += 1) indices.push(start + i, apex, start + i + 1);
  return build(positions, indices);
}

/**
 * A strap, as a swept ribbon with a rounded cross-section.
 *
 * Swept as a **tube**, not as a rectangle laid on the surface. The rectangular
 * version was tried first and reads as a strip of tape stuck to the foot: it
 * presents a flat outer face, and its ends are open where they stop. A rounded
 * section has no flat face, and `arc` past 1 carries the ends under the widest
 * point of the foot where the sole hides them.
 */
export function shoeStrapGeometry(
  z0: number,
  z1: number,
  thick: number,
  arc = 1.22,
  seg = 30,
  ring = 10,
): BufferGeometry {
  const halfW = (z1 - z0) * 0.5;
  const zc = (z0 + z1) * 0.5;
  const positions: number[] = [];
  const indices: number[] = [];
  const across = Math.sqrt(Math.max(0, 1 - (zc / FOOT.z) ** 2));
  for (let i = 0; i <= seg; i += 1) {
    const angle = (-1 + (2 * i) / seg) * arc * (Math.PI / 2);
    const x = FOOT.x * across * Math.sin(angle);
    const y = FOOT.y * across * Math.cos(angle);
    let nx = x / (FOOT.x * FOOT.x);
    let ny = y / (FOOT.y * FOOT.y);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const cx = x + nx * thick * 0.35;
    const cy = y + ny * thick * 0.35;
    for (let m = 0; m < ring; m += 1) {
      const a = (m / ring) * TAU;
      positions.push(
        cx + nx * Math.cos(a) * thick,
        cy + ny * Math.cos(a) * thick,
        zc + Math.sin(a) * halfW,
      );
    }
  }
  for (let i = 0; i < seg; i += 1) {
    for (let m = 0; m < ring; m += 1) {
      const m2 = (m + 1) % ring;
      const a = i * ring + m;
      const b = (i + 1) * ring + m;
      const c = (i + 1) * ring + m2;
      const d = i * ring + m2;
      indices.push(a, b, c, a, c, d);
    }
  }
  for (const [idx, flip] of [
    [0, false],
    [seg, true],
  ] as const) {
    const centre = positions.length / 3;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let m = 0; m < ring; m += 1) {
      sx += positions[(idx * ring + m) * 3] as number;
      sy += positions[(idx * ring + m) * 3 + 1] as number;
      sz += positions[(idx * ring + m) * 3 + 2] as number;
    }
    positions.push(sx / ring, sy / ring, sz / ring);
    for (let m = 0; m < ring; m += 1) {
      const m2 = (m + 1) % ring;
      if (flip) indices.push(centre, idx * ring + m, idx * ring + m2);
      else indices.push(centre, idx * ring + m2, idx * ring + m);
    }
  }
  return build(positions, indices);
}

/** The heel counter: a walled patch of the foot's own surface, round the back. */
export function shoeHeelGeometry(
  theta0: number,
  theta1: number,
  phi0: number,
  phi1: number,
  thick: number,
  scale = 1.035,
  nu = 26,
  nv = 12,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const shell of [0, 1]) {
    for (let j = 0; j <= nv; j += 1) {
      const theta = theta0 + (theta1 - theta0) * (j / nv);
      for (let i = 0; i <= nu; i += 1) {
        const { point, normal } = footSurface(scale, theta, phi0 + (phi1 - phi0) * (i / nu));
        const d = shell === 0 ? 0 : -thick;
        positions.push(point.x + normal.x * d, point.y + normal.y * d, point.z + normal.z * d);
      }
    }
  }
  const stride = (nv + 1) * (nu + 1);
  grid(indices, nu, nv);
  grid(indices, nu, nv, stride, true);
  const ix = (s: number, j: number, i: number): number => s * stride + j * (nu + 1) + i;
  for (let i = 0; i < nu; i += 1) {
    indices.push(ix(0, nv, i), ix(1, nv, i + 1), ix(0, nv, i + 1));
    indices.push(ix(0, nv, i), ix(1, nv, i), ix(1, nv, i + 1));
  }
  for (let j = 0; j < nv; j += 1) {
    indices.push(ix(0, j, 0), ix(0, j + 1, 0), ix(1, j + 1, 0));
    indices.push(ix(0, j, 0), ix(1, j + 1, 0), ix(1, j, 0));
    indices.push(ix(0, j, nu), ix(1, j + 1, nu), ix(0, j + 1, nu));
    indices.push(ix(0, j, nu), ix(1, j, nu), ix(1, j + 1, nu));
  }
  return build(positions, indices);
}

/**
 * Mirrors a geometry across x **and flips its winding**.
 *
 * The same function `hoodShell.ts` needed for the cap's ears, and for the same
 * reason: negating x alone turns every triangle inside out, and inside-out toon
 * geometry lights from the wrong side — it comes out looking like it is made of
 * shadow.
 */
function mirrorX(geometry: BufferGeometry): BufferGeometry {
  const mirrored = geometry.clone();
  const position = mirrored.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i += 1) position.setX(i, -position.getX(i));
  position.needsUpdate = true;
  const index = mirrored.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  }
  mirrored.computeVertexNormals();
  return mirrored;
}

/** A flattened disc, for one bean of a paw print. */
function beanGeometry(rx: number, ry: number, thick: number, seg = 18): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const zs of [1, -1]) {
    const centre = positions.length / 3;
    positions.push(0, 0, (zs * thick) / 2);
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * TAU;
      positions.push(Math.cos(a) * rx, Math.sin(a) * ry, (zs * thick) / 2);
    }
    for (let i = 0; i < seg; i += 1) {
      const k = (i + 1) % seg;
      if (zs > 0) indices.push(centre, centre + 1 + i, centre + 1 + k);
      else indices.push(centre, centre + 1 + k, centre + 1 + i);
    }
  }
  const top = 1;
  const bottom = seg + 2;
  for (let i = 0; i < seg; i += 1) {
    const k = (i + 1) % seg;
    indices.push(top + i, bottom + i, bottom + k, top + i, bottom + k, top + k);
  }
  return build(positions, indices);
}

/** Lays a flat geometry onto the foot's surface, standing along its normal. */
function onFoot(
  geometry: BufferGeometry,
  theta: number,
  phi: number,
  lift: number,
  offset: [number, number] = [0, 0],
  spin = 0,
): BufferGeometry {
  const { point, normal } = footSurface(1, theta, phi);
  const up = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const t1 = new Vector3().crossVectors(up, normal).normalize();
  const t2 = new Vector3().crossVectors(normal, t1).normalize();
  const origin = point
    .clone()
    .addScaledVector(normal, lift)
    .addScaledVector(t1, offset[0])
    .addScaledVector(t2, offset[1]);
  const basis = new Matrix4().makeBasis(t1, t2, normal).setPosition(origin);
  const spun = geometry.clone().rotateZ(spin);
  spun.applyMatrix4(basis);
  return spun;
}

// -----------------------------------------------------------------------------
// The four pairs.
// -----------------------------------------------------------------------------

/**
 * A RiPika paw print, as four beans.
 *
 * **Appliqué, never sculpted** — the rule the RiPika Cap established, and this
 * is where it earned its keep a second time. A modelled ear tab standing off the
 * ankle was tried first and reads as a stray flap of geometry rather than as a
 * charm, exactly the way a sculpted muzzle turns a hat back into a head. A flat
 * cocoa paw laid on the outer side of the shoe says "RiPika" instantly, from
 * across the park, and cannot catch the light wrongly.
 */
function pawParts(): BufferGeometry[] {
  const pads: [number, number, [number, number]][] = [
    [0.05, 0.038, [0, -0.02]],
    [0.018, 0.018, [-0.04, 0.026]],
    [0.019, 0.019, [0, 0.04]],
    [0.018, 0.018, [0.04, 0.026]],
  ];
  return pads.map(([rx, ry, offset]) => {
    const bean = beanGeometry(rx, ry, 0.009);
    const placed = onFoot(bean, 1.3, 0.12, 0.004, offset);
    bean.dispose();
    return placed;
  });
}

/** The stars on the sparkly pair, spread over the upper by a seeded stratification. */
function sparkleMesh(rng: Rng): InstancedMesh {
  const COUNT = 10;
  const mesh = new InstancedMesh(
    starGeometry(0.05, 0.01),
    new MeshBasicMaterial({ color: ART.shine, toneMapped: false }),
    COUNT,
  );
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const lo = -0.4;
  const hi = Math.PI + 0.2;
  for (let i = 0; i < COUNT; i += 1) {
    // Stratified, not free: ten independently random stars clump, and a clump
    // of stars on a shoe reads as a rash rather than as sparkle.
    const phi = lo + (hi - lo) * ((i + rng.range(0.18, 0.82)) / COUNT);
    const theta = rng.range(0.52, 1.12);
    const { point, normal } = footSurface(1, theta, phi);
    quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
    quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rng.range(0, TAU)));
    const s = rng.range(0.4, 0.58);
    scale.set(s, s, 1);
    matrix.compose(point.clone().addScaledVector(normal, 0.004), quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** One built piece of shoe, and the kinds that show it. */
export interface ShoePart {
  readonly mesh: Object3D;
  readonly kinds: readonly ShoeKind[];
}

export interface ShoeOptions {
  /** The two leg pivots, from `kid.ts`'s `limbs`. A shoe swings with its leg. */
  readonly legs: readonly [Object3D, Object3D];
  /** The foot blob's own material — `setKind` repaints it for sandals. */
  readonly footMaterial: Material & { color: { setHex(hex: number): void } };
  readonly kind: ShoeKind;
  /** Which kinds to build. Defaults to just `kind`. */
  readonly kinds?: readonly ShoeKind[];
}

export interface ShoeRig {
  readonly parts: readonly ShoePart[];
  setKind(kind: ShoeKind): void;
}

/** What colour the bare foot blob is under each kind. */
const FOOT_COLOUR: Readonly<Record<ShoeKind, number | null>> = {
  plain: null, // whatever the child chose, left alone
  ripika: ART.ripikaYellow,
  sandal: PALETTE.skin,
  sparkle: PALETTE.blossomPink,
};

/**
 * Builds the shoes onto the kid's two leg pivots.
 *
 * Only the kinds asked for are built. The character creator rebuilds the whole
 * kid on every swatch tap, and extruding four pairs to hide three of them is
 * the cost `hair.ts` and the backpack rig both went out of their way to avoid.
 */
export function buildShoes(options: ShoeOptions): ShoeRig {
  const wanted = new Set(options.kinds ?? [options.kind]);
  const parts: ShoePart[] = [];
  const rng = new Rng(0x5eed);

  /**
   * Adds one part to **both** legs, as two logical parts that toggle together.
   *
   * `+x` is outward in the foot's frame, so the left shoe is the right one
   * mirrored in x. Neither `scale.x = -1` nor a π turn about Y will do it:
   * negative scale turns every triangle inside out and toon geometry then lights
   * from the wrong side, and a π turn mirrors *forward* along with outward, so
   * the toe cap ends up on the heel. The geometry is mirrored properly —
   * negate x, reverse the winding, recompute the normals — exactly as
   * `hoodShell.ts`'s `mirrorEar` does for the cap's ears.
   */
  const pair = (
    kinds: readonly ShoeKind[],
    make: (side: 1 | -1) => Mesh | InstancedMesh,
    outline?: number,
  ): void => {
    if (!kinds.some((k) => wanted.has(k))) return;
    for (const side of [-1, 1] as const) {
      const mesh = make(side);
      mesh.position.set(FOOT_AT.x, FOOT_AT.y, FOOT_AT.z);
      if (outline !== undefined && mesh instanceof Mesh) addOutline(mesh, outline);
      options.legs[side < 0 ? 0 : 1]?.add(mesh);
      parts.push({ mesh, kinds });
    }
  };

  /** The geometry as the given foot needs it: mirrored in x for the left. */
  const sided = (side: 1 | -1, geometry: BufferGeometry): BufferGeometry =>
    side > 0 ? geometry : mirrorX(geometry);

  // --- the plain pair is the bare foot blob, so it has no parts of its own ---

  // --- RiPika -----------------------------------------------------------------
  const toeCap = shoeToeCapGeometry(0.158);
  pair(['ripika'], (side) =>
    solid(new Mesh(sided(side, toeCap), toonMaterial(ART.ripikaTip))),
  );
  const ripikaSole = shoeSoleGeometry(1.03, -0.36);
  pair(['ripika'], (side) =>
    solid(new Mesh(sided(side, ripikaSole), toonMaterial(ART.ripikaBelly))),
  );
  for (const bean of pawParts()) {
    pair(['ripika'], (side) => decal(new Mesh(sided(side, bean), toonMaterial(ART.ripikaTip))));
  }

  // --- sandal -----------------------------------------------------------------
  const sandalSole = shoeSoleGeometry(1.06, -0.22);
  pair(['sandal'], (side) =>
    solid(new Mesh(sided(side, sandalSole), toonMaterial(ART.cream))),
  );
  const instep = shoeStrapGeometry(0.018, 0.116, 0.019);
  pair(
    ['sandal'],
    (side) => solid(new Mesh(sided(side, instep), options.footMaterial.clone())),
    0.012,
  );
  const heel = shoeHeelGeometry(0.26, 1.52, Math.PI + 0.34, TAU - 0.34, 0.017);
  pair(['sandal'], (side) =>
    solid(new Mesh(sided(side, heel), options.footMaterial.clone())),
  );

  // --- sparkle ----------------------------------------------------------------
  const sparkleSole = shoeSoleGeometry(1.03, -0.3);
  pair(['sparkle'], (side) =>
    solid(new Mesh(sided(side, sparkleSole), toonMaterial(PALETTE.blossomWhite))),
  );
  // Laid flat and lifted in the geometry, not on the mesh: `pair` sets every
  // part's position to the foot's, so an offset written on the mesh is lost.
  const cuff = new TorusGeometry(0.13, 0.034, 8, 24).rotateX(Math.PI / 2).translate(0, 0.1, 0);
  pair(['sparkle'], () =>
    solid(new Mesh(cuff, toonMaterial(PALETTE.stonePinkLight))),
  );
  // The stars are instanced, so they are seeded per foot rather than mirrored —
  // and the two feet want different stars anyway.
  pair(['sparkle'], () => decal(sparkleMesh(rng)));

  const rig: ShoeRig = {
    parts,
    setKind(next: ShoeKind) {
      for (const part of parts) part.mesh.visible = part.kinds.includes(next);
      const colour = FOOT_COLOUR[next];
      if (colour !== null) options.footMaterial.color.setHex(colour);
    },
  };
  rig.setKind(options.kind);
  return rig;
}

/**
 * One shoe, as a standalone asset — for a picker swatch or a shop stand.
 *
 * Origin at the sole, facing `+z`, per the asset contract. It carries a copy of
 * the foot blob, because three of the four kinds are mostly *the foot*: a
 * sandal without one is a sole and a strap floating in the air.
 */
export function createShoe(kind: ShoeKind, colour = ART.kidShoe): AssetHandle {
  const root = new Group();
  root.name = `shoe.${kind}`;

  // `fit` stands in for a leg pivot, because that is the frame every part in
  // this file is authored in: `buildShoes` puts each one at `FOOT_AT`, which is
  // an offset *inside the pivot*, not inside the shoe. Emulating the pivot is
  // what keeps one set of numbers serving both the worn pair and the stand —
  // getting this wrong dropped every part 22 cm below the foot.
  const fit = new Group();
  fit.position.set(0, -FOOT_AT.y + FOOT.y, -FOOT_AT.z);
  root.add(fit);

  const footColour = FOOT_COLOUR[kind] ?? colour;
  const footMaterial = toonMaterial(footColour);
  const foot = blob(0.175, footMaterial, [1, 0.78, 1.28], 18);
  foot.position.set(FOOT_AT.x, FOOT_AT.y, FOOT_AT.z);
  fit.add(foot);
  addOutline(foot, 0.014);

  // `buildShoes` always builds a pair. A stand wants one shoe, so the left leg
  // it is handed is a group that is never parented to anything — the left shoe
  // is built, then dropped on the floor of the scene graph and collected.
  const discard = new Group();
  buildShoes({ legs: [discard, fit], footMaterial, kind });

  return { root, height: visibleTop(root) };
}
