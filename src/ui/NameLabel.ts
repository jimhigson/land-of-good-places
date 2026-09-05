import { Sprite, SpriteMaterial, type CanvasTexture } from 'three';
import {
  NAME_LABEL_CANVAS_HEIGHT,
  NAME_LABEL_FONT_PX,
  nameLabelTexture,
} from '../core/textures';
import { minTextPx } from '../core/uiScale';
import { PALETTE } from '../core/palette';

/**
 * How tall the whole pill has to read on screen, in CSS pixels, for the name
 * inside it to be exactly the minimum text size (GAME_DESIGN.md's TEXT RULE).
 *
 * Derived, not chosen: the name is painted at {@link NAME_LABEL_FONT_PX} on a
 * {@link NAME_LABEL_CANVAS_HEIGHT}-tall canvas, so the pill must be that many
 * times taller than the text it contains. It was a flat 34px before, which
 * made the name itself about 13px on screen — under half the minimum.
 *
 * Grows with the root UI scale, like everything else: on a big monitor the
 * name pills grow with the panels.
 */
function labelPixelHeight(): number {
  return minTextPx() * (NAME_LABEL_CANVAS_HEIGHT / NAME_LABEL_FONT_PX);
}

/**
 * Beyond this many metres from the camera, a label hides rather than floats
 * as a huge screen-constant pill over a tiny distant character.
 *
 * Exported so `check:speech-bubbles` can tell a pill that is legitimately away
 * (too far) from one that is stuck down — reading this number rather than
 * keeping a copy of it, which is the fault CLAUDE.md names most often.
 */
export const LABEL_MAX_DISTANCE = 46;

/** The label canvas is 512x160 — kept as a ratio so any target height stays honest. */
const LABEL_ASPECT = 512 / 160;

/**
 * The floating name pill above a character's head.
 *
 * A {@link Sprite} rather than a plane, so it always squarely faces the camera —
 * including after the player spins the isometric view. `toneMapped` is off and
 * `fog` is off so the label stays crisp and readable at any time of day, which
 * matters more than physical correctness for a UI element.
 *
 * Reusable for any character, not just the player: `updateScreenSize` is the
 * whole contract an NPC label needs, and takes nothing player-specific.
 */
export class NameLabel {
  readonly sprite: Sprite;

  private texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private accent: number;
  /** Multiplies {@link labelPixelHeight} — lets a crowd of labels read a
   *  touch *larger* than the player's if a caller ever wants that. Values
   *  below 1 are ignored: the TEXT RULE has no exceptions, so a label may
   *  never be scaled below the minimum readable size. */
  private readonly sizeScale: number;

  constructor(name: string, accent: number = PALETTE.markerPink, sizeScale: number = 1) {
    this.accent = accent;
    this.sizeScale = Math.max(1, sizeScale);
    this.texture = nameLabelTexture(name, accent);
    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.name = 'name-label';
    // Real size is set every frame by `updateScreenSize`; this is just a
    // sane default so the label isn't zero-sized for a frame before the first
    // call lands.
    this.sprite.scale.set(1.9, 0.594, 1);
    this.sprite.renderOrder = 10;
  }

  /**
   * Keeps the label a constant size *on screen* rather than a constant size in
   * the world — a fixed world scale is what used to make it shrink to
   * unreadable at max zoom-out and balloon at max zoom-in.
   *
   * `worldUnitsPerPixel` is `IsoCamera.worldUnitsPerPixel` — how many world
   * units one CSS pixel spans at the current zoom. `distanceToCamera` is a
   * straight-line metres figure any caller already has to hand (the player's
   * or an NPC's position, minus the camera's); it is used only for the simple
   * "hide if very far away" check, not for any size falloff.
   */
  updateScreenSize(worldUnitsPerPixel: number, distanceToCamera: number): void {
    this.sprite.visible = distanceToCamera <= LABEL_MAX_DISTANCE;
    if (!this.sprite.visible) return;

    const height = worldUnitsPerPixel * labelPixelHeight() * this.sizeScale;
    this.sprite.scale.set(height * LABEL_ASPECT, height, 1);
  }

  /** Rebuilds the pill with a new name (the player can rename themselves). */
  setName(name: string): void {
    const previous = this.texture;
    this.texture = nameLabelTexture(name, this.accent);
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    previous.dispose();
  }

  setAccent(accent: number, name: string): void {
    this.accent = accent;
    this.setName(name);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
