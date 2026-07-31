import { BufferAttribute, BufferGeometry } from 'three';
import { TAU, smoothstep } from '../style/bridge';

/**
 * The hair shell — the one organic surface every hairstyle in this game is cut
 * out of.
 *
 * ## Why this file exists at all
 *
 * Hair was the first thing in this park that primitive composition could not
 * reach. Everything else here is a squashed sphere or a capsule and looks
 * *better* for it; hair is a continuous fall with a silhouette that has to
 * wrap a skull, clear a backpack and frame two enormous eyes, and stacking
 * blobs to approximate that produced, in the family's own words, "long
 * sideburns on a mullet". Two attempts fixed the gaps and neither fixed the
 * reading. ART_DIRECTION.md §7's 31 July ruling is the outcome: organic
 * continuous forms are modelled in Blender.
 *
 * So this surface **was** modelled in Blender, against a reference build of the
 * real kid — the real skull, ears, face-patch landmarks, backpack, shoulders
 * and the arc the hands swing through — and looked at from the front, the side,
 * the back and the game's own 38° camera until it read as hair. What came back
 * is not a mesh dump: it is this surface's *definition*, ported by hand. The
 * game still builds every vertex at runtime, which is what keeps
 * `check:assets`, `check:hat-fit` and `check:hair` able to build a real kid in
 * node with no asset pipeline, keeps the NPC crowd able to read a prototype
 * synchronously, and keeps the character creator's rebuild-per-tap free. See
 * the PR for the full trade-off.
 *
 * ## What the surface is
 *
 * A closed shell swept round the head: a dome at the top that flows into a
 * fall, with a **hem** — the hairline — whose height varies with azimuth. That
 * one idea is the whole file, and it is why seven very different silhouettes
 * come out of it by changing a table of nineteen numbers:
 *
 * - a hem that stays high all round is a crop;
 * - a hem level at the ears with a step up at the temples is a bowl cut;
 * - a hem at the jaw is a bob;
 * - a hem at the nape that drops past the shoulders is long hair.
 *
 * Because it is one surface, **a gap is not expressible**. The failure the
 * family reported twice cannot come back: there is nothing to disconnect.
 *
 * ## Frames and units
 *
 * Authored in the kid's **drape** frame — the head pivot at the origin, axes
 * un-tilted, metres, `+Z` forward — the same frame `hair.ts` already builds its
 * hanging styles in.
 *
 * Radial numbers ({@link HairShellSpec.shell}, `semiY`, `thick`) are in **skull
 * radii**, so a head retune carries the shell with it exactly as `× HEAD`
 * carries the rest of the head group. Hem heights are in **metres**, because a
 * hem is about the body: it has to clear a backpack that is not part of the
 * head and stay off hands that swing on a fixed arc. That split is the same one
 * `hair.ts` documents for `crown` versus `fall`, and `check:hair` measures both
 * ends of it.
 */

/** Hem samples run from the back of the skull to dead front, and are mirrored. */
export const HEM_SAMPLES = 19;

/**
 * The vertex layout, for anything that needs to tell the two skins apart.
 *
 * Vertex 0 is the outer crown and vertex 1 the inner one; from
 * {@link SHELL_FIRST_VERTEX} the two skins alternate, outer first. `check:hair`
 * uses this to ask its questions of the **outer** skin only — a hand tucked
 * inside the cavity is a hand under her hair, which is correct, and only a hand
 * that reaches the outside is a hand coming *through* it.
 */
export const SHELL_FIRST_VERTEX = 2;
export const SHELL_SKINS = 2;

