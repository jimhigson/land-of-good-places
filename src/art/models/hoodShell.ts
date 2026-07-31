import { BufferAttribute, BufferGeometry } from 'three';
import { TAU } from '../style/bridge';

/**
 * The hood shell — the surface every critter hat in this park is cut out of.
 *
 * ## Why this file exists
 *
 * The two animal hats used to be the *creature itself*, shrunk and perched on
 * the wearer's crown: `hats.ts` called `buildRipikaHead()` and
 * `createPuffCreature()` and moved the result up. That is not a hat, it is a
 * second head, and the family read it as uncanny rather than cute — you were
 * wearing a tiny live animal.
 *
 * What a child actually wears is a **character cap**: a crown with panel
 * seams, a peak, a band, sewn-on ears and the animal's face appliquéd onto the
 * front. We studied a real one (a Pikachu snapback) purely for how the *object*
 * works, and three things about it are load-bearing and are why this file has
 * the shape it does:
 *
 * 1. **The face lives on the crown's front wall, entirely above the peak.**
 *    The peak is a separate plane below it. That single relationship is what
 *    makes a character cap read as a hat instead of a head.
 * 2. **The ears are sewn to the top-back of the crown**, placed for silhouette
 *    rather than anatomy, and they lean outward.
 * 3. **Nothing is sculpted.** The face is flat appliqué; the ears are flat
 *    plush paddles. A modelled muzzle immediately reads as a head again.
 *
 * None of that is reachable with squashed spheres. A cap crown is a continuous
 * shell whose **hem varies with azimuth** — high at the brow so the face has a
 * wall to sit on, level at the sides so the band grips, and (for a bonnet)
 * dropping into earflaps beside the wearer's ears. So, exactly as with
 * `hairShell.ts` and under the same ART_DIRECTION.md §7 ruling, the surface was
 * modelled in Blender against a reference build of the real kid — the real
 * skull, the real hat anchor, the eye line — and looked at from the front, the
 * side, the back and the game's own 38° camera until it read as a hat. What is
 * ported here is the surface's *definition*, not a mesh dump: the game still
 * builds every vertex at runtime, so `check:assets`, `check:hat-fit` and the
 * shop's display stands keep working in node with no asset pipeline.
 *
 * ## What the surface is
 *
 * A closed two-skinned shell: an ellipsoidal dome above the equator, a
 * near-cylindrical band below it, and a **hem** whose height is a function of
 * azimuth. That one idea gives both hats:
 *
 * - a hem that is high at the front and level round the sides is a **cap**;
 * - a hem that dives into a deep lobe at ±90° is a **bonnet with earflaps**.
 *
 * Because it is one surface, the crown cannot come apart from the band, and a
 * flap cannot float away from the hood.
 *
 * ## Frames and units
 *
 * Everything here is in **head units**, the same units `hats.ts` authors in:
 * the origin is the hat anchor (the crown of the skull) and `hats.ts`'s `fit`
 * group multiplies by `KID_HEAD_SCALE` to get metres. A hood is only ever the
 * right size relative to the head under it, so this is the unit that matters.
 * Forward is `+Z`, so the front of a hood is azimuth `φ = π`.
 */

/** Hem samples run from the back of the hood to dead front, and are mirrored. */
export const HEM_SAMPLES = 13;

export interface HoodShellSpec {
  /**
   * Hem height at each of {@link HEM_SAMPLES} azimuths, from the **back**
   * (index 0) round to dead **front** (index 12), in 15° steps. Mirrored, so a
   * hood is symmetric apart from the things hung on it.
   */
  readonly hem: readonly number[];
  /** Widest radius, at the equator. */
  readonly shellR: number;
  /** The dome's vertical semi-axis. Also where the crown button sits. */
  readonly semiY: number;
  /**
   * The *lower* semi-axis — how fast the shell draws in below the equator.
   * Large means a near-vertical band (a cap); small means a ball.
   */
  readonly semiLow: number;
  /** Front-to-back stretch. A cap is a whisker deeper than it is wide. */
  readonly depth: number;
  /** Shell wall thickness, so the hem has an edge rather than being paper. */
  readonly thick: number;
  /**
   * How far the sides bell out below the equator, as a fraction of the radius.
   *
   * **Not cosmetic.** An earflap has to hang *past* the skull, and the skull is
   * still 0.43 wide at the depth a flap reaches; without this the flap goes
   * straight through the wearer's head. Zero for the cap, which never gets
   * that low.
   */
  readonly flareSide: number;
  /** Over what drop the side flare reaches full. */
  readonly flareSpan: number;
  /** How many panels the crown is sewn from. */
  readonly panels: number;
  /** Panel-seam relief, as a fraction of the radius. */
  readonly seamR: number;
  readonly segments: number;
  readonly rings: number;
}

