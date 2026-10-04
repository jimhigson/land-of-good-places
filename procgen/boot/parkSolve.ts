/**
 * **The round-robin driver with backtracking** — the one loop that builds a
 * park out of {@link FeatureBuilder}s, and the only place that knows how a
 * refusal is answered.
 *
 * Jim, 16 Sep 2026: *"the backtracking round-robin procgen that works for
 * literally every seed, because in the worst case it backtracks to zero …
 * just the existing looping, but with the ability to backtrack."*
 *
 * ## The loop
 *
 * Builders are listed in a **fixed order**; each turn gives the next builder
 * whose dependencies are done one `advance`. An increment that places is
 * committed to the claims registry as its own section and appended to the
 * **ledger** — the ordered list of decisions this park has made, each with the
 * attempt it was made at. A refusal climbs a ladder, cheapest rung first:
 *
 * 1. **retry** — the same increment at its next attempt, while the builder
 *    has attempts to offer (`supply`);
 * 2. **accommodate** — each blocker that may move for this feature is asked,
 *    once, to shift the one increment in the way (its own builder decides
 *    where, within its own rules). Movable features (trees, lamps, benches…)
 *    always may; a heavier feature may only if it comes *later* in the build
 *    order than the refused one — the earlier feature needs the space more.
 *    Bounded: one ask per blocker per refusal, {@link MAX_ACCOMMODATIONS}
 *    per increment, never recursive;
 * 2b. **forgo** — an increment its builder marked optional (a lamp slot, a
 *    fairy pole) is left out once the two rungs above have failed, and the
 *    builder moves on; a decoration never unwinds a structure;
 * 3. **unwind** — pop the ledger back to the most recent decision among the
 *    blockers (or the decisions the refused search consumed), `back` every
 *    increment after it in reverse, redraw that decision at its next attempt
 *    and replay forward. A decision with no attempts left is popped too;
 * 4. **decision zero** — the ledger's first entry (the layout's first draw).
 *    Redrawing it is a different park from the same seed — equivalent to
 *    another seed, which is the point. Counted, printed, never silent.
 *
 * ## Termination — bounded, not merely finite
 *
 * The state is the vector of attempts along the ledger. Every unwind bumps
 * one position and resets every later position to zero — a strict increase in
 * lexicographic order over a finite space. **Finite was not enough**: that
 * space is the product of every decision's supply (240 layouts x 6 cruisers x
 * 6 trains x 121 arch stations x ...), and a refusal no redraw can answer
 * walks it. Measured (fix/sb-bounded): with `barSlotWithNoSupportRoom` made to
 * find no room, seed 15 restart 0 spent 480 s on 38 layout redraws, 64 unwinds
 * and 18 identical road refusals, and was nowhere near either cap — the old
 * `MAX_UNWINDS` of 4000 was hours away, decision zero's 240 layouts most of
 * one. A solve that ends in hours is a hang to everyone who waits for it.
 *
 * So every search is held to a **budget** ({@link SolveBudget}, one owner —
 * this driver — never per-builder counters), and running one out takes the
 * next rung of the ladder rather than throwing:
 *
 * - **attempts per decision** — `supply()` is clamped to
 *   {@link SolveBudget.attemptsPerDecision} (and a non-finite supply to the
 *   same), so a retry or a redraw is bumped at most that many times;
 * - **unwinds per feature** — a feature's refusals may unwind the ledger at
 *   most {@link SolveBudget.unwindsPerFeature} times in a solve. Past that it
 *   has shown that re-choosing what it names does not answer it, and its next
 *   refusal goes **straight to decision zero** (rung 4);
 * - **escalations per feature** — a feature past its unwinds may send the
 *   solve to decision zero at most {@link SolveBudget.decisionZeroPerFeature}
 *   times. Refusing on that many fresh layouts as well, it is refusing
 *   whatever is drawn, and the **attempt fails**: a {@link ParkSolveExhausted}
 *   (a plain `Error`, so `attemptError.ts` reads it as a park that could not
 *   be made, never a bug) naming the feature, and the root acceptance loop
 *   starts the park again at its next restart — decision zero with a fresh
 *   stream, the same rung one level up;
 * - **decision zero, unwinds and turns per solve**
 *   ({@link SolveBudget.decisionZero}, {@link SolveBudget.unwinds},
 *   {@link SolveBudget.turns}) — global caps, which fail the attempt the same
 *   way.
 *
 * **Decision zero itself is not rationed tightly, on purpose.** Redrawing the
 * layout is how a seed normally finds its park: unmutated, seed 15 restart 0
 * redraws it 34 times before its road is first asked, seed 5 restart 2 12
 * times (fix/sb-bounded, measured). A cap on decision zero alone would refuse
 * those parks; the per-feature caps refuse only a feature that keeps refusing.
 *
 * Whichever budget ends a solve is named in {@link SolveStats.exhausted} and
 * in the trace, so the attempt's backtracking stats say why it failed.
 *
 * **The worst case.** Every turn calls one `advance`, and `run` refuses to
 * start turn {@link SolveBudget.turns}` + 1`, so a solve is at most that many
 * advances whatever its builders do — even a builder that places forever and
 * never says `done`. Within that, the caps bind first on any refusal that
 * keeps coming back. With `B` builders, `U` unwinds and `E` escalations per
 * feature: retries per increment <= attemptsPerDecision; accommodations per
 * increment <= {@link MAX_ACCOMMODATIONS}; forgoes <= the increments there
 * are; and every refusal that reaches rung 3 is charged to its feature as an
 * unwind or an escalation, so at most `B x (U + E)` of them happen before one
 * feature's `E + 1`-th escalation ends the solve. Between two such refusals
 * the ledger only grows, so the solve is a bounded number of bounded replays.
 * Each `advance` is itself one bounded search (each solver's own attempt
 * ladder), which is the builder's contract, not the driver's.
 *
 * The per-feature defaults sit far above any park built: over every attempt
 * recorded in the acceptance caches of this line of work (16 seeds, many
 * restarts), the plan phase's worst was 33 unwinds in all features together
 * and 91 refusals; the world phase has never unwound.
 *
 * ## Determinism
 *
 * Fixed order, attempt-folded streams ({@link decisionStream}), blockers
 * taken most-recent-first, no map iteration over anything unordered: the same
 * seed replays the same trace. {@link ParkSolve.trace} is printed to stderr
 * on every headless build and hashed into the park digest.
 */

