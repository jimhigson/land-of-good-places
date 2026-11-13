import { describe, expect, it } from 'vitest';
import {
  AdaptiveResolution,
  DOWN_MISSES,
  ladderFor,
  MAX_UP_HOLD_MS,
  UP_HOLD_MS,
} from '../src/core/adaptiveResolution';

/**
 * The adaptive-resolution controller (120 fps plan, step 17) on synthetic
 * frame traces. Each trace is a run of frames of one shape — the interval the
 * display showed and the main thread's ms — fed exactly as `Engine.frameTimed`
 * feeds it. The shapes are the ones the plan measured: a 120 Hz screen keeping
 * up (8.33 ms), the reptile house's GPU-bound drops (16.7 ms with ~3 ms CPU),
 * a CPU-bound hitch (16.7 ms with 14 ms CPU), and a 60 Hz phone keeping up.
 */

const HZ120 = 1000 / 120;
const HZ60 = 1000 / 60;

class Trace {
  readonly controller: AdaptiveResolution;
  t = 0;
  /** Every pixel ratio the controller answered, one per frame. */
  readonly ratios: number[] = [];

  constructor(cap: number) {
    this.controller = new AdaptiveResolution(cap);
    this.controller.frame(this.t, 1); // the first frame has no interval
  }

  /** `frames` frames, each shown for `interval` ms with `cpu` ms of main-thread work. */
  run(frames: number, interval: number, cpu: number): this {
    for (let i = 0; i < frames; i++) {
      this.t += interval;
      this.ratios.push(this.controller.frame(this.t, cpu));
    }
    return this;
  }

  /** `seconds` of frames where every `every`-th frame is a GPU-bound miss at `period`. */
  mixed(seconds: number, period: number, every: number): this {
    const frames = Math.round((seconds * 1000) / period);
    for (let i = 0; i < frames; i++) this.run(1, i % every === 0 ? period * 2 : period, 2);
    return this;
  }

  get ratio(): number {
    return this.controller.pixelRatio;
  }

  /** How many times the answer changed over the trace. */
  get flips(): number {
    let n = 0;
    for (let i = 1; i < this.ratios.length; i++) if (this.ratios[i] !== this.ratios[i - 1]) n++;
    return n;
  }
}

describe('adaptive resolution ladder', () => {
  it('starts at the screen cap and steps 2 → 1.5 → 1.25, never lower', () => {
    expect(ladderFor(2)).toEqual([2, 1.5, 1.25]);
    expect(ladderFor(1.5)).toEqual([1.5, 1.25]);
    expect(ladderFor(1)).toEqual([1]);
  });

  it('a DPR-1 screen is never touched, however bad the frames', () => {
    const trace = new Trace(1).run(2000, HZ60 * 2, 2);
    expect(trace.ratio).toBe(1);
    expect(trace.flips).toBe(0);
  });
});

describe('stepping down', () => {
  it('holds at the cap while a 120 Hz screen keeps up', () => {
    const trace = new Trace(2).run(1200, HZ120, 4);
    expect(trace.ratio).toBe(2);
    expect(trace.flips).toBe(0);
  });

  it('steps down on persistent GPU-bound misses (the reptile house signature), and stops at the floor', () => {
    // Warm up so the controller has seen the screen's real period.
    const trace = new Trace(2).run(240, HZ120, 3);
    trace.run(DOWN_MISSES - 1, HZ60, 3);
    expect(trace.ratio).toBe(2);
    trace.run(1, HZ60, 3);
    expect(trace.ratio).toBe(1.5);
    trace.run(600, HZ60, 3);
    expect(trace.ratio).toBe(1.25);
    expect(trace.controller.state().level).toBe(2);
  });

  it('needs persistent evidence: a GPU miss one frame in ten never steps down', () => {
    const trace = new Trace(2).run(240, HZ120, 3).mixed(30, HZ120, 10);
    expect(trace.ratio).toBe(2);
  });

  it('ignores CPU-bound misses — fewer pixels would not have saved them', () => {
    const trace = new Trace(2).run(240, HZ120, 3).run(1200, HZ60, 14);
    expect(trace.ratio).toBe(2);
  });

  it('a 60 Hz phone keeping up is not "missing 120 Hz"', () => {
    const trace = new Trace(2).run(3000, HZ60, 6);
    expect(trace.controller.state().periodMs).toBeCloseTo(HZ60, 3);
    expect(trace.ratio).toBe(2);
  });

  it('a 60 Hz phone that really misses (33 ms frames, idle CPU) steps down', () => {
    const trace = new Trace(2).run(600, HZ60, 6).run(DOWN_MISSES, HZ60 * 2, 6);
    expect(trace.ratio).toBe(1.5);
  });

  it('hidden-tab gaps are not frames', () => {
    const trace = new Trace(2).run(240, HZ120, 3);
    for (let i = 0; i < 100; i++) trace.run(1, 5000, 1);
    expect(trace.ratio).toBe(2);
  });
});