/** Everything a hood does not care about. */
export const HOOD_SHELL_DEFAULTS = {
  shellR: 0.4,
  semiY: 0.32,
  semiLow: 0.8,
  depth: 1.0,
  thick: 0.05,
  flareSide: 0,
  flareSpan: 0.3,
  panels: 6,
  seamR: 0.018,
  segments: 48,
  rings: 18,
} as const satisfies Omit<HoodShellSpec, 'hem'>;

/**
 * The top of the shell is a **shared dome**: the first {@link CAP_SPLIT} of the
 * rings run from the crown down to the handover height at every azimuth alike,
 * and only below that does each azimuth head for its own hem.
 *
 * Same reason `hairShell.ts` has it: spacing rings by each azimuth's own drop
 * puts the first ring 0.36 below the crown at a bonnet's flap and 0.02 below it
 * at the brow, and the fan of triangles round the pole folds back on itself.
 * The handover is clamped above every hem so it stays monotonic.
 */
const CAP_SPLIT = 0.3;
const CAP_Y = 0.35;

/** Azimuth folded into ±π. The hem table is one side; the other is mirrored. */
function fold(phi: number): number {
  return (((phi + Math.PI) % TAU) + TAU) % TAU - Math.PI;
}

/** Catmull–Rom through the hem table, so a hood is thirteen numbers. */
function hemAt(hem: readonly number[], phi: number): number {
  const last = hem.length - 1;
  const a = (Math.abs(fold(phi)) / Math.PI) * last;
  const i = Math.min(Math.floor(a), last - 1);
  const t = a - i;
  const at = (k: number): number => hem[Math.min(Math.max(k, 0), last)] as number;
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

/**
 * The surface itself: how wide the shell is at a height and azimuth, and where
 * a point on it ends up.
 *
 * Shared so that everything worn **on** a hood — the peak, the hem roll, the
 * face patch, a bib — is placed on the real surface rather than at hand-picked
 * coordinates. `hairShell.ts` learned that one the hard way: half of the messy
 * tufts on `main` were floating in mid-air because they were placed by eye
 * against a shell that had since changed shape.
 */
export function hoodShellSampler(spec: HoodShellSpec) {
  const { shellR, semiY, semiLow, depth, flareSide, flareSpan } = spec;

  const radiusAt = (y: number, phi = 0): number => {
    if (y >= 0) {
      const q = Math.min(y / semiY, 1);
      return shellR * Math.sqrt(Math.max(0, 1 - q * q));
    }
    const q = Math.min(-y / semiLow, 1);
    let r = shellR * Math.sqrt(Math.max(0, 1 - q * q));
    if (flareSide > 0) {
      const s = Math.sin(phi);
      r *= 1 + flareSide * s * s * Math.min(1, -y / flareSpan);
    }
    return r;
  };

  /** A point on the outer skin, at an azimuth and height. */
  const surface = (phi: number, y: number): [number, number, number] => {
    const r = radiusAt(y, phi);
    return [r * Math.sin(phi), y, -r * Math.cos(phi) * depth];
  };

  return { radiusAt, surface, hem: (phi: number) => hemAt(spec.hem, phi) };
}

/** One hood's shell. Origin is the hat anchor; head units throughout. */
export function hoodShellGeometry(spec: HoodShellSpec): BufferGeometry {
  const { depth, thick, panels, seamR, segments, rings } = spec;
  const { radiusAt } = hoodShellSampler(spec);
  const handover = Math.max(CAP_Y * spec.semiY, ...spec.hem);

  const positions: number[] = [];
  const indices: number[] = [];

  // Two poles, not one shared vertex: the outer and inner skins meet there and
  // averaging their normals puts a pinprick of the wrong shade on the button.
  positions.push(0, spec.semiY, 0);
  positions.push(0, spec.semiY - thick * 0.3, 0);
  const OUTER_POLE = 0;
  const INNER_POLE = 1;
  const FIRST = 2;

  for (let i = 0; i < segments; i += 1) {
    const phi = (i / segments) * TAU;
    const bottom = hemAt(spec.hem, phi);
    const seam = Math.cos(panels * phi);
    for (let j = 1; j <= rings; j += 1) {
      const s = j / rings;
      const y =
        s <= CAP_SPLIT
          ? spec.semiY + (handover - spec.semiY) * (s / CAP_SPLIT)
          : handover + (bottom - handover) * ((s - CAP_SPLIT) / (1 - CAP_SPLIT));
      const amp = seamR * Math.min(1, s / 0.35);
      const r = radiusAt(y, phi) * (1 + amp * seam);
      // The profile's own normal in the (r, y) plane, by finite difference, so
      // the inner skin keeps an even wall thickness on the dome and the band
      // alike.
      const d = 0.005;
      const dr = (radiusAt(y + d, phi) - radiusAt(y - d, phi)) / (2 * d);
      const n = Math.hypot(1, dr);
      const wall = thick * (0.35 + 0.65 * Math.min(1, s / 0.3));
      positions.push(r * Math.sin(phi), y, -r * Math.cos(phi) * depth);
      const ri = r - wall / n;
      positions.push(ri * Math.sin(phi), y + (wall * dr) / n, -ri * Math.cos(phi) * depth);
    }
  }

  const vertex = (i: number, j: number, inner: boolean): number =>
    FIRST + (i * rings + (j - 1)) * 2 + (inner ? 1 : 0);

  for (let i = 0; i < segments; i += 1) {
    const k = (i + 1) % segments;
    indices.push(OUTER_POLE, vertex(k, 1, false), vertex(i, 1, false));
    indices.push(INNER_POLE, vertex(i, 1, true), vertex(k, 1, true));
    for (let j = 1; j < rings; j += 1) {
      const a = vertex(i, j, false);
      const b = vertex(i, j + 1, false);
      const c = vertex(k, j + 1, false);
      const d = vertex(k, j, false);
      indices.push(a, c, b, a, d, c);
      const e = vertex(i, j, true);
      const f = vertex(i, j + 1, true);
      const g = vertex(k, j + 1, true);
      const h = vertex(k, j, true);
      indices.push(e, f, g, e, g, h);
    }
    // The hem rim, joining the two skins. A hood is a painted wooden toy, not a
    // sheet of paper: the edge has to have a width.
    const o = vertex(i, rings, false);
    const oi = vertex(i, rings, true);
    const p = vertex(k, rings, false);
    const pi = vertex(k, rings, true);
    indices.push(o, pi, oi, o, p, pi);
  }

  return finish(positions, indices);
}

export interface HoodPeakSpec {
  /** Where the peak springs from, in the hood's frame. */
  readonly y: number;
  /** How far forward it reaches past the crown. */
  readonly length: number;
  /** How far round the hood it is sewn, in radians either side of front. */
  readonly arc: number;
  /** How far its tip dips below its root. */
  readonly drop: number;
  readonly thick: number;
  /** A little outward splay towards the tip, as a fraction. */
  readonly spread: number;
  /** How far inside the crown the peak's root is buried, as a fraction. */
  readonly inset: number;
}

/**
 * The peak.
 *
 * It projects **forward**, not radially. The obvious sweep — take the hem and
 * push every point out along its own radius — produces a sombrero: at ±60° off
 * the front the brim sticks straight out sideways and the hat ends up wider
 * than the child. A real peak reaches furthest at the centre and tapers to
 * nothing where it meets the crown, which is what `sqrt(1 - u²)` below is.
 *
 * Its root is buried `inset` inside the crown rather than sitting flush: flush
 * puts two coplanar surfaces together and leaves a z-fighting notch along the
 * whole join.
 */
export function hoodPeakGeometry(spec: HoodShellSpec, peak: HoodPeakSpec): BufferGeometry {
  const { radiusAt } = hoodShellSampler(spec);
  const rb = radiusAt(peak.y, 0) * peak.inset;
  const nu = 26;
  const nv = 7;
  const positions: number[] = [];
  const indices: number[] = [];

  const at = (u: number, v: number, dy: number): [number, number, number] => {
    const a = u * peak.arc;
    const proj = peak.length * Math.sqrt(Math.max(0, 1 - u * u));
    return [
      -rb * Math.sin(a) * (1 + peak.spread * v),
      peak.y - peak.drop * v * v + dy,
      rb * Math.cos(a) * spec.depth + proj * v,
    ];
  };

  for (const dy of [0, -peak.thick]) {
    for (let j = 0; j <= nv; j += 1) {
      for (let i = 0; i <= nu; i += 1) {
        positions.push(...at(-1 + (2 * i) / nu, j / nv, dy));
      }
    }
  }
  const stride = (nv + 1) * (nu + 1);
  const ix = (skin: number, j: number, i: number): number => skin * stride + j * (nu + 1) + i;
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      indices.push(ix(0, j, i), ix(0, j + 1, i), ix(0, j + 1, i + 1));
      indices.push(ix(0, j, i), ix(0, j + 1, i + 1), ix(0, j, i + 1));
      indices.push(ix(1, j, i), ix(1, j + 1, i + 1), ix(1, j + 1, i));
      indices.push(ix(1, j, i), ix(1, j, i + 1), ix(1, j + 1, i + 1));
    }
  }
  // The rims: the tip, and the root where it disappears into the crown.
  for (let i = 0; i < nu; i += 1) {
    indices.push(ix(0, nv, i), ix(1, nv, i + 1), ix(0, nv, i + 1));
    indices.push(ix(0, nv, i), ix(1, nv, i), ix(1, nv, i + 1));
    indices.push(ix(0, 0, i), ix(0, 0, i + 1), ix(1, 0, i + 1));
    indices.push(ix(0, 0, i), ix(1, 0, i + 1), ix(1, 0, i));
  }
  return finish(positions, indices);
}

