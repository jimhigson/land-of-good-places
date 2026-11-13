/**
 * **`?clock=<seconds>` — the world at one moment, the same moment on every
 * machine** (`check:cull-audit`).
 *
 * A check that audits a frame has to say *which* frame. The game's own clock
 * cannot: it runs on the wall (`Loop` hands each frame the time since the last,
 * clamped at `MAX_FRAME_DELTA`), so the frame a check reaches by counting
 * frames is a different moment on every machine. On a GPU twenty frames are a
 * third of a second; on CI's SwiftShader every frame is clamped at 1/12 s and
 * twenty of them are nearly two. That is the whole of why `check:cull-audit`
 * audited the sky cruiser on its station on a Mac and half way up the chain
 * lift on the runner (386,120 off-screen triangles against 210,420), and why
 * its first author had to add slack for a ride that "read 17, 19 and 22 draws
 * over three runs of the same code".
 *
 * With this flag the world's time is not the wall's. It is **held from the
 * first frame**, then advanced in fixed {@link CHECK_CLOCK_STEP}s until it has
 * run `<seconds>`, and **held there for good**. The page keeps drawing; only
 * the world holds still. So `/sky-cruiser?clock=4` is the sky cruiser four
 * seconds after she boarded, on a phone, a Mac or a runner with no GPU — and a
 * red run can be opened in a browser and looked at, frame for frame.
 *
 * ## What makes the moment the same everywhere
 *
 * Fixed steps make the world's *own* history the same. What is left is
 * everything that happens on the wall clock instead, and the clock does not
 * step while any of it is under way ({@link CheckClock.frame}'s `ready`):
 *
 * - **a lazy part on its way** (`world/LazyPart.ts`): the ferris wheel's sky
 *   show, a room behind a door. It lands when the disk says, so the world
 *   waits for it rather than running on underneath;
 * - **an iris wipe** (`ui/Transitions.ts`): its midpoint — the teleport, the
 *   ride starting — runs on a `setTimeout`;
 * - **a warm-up spread across frames by a millisecond budget** (the ball pit's
 *   settling pile): finished outright instead, which reaches the same pile
 *   (`BallPit.settleNow`).
 *
 * Because the world does not move while any of those is pending, each of them
 * lands at the same moment of the world's time on every machine, however long
 * it took on the wall.
 *
 * ## Steps that draw nothing
 *
 * A step is a whole `Game.tick` — input, world, camera, every system — except
 * the draw. Up to {@link CHECK_CLOCK_STEPS_PER_FRAME} run per display frame,
 * then the frame itself is drawn with the world held. Drawing every step would
 * be faithful to nothing a check reads and would cost CI's software renderer
 * about a second a step; what a draw tells the simulation — which children
 * the camera sees (`cullCrowdsFor`, `noteNpcViewCamera`) — is still told on
 * every step, so a crowd is simulated exactly as it would be on screen.
 *
 * A developer flag, like `?perf=1`: nothing a child presses turns it on, and
 * without it nothing here is constructed.
 */

/**
 * One step of the world, in seconds: a 60 Hz frame. Not tied to any display
 * — it is the same on every machine by construction, which is the point.
 */
export const CHECK_CLOCK_STEP = 1 / 60;

/**
 * At most this many steps per display frame — a second of the world — so a
 * long run-up still lets the page draw (and answer a check's polling) between
 * batches. How the steps are shared out between frames changes nothing: the
 * world is not touched between them.
 */
export const CHECK_CLOCK_STEPS_PER_FRAME = 60;

/**
 * The `?clock=` the URL asks for, in seconds of world time, or `null` when it
 * asks for none. An unreadable value is said out loud and ignored: a check
 * that asked for a moment and silently got the wall clock would audit the
 * very non-determinism this exists to remove.
 */
