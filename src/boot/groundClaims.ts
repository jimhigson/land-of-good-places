/**
 * **One owner of the ground: the claims registry every placer asks.**
 *
 * The ruling this implements (Jim, 3 September 2026, recorded in
 * `docs/DESIGN-round-robin-generation.md`): every part of the park that puts
 * something on the ground makes a **claim** against one shared registry, the
 * claim is checked against *everything* already claimed — never against a
 * hand-picked obstacle list — and on refusal the placer backtracks. A placer
 * never names an obstacle type, so it cannot miss a kind of thing.
 *
 * This widens `coSolve.ts`'s `PlacementField` — which knows only keep-out
 * discs — to the four kinds of claim the design names, plus **demands**:
 *
 * - {@link ClaimKind} `footprint` — solid stuff: stone, trunks, walls, plots.
 *   Nothing else may overlap it.
 * - `corridor` — a thing that travels: track, road, path ribbon. Two
 *   corridors may meet only at a declared {@link Crossing} (or within one
 *   feature, whose own claims never collide with each other through the
 *   registry — a street may branch from itself).
 * - `walkable` — ground a child must be able to stand on: a doorway, a stand
 *   spot, a seat, a ride exit. Nothing solid may overlap it; paving may,
 *   and is welcome to.
 * - `surface` — solid from below, walkable on top: a bridge deck, a mall
 *   plate. A corridor is *welcome* to cross it; another solid may not share
 *   its ground.
 *
 * What may overlap what is **one table**, {@link CLAIM_COMPATIBILITY} — data,
 * exported, so the generator's registry and the test suite's universal
 * overlap invariant read the *same* law rather than two hand-synchronised
 * copies (the repo's most-repeated bug, per CLAUDE.md).
 *
 * A **demand** ({@link Demand}) is the fifth thing a placer may publish: *"a
 * paved corridor must terminate here."* A building plants its door stub and
 * demands the network join the stub's free end; the park is not finished
 * while a demand is unserved ({@link GroundClaims.unservedDemands}), and an
 * unserved demand backtracks exactly like a refused claim — as far as moving
 * the building.
 *
 * Geometry is deliberately small: a {@link Disc} or a {@link Capsule}
 * (a segment with half-width). Trees, lamps and plots are discs; paths,
 * rail, roads, walls, decks and door stubs are capsules or chains of them.
 * Anything finer belongs to the feature's own art, not to the ground it
 * claims.
 *
 * Determinism: the registry is a plain data structure — no clock, no
 * randomness. Query results depend only on what has been committed, and
 * {@link GroundClaims.blockers} reports refusers in commit order so a
 * backjumping search behaves identically on every run.
 */

import {
  arcBetween,
  arcToRun,
  boundsOfRun,
  eachRunSample,
  runsCross,
  CLAIM_BROAD_PHASE_SLACK,
} from './claimSurface';