/** The peak's lining — the same surface again, a whisker under it. */
export function hoodPeakLiningGeometry(
  spec: HoodShellSpec,
  peak: HoodPeakSpec,
): BufferGeometry {
  const { radiusAt } = hoodShellSampler(spec);
  const rb = radiusAt(peak.y, 0) * peak.inset;
  const nu = 26;
  const nv = 7;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= nv; j += 1) {
    const v = j / nv;
    for (let i = 0; i <= nu; i += 1) {
      const u = -1 + (2 * i) / nu;
      const a = u * peak.arc;
      const proj = peak.length * Math.sqrt(Math.max(0, 1 - u * u));
      positions.push(
        -rb * Math.sin(a) * (1 + peak.spread * v) * 0.985,
        peak.y - peak.drop * v * v - peak.thick - 0.005,
        (rb * Math.cos(a) * spec.depth + proj * v) * 0.985,
      );
    }
  }
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      const b = (j + 1) * (nu + 1) + i;
      const c = (j + 1) * (nu + 1) + i + 1;
      const d = j * (nu + 1) + i + 1;
      indices.push(a, c, b, a, d, c);
    }
  }
  return finish(positions, indices);
}

/**
 * The hem roll — the cap's band, swept along the hood's own hem.
 *
 * A tube rather than a painted stripe, because it is the one part of a hat that
 * has to read from **behind**: the peak and the face say "hat" from the front,
 * and without this the back of a hood is an undifferentiated dome.
 */
