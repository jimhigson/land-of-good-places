import { MAX_ROUTE_WAYPOINTS, NAV_WARM_BUDGET_MS, type NavGrid } from './NavGrid';
import type { GroundSampler } from '../entities/Player';

/**
 * **Path search never costs a frame** — step 1b of the 120 fps plan
 * (`docs/perf/FRAME-DROPS-2026-11.md`, items 1 and 13).
 *
 * Every route in the game used to be found in one go, inside the frame that
 * asked for it: her tap, a companion's walk to bed, every crowd child's next
 * trip. Measured on an M4 Pro (Chrome 151, seed 5, 13 Nov 2026): a far tap was
 * **33–35 ms** of A\* in one frame (frames of 37–42 ms — four or five missed
 * vsyncs at 120 Hz), a child's plan up to **37 ms**, and the first child to plan
 * on a castle floor built that floor's whole lattice inside its own frame —
 * **55 ms**, a 73 ms frame, a minute or so after she walked in.
 *
 * So a route is now *asked for* ({@link RouteRequest}) and answered here, a few
 * milliseconds a frame: {@link run} spends at most {@link budgetMs} of each frame
 * — lattice building included, her own lattice first — on the outstanding
 * questions, best {@link ROUTE_PRIORITY} first, and each is carried forward
 * from frame to frame by `NavGrid.advanceRequest` until it is answered. **The
 * answer is the route a synchronous `NavGrid.findRoute` gives for the same
 * question**, float for float (`check:nav-frame` compares them); only the frame
 * it arrives on moves.
 *
 * What each asker does while it waits is its own business, and each says so:
 * she sets off straight at the place she tapped and turns onto the route when
 * it comes (`TapNavigator`); a companion keeps walking the route it has
 * (`petRoute.ts`); a crowd child stands where it arrived, as it always did when
 * the frame's plans were spent (`journey.ts`).
 *
 * **One budget for the whole of route-finding.** The lattice warm-up that lays
 * her lattice behind the cat bus and on entering a space used to have its own
 * 2 ms, and every search was free on top of it; now the warm-up, her searches,
 * her companions' and the crowd's all come out of the same
 * {@link NAV_WARM_BUDGET_MS}, so "no frame spends more than ~2 ms finding its
 * way" is a property of one number rather than of four callers being polite.
 *
 * **No scheduler, no change.** Everything that asks has a synchronous path for
 * when it was not handed one — every Node check that drives a navigator, a
 * planner or a parade on its own — and that path is exactly the code that ran
 * before. Only `Game` makes one of these.
 */

/**
 * Who is asking, best first. Her own taps beat everything — she is the one
 * holding the phone; her companions beat the crowd, because a pet standing
 * still beside her is noticed and a child across the park is not.
 */
export const ROUTE_PRIORITY = { player: 0, companion: 1, crowd: 2 } as const;

/** One route asked of one {@link NavGrid}, answered over as many frames as it takes. */
export class RouteRequest {
  /**
   * Where the answer is written, as `x, z` pairs — the asker's own buffer,
   * {@link MAX_ROUTE_WAYPOINTS} pairs long, written once, when it is answered.
   */
  readonly out: Float32Array;
  readonly priority: number;

  grid: NavGrid | null = null;
  sample: GroundSampler | null = null;
  startX = 0;
  startZ = 0;
  startY = 0;
  goalX = 0;
  goalZ = 0;
  goalY = 0;

  /** `queued` from being asked until answered; `done` once answered; `idle` before, and once the asker has taken the answer or cancelled. */
  status: 'idle' | 'queued' | 'done' = 'idle';
  /** The answer, once `done`: waypoints written, whether they reach the goal, and the height they end at — `findRoute`'s return, `lastRouteReachedGoal` and `lastRouteEndY`. */
  count = 0;
  reachedGoal = false;
  endY = 0;

  /** Bumped every time it is asked, so the grid can tell a new question from the one it was half way through. */
  serial = 0;
  /** Searches begun for it — more than one means the lattice changed under it, or a better-placed request took its grid. Reported, never relied on. */
  begins = 0;
  /** A\* expansions of the search that answered it. */
  expansions = 0;
  /** The scheduler frames it was asked and answered on. */
  askedOnFrame = 0;
  answeredOnFrame = 0;

  constructor(priority: number, out: Float32Array = new Float32Array(MAX_ROUTE_WAYPOINTS * 2)) {
    this.priority = priority;
    this.out = out;
  }

  /** Asked and not yet answered. */
  get pending(): boolean {
    return this.status === 'queued';
  }

  /** True when this request's last question was exactly this one. */
  asks(grid: NavGrid, goalX: number, goalZ: number, goalY: number): boolean {
    return this.grid === grid && this.goalX === goalX && this.goalZ === goalZ && this.goalY === goalY;
  }
}

/** A grid kept laid over the space it describes, every frame (her own). */
interface Warmed {
  readonly grid: NavGrid;
  readonly sample: () => GroundSampler | null;
  ready: boolean;
}

export class RouteScheduler {
  /** Milliseconds of route-finding — lattice building and search — one frame may spend. */
  readonly budgetMs: number;
  private readonly queue: RouteRequest[] = [];
  private readonly warmed: Warmed[] = [];
  private spentMs = 0;
  private frame = 0;