/** A circular claim shape: trees, lamps, plot discs, stand spots. */
export interface Disc {
  readonly shape: 'disc';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * A thick segment — the shape of everything that travels or spans: a path
 * ribbon piece, a rail piece, a wall run, a bridge deck, a door stub.
 */
export interface Capsule {
  readonly shape: 'capsule';
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  readonly halfWidth: number;
}

export type ClaimShape = Disc | Capsule;

export type ClaimKind = 'footprint' | 'corridor' | 'walkable' | 'surface';

/** One piece of ground a feature has claimed, in one of the four kinds. */
export interface Claim {
  readonly kind: ClaimKind;
  readonly shape: ClaimShape;
}

/**
 * A declared point where two corridors may legally overlap — a junction or a
 * crossing. Inside `radius` of `(x, z)`, corridor-versus-corridor overlap
 * between the two named features is legal; everywhere else it is refused.
 */
export interface Crossing {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** The two features whose corridors meet here. Order does not matter. */
  readonly between: readonly [string, string];
}

/**
 * *"A paved corridor must terminate here."* Served when **another feature's**
 * corridor claim has an END of its centreline inside the disc; unserved
 * demands are what {@link GroundClaims.unservedDemands} reports and what the
 * search must drive to zero before a park is finished.
 *
 * Both restrictions are the design's, not conveniences (review of #499
 * caught the first cut getting both wrong while the code was still dead):
 *
 * - **A feature's own corridors never serve its own demand.** The door stub
 *   a building plants *is the demand's mouth, not its answer* — the whole
 *   point is that the network must come to it. Counting the stub would mark
 *   a hotel alone in an empty park as served.
 * - **Passing through is not terminating.** A road sailing past the door
 *   uninvited leaves the child exactly as cut off as no road at all; only a
 *   corridor whose end arrives in the disc answers the demand.
 */
export interface Demand {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Human-readable: which door/spot this is, for the failure that names it. */
  readonly label: string;
}

/**
 * The one law of what may overlap what. `CLAIM_COMPATIBILITY[a][b]` is true
 * when a claim of kind `a` may share ground with a committed claim of kind
 * `b`. Symmetric by construction (asserted in the unit tests, so an edit
 * that breaks symmetry fails loudly rather than ruling differently depending
 * on who asks).
 *
 * The one entry with a condition on it: corridor×corridor is `'crossing'`,
 * legal only inside a declared {@link Crossing} between the two features.
 */
export const CLAIM_COMPATIBILITY: Readonly<
  Record<ClaimKind, Readonly<Record<ClaimKind, boolean | 'crossing'>>>
> = {
  footprint: { footprint: false, corridor: false, walkable: false, surface: false },
  corridor: { footprint: false, corridor: 'crossing', walkable: true, surface: true },
  walkable: { footprint: false, corridor: true, walkable: true, surface: true },
  surface: { footprint: false, corridor: true, walkable: true, surface: false },
};

/** Why a claim was refused: the feature and the committed claim in the way. */
export interface Refusal {
  readonly feature: string;
  readonly kind: ClaimKind;
}

/**
 * **Distance on the ground, not in the chart.**
 *
 * Every one of these was plane geometry over world `(x, z)` until the sphere
 * landed. World `(x, z)` is an orthographic projection of the planet, so
 * `Math.hypot` over it under-reads radial separation by `cos θ`. How much
 * depends on how far out: the table in `claimSurface.ts` (printed by
 * `scripts/claim-chart-error.mts`) has a 1 m radial gap walking 1.12 m at
 * 100 m from the origin, 1.22 m at 125 m and 1.37 m at 150 m — and the park's
 * outline and its furthest drawn geometry stand between those rows
 * (`theGroundIsTheSphereItClaimsToBe` prints the latter on every run). That
 * file carries the measurement and the reasoning; these three lines are where
 * the registry stopped believing the shadow.
 *
 * The kinds of error it was making were not symmetric. Under-reading distance
 * makes an overlap refusal *stricter* than it needs to be — a cost, not a
 * hazard. But {@link Demand} is served by a corridor **ending within a
 * radius**, and there under-reading means calling a door served by paving that
 * stops further away than the registry believes — by the same factor, so 12%
 * at 100 m out and 37% at 150 m — which is a child walking to a door down a
 * path that runs out.
 */
const distPointSegment = (
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number => arcToRun(px, pz, x1, z1, x2, z2);

const segmentsCross = (a: Capsule, b: Capsule): boolean =>
  runsCross(a.x1, a.z1, a.x2, a.z2, b.x1, b.z1, b.x2, b.z2);

/** The shortest distance between two shapes' cores (centres/segments). */
const coreDistance = (a: ClaimShape, b: ClaimShape): number => {
  if (a.shape === 'disc' && b.shape === 'disc') return arcBetween(a.x, a.z, b.x, b.z);
  if (a.shape === 'disc' && b.shape === 'capsule') {
    return distPointSegment(a.x, a.z, b.x1, b.z1, b.x2, b.z2);
  }
  if (a.shape === 'capsule' && b.shape === 'disc') {
    return distPointSegment(b.x, b.z, a.x1, a.z1, a.x2, a.z2);
  }
  const ca = a as Capsule;
  const cb = b as Capsule;
  if (segmentsCross(ca, cb)) return 0;
  return Math.min(
    distPointSegment(ca.x1, ca.z1, cb.x1, cb.z1, cb.x2, cb.z2),
    distPointSegment(ca.x2, ca.z2, cb.x1, cb.z1, cb.x2, cb.z2),
    distPointSegment(cb.x1, cb.z1, ca.x1, ca.z1, ca.x2, ca.z2),
    distPointSegment(cb.x2, cb.z2, ca.x1, ca.z1, ca.x2, ca.z2),
  );
};

const reachOf = (s: ClaimShape): number => (s.shape === 'disc' ? s.radius : s.halfWidth);

/** The points a shape's core is made of, sampled every `step` metres — the
 * disc's centre, or a march along the capsule's segment including both ends. */
const coreSamples = (s: ClaimShape, step: number): { x: number; z: number }[] => {
  if (s.shape === 'disc') return [{ x: s.x, z: s.z }];
  // The GEODESIC's own samples, not the chord's. On the ground the two are
  // different curves, and a crossing zone is judged by where the shapes really
  // share ground — so marching the chart's straight line would test points the
  // claim does not occupy.
  const length = arcBetween(s.x1, s.z1, s.x2, s.z2);
  const count = Math.max(1, Math.ceil(length / step));
  const out: { x: number; z: number }[] = [];
  eachRunSample(s.x1, s.z1, s.x2, s.z2, (x, z) => out.push({ x, z }), count);
  return out;
};

const distToCore = (px: number, pz: number, s: ClaimShape): number =>
  s.shape === 'disc'
    ? arcBetween(px, pz, s.x, s.z)
    : arcToRun(px, pz, s.x1, s.z1, s.x2, s.z2);

/**
 * **How far outside a claim's ground a point lies**, in metres — zero or
 * negative when the point is on it.
 *
 * Exported because it is the one honest way to ask "is this vertex of the
 * drawn mesh on the ground the registry claims?", and two measurement sites
 * need to ask it: `scripts/check-ground-claims.mts` on the canonical seed and
 * `test/procgen/invariants.ts` on every pool seed. Asking it here rather than
 * re-deriving the point-to-capsule distance in each is the difference between
 * one owner and this repo's most expensive habit.
 *
 * It is also the reason the curved road can be checked at all. An axis-aligned
 * ribbon can be compared by its bounding box; an arc's cannot, because the
 * box of a bent capsule is mostly ground the capsule does not hold. This
 * measures the claim's own shape instead of a box around it.
 *
 * ## Why this one stayed in the chart when the registry moved to the sphere
 *
 * **Because it compares a claim against a MESH, and the mesh is still authored
 * in the chart.** Every other distance in this file compares one claim with
 * another, and those are the registry's own decisions — they moved to geodesic
 * arithmetic, and `claimSurface.ts` says why. This one answers a different
 * question, and answering it in arc metres would compare two different metrics.
 *
 * Measured, on the canonical seed, when it was briefly switched over: the road
 * is drawn **3.89 m wide in chart metres**, and at the kerb's reach of 108.7 m
 * from the park's centre that is **4.50 m of real ground** — so a vertex lying
 * exactly on the drawn kerb reads 0.611 m outside an arc-metre claim, and
 * `check:ground-claims` failed at 0.5155 m on a road that had not moved.
 *
 * The check was right and the kernel was right; the mesh is the thing that is
 * wrong. `Entrance.ts` builds the ribbon from chart coordinates with a constant
 * chart half-width, so **the drawn road silently widens as it runs outward** —
 * about 16% at the kerb's reach. That is a real artefact of drawing on the
 * planet's shadow, it belongs to the road's own lane rather than to the
 * registry, and it is not something to hide by loosening a tolerance here.
 *
 * **So this is a stated, temporary split, not a permanent one.** When the road
 * (and every other ribbon) is drawn on the sphere — geodesic centreline,
 * arc-metre width — this must move to `distToCore` with the rest, and the two
 * metrics become one again. Until then, mixing them would make every drawn-mesh
 * check disagree with the ground it measures by a margin that grows with radius.
 */
export const distanceOutside = (px: number, pz: number, s: ClaimShape): number =>
  chartDistToCore(px, pz, s) - reachOf(s);

/**
 * The chart-space form of {@link distToCore}, for {@link distanceOutside} only.
 * Plane geometry on purpose — see that function's docblock for the measurement
 * that says why, and for what has to happen before it can go.
 */
const chartDistToCore = (px: number, pz: number, s: ClaimShape): number => {
  if (s.shape === 'disc') return Math.hypot(px - s.x, pz - s.z);
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const lenSq = dx * dx + dz * dz;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (pz - s.z1) * dz) / lenSq));
  return Math.hypot(px - (s.x1 + t * dx), pz - (s.z1 + t * dz));
};