export function checkClockRequested(search: string = typeof location === 'undefined' ? '' : location.search): number | null {
  const raw = new URLSearchParams(search).get('clock');
  if (raw === null) return null;
  const seconds = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(seconds) || seconds < 0) {
    console.warn(`Land of Good Places: ?clock=${raw} is not a number of seconds ≥ 0 — ignored; the world runs on the wall clock.`);
    return null;
  }
  return seconds;
}

/** What `window.__perf.context().clock` reports, for a check waiting on it. */
export interface CheckClockState {
  /** World seconds run so far. */
  readonly seconds: number;
  /** World seconds it will stop at. */
  readonly stopAt: number;
  /** True once it has stopped, for good. */
  readonly stopped: boolean;
  /** Display frames in which the world waited on the wall clock instead of stepping. */
  readonly heldFrames: number;
  /** What it waited on, each with the number of frames — e.g. `{ iris: 31 }`. */
  readonly heldBy: Readonly<Record<string, number>>;
}

export class CheckClock {
  /** Counted in steps, not summed seconds, so the stop is exact. */
  private stepsWanted: number;
  private stepsTaken = 0;
  private heldFrames = 0;
  private readonly heldBy: Record<string, number> = {};
  /**
   * Whether the world has been drawn, as it stands, since anything was last
   * waited on. False at the start and after every wait — see {@link frame}.
   */
  private drawnSinceWaiting = false;
  /**
   * Called after every step, when set: a check watching the world move, such
   * as `check:cull-audit`'s stale-bound sweep. Nothing in the game sets it.
   */
  afterStep: (() => void) | null = null;

  constructor(stopAt: number) {
    this.stepsWanted = Math.round(stopAt / CHECK_CLOCK_STEP);
    // The handle a check holds, as `window.__perf` is the probe's.
    if (typeof window !== 'undefined') (window as unknown as { __checkClock?: CheckClock }).__checkClock = this;
  }

  get stopped(): boolean {
    return this.stepsTaken >= this.stepsWanted;
  }

  /** Runs `seconds` more of the world, from wherever it stopped, and stops again. */
  extend(seconds: number): void {
    this.stepsWanted += Math.round(seconds / CHECK_CLOCK_STEP);
  }

  state(): CheckClockState {
    return {
      seconds: this.stepsTaken * CHECK_CLOCK_STEP,
      stopAt: this.stepsWanted * CHECK_CLOCK_STEP,
      stopped: this.stopped,
      heldFrames: this.heldFrames,
      heldBy: { ...this.heldBy },
    };
  }

  /**
   * One display frame. Runs as many fixed steps as `waitingOn` allows — asked
   * before every one, since a step can start the very thing that must be
   * waited for, and answering what is still running on the wall clock, or
   * `null` for nothing — each as `step(CHECK_CLOCK_STEP, false)`, then draws
   * the frame as `step(0, true)`: a tick in which the world does not move.
   *
   * **After any wait, the world is drawn once as it stands before it moves
   * again** (and so on the very first frame). That makes the moments the
   * world is *drawn* at the same on every machine, not only the moments it is
   * *at*: three works some things out on the first draw that needs them — an
   * instanced mesh's bound, cached on its first cull — and a machine that
   * drew the lobby while the iris was still opening and one whose iris had
   * opened by its next frame would otherwise have cached them at different
   * moments.
   */
  frame(waitingOn: () => string | null, step: (dt: number, draw: boolean) => void): void {
    let budget = CHECK_CLOCK_STEPS_PER_FRAME;
    let waited = false;
    while (!this.stopped && budget > 0) {
      const wait = waitingOn();
      if (wait !== null) {
        this.heldFrames += 1;
        this.heldBy[wait] = (this.heldBy[wait] ?? 0) + 1;
        waited = true;
        break;
      }
      if (!this.drawnSinceWaiting) break;
      step(CHECK_CLOCK_STEP, false);
      this.stepsTaken += 1;
      budget -= 1;
      this.afterStep?.();
    }
    this.drawnSinceWaiting = !waited;
    step(0, true);
  }
}