import type { GroundClaims } from '../../src/boot/groundClaims';
import { isRefusal, type Advance, type FeatureBuilder, type Increment, type Refusal } from './featureBuilder';
import { resetPlanCaches } from '../../src/boot/planCaches';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

/**
 * **Thread CPU time, in milliseconds, where the runtime has it; otherwise 0.**
 *
 * `msByFeature` is wall clock, and wall clock on this machine is a measurement
 * of what every *other* agent is doing as much as of what the park costs — it
 * is what made `check:solve-cost` flake at 260.3 ms against a 250 ms budget on
 * a loaded box and read 96-99 ms on a quiet one, same commit. A CPU clock does
 * not advance while its thread is descheduled, so it prices the work rather
 * than the contention, and a budget built on it means the same thing on
 * whatever box happens to run it.
 *
 * It is `threadCpuUsage`, not `cpuUsage`: the latter is `getrusage(RUSAGE_SELF)`
 * — every thread, including V8's concurrent marker — so an allocation-heavy
 * feature gets charged work done on another core. `check:park-boot` found that
 * by measurement (25.2 ms wall, 44.7 ms process CPU, 18.9 ms thread CPU) and
 * `scripts/lib/cpuClock.mts` is the checks' owner of the same reading.
 *
 * **0 in a browser, and that is deliberate**: nothing in the shipped bundle
 * defines `process`, `cpuMsByFeature` is headless diagnostics exactly as
 * `msByFeature` is, and a zero is honestly "not measured here" rather than a
 * wall-clock number wearing a CPU label.
 */
const cpuNow = (): number => {
  const nodeProcess = (
    globalThis as { process?: { threadCpuUsage?: () => { user: number; system: number } } }
  ).process;
  const used = nodeProcess?.threadCpuUsage?.();
  return used ? (used.user + used.system) / 1000 : 0;
};

const LIVE = ((): { write: (s: string) => unknown } | null => {
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined>; stderr?: { write: (s: string) => unknown } } }).process;
  return nodeProcess?.env?.['LGP_TRACE_LIVE'] === '1' && nodeProcess.stderr ? nodeProcess.stderr : null;
})();