/**
 * Is the shared ground of two overlapping shapes confined to the crossing's
 * disc? Marched, not witnessed: every core sample of either shape that is
 * within combined reach of the other's core — i.e. every place the two
 * actually share ground — must itself sit inside the zone. Deliberately
 * strict in the deny direction: the sample point is the *core*, so an
 * overlap whose core run leaves the zone is refused even if some of its
 * spread-width would have squeaked in.
 */
const overlapConfinedToZone = (
  a: ClaimShape,
  b: ClaimShape,
  zone: { readonly x: number; readonly z: number; readonly radius: number },
): boolean => {
  const reach = reachOf(a) + reachOf(b);
  // Fine enough that an overlapping run cannot slip between samples: half the
  // smaller of the reaches involved, floored so a zero-width claim cannot ask
  // for infinite samples.
  const step = Math.max(0.05, Math.min(reachOf(a), reachOf(b), zone.radius) / 2);
  for (const [self, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const p of coreSamples(self, step)) {
      if (distToCore(p.x, p.z, other) >= reach) continue; // no shared ground here
      if (arcBetween(p.x, p.z, zone.x, zone.z) > zone.radius) return false;
    }
  }
  return true;
};

/** Do two claim shapes share any ground? */
export const shapesOverlap = (a: ClaimShape, b: ClaimShape): boolean =>
  coreDistance(a, b) < reachOf(a) + reachOf(b);

