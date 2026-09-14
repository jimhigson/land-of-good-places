import { Vector3 } from 'three';
import { Frame } from './Frame';
import { Geo, PLANET_RADIUS } from './Geo';

const _e1 = /* @__PURE__ */ new Vector3();
const _e2 = /* @__PURE__ */ new Vector3();
const _n = /* @__PURE__ */ new Vector3();
const _t = /* @__PURE__ */ new Vector3();

export type ChartId = string & { readonly __chart?: unique symbol };

/**
 * **How far a flat patch of the given radius departs from this planet.**
 *
 * The exact `R − √(R² − v²)`, not the `v²/2R` approximation everyone writes, so
 * that a chart declared far too large reports a meaningful number instead of
 * quietly staying plausible.
 *
 * The table this produces is the fact the whole design turns on, so it is worth
 * having to hand (R = 220 m):
 *
 * | departure tolerated | largest flat patch, radius |
 * |---|---|
 * | 1 cm | 2.10 m |
 * | 5 cm | **4.69 m** |
 * | 10 cm | 6.63 m |
 * | 1 m | 20.95 m |
 *
 * **On this planet a flat patch is good to about 4.7 m at centimetre
 * tolerance.** That is a bench, a stall, a prop, a single stair tread — and
 * nothing else. No ride, path, route or boundary qualifies at any origin, which
 * is why the curved chart is not merely the principled default but the only
 * option for anything bigger than furniture.
 */
export function flatDeparture(validFor: number, radius = PLANET_RADIUS): number {
  if (validFor >= radius) return radius;
  return radius - Math.sqrt(radius * radius - validFor * validFor);
}

/** The inverse: the largest flat patch whose departure stays within `metres`. */
export function flatRadiusFor(metres: number, radius = PLANET_RADIUS): number {
  const rise = radius - metres;
  if (rise <= 0) return radius;
  return Math.sqrt(radius * radius - rise * rise);
}

/**
 * **Flatness is a local privilege that must be declared.**
 *
 * The insight the design turns on: today's bugs are not "code that forgot about
 * the sphere". They are all one bug — *a global flat chart, used everywhere,
 * that nobody ever declared*. A hand-copied `deckY` across a whole fence run, a
 * castle carve pinning one height across ground that falls 14.6 m, gate
 * corridor `z` coordinates copied while the arch stood elsewhere: each is a flat
 * chart of unbounded extent, asserted implicitly. The code is not wrong about
 * the sphere; it is silent about its own domain of validity.
 *
 * So the domain of validity is a first-class, mandatory, checkable thing. A
 * chart has an origin, a stated radius it promises to be usable over, and a
 * computed departure from the sphere at that radius — which is printed, to
 * stderr, on every build, so an exception cannot decay into an assumption.
 *
 * Working flat is allowed. Working flat **without saying where and how far** is
 * not, and is an error at the call site rather than a wrong answer a child
 * finds.
 */
export interface Chart {
  readonly id: ChartId;
  readonly kind: 'curved' | 'flat';

  /** Where this chart's origin sits on the planet, and which way round it is. */
  readonly anchor: Frame;

  /** How far from the origin this chart promises to be usable. Metres. */
  readonly validFor: number;

  /** Metres by which this chart departs from the sphere at `validFor`. Zero for a curved chart. */
  readonly departure: number;

  /** Exact both ways within `validFor`. Throws outside it. */
  toGeo(local: Readonly<Vector3>, target: Geo): Geo;
  toLocal(g: Readonly<Geo>, target: Vector3): Vector3;

  /** The local up at a local point — a world-space direction, and the whole point of the type. */
  upAt(local: Readonly<Vector3>, target: Vector3): Vector3;

  /** Is this local point inside the chart's declared validity? */
  contains(local: Readonly<Vector3>): boolean;
}

/**
 * How a chart's local coordinates are laid out, for both kinds:
 * **`x` and `z` are the tangent plane; `y` is away from the planet.**
 *
 * For a curved chart, `(x, z)` is the *geodesic* displacement from the origin —
 * the log map — so `hypot(x, z)` is genuinely how far you would walk, at any
 * distance, with no distortion and no singularity. That is the precise
 * difference from today's `(x, z)`, which is an orthographic chart whose radial
 * axis compresses by `cos θ`: a 0.5 m lattice cell measures 0.714 m radially at
 * the park's reach, against `NavGrid`'s 0.62 m `MAX_STEP`, which is
 * tap-to-move silently refusing to path outward in the part of the park where
 * there is nothing to blame.
 *
 * For a flat chart, `(x, y, z)` is the tangent frame directly, and `y` is a
 * plain height, because that is what a flat chart *means*.
 */
export interface ChartLocal extends Vector3 {}

