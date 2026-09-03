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

const distPointSegment = (
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number => {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
};

const segmentsCross = (a: Capsule, b: Capsule): boolean => {
  const d = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
    (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(b.x1, b.z1, b.x2, b.z2, a.x1, a.z1);
  const d2 = d(b.x1, b.z1, b.x2, b.z2, a.x2, a.z2);
  const d3 = d(a.x1, a.z1, a.x2, a.z2, b.x1, b.z1);
  const d4 = d(a.x1, a.z1, a.x2, a.z2, b.x2, b.z2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** The shortest distance between two shapes' cores (centres/segments). */
const coreDistance = (a: ClaimShape, b: ClaimShape): number => {
  if (a.shape === 'disc' && b.shape === 'disc') return Math.hypot(a.x - b.x, a.z - b.z);
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
  const length = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
  const count = Math.max(1, Math.ceil(length / step));
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    out.push({ x: s.x1 + t * (s.x2 - s.x1), z: s.z1 + t * (s.z2 - s.z1) });
  }
  return out;
};

const distToCore = (px: number, pz: number, s: ClaimShape): number =>
  s.shape === 'disc'
    ? Math.hypot(px - s.x, pz - s.z)
    : distPointSegment(px, pz, s.x1, s.z1, s.x2, s.z2);

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
      if (Math.hypot(p.x - zone.x, p.z - zone.z) > zone.radius) return false;
    }
  }
  return true;
};

/** Do two claim shapes share any ground? */
export const shapesOverlap = (a: ClaimShape, b: ClaimShape): boolean =>
  coreDistance(a, b) < reachOf(a) + reachOf(b);

/**
 * How deeply two shapes share ground, in metres — positive when they overlap,
 * negative when clear by that much. Exported so a check reporting a violation
 * carries a real measurement, computed by the same owner that decided the
 * overlap existed — never a second hand-written distance formula that can
 * drift from this one.
 */
export const overlapDepth = (a: ClaimShape, b: ClaimShape): number =>
  reachOf(a) + reachOf(b) - coreDistance(a, b);

/** Cheap per-axis bounds, so most pairs are dismissed without a hypot. */
const bounds = (s: ClaimShape): readonly [number, number, number, number] =>
  s.shape === 'disc'
    ? [s.x - s.radius, s.z - s.radius, s.x + s.radius, s.z + s.radius]
    : [
        Math.min(s.x1, s.x2) - s.halfWidth,
        Math.min(s.z1, s.z2) - s.halfWidth,
        Math.max(s.x1, s.x2) + s.halfWidth,
        Math.max(s.z1, s.z2) + s.halfWidth,
      ];

interface Contribution {
  readonly claims: readonly Claim[];
  readonly claimBounds: readonly (readonly [number, number, number, number])[];
  readonly crossings: readonly Crossing[];
  readonly demands: readonly Demand[];
  /** Commit order, so refusals are reported deterministically. */
  readonly order: number;
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
    const order = this.contributions.get(feature)?.order ?? this.commitClock++;
    this.contributions.set(feature, {
      claims: contribution.claims,
      claimBounds: contribution.claims.map((c) => bounds(c.shape)),
      crossings: contribution.crossings ?? [],
      demands: contribution.demands ?? [],
      order,
    });
  }

  /** Remove a feature's contribution entirely — the backtrack. */
  withdraw(feature: string): void {
    this.contributions.delete(feature);
  }

  has(feature: string): boolean {
    return this.contributions.has(feature);
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
          if (Math.hypot(x - demand.x, z - demand.z) < demand.radius) return true;
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
