import { Vector3 } from 'three';
import type { Chart } from './Chart';
import type { Geo } from './Geo';

const _local = /* @__PURE__ */ new Vector3();

/**
 * **A quantity that varies over the surface — and the second mechanism that
 * makes this codebase's recurring defect unrepresentable.**
 *
 * The defect, six instances in one day and dozens over the project: *one datum
 * standing in for a quantity that varies*. A fence run carrying a single
 * `deckY: number` across ground that falls 14.6 m. A castle carve pinning one
 * height. A gate corridor's `z` copied from where the arch used to be.
 *
 * `Chart.validFor` catches the *reads*. This catches the *captures*. There is
 * exactly one constructor that turns a sample into a field —
 * {@link constantOver} — and it will not let you write it down without naming
 * the chart over which you claim the value is constant. The claim is then
 * bounded by that chart's own validity, and a run that grows past it throws at
 * the call site rather than being found by a child.
 *
 * You cannot get a `Field` from a single sample without saying where you think
 * it holds. That sentence is the whole type.
 */
export interface Field<T> {
  at(g: Readonly<Geo>): T;
}

/**
 * A field that genuinely varies — the ordinary case. Sample it per post, per
 * tie, per tread; never once for the run.
 */
export function field<T>(at: (g: Readonly<Geo>) => T): Field<T> {
  return { at };
}

/**
 * **The only way to turn one sample into a field, and it must name its chart.**
 *
 * Legitimate: a bench's own top surface, over its own 2 m flat chart. A stall's
 * counter. A single stair tread. Each of those really is constant, the claim is
 * legible, and it goes red if the bench ever grows past the chart it declared.
 *
 * Illegitimate, and now impossible to write by accident: a `deckY` carried
 * along 60 m of fence, because there is no chart on this planet 60 m across
 * that a constant height is true over — the sag alone is 2.06 m.
 *
 * Reading outside the chart throws, via `chart.toLocal`. That is deliberate and
 * it is the mechanism: an error at the call site, not a wrong answer downstream.
 */
export function constantOver<T>(chart: Chart, value: T): Field<T> {
  return {
    at(g) {
      chart.toLocal(g, _local);
      return value;
    },
  };
}

/**
 * A constant with no chart at all — **for tests and for genuinely non-spatial
 * quantities only.**
 *
 * Named so that it is obvious in a diff and greppable in a review. If you are
 * reaching for this to carry a height, a radius or a ground level along a run,
 * you want {@link constantOver} and you want to say which chart.
 */
export function unboundedConstant<T>(value: T): Field<T> {
  return { at: () => value };
}