function assertInside(chart: Chart, local: Readonly<Vector3>): void {
  if (chart.contains(local)) return;
  const d = Math.hypot(local.x, local.z);
  throw new Error(
    `Chart "${chart.id}" is declared valid for ${chart.validFor.toFixed(2)} m ` +
      `but was read at ${d.toFixed(2)} m from its origin ` +
      `(local ${local.x.toFixed(2)}, ${local.y.toFixed(2)}, ${local.z.toFixed(2)}). ` +
      `Either widen the chart and accept the printed departure, or put this on its own chart.`,
  );
}

/**
 * Pull the chart's tangent basis out of its anchor frame. `e1` is local `+X`,
 * `e2` is local `+Z`, `n` is the up. All three are world-space directions, so
 * they need no conversion — the planet-centred space is a pure translation of
 * world space.
 */
function basis(anchor: Readonly<Frame>): void {
  _e1.set(1, 0, 0).applyQuaternion(anchor.q);
  _e2.set(0, 0, 1).applyQuaternion(anchor.q);
  _n.set(0, 1, 0).applyQuaternion(anchor.q);
}

class CurvedChart implements Chart {
  readonly kind = 'curved' as const;
  readonly validFor = Infinity;
  readonly departure = 0;

  readonly id: ChartId;
  readonly anchor: Frame;

  // Fields declared and assigned, not parameter properties: `erasableSyntaxOnly`
  // is on, because this repo's checks and scripts run straight on Node with
  // type-stripping and no transpile step.
  constructor(id: ChartId, anchor: Frame) {
    this.id = id;
    this.anchor = anchor;
  }

  contains(): boolean {
    return true;
  }

  /**
   * The exponential map: walk `hypot(x, z)` metres along the surface on the
   * bearing `(x, z)` gives, then stand `y` metres off the sphere.
   *
   * Exact, closed-form, no approximation, at any distance, with no singularity
   * short of the antipode at 691 m — which is twice the park's diameter and
   * unreachable, since Jim has ruled that a child never needs to walk right
   * round the planet.
   */
  toGeo(local: Readonly<Vector3>, target: Geo): Geo {
    basis(this.anchor);
    const d = Math.hypot(local.x, local.z);
    const r = PLANET_RADIUS + local.y;
    if (d === 0) return target.set(_n.x * r, _n.y * r, _n.z * r);
    const theta = d / PLANET_RADIUS;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // The unit tangent this displacement points along, in world space.
    const tx = (_e1.x * local.x + _e2.x * local.z) / d;
    const ty = (_e1.y * local.x + _e2.y * local.z) / d;
    const tz = (_e1.z * local.x + _e2.z * local.z) / d;
    return target.set(
      (_n.x * cos + tx * sin) * r,
      (_n.y * cos + ty * sin) * r,
      (_n.z * cos + tz * sin) * r,
    );
  }

  /** The logarithmic map — the exact inverse of {@link toGeo}. */
  toLocal(g: Readonly<Geo>, target: Vector3): Vector3 {
    basis(this.anchor);
    const r = g.radius();
    if (r === 0) return target.set(0, -PLANET_RADIUS, 0);
    const ux = g.cx / r;
    const uy = g.cy / r;
    const uz = g.cz / r;
    let cos = ux * _n.x + uy * _n.y + uz * _n.z;
    cos = cos < -1 ? -1 : cos > 1 ? 1 : cos;
    const theta = Math.acos(cos);
    const d = PLANET_RADIUS * theta;
    // Tangential part of the direction, normalised. At the origin itself there
    // is no bearing, and the answer is the origin, not a NaN.
    _t.set(ux - _n.x * cos, uy - _n.y * cos, uz - _n.z * cos);
    const tl = _t.length();
    if (tl < 1e-12) return target.set(0, r - PLANET_RADIUS, 0);
    _t.multiplyScalar(1 / tl);
    return target.set(d * _t.dot(_e1), r - PLANET_RADIUS, d * _t.dot(_e2));
  }

  upAt(local: Readonly<Vector3>, target: Vector3): Vector3 {
    basis(this.anchor);
    const d = Math.hypot(local.x, local.z);
    if (d === 0) return target.copy(_n);
    const theta = d / PLANET_RADIUS;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return target.set(
      _n.x * cos + ((_e1.x * local.x + _e2.x * local.z) / d) * sin,
      _n.y * cos + ((_e1.y * local.x + _e2.y * local.z) / d) * sin,
      _n.z * cos + ((_e1.z * local.x + _e2.z * local.z) / d) * sin,
    );
  }
}

class FlatChart implements Chart {
  readonly kind = 'flat' as const;
  readonly departure: number;

  readonly id: ChartId;
  readonly anchor: Frame;
  readonly validFor: number;

  constructor(id: ChartId, anchor: Frame, validFor: number) {
    this.id = id;
    this.anchor = anchor;
    this.validFor = validFor;
    this.departure = flatDeparture(validFor);
  }

  contains(local: Readonly<Vector3>): boolean {
    return Math.hypot(local.x, local.z) <= this.validFor;
  }

