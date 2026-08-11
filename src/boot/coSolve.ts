/**
 * **Cooperative backtracking: features that solve *at once* and make way for each
 * other.**
 *
 * `solveScheduler.ts` round-robins independent tasks a slice at a time, but its
 * tasks cannot touch each other — a dependency must be `done` before a dependent
 * starts, and nothing a task commits is ever taken back. That is the right
 * substrate for work with a one-way flow (the boundary, then the layout, then a
 * route grown against it), and its own doc names the thing it is *not*:
 *
 * > It round-robins independent tasks; it does not (yet) let one feature
 * > *backtrack another* — move a stall so a route fits. That is a joint search
 * > over a shared configuration, a larger thing built on top of this.
 *
 * This is that larger thing. The family's ask, 11 August 2026:
 *
 * > *"The tracks and other features are not generated individually one at a time
 * > but as an overall problem space search across all features ... they should
 * > all solve at once and backtrack for each other by different features round
 * > robining ... a backtrack may be one possible move."*
 *
 * So a {@link CoSolveFeature} does not solve against a *finished* layout handed
 * down to it; it solves against a **shared, mutable** {@link PlacementField} that
 * every other feature is writing at the same time. When a feature cannot fit
 * given what its neighbours have currently claimed, the engine does not give up —
 * it **withdraws a committed neighbour** and asks it to try elsewhere, freeing the
 * ground the stuck feature needs. The railway making a stall step aside, rather
 * than threading a gap the stall never knew to leave, is the shape of this.
 *
 * ### The search, precisely
 *
 * Each feature is a resumable generator that searches for its own placement — a
 * set of keep-out {@link Obstacle} discs it will contribute to the field —
 * against everything currently committed *except its own contribution*. The
 * engine round-robins every not-yet-committed feature, advancing each one slice
 * (one `next()`) per turn, so they genuinely progress together across frames.
 * Three things can come back from a slice:
 *
 * - **a yield** — still searching, take a turn later;
 * - **a return** — a candidate placement. The engine re-checks it against the
 *   field *as it stands now* (a neighbour may have committed into that ground
 *   since this feature last looked) and, if it is still clear, commits it. If it
 *   is not, the feature is restarted with a higher `attempt` so it searches
 *   differently — optimistic concurrency, the cheap case;
 * - **a throw of {@link CoSolveUnsolvable}** — nothing fits the committed field
 *   at all. *This* is where a neighbour is backtracked: the engine picks a
 *   committed blocker (see {@link CoSolveFeature.blockers}), withdraws it,
 *   restarts it at a higher `attempt`, and restarts the stuck feature too. One
 *   backtrack move, exactly as asked.
 *
 * ### Why it is deterministic, and why the frame budget cannot move the park
 *
 * The same argument `rail/generate.ts` and `solveScheduler.ts` make, extended to
 * a shared store. The order of `(feature, step)` turns is fixed by the rotating
 * cursor and the generators alone — **it is a function of step counts, never of
 * the clock.** A slice budget decides only how many turns happen before
 * `advance()` returns; it never changes which turn is next, nor what a generator
 * computes on it (a generator returns after the same number of `next()`s whatever
 * the budget). Commits therefore land in a fixed order, conflicts are detected at
 * fixed points, and backtrack choices are deterministic — so the field the search
 * settles on is identical whether it was solved in one slice or ten thousand, on
 * a phone or a laptop. `check:park-boot`'s "sliced equals straight-through" proof
 * is what pins this down for real features once they are ported.
 *
 * Unlike the scheduler, the co-solved result is **not** the same as any
 * one-at-a-time solve — that is the whole point of co-solving — but it *is* the
 * same every boot, which is what determinism has to mean here.
 *
 * ### Termination
 *
 * A backtrack could in principle chase its own tail, so the engine caps the total
 * number of backtracks and fails loudly when the cap is hit, naming the feature
 * that could not be placed. The cap is generous — a real park settles in a
 * handful of backtracks — and its purpose is only to turn a pathological seed into
 * a clean failure rather than a hang, the same role the ladder's "every rung
 * failed" throw plays in the rail solvers.
 */

/** A keep-out disc a feature contributes to the shared field. */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  /** How far a neighbour's own geometry must stay from this point. */
  readonly reach: number;
}

/**
 * Thrown by a feature's search when nothing fits the committed field — the signal
 * that a neighbour must make way. Distinct from any other error so the engine
 * only backtracks on a genuine "no room", never on a bug.
 */
export class CoSolveUnsolvable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoSolveUnsolvable';
  }
}

