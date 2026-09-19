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
 * ## Termination
 *
 * The state is the vector of attempts along the ledger. Every unwind bumps
 * one position and resets every later position to zero — a strict increase in
 * lexicographic order over a finite space (each decision's supply is finite;
 * a coarse solver's is capped at {@link COARSE_ATTEMPT_CAP}) — and retries and
 * accommodations never touch the ledger's earlier entries. Decision zero has
 * its own finite supply; exhausting it is the one remaining failure, thrown
 * with the whole trace, and it is a generator bug by definition.
 *
 * ## Determinism
 *
 * Fixed order, attempt-folded streams ({@link decisionStream}), blockers
 * taken most-recent-first, no map iteration over anything unordered: the same
 * seed replays the same trace. {@link ParkSolve.trace} is printed to stderr
 * on every headless build and hashed into the park digest.
 */

import type { GroundClaims } from './groundClaims';
import { isRefusal, type Advance, type FeatureBuilder, type Increment, type Refusal } from './featureBuilder';
import { resetPlanCaches } from './planCaches';

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

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
    worstAttempt: {},
    turnsByFeature: {},
    piecesByFeature: {},
    msByFeature: {},
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

  constructor(seed: number, builders: readonly FeatureBuilder[], claims: GroundClaims) {
    this.seed = seed;
    this.builders = builders;
    this.claims = claims;
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
    if (attempt + 1 < builder.supply()) {
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

  private unwind(refused: FeatureBuilder, refusal: Refusal): void {
    if (this.stats.unwinds >= MAX_UNWINDS) {
      throw new Error(
        `park solve: seed ${this.seed} did not settle in ${MAX_UNWINDS} unwinds — a generator bug. Trace:\n${this.lines.join('\n')}`,
      );
    }
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
      throw new Error(
        `park solve: seed ${this.seed}: ${refused.name} refused with nothing placed before it — ${refusal.reason}`,
      );
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
      const popped = this.popTo(target);
      const cap = builder.supply();
      this.stats.unwinds += 1;
      if (popped > this.stats.deepestUnwind) this.stats.deepestUnwind = popped;
      if (target === 0) this.stats.decisionZero += 1;
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
        throw new Error(
          `park solve: seed ${this.seed}: decision zero exhausted (${cap} attempts) — the one remaining failure. Trace:\n${this.lines.join('\n')}`,
        );
      }
    }
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
