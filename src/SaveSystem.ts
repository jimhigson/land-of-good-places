import { saveFlags } from './state/flags';
import { gameStore } from './state';
import { SAVE_VERSION, writeSave, type SaveFile, type SavedPlace } from './state/save';
import { spaceAt, worldToLocal, type SpaceId } from './world/spaces';

/**
 * The autosave.
 *
 * Every five seconds, and on the way out. That is the whole feature, and all
 * the interesting decisions are about the two ways it could go wrong.
 *
 * ## It must not cost a frame
 *
 * ARCHITECTURE-REVIEW keeps an allocation-suspect list and there is a standing
 * GC-pause complaint, so a five-second timer that serialises an object graph
 * would show up as a stutter every five seconds — the most noticeable kind of
 * stutter there is, because it is rhythmic. Four things keep it cheap:
 *
 * 1. **No graph is built.** `gameStore.savedGame()` returns a small literal
 *    that *points at* the live `player`, `world`, `collection` and `inventory`
 *    objects. `JSON.stringify` walks them in place; a save allocates one small
 *    object and one string.
 * 2. **Nothing is written when nothing changed.** The store and the flags each
 *    count their own changes, and the player's position is compared quantised
 *    to {@link POSITION_EPSILON}. A child reading a sign for a minute costs
 *    nothing at all.
 * 3. **Never on a busy frame.** {@link SaveSources.canSave} refuses while a
 *    mini-game is starting or running, while an iris wipe is carrying her
 *    between spaces, and while she is riding something. A refused tick simply
 *    tries again five seconds later; the state is still there.
 * 4. **It is a timer, not a system.** `setInterval` fires between frames. This
 *    is deliberately *not* registered with `Game.addSystem`, which would put
 *    it inside `tick()`.
 *
 * ## It must not save a position she is not at
 *
 * A save taken during a space transition would record a coordinate from
 * halfway through a teleport — the one kind of restore that could strand her
 * somewhere she cannot walk out of. So every allowed tick also stashes a
 * **last known good place**, and the write-on-the-way-out uses that if the
 * moment it fires happens to be a blocked one. Losing five seconds of walking
 * is a much smaller thing than loading into a wall.
 *
 * ## Leaving
 *
 * `beforeunload` is unreliable on iOS and this game is played on a phone, so
 * the exit write is hooked to `pagehide` and to `visibilitychange` (which is
 * what actually fires when a child presses the home button or switches apps)
 * as well. All three call the same idempotent, revision-gated write, so firing
 * all three in a row costs one save.
 */

/** How often the park is written down, in milliseconds. */
const AUTOSAVE_INTERVAL_MS = 5000;

/**
 * How far she has to have moved for the position alone to be worth a write.
 *
 * A quarter of a metre: far below anything a child would notice on reload, and
 * far above the jitter of standing still on a slope.
 */
const POSITION_EPSILON = 0.25;

/** What the save system needs from the game, and nothing more. */
export interface SaveSources {
  /** Feet position in world space — `Player.position`. */
  readonly position: () => { x: number; y: number; z: number };
  /** Yaw in radians — `Player.facing`. */
  readonly facing: () => number;
  /**
   * False while it would be wrong or expensive to write: a mini-game
   * starting or running, an iris wipe crossing between spaces, a ride in
   * progress.
   */
  readonly canSave: () => boolean;
}

export class SaveSystem {
  private readonly sources: SaveSources;
  private timer = 0;
  private attached = false;

  /** Combined `gameStore` + `saveFlags` change count at the last write. */
  private savedRevision = -1;

  /**
   * The last position it was safe to record, kept as loose fields rather than
   * an object so that capturing it every five seconds allocates nothing.
   */
  private goodSpace: SpaceId = 'garden';
  private goodX = 0;
  private goodY = 0;
  private goodZ = 0;
  private goodFacing = 0;
  private haveGoodPlace = false;
  /** World-space copy of the above, for the "has she moved?" comparison. */
  private savedWorldX = Number.NaN;
  private savedWorldY = Number.NaN;
  private savedWorldZ = Number.NaN;

  private readonly onPageHide = (): void => this.flush();
  private readonly onBeforeUnload = (): void => this.flush();
  private readonly onVisibilityChange = (): void => {
    // Only on the way *out*. Coming back is not a moment worth a write.
    if (document.visibilityState === 'hidden') this.flush();
  };

  constructor(sources: SaveSources) {
    this.sources = sources;
  }

  /** Starts the interval and hooks the three ways a page can go away. */
  start(): void {
    if (this.attached) return;
    this.attached = true;
    this.timer = window.setInterval(() => this.tick(), AUTOSAVE_INTERVAL_MS);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  stop(): void {
    if (!this.attached) return;
    this.attached = false;
    window.clearInterval(this.timer);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  dispose(): void {
    this.stop();
  }

  /**
   * Writes now if there is anything to write — what leaving the page calls.
   *
   * Unlike {@link tick} this does not refuse on a blocked moment: it falls
   * back to the last known good place instead, because "she was here five
   * seconds ago" beats losing the session.
   */
  flush(): void {
    if (this.sources.canSave()) this.captureGoodPlace();
    if (!this.hasChanged()) return;
    this.write();
  }

  // ----------------------------------------------------------------- inside

  private tick(): void {
    // A refused tick stays dirty and comes back in five seconds. Nothing is
    // queued or retried early; the state has not gone anywhere.
    if (!this.sources.canSave()) return;
    this.captureGoodPlace();
    if (!this.hasChanged()) return;
    this.write();
  }

  /** Records where she is, as a space id plus a local offset — never raw world. */
  private captureGoodPlace(): void {
    const p = this.sources.position();
    const space = spaceAt(p.x, p.z);
    const local = worldToLocal(space, p.x, p.y, p.z);
    this.goodSpace = space;
    this.goodX = local.x;
    this.goodY = local.y;
    this.goodZ = local.z;
    this.goodFacing = this.sources.facing();
    this.haveGoodPlace = true;
  }

  /** True if the park, the flags or her position have moved on since the last write. */
  private hasChanged(): boolean {
    if (gameStore.revision + saveFlags.revision !== this.savedRevision) return true;
    if (!this.haveGoodPlace) return false;
    const p = this.sources.position();
    return (
      !near(p.x, this.savedWorldX) || !near(p.y, this.savedWorldY) || !near(p.z, this.savedWorldZ)
    );
  }

  private write(): void {
    const file: {
      v: number;
      at: number;
      purchases: number;
      game: SaveFile['game'];
      flags: SaveFile['flags'];
      place?: SavedPlace;
    } = {
      v: SAVE_VERSION,
      at: Date.now(),
      purchases: gameStore.purchases,
      game: gameStore.savedGame(),
      flags: saveFlags.snapshot(),
    };
    if (this.haveGoodPlace) {
      file.place = {
        space: this.goodSpace,
        x: this.goodX,
        y: this.goodY,
        z: this.goodZ,
        facing: this.goodFacing,
      };
    }

    if (!writeSave(file)) return;

    // Only count it as saved if storage actually took it — a full or disabled
    // store means every tick should keep trying, not go quiet.
    this.savedRevision = gameStore.revision + saveFlags.revision;
    const p = this.sources.position();
    this.savedWorldX = p.x;
    this.savedWorldY = p.y;
    this.savedWorldZ = p.z;
  }
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < POSITION_EPSILON;
}