/**
 * The shared configuration every feature solves against: a set of keep-out discs
 * keyed by the feature that contributed them.
 *
 * A feature's own contribution is excluded from the queries it makes (a route
 * does not collide with itself through the field), which is why {@link clear}
 * takes the asking feature's name.
 */
export class PlacementField {
  private readonly contributions = new Map<string, readonly Obstacle[]>();

  /** Replace `feature`'s contribution with `obstacles`. */
  commit(feature: string, obstacles: readonly Obstacle[]): void {
    this.contributions.set(feature, obstacles);
  }

  /** Remove `feature`'s contribution entirely — the backtrack. */
  withdraw(feature: string): void {
    this.contributions.delete(feature);
  }

  /** Is `feature` currently contributing to the field? */
  has(feature: string): boolean {
    return this.contributions.has(feature);
  }

  /** Every feature currently contributing, in no particular order. */
  committedFeatures(): string[] {
    return [...this.contributions.keys()];
  }

  /** The obstacles `feature` contributed, or an empty list. */
  obstaclesOf(feature: string): readonly Obstacle[] {
    return this.contributions.get(feature) ?? [];
  }

  /**
   * Is a disc of `radius` about `(x, z)` clear of every committed obstacle
   * except those contributed by `exclude`?
   *
   * The `hypot(dx, dz) < reach + radius` overlap test, with the same per-axis
   * prefilter the layout scans use — most obstacles are a whole axis out of reach
   * of the point being asked about, and this is asked on every metre of every
   * candidate piece.
   */
  clear(x: number, z: number, radius: number, exclude?: string): boolean {
    for (const [feature, obstacles] of this.contributions) {
      if (feature === exclude) continue;
      for (const o of obstacles) {
        const reach = o.reach + radius;
        const dx = x - o.x;
        if (dx >= reach || -dx >= reach) continue;
        const dz = z - o.z;
        if (dz >= reach || -dz >= reach) continue;
        if (Math.hypot(dx, dz) < reach) return false;
      }
    }
    return true;
  }
}

/**
 * A feature that co-solves against the shared field.
 *
 * Its whole search lives in the generator {@link place} returns, so the engine
 * can suspend it between any two joints — that is what makes it a *slice*. It is
 * restartable: called again with a higher `attempt` after a conflict or a
 * backtrack, it must search *differently* (salt its randomness with `attempt`)
 * so the retry explores new ground rather than re-deriving the placement that
 * just failed.
 */
export interface CoSolveFeature {
  readonly name: string;

  /**
   * Names of features that must be committed before this one may start — and
   * which, if one is later backtracked, drag this feature back into the search
   * with them (see {@link CoSolveEngine}'s cascade). Use it when a feature
   * genuinely *reads* another's committed placement rather than merely avoiding
   * it: the ride that samples the cruiser's built low corridor depends on the
   * cruiser; a ride that only keeps clear of the plots does not. Ordering-only
   * avoidance (largest-first, say) is a dep too — it just never needs the
   * cascade, because a re-placed neighbour it only avoided is picked up by the
   * ordinary conflict re-check.
   */
  readonly deps?: readonly string[];

  /**
   * Search for a placement against `field`, ignoring this feature's own
   * contribution (query the field with `exclude: this.name`). Yields a progress
   * number for reporting; returns the keep-out discs to commit; throws
   * {@link CoSolveUnsolvable} when nothing fits the committed field.
   *
   * `attempt` starts at 0 and rises by one every time the engine restarts this
   * feature.
   */
  place(field: PlacementField, attempt: number): Generator<number, readonly Obstacle[], void>;

  /**
   * When this feature is stuck, which committed neighbours to consider
   * withdrawing — most promising first. The engine backtracks the first one that
   * is currently committed. Defaults to *every* committed feature, most-recently
   * committed first (the classic chronological backtrack), which needs no
   * per-feature knowledge and always makes progress.
   */
  blockers?(field: PlacementField): readonly string[];
}

/** A clock, injected so the engine is testable without `performance.now()`. */
export type Clock = () => number;

interface FeatureState {
  readonly feature: CoSolveFeature;
  gen: Generator<number, readonly Obstacle[], void> | null;
  attempt: number;
  committed: boolean;
  /** Order index stamped when committed, for chronological backtracking. */
  committedAt: number;
  steps: number;
  restarts: number;
}

export interface CoSolveOptions {
  /** Max backtracks before the search is declared a failure. Default 1000. */
  readonly maxBacktracks?: number;
  readonly now?: Clock;
}

/**
 * Round-robins {@link CoSolveFeature}s against a shared {@link PlacementField},
 * backtracking a committed neighbour when one is stuck. See the file header.
 */
export class CoSolveEngine {
  readonly field = new PlacementField();