/** Cheap per-axis bounds, so most pairs are dismissed without a hypot. */
const bounds = (s: ClaimShape): readonly [number, number, number, number] =>
  s.shape === 'disc'
    ? [
        s.x - s.radius - CLAIM_BROAD_PHASE_SLACK,
        s.z - s.radius - CLAIM_BROAD_PHASE_SLACK,
        s.x + s.radius + CLAIM_BROAD_PHASE_SLACK,
        s.z + s.radius + CLAIM_BROAD_PHASE_SLACK,
      ]
    : boundsOfRun(s.x1, s.z1, s.x2, s.z2, s.halfWidth);

interface Contribution {
  readonly claims: readonly Claim[];
  readonly claimBounds: readonly (readonly [number, number, number, number])[];
  readonly crossings: readonly Crossing[];
  readonly demands: readonly Demand[];
  /** Commit order, so refusals are reported deterministically. */
  readonly order: number;
  /**
   * The feature's contribution is the concatenation of its **sections**, in
   * section order — one per increment the feature builder placed — so a
   * backtrack can withdraw exactly the increment it is undoing (a claim must
   * be unwindable to the decision that caused it). A whole-feature `commit`
   * is section 0 alone.
   */
  readonly sections: ReadonlyMap<number, FeatureContribution>;
  /** Which section each entry of `claims` came from, so a blocker can be named by increment. */
  readonly claimSections: readonly number[];
}

/** What a feature publishes when it commits: its claims, and optionally the
 * crossings it has negotiated and the demands it is owed. */
export interface FeatureContribution {
  readonly claims: readonly Claim[];
  readonly crossings?: readonly Crossing[];
  readonly demands?: readonly Demand[];
}

/**
 * The registry. One instance per park generation; placers commit, withdraw
 * and ask — and there is deliberately no way to ask it "is this kind of
 * obstacle here?", only "may I put *this* here?".
 */
export class GroundClaims {
  private readonly contributions = new Map<string, Contribution>();
  private commitClock = 0;

  commit(feature: string, contribution: FeatureContribution): void {
    this.setSections(feature, new Map([[0, contribution]]));
  }

  /** Commit (or replace) one section of a feature's contribution — one increment's claims. */
  commitSection(feature: string, section: number, contribution: FeatureContribution): void {
    const sections = new Map(this.contributions.get(feature)?.sections ?? []);
    sections.set(section, contribution);
    this.setSections(feature, sections);
  }

  /** Withdraw one section; the feature's other increments stay committed. */
  withdrawSection(feature: string, section: number): void {
    const existing = this.contributions.get(feature);
    if (!existing) return;
    const sections = new Map(existing.sections);
    sections.delete(section);
    if (sections.size === 0) {
      this.contributions.delete(feature);
      return;
    }
    this.setSections(feature, sections);
  }

