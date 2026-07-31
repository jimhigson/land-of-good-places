import {
  Box3,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PALETTE } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { disposeTree, toonMaterial } from '../art/style/materials';
import { attachFacePaint, createKid, type KidHandle } from '../art/models/kid';
import { TRAILING_HAIR_STYLES } from '../art/models/hair';
import type { Expression, FacePaintDesign } from '../art/style/faces';
import type { BackpackKind, HairStyle, ShoeKind } from '../state';
import { pixelRatioCap } from '../core/device';
import { shopItem } from '../world/building/shops/catalogue';

/**
 * The character creator's live 3D preview: its own tiny scene, camera and
 * renderer, entirely separate from the main game's `Engine`/`IsoCamera`.
 *
 * Deliberately separate rather than borrowed: character creation runs
 * *before* either exists (see `main.ts`'s `boot()`), and this preview is
 * disposed for good the moment "Let's go!" hands over to the real thing — a
 * `WebGLRenderer` that only ever draws a kid, a hat and a pet on a little
 * plinth is a few dozen lines, not worth threading through `Engine`'s fog,
 * shadow map and resize-to-the-whole-window machinery, none of which this
 * needs.
 *
 * Cheap on purpose: no shadow map, a handful of primitives, rebuilt from
 * scratch on every choice rather than trying to patch a live model in place —
 * a hair *style* change (bunches/bob/short) swaps meshes, not just a colour,
 * so "always rebuild" is both the simplest code and the only option that
 * covers every kind of change with one code path.
 *
 * **Not a frozen doll.** The kid blinks on the same irregular timer
 * `Player.ts` uses, and drifts through a happy or surprised look every few
 * seconds so she reads as a person waiting for you rather than a mannequin.
 * Every {@link update} call — which is every time the child taps a swatch —
 * also holds a brief happy face, the same "it worked!" beat the parade and
 * the carried-item pop use elsewhere in the game.
 */
export interface PreviewChoice {
  readonly skin: number;
  readonly hair: number;
  /**
   * Always a real choice, never omitted — kept as the bare, non-optional
   * `HairStyle` rather than `KidOptions['hairStyle']` (which is `| undefined`,
   * since it's an optional constructor option there) so this stays assignable
   * under `tsconfig`'s `exactOptionalPropertyTypes`.
   */
  readonly hairStyle: HairStyle;
  readonly outfit: number;
  readonly eye: number;
  /** Which bag she wears. Bare and non-optional for the same reason `hairStyle` is. */
  readonly backpack: BackpackKind;
  readonly backpackColour: number;
  /** Which pair she wears. Bare and non-optional for the same reason `hairStyle` is. */
  readonly shoes: ShoeKind;
  readonly shoesColour: number;
  readonly hatId: string;
  readonly petId: string;
  /**
   * The face-paint design worn, `null` for a clean face — or **omitted** by a
   * screen that does not paint faces (the character creator), which is why it
   * is optional rather than nullable-and-required under
   * `exactOptionalPropertyTypes`.
   */
  readonly facePaint?: FacePaintDesign | null;
}

/**
 * How much of the character a screen is about — the resting framing its camera
 * returns to once a moment's close-up has passed.
 *
 * GAME_DESIGN.md's PREVIEW RULE: *"each such screen should be framed for what
 * it changes: face painting zooms right in on the face; a hat frames the head;
 * a pet frames the pet."* The character creator changes everything, so it
 * rests on the whole character (`full`); the face-painting stall changes one
 * thing, on the face, so it rests there (`face`) and never pulls back.
 *
 * Deliberately a small, closed vocabulary of *what a screen is for*, rather
 * than exposing {@link PreviewFocus} itself: a resting framing of `pet` or
 * `hair` is not a thing any screen wants today, and every value here has to
 * hold up as somewhere the camera can simply live.
 */
export type PreviewFraming = 'full' | 'face';

const RESTING_FOCUS: Readonly<Record<PreviewFraming, PreviewFocus>> = {
  full: 'all',
  face: 'face',
};

