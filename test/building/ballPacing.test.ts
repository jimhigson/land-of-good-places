import { describe, expect, it } from 'vitest';
import { BallPitSimulation, type PlayerContact } from '../../src/world/building/ballPhysics';

/**
 * **The ball pit is drawn smoothly at 120 Hz, and its physics did not change
 * to make it so** (perf plan step 19, docs/perf/FRAME-DROPS-2026-11.md item 18).
 *
 * The pit simulates in fixed 1/60 s sub-steps. On a 120 Hz display a sub-step
 * lands on every other frame, and the pit used to draw the raw physics state —
 * so every moving ball moved on one frame and held still on the next. It now
 * draws each ball between its last two physics states (`drawX`/`drawY`/`drawZ`).
 *
 * Every pacing test below measures the drawn arrays, and runs the identical
 * measurement over the physics arrays as its **control**: the physics arrays are
 * exactly what the pit drew before this change, so the control going red-shaped
 * (holds, zero-speed frames) is what proves the instrument can see the defect.
 *
 * The pit is shaped like the game's (`BallPit.ts`: 900 balls of 0.28 m in a
 * 6 m pit 0.5 m deep, seed 90210). Nothing here depends on that beyond the
 * fingerprint, which pins whatever shape it was taken against.
 */

const COUNT = 900;
const BALL_RADIUS = 0.28;
const BOUNDS = { radius: 6 - BALL_RADIUS - 0.5, restY: -0.5 + BALL_RADIUS } as const;
const SEED = 90210;
const WARMUP_SUBSTEPS = 360;

function pit(count = COUNT): BallPitSimulation {
  return new BallPitSimulation(count, BALL_RADIUS, BOUNDS, SEED);
}