  /** The section (increment) that committed claim `index` of `feature`, or -1. */
  sectionOfClaim(feature: string, index: number): number {
    return this.contributions.get(feature)?.claimSections[index] ?? -1;
  }

  /** The sections `feature` has committed, ascending. */
  sectionsOf(feature: string): number[] {
    return [...(this.contributions.get(feature)?.sections.keys() ?? [])].sort((a, b) => a - b);
  }

  /**
   * Which of `feature`'s claims (by index) refuse `claim` — what a builder
   * asked to accommodate needs to know: which of its own increments is in the
   * way.
   */
  refusingClaimIndices(asker: string, feature: string, claim: Claim): number[] {
    const contribution = this.contributions.get(feature);
    if (!contribution) return [];
    const out: number[] = [];
    const [minX, minZ, maxX, maxZ] = bounds(claim.shape);
    for (let i = 0; i < contribution.claims.length; i += 1) {
      const other = contribution.claims[i] as Claim;
      const rule = CLAIM_COMPATIBILITY[claim.kind][other.kind];
      if (rule === true) continue;
      const [oMinX, oMinZ, oMaxX, oMaxZ] = contribution.claimBounds[i] as readonly [
        number,
        number,
        number,
        number,
      ];
      if (oMinX > maxX || oMaxX < minX || oMinZ > maxZ || oMaxZ < minZ) continue;
      if (!shapesOverlap(claim.shape, other.shape)) continue;
      if (rule === 'crossing' && this.overlapInsideDeclaredCrossing(asker, feature, claim.shape, other.shape)) {
        continue;
      }
      out.push(i);
    }
    return out;
  }

  private setSections(feature: string, sections: Map<number, FeatureContribution>): void {
    const order = this.contributions.get(feature)?.order ?? this.commitClock++;
    const claims: Claim[] = [];
    const claimSections: number[] = [];
    const crossings: Crossing[] = [];
    const demands: Demand[] = [];
    for (const section of [...sections.keys()].sort((a, b) => a - b)) {
      const contribution = sections.get(section) as FeatureContribution;
      for (const claim of contribution.claims) {
        claims.push(claim);
        claimSections.push(section);
      }
      crossings.push(...(contribution.crossings ?? []));
      demands.push(...(contribution.demands ?? []));
    }
    this.contributions.set(feature, {
      claims,
      claimBounds: claims.map((c) => bounds(c.shape)),
      crossings,
      demands,
      order,
      sections,
      claimSections,
    });
  }

  /** Remove a feature's contribution entirely — the backtrack. */
  withdraw(feature: string): void {
    this.contributions.delete(feature);
  }

  has(feature: string): boolean {
    return this.contributions.has(feature);
  }

  /**
   * Every section a feature has committed, in section order — what a prebuilt
   * park records so that it can commit exactly the same contributions again
   * (`world/prebuilt/parkFile.ts`).
   */
  contributionsOf(feature: string): readonly (readonly [number, FeatureContribution])[] {
    const sections = this.contributions.get(feature)?.sections;
    if (!sections) return [];
    return [...sections.entries()].sort((a, b) => a[0] - b[0]);
  }

  /** Committed features in the order they first committed — the order `blockers` ranks by. */
  featuresInCommitOrder(): string[] {
    return [...this.contributions.entries()].sort((a, b) => a[1].order - b[1].order).map(([name]) => name);
  }

  committedFeatures(): string[] {
    return [...this.contributions.keys()];
  }

  claimsOf(feature: string): readonly Claim[] {
    return this.contributions.get(feature)?.claims ?? [];
  }

  demandsOf(feature: string): readonly Demand[] {
    return this.contributions.get(feature)?.demands ?? [];
  }

  /**
   * May `claim`, made by `feature`, share the ground it wants?
   *
   * Checks against every committed claim of every *other* feature (a feature
   * never collides with itself through the registry — its internal geometry
   * is its own business), under {@link CLAIM_COMPATIBILITY}, with
   * corridor-versus-corridor legal only inside a declared crossing between
   * the two features.
   */
  allows(feature: string, claim: Claim): boolean {
    return this.refusalOf(feature, claim) === null;
  }

