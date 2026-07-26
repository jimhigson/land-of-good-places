import { Sprite, SpriteMaterial, type CanvasTexture } from 'three';
import { nameLabelTexture } from '../core/textures';
import { PALETTE } from '../core/palette';

/**
 * The floating name pill above a character's head.
 *
 * A {@link Sprite} rather than a plane, so it always squarely faces the camera —
 * including after the player spins the isometric view. `toneMapped` is off and
 * `fog` is off so the label stays crisp and readable at any time of day, which
 * matters more than physical correctness for a UI element.
 */
export class NameLabel {
  readonly sprite: Sprite;

  private texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private accent: number;

  constructor(name: string, accent: number = PALETTE.markerPink) {
    this.accent = accent;
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
    // The canvas is 512x160, so this keeps the pill's aspect ratio honest.
    this.sprite.scale.set(1.9, 0.594, 1);
    this.sprite.renderOrder = 10;
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
