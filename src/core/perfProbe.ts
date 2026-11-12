import type { WebGLRenderer } from 'three';

/**
 * **`?perf=1` — the frame, counted, in the game itself** (120 fps plan, step 0;
 * `docs/perf/FRAME-DROPS-2026-11.md` on #746).
 *
 * The target is **120 fps: 8.3 ms a frame, everything included** (CLAUDE.md).
 * Until this landed the only way to get a frame-time number was a Playwright
 * harness on a desktop, which cannot be pointed at a phone in a parent's hand.
 * This is the cheapest instrument that can: append `?perf=1` to any URL —
 * `/spawn?perf=1`, `/library?sit=1&story=now&perf=1`, the live site — and the
 * overlay (`ui/PerfOverlay.ts`) shows what this probe counts, with a button
 * that copies the numbers as JSON.
 *
 * A developer types it, like `/view`; nothing a child presses turns it on, and
 * **without the flag nothing here is constructed** — the game's loop runs
 * exactly as before, with `renderer.info` left on its own auto-reset.
 *
 * ## What one frame record holds, and what each number means
 *
 * - **`interval`** — ms since the previous frame began: what the display
 *   actually showed. On a 120 Hz screen a healthy frame is 8.3 ms; a frame that
 *   missed a vsync is ≥ 16.7.
 * - **`cpu`** — ms from the start of `Game.tick` to the end of its render
 *   calls: the main thread's share of the frame. GPU time is *not* in it (the
 *   GPU works after the calls return); a frame can miss with a small `cpu` when
 *   the GPU is the limit — that is the reptile-house signature.
 * - **`draws` / `tris`** — `renderer.info.render` **summed over every render
 *   call in the frame** (sky, scene, viewmodel, mini-game, book reader, and the
 *   shadow pass, which three.js counts through the same path). Three resets
 *   the counter on each `render()` by default, which would report only the
 *   last pass drawn — usually the book reader's two draws — so while the probe
 *   is on, `autoReset` is off and the probe resets once per frame.
 * - **`heap`** — `performance.memory.usedJSHeapSize` (Chrome only). Its
 *   per-second sum of *increases* is the churn the overlay shows: a lower bound
 *   on allocation, since a GC between two samples hides what it collected.
 *   Without `--enable-precise-memory-info`, Chrome quantises and caches the
 *   value for minutes, so the overlay says when it has not moved rather than
 *   reporting a confident 0 MB/s.
 *
 * `window.__perf` exposes the same records, so a check (`check:render-budget`)
 * reads the numbers a person sees rather than a second instrument's.
 */

/** One presented frame. */
export interface PerfFrame {
  /** `performance.now()` at the start of the frame. */
  readonly t: number;
  /** ms since the previous frame began; 0 for the first. */
  readonly interval: number;
  /** ms of main-thread work in `Game.tick`, render calls included. */
  readonly cpu: number;
  readonly draws: number;
  readonly tris: number;
  /** Bytes, or `null` where the browser does not say (Safari, Firefox). */
  readonly heap: number | null;
}

/** The summary the overlay draws and the "copy JSON" button copies. */
export interface PerfSummary {
  readonly frames: number;
  readonly seconds: number;
  readonly fps: number;
  readonly intervalP50: number;
  readonly intervalP99: number;
  /** Worst interval since the probe started or was last reset. */
  readonly worstInterval: number;
  readonly cpuP50: number;
  readonly cpuP99: number;
  /** Share of frames whose CPU alone exceeded {@link FRAME_BUDGET_MS}. */
  readonly cpuOverBudget: number;
  /** Share of frames that missed a 120 Hz vsync (interval > {@link MISSED_VSYNC_MS}). */
  readonly missedVsync: number;
  /** Share of frames longer than a 60 Hz frame. */
  readonly over16: number;
  readonly drawsMax: number;
  readonly drawsP50: number;
  readonly trisMax: number;
  readonly trisP50: number;
  readonly heapMB: number | null;
  /** MB/s of heap growth, or `null` when it cannot be measured honestly. */
  readonly heapChurnMBps: number | null;
  /** Why {@link heapChurnMBps} is null, when it is. */
  readonly heapNote: string | null;
}

/** 120 fps (CLAUDE.md, "The frame-rate target is 120 fps"). */
export const FRAME_BUDGET_MS = 1000 / 120;
/** Half-way between one and two 120 Hz frames: anything longer showed twice. */
export const MISSED_VSYNC_MS = 12.5;
/** One 60 Hz frame. */
export const SIXTY_HZ_FRAME_MS = 1000 / 60;

/** ~10 s at 120 fps; enough for a p99 to mean something, small enough to sort per refresh. */
const CAPACITY = 1200;

export function perfRequested(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('perf') === '1';
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))] ?? 0;
}

/**
 * Summarises a window of frames. Pure, so the arithmetic is testable without
 * a browser: `worstSinceReset` is passed in because the window is a ring and
 * the worst frame of a session must outlive it.
 */