describe('stepping back up, with hysteresis', () => {
  const downOnce = (): Trace => new Trace(2).run(240, HZ120, 3).run(DOWN_MISSES, HZ60, 3);

  it('comes back up after a calm hold, not before', () => {
    const trace = downOnce();
    expect(trace.ratio).toBe(1.5);
    // Settle frames plus half a window before calm accrues; just short of the hold, still down.
    trace.run(Math.floor((UP_HOLD_MS - 200) / HZ120), HZ120, 3);
    expect(trace.ratio).toBe(1.5);
    trace.run(Math.ceil(2000 / HZ120), HZ120, 3);
    expect(trace.ratio).toBe(2);
  });

  it('a scene between the two thresholds stays put — no flicker', () => {
    // One GPU miss in 15 frames: over the calm bar (≤ 1 in 60), under the down bar (12 in 60).
    const trace = downOnce();
    const before = trace.flips;
    trace.mixed(120, HZ120, 15);
    expect(trace.ratio).toBe(1.5);
    expect(trace.flips).toBe(before);
  });

  it('a step up that does not hold costs more to retry: the hold doubles, up to a ceiling', () => {
    // A scene that holds 1.5 but not 2: at 2 it misses; at 1.5 it keeps up.
    const trace = downOnce();
    const holds: number[] = [];
    let ups = 0;
    for (let i = 0; i < 400_000 && ups < 8; i++) {
      const at2 = trace.ratio === 2;
      trace.run(1, at2 ? HZ60 : HZ120, 3);
      if (trace.ratio === 2 && !at2) ups++;
      if (trace.ratio === 1.5 && at2) holds.push(trace.controller.state().upHoldMs);
    }
    const expected = [2, 4, 8, 16, 32].map((k) => Math.min(MAX_UP_HOLD_MS, UP_HOLD_MS * k));
    expect(holds.slice(0, 5)).toEqual(expected);
    expect(holds.at(-1)).toBe(MAX_UP_HOLD_MS);
  });

  it('over ten minutes of that scene, the DPR changes a handful of times, not hundreds', () => {
    const trace = downOnce();
    const frames = (10 * 60 * 1000) / HZ120;
    for (let i = 0; i < frames; i++) trace.run(1, trace.ratio === 2 ? HZ60 : HZ120, 3);
    // Up+down pairs at 4, 8, 16, 32, then once a minute for the rest.
    expect(trace.flips).toBeLessThan(30);
    expect(trace.flips).toBeGreaterThan(4);
  });
});

describe('screen changes', () => {
  it('a new cap restarts at the top of the new ladder', () => {
    const trace = new Trace(2).run(240, HZ120, 3).run(DOWN_MISSES, HZ60, 3);
    expect(trace.ratio).toBe(1.5);
    trace.controller.setCap(1);
    expect(trace.ratio).toBe(1);
  });

  it('a screen dropping to 60 Hz mid-game (iOS Low Power Mode) is relearnt, and the DPR comes back', () => {
    const trace = new Trace(2).run(1200, HZ120, 3).run(60 * 60, HZ60, 3);
    expect(trace.controller.state().periodMs).toBeCloseTo(HZ60, 3);
    expect(trace.ratio).toBe(2);
  });
});
