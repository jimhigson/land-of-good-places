import { MAX_FRAME_DELTA } from './constants';

export interface LoopTick {
  /** Seconds since the last frame, clamped to MAX_FRAME_DELTA. */
  dt: number;
  /** Seconds of game time since start (sum of clamped deltas). */
  elapsed: number;
  /** Frames rendered since start. */
  frame: number;
  /** Smoothed frames per second, for the debug overlay. */
  fps: number;
}

/**
 * requestAnimationFrame driver.
 *
 * Deltas are clamped so that alt-tabbing for a minute doesn't teleport the
 * player across the park when you come back, and `elapsed` accumulates clamped
 * deltas so animation phases stay continuous with the simulation.
 */
export class Loop {
  private rafHandle = 0;
  private lastTime = 0;
  private elapsedValue = 0;
  private frameValue = 0;
  private fpsValue = 60;
  private running = false;

  private readonly onTick: (tick: LoopTick) => void;

  constructor(onTick: (tick: LoopTick) => void) {
    this.onTick = onTick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafHandle = requestAnimationFrame(this.step);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  get elapsed(): number {
    return this.elapsedValue;
  }

  get fps(): number {
    return this.fpsValue;
  }

  private readonly step = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.step);

    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA);

    this.elapsedValue += dt;
    this.frameValue += 1;
    if (rawDelta > 0) {
      // Exponential moving average keeps the readout from flickering.
      this.fpsValue += (1 / rawDelta - this.fpsValue) * 0.08;
    }

    this.onTick({
      dt,
      elapsed: this.elapsedValue,
      frame: this.frameValue,
      fps: this.fpsValue,
    });
  };
}
