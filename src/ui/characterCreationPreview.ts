import {
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { PALETTE } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { disposeTree, toonMaterial } from '../art/style/materials';
import { createKid } from '../art/models/kid';
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
 */
export interface PreviewChoice {
  readonly skin: number;
  readonly hair: number;
  /**
   * Always a real choice, never omitted — kept as the bare, non-optional
   * union rather than `KidOptions['hairStyle']` (which is `| undefined`,
   * since it's an optional constructor option there) so this stays assignable
   * under `tsconfig`'s `exactOptionalPropertyTypes`.
   */
  readonly hairStyle: 'bunches' | 'bob' | 'short';
  readonly outfit: number;
  readonly hatId: string;
  readonly petId: string;
}

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  /** Everything that turns gently on the turntable — plinth, kid, pet. */
  private readonly stage = new Group();

  private character: Group | null = null;
  private rafHandle: number | null = null;
  private elapsed = 0;
  private lastTime = 0;
  private disposed = false;
  /** Same accessibility rule the rest of the game's CSS animations follow. */
  private readonly spinsAllowed =
    typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  constructor() {
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

  /** Rebuilds the kid (+ hat, + pet) from scratch for the given choice. */
  update(choice: PreviewChoice): void {
    if (this.character) {
      this.stage.remove(this.character);
      disposeTree(this.character);
      this.character = null;
    }

    const group = new Group();

    const kid = createKid({
      skin: choice.skin,
      hair: choice.hair,
      hairStyle: choice.hairStyle,
      outfit: choice.outfit,
    });
    kid.setExpression('happy');
    group.add(kid.root);

    // Same attachment every worn hat uses in the real game — see
    // `art/models/hats.ts`'s doc comment: no offset maths needed.
    const hatAsset = shopItem(choice.hatId)?.model();
    if (hatAsset) kid.hatAnchor.add(hatAsset.root);

    // The chosen starting pet, stood beside the kid at its own natural scale
    // — the same scale it will actually walk behind the player at in the
    // parade (see `entities/parade/ParadeMember.ts`; nothing there rescales a
    // paradeable thing).
    const petAsset = shopItem(choice.petId)?.model();
    if (petAsset) {
      petAsset.root.position.set(0.92, 0, 0.32);
      petAsset.root.rotation.y = -0.5;
      group.add(petAsset.root);
    }

    this.stage.add(group);
    this.character = group;
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
    // A lazy turntable — enough life to feel like a toy on a shelf, slow
    // enough to actually see the choice you just made rather than a blur.
    if (this.spinsAllowed) this.stage.rotation.y = Math.sin(this.elapsed * 0.35) * 0.55;
    this.renderer.render(this.scene, this.camera);
    this.rafHandle = requestAnimationFrame(this.frame);
  };
}