/** A coarse solver re-seeds on retry; its `supply()` is this, so a decision is unwound past after this many re-seeds. */
export const COARSE_ATTEMPT_CAP = 6;
/** Accommodations one increment may ask for across all its retries. */
export const MAX_ACCOMMODATIONS = 8;
/** Unwinds per park before the driver gives up — a bug-catcher, far above anything a seed should need. */
export const MAX_UNWINDS = 4000;

/**
 * **Every bound the driver holds a solve to** — see "Termination" above. One
 * owner: a builder never counts its own retries or unwinds.
 */
export interface SolveBudget {
  /** The most attempts any one decision is offered, whatever its `supply()` says. */
  readonly attemptsPerDecision: number;
  /** Unwinds one feature's refusals may cause before its next refusal goes to decision zero. */
  readonly unwindsPerFeature: number;
  /** Decision-zero redraws one feature past its unwinds may cause before the attempt fails. */
  readonly decisionZeroPerFeature: number;
  /** Redraws of the ledger's first decision, however reached, before the attempt fails. */
  readonly decisionZero: number;
  /** Ledger unwinds in all (each decision passed over counts) before the attempt fails. */
  readonly unwinds: number;
  /** Turns (advances) in all before the attempt fails. */
  readonly turns: number;
  /** The per-feature budgets for named features, where they differ — a test tightens one feature's alone. */
  readonly byFeature?: Readonly<Record<string, Partial<Pick<SolveBudget, 'unwindsPerFeature' | 'decisionZeroPerFeature'>>>>;
}

export const DEFAULT_SOLVE_BUDGET: SolveBudget = {
  // The layout offers PARK_RESTARTS (240) draws; nothing else offers more than 121.
  attemptsPerDecision: 256,
  // Worst recorded: 33 unwinds in a whole plan solve, all features together.
  unwindsPerFeature: 64,
  // Under `decisionZero`, so one feature's quota runs out before the whole solve's does.
  decisionZeroPerFeature: 12,
  // **Chosen by CPU time to an accepted park, measured — not by restart
  // count.** Each redraw of decision zero re-solves the layout and everything
  // after it (cruiser 30%, railRaceBars 30%, train 24%, paths 12% of plan CPU
  // over 29 solves), so the budget trades long solves against thrown-away
  // ones: too low and a solve a few redraws from an acceptable park is
  // discarded (seed 14 restart 9 needs more than 8 and is the one accepted),
  // too high and solves that the measures will reject anyway run on.
  //
  // Measured on #708 at a23f5b8e: the whole accept loop per seed, main-thread
  // CPU seconds to acceptance (per-feature quota 3/4 of the total; measures
  // run in child processes are not in these figures, so built attempts are
  // given too — they are what the measures cost):
  //
  //   seed  dz8: restart  cpu-s  built  dz16: restart  cpu-s  built  dz32: restart  cpu-s  built
  //   0              5    1385     6            5    1386     6            5    1383     6
  //   1             15    3062    10           15    4102    13           15    4680    16
  //   2             10    2453     6           10    3474     8           10    4360     9
  //   14            25    5429    11            9    3971     7            9    4817     8
  //   15            13    2317     9           12    3132    10            0     831     1
  //   worst              5429 (14)                  4102 (1)                    4817 (14)
  //
  // 16 has the lowest worst seed. Earlier history: 256 let one solve outrun
  // `PROBE_TIMEOUT_MS` (1800 s) and the Parks job died "did not finish"
  // (seeds 1, 10, 11); 24 had the invariant shards, which re-solve each
  // accepted restart, run out of their watchdog; 8 cost seed 14 26 restarts.
  decisionZero: 16,
  unwinds: MAX_UNWINDS,
  // Far above a full park's advances in either phase (a few hundred).
  turns: 200_000,
};

/**
 * **A solve that ran out of budget** — an attempt that failed, not a bug. A
 * plain `Error` subclass on purpose: `scripts/lib/attemptError.mts` reads
 * `TypeError`/`RangeError`/... as bugs, and this is a park that could not be
 * made from this stream, which the root loop answers by starting again.
 */