/**
 * What the camera is currently looking at.
 *
 * The family's note: *"the hat you are choosing is cropped out — when changing
 * the hat the camera should zoom in on just the head… Same with changing the
 * pet… and the face for eye colour."* So the preview frames whatever the child
 * just touched, holds it for a moment, and drifts back to the whole character.
 *
 * `hair` is the one that is not simply "a smaller part of the character": the
 * styles that hang down the back are longer than the head, and hidden behind
 * the child in a front view, so that framing both measures the hair itself and
 * turns the plinth — see {@link CharacterPreview.updateTurntable}.
 *
 * `feet` needs none of `backpack`'s turntable trick — shoes sit on the
 * *front* of the child, in plain sight from the same dead-on view every other
 * close-up already uses, so it is simply a tighter, lower box (see
 * {@link CharacterPreview.boxFor}).
 */
export type PreviewFocus = 'all' | 'head' | 'hair' | 'face' | 'body' | 'backpack' | 'feet' | 'pet';

/**
 * Where the camera sits relative to whatever it is framing: dead in front, and
 * a little above, so a face is seen at a friendly slight downward angle rather
 * than from below. Length is irrelevant — it is normalised and scaled by the
 * fitted distance.
 *
 * **Deliberately the same for every framing.** The hanging hair styles need to
 * be seen from the side, but the fix for that is to turn the *plinth* (see
 * {@link TAIL_TURN}), not to move the camera off-axis: a hat, a face and a pet
 * were all tuned against a dead-on view, and swinging the camera round would
 * have re-tuned all three to fix one.
 */
const VIEW_DIRECTION = new Vector3(0, 0.16, 1).normalize();

/**
 * Breathing room around each framing, as a multiplier on the fitted distance.
 *
 * 1.0 would put the subject's bounding box exactly at the edges of the frame.
 * A face wants noticeably more than a head does — a close-up cropped at the
 * hairline reads as a mistake, whereas a head framed tight reads as deliberate
 * — and a pet is small enough that a little of the kid beside it is welcome
 * context rather than clutter.
 */
const FOCUS_MARGIN: Readonly<Record<PreviewFocus, number>> = {
  all: 1.12,
  head: 1.1,
  // The hair box is measured with the tail at rest; it swings outside that as
  // the plinth turns, so this leaves it somewhere to go.
  hair: 1.18,
  face: 1.24,
  body: 1.14,
  // A bag on a back seen three-quarters on is a small subject with a whole
  // child beside it; the margin keeps her shoulder in shot for scale.
  backpack: 1.2,
  // Feet are the smallest thing any screen frames on purpose — tighter than a
  // head, but not as tight as `face`, which can crop right to the hairline
  // because a face has no ground under it that also needs to read.
  feet: 1.16,
  pet: 1.32,
};

/** Seconds a framing is held after the last change before easing back to `all`. */
const FOCUS_HOLD_SECONDS = 2.4;

/**
 * How briskly the camera moves between framings, as an exponential-damping
 * rate (roughly "e-folds per second"). Fast enough that a child tapping
 * through hats is not waiting for the camera, slow enough to read as a move
 * rather than a cut.
 */
const CAMERA_RATE = 5.5;

// --- the turntable ---------------------------------------------------------
//
// The plinth rocks back and forth rather than spinning, so a child never has
// to wait for the front of the character to come round again. Two settings,
// because one of them cannot show a floor-length ponytail at all.

/** The resting rock: half-width in radians, and speed in radians per second. */
const ROCK_AMPLITUDE = 0.55;
const ROCK_RATE = 0.35;

/**
 * How far round the plinth turns while a style that hangs down the back is on
 * show (see `art/models/hair.ts`'s `TRAILING_HAIR_STYLES`).
 *
 * Measured, not guessed. The hair hangs about 0.65 m behind the character's
 * own axis, so at a turn of θ it appears 0.65·sin θ to one side; the widest
 * thing it has to clear is her hands, about 0.5 m out. That needs sin θ > 0.77,
 * so θ > 50°, and the rock below either side of this keeps it there. Turning
 * *this* way (positive, towards the camera's right) also swings the tail away
 * from the pet, which stands at the character's front-right and was half the
 * reason the tail could not be seen.
 */
