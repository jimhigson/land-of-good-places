/**
 * **Staging is a cost order, never a filter.** `scripts/lib/attemptStages.mts`
 * asks an attempt's measures cheapest stage first and stops at the first stage
 * that rejects the park. These pin the two things that must never change:
 *
 * - a park that fails **only the last, heaviest stage** is rejected, so a heavy
 *   measure can never be skipped on an accepted park;
 * - an accepted verdict was asked every measure, and a rejected one names what
 *   it did not ask.
 *
 * Fake measures, no park: the property is the runner's, and a park would only
 * make it slower to state.
 */
import { describe, it, expect } from 'vitest';
import { runStages, describeNotAsked, type Stage, type StageMeasure } from '../scripts/lib/attemptStages.mts';

const asked: string[] = [];
const pass = (name: string): StageMeasure => ({
  name,
  cpu: 'checks',
  run: () => {
    asked.push(name);
    return { failures: [], broken: null };
  },
});
const fail = (name: string): StageMeasure => ({
  name,
  cpu: 'checks',
  run: () => {
    asked.push(name);
    return { failures: [{ measure: name, count: 1, first: [`${name} complained`] }], broken: null };
  },
});
const voids = (name: string): StageMeasure => ({
  name,
  cpu: 'checks',
  run: () => {
    asked.push(name);
    return { failures: [{ measure: name, count: 1, first: ['could not measure'] }], broken: `${name}: could not measure` };
  },
});
const throws = (name: string): StageMeasure => ({
  name,
  cpu: 'checks',
  run: () => {
    asked.push(name);
    throw new TypeError('x is undefined');
  },
});

const stages = (one: StageMeasure[], two: StageMeasure[], three: StageMeasure[]): Stage[] => [
  { name: 'cheap', measures: one },
  { name: 'middle', measures: two },
  { name: 'heavy', measures: three },
];

describe('runStages', () => {
  it('accepts only when every measure in every stage was asked and passed', async () => {
    asked.length = 0;
    const result = await runStages(stages([pass('a'), pass('b')], [pass('c')], [pass('d'), pass('e')]));
    expect(result.failures).toEqual([]);
    expect(result.broken).toBeNull();
    expect(result.notAsked).toBeNull();
    expect(result.measuresAsked).toBe(5);
    expect(asked).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('rejects a park that fails only a stage-3 measure — a heavy measure is never skipped', async () => {
    asked.length = 0;
    const result = await runStages(stages([pass('a')], [pass('b')], [pass('c'), fail('npc-dispersal')]));
    expect(result.failures.map((f) => f.measure)).toEqual(['npc-dispersal']);
    expect(result.notAsked).toBeNull();
    expect(asked).toEqual(['a', 'b', 'c', 'npc-dispersal']);
  });

  it('stops after the first stage that rejects, finishing that stage and naming the rest as not asked', async () => {
    asked.length = 0;
    const result = await runStages(stages([fail('a'), pass('b')], [pass('c')], [pass('d')]));
    expect(asked).toEqual(['a', 'b']);
    expect(result.failures.map((f) => f.measure)).toEqual(['a']);
    expect(result.notAsked).toEqual({ rejectedAtStage: 1, reason: 'rejected', measures: ['c', 'd'] });
    expect(describeNotAsked(result.notAsked)).toBe('not asked: rejected at stage 1 — 2 measure(s): c, d');
  });

  it('a void stops the attempt at once, in any stage, and is broken', async () => {
    asked.length = 0;
    const result = await runStages(stages([pass('a')], [voids('b'), pass('c')], [pass('d')]));
    expect(asked).toEqual(['a', 'b']);
    expect(result.broken).toBe('b: could not measure');
    expect(result.notAsked).toEqual({ rejectedAtStage: 2, reason: 'broken', measures: ['c', 'd'] });
  });

  it('a measure that throws is broken, not a failed park', async () => {
    asked.length = 0;
    const result = await runStages(stages([pass('a')], [pass('b')], [throws('c'), pass('d')]));
    expect(result.broken).toBe('c: TypeError: x is undefined');
    expect(result.notAsked).toEqual({ rejectedAtStage: 3, reason: 'broken', measures: ['d'] });
  });
});