export function hoodHemRollGeometry(spec: HoodShellSpec, roll: number): BufferGeometry {
  const { radiusAt, hem } = hoodShellSampler(spec);
  const segments = spec.segments;
  const ring = 10;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const phi = (i / segments) * TAU;
    const y = hem(phi) + roll * 0.35;
    const r = radiusAt(y, phi) - roll * 0.45;
    const cx = r * Math.sin(phi);
    const cz = -r * Math.cos(phi) * spec.depth;
    const nx = Math.sin(phi);
    const nz = -Math.cos(phi);
    for (let m = 0; m < ring; m += 1) {
      const th = (m / ring) * TAU;
      positions.push(
        cx + nx * Math.cos(th) * roll,
        y + Math.sin(th) * roll,
        cz + nz * Math.cos(th) * roll,
      );
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const k = (i + 1) % segments;
    for (let m = 0; m < ring; m += 1) {
      const m2 = (m + 1) % ring;
      indices.push(i * ring + m, k * ring + m, k * ring + m2);
      indices.push(i * ring + m, k * ring + m2, i * ring + m2);
    }
  }
  return finish(positions, indices);
}

export interface HoodPatchSpec {
  /** Half-width of the window, in radians either side of the front. */
  readonly halfX: number;
  /** Bottom and top of the window, in the hood's frame. */
  readonly yLo: number;
  readonly yHi: number;
  /** How far the patch stands off the shell. */
  readonly lift: number;
}

