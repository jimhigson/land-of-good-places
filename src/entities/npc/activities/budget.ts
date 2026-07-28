import type { ActivityBudget } from './activity';

/**
 * One child's hold on a shared, whole-park cap.
 *
 * The cap itself is an {@link ActivityBudget} — a plain `{ active, max }` that
 * `NpcSystem` builds once and hands to every child. This is the bookkeeping
 * around it, and it exists because the bookkeeping is exactly where these
 * things break: a slot claimed on the way in and released on only *one* of the
 * three ways out leaks, and a leaked slot is indistinguishable from the feature
 * being switched off. `claim` and `release` are therefore both idempotent — call
 * them from every exit and stop thinking about it.
 */
export class BudgetSlot {
  private held = false;

  /**
   * @param budget The shared cap, or `undefined` when nobody handed one over.
   * @param whenAbsent What an absent cap means. The two blocks that predate
   *   this class disagreed: the climb treated a missing budget as *unlimited*,
   *   the chat treated it as *closed*. Both are defensible and both are
   *   preserved, so the disagreement is at least written down now.
   */
  constructor(
    private readonly budget: ActivityBudget | undefined,
    private readonly whenAbsent: 'allow' | 'refuse',
  ) {}

  /** True when there is no room and a child may not start. */
  get full(): boolean {
    if (!this.budget) return this.whenAbsent === 'refuse';
    return this.budget.active >= this.budget.max;
  }

  /** True while this child is holding a slot. */
  get holding(): boolean {
    return this.held;
  }

  /** Takes a slot, if not already holding one. */
  claim(): void {
    if (this.held || !this.budget) return;
    this.budget.active += 1;
    this.held = true;
  }

  /** Gives the slot back, if holding one. Safe to call from any exit. */
  release(): void {
    if (!this.held || !this.budget) return;
    this.budget.active = Math.max(0, this.budget.active - 1);
    this.held = false;
  }
}