export class ParkSolveExhausted extends Error {
  /** Which budget ran out — `SolveStats.exhausted` carries the same. */
  readonly budget: string;
  constructor(budget: string, message: string) {
    super(message);
    this.name = 'ParkSolveExhausted';
    this.budget = budget;
  }
}

export interface LedgerEntry {
  readonly feature: string;
  /** The builder's own increment index — the registry section it committed under. */
  readonly section: number;
  readonly attempt: number;
  readonly label: string;
}

export interface SolveStats {
  turns: number;
  increments: number;
  refusals: number;
  retries: number;
  accommodations: number;
  accommodationRefusals: number;
  unwinds: number;
  /** The most ledger entries popped in one unwind. */
  deepestUnwind: number;
  decisionZero: number;
  /** Optional increments left out after the ladder failed to clear them. */
  forgone: number;
  /**
   * The budget that ended this solve and why, or null while it has not run out
   * — `'unwinds-per-feature'` never appears here, since that one escalates to
   * decision zero instead of failing. See {@link SolveBudget}.
   */
  exhausted: string | null;
  /** Unwinds each feature's refusals caused — what {@link SolveBudget.unwindsPerFeature} counts. */
  unwindsByFeature: Record<string, number>;
  /** Decision-zero redraws each feature caused once past its unwinds — {@link SolveBudget.decisionZeroPerFeature}. */
  escalationsByFeature: Record<string, number>;
  /** Highest attempt any decision was made at, by feature. */
  worstAttempt: Record<string, number>;
  /** Turns each feature has taken. */
  turnsByFeature: Record<string, number>;
  /**
   * Yields each feature's `advance` made — the pieces its work was offered up
   * in, which is what a boot that must stop between frames can actually use
   * (`check:park-boot` asserts floors on these, per phase).
   */
  piecesByFeature: Record<string, number>;
  /** Wall-clock milliseconds spent inside each feature's `advance`, summed over turns. Headless diagnostics only. */
  msByFeature: Record<string, number>;
  /**
   * The same span priced in **thread CPU time** rather than wall clock — see
   * {@link cpuNow}. This is what `check:solve-cost` budgets against, because a
   * descheduled solve accrues no CPU and so cannot redden a check for something
   * no commit caused. 0 throughout in a browser, where there is no such clock.
   */
  cpuMsByFeature: Record<string, number>;
}

export class ParkSolve {
  readonly seed: number;
  readonly claims: GroundClaims;
  readonly stats: SolveStats = {
    turns: 0,
    increments: 0,
    refusals: 0,
    retries: 0,
    accommodations: 0,
    accommodationRefusals: 0,
    unwinds: 0,
    deepestUnwind: 0,
    decisionZero: 0,
    forgone: 0,
    exhausted: null,
    unwindsByFeature: {},
    escalationsByFeature: {},
    worstAttempt: {},
    turnsByFeature: {},
    piecesByFeature: {},
    msByFeature: {},
    cpuMsByFeature: {},
  };
  private readonly builders: readonly FeatureBuilder[];
  private readonly index: ReadonlyMap<string, number>;
  private readonly ledger: LedgerEntry[] = [];
  /** Attempt each builder's NEXT increment is to be made at. */
  private readonly nextAttempt = new Map<string, number>();
  /** Increments placed so far per builder — its next section number. */
  private readonly placed = new Map<string, number>();
  private readonly finished = new Set<string>();
  /** Accommodations already spent on the increment each builder is currently trying. */
  private readonly accommodationsSpent = new Map<string, number>();
  private readonly lines: string[] = [];
  private cursor = 0;
  readonly budget: SolveBudget;

