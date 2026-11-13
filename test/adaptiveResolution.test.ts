import { describe, expect, it } from 'vitest';
import {
  AdaptiveResolution,
  DOWN_MISSES,
  LADDER,
  ladderFor,
  MAX_UP_HOLD_MS,
  PAUSE_AFTER_BUSY_MS,
  PAUSE_AFTER_GAP_MS,
  PAUSE_AFTER_HITCH_MS,
  type QualityLevel,
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

  constructor(cap: number, options: { pinned?: boolean } = {}) {
    this.controller = new AdaptiveResolution(cap, options);
    this.controller.frame(this.t, 1); // the first frame has no interval
  }

  /** `frames` frames, each shown for `interval` ms with `cpu` ms of main-thread work. */
  run(frames: number, interval: number, cpu: number, busy = false, scene?: string): this {
    for (let i = 0; i < frames; i++) {
      this.t += interval;
      this.ratios.push(this.controller.frame(this.t, cpu, busy, scene));
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

describe('the ladder never leaves the device\'s own range', () => {
  it('no rung is above the cap or below 1, for any cap a screen can report', () => {
    for (const cap of [0.75, 1, 1.1, 1.25, 1.3, 1.5, 1.75, 2]) {
      const ladder = ladderFor(cap);
      expect(ladder[0]).toBe(cap);
      for (const rung of ladder) {
        expect(rung).toBeLessThanOrEqual(cap);
        expect(rung).toBeGreaterThanOrEqual(Math.min(1, cap));
      }
    }
    expect(Math.min(...LADDER)).toBeGreaterThanOrEqual(1);
  });

  it('?adaptiveDpr=0 pins it: one level, never moves, phase says fixed', () => {
    const trace = new Trace(2, { pinned: true }).run(240, HZ120, 3).run(600, HZ60, 3);
    expect(trace.ratio).toBe(2);
    expect(trace.flips).toBe(0);
    expect(trace.controller.state().phase).toBe('fixed');
    expect(trace.controller.quality.levels).toBe(1);
  });
});

describe('one-off hitches are not evidence', () => {
  const warm = (): Trace => new Trace(2).run(240, HZ120, 3, false, 'park');

  it('GPU-bound-looking frames under an iris wipe, and for a while after it, do not step down', () => {
    const trace = warm();
    // The wipe: 0.6 s of 16.7 ms frames with an idle main thread.
    trace.run(36, HZ60, 3, true, 'park');
    expect(trace.controller.state().phase).toBe('paused');
    // …and the room's first-entry compiles, still inside the pause.
    trace.run(Math.floor(PAUSE_AFTER_BUSY_MS / HZ60) - 1, HZ60, 3, false, 'park');
    expect(trace.ratio).toBe(2);
    expect(trace.flips).toBe(0);
    // The room really is GPU-bound: once the pause is over, it steps down.
    trace.run(DOWN_MISSES + 2, HZ60, 3, false, 'park');
    expect(trace.ratio).toBe(1.5);
  });

  it('a space change with no wipe pauses just the same', () => {
    const trace = warm();
    trace.run(DOWN_MISSES - 1, HZ60, 3, false, 'park');
    trace.run(DOWN_MISSES * 3, HZ60, 3, false, 'hotel');
    expect(trace.controller.state().phase).toBe('paused');
    expect(trace.ratio).toBe(2);
    // The misses seen in the park were forgotten at the door.
    expect(trace.controller.state().recentMisses).toBe(0);
  });

  it('coming back from a hidden tab pauses, so the catch-up frames are not evidence', () => {
    const trace = warm();
    trace.run(1, 30_000, 1);
    trace.run(Math.floor(PAUSE_AFTER_GAP_MS / HZ60) - 1, HZ60, 3);
    expect(trace.ratio).toBe(2);
    expect(trace.controller.state().recentMisses).toBe(0);
  });

  it('a CPU hitch (a compile, a GC) pauses: the GPU draining afterwards is not evidence', () => {
    const trace = warm();
    for (let i = 0; i < 20; i++) {
      trace.run(1, 120, 110); // the hitch itself
      trace.run(Math.floor(PAUSE_AFTER_HITCH_MS / HZ60) - 1, HZ60, 3); // the drain
    }
    expect(trace.ratio).toBe(2);
    expect(trace.flips).toBe(0);
  });

  it('pauses do not forfeit calm already earned: walking in and out of rooms still recovers', () => {
    const trace = warm().run(DOWN_MISSES, HZ60, 3, false, 'park');
    expect(trace.ratio).toBe(1.5);
    // A door every 2.5 s: 1.5 s paused, 1 s of calm frames (0.75 s of it counted).
    let doors = 0;
    for (; doors < 40 && trace.ratio !== 2; doors++) {
      trace.run(Math.round(2500 / HZ120), HZ120, 3, false, `room-${doors}`);
    }
    expect(trace.ratio).toBe(2);
    expect(doors).toBeGreaterThan(2);
    expect(doors).toBeLessThan(12);
  });
});

describe('the quality signal', () => {
  it('subscribe hears every change of level, once each, and nothing else', () => {
    const trace = new Trace(2);
    const heard: QualityLevel[] = [];
    const stop = trace.controller.subscribe((q) => heard.push(q));
    trace.run(240, HZ120, 3);
    expect(heard).toEqual([]);
    trace.run(DOWN_MISSES, HZ60, 3);
    expect(heard).toEqual([{ level: 1, levels: 3, pixelRatio: 1.5, cap: 2 }]);
    trace.run(Math.ceil((UP_HOLD_MS + 2000) / HZ120), HZ120, 3);
    expect(heard.map((q) => q.level)).toEqual([1, 0]);
    expect(trace.controller.quality).toEqual({ level: 0, levels: 3, pixelRatio: 2, cap: 2 });
    stop();
    trace.run(240, HZ60, 3);
    expect(trace.ratio).toBeLessThan(2);
    expect(heard.length).toBe(2);
  });

  it('the phase names what the governor is doing', () => {
    const trace = new Trace(2).run(240, HZ120, 3);
    expect(trace.controller.state().phase).toBe('watching');
    trace.run(DOWN_MISSES, HZ60, 3);
    expect(trace.controller.state().phase).toBe('settling');
    trace.run(120, HZ120, 3);
    expect(trace.controller.state().phase).toBe('recovering');
    expect(new Trace(1).run(10, HZ60, 3).controller.state().phase).toBe('fixed');
  });
});
