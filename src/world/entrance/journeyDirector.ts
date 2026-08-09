import { JOURNEY_SECONDS } from './BusJourney';

/**
 * **Who decides when the skip appears and when the ride ends.**
 *
 * One small state machine, in its own file, for the reason `arrivalSpawn.ts`
 * exists and says at length: the alternative home for this logic is
 * `main.ts`'s ride loop, and nothing in `test/` or `scripts/` can construct a
 * boot path — it needs a canvas, a `WebGLRenderer` and a DOM. A rule that
 * lives there is a rule no check can reach, and the last two camera and
 * children bugs on this feature both hid in exactly that gap. *Both* of the
 * previous round's own guards turned out to be incapable of failing.
 *
 * So the sequencing is here, as plain arithmetic over two facts — how long the
 * ride has run, and whether a park exists — and `main.ts` is a shell that feeds
 * it a `dt` and asks it three questions.
 *
 * ## What Jim asked for, and where each part is
 *
 * > *"make it skippable only once the park has generated"*
 * > *"The skip must be driven by the generator's real completion signal — one
 * > owner — not a timer guessed to match it."*
 * > *"Guard both directions: not offered while generation is incomplete,
 * > offered once it is done."*
 *
 * **There is no clock in {@link skipOffered}.** It reads `parkReady` and
 * nothing else, so it is not capable of being offered early even if the ride
 * were retimed, and it cannot be made to agree with the generator by
 * coincidence. `parkReady` is set by the one caller, on the line after
 * `new Game(...)` returns — a park object in hand is the completion signal,
 * and there is no second definition of "generated" anywhere.
 *
 * > *"A loading screen that lies is worse than one that waits. If the ride ends
 * > before the park is ready, the bus should idle at the gate rather than let a
 * > player walk into a half-built park."*
 *
 * That is {@link readyToHandOver}: it requires **both**. The ride running out
 * is not sufficient, so a park that takes longer than twenty seconds — a slow
 * phone, a bad seed — keeps the bus on the road rather than handing a child
 * into a park that does not exist yet. {@link overrunning} says when that is
 * happening, so the ride can hold rather than freeze.
 */
export class JourneyDirector {
  private elapsedSeconds = 0;
  private parkReadyFlag = false;
  private warmupReadyFlag = false;
  private generationReadyFlag = false;
  private framesDrawn = 0;
  private parkStartedOnFrame = -1;