/**
 * The face patch: a UV-mapped window of the hood's **own** surface.
 *
 * Not `createFacePatch`'s spherical shell. That patch is a sector of a sphere,
 * and a hood is an ellipsoid with a flared band — a sphere big enough to touch
 * the brow stands 25 mm proud of the crown by the time it reaches the eyes, so
 * the face floats off the top of the hat. Cutting the window out of the hood
 * itself hugs by construction, and it costs the same one draw call.
 *
 * `u` runs left→right across the wearer's view (so `phi = π − (u−½)·2·halfX`,
 * because +x is screen right and `sin` runs the other way), `v` runs bottom→top
 * to match a `CanvasTexture`'s default `flipY`.
 */
export function hoodPatchGeometry(spec: HoodShellSpec, patch: HoodPatchSpec): BufferGeometry {
  const { surface } = hoodShellSampler(spec);
  const nu = 28;
  const nv = 20;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= nv; j += 1) {
    const v = j / nv;
    const y = patch.yLo + (patch.yHi - patch.yLo) * v;
    for (let i = 0; i <= nu; i += 1) {
      const u = i / nu;
      const phi = Math.PI - (u - 0.5) * 2 * patch.halfX;
      const [px, py, pz] = surface(phi, y);
      // The true surface normal, including the profile's slope — pushing along
      // the horizontal radius alone buries the top of the patch in the dome.
      const d = 0.004;
      const [ax, ay, az] = surface(phi, y - d);
      const [bx, by, bz] = surface(phi, y + d);
      const tl = Math.hypot(bx - ax, by - ay, bz - az) || 1;
      const tx = (bx - ax) / tl;
      const ty = (by - ay) / tl;
      const tz = (bz - az) / tl;
      const hl = Math.hypot(px, pz) || 1;
      let nx = px / hl;
      let ny = 0;
      let nz = pz / hl;
      const dot = nx * tx + ny * ty + nz * tz;
      nx -= tx * dot;
      ny -= ty * dot;
      nz -= tz * dot;
      const nl = Math.hypot(nx, ny, nz) || 1;
      positions.push(
        px + (nx / nl) * patch.lift,
        py + (ny / nl) * patch.lift,
        pz + (nz / nl) * patch.lift,
      );
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      const b = (j + 1) * (nu + 1) + i;
      const c = (j + 1) * (nu + 1) + i + 1;
      const d = j * (nu + 1) + i + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = finish(positions, indices);
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  return geometry;
}

/**
 * A sewn-on patch of pale fabric — the bonnet's bib.
 *
 * Same window as {@link hoodPatchGeometry}, but its width tapers away at the
 * top and bottom so the outline is a rounded lozenge. A rectangle of a second
 * colour reads as a rendering seam; a lozenge reads as something someone sewed
 * on.
 */
export function hoodBibGeometry(spec: HoodShellSpec, patch: HoodPatchSpec): BufferGeometry {
  const { surface } = hoodShellSampler(spec);
  const nu = 26;
  const nv = 16;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= nv; j += 1) {
    const v = j / nv;
    const y = patch.yLo + (patch.yHi - patch.yLo) * v;
    const taper = 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - ((2 * v - 1) * 0.92) ** 2));
    for (let i = 0; i <= nu; i += 1) {
      const u = i / nu;
      const phi = Math.PI - (u - 0.5) * 2 * patch.halfX * taper;
      const [px, py, pz] = surface(phi, y);
      const hl = Math.hypot(px, pz) || 1;
      positions.push(px * (1 + patch.lift / hl), py, pz * (1 + patch.lift / hl));
    }
  }
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      const b = (j + 1) * (nu + 1) + i;
      const c = (j + 1) * (nu + 1) + i + 1;
      const d = j * (nu + 1) + i + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  return finish(positions, indices);
}