export interface HairShellSpec {
  /**
   * Hairline height in metres at each of {@link HEM_SAMPLES} azimuths, from the
   * **back** of the skull (index 0) to dead **front** (index 18), in 10° steps.
   * Mirrored onto the other side, so the style is symmetric before
   * {@link asym}.
   */
  readonly hem: readonly number[];
  /** Widest radius, at the equator, in skull radii. */
  readonly shell: number;
  /** The dome's vertical semi-axis, in skull radii. Also where the pole sits. */
  readonly semiY: number;
  /** How far the fall draws in below the head, in metres. */
  readonly tuck: number;
  /**
   * Tuck curve exponent. **Must be ≥ 1**: below it the fall leaves the dome
   * with an infinite slope and the shell creases in a hard ring right round the
   * head, which reads as the brim of a hat rather than as hair.
   */
  readonly tuckPow: number;
  /** A kick back out at the tips, in metres. The flick at the end of a fall. */
  readonly flare: number;
  /** Over what drop the tuck happens, in metres. */
  readonly fallSpan: number;
  /** Height at which hair starts gathering behind the shoulders. */
  readonly gatherTop: number;
  readonly gatherSpan: number;
  /** Sideways squeeze at full gather, 0–1. */
  readonly narrow: number;
  /** Front-to-back squeeze at full gather, 0–1. */
  readonly flatten: number;
  /** How far back the gather pushes, in metres. */
  readonly pushBack: number;
  /** Shell thickness, in skull radii. */
  readonly thick: number;
  /** How many locks around the head. */
  readonly locks: number;
  /** Lock relief, as a fraction of the radius. */
  readonly lockR: number;
  /** How much longer a lock's crest hangs than its trough, in metres. */
  readonly lockY: number;
  /** One side hangs this much longer — the style's asymmetric feature. */
  readonly asym: number;
  /** The crown's tip-back in radians; the scalp rides it, the fall does not. */
  readonly headTilt: number;
  readonly segments: number;
  readonly rings: number;
}

/**
 * Everything a style does not care about.
 *
 * These are the numbers that came out of the Blender session for the long
 * style; a shorter style overrides the two or three that stop being true when
 * the hair no longer reaches the shoulders.
 */
export const HAIR_SHELL_DEFAULTS = {
  shell: 1.136,
  semiY: 1.091,
  tuck: 0.24,
  tuckPow: 1.4,
  flare: 0.04,
  fallSpan: 1.0,
  gatherTop: 0.15,
  gatherSpan: 0.8,
  narrow: 0.2,
  flatten: 0.42,
  pushBack: 0.34,
  thick: 0.197,
  locks: 8,
  lockR: 0.05,
  lockY: 0.065,
  asym: 0.06,
  headTilt: 0.17,
  segments: 40,
  rings: 14,
} as const satisfies Omit<HairShellSpec, 'hem'>;

/** Locks emerge as the hair leaves the scalp, not on the skull itself. */
const LOCK_FADE: readonly [number, number] = [0.15, 0.75];
/**
 * ...and die away before the fringe. A lock wave over the forehead walks a
 * trough down into an eye, and the eyes are 80% of the cuteness
 * (ART_DIRECTION.md §3). 120° to 165° off the back of the skull.
 */
const LOCK_FRONT: readonly [number, number] = [2.09, 2.88];
/** Below this the hair hangs plumb; above it, it rides the tipped-back skull. */
const TILT_LOW = -0.25;
const TILT_HIGH = 0.15;
/**
 * How far round the head the gather pushes hair backwards.
 *
 * Full push from the nape round to {@link GATHER_FULL} (100°), then fading to
 * nothing by {@link GATHER_NONE} (150°) so the face-framing locks still hang
 * forward where they belong.
 *
 * The obvious weight — `cos²(φ/2)`, or any power of it — instead fades
 * smoothly all the way round, which leaves the fall only two thirds pushed back
 * at the ears. `check:hair` measured a fist **187 mm through the outside of the
 * curtain** on the back-swing there: the hands reach `z = −0.375` at `x = 0.38`
 * and the hair sat at `z = −0.32`. Below the shoulders the whole fall has to be
 * behind the swing, and only the part that is still beside the face may hang
 * in front of it.
 */
