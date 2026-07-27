import { Sprite, SpriteMaterial, type CanvasTexture } from 'three';
import { nameLabelTexture } from '../core/textures';
import { PALETTE } from '../core/palette';

/**
 * How tall the label reads on screen, in CSS pixels — generous enough for a
 * six-year-old to read at arm's length on a phone. Deliberately a *screen*
 * size, not a world size: see {@link NameLabel.updateScreenSize}.
 */
const LABEL_PIXEL_HEIGHT = 34;

/** Beyond this many metres from the camera, a label hides rather than floats
 *  as a huge screen-constant pill over a tiny distant character. */
const LABEL_MAX_DISTANCE = 46;

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
  /** Multiplies {@link LABEL_PIXEL_HEIGHT} — lets a crowd of labels read a
   *  touch smaller/quieter than the one the player is wearing. */
  private readonly sizeScale: number;

  constructor(name: string, accent: number = PALETTE.markerPink, sizeScale: number = 1) {
    this.accent = accent;
    this.sizeScale = sizeScale;
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

    const height = worldUnitsPerPixel * LABEL_PIXEL_HEIGHT * this.sizeScale;
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