export function summarise(frames: readonly PerfFrame[], worstSinceReset: number): PerfSummary {
  const timed = frames.filter((f) => f.interval > 0);
  const intervals = timed.map((f) => f.interval);
  const cpus = frames.map((f) => f.cpu);
  const draws = frames.map((f) => f.draws);
  const tris = frames.map((f) => f.tris);
  const first = frames[0];
  const last = frames.at(-1);
  const seconds = first && last ? (last.t - first.t) / 1000 : 0;
  const share = (n: number, of: number): number => (of === 0 ? 0 : n / of);

  let heapMB: number | null = null;
  let heapChurnMBps: number | null = null;
  let heapNote: string | null = null;
  const heaps = frames.map((f) => f.heap);
  if (heaps.length === 0 || heaps.some((h) => h === null)) {
    heapNote = 'this browser does not expose performance.memory';
  } else {
    const values = heaps as number[];
    heapMB = (values.at(-1) ?? 0) / 1048576;
    let grown = 0;
    let changes = 0;
    for (let i = 1; i < values.length; i++) {
      const delta = values[i]! - values[i - 1]!;
      if (delta !== 0) changes++;
      if (delta > 0) grown += delta;
    }
    if (changes === 0 && seconds >= 0.5) {
      // A running game allocates every frame; a heap that never moves is a
      // cached, quantised reading, and 0 MB/s would be a confident lie.
      heapNote = 'heap reading is frozen — launch Chrome with --enable-precise-memory-info';
    } else if (seconds > 0) {
      heapChurnMBps = grown / 1048576 / seconds;
    }
  }

  return {
    frames: frames.length,
    seconds,
    fps: seconds > 0 ? (frames.length - 1) / seconds : 0,
    intervalP50: percentile(intervals, 50),
    intervalP99: percentile(intervals, 99),
    worstInterval: Math.max(worstSinceReset, ...intervals, 0),
    cpuP50: percentile(cpus, 50),
    cpuP99: percentile(cpus, 99),
    cpuOverBudget: share(cpus.filter((c) => c > FRAME_BUDGET_MS).length, cpus.length),
    missedVsync: share(intervals.filter((i) => i > MISSED_VSYNC_MS).length, intervals.length),
    over16: share(intervals.filter((i) => i > SIXTY_HZ_FRAME_MS + 0.5).length, intervals.length),
    drawsMax: Math.max(0, ...draws),
    drawsP50: percentile(draws, 50),
    trisMax: Math.max(0, ...tris),
    trisP50: percentile(tris, 50),
    heapMB,
    heapChurnMBps,
    heapNote,
  };
}

interface ChromeMemory {
  readonly usedJSHeapSize: number;
}

/** What `window.__perf` offers a console or a check. */
export interface PerfWindowApi {
  /** Every frame still in the ring, oldest first. */
  frames(): PerfFrame[];
  /** The last `n` frames' summary (all of the ring when omitted). */
  summary(n?: number): PerfSummary;
  /** Forget the ring and the worst frame — e.g. after a load hitch you have already seen. */
  reset(): void;
  /** Frames recorded since the probe started; never reset, so a waiter can count. */
  readonly frameCount: number;
  /** Where and on what: the space she is in, the GPU, the pixel ratio. */
  context(): Record<string, unknown>;
}

export class PerfProbe {
  private readonly renderer: WebGLRenderer;
  /** Context the probe cannot know itself — supplied by `Game`. */
  readonly describe: () => Record<string, unknown>;
  private readonly ring: PerfFrame[] = [];
  private worst = 0;
  private framesSeen = 0;
  private frameStart = -1;
  private previousStart = -1;

  constructor(renderer: WebGLRenderer, describe: () => Record<string, unknown>) {
    this.renderer = renderer;
    this.describe = describe;
    // Summed per frame, not per render call — see the header.
    renderer.info.autoReset = false;
    renderer.info.reset();
    const probe = this;
    const api: PerfWindowApi = {
      frames: () => [...probe.ring],
      summary: (n) => probe.summary(n),
      reset: () => probe.reset(),
      context: () => probe.describe(),
      get frameCount() {
        return probe.framesSeen;
      },
    };
    (window as unknown as { __perf?: PerfWindowApi }).__perf = api;
  }

  get frameCount(): number {
    return this.framesSeen;
  }

  /** Call first thing in the frame. */
  begin(): void {
    this.frameStart = performance.now();
    this.renderer.info.reset();
  }

  /** Call after the frame's last render call. */
  end(): void {
    if (this.frameStart < 0) return;
    const now = performance.now();
    const interval = this.previousStart < 0 ? 0 : this.frameStart - this.previousStart;
    this.previousStart = this.frameStart;
    const memory = (performance as unknown as { memory?: ChromeMemory }).memory;
    const frame: PerfFrame = {
      t: this.frameStart,
      interval,
      cpu: now - this.frameStart,
      draws: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
      heap: memory ? memory.usedJSHeapSize : null,
    };
    if (this.ring.length >= CAPACITY) this.ring.shift();
    this.ring.push(frame);
    if (interval > this.worst) this.worst = interval;
    this.framesSeen++;
    this.frameStart = -1;
  }

  summary(n?: number): PerfSummary {
    const window = n === undefined ? this.ring : this.ring.slice(-n);
    return summarise(window, this.worst);
  }

  reset(): void {
    this.ring.length = 0;
    this.worst = 0;
    this.previousStart = -1;
  }
}