const GATHER_FULL = 1.75;
const GATHER_NONE = 2.62;
/**
 * The top of the shell is a **shared dome**: the first {@link CAP_SPLIT} of the
 * rings run from the crown down to {@link CAP_Y} at every azimuth alike, and
 * only below that does each azimuth head for its own hem.
 *
 * Not cosmetic. Spacing the rings by each azimuth's own drop makes the first
 * ring sit 1.7 m below the crown at the nape and 0.06 m below it at the fringe
 * — and once the head tilt lifts the front, the ring in front of the crown ends
 * up *above* it. The fan of triangles round the crown then folds back on itself
 * and every child gets a crater in the top of her head. It rendered exactly
 * like a modelling mistake, because it was one.
 *
 * `CAP_Y` is in units of the dome's semi-axis and must stay above every hem, so
 * the handover is monotonic; it is clamped against the table to guarantee that.
 */
const CAP_SPLIT = 0.3;
const CAP_Y = 0.45;

/** Azimuth folded into ±π. The hem table is one side; the other is mirrored. */
function fold(phi: number): number {
  return ((phi + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/** Catmull–Rom through the hem table, so a style is nineteen numbers. */
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
 * The surface itself, as two functions: how wide the shell is at a height, and
 * where a point at a given azimuth and height ends up once it has been gathered
 * behind the shoulders and tipped back with the skull.
 *
 * Shared so that the things which sit **on** the hair — messy tufts, spikes —
 * can be placed on the real surface instead of at hand-picked coordinates.
 * That is not a tidiness point: on `main` the messy tufts were parked 1.13 m
 * from the head's centre with a cap 0.68 m across, so four of the eight were
 * **floating in mid-air**, which is the same disconnection the family reported
 * about the long hair and nobody had noticed. Placed on the surface, half of
 * every tuft is inside the shell by construction and a gap is not expressible.
 */
export function hairShellSampler(spec: HairShellSpec, skull: number) {
  const {
    tuck,
    tuckPow,
    flare,
    fallSpan,
    gatherTop,
    gatherSpan,
    narrow,
    flatten,
    pushBack,
    headTilt,
  } = spec;
  const shellR = spec.shell * skull;
  const semiY = spec.semiY * skull;
  const thick = spec.thick * skull;

  /** The dome above the equator, then a fall that draws in and flicks out. */
  const radiusAt = (y: number): number => {
    if (y >= 0) {
      const q = Math.min(y / semiY, 1);
      return shellR * Math.sqrt(Math.max(0, 1 - q * q));
    }
    const t = Math.min(-y / fallSpan, 1);
    return shellR - tuck * Math.pow(t, tuckPow) + flare * t * t * t;
  };

  /**
   * Places a point on the shell: gathers it behind the shoulders as it falls,
   * then tips the part of it that is still on the skull back with the skull.
   *
   * Hair *on* the head rides the crown's tip-back; hair hanging *off* it hangs
   * plumb. Without that split the whole style is authored flat, and from the
   * game's 38° camera the player gets a dome and no face at all — exactly the
   * failure ART_DIRECTION.md §4 invented `HEAD_TILT` to avoid.
   */
  const at = (phi: number, y: number, r: number): [number, number, number] => {
    const g = smoothstep(gatherTop, gatherTop + gatherSpan, -y);
    const back = smoothstep(GATHER_NONE, GATHER_FULL, Math.abs(fold(phi)));
    const x = r * Math.sin(phi) * (1 - narrow * g);
    const z = -r * Math.cos(phi) * (1 - flatten * g) - pushBack * g * back;
    const a = -headTilt * smoothstep(TILT_LOW, TILT_HIGH, y);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
  };

  /** The outer surface at an azimuth and height, ready to hang something off. */
  const surface = (phi: number, y: number): [number, number, number] =>
    at(phi, y, radiusAt(y));

  return { radiusAt, at, surface, shellR, semiY, thick };
}

/**
 * Builds one hairstyle's shell.
 *
 * `skull` is the kid's skull radius in metres — every radial number in the spec
 * is a multiple of it, so the shell tracks a head retune.
 */
export function hairShellGeometry(spec: HairShellSpec, skull: number): BufferGeometry {
  const { hem, locks, lockR, lockY, asym, segments, rings } = spec;
  const { radiusAt, at, semiY, thick } = hairShellSampler(spec, skull);
  const place = (phi: number, y: number, r: number, out: number[]): void => {
    out.push(...at(phi, y, r));
  };

  const handover = Math.max(CAP_Y * semiY, ...hem);

  const positions: number[] = [];
  const indices: number[] = [];

  // Two poles rather than one shared vertex: the outer and inner skins meet
  // there, and averaging their normals into a single crown vertex puts a
  // pinprick of the wrong shade on the very top of every child's head.
  place(0, semiY, 0, positions);
  place(0, semiY - thick * 0.25, 0, positions);
  const OUTER_POLE = 0;
  const INNER_POLE = 1;
  const FIRST = SHELL_FIRST_VERTEX;

  for (let i = 0; i < segments; i += 1) {
    const phi = (i / segments) * TAU;
    // The fringe stays a clean curve: no lock wave, no asymmetry, both of which
    // are held off by the same weight.
    const front = 1 - smoothstep(LOCK_FRONT[0], LOCK_FRONT[1], Math.abs(fold(phi)));
    const lock = Math.cos(locks * phi) * front;
    const bottom = hemAt(hem, phi) + lockY * lock - asym * Math.sin(phi) * front;
    for (let j = 1; j <= rings; j += 1) {
      const s = j / rings;
      const y =
        s <= CAP_SPLIT
          ? semiY + (handover - semiY) * (s / CAP_SPLIT)
          : handover + (bottom - handover) * ((s - CAP_SPLIT) / (1 - CAP_SPLIT));
      const amp = lockR * smoothstep(LOCK_FADE[0], LOCK_FADE[1], s);
      const r = radiusAt(y) * (1 + amp * lock);
      // The profile's own normal in the (r, y) plane, by finite difference —
      // the inner skin is the outer one offset along it, so the shell keeps an
      // even wall thickness on the dome and down the fall alike.
      const d = 0.01;
      const dr = (radiusAt(y + d) - radiusAt(y - d)) / (2 * d);
      const n = Math.hypot(1, dr);
      const wall = thick * (0.25 + 0.75 * smoothstep(0, 0.3, s));
      place(phi, y, r, positions);
      place(phi, y - (wall * -dr) / n, r - wall / n, positions);
    }
  }

  // Two vertices per ring step, outer then inner, so a ring's stride is 2.
  const vertex = (i: number, j: number, inner: boolean): number =>
    FIRST + (i * rings + (j - 1)) * SHELL_SKINS + (inner ? 1 : 0);

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
    // The hem rim, joining the outer skin to the inner one. Long hair is a
    // painted wooden toy, not a sheet of paper: the edge has to have a width.
    const o = vertex(i, rings, false);
    const oi = vertex(i, rings, true);
    const p = vertex(k, rings, false);
    const pi = vertex(k, rings, true);
    indices.push(o, pi, oi, o, p, pi);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// -----------------------------------------------------------------------------
// The styles, as hem tables.
//
// Every number below is a height in metres in the drape frame, sampled every
// 10° from the back of the skull round to dead front. Read a row left to right
// and you are walking the hairline from the nape to the middle of the forehead.
//
// Three heights are load-bearing and were measured off the real model in the
// Blender reference build rather than picked:
//
//  - the **ear top** sits at y = +0.074. A hem above it leaves the ears out
//    (`crop`); a hem below it covers them (`bob`, `bowl`, `long`).
//  - the **top of the eyes** sits at y = +0.207 once the crown's tip-back is
//    undone. Every style's fringe clears it, which is why they all end at
//    +0.13…+0.15 rather than wherever looked nice.
//  - the **backpack's back face** is at z = −0.42 and the **hands** swing to
//    the same z. Only `long` reaches down that far, and its gather carries it
//    to z = −0.66 before it gets there.
// -----------------------------------------------------------------------------

/** Which shell a style wears. Four shells cover seven styles. */
export type HairShellName = 'long' | 'bob' | 'bowl' | 'crop';

export const HAIR_SHELLS: Record<HairShellName, HairShellSpec> = {
  /**
   * Long hair hanging naturally — the style the family asked for and the one
   * this whole surface was built to fix. A fringe above the eyes, an unbroken
   * hairline down past the temples, face-framing locks either side of the jaw,
   * and a fall that gathers behind the shoulders and ends around the skirt hem.
   */
  long: {
    ...HAIR_SHELL_DEFAULTS,
    hem: [
      -1.0, -1.0, -0.99, -0.98, -0.96, -0.93, -0.9, -0.85, -0.79, -0.72, -0.65, -0.6, -0.57,
      -0.57, -0.35, 0.178, 0.166, 0.14, 0.13,
    ],
    pushBack: 0.4,
  },

  /** A jaw-length bob: a level line all round, turned very slightly under. */
  bob: {
    ...HAIR_SHELL_DEFAULTS,
    hem: [
      -0.52, -0.52, -0.52, -0.51, -0.5, -0.49, -0.48, -0.47, -0.46, -0.45, -0.44, -0.44, -0.44,
      -0.42, -0.28, 0.178, 0.166, 0.14, 0.13,
    ],
    tuck: 0.1,
    flare: 0.07,
    fallSpan: 0.7,
    gatherTop: 0.1,
    gatherSpan: 0.7,
    narrow: 0.06,
    flatten: 0.14,
    pushBack: 0.1,
    locks: 10,
    lockR: 0.03,
    lockY: 0.035,
    asym: 0.04,
  },

  /**
   * The bowl cut: one level line right round, over the ears, with the step up
   * at the temples that gives it its fringe. Barely any lock relief — a bowl
   * cut is meant to look cut, and the asymmetry is carried by a stray strand
   * added on top in `hair.ts` instead.
   */
  bowl: {
    ...HAIR_SHELL_DEFAULTS,
    hem: [
      -0.24, -0.24, -0.24, -0.24, -0.23, -0.23, -0.22, -0.22, -0.21, -0.21, -0.21, -0.21, -0.22,
      -0.23, -0.2, 0.187, 0.175, 0.166, 0.16,
    ],
    tuck: 0.02,
    flare: 0.035,
    fallSpan: 0.5,
    gatherTop: 0,
    gatherSpan: 0.6,
    narrow: 0.02,
    flatten: 0.04,
    pushBack: 0.03,
    locks: 12,
    lockR: 0.01,
    lockY: 0.012,
    asym: 0.03,
  },

  /**
   * The short crop the four "hair on the head plus something" styles share —
   * `short`, `bunches`, `spiky` and `messy`. Up over the ears, down to a small
   * tuft at the nape, which is what the old `back tuft` blob was for.
   *
   * Shared on purpose: the NPC crowd turns every prototype mesh into an
   * `InstancedMesh` whether anyone wears it or not, so four separate crops
   * would be three draw calls the whole park pays forever to draw the same
   * shape four times.
   */
  crop: {
    ...HAIR_SHELL_DEFAULTS,
    hem: [
      -0.3, -0.29, -0.28, -0.25, -0.21, -0.16, -0.1, -0.02, 0.05, 0.11, 0.13, 0.13, 0.12, 0.11,
      0.13, 0.178, 0.166, 0.14, 0.13,
    ],
    tuck: 0.03,
    flare: 0.02,
    fallSpan: 0.5,
    gatherTop: 0,
    gatherSpan: 0.6,
    narrow: 0.05,
    flatten: 0.08,
    pushBack: 0.06,
    locks: 9,
    lockR: 0.022,
    lockY: 0.028,
    asym: 0.03,
  },
};