export interface PlushEarSpec {
  /** Half-width at the base. */
  readonly base: number;
  readonly length: number;
  /** Depth as a fraction of width. Below 1 the ear is a flattened paddle. */
  readonly flat: number;
  /** How far the ear bends over its length, in radians. Bends outward. */
  readonly curve: number;
  /** How much narrower the tip is than the base, 0–1. */
  readonly taper: number;
  /** Where along the ear the contrast tip starts, 0–1. */
  readonly split: number;
}

/**
 * A sewn plush ear, as two geometries: the shaft and its contrast tip.
 *
 * Swept along a **curving** axis rather than built from a cone, for two
 * reasons. A cone has a needle point and sharp is never cute
 * (ART_DIRECTION.md §4); and a real sewn ear flops — the curve is what stops
 * two of these reading as antennae. It is also deliberately *flatter* than the
 * creature's own round ear: this is appliqué, not anatomy, and the flattening
 * is most of what distinguishes a hat's ear from a head's.
 *
 * Authored in its own frame — up is `+y`, the bend goes towards `+x` — for the
 * caller to rotate and place. Mirror the left one by negating `x` and flipping
 * the winding, which {@link mirrorEar} does.
 */
export function plushEarGeometry(ear: PlushEarSpec): {
  shaft: BufferGeometry;
  tip: BufferGeometry;
} {
  const steps = 16;
  const ring = 14;
  const radius = (t: number): number => {
    const r = ear.base * (1 - ear.taper * t);
    // A rounded end rather than a flat cut. The cap starts late so the ear is
    // still fat almost all the way up.
    return t > 0.86 ? r * Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2)) : r;
  };

  const axis: [number, number][] = [];
  const dirs: [number, number][] = [];
  let px = 0;
  let py = 0;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const a = ear.curve * t * t;
    axis.push([px, py]);
    dirs.push([Math.sin(a), Math.cos(a)]);
    px += Math.sin(a) * (ear.length / steps);
    py += Math.cos(a) * (ear.length / steps);
  }

  const ringAt = (k: number): number[] => {
    const t = k / steps;
    const r = radius(t);
    const [dx, dy] = dirs[k] as [number, number];
    const [cx, cy] = axis[k] as [number, number];
    const out: number[] = [];
    for (let m = 0; m < ring; m += 1) {
      const th = (m / ring) * TAU;
      out.push(cx + dy * Math.cos(th) * r, cy - dx * Math.cos(th) * r, Math.sin(th) * r * ear.flat);
    }
    return out;
  };

  const build = (k0: number, k1: number): BufferGeometry => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let k = k0; k <= k1; k += 1) positions.push(...ringAt(k));
    const n = k1 - k0;
    for (let k = 0; k < n; k += 1) {
      for (let m = 0; m < ring; m += 1) {
        const m2 = (m + 1) % ring;
        const a = k * ring + m;
        const b = (k + 1) * ring + m;
        const c = (k + 1) * ring + m2;
        const d = k * ring + m2;
        indices.push(a, b, c, a, c, d);
      }
    }
    const [sx, sy] = axis[k0] as [number, number];
    const start = positions.length / 3;
    positions.push(sx, sy, 0);
    for (let m = 0; m < ring; m += 1) indices.push(start, (m + 1) % ring, m);
    const [ex, ey] = axis[k1] as [number, number];
    const end = positions.length / 3;
    positions.push(ex, ey, 0);
    for (let m = 0; m < ring; m += 1) indices.push(end, n * ring + m, n * ring + ((m + 1) % ring));
    return finish(positions, indices);
  };

  const split = Math.round(ear.split * steps);
  return { shaft: build(0, split), tip: build(split, steps) };
}