  /** One frame of the ride. `dt` in seconds. */
  advance(dt: number): void {
    this.framesDrawn += 1;
    if (dt > 0) this.elapsedSeconds += dt;
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /** How many frames of the ride have been drawn. */
  get frames(): number {
    return this.framesDrawn;
  }

/**
   * **The park's procedural generation has finished.**
   *
   * Set by `main.ts` from `ParkGeneration.ready` — every ride's route solved,
   * the slide pre-warmed, the walk graph joined up. Distinct from
   * {@link parkReady}, which is the `World` *built* out of all that, and the two
   * are one frame apart at least.
   *
   * This is the gate that makes "amortised generation" and "never hand a child
   * a half-built park" the same mechanism rather than two hopeful ones: the
   * generation is spread over frames precisely *because* nothing downstream may
   * start until it says it is done.
   */
  noteGenerationReady(): void {
    this.generationReadyFlag = true;
  }

  get generationReady(): boolean {
    return this.generationReadyFlag;
  }

  /**
   * May generation take a slice this frame?
   *
   * The **same frame-2 rule** as {@link shouldBuildPark}, and for the same
   * reason. The first slice is a dynamic `import()`, and the module evaluation
   * it triggers — the park boundary, ~43 ms — runs off the microtask queue,
   * which the browser drains before it paints. Starting on frame one would
   * therefore push back the very first pixel of the bus by exactly the work the
   * bus is there to hide.
   */
  shouldAdvanceGeneration(): boolean {
    return !this.generationReadyFlag && this.framesDrawn >= 2;
  }

  /**
   * Should the park be built now?
   *
   * **Not on the first frame.** The entire point of the ride is that a child is
   * already looking at a bus before any park work happens; building it during
   * frame one would put the whole `World` construction in front of the first
   * pixel, which is the wait this replaces. One frame later it is hidden behind
   * a moving bus instead.
   *
   * **And not until generation has finished.** `new World(...)` reads
   * `PATH_GRAPH`, `SLIDE_PLAN` and every other solved artefact; asking for it
   * early does not build a smaller park, it *blocks the frame* solving the lot
   * synchronously — which is the four-second stall this whole thing exists to
   * remove, merely moved to the middle of the ride where it would read as a
   * freeze rather than a wait.
   */
  shouldBuildPark(): boolean {
    return (
      this.generationReadyFlag &&
      !this.parkReadyFlag &&
      this.parkStartedOnFrame < 0 &&
      this.framesDrawn >= 2
    );
  }

  /** Called immediately before the park build begins. */
  noteParkBuildStarted(): void {
    this.parkStartedOnFrame = this.framesDrawn;
  }

  /** Which frame the park build began on. `-1` if it has not. */
  get parkBuildFrame(): number {
    return this.parkStartedOnFrame;
  }

  /** The generator's real completion signal: a park object exists. */
  noteParkReady(): void {
    this.parkReadyFlag = true;
  }

  get parkReady(): boolean {
    return this.parkReadyFlag;
  }

  /**
   * **The park's shader programs have all been compiled.**
   *
   * Set from `ShaderWarmup.ready`, the same shape as {@link parkReady}: a real
   * completion signal from the thing doing the work, never a timer hoping to
   * match it.
   *
   * This exists because 64 of the park's 116 shader links were happening
   * *after* hand-over — while a child was walking about — and one of them
   * stalled a frame for 1.29 s. See `boot/shaderWarmup.ts`.
   */
  noteWarmupReady(): void {
    this.warmupReadyFlag = true;
  }

  get warmupReady(): boolean {
    return this.warmupReadyFlag;
  }

  /**
   * May the shader warm-up take a slice this frame?
   *
   * Only once a park exists to compile — there is nothing in the scene before
   * that — and only until it is finished.
   */
  shouldWarmShaders(): boolean {
    return this.parkReadyFlag && !this.warmupReadyFlag;
  }

  /**
   * Is the skip on offer?
   *
   * Deliberately **only** `parkReady`. No duration, no elapsed time, nothing
   * that could drift out of step with what it is gating on.
   */
  get skipOffered(): boolean {
    return this.parkReadyFlag;
  }

  /** Has the ride run its course? Says nothing about whether it may end. */
  get rideOver(): boolean {
    return this.elapsedSeconds >= JOURNEY_SECONDS;
  }

  /**
   * **Is the park actually fit to play?** Built, *and* its shaders compiled.
   *
   * One definition, read by both {@link readyToHandOver} and
   * {@link overrunning}, so "hand over now" and "keep the bus at the kerb" are
   * two answers to the same question rather than two questions that can drift
   * apart. This repo's most common bug by a distance is two definitions of one
   * thing kept in step by hand; this is that thing, so it gets one owner.
   *
   * A park whose shaders are not compiled is not half-built, but it does
   * stutter for the first few seconds of play, which is the same promise
   * broken in a quieter way.
   */
  get parkFitToPlay(): boolean {
    return this.parkReadyFlag && this.warmupReadyFlag;
  }

  /**
   * May the park take the screen? Both, always.
   *
   * A skip press is the other way through — and it is only reachable once
   * {@link skipOffered}, so it cannot bypass this either.
   */
  get readyToHandOver(): boolean {
    return this.rideOver && this.parkFitToPlay;
  }

  /**
   * The ride has finished and the park is not fit to play. The bus is waiting.
   *
   * **Not the rare branch its old comment claimed.** It was written as "never
   * true today — the park builds in under half a second", which is true only on
   * a dev laptop. Generation is budgeted in wall-clock milliseconds per frame
   * ({@link overrunAwareBudgetMs}), so a slower device completes fewer steps per
   * frame and needs proportionally *more* frames — while the ride is a fixed 240
   * frames (twenty seconds of `dt` clamped to 1/12 s). Below roughly twelve
   * frames a second, generation outlasts the ride every time, so this is the
   * *common* state on the device a six-year-old actually holds. That is why the
   * budget below exists: overrunning is not an edge case to survive, it is a
   * phase to get through as fast as the machine can.
   */
  get overrunning(): boolean {
    return this.rideOver && !this.parkFitToPlay;
  }

  /**
   * **How many milliseconds of park-building work this frame may spend.**
   *
   * The small slice ({@link whileTravelling}) while the bus is still rolling and
   * the orbit is the shot — a camera that stutters once a second is a worse
   * failure than a park that is a moment slower, *because nobody is waiting on
   * it yet: the bus has the rest of its ride to fill*. That reasoning is the
   * whole justification for the 8 ms cap, and it holds **only while the ride is
   * running**.
   *
   * Once the ride is over ({@link overrunning}) the bus has parked at the gate,
   * there is no orbit left to keep smooth, and the child *is* waiting — on a
   * loading screen whose only job now is to end. The cap that protected the
   * orbit is, from here on, the thing making her wait minutes: each frame is
   * almost entirely idle (only the parked ride draws), yet only 8 ms of it goes
   * to the generation she is waiting for. So the budget opens right up
   * ({@link whileWaiting}) and the remaining work drains flat-out.
   *
   * One owner for the whole "travelling vs waiting" question, so `main.ts` cannot
   * feed the generator one answer and the warm-up another, and so a check can
   * drive the same decision the game does.
   */
  overrunAwareBudgetMs(whileTravelling: number, whileWaiting: number): number {
    return this.overrunning ? whileWaiting : whileTravelling;
  }
}
