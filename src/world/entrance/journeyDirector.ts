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
   * Should the park be built now?
   *
   * **Not on the first frame.** The entire point of the ride is that a child is
   * already looking at a bus before any park work happens; building it during
   * frame one would put the whole `World` construction in front of the first
   * pixel, which is the wait this replaces. One frame later it is hidden behind
   * a moving bus instead.
   */
  shouldBuildPark(): boolean {
    return !this.parkReadyFlag && this.parkStartedOnFrame < 0 && this.framesDrawn >= 2;
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
   * May the park take the screen? Both, always.
   *
   * A skip press is the other way through — and it is only reachable once
   * {@link skipOffered}, so it cannot bypass this either.
   */
  get readyToHandOver(): boolean {
    return this.rideOver && this.parkReadyFlag;
  }

  /**
   * The ride has finished and the park has not. The bus is waiting.
   *
   * Never true today — the park builds in under half a second against a twenty
   * second ride — which is exactly why it needs a guard rather than a comment
   * claiming it cannot happen.
   */
  get overrunning(): boolean {
    return this.rideOver && !this.parkReadyFlag;
  }
}