/** FNV-1a over the exact bits of the arrays: equal only if every float is. */
function fingerprint(...arrays: Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    for (const word of new Uint32Array(a.buffer, a.byteOffset, a.length)) {
      h ^= word;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** mulberry32 — the same generator the pit scatters with. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The warm-up as it was scheduled before this change: 5/60 s a frame. */
function oldWarmUp(sim: BallPitSimulation): number {
  let remaining = 6;
  let substeps = 0;
  while (remaining > 0) {
    const batch = Math.min(remaining, 5 / 60);
    substeps += sim.step(batch, null).substeps;
    remaining -= batch;
  }
  return substeps;
}

function note(line: string): void {
  // stderr, not console.log: vitest only shows console output for failures.
  process.stderr.write(`ballPacing: ${line}\n`);
}

describe('ball pit physics is unchanged', () => {
  it('reaches bit-for-bit the state it reached before interpolation existed', () => {
    // Recorded on origin/main 46ef5a64, before this change, with this exact
    // script: the old warm-up, a landing splash, then 600 frames of uneven dt
    // with a child wading a line through the pit (absent every third frame).
    const sim = pit();
    const warm = oldWarmUp(sim);
    const afterWarmUp = fingerprint(sim.px, sim.py, sim.pz);

    sim.impulse(0.8, -0.4, 6.6, 9 * 1.6, 6.5 * 1.6);
    const next = random(7);
    let substeps = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      const dt = 1 / 144 + next() * (1 / 45 - 1 / 144);
      const t = frame / 600;
      const player: PlayerContact = {
        x: -5 + 10 * t,
        y: -0.5,
        z: 1.5 * Math.sin(t * 6),
        radius: 0.95,
        height: 1.3,
      };
      substeps += sim.step(dt, frame % 3 === 0 ? null : player).substeps;
    }
    const final = fingerprint(sim.px, sim.py, sim.pz);
    note(`warm-up ${warm} sub-steps → ${afterWarmUp}; play ${substeps} sub-steps → ${final}`);

    expect({ warm, afterWarmUp, substeps, final }).toEqual({
      warm: WARMUP_SUBSTEPS,
      afterWarmUp: '1f38a64b',
      substeps: 537,
      final: '06cf593d',
    });
  });

  it('settles the same pile however the warm-up is shared out between frames', () => {
    const old = pit();
    expect(oldWarmUp(old)).toBe(WARMUP_SUBSTEPS);
    const expected = fingerprint(old.px, old.py, old.pz);

    // One sub-step a frame (a zero budget still runs one), and all at once.
    const slow = pit();
    let slowFrames = 0;
    for (let owed = WARMUP_SUBSTEPS; owed > 0; slowFrames += 1) owed -= slow.settle(owed, 0);
    const fast = pit();
    const fastRan = fast.settle(WARMUP_SUBSTEPS, Number.POSITIVE_INFINITY);

    expect(slowFrames).toBe(WARMUP_SUBSTEPS);
    expect(fastRan).toBe(WARMUP_SUBSTEPS);
    expect(fingerprint(slow.px, slow.py, slow.pz)).toBe(expected);
    expect(fingerprint(fast.px, fast.py, fast.pz)).toBe(expected);
    // And it is drawn where it lies, not part-way back.
    expect(fingerprint(fast.drawX, fast.drawY, fast.drawZ)).toBe(expected);
  });

  it('runs the same physics at 60 Hz and at 120 Hz', () => {
    const player: PlayerContact = { x: 1, y: -0.5, z: 0.5, radius: 0.95, height: 1.3 };
    const at60 = pit();
    const at120 = pit();
    for (const sim of [at60, at120]) {
      sim.settle(WARMUP_SUBSTEPS, Number.POSITIVE_INFINITY);
      sim.impulse(0, 0, 6.6, 14.4, 10.4);
    }
    let substeps60 = 0;
    let substeps120 = 0;
    for (let frame = 0; frame < 120; frame += 1) substeps60 += at60.step(1 / 60, player).substeps;
    for (let frame = 0; frame < 240; frame += 1) substeps120 += at120.step(1 / 120, player).substeps;

    expect(substeps120).toBe(substeps60);
    expect(fingerprint(at120.px, at120.py, at120.pz)).toBe(fingerprint(at60.px, at60.py, at60.pz));
  });
});

describe('ball pit pacing at 120 Hz', () => {
  it('draws every moving ball somewhere new on every frame', () => {
    const sim = pit();
    sim.settle(WARMUP_SUBSTEPS, Number.POSITIVE_INFINITY);
    sim.impulse(0, 0, 6.6, 14.4, 10.4);

    const FRAMES = 120;
    const drawn: Float32Array[] = [];
    const physics: Float32Array[] = [];
    const substepFrames: number[] = [];
    const snapshot = (x: Float32Array, y: Float32Array, z: Float32Array): Float32Array => {
      const out = new Float32Array(COUNT * 3);
      out.set(x, 0);
      out.set(y, COUNT);
      out.set(z, COUNT * 2);
      return out;
    };
    drawn.push(snapshot(sim.drawX, sim.drawY, sim.drawZ));
    physics.push(snapshot(sim.px, sim.py, sim.pz));
    for (let frame = 1; frame <= FRAMES; frame += 1) {
      if (sim.step(1 / 120, null).substeps > 0) substepFrames.push(frame);
      drawn.push(snapshot(sim.drawX, sim.drawY, sim.drawZ));
      physics.push(snapshot(sim.px, sim.py, sim.pz));
    }

    const moved = (frames: Float32Array[], frame: number, ball: number): boolean => {
      const a = frames[frame - 1] as Float32Array;
      const b = frames[frame] as Float32Array;
      return (
        a[ball] !== b[ball] ||
        a[ball + COUNT] !== b[ball + COUNT] ||
        a[ball + COUNT * 2] !== b[ball + COUNT * 2]
      );
    };

    // "Moving" is measured on the physics, not assumed: a ball whose simulated
    // position moved at least MOVING_M in every sub-step of the window. The
    // first sub-step is left out — the frame before it is still the resting
    // pile. The floor is far below anything visible and far above float32's
    // resolution here (0.48 µm at 4–8 m): without one, a ball the pile nudged
    // 15–30 nm in a sub-step counted as moving, and half of a 15 nm step
    // cannot be represented, so it was "drawn in the same place twice" — two
    // ball-frames of 101,952 when this was written, both of that kind.
    const MOVING_M = 1e-5;
    const travelled = (frames: Float32Array[], frame: number, ball: number): number => {
      const a = frames[frame - 1] as Float32Array;
      const b = frames[frame] as Float32Array;
      return Math.hypot(
        (b[ball] as number) - (a[ball] as number),
        (b[ball + COUNT] as number) - (a[ball + COUNT] as number),
        (b[ball + COUNT * 2] as number) - (a[ball + COUNT * 2] as number),
      );
    };
    const window = substepFrames.slice(1);
    const movingBalls: number[] = [];
    for (let ball = 0; ball < COUNT; ball += 1) {
      if (window.every((frame) => travelled(physics, frame, ball) >= MOVING_M)) movingBalls.push(ball);
    }
    const from = (substepFrames[0] ?? 0) + 1;

    let drawnHolds = 0;
    let physicsHolds = 0;
    let measured = 0;
    for (let frame = from; frame <= FRAMES; frame += 1) {
      for (const ball of movingBalls) {
        measured += 1;
        if (!moved(drawn, frame, ball)) drawnHolds += 1;
        if (!moved(physics, frame, ball)) physicsHolds += 1;
      }
    }
    note(
      `120 Hz: ${substepFrames.length} sub-steps in ${FRAMES} frames; ${movingBalls.length} balls ` +
        `moving throughout; ball-frames measured ${measured}: drawn held still ${drawnHolds}, ` +
        `physics (what was drawn before) held still ${physicsHolds}`,
    );

    // Not vacuous: half the frames ran a sub-step, plenty of balls were moving.
    expect(substepFrames.length).toBe(FRAMES / 2);
    expect(movingBalls.length).toBeGreaterThan(100);
    // Control: drawing the physics state holds every moving ball on every
    // frame without a sub-step — the judder.
    expect(physicsHolds).toBeGreaterThan(measured * 0.45);
    // The fix: no moving ball is ever drawn in the same place twice running.
    expect(drawnHolds).toBe(0);
  });

  it('moves a rolling ball at an even speed through real 120 Hz frame jitter', () => {
    // One ball, at rest on the floor, given a shove towards the middle of the
    // pit: it rolls in a straight line, slowing smoothly under damping, and
    // touches nothing for the whole measurement.
    const sim = pit(1);
    sim.settle(60, Number.POSITIVE_INFINITY);
    const x0 = sim.px[0] as number;
    const z0 = sim.pz[0] as number;
    sim.impulse(x0 + 1, z0, 6.6, 5, 0);

    const next = random(120);
    const drawnSpeeds: number[] = [];
    const physicsSpeeds: number[] = [];
    let drawnX = sim.drawX[0] as number;
    let physicsX = sim.px[0] as number;
    for (let frame = 0; frame < 60; frame += 1) {
      // A 120 Hz display's rAF: 8.33 ms give or take half a millisecond.
      const dt = (7.9 + next() * 0.9) / 1000;
      sim.step(dt, null);
      const nowDrawn = sim.drawX[0] as number;
      const nowPhysics = sim.px[0] as number;
      // The first two frames are the ball starting from rest.
      if (frame >= 2) {
        drawnSpeeds.push(Math.abs(nowDrawn - drawnX) / dt);
        physicsSpeeds.push(Math.abs(nowPhysics - physicsX) / dt);
      }
      drawnX = nowDrawn;
      physicsX = nowPhysics;
    }
    expect(Math.abs((sim.pz[0] as number) - z0)).toBeLessThan(1e-6); // a straight line, as set up

    const worstRatio = (speeds: readonly number[]): number => {
      let worst = 1;
      for (let i = 1; i < speeds.length; i += 1) {
        const a = speeds[i - 1] as number;
        const b = speeds[i] as number;
        const ratio = Math.min(a, b) === 0 ? Number.POSITIVE_INFINITY : Math.max(a, b) / Math.min(a, b);
        worst = Math.max(worst, ratio);
      }
      return worst;
    };
    const drawnWorst = worstRatio(drawnSpeeds);
    const physicsWorst = worstRatio(physicsSpeeds);
    note(
      `jittered 120 Hz rolling ball: drawn speed ${Math.min(...drawnSpeeds).toFixed(3)}–` +
        `${Math.max(...drawnSpeeds).toFixed(3)} m/s, worst frame-to-frame ratio ${drawnWorst.toFixed(3)}; ` +
        `physics state ${Math.min(...physicsSpeeds).toFixed(3)}–${Math.max(...physicsSpeeds).toFixed(3)} m/s, ` +
        `ratio ${physicsWorst}`,
    );

    // Control: the physics state stops dead on some frames and jumps on others.
    expect(Math.min(...physicsSpeeds)).toBe(0);
    // Drawn: never still, never more than a quarter faster or slower than the
    // frame before (damping alone is about 5 % per sub-step).
    expect(Math.min(...drawnSpeeds)).toBeGreaterThan(0);
    expect(drawnWorst).toBeLessThan(1.25);
  });

  it('stops redrawing a pile once it has gone to sleep', () => {
    // 200 balls, not the game's 900: that pile never sleeps outright — 22 balls
    // against the wall stay awake for good, three of them shuffling 26–70 µm a
    // sub-step with no net drift — so it could not reach the state measured
    // here. A smaller pile, splashed, sleeps within a couple of seconds.
    const sim = pit(200);
    sim.settle(WARMUP_SUBSTEPS, Number.POSITIVE_INFINITY);
    sim.impulse(0, 0, 6.6, 14.4, 10.4);
    let awake = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 2400 && awake > 0; frame += 1) awake = sim.step(1 / 120, null).awake;
    expect(awake).toBe(0);
    // Asleep, it is drawn exactly where it lies...
    expect(fingerprint(sim.drawX, sim.drawY, sim.drawZ)).toBe(fingerprint(sim.px, sim.py, sim.pz));
    // ...and a further frame changes nothing, so no matrix is rewritten.
    sim.step(1 / 120, null);
    expect(sim.drawDirty.reduce((sum, flag) => sum + flag, 0)).toBe(0);
  });
});
