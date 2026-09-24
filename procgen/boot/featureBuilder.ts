/**
 * **The generic feature builder** — Jim, 16 Sep 2026: *"each feature being
 * based around a generic feature builder interface that provides advancing,
 * going back, and retrying"*. Every park feature that makes a decision goes
 * through this, and the driver (`world/parkPlan.ts`) knows nothing else about
 * any of them.
 *
 * A feature is a sequence of **increments**. Each `advance` places the next
 * one (a whole solve for a coarse feature such as the railway loop; one plot,
 * one tree, one trestle for an incremental one) and returns either the
 * increment or a {@link Refusal} naming what stopped it. `back` undoes the last
 * increment exactly; `retry` re-chooses it differently. The driver owns the
 * order and the ladder (retry → correct → unwind → decision zero); a builder
 * owns only its own geometry and its own candidates.
 *
 * ## Determinism
 *
 * Every choice a builder makes is drawn from {@link decisionStream} — a stream
 * named by `(seed, feature, decision, attempt)`. The attempt is folded into the
 * stream, never held in a global counter, so the same seed replays the same
 * sequence of draws, refusals and unwinds on every run and every platform.
 */

import { candidateRng, hashString, Rng } from '../../src/core/mathUtils';
import type { Claim, Crossing, Demand } from '../../src/boot/groundClaims';

/**
 * One placed increment. `claims` are committed to the registry under the
 * builder's feature name as their own **section**, so `back` can withdraw
 * exactly this increment and nothing else the feature placed.
 */
export interface Increment {
  readonly claims: readonly Claim[];
  readonly crossings?: readonly Crossing[];
  readonly demands?: readonly Demand[];
  /** A short label for the trace: which plot, which slot, which door. */
  readonly label?: string;
}

/**
 * What a builder returns when its next increment cannot be placed.
 *
 * `blockers` names the registry features whose claims refused it (from
 * `GroundClaims.blockers`, most recently committed first — the backjumping
 * hint). `consumed` names the *decisions* a search failed against when the
 * registry did not refuse anything — a railway loop that dead-ends against the
 * park's plots names `layout`; crossing sites that prove nothing name `train`.
 * The driver unwinds to the most recent of whichever it is given.
 */
export interface Refusal {
  readonly refused: true;
  readonly blockers: readonly string[];
  readonly consumed?: readonly string[];
  /** The claims that were refused, so a blocker can be asked about the increment actually in the way. */
  readonly claims?: readonly Claim[];
  /**
   * **This increment may be left out.** A lamp slot nothing can clear, a
   * fairy pole standing on paving: the park is whole without it, and leaving
   * it out is what the old placers did silently. The driver still climbs the
   * ladder — retry, then ask the blockers to move — and only then calls the
   * builder's {@link FeatureBuilder.forgo} instead of unwinding, so a
   * decoration never unwinds a structure.
   */
  readonly optional?: boolean;
  /** Why, for the trace and for the one remaining failure's message. */
  readonly reason: string;
}

export function refusal(
  reason: string,
  by: {
    blockers?: readonly string[];
    consumed?: readonly string[];
    claims?: readonly Claim[];
    optional?: boolean;
  } = {},
): Refusal {
  return {
    refused: true,
    blockers: by.blockers ?? [],
    consumed: by.consumed ?? [],
    ...(by.claims ? { claims: by.claims } : {}),
    ...(by.optional ? { optional: true } : {}),
    reason,
  };
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && (value as Refusal).refused === true;
}

/** What `advance` may return: an increment, `'done'` when the feature has nothing left to place, or a refusal. */
export type Advance = Increment | Refusal | 'done';

export interface FeatureBuilder {
  /** The registry feature name; also the trace name. */
  readonly name: string;
  /** Features whose decisions this one reads. Fixed order comes from the driver's list, not from these. */
  readonly deps: readonly string[];
  /**
   * A feature whose increments are **cheap to move** — a tree, a lamp, a
   * bench, a wall segment: no dependants, no re-derivation. The driver asks
   * these to accommodate first, before any heavier feature and long before it
   * unwinds anything.
   */
  readonly movable?: boolean;
  /**
   * Place the next increment at the given attempt of it, or say why not. A
   * generator, so a long solve (a railway loop, a path graph) yields progress
   * and a browser can spread the park over frames; a headless build drains it.
   */
  advance(attempt: number): Generator<number, Advance, void>;
  /** Undo the last increment this builder placed, restoring its own state exactly. */
  back(): void;
  /** How many distinct attempts the NEXT increment has to offer — the driver never bumps past this. */
  supply(): number;
  /**
   * **Accommodate another feature that needs the space more** (Jim, 16 Sep
   * 2026: *"maybe a stall would move, but this would be on the class that does
   * the stall placement to decide"*). Re-place the increment that owns
   * `claimIndex` (an index into this feature's committed claims) somewhere
   * every current claim allows — within this builder's own rules, carrying its
   * own dependants — and clear of `keepClearOf`, the claims the asker was
   * refused (they are not in the registry: a refused increment is never
   * committed), or refuse. It never displaces anything else, and the
   * driver never asks it twice for one refusal, so accommodation cannot
   * cascade. Which feature needs the space more is the driver's precedence:
   * a feature earlier in the fixed build order; a later one accommodates it.
   * Optional: a feature that cannot shift simply has none, and is unwound.
   */
  accommodate?(claimIndex: number, attempt: number, keepClearOf: readonly Claim[]): Increment | Refusal;
  /**
   * Leave the increment just refused out and move on to the next one. Only
   * called after a refusal marked {@link Refusal.optional}, and only once the
   * ladder above it has failed. A builder without it is unwound instead.
   */
  forgo?(): void;
  /** Forget everything: the driver is unwinding through this feature's first increment. */
  reset(): void;
}

/**
 * The one owner of a decision's random stream. `attempt` is the retry count of
 * that decision; bumping it is what "choose differently" means.
 */
export function decisionStream(seed: number, feature: string, decision: string, attempt: number): Rng {
  return candidateRng((hashString(`${feature}/${decision}`) ^ seed) >>> 0, attempt);
}

/** A 32-bit salt for solvers that take a numeric seed rather than an `Rng`. */
export function decisionSeed(seed: number, feature: string, decision: string, attempt: number): number {
  return (hashString(`${feature}/${decision}/${attempt}`) ^ seed) >>> 0;
}