  constructor(
    seed: number,
    builders: readonly FeatureBuilder[],
    claims: GroundClaims,
    /** Tighter bounds for a test; a real build takes {@link DEFAULT_SOLVE_BUDGET}. */
    budget: Partial<SolveBudget> = {},
  ) {
    this.seed = seed;
    this.builders = builders;
    this.claims = claims;
    this.budget = { ...DEFAULT_SOLVE_BUDGET, ...budget };
    this.index = new Map(builders.map((b, i) => [b.name, i]));
    for (const builder of builders) {
      for (const dep of builder.deps) {
        if (!this.index.has(dep)) throw new Error(`park solve: ${builder.name} depends on unknown feature ${dep}`);
        if ((this.index.get(dep) as number) >= (this.index.get(builder.name) as number)) {
          throw new Error(`park solve: ${builder.name} depends on ${dep}, which comes after it in the build order`);
        }
      }
    }
    // Transitive closure, so a feature two hops downstream of a popped
    // decision is re-run too — the crossings read the train, the paths read
    // the crossings, so a new train loop is a new path graph.
    for (const builder of builders) {
      const all = new Set<string>();
      const visit = (name: string): void => {
        for (const dep of (this.builders[this.index.get(name) as number] as FeatureBuilder).deps) {
          if (!all.has(dep)) {
            all.add(dep);
            visit(dep);
          }
        }
      };
      visit(builder.name);
      this.allDeps.set(builder.name, all);
    }
  }
  private readonly allDeps = new Map<string, Set<string>>();

  /** The trace so far, one line per event — stderr on every headless build, hashed into the digest. */
  get trace(): readonly string[] {
    return this.lines;
  }

  get decisions(): readonly LedgerEntry[] {
    return this.ledger;
  }

  /** The features placed so far, in ledger order — what the boot screen's stage line reads. */
  get placedFeatures(): readonly string[] {
    return this.ledger.map((entry) => entry.feature);
  }

  /**
   * Drive to completion. Yields after every turn so a browser can slice it
   * across frames; a headless caller just drains it.
   */
  *run(): Generator<number, void, void> {
    while (this.finished.size < this.builders.length) {
      if (this.stats.turns >= this.budget.turns) {
        this.exhaust('turns', `${this.budget.turns} turns without finishing (${this.finished.size} of ${this.builders.length} features done)`);
      }
      const builder = this.nextRunnable();
      this.stats.turns += 1;
      this.stats.turnsByFeature[builder.name] = (this.stats.turnsByFeature[builder.name] ?? 0) + 1;
      yield* this.turn(builder);
      yield this.stats.turns;
    }
    this.note(
      `solved increments=${this.stats.increments} refusals=${this.stats.refusals} retries=${this.stats.retries} ` +
        `accommodations=${this.stats.accommodations}/${this.stats.accommodationRefusals}-refused unwinds=${this.stats.unwinds} ` +
        `deepest-unwind=${this.stats.deepestUnwind} decision-zero=${this.stats.decisionZero} forgone=${this.stats.forgone}`,
    );
  }

  private nextRunnable(): FeatureBuilder {
    for (let i = 0; i < this.builders.length; i += 1) {
      const builder = this.builders[(this.cursor + i) % this.builders.length] as FeatureBuilder;
      if (this.finished.has(builder.name)) continue;
      if (![...(this.allDeps.get(builder.name) ?? [])].every((dep) => this.finished.has(dep))) continue;
      this.cursor = (this.cursor + i + 1) % this.builders.length;
      return builder;
    }
    throw new Error('park solve: no runnable builder — a dependency cycle the constructor did not catch');
  }

  private *turn(builder: FeatureBuilder): Generator<number, void, void> {
    const attempt = this.nextAttempt.get(builder.name) ?? 0;
    const began = now();
    const cpuBegan = cpuNow();
    const steps = builder.advance(attempt);
    let outcome: Advance;
    for (;;) {
      const step = steps.next();
      if (step.done) {
        outcome = step.value;
        break;
      }
      this.stats.piecesByFeature[builder.name] = (this.stats.piecesByFeature[builder.name] ?? 0) + 1;
      yield step.value;
    }
    this.stats.msByFeature[builder.name] = (this.stats.msByFeature[builder.name] ?? 0) + (now() - began);
    this.stats.cpuMsByFeature[builder.name] =
      (this.stats.cpuMsByFeature[builder.name] ?? 0) + (cpuNow() - cpuBegan);
    if (outcome === 'done') {
      this.finished.add(builder.name);
      this.note(`done ${builder.name} increments=${this.placed.get(builder.name) ?? 0}`);
      return;
    }
    if (!isRefusal(outcome)) {
      this.commit(builder, outcome, attempt);
      return;
    }
    this.stats.refusals += 1;
    this.note(
      `refused ${builder.name}#${this.placed.get(builder.name) ?? 0} attempt=${attempt} ` +
        `blockers=${outcome.blockers.join(',') || '-'} consumed=${(outcome.consumed ?? []).join(',') || '-'}: ${outcome.reason}`,
    );
    // Rung 1 — retry.
    if (attempt + 1 < this.supplyOf(builder)) {
      this.nextAttempt.set(builder.name, attempt + 1);
      this.stats.retries += 1;
      return;
    }
    // Rung 2 — accommodate.
    if (this.accommodate(builder, outcome)) {
      this.nextAttempt.set(builder.name, 0);
      return;
    }
    // An optional increment is left out rather than unwinding a structure for it.
    if (outcome.optional && builder.forgo) {
      builder.forgo();
      this.stats.forgone += 1;
      this.nextAttempt.set(builder.name, 0);
      this.accommodationsSpent.set(builder.name, 0);
      this.note(`forgone ${builder.name}#${this.placed.get(builder.name) ?? 0}: ${outcome.reason}`);
      return;
    }
    // Rungs 3 and 4 — unwind, to decision zero if need be.
    this.unwind(builder, outcome);
  }