const TAIL_TURN = 1.1;

/**
 * The rock while turned: narrower, and much brisker.
 *
 * Narrower because the whole 0.5 rad of the default rock either side of
 * {@link TAIL_TURN} would swing the tail back behind the body for part of
 * every cycle. Brisker because the default is *far* too slow to move it: the
 * anchor's peak acceleration under the resting rock is 0.55 × 0.35² × 0.65 ≈
 * 0.04 m/s², against a hair gravity of 16, which deflects the tail by about a
 * twentieth of a degree — invisible. At this rate it is 0.25 × 2.5² × 0.65 ≈
 * 1.0 m/s², and the drive sits close enough under the tail's own pendulum
 * frequency (√(16 / 1.3) ≈ 3.5 rad/s) to be amplified by it. She sways; the
 * tail swishes, which is the entire reason this style exists.
 */
const TAIL_ROCK_AMPLITUDE = 0.25;
const TAIL_ROCK_RATE = 2.5;

/**
 * How briskly the plinth turns between the two, as an exponential-damping rate.
 *
 * This is also the swish: a 1.1 rad turn at this rate starts at about 2.4 rad/s
 * — a character turning to show you something, not a spin — and the tail is
 * thrown out behind it and swings back a couple of times as she settles.
 */
const TURN_RATE = 2.2;

/**
 * The framings that turn the plinth for a trailing style: the ones that show
 * the body at all.
 *
 * `head`, `face` and `pet` are deliberately absent. Those are the close-ups
 * the family asked for — the hat, the eye colour, the pet — and every one of
 * them was tuned against a character facing the camera. A child choosing an
 * eye colour gets a face, not a profile; the turn simply unwinds for a moment
 * and then comes back, which swishes the tail again on the way.
 */
const TAIL_FOCUSES: ReadonlySet<PreviewFocus> = new Set<PreviewFocus>(['all', 'hair', 'body']);

/**
 * How far round the plinth turns to show the backpack, in radians.
 *
 * Nearly all the way round — 126°, against {@link TAIL_TURN}'s 63° — because a
 * backpack is not "partly hidden behind the child" the way a hanging ponytail
 * is, it is *directly* behind her, and the whole of her is in front of it. The
 * one way to look at somebody's bag is to walk round the back of them.
 *
 * It rides the same eased turn the tail does (see {@link CharacterPreview.tailShow}),
 * so the plinth swings there and back rather than cutting, and it is added to
 * that turn rather than replacing it — `backpack` is deliberately not in
 * {@link TAIL_FOCUSES}, so exactly one of the two is ever non-zero.
 */
const BACK_TURN = 2.2;

// Scratch vectors — `updateCamera` runs every frame and must not allocate.
const SCRATCH_CENTRE = new Vector3();
const SCRATCH_SIZE = new Vector3();
const SCRATCH_TARGET = new Vector3();
const SCRATCH_DESIRED = new Vector3();

/** How long the eyes stay shut — same beat as `Player.ts`'s blink. */
const BLINK_DURATION = 0.11;

/** Seconds a "just picked something" happy face is held before idling resumes. */
const REACT_SECONDS = 1.2;