  /**
   * What it has done, for the checks and the handoff — reported, never
   * asserted on by the game.
   */
  readonly stats = {
    frames: 0,
    answered: 0,
    /** Searches begun beyond each request's first. */
    restarts: 0,
    /** The most frames one request waited between being asked and answered. */
    worstFramesWaited: 0,
    /** The most milliseconds spent in one frame, and in the last frame begun. */
    worstFrameMs: 0,
    lastFrameMs: 0,
  };

  constructor(budgetMs: number = NAV_WARM_BUDGET_MS) {
    this.budgetMs = budgetMs;
  }

  /** A new frame: its budget is whole again. Called once a frame, before anything asks. */
  beginFrame(): void {
    this.stats.lastFrameMs = this.spentMs;
    if (this.spentMs > this.stats.worstFrameMs) this.stats.worstFrameMs = this.spentMs;
    this.spentMs = 0;
    this.frame += 1;
    this.stats.frames += 1;
    this.open = true;
  }

  /**
   * The frame's own work is over — called at the end of `Game.tick`. Anything
   * asked from now until the next {@link beginFrame} is answered at the start
   * of that frame, out of its budget, rather than there and then: a tap
   * arrives in a DOM event *between* two frames, and the time spent on it there
   * lands in the very interval the next frame's budget is spent in. Answered
   * then, it still comes before the frame's `TapNavigator.update`, so a short
   * tap sets her off on its route on exactly the frame it always did — a
   * measured 4.0 ms of route-finding in one frame interval (2 ms in the tap's
   * event, 2 ms in the next tick) without this, 2 ms with it.
   */
  endFrame(): void {
    this.open = false;
  }

  /** Between {@link beginFrame} and {@link endFrame}: work asked now may be done now. */
  private open = false;

  /** The frame number {@link beginFrame} has counted to. */
  get frameNumber(): number {
    return this.frame;
  }

  /** Milliseconds this frame has spent so far. */
  get spentThisFrame(): number {
    return this.spentMs;
  }

  /**
   * Keep `grid` laid over the space it describes, ahead of anything asked of
   * it — her own lattice, which `Game` used to warm on its own budget. Warmed
   * first in every {@link run}, before any request.
   */
  keepWarm(grid: NavGrid, sample: () => GroundSampler | null): void {
    this.warmed.push({ grid, sample, ready: false });
  }

  /** Whether a {@link keepWarm} grid was laid and current at its last warm. */
  isWarm(grid: NavGrid): boolean {
    return this.warmed.find((entry) => entry.grid === grid)?.ready ?? false;
  }

  /** Requests asked and not yet answered. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * **Asks `grid` for a route**, writing the answer into `request.out` when it
   * comes. Asking a request that is still waiting replaces its question (a new
   * tap, a new destination) — the half-done search for the old one is dropped.
   * Then, inside a frame, spends whatever the frame has left, so a short route
   * is usually answered before this returns: look at `request.status`. Outside
   * one it waits for the next ({@link endFrame}).
   */
  ask(
    request: RouteRequest,
    grid: NavGrid,
    sample: GroundSampler,
    startX: number,
    startZ: number,
    startY: number,
    goalX: number,
    goalZ: number,
    goalY: number,
  ): void {
    request.grid = grid;
    request.sample = sample;
    request.startX = startX;
    request.startZ = startZ;
    request.startY = startY;
    request.goalX = goalX;
    request.goalZ = goalZ;
    request.goalY = goalY;
    request.serial += 1;
    request.begins = 0;
    request.expansions = 0;
    request.askedOnFrame = this.frame;
    if (request.status !== 'queued') {
      request.status = 'queued';
      this.queue.push(request);
    }
    if (this.open) this.run();
  }

  /** Forget a question nobody wants answered any more. */
  cancel(request: RouteRequest): void {
    if (request.status === 'queued') {
      const at = this.queue.indexOf(request);
      if (at >= 0) this.queue.splice(at, 1);
    }
    request.status = 'idle';
  }

  /**
   * Spends what is left of this frame's budget: her lattice laid first, then
   * the questions, best priority first and oldest first within it, each run
   * until it is answered or the frame's time is up.
   */
  run(): void {
    const left = this.budgetMs - this.spentMs;
    if (!(left > 0)) return;
    const began = performance.now();
    const deadline = began + left;
    for (const entry of this.warmed) {
      const sample = entry.sample();
      if (!sample) continue;
      const remaining = deadline - performance.now();
      if (!(remaining > 0)) break;
      entry.ready = entry.grid.warm(sample, remaining);
    }
    for (;;) {
      const next = this.next();
      if (!next || !next.grid) break;
      if (performance.now() >= deadline) break;
      if (!next.grid.advanceRequest(next, deadline)) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      next.status = 'done';
      next.answeredOnFrame = this.frame;
      this.stats.answered += 1;
      if (next.begins > 1) this.stats.restarts += next.begins - 1;
      const waited = next.answeredOnFrame - next.askedOnFrame;
      if (waited > this.stats.worstFramesWaited) this.stats.worstFramesWaited = waited;
    }
    this.spentMs += performance.now() - began;
  }

  /** The waiting request to work on: best priority, then first asked. */
  private next(): RouteRequest | null {
    let best: RouteRequest | null = null;
    for (const request of this.queue) {
      if (!best || request.priority < best.priority) best = request;
    }
    return best;
  }

  /** Drops every question. */
  dispose(): void {
    for (const request of this.queue) request.status = 'idle';
    this.queue.length = 0;
    this.warmed.length = 0;
  }
}