  private readonly states: readonly FeatureState[];
  private readonly byName: Map<string, FeatureState>;
  private readonly now: Clock;
  private readonly maxBacktracks: number;

  private cursor = 0;
  private failure: Error | null = null;
  private backtrackCount = 0;
  private commitClock = 0;

  private overrunSlices = 0;
  private readonly overrunByFeature: Record<string, number> = {};

  constructor(features: readonly CoSolveFeature[], options: CoSolveOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.maxBacktracks = options.maxBacktracks ?? 1000;
    this.states = features.map((feature) => ({
      feature,
      gen: null,
      attempt: 0,
      committed: false,
      committedAt: -1,
      steps: 0,
      restarts: 0,
    }));
    this.byName = new Map(this.states.map((state) => [state.feature.name, state]));
    if (this.byName.size !== this.states.length) {
      throw new Error('CoSolveEngine: two features share a name');
    }
    for (const state of this.states) {
      for (const dep of state.feature.deps ?? []) {
        if (!this.byName.has(dep)) {
          throw new Error(
            `CoSolveEngine: feature '${state.feature.name}' depends on unknown feature '${dep}'`,
          );
        }
      }
    }
    this.assertNoCycles();
  }

  /** Every feature has a committed placement. */
  get done(): boolean {
    return this.states.every((state) => state.committed);
  }

  /** The error that ended the search, if one did (a bug, or the backtrack cap). */
  get failed(): Error | null {
    return this.failure;
  }

  /** How many backtracks the search has made — a neighbour withdrawn to make room. */
  get backtracks(): number {
    return this.backtrackCount;
  }