  private commit(builder: FeatureBuilder, increment: Increment, attempt: number): void {
    const section = this.placed.get(builder.name) ?? 0;
    this.claims.commitSection(builder.name, section, {
      claims: increment.claims,
      ...(increment.crossings ? { crossings: increment.crossings } : {}),
      ...(increment.demands ? { demands: increment.demands } : {}),
    });
    this.ledger.push({ feature: builder.name, section, attempt, label: increment.label ?? '' });
    this.placed.set(builder.name, section + 1);
    this.nextAttempt.set(builder.name, 0);
    this.accommodationsSpent.set(builder.name, 0);
    this.stats.increments += 1;
    if (attempt > (this.stats.worstAttempt[builder.name] ?? 0)) this.stats.worstAttempt[builder.name] = attempt;
    this.note(`placed ${builder.name}#${section} attempt=${attempt}${increment.label ? ` ${increment.label}` : ''}`);
  }

  private mayAccommodate(asker: FeatureBuilder, blocker: FeatureBuilder): boolean {
    if (!blocker.accommodate) return false;
    if (blocker.movable) return true;
    return (this.index.get(blocker.name) as number) > (this.index.get(asker.name) as number);
  }

  private accommodate(asker: FeatureBuilder, refusal: Refusal): boolean {
    const spent = this.accommodationsSpent.get(asker.name) ?? 0;
    if (spent >= MAX_ACCOMMODATIONS) return false;
    let moved = false;
    const asked = new Set<string>();
    for (const name of refusal.blockers) {
      if (asked.has(name)) continue;
      asked.add(name);
      const blocker = this.builders[this.index.get(name) ?? -1];
      if (!blocker || !this.mayAccommodate(asker, blocker)) continue;
      const entries = this.ledger.filter((entry) => entry.feature === name);
      // Ask about the blocker's most recent increment actually in the way of
      // the refused claims. The claim index is what the blocker knows its own
      // increments by.
      let claimIndex = -1;
      for (const claim of refusal.claims ?? []) {
        for (const i of this.claims.refusingClaimIndices(asker.name, name, claim)) {
          if (i > claimIndex) claimIndex = i;
        }
      }
      if (claimIndex < 0) continue;
      const section = this.claims.sectionOfClaim(name, claimIndex);
      const entry = entries.find((e) => e.section === section);
      if (!entry) continue;
      const outcome = (blocker.accommodate as NonNullable<FeatureBuilder['accommodate']>)(
        claimIndex,
        entry.attempt + 1,
        refusal.claims ?? [],
      );
      if (isRefusal(outcome)) {
        this.stats.accommodationRefusals += 1;
        this.note(`accommodate-refused ${name}#${section} for ${asker.name}: ${outcome.reason}`);
        continue;
      }
      this.claims.commitSection(name, section, {
        claims: outcome.claims,
        ...(outcome.crossings ? { crossings: outcome.crossings } : {}),
        ...(outcome.demands ? { demands: outcome.demands } : {}),
      });
      const at = this.ledger.indexOf(entry);
      this.ledger[at] = { ...entry, attempt: entry.attempt + 1, label: outcome.label ?? entry.label };
      this.stats.accommodations += 1;
      this.accommodationsSpent.set(asker.name, (this.accommodationsSpent.get(asker.name) ?? 0) + 1);
      this.note(`accommodated ${name}#${section} for ${asker.name} attempt=${entry.attempt + 1}`);
      moved = true;
      if ((this.accommodationsSpent.get(asker.name) ?? 0) >= MAX_ACCOMMODATIONS) break;
    }
    return moved;
  }