  toGeo(local: Readonly<Vector3>, target: Geo): Geo {
    assertInside(this, local);
    basis(this.anchor);
    const a = this.anchor.at;
    return target.set(
      a.cx + _e1.x * local.x + _n.x * local.y + _e2.x * local.z,
      a.cy + _e1.y * local.x + _n.y * local.y + _e2.y * local.z,
      a.cz + _e1.z * local.x + _n.z * local.y + _e2.z * local.z,
    );
  }

  toLocal(g: Readonly<Geo>, target: Vector3): Vector3 {
    basis(this.anchor);
    const a = this.anchor.at;
    const dx = g.cx - a.cx;
    const dy = g.cy - a.cy;
    const dz = g.cz - a.cz;
    target.set(
      dx * _e1.x + dy * _e1.y + dz * _e1.z,
      dx * _n.x + dy * _n.y + dz * _n.z,
      dx * _e2.x + dy * _e2.y + dz * _e2.z,
    );
    assertInside(this, target);
    return target;
  }

  /** Constant, by definition — that is what being flat *is*. */
  upAt(_local: Readonly<Vector3>, target: Vector3): Vector3 {
    basis(this.anchor);
    return target.copy(_n);
  }
}

const registry = new Map<ChartId, Chart>();
const announced = new Set<ChartId>();

/**
 * **The curved chart is the planet, and it is the default and the domain.**
 *
 * Exact everywhere, distortion-free at any distance, `departure` of zero. The
 * outdoor park is one of these. Every generator, every route, every ride, every
 * path and every check belongs on one.
 */
export function curvedChart(id: ChartId, anchor: Frame): Chart {
  return register(new CurvedChart(id, anchor));
}

/**
 * A tangent plane, valid for a declared radius, with a computed departure.
 *
 * Legitimate — a 3 m bench, a stall's counter top, a stair tread — and Jim has
 * ruled that interiors are one too. Illegitimate above about 4.7 m of radius
 * unless somebody has decided knowingly, which is what `departure` being
 * printed on every run is for.
 */
export function flatChart(id: ChartId, anchor: Frame, validFor: number): Chart {
  return register(new FlatChart(id, anchor, validFor));
}

function register(chart: Chart): Chart {
  const existing = registry.get(chart.id);
  if (existing && existing !== chart) {
    // Two definitions of one thing is this repo's commonest bug by a distance.
    // A chart is an identity, so a second one under the same id is that bug
    // with the name still attached, and it is cheap to refuse.
    throw new Error(`Chart "${chart.id}" is already registered. A chart id is one owner, not a label.`);
  }
  registry.set(chart.id, chart);
  announceDeparture(chart);
  return chart;
}

/**
 * **Print what a flat chart costs, on every run, to stderr.**
 *
 * CLAUDE.md: a check that stops covering something must say so on every run,
 * and the note goes to `process.stderr` — Vitest's default reporter shows
 * `console.log` from *failing* tests only, so a coverage note written the
 * obvious way is invisible in exactly the case it exists for.
 *
 * Jim's interior exception stays visible and quantified forever rather than
 * decaying into "flat because nobody converted it".
 */
function announceDeparture(chart: Chart): void {
  if (chart.kind !== 'flat' || announced.has(chart.id)) return;
  announced.add(chart.id);
  const line =
    `[chart] "${chart.id}" is flat over ${chart.validFor.toFixed(1)} m; ` +
    `on R = ${PLANET_RADIUS} that departs from the sphere by ${chart.departure.toFixed(3)} m.\n`;
  // `process.stderr`, not `console.log`, and reached through `globalThis` so
  // that this file — which is app code, loaded in a browser — does not depend
  // on Node types. Vitest's default reporter shows console output from
  // *failing* tests only, so a note written the obvious way is invisible in
  // exactly the case it exists for: a passing run.
  const node = globalThis as { process?: { stderr?: { write(s: string): void } } };
  if (node.process?.stderr) node.process.stderr.write(line);
  else console.info(line.trimEnd());
}

/** Every chart declared so far, for a check to sweep. */
export function allCharts(): readonly Chart[] {
  return [...registry.values()];
}

export function chartById(id: ChartId): Chart | undefined {
  return registry.get(id);
}

/** Test-only: forget every chart, so a suite can build its own without collisions. */
export function resetCharts(): void {
  registry.clear();
  announced.clear();
}

/**
 * **The park itself: one curved chart, origin at the park's centre, up along
 * world `+Y`.**
 *
 * This is the domain. Its anchor is chosen so that local `(x, 0, z)` at small
 * distances agrees with today's world `(x, z)` to the last decimal — which is
 * what lets a subsystem be converted one at a time with a diff a reviewer can
 * read, rather than all at once.
 */
export const PARK_CHART: Chart = /* @__PURE__ */ curvedChart(
  'park',
  /* @__PURE__ */ new Frame(new Geo(0, PLANET_RADIUS, 0)),
);