  /** How many slices each feature has had. Device-independent piece counts. */
  get sliceCounts(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const state of this.states) out[state.feature.name] = state.steps;
    return out;
  }

  /** How many times each feature was restarted (conflict retry or backtrack). */
  get restartCounts(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const state of this.states) out[state.feature.name] = state.restarts;
    return out;
  }

  /** The features committed, in the order they committed — the search's story. */
  get committedOrder(): readonly string[] {
    return this.states
      .filter((state) => state.committed)
      .sort((a, b) => a.committedAt - b.committedAt)
      .map((state) => state.feature.name);
  }

  /** Slices begun after a frame's deadline. Zero, on correct code. */
  get slicesPastDeadline(): number {
    return this.overrunSlices;
  }

  /** Which features began a slice late — the diagnosis, not just the count. */
  get lateSlicesByFeature(): Readonly<Record<string, number>> {
    return this.overrunByFeature;
  }

  /**
   * Advance the joint search for up to `budgetMs`, round-robining every
   * uncommitted feature a slice at a time. Safe to call after it is done or has
   * failed. The clock is read only to bound the frame — never to decide what
   * happens next — so the result does not depend on it.
   */
  advance(budgetMs: number): void {
    if (this.failure || this.done) return;
    const deadline = this.now() + budgetMs;
    let sliced = 0;
    for (;;) {
      const state = this.nextRunnable();
      if (!state) return; // everything committed, or the search has failed
      if (sliced > 0 && this.now() >= deadline) {
        this.overrunSlices += 1;
        this.overrunByFeature[state.feature.name] =
          (this.overrunByFeature[state.feature.name] ?? 0) + 1;
      }
      sliced += 1;
      this.step(state);
      if (this.failure) return;
      if (this.now() >= deadline) return;
    }
  }

  // -------------------------------------------------------------- internals

  /** One slice of one feature: advance its search and act on the result. */
  private step(state: FeatureState): void {
    try {
      if (!state.gen) state.gen = state.feature.place(this.field, state.attempt);
      const result = state.gen.next();
      state.steps += 1;
      if (!result.done) return; // still searching

      // A candidate placement. Re-check it against the field as it stands now —
      // a neighbour may have committed into this ground since the search last
      // looked — and either commit it or retry differently.
      const placement = result.value;
      if (this.placementFits(state, placement)) {
        this.field.commit(state.feature.name, placement);
        state.committed = true;
        state.committedAt = this.commitClock++;
        state.gen = null;
      } else {
        this.restart(state); // optimistic-concurrency conflict: search again
      }
    } catch (error) {
      if (error instanceof CoSolveUnsolvable) {
        this.backtrackFor(state);
      } else {
        this.failure = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  /** Does every disc of `placement` clear the committed field (bar its own)? */
  private placementFits(state: FeatureState, placement: readonly Obstacle[]): boolean {
    for (const o of placement) {
      if (!this.field.clear(o.x, o.z, o.reach, state.feature.name)) return false;
    }
    return true;
  }

  /** Restart a feature's search at a higher attempt so it explores anew. */
  private restart(state: FeatureState): void {
    state.gen = null;
    state.attempt += 1;
    state.restarts += 1;
  }

  /**
   * A feature could not fit at all — withdraw a committed neighbour to make room,
   * then restart both. Fails when there is nothing to backtrack or the cap is hit.
   */
  private backtrackFor(stuck: FeatureState): void {
    if (this.backtrackCount >= this.maxBacktracks) {
      this.failure = new CoSolveUnsolvable(
        `co-solve gave up after ${this.backtrackCount} backtracks: '${stuck.feature.name}' ` +
          `could not be placed`,
      );
      return;
    }

    const victimName = this.pickBlocker(stuck);
    if (!victimName) {
      // Nothing is committed to make way — the feature genuinely cannot be placed
      // against an empty field, which is a design fault, not a scheduling one.
      this.failure = new CoSolveUnsolvable(
        `co-solve cannot place '${stuck.feature.name}': it fits nowhere and no committed ` +
          `feature stands in its way to move`,
      );
      return;
    }

    const victim = this.byName.get(victimName) as FeatureState;
    this.withdraw(victim);
    this.restart(victim); // try a different spot for the one that was in the way

    // The stuck feature's world just changed; give it a fresh search too.
    this.restart(stuck);
    this.backtrackCount += 1;
  }

  /**
   * Withdraw a committed feature, and with it every committed feature that
   * depends on it — directly or transitively.
   *
   * A dependent read its dep's placement to solve; if the dep moves, the
   * dependent's solution may no longer hold, so it must re-solve rather than
   * stay committed against ground that shifted under it. Dependents keep their
   * `attempt` (only the feature actually asked to move is bumped): if the dep
   * re-commits to the same spot they re-derive the same placement, and deps
   * ordering guarantees the dep is committed again before a dependent re-runs.
   */
  private withdraw(state: FeatureState): void {
    this.field.withdraw(state.feature.name);
    state.committed = false;
    state.committedAt = -1;
    state.gen = null;
    for (const other of this.states) {
      if (other.committed && (other.feature.deps ?? []).includes(state.feature.name)) {
        this.withdraw(other);
      }
    }
  }

  /**
   * Which committed neighbour to withdraw for `stuck`. The feature's own
   * {@link CoSolveFeature.blockers} hint first, filtered to those actually
   * committed; failing that, the most-recently-committed feature (chronological
   * backtracking, which always makes progress).
   */
  private pickBlocker(stuck: FeatureState): string | null {
    const hinted = stuck.feature.blockers?.(this.field) ?? [];
    for (const name of hinted) {
      const state = this.byName.get(name);
      if (state?.committed) return name;
    }
    let latest: FeatureState | null = null;
    for (const state of this.states) {
      if (state === stuck || !state.committed) continue;
      if (!latest || state.committedAt > latest.committedAt) latest = state;
    }
    return latest?.feature.name ?? null;
  }

  /**
   * The next feature to give a slice to, from the rotating cursor: any that is
   * uncommitted and whose {@link CoSolveFeature.deps} are all committed. A
   * committed feature is skipped; a withdrawn one (and any dependent the cascade
   * pulled down with it) is uncommitted again and so back in the rotation, but
   * only becomes runnable once its deps have re-committed.
   */
  private nextRunnable(): FeatureState | null {
    const n = this.states.length;
    for (let i = 0; i < n; i += 1) {
      const index = (this.cursor + i) % n;
      const state = this.states[index] as FeatureState;
      if (!state.committed && this.depsReady(state)) {
        this.cursor = (index + 1) % n;
        return state;
      }
    }
    return null;
  }

  /** Are all of a feature's dependencies currently committed? */
  private depsReady(state: FeatureState): boolean {
    for (const dep of state.feature.deps ?? []) {
      if (!(this.byName.get(dep) as FeatureState).committed) return false;
    }
    return true;
  }

  /** Kahn's algorithm: a bad dependency graph fails loudly at construction. */
  private assertNoCycles(): void {
    const indegree = new Map<string, number>();
    for (const state of this.states) indegree.set(state.feature.name, 0);
    for (const state of this.states) {
      indegree.set(state.feature.name, (state.feature.deps ?? []).length);
    }
    const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([name]) => name);
    let visited = 0;
    while (queue.length > 0) {
      const name = queue.pop() as string;
      visited += 1;
      for (const state of this.states) {
        if ((state.feature.deps ?? []).includes(name)) {
          const left = (indegree.get(state.feature.name) as number) - 1;
          indegree.set(state.feature.name, left);
          if (left === 0) queue.push(state.feature.name);
        }
      }
    }
    if (visited !== this.states.length) {
      throw new Error('CoSolveEngine: the feature dependency graph has a cycle');
    }
  }
}