  /** What a builder offers, clamped to the budget — a non-finite or runaway `supply()` is the cap. */
  private supplyOf(builder: FeatureBuilder): number {
    const offered = builder.supply();
    return Number.isFinite(offered) ? Math.min(offered, this.budget.attemptsPerDecision) : this.budget.attemptsPerDecision;
  }

  /** End the solve: record which budget ran out, and throw it as a failed attempt. */
  private exhaust(budget: string, why: string): never {
    this.stats.exhausted = `${budget}: ${why}`;
    this.note(`budget-exhausted ${budget}: ${why}`);
    throw new ParkSolveExhausted(budget, `park solve: seed ${this.seed}: ${why} [budget ${budget}]. Trace:\n${this.lines.join('\n')}`);
  }

  /** Count one redraw of decision zero, failing the attempt when that budget is spent. */
  private spendDecisionZero(refused: FeatureBuilder, refusal: Refusal): void {
    if (this.stats.decisionZero >= this.budget.decisionZero) {
      this.exhaust(
        'decision-zero',
        `decision zero redrawn ${this.stats.decisionZero} times and ${refused.name} still refuses — ${refusal.reason}`,
      );
    }
    this.stats.decisionZero += 1;
  }

  private unwind(refused: FeatureBuilder, refusal: Refusal): void {
    if (this.stats.unwinds >= this.budget.unwinds) {
      this.exhaust('unwinds', `did not settle in ${this.budget.unwinds} unwinds; last refusal by ${refused.name} — ${refusal.reason}`);
    }
    // Rung 3's budget: a feature that has unwound the ledger this often has
    // shown that re-choosing what it names does not answer it — go to rung 4.
    const own = this.budget.byFeature?.[refused.name];
    const unwindsAllowed = own?.unwindsPerFeature ?? this.budget.unwindsPerFeature;
    const spent = this.stats.unwindsByFeature[refused.name] ?? 0;
    if (spent >= unwindsAllowed) {
      const escalated = this.stats.escalationsByFeature[refused.name] ?? 0;
      if (escalated >= (own?.decisionZeroPerFeature ?? this.budget.decisionZeroPerFeature)) {
        this.exhaust(
          'decision-zero-per-feature',
          `${refused.name} still refuses after its ${unwindsAllowed} unwinds and ` +
            `${escalated} decision-zero redraws — ${refusal.reason}`,
        );
      }
      this.stats.escalationsByFeature[refused.name] = escalated + 1;
      this.toDecisionZero(refused, refusal, `${refused.name} spent its ${unwindsAllowed} unwinds`);
      return;
    }
    this.stats.unwindsByFeature[refused.name] = spent + 1;
    // The refused increment itself was never committed, so its own attempts
    // reset with everything after the target.
    const named = new Set([...refusal.blockers, ...(refusal.consumed ?? [])]);
    let target = -1;
    for (let i = this.ledger.length - 1; i >= 0; i -= 1) {
      if (named.has((this.ledger[i] as LedgerEntry).feature)) {
        target = i;
        break;
      }
    }
    if (target < 0) target = this.ledger.length - 1; // chronologically previous
    if (target < 0) {
      this.exhaust('nothing-to-unwind', `${refused.name} refused with nothing placed before it — ${refusal.reason}`);
    }
    // Walk back until a decision with attempts left is found; each one passed
    // over is popped and will be re-chosen fresh. Conflict-directed: the next
    // target is the next most recent decision among the NAMED ones while any
    // remain (re-choosing an unrelated decision in between cannot clear a
    // refusal that did not consume it), and only then the chronologically
    // previous one — which is what carries the unwind all the way to zero.
    for (;;) {
      const entry = this.ledger[target] as LedgerEntry;
      const builder = this.builders[this.index.get(entry.feature) as number] as FeatureBuilder;
      if (target === 0) this.spendDecisionZero(refused, refusal);
      const popped = this.popTo(target);
      const cap = this.supplyOf(builder);
      this.stats.unwinds += 1;
      if (popped > this.stats.deepestUnwind) this.stats.deepestUnwind = popped;
      if (entry.attempt + 1 < cap) {
        this.nextAttempt.set(entry.feature, entry.attempt + 1);
        this.note(
          `unwind to ${entry.feature}#${entry.section} attempt=${entry.attempt + 1} popped=${popped}` +
            (target === 0 ? ' DECISION-ZERO' : '') +
            ` for ${refused.name}: ${refusal.reason}`,
        );
        return;
      }
      this.note(`exhausted ${entry.feature}#${entry.section} supply=${cap}; unwinding further`);
      let next = -1;
      for (let i = target - 1; i >= 0; i -= 1) {
        if (named.has((this.ledger[i] as LedgerEntry).feature)) {
          next = i;
          break;
        }
      }
      target = next >= 0 ? next : target - 1;
      if (target < 0) {
        this.exhaust('decision-zero-supply', `decision zero exhausted (${cap} attempts) — the one remaining failure`);
      }
    }
  }