/** Seconds a spontaneous idle mood (happy/surprised) is held. */
const MOOD_HOLD_SECONDS = 1.3;

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  /** Everything that turns gently on the turntable — plinth, kid, pet. */
  private readonly stage = new Group();

  private character: Group | null = null;
  private kid: KidHandle | null = null;
  private pet: Object3D | null = null;
  private rafHandle: number | null = null;
  private elapsed = 0;
  private lastTime = 0;
  private disposed = false;
  /** Same accessibility rule the rest of the game's CSS animations follow. */
  private readonly spinsAllowed =
    typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // --- face life: blink timer, idle mood drift, and the "you picked something"
  // reaction. Mirrors `Player.ts`'s own blink state machine so the preview kid
  // and the in-game one feel like the same character. ------------------------
  private blinkTimer = 1.4 + Math.random() * 2.2;
  private blinkRemaining = 0;
  private moodTimer = 3 + Math.random() * 3;
  private mood: Expression = 'neutral';
  private moodRemaining = 0;
  /** Elapsed-time deadline until which a fresh choice's happy face holds. */
  private reactUntil = 0;
  private currentExpression: Expression = 'neutral';

  // --- camera framing: what the child just changed, and where that is. -------
  /**
   * Where the camera lives when nothing has just changed — `all` for the
   * character creator, `face` for the face-painting stall. See
   * {@link PreviewFraming}.
   *
   * Mutable, not `readonly`: the character creator's tab strip
   * ({@link setResting}) moves this whenever the child switches tabs, so
   * "the whole character" is only ever one tab's resting place among several,
   * not a fact fixed for the screen's whole lifetime the way it still is for
   * the face-painting stall (which never calls {@link setResting} and simply
   * keeps the value {@link PreviewFraming} gave it at construction).
   */
  private resting: PreviewFocus;
  private focus: PreviewFocus;
  /** Elapsed-time deadline after which {@link focus} eases back to {@link resting}. */
  private focusUntil = 0;
  /**
   * Bounding boxes per focus, measured with the turntable held at zero so they
   * are rotation-independent, and re-measured only when the character is
   * rebuilt. `null` means "measured, and there is nothing there" (no pet), so
   * a missing subject is not re-measured every frame.
   *
   * Boxes rather than camera positions: the distance depends on the canvas's
   * live aspect ratio, which changes on rotate and reflow, so it is derived
   * per frame from the box instead of baked in here.
   */
  private readonly boxes = new Map<PreviewFocus, Box3 | null>();
  /** The point the camera is currently looking at — damped towards the target. */
  private readonly aim = new Vector3();
  /** False until the first framing, which snaps rather than swooping in. */
  private framed = false;

  // --- the turntable: how far round it has swung to show hair that hangs
  // down the back, and where it is in its rock. ------------------------------
  /** True while the built style hangs behind the head. See `TAIL_FOCUSES`. */
  private trailingHair = false;
  /** 0 = facing the camera, 1 = turned to {@link TAIL_TURN}. Eased, never cut. */
  private tailShow = 0;
  /** The same, for {@link BACK_TURN} — how far round to show the backpack. */
  private backShow = 0;
  /**
   * The rock's phase, accumulated rather than read off `elapsed`.
   *
   * It has to be: the rock's *rate* changes with {@link tailShow}, and
   * `sin(elapsed × rate)` would jump the plinth by whole radians the instant
   * the rate moved — which the hair simulation would read as the child's head
   * being flung sideways.
   */
  private rockPhase = 0;

  /**
   * @param options.framing what the screen using this preview is for. Defaults
   * to `full` — the whole character — so the character creator, and any future
   * caller that has not thought about it, gets the original behaviour.
   */
  constructor(options: { framing?: PreviewFraming } = {}) {
    this.resting = RESTING_FOCUS[options.framing ?? 'full'];
    this.focus = this.resting;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'charcreate-preview-canvas';

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(pixelRatioCap());
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Same choice as the main `Engine`: neutral tone mapping keeps the toy
    // colours saturated instead of rolling them off towards white.
    this.renderer.toneMapping = NeutralToneMapping;

    this.camera = new PerspectiveCamera(30, 1, 0.1, 30);
    this.camera.position.set(0, 1.32, 4.3);
    this.camera.lookAt(0, 1.02, 0);

    this.scene.add(this.stage);

    // Gallery staging colours (`ART.stageFloor` etc.) exist for exactly this:
    // presenting one character on a plinth, never used in the game world.
    const plinth = new Mesh(new CylinderGeometry(1.05, 1.15, 0.22, 28), toonMaterial(ART.stageFloor));
    plinth.position.y = -0.11;
    this.stage.add(plinth);

    // Same three-light rig as the park (`world/DayNight.ts`): a hemisphere
    // fill, a warm key, and a cool opposite fill — the toon ramp needs a real
    // directional light to band against, an ambient-only rig looks flat.
    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.15));
    const key = new DirectionalLight(PALETTE.sunDay, 2.0);
    key.position.set(2.4, 3.6, 2.8);
    this.scene.add(key);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.5);
    fill.position.set(-2.6, 1.8, -1.6);
    this.scene.add(fill);

    this.resize(320, 320);
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  /** Call whenever the canvas's CSS box changes size. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rebuilds the kid (+ hat, + pet) from scratch for the given choice, and
   * points the camera at whatever the child just changed.
   *
   * `focus` defaults to the screen's resting framing (see
   * {@link PreviewFraming}) so a caller that does not care — the very first
   * build, or a face-paint screen where every change is on the face anyway —
   * gets what that screen is about, with no camera move at all.
   */
  update(choice: PreviewChoice, focus: PreviewFocus = this.resting): void {
    if (this.character) {
      this.stage.remove(this.character);
      disposeTree(this.character);
      this.character = null;
      this.kid = null;
      this.pet = null;
    }
    // Everything measured belonged to the character just thrown away.
    this.boxes.clear();
    this.focus = focus;
    this.focusUntil = this.elapsed + FOCUS_HOLD_SECONDS;
    this.trailingHair = TRAILING_HAIR_STYLES.includes(choice.hairStyle);

    const group = new Group();

    const kid = createKid({
      skin: choice.skin,
      hair: choice.hair,
      hairStyle: choice.hairStyle,
      outfit: choice.outfit,
      eyeColour: choice.eye,
      backpackKind: choice.backpack,
      backpackColour: choice.backpackColour,
      shoe: choice.shoesColour,
      shoeKind: choice.shoes,
    });
    // A fresh choice gets an immediate happy face — the same "it worked!"
    // beat a purchase or a pet pick gets everywhere else in the game — and
    // `reactUntil` keeps `frame()`'s idle blink/mood logic from stepping on
    // it for a moment.
    kid.setExpression('happy');
    this.currentExpression = 'happy';
    this.reactUntil = this.elapsed + REACT_SECONDS;
    this.moodRemaining = 0;
    this.kid = kid;
    group.add(kid.root);

    // The face paint, if this screen has any — built by the very same call the
    // face-painting stall makes on the real player (`attachFacePaint`), so the
    // design previewed here is the design she walks away wearing, drawn by one
    // piece of code rather than two that agree today.
    const paint = choice.facePaint ?? null;
    if (paint) attachFacePaint(kid).setDesign(paint);

    // Same attachment every worn hat uses in the real game — see
    // `art/models/hats.ts`'s doc comment: no offset maths needed.
    const hatAsset = shopItem(choice.hatId)?.model();
    if (hatAsset) kid.hatAnchor.add(hatAsset.root);
    // Same courtesy `entities/WornHat.ts` does in the park: tell the model a
    // hat is on so the spiky style tucks its spikes away instead of skewering
    // it. The preview always puts *some* hat on, so this is always true today
    // — written as a condition anyway, because "no hat" is one shop item away.
    kid.setHatWorn(hatAsset !== undefined);

    // The chosen starting pet, stood beside the kid at its own natural scale
    // — the same scale it will actually walk behind the player at in the
    // parade (see `entities/parade/ParadeMember.ts`; nothing there rescales a
    // paradeable thing).
    const petAsset = shopItem(choice.petId)?.model();
    if (petAsset) {
      petAsset.root.position.set(0.92, 0, 0.32);
      petAsset.root.rotation.y = -0.5;
      group.add(petAsset.root);
      this.pet = petAsset.root;
    }

    this.stage.add(group);
    this.character = group;

    // The kid was built at the origin, unturned; the plinth it has just been
    // put on is not. The ponytail simulates in world space, so without this it
    // would spend the next second whipping across from where it thought it was
    // — on every single tap, since every tap rebuilds the character. It also
    // has to happen before `boxFor('hair')` measures the tail, so the framing
    // is taken from a tail at rest rather than one mid-flight.
    kid.resetHair();
  }

  /**
   * Moves where the camera rests once nothing is transiently in focus —
   * what the character creator's tab strip calls on every switch, generalising
   * the PREVIEW RULE's "framed for what it changes" from *the last thing
   * tapped* to *the whole tab currently open* (GAME_DESIGN.md).
   *
   * Deliberately also retargets {@link focus} itself rather than only
   * {@link resting}: nothing about the character changed, so there is nothing
   * for the usual `update()`-driven "hold {@link FOCUS_HOLD_SECONDS}, then
   * ease back" beat to hold *away from* — a tab switch is the new resting
   * place, immediately, not a temporary detour that will ease back to
   * wherever the old tab left it. `updateCamera`'s own damping still carries
   * the actual camera move there smoothly; only the destination jumps.
   */
  setResting(focus: PreviewFocus): void {
    this.resting = focus;
    this.focus = focus;
  }

  /**
   * Starts or stops the render loop.
   *
   * The character creator never needs this: it is disposed for good the moment
   * the game starts. A preview that lives inside the park does — the
   * face-painting stall's picker is built once and opened many times, and a
   * second WebGL context quietly rendering a kid on a plinth behind the park
   * for the whole session is a real cost for something nobody is looking at.
   *
   * Pausing rather than disposing and rebuilding, because a child opening and
   * closing the stall a dozen times would otherwise create a dozen WebGL
   * contexts, and browsers cap how many may be alive at once.
   */
  setRunning(running: boolean): void {
    if (this.disposed) return;
    if (running) {
      if (this.rafHandle !== null) return;
      // Drop the stale timestamp: `frame` would otherwise measure `dt` from
      // whenever the loop was last paused, and hand a clamped-but-still-large
      // step to the ponytail simulation on the first frame back.
      this.lastTime = 0;
      this.rafHandle = requestAnimationFrame(this.frame);
      return;
    }
    if (this.rafHandle === null) return;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    if (this.character) disposeTree(this.character);
    disposeTree(this.stage);
    this.renderer.dispose();
  }

  // -------------------------------------------------------------- internals

  private readonly frame = (time: number): void => {
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    this.elapsed += dt;
    this.updateTurntable(dt);
    // After the turntable, so the simulated ponytail sees this frame's angle:
    // it is driven from the anchor's WORLD position, which is exactly why the
    // hair swishes as the plinth rocks. Free on every other style.
    this.kid?.update(dt);
    this.updateFace(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  /**
   * The plinth's angle for this frame: a gentle rock, about a centre that
   * swings round when hair that hangs down the back is being shown.
   *
   * This is the whole fix for "the Swishy Pony is invisible". The tail hangs
   * roughly 0.65 m *behind* a child whose own head is 1.3 m across, so from
   * dead in front it is hidden by her — by her head at the top, her jumper in
   * the middle and her shoes at the bottom, with the pet covering what is
   * left. The camera cannot solve that from the front at any distance. Turning
   * the plinth can, and it costs the other framings nothing, because they turn
   * it straight back.
   *
   * The turn is also the *motion*: a swinging tail is the entire point of the
   * style, and the resting rock is nowhere near brisk enough to move one (see
   * {@link TAIL_ROCK_RATE}).
   */
  private updateTurntable(dt: number): void {
    const wanted = this.trailingHair && TAIL_FOCUSES.has(this.focus) ? 1 : 0;
    const wantedBack = this.focus === 'backpack' ? 1 : 0;
    // A player who has asked for reduced motion still gets to see the style —
    // they just get it turned, rather than turning. Same rule the camera
    // follows, and the same rule the rock itself has always followed.
    const blend = this.spinsAllowed ? 1 - Math.exp(-dt * TURN_RATE) : 1;
    this.tailShow += (wanted - this.tailShow) * blend;
    this.backShow += (wantedBack - this.backShow) * blend;

    const amplitude = ROCK_AMPLITUDE + (TAIL_ROCK_AMPLITUDE - ROCK_AMPLITUDE) * this.tailShow;
    const rate = ROCK_RATE + (TAIL_ROCK_RATE - ROCK_RATE) * this.tailShow;
    this.rockPhase += dt * rate;

    this.stage.rotation.y =
      TAIL_TURN * this.tailShow +
      BACK_TURN * this.backShow +
      (this.spinsAllowed ? Math.sin(this.rockPhase) * amplitude : 0);
  }

  /**
   * Measures a subtree's bounds with the turntable held at zero.
   *
   * The stage rocks back and forth continuously, so a box measured while it is
   * rotated would be both wider than the subject and different every frame.
   * Zeroing the rotation for the measurement gives a stable box, and
   * {@link updateCamera} rotates the resulting centre back onto the live
   * turntable angle instead.
   */
  private measure(...parts: readonly Object3D[]): Box3 | null {
    if (parts.length === 0) return null;
    const spin = this.stage.rotation.y;
    this.stage.rotation.y = 0;
    this.stage.updateMatrixWorld(true);
    const box = new Box3();
    for (const part of parts) box.expandByObject(part);
    this.stage.rotation.y = spin;
    this.stage.updateMatrixWorld(true);
    return box.isEmpty() ? null : box;
  }

  /** The bounds of one focus, measured once per character rebuild. */
  private boxFor(focus: PreviewFocus): Box3 | null {
    const cached = this.boxes.get(focus);
    if (cached !== undefined) return cached;

    const kid = this.kid;
    let box: Box3 | null = null;
    if (focus === 'all') {
      box = this.character ? this.measure(this.character) : null;
    } else if (focus === 'pet') {
      box = this.pet ? this.measure(this.pet) : null;
    } else if (kid) {
      if (focus === 'head') {
        // The hat is parented to `hatAnchor`, which lives under `head`, so a
        // tall hat is inside this box for free — which is the whole point:
        // the framing cannot crop a hat it measured.
        box = this.measure(kid.head);
      } else if (focus === 'hair') {
        // The head, so a hair colour is still framed on a face rather than on
        // a floating cap — plus every hair mesh actually on show. That second
        // part matters for exactly one style: the floor-length ponytail's
        // segments hang off the model **root**, not off the head, so a hair
        // framing measured from `kid.head` alone would crop 1.3 m of the very
        // thing being chosen. Hidden parts are skipped because `expandByObject`
        // does not check visibility, and a spiky style under a hat would
        // otherwise be framed around spikes nobody can see.
        box = this.measure(
          kid.head,
          ...kid.hairParts.filter((part) => part.mesh.visible).map((part) => part.mesh),
        );
      } else if (focus === 'backpack') {
        // Only the parts on show: the shapes she did not pick are hidden, not
        // absent, and `expandByObject` does not check visibility — a box drawn
        // round all five would frame a RiPika head nobody can see.
        box = this.measure(
          ...kid.backpackParts.filter((part) => part.mesh.visible).map((part) => part.mesh),
        );
      } else if (focus === 'face') {
        const patch = kid.root.getObjectByName('facePatch');
        box = patch ? this.measure(patch) : null;
      } else if (focus === 'feet') {
        // Both legs unconditionally, not `kid.shoeParts` alone: they carry the
        // foot blob itself, which *is* the whole shoe for `'plain'` — a kind
        // with no extra parts of its own to measure, unlike every other one.
        // The extra parts on top are still filtered by visibility, same as
        // `backpack` above, so a hidden RiPika toe cap never widens the box.
        box = this.measure(
          kid.limbs.leftLeg,
          kid.limbs.rightLeg,
          ...kid.shoeParts.filter((part) => part.mesh.visible).map((part) => part.mesh),
        );
      } else {
        // Clothes: the jumper and the limbs, deliberately NOT the head. The
        // hair bunches are wider than the kid's outstretched hands, so any box
        // containing the head is as wide as the whole character and "clothes
        // colour" would barely zoom at all.
        const torso = kid.root.getObjectByName('torso');
        box = this.measure(
          ...(torso ? [torso] : []),
          kid.limbs.leftArm,
          kid.limbs.rightArm,
          kid.limbs.leftLeg,
          kid.limbs.rightLeg,
        );
      }
    }

    this.boxes.set(focus, box);
    return box;
  }

  /**
   * Moves the camera towards whatever is currently in focus, then eases back
   * to the whole character once the moment has passed.
   *
   * Distance is *fitted to the box* rather than hand-tuned per focus, which is
   * what makes "the whole hat must be visible" true by construction instead of
   * true until somebody adds a taller hat. The two terms are the standard box
   * fit: how far back the tallest/widest half-extent has to be to fall inside
   * the frustum, plus the box's own half-depth, since the near face of the box
   * is what actually has to clear the frame edge.
   */
  private updateCamera(dt: number): void {
    if (this.focus !== this.resting && this.elapsed >= this.focusUntil) this.focus = this.resting;

    const box = this.boxFor(this.focus) ?? this.boxFor('all');
    if (!box) return;

    const centre = box.getCenter(SCRATCH_CENTRE);
    const size = box.getSize(SCRATCH_SIZE);
    const halfVertical = (this.camera.fov * Math.PI) / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * this.camera.aspect);
    const distance =
      (Math.max(size.y / 2 / Math.tan(halfVertical), size.x / 2 / Math.tan(halfHorizontal)) +
        size.z / 2) *
      FOCUS_MARGIN[this.focus];

    // Put the (turntable-independent) centre back onto the live turntable, so
    // the camera tracks a pet that is currently swinging round to one side.
    const spin = this.stage.rotation.y;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const target = SCRATCH_TARGET.set(
      centre.x * cos + centre.z * sin,
      centre.y,
      -centre.x * sin + centre.z * cos,
    );
    const desired = SCRATCH_DESIRED.copy(VIEW_DIRECTION).multiplyScalar(distance).add(target);

    // Frame-rate independent exponential damping. The first framing snaps, so
    // the screen opens on the character rather than flying in at it; so does
    // every framing when the player has asked for reduced motion.
    const blend = this.framed && this.spinsAllowed ? 1 - Math.exp(-dt * CAMERA_RATE) : 1;
    this.framed = true;
    this.camera.position.lerp(desired, blend);
    this.aim.lerp(target, blend);
    this.camera.lookAt(this.aim);
  }

  /**
   * Blinks on an irregular timer, drifts through a happy or surprised look
   * every few seconds while idle, and holds a happy face for a moment right
   * after a fresh choice (see {@link update}'s `reactUntil`).
   *
   * Same layering `Player.ts`'s `animate()` uses: a resting expression, with
   * a blink punched through it on transition only, since `setExpression` is a
   * texture re-upload and must never be called every frame.
   */
  private updateFace(dt: number): void {
    const kid = this.kid;
    if (!kid) return;

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.2 + Math.random() * 3.4;
      this.blinkRemaining = BLINK_DURATION;
    }
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;

    const reacting = this.elapsed < this.reactUntil;
    if (!reacting) {
      if (this.moodRemaining > 0) {
        this.moodRemaining -= dt;
      } else {
        this.moodTimer -= dt;
        if (this.moodTimer <= 0) {
          this.moodTimer = 4 + Math.random() * 5;
          this.mood = Math.random() < 0.5 ? 'happy' : 'surprised';
          this.moodRemaining = MOOD_HOLD_SECONDS;
        }
      }
    }

    const resting: Expression = reacting ? 'happy' : this.moodRemaining > 0 ? this.mood : 'neutral';
    const desired: Expression = this.blinkRemaining > 0 ? 'blink' : resting;
    if (desired === this.currentExpression) return;
    this.currentExpression = desired;
    kid.setExpression(desired);
  }
}
