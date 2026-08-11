import type { Camera, Scene, WebGLRenderer } from 'three';

/**
 * The mini-game contract.
 *
 * A fairground stall in the park is a doorway into a little self-contained world
 * with its own rules, its own camera and its own look. The park does not know
 * what is behind the door and a mini-game does not know it is being played in a
 * park — everything they say to each other goes through this file.
 *
 * The whole recipe for a new stall is:
 *
 * 1. Implement {@link MiniGame} (a scene, a camera, `init` / `update` /
 *    `dispose`, and a call to `context.finish()` when it is over).
 * 2. Add a {@link StallDefinition} to `minigames/stalls.ts` naming your factory.
 *
 * That is all. The stall prop, the tap target, the enter/exit wipe, pausing the
 * park, the hold button and the touch overlay are all the framework's job.
 */

/** What the player did with the game. Handed back to the park when it closes. */
export interface MiniGameResult {
  readonly id: string;
  /** `finished` = played it to the end; `quit` = backed out early. */
  readonly outcome: 'finished' | 'quit';
  /** 1 = won. Games without placings leave this undefined. */
  readonly place?: number;
  /** How many were racing / competing, so "3rd of 4" can be shown. */
  readonly of?: number;
  /** Seconds of play. */
  readonly seconds?: number;
  /** A cheerful line the park can show. Always kind — nobody loses here. */
  readonly message?: string;
}

/**
 * Input, boiled down to what a fairground game actually needs.
 *
 * Every stall game in this park is a **one-button** game, because one button is
 * the only control scheme that works identically on a keyboard, a gamepad and a
 * six-year-old's thumb on a phone. The framework merges Space, the gamepad's A
 * button, the on-screen hold pad and a press-and-hold anywhere on the screen
 * into this single boolean.
 */
export interface MiniGameInput {
  /** True for every frame the go button is held. */
  readonly hold: boolean;
  /** True only on the frame it went down. */
  readonly holdPressed: boolean;
  /** True only on the frame it came up. */
  readonly holdReleased: boolean;
  /** The player asked to leave (Backspace, gamepad B, the ✕ on the overlay). */
  readonly quit: boolean;
}

export interface MiniGameFrame {
  /** Seconds since the previous frame. Real time — the park is frozen, we are not. */
  readonly dt: number;
  /** Seconds since this mini-game started. */
  readonly elapsed: number;
  readonly input: MiniGameInput;
}

export interface MiniGameContext {
  /** For anything that needs renderer capabilities. Do not render with it. */
  readonly renderer: WebGLRenderer;
  /** True on a touch device — swap "Space" for "hold anywhere" in the prompts. */
  readonly touch: boolean;
  /**
   * A DOM layer the game owns for its own HUD.
   *
   * It sits above the park's HUD and already swallows pointer events for the
   * hold control, so anything appended here must set `pointer-events: none`
   * unless it is meant to be pressed.
   */
  readonly overlay: HTMLElement;
  /** Call when the game is over. The framework wipes back to the park. */
  finish(result: MiniGameResult): void;
}

export interface MiniGame {
  /** Stable id, also used in the result. */
  readonly id: string;
  /** Shown on the stall sign and during the wipe. */
  readonly title: string;
  /** Drawn by the framework every frame while the game is on screen. */
  readonly scene: Scene;
  readonly camera: Camera;

  init(context: MiniGameContext): void;
  update(frame: MiniGameFrame): void;
  /** Called once on entry and again whenever the canvas changes size. */
  resize(width: number, height: number): void;
  /** Optional: take over drawing entirely (extra passes, post effects). */
  render?(renderer: WebGLRenderer): void;
  dispose(): void;
}

export type MiniGameFactory = () => MiniGame;

/**
 * A stall in the garden: a cute striped booth, a tap target, and the game
 * behind it.
 *
 * `position` and `facing` are world-space; keep clear of the reserved anchor
 * plots in `world/anchors.ts` (the wall pass trims anything crossing them, and
 * the scenery scatter refuses to plant inside them).
 */
/**
 * A stall in the garden.
 *
 * `title`, `glyph` and `accent` used to be painted onto a wooden board over the
 * booth, then (28 July 2026) became the stall's `InteractZone.sign`. Since the
 * family's ruling of 10 August 2026 the sign card is gone too: the action chip
 * is the only thing shown over the booth, and for a *ride* the family's follow-up
 * (11 August) is that its **name is call to action enough** — "Dodgems!",
 * "Water Fight!", "Space Ferris Wheel" all say what they are without a
 * manufactured verb. So `title` is what the chip shows; `glyph` and `accent`
 * still colour the awning.
 */
export interface StallDefinition {
  readonly id: string;
  /** The stall's name — and, since it names an obvious-purpose ride, its chip. */
  readonly title: string;
  /** One emoji, shown before the title. */
  readonly glyph: string;
  /** Awning stripe + trim colour. From PALETTE. */
  readonly accent: number;
  /** The other stripe. From PALETTE. */
  readonly stripe: number;
  /** Centre of the booth on the ground plane, [x, z]. */
  readonly position: readonly [number, number];
  /** Yaw in radians the counter faces. 0 looks down +Z. */
  readonly facing: number;
  /** Builds a fresh instance of the game. Called on every visit. */
  /**
   * Builds the mini-game behind this stall. Absent for booths that board a
   * world ride instead (the Sky Cruiser, the Rail Race) — those are taken
   * by MiniGameHost.boardRide before a game would be built.
   */
  readonly create?: MiniGameFactory;
  /**
   * True if what is behind this door is a **first-person ride** — something
   * driven by `core/RideCamera`.
   *
   * The framework needs to know one thing and one thing only: iOS will not hand
   * over the motion sensors except from inside a user gesture, and the *only*
   * gesture in the whole sequence is the interact press that opens the stall.
   * By the time `init()` runs the curtain has already closed, which is a frame
   * or two later and a lifetime too late.
   *
   * So the flag is here rather than the prompt being fired for every stall: a
   * six-year-old opening the dodgems should not be asked about motion sensors
   * for a game that has no use for them.
   */
  readonly firstPerson?: boolean;
}