  /**
   * Rung 4 directly: pop the whole ledger and redraw its first decision at its
   * next attempt. Taken when the refusing feature's unwind budget is spent.
   */
  private toDecisionZero(refused: FeatureBuilder, refusal: Refusal, because: string): void {
    const first = this.ledger[0];
    if (!first) {
      this.exhaust('unwinds-per-feature', `${because}, and nothing is placed to redraw — ${refusal.reason}`);
    }
    this.spendDecisionZero(refused, refusal);
    const builder = this.builders[this.index.get(first.feature) as number] as FeatureBuilder;
    const popped = this.popTo(0);
    this.stats.unwinds += 1;
    if (popped > this.stats.deepestUnwind) this.stats.deepestUnwind = popped;
    const cap = this.supplyOf(builder);
    if (first.attempt + 1 >= cap) {
      this.exhaust('decision-zero-supply', `decision zero exhausted (${cap} attempts) — ${because}`);
    }
    this.nextAttempt.set(first.feature, first.attempt + 1);
    this.note(
      `unwind to ${first.feature}#${first.section} attempt=${first.attempt + 1} popped=${popped} DECISION-ZERO ` +
        `(budget: ${because}) for ${refused.name}: ${refusal.reason}`,
    );
  }

  /** Pop every ledger entry at index >= `from`, calling `back` in reverse order. Returns how many. */
  private popTo(from: number): number {
    let popped = 0;
    const poppedFeatures = new Set<string>();
    while (this.ledger.length > from) {
      const entry = this.ledger.pop() as LedgerEntry;
      poppedFeatures.add(entry.feature);
      const builder = this.builders[this.index.get(entry.feature) as number] as FeatureBuilder;
      this.claims.withdrawSection(entry.feature, entry.section);
      builder.back();
      this.placed.set(entry.feature, entry.section);
      this.finished.delete(entry.feature);
      this.nextAttempt.set(entry.feature, 0);
      this.accommodationsSpent.set(entry.feature, 0);
      popped += 1;
    }
    // A builder whose every increment was popped starts again from nothing;
    // so does one that finished on top of a decision that is now gone, even if
    // it placed nothing (its 'done' was an answer about the old world).
    for (const builder of this.builders) {
      const gone = [...(this.allDeps.get(builder.name) ?? [])].some((dep) => poppedFeatures.has(dep));
      if (((this.placed.get(builder.name) ?? 0) === 0 && this.finished.has(builder.name)) || gone) {
        builder.reset();
        this.finished.delete(builder.name);
        this.placed.set(builder.name, 0);
        this.nextAttempt.set(builder.name, 0);
      }
    }
    // Every memo derived from a decision that is now gone forgets it.
    resetPlanCaches();
    return popped;
  }

  private note(line: string): void {
    this.lines.push(line);
    // `LGP_TRACE_LIVE=1`: print each event as it happens, for watching a long
    // headless solve rather than reading its trace when it ends.
    if (LIVE) LIVE.write(`park-solve~ ${line.slice(0, 220)}\n`);
  }
}