  /**
   * Every distinct feature refusing any of `claims`, in commit order —
   * the backjumping hint: the search withdraws one of these, never a random
   * committed neighbour.
   */
  blockers(feature: string, claims: readonly Claim[]): readonly Refusal[] {
    const seen = new Map<string, Refusal>();
    for (const claim of claims) {
      for (const refusal of this.refusalsOf(feature, claim)) {
        if (!seen.has(refusal.feature)) seen.set(refusal.feature, refusal);
      }
    }
    return [...seen.values()].sort(
      (a, b) =>
        (this.contributions.get(a.feature) as Contribution).order -
        (this.contributions.get(b.feature) as Contribution).order,
    );
  }

  /**
   * Demands nobody's corridor serves yet, labelled by owner. The search must
   * drive this to empty before the park may be declared finished; each entry
   * names the door or spot so the bounded-budget failure can say *which*
   * child-facing place could not be reached.
   */
  unservedDemands(): readonly { readonly feature: string; readonly demand: Demand }[] {
    const out: { feature: string; demand: Demand }[] = [];
    for (const [feature, contribution] of this.contributions) {
      for (const demand of contribution.demands) {
        if (!this.demandServed(feature, demand)) out.push({ feature, demand });
      }
    }
    return out;
  }

  // ------------------------------------------------------------- internals

  /** See {@link Demand}: another feature's corridor, terminating in the disc. */
  private demandServed(owner: string, demand: Demand): boolean {
    for (const [feature, contribution] of this.contributions) {
      if (feature === owner) continue;
      for (const claim of contribution.claims) {
        if (claim.kind !== 'corridor') continue;
        const ends =
          claim.shape.shape === 'disc'
            ? [[claim.shape.x, claim.shape.z] as const]
            : [
                [claim.shape.x1, claim.shape.z1] as const,
                [claim.shape.x2, claim.shape.z2] as const,
              ];
        for (const [x, z] of ends) {
          if (arcBetween(x, z, demand.x, demand.z) < demand.radius) return true;
        }
      }
    }
    return false;
  }

  private refusalOf(feature: string, claim: Claim): Refusal | null {
    for (const refusal of this.refusalsOf(feature, claim)) return refusal;
    return null;
  }

  private *refusalsOf(feature: string, claim: Claim): Generator<Refusal, void, void> {
    const [minX, minZ, maxX, maxZ] = bounds(claim.shape);
    for (const [otherName, contribution] of this.contributions) {
      if (otherName === feature) continue;
      for (let i = 0; i < contribution.claims.length; i += 1) {
        const other = contribution.claims[i] as Claim;
        const rule = CLAIM_COMPATIBILITY[claim.kind][other.kind];
        if (rule === true) continue;
        const [oMinX, oMinZ, oMaxX, oMaxZ] = contribution.claimBounds[i] as readonly [
          number,
          number,
          number,
          number,
        ];
        if (oMinX > maxX || oMaxX < minX || oMinZ > maxZ || oMaxZ < minZ) continue;
        if (!shapesOverlap(claim.shape, other.shape)) continue;
        if (
          rule === 'crossing' &&
          this.overlapInsideDeclaredCrossing(feature, otherName, claim.shape, other.shape)
        ) {
          continue;
        }
        yield { feature: otherName, kind: other.kind };
        break; // one refusal per refusing feature is enough for any caller
      }
    }
  }

  /**
   * Is the overlap between two corridor shapes confined to a crossing the two
   * features have declared with each other? Either side's declaration counts —
   * a crossing is one fact, and the negotiation that produced it may have been
   * published by either party.
   */
  private overlapInsideDeclaredCrossing(
    a: string,
    b: string,
    shapeA: ClaimShape,
    shapeB: ClaimShape,
  ): boolean {
    for (const name of [a, b]) {
      const contribution = this.contributions.get(name);
      if (!contribution) continue;
      for (const crossing of contribution.crossings) {
        const pair = crossing.between;
        const matches =
          (pair[0] === a && pair[1] === b) || (pair[0] === b && pair[1] === a);
        if (!matches) continue;
        // The WHOLE overlap must sit inside the declared zone. A single
        // deepest-overlap witness is not enough: for two parallel lanes the
        // closest approach is a tie along the entire shared run, and
        // whichever tie-break wins can land inside a zone the overlap merely
        // grazes — the unit test 'a parallel lane-share that grazes the
        // crossing zone is still refused' is the case that killed the
        // witness version.
        if (overlapConfinedToZone(shapeA, shapeB, crossing)) return true;
      }
    }
    return false;
  }
}
