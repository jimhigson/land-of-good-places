import { DirectionalLight, HemisphereLight, OrthographicCamera, Scene, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { gameStore } from '../../state';
import { shopItem } from '../../world/building/shops/catalogue';
import { createCandyShower, type CandyShower } from './candyShower';
import { createSpookyFace, type EyeStalk, type SpookyFace } from './face';
import { createHotspot, type Hotspot } from './hotspots';
import { createSpookyHud, type SpookyHud } from './hud';
import { JumpscareDirector } from './jumpscare';
import { createSpookyRoom, type SpookyRoom } from './room';
import { playBooSound, playCandySound, playPopSound, playSquirtSound } from './sounds';
import { createScreenSplash, createSquirt, type ScreenSplash, type Squirt } from './squirt';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * How long a visit lasts, in seconds.
 *
 * There is still no score and no fail state — it is a toy box — but it does
 * have an ending now, because every other ride and game in the park ends by
 * itself and being let out is how you leave one.
 */
const VISIT_SECONDS = 30;

/**
 * **The Spooky House** — a fun-fair stall that opens onto a dim, cosy little
 * room with one enormous comic-scary face on the back wall. The family spec
 * (GAME_DESIGN.md, "The spooky house") was originally three exact
 * interactions and nothing else:
 *
 * - tap an eye → it pops out on a stalk with a boing, then springs back
 * - tap the mouth → water squirts out at the camera
 * - tap the mouth **twice quickly** → candy pours out, and it's a real
 *   collectible (the Cute-o-dex entry, `catalogue.ts`'s `candy.spookyHouse`)
 *
 * #293 (18 August 2026) added a fourth layer on top of those three, not a
 * fourth thing to tap: roughly {@link JUMPSCARE_TUNING}`.cycles` times per
 * visit the face lunges out at the camera (the same `boo()` lean it already
 * had, just bigger and timed) and, for a short reflex window while it's out,
 * a tap that lands on an eye or the mouth — the *same* tap, doing the *same*
 * eye-pop/squirt/candy thing it always did — also scores a point on the new
 * reflex tally. See `jumpscare.ts` for the cycle's own state machine and the
 * reasoning behind its timing. This is the one place "no score and no fail
 * state" stopped being quite true: there is a score now (the reflex tally,
 * shown once the first jump-scare fires), but still no fail state — missing
 * a window costs nothing, the face just tries again next cycle.
 *
 * The whole visit still ends itself: {@link VISIT_SECONDS}. It used to have
 * no ending at all, and leaving meant pressing the framework's ✕. That ✕ is
 * gone (getting out of anything in this park is waiting for it to finish),
 * and a toy box with no ending would have been a toy box with no way out.
 *
 * The one wrinkle: every other stall in this park is a one-button "hold"
 * game (`types.ts`), but this one needs to know *which* of three things was
 * tapped. See `hotspots.ts` for how that is done without touching the shared
 * framework: three DOM hit targets, projected from world space every frame.
 */

// ------------------------------------------------------------------- tuning

/**
 * The camera frame, in metres either side of centre.
 *
 * The room is taller than it is wide (a big face over a floor), which is the
 * opposite tension to Rail Racer's wide, low racetrack — so this "contains"
 * *both* a minimum width and a minimum height, growing whichever the current
 * aspect ratio would otherwise starve. A narrow phone gets a taller frame
 * (more ceiling and floor visible, guaranteed face width); a wide monitor
 * gets a wider one (more room either side, guaranteed face height). Neither
 * ever crops the face.
 */
const MIN_HALF_WIDTH = 3.3;
const MIN_HALF_HEIGHT = 4.0;

const CAMERA_POS = new Vector3(0, 5.6, 10);
const CAMERA_TARGET = new Vector3(0, 3.3, -4);

/** Where the face stands against the back wall. */
const FACE_POSITION = new Vector3(0, 3.9, -5.3);

/** Second tap has to land within this long to count as a double-tap. */
const DOUBLE_TAP_MS = 320;

/** How many sweets one pour gives out. */
const CANDY_PER_POUR = 10;

class SpookyHouse implements MiniGame {
  readonly id = 'spookyHouse';
  readonly title = 'The Spooky House';
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 60);

  private room: SpookyRoom | null = null;
  private face: SpookyFace | null = null;
  private squirt: Squirt | null = null;
  private splash: ScreenSplash | null = null;
  private candyShower: CandyShower | null = null;
  private hud: SpookyHud | null = null;
  private readonly hotspots: Hotspot[] = [];
  private holdPad: HTMLElement | null = null;

  private readonly rng = new Rng(0x5900d1);
  private aspect = 1;
  private candyCount = 0;
  private context: MiniGameContext | null = null;
  /** Seconds left in the house. See {@link VISIT_SECONDS}. */
  private remaining = VISIT_SECONDS;
  /** The jump-scare cycle (#293). Built in `init()` so it shares `this.rng`. */
  private jumpscare: JumpscareDirector | null = null;
  private splashTimer: ReturnType<typeof window.setTimeout> | null = null;

  private mouthTapAt = -Infinity;
  private mouthWaitTimer: ReturnType<typeof window.setTimeout> | null = null;

  // ------------------------------------------------------------------ setup

  init(context: MiniGameContext): void {
    this.context = context;

    // Warm-purple ambient plus one cool fill: the "cosy dim room" look comes
    // from colour temperature, not from actually dropping the light level —
    // see the note on this in `room.ts`.
    this.scene.add(new HemisphereLight(0x9a86e0, 0x2c2140, 1.0));
    const key = new DirectionalLight(PALETTE.markerLemon, 1.4);
    key.position.set(1.5, 6, 8);
    this.scene.add(key, key.target);
    const fill = new DirectionalLight(PALETTE.markerMint, 0.65);
    fill.position.set(-4, 3.5, 5);
    this.scene.add(fill);

    this.room = createSpookyRoom();
    this.scene.add(this.room.root);

    this.face = createSpookyFace();
    this.face.root.position.copy(FACE_POSITION);
    this.scene.add(this.face.root);

    this.squirt = createSquirt();
    this.scene.add(this.squirt.root);

    this.candyShower = createCandyShower();
    this.scene.add(this.candyShower.root);

    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_TARGET);
    this.camera.updateMatrixWorld();

    this.hud = createSpookyHud(context.overlay);
    this.hud.shout(
      context.touch ? 'Tap an eye! Tap the mouth!' : 'Click an eye! Click the mouth!',
      3.6,
    );

    this.splash = createScreenSplash(context.overlay);

    // This game has no hold button — hide the framework's "HOLD to go!" pad.
    // `.mg-hold` is the framework's own public CSS hook (`minigames/overlay.ts`);
    // reaching for it by class name rather than adding an API the framework
    // doesn't have yet keeps this a change to one file, not two. Restored on
    // `dispose()` so the next stall (which *does* want it) still gets it.
    this.holdPad = context.overlay.closest('.mg-layer')?.querySelector<HTMLElement>('.mg-hold') ?? null;
    if (this.holdPad) this.holdPad.style.display = 'none';

    const leftEye = this.face.leftEye;
    const rightEye = this.face.rightEye;
    this.hotspots.push(
      createHotspot(context.overlay, this.camera, leftEye.anchor, 17, () => this.tapEye(leftEye)),
      createHotspot(context.overlay, this.camera, rightEye.anchor, 17, () => this.tapEye(rightEye)),
      createHotspot(context.overlay, this.camera, this.face.mouthAnchor, 22, () => this.tapMouth()),
    );

    // Shares `this.rng` with everything else in this stall — one seeded
    // stream for the whole visit, same as before #293.
    this.jumpscare = new JumpscareDirector(this.rng);
  }

  // ------------------------------------------------------------------ frame

  update(frame: MiniGameFrame): void {
    const { dt, elapsed } = frame;

    // The visit ends itself. It used to run until a child pressed the
    // framework's ✕, which was the only game here that could not finish on its
    // own — and once getting out of anything became "wait for it to finish"
    // (Jim, 3 August 2026), a toy box with no ending was a toy box with no way
    // out. Half a minute is long enough to find all three tricks and short
    // enough to want another go.
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = Number.POSITIVE_INFINITY;
      this.context?.finish({
        id: this.id,
        outcome: 'finished',
        seconds: VISIT_SECONDS,
        message: this.finishMessage(),
      });
    }

    this.room?.update(elapsed);
    this.face?.update(dt, elapsed);
    this.squirt?.update(dt);
    this.splash?.update(dt);
    this.candyShower?.update(dt, this.collectCandy);
    this.hud?.update(dt);
    for (const hotspot of this.hotspots) hotspot.update();

    // The jump-scare cycle (#293) — see `jumpscare.ts` for the state machine
    // and its timing. `update()` can return more than one event on a dropped
    // frame, so this is a loop, not an `if`.
    for (const event of this.jumpscare?.update(dt) ?? []) {
      if (event.kind === 'jumpOut') {
        this.face?.boo(event.windowSeconds);
        playBooSound();
        this.hud?.shout(event.cycleIndex === 0 ? 'Here it comes — tap it!' : 'Quick — tap it!', 1.1);
        for (const hotspot of this.hotspots) hotspot.setActive(true);
      } else if (event.kind === 'retreat') {
        for (const hotspot of this.hotspots) hotspot.setActive(false);
        // A hit already got its own "Got it!" and score-pill update the
        // instant the tap landed (`registerJumpscareHit`) — instant feedback
        // matters more than end-of-cycle feedback for a reflex game. A miss
        // gets nothing here on purpose: "always kind, nobody loses" means a
        // missed window is just quiet, not a scolding.
      }
      // 'complete' needs no reaction here — `finishMessage()` reads the
      // director's own final score straight off it when the visit ends.
    }
  }

  /** What the visit's closing card says. Always kind — nobody loses here (`types.ts`). */
  private finishMessage(): string {
    // `this.jumpscare` is only ever null before `init()` has run, which
    // cannot happen here — the framework always calls `init()` before a
    // single `update()`. The `??` is defensive typing, not a real case.
    const reflexLine = this.jumpscare
      ? `You caught ${this.jumpscare.score} of ${this.jumpscare.cycleCount} jump-scares!`
      : 'Boo! Come back soon.';
    return this.candyCount > 0 ? `${reflexLine} And you found the candy!` : reflexLine;
  }

  // -------------------------------------------------------------- the taps

  /**
   * Tells the jump-scare cycle (#293) a tap landed on a reflex target — call
   * this from every tap handler below, before any of its own effect. Scores
   * only when a window is actually open, and only once per cycle
   * (`JumpscareDirector.registerHit`), so calling it unconditionally on
   * every eye/mouth tap is always safe: it is a no-op outside a jump-scare.
   */
  private registerJumpscareHit(): void {
    if (!this.jumpscare?.registerHit()) return;
    this.hud?.shout('Got it!', 0.8);
    this.hud?.setReflexScore(this.jumpscare.score, this.jumpscare.cycleCount);
  }

  private tapEye(eye: EyeStalk): void {
    this.registerJumpscareHit();
    if (eye.popped) return; // already mid-boing — let it finish.
    eye.popOut();
    playPopSound();
  }

  /**
   * One tap squirts, two quick taps pour candy instead — never both. The
   * first tap is held back for {@link DOUBLE_TAP_MS} in case a second one is
   * on its way; that little wait is the only way to tell "one tap" from "the
   * first half of two" apart at all.
   */
  private tapMouth(): void {
    this.registerJumpscareHit();

    const now = performance.now();
    const sinceLast = now - this.mouthTapAt;
    this.mouthTapAt = now;

    if (sinceLast < DOUBLE_TAP_MS) {
      if (this.mouthWaitTimer !== null) {
        window.clearTimeout(this.mouthWaitTimer);
        this.mouthWaitTimer = null;
      }
      this.pourCandy();
      return;
    }

    this.mouthWaitTimer = window.setTimeout(() => {
      this.mouthWaitTimer = null;
      this.squirtWater();
    }, DOUBLE_TAP_MS);
  }

  private squirtWater(): void {
    if (!this.face || !this.squirt) return;
    this.face.openMouth();
    const origin = new Vector3();
    this.face.mouthAnchor.getWorldPosition(origin);
    this.squirt.fire(origin);
    playSquirtSound();

    // Roughly when the spray reaches the viewer (see the droplet ttl in
    // `squirt.ts`) — timed by feel, not read back from the particle system,
    // since the splash is a screen-space flourish and does not need to be
    // exact.
    if (this.splashTimer !== null) window.clearTimeout(this.splashTimer);
    this.splashTimer = window.setTimeout(() => {
      this.splashTimer = null;
      this.splash?.trigger();
    }, 420);
  }

  private pourCandy(): void {
    if (!this.face || !this.candyShower) return;
    this.face.openMouth();
    const origin = new Vector3();
    this.face.mouthAnchor.getWorldPosition(origin);
    this.candyShower.pour(origin, CANDY_PER_POUR);
    playCandySound();
  }

  /** Fired once per sweet, the instant the candy shower considers it "landed". */
  private readonly collectCandy = (): void => {
    const item = shopItem('candy.spookyHouse');
    if (!item) return;
    const bought = gameStore.buy({
      id: item.id,
      kind: item.kind,
      displayName: item.displayName,
      icon: item.icon,
      category: item.category,
      shopId: item.shopId,
      price: item.price,
      carryable: item.carryable,
    });
    // A sweet is a `treat`, so the store eats it rather than filing it in the
    // backpack (`isEdible`, `state/store.ts`) — which is what the family asked
    // for and what a child does with a sweet. There is no munch to show here:
    // the spooky house is its own scene with its own camera and the player's
    // model is not in it, and a shower of sweets would be a machine-gun of
    // chomps in any case. `playCandySound` is already the feedback, and the
    // Cute-o-dex records the sweet exactly as it records an ice cream.
    if (bought.outcome === 'refused') return;
    this.candyCount += 1;
    this.hud?.setCandyCount(this.candyCount);
  };

  // ------------------------------------------------------------- lifecycle

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    const halfHeight = Math.max(MIN_HALF_HEIGHT, MIN_HALF_WIDTH / this.aspect);
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const hotspot of this.hotspots) hotspot.dispose();
    this.hotspots.length = 0;

    if (this.mouthWaitTimer !== null) {
      window.clearTimeout(this.mouthWaitTimer);
      this.mouthWaitTimer = null;
    }
    if (this.splashTimer !== null) {
      window.clearTimeout(this.splashTimer);
      this.splashTimer = null;
    }
    if (this.holdPad) {
      this.holdPad.style.display = '';
      this.holdPad = null;
    }

    this.room?.dispose();
    this.face?.dispose();
    this.squirt?.dispose();
    this.splash?.dispose();
    this.candyShower?.dispose();
    this.hud?.dispose();
    this.scene.clear();
  }
}

/** The factory the stall registers. */
export function createSpookyHouse(): MiniGame {
  return new SpookyHouse();
}