/**
 * Mirrors a geometry across X **and flips its winding**.
 *
 * Negating x alone turns every triangle inside out, and inside-out toon
 * geometry lights from the wrong side — the first pair of ears built this way
 * came out looking like they were made of shadow.
 */
export function mirrorEar(geometry: BufferGeometry): BufferGeometry {
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

function finish(positions: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// -----------------------------------------------------------------------------
// The two hoods, as hem tables.
//
// Every number is a height in head units in the hood's frame — zero is the hat
// anchor, the crown of the wearer's skull — sampled every 15° from the back of
// the hood round to dead front. Read a row left to right and you are walking
// the hem from the nape to the middle of the brow.
//
// Two heights are load-bearing and were measured off the reference kid in the
// Blender build rather than picked:
//
//  - the **top of the eyes** is 0.28 below the anchor (−0.42 m). Every peak
//    here clears it by at least 0.15, which is the fix for "the peak sits too
//    low"; the front hem is deliberately much higher than the side hem so the
//    peak springs from a brow line rather than from the band.
//  - the **skull is still 0.43 wide** 0.34 below the anchor, which is where
//    the bonnet's earflaps reach. That is what `flareSide` is for.
// -----------------------------------------------------------------------------

/**
 * RiPika's cap: a neat six-panel plush snapback. Level round the sides so the
 * band grips, rising to a high brow that carries the face and the peak.
 */
export const RIPIKA_HOOD: HoodShellSpec = {
  ...HOOD_SHELL_DEFAULTS,
  shellR: 0.385,
  semiY: 0.335,
  semiLow: 0.66,
  depth: 1.04,
  panels: 6,
  seamR: 0.02,
  segments: 48,
  rings: 16,
  hem: [
    -0.2, -0.2, -0.198, -0.196, -0.193, -0.19, -0.186, -0.18, -0.172, -0.163, -0.155, -0.149,
    -0.147,
  ],
};

/**
 * Trilla's bonnet: rounder, softer and lower than the cap, with a deep lobe at
 * ±90° that hangs beside the wearer's ears. Trilla has no ears of its own, so
 * the flaps are what carry the silhouette — and they are the reason this
 * surface is parametric rather than a stack of blobs.
 */
export const TRILLA_HOOD: HoodShellSpec = {
  ...HOOD_SHELL_DEFAULTS,
  shellR: 0.42,
  semiY: 0.3,
  semiLow: 0.95,
  depth: 1.0,
  flareSide: 0.19,
  flareSpan: 0.28,
  panels: 8,
  seamR: 0.01,
  segments: 52,
  rings: 22,
  hem: [
    -0.222, -0.23, -0.248, -0.276, -0.318, -0.352, -0.362, -0.33, -0.262, -0.2, -0.166, -0.146,
    -0.14,
  ],
};

export const RIPIKA_PEAK: HoodPeakSpec = {
  y: -0.086,
  length: 0.145,
  arc: 1.05,
  drop: 0.055,
  thick: 0.038,
  spread: 0.1,
  inset: 0.9,
};

export const TRILLA_PEAK: HoodPeakSpec = {
  y: -0.128,
  length: 0.115,
  arc: 0.8,
  drop: 0.038,
  thick: 0.034,
  spread: 0.1,
  inset: 0.88,
};
