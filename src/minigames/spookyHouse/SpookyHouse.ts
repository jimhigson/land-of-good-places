import { DirectionalLight, HemisphereLight, OrthographicCamera, Scene, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { gameStore } from '../../state';
import { shopItem } from '../../world/building/shops/catalogue';
import { createCandyShower, type CandyShower } from './candyShower';
import { createSpookyFace, type EyeStalk, type SpookyFace } from './face';
import { createHotspot, type Hotspot } from './hotspots';
import { createSpookyHud, type SpookyHud } from './hud';
import { createSpookyRoom, type SpookyRoom } from './room';
import { playBooSound, playCandySound, playPopSound, playSquirtSound } from './sounds';
import { createScreenSplash, createSquirt, type ScreenSplash, type Squirt } from './squirt';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * **The Spooky House** — a fun-fair stall that opens onto a dim, cosy little
 * room with one enormous comic-scary face on the back wall. The family spec
 * (GAME_DESIGN.md, "The spooky house") is three exact interactions and
 * nothing else:
 *
 * - tap an eye → it pops out on a stalk with a boing, then springs back
 * - tap the mouth → water squirts out at the camera
 * - tap the mouth **twice quickly** → candy pours out, and it's a real
 *   collectible (the Cute-o-dex entry, `catalogue.ts`'s `candy.spookyHouse`)
 *
 * No score, no fail state, no time limit — "it's a toy box" — so unlike Rail
 * Racer this game never calls `context.finish()` itself. Pressing the
 * framework's own ✕ (or Escape / gamepad B) is the only way out, and the
 * framework already turns that into a `quit` result on its own (see
 * `MiniGameHost.updateGame`), so there is nothing to wire up here.
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

/** How often the face leans in for a playful "boo!". */
const BOO_MIN_SECONDS = 17;
const BOO_MAX_SECONDS = 29;

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
  private nextBoo = BOO_MIN_SECONDS;
  private splashTimer: ReturnType<typeof window.setTimeout> | null = null;

  private mouthTapAt = -Infinity;
  private mouthWaitTimer: ReturnType<typeof window.setTimeout> | null = null;

  // ------------------------------------------------------------------ setup

  init(context: MiniGameContext): void {

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

    this.nextBoo = this.rng.range(BOO_MIN_SECONDS, BOO_MAX_SECONDS);
  }

  // ------------------------------------------------------------------ frame

  update(frame: MiniGameFrame): void {
    const { dt, elapsed } = frame;

    this.room?.update(elapsed);
    this.face?.update(dt, elapsed);
    this.squirt?.update(dt);
    this.splash?.update(dt);
    this.candyShower?.update(dt, this.collectCandy);
    this.hud?.update(dt);
    for (const hotspot of this.hotspots) hotspot.update();

    this.nextBoo -= dt;
    if (this.nextBoo <= 0) {
      this.nextBoo = this.rng.range(BOO_MIN_SECONDS, BOO_MAX_SECONDS);
      this.face?.boo();
      playBooSound();
      this.hud?.shout('Boo! ...just kidding!', 1.6);
    }
  }

  // -------------------------------------------------------------- the taps

  private tapEye(eye: EyeStalk): void {
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
