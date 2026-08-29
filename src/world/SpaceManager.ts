import type { InteriorControls } from './building/Building';

/**
 * **Moving a child from one space to another, in one place.**
 *
 * ## Why this file exists
 *
 * This game is not one continuous coordinate system and has not been since the
 * castle became bigger on the inside: the interior is a floor plate six hundred
 * metres from the garden, and every hotel room is its own plate at its own
 * origin (`world/spaces.ts` names them all). Going between two of them is never
 * a walk — it is a **teleport dressed up as a doorway**, and the dressing is
 * the part that is easy to get subtly wrong: close the iris, move the player
 * *and* the camera *and* the play boundary while nobody can see, open it again,
 * and refuse to fire again for a moment so a doorway cannot ping-pong.
 *
 * That sequence was written twice — `building/Building.ts` and
 * `hotel/Hotel.ts` — with the same two state fields, the same 0.9 s constant
 * and the same five statements in the same order, in two files that never
 * mention each other. Two hand-maintained copies of one rule is precisely the
 * bug class CLAUDE.md names as this repo's commonest, and the two copies had
 * *already* drifted: see {@link SpaceManager.hop} for the difference nobody
 * decided on.
 *
 * ## What it deliberately does not own yet
 *
 * ARCHITECTURE-DECISIONS Decision 3 has `SpaceManager` owning per-space root
 * visibility and `CollisionWorld.setPlayBounds` as well. It does not here, and
 * that is on purpose: this extraction is a **pure refactor** whose whole value
 * is being provably behaviour-free, and there is nothing yet for it to own
 * those with — no table of spaces, one per castle floor, to look a boundary up
 * in. They move in **S2**, the split itself, when that table exists. Until
 * then each building keeps setting its own bounds inside its own `midpoint`,
 * exactly as it does today.
 */

/**
 * Seconds after a change of space before another one may be triggered.
 *
 * The backstop against doorway ping-pong: arrive points sit clear of the
 * trigger that would send you back, and this catches the case where one is
 * ever placed badly. Both buildings had their own `const SPACE_COOLDOWN = 0.9`
 * — the same number, twice, with no way to notice if one were ever changed.
 */
export const SPACE_COOLDOWN = 0.9;

/**
 * The half of {@link InteriorControls} a change of space actually uses.
 *
 * Structural, so both buildings' existing `InteriorControls` satisfy it
 * without either of them being handed a second seam to keep in step. Narrow on
 * purpose: this class has no business with the whoosh, the stair menu or the
 * shop panel, and a reader should be able to see the whole of its reach.
 */
export type SpaceTransitionControls = Pick<
  InteriorControls,
  'cancelWalk' | 'iris' | 'snapCamera'
>;

export class SpaceManager {
  private readonly controls: SpaceTransitionControls;

  /**
   * Whatever the owner must tear down before the iris closes — the castle
   * passes its stair-menu and stair-ride teardown, the hotel passes nothing.
   *
   * A hook rather than a method the buildings call themselves, because the
   * ordering matters and is not obvious: it has to run *after* `cancelWalk`
   * and *before* the iris, which is exactly where a caller doing it by hand
   * would eventually stop doing it. Both of its current statements die in S2
   * along with `StairRide` and `StairMenu`, and the hook goes with them.
   */
  private readonly beforeChange: () => void;

  private changing = false;
  private cooldown = 0;

  constructor(controls: SpaceTransitionControls, beforeChange: () => void = () => {}) {
    this.controls = controls;
    this.beforeChange = beforeChange;
  }

  /**
   * True from the moment a change is asked for until the iris has reopened.
   *
   * Read by everything that must not act mid-transition — boarding a slide,
   * checking doorways, the interact press. Not the same question as
   * {@link settling}: this one is "the world is being swapped right now".
   */
  get isChanging(): boolean {
    return this.changing;
  }

  /**
   * True while the post-arrival cooldown is still running — "we only just got
   * here, do not send us back".
   */
  get settling(): boolean {
    return this.cooldown > 0;
  }

  /** Ticks the cooldown down. Call once a frame, from the owner's `update`. */
  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  /**
   * Start the cooldown without having run a transition — for a player who
   * arrived in a space by some other means and must not immediately be sent
   * back out of it.
   *
   * Two honest callers, one per building: a restored save adopted into a hotel
   * room, and the ginormous slide's rider settling into the ball pit having
   * already crossed to the garden.
   */
  holdOff(): void {
    this.cooldown = SPACE_COOLDOWN;
  }

  /**
   * **The change of space.** Close the iris, run `midpoint` behind it — which
   * is where the owner switches roots on, rebinds the play bounds and
   * teleports the player — put the camera on her without travelling, open up.
   *
   * `snapCamera` is not optional and not a detail: the camera follows the
   * player over hundreds of metres otherwise, and the whip is visible on the
   * far side of the iris. Being inside somewhere is a camera and a set of play
   * bounds as much as it is a position.
   */
  changeTo(midpoint: () => void): void {
    this.changing = true;
    this.controls.cancelWalk();
    this.beforeChange();
    this.controls.iris(() => {
      midpoint();
      this.controls.snapCamera();
      this.changing = false;
      this.cooldown = SPACE_COOLDOWN;
    });
  }

  /**
   * The same hop with **no `changing` flag and no `cancelWalk`** — the hotel
   * lift's `travelTo`, which is the one caller.
   *
   * This is a difference nobody decided on. It is preserved exactly rather
   * than tidied because this extraction's entire value is that it cannot have
   * changed behaviour, and folding the lift into {@link changeTo} would gate
   * four `!changingSpace` tests differently for one frame — a real change,
   * however small, smuggled into a refactor. **S2 should unify them**, once
   * the lift is the castle's only portal and there is a reason to look at what
   * the difference does.
   */
  hop(midpoint: () => void): void {
    this.controls.iris(() => {
      midpoint();
      this.controls.snapCamera();
      this.cooldown = SPACE_COOLDOWN;
    });
  }
}
