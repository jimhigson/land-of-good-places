import {
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from 'three';
import { PALETTE, hexToCss } from '../../core/palette';
import { Rng } from '../../core/mathUtils';

/**
 * The painted backdrop behind the rail: sky, three ranges of pastel hills, a
 * treeline and a near hedge, all sliding past at different speeds.
 *
 * **Everything here is unlit on purpose.** These are paintings, not objects —
 * the same decision `world/Sky.ts` makes for the park's sky. Toon-shading a
 * distant hill only makes it a darker hill; keeping it flat is what makes the
 * mini-game read as a storybook page with 3D toys running across it.
 *
 * Parallax with an orthographic camera has to be faked, because parallel
 * projection gives no depth cue for free: a layer at "distance" p is simply
 * moved with the camera by `1 - p`, and tiled so it can never run out. Each
 * layer is built as three copies of a seam-matching tile and slid by whole
 * tiles as the camera travels, so a 640 m race costs three hills' worth of
 * geometry.
 */

/** Width of one repeating tile, in metres. */
const TILE = 80;

interface Layer {
  readonly group: Group;
  readonly parallax: number;
  readonly baseY: number;
}

export interface Backdrop {
  readonly root: Group;
  /** Call every frame with where the camera is looking. */
  update(cameraX: number, cameraY: number): void;
  dispose(): void;
}

export function createBackdrop(): Backdrop {
  const root = new Group();
  root.name = 'railracer:backdrop';

  const layers: Layer[] = [];
  const disposables: { dispose(): void }[] = [];

  // --- sky ------------------------------------------------------------------
  // One tall gradient quad pinned to the camera. It is the first thing drawn and
  // it is what the frame is cleared to, in effect — the mini-game never uses the
  // park's sky pass.
  const skyTexture = gradientTexture();
  const skyMaterial = new MeshBasicMaterial({ map: skyTexture, toneMapped: false, depthWrite: false });
  const sky = new Mesh(new PlaneGeometry(260, 150), skyMaterial);
  sky.position.set(0, 6, -70);
  sky.renderOrder = -100;
  root.add(sky);
  disposables.push(skyTexture, skyMaterial, sky.geometry);

  // --- sun and clouds -------------------------------------------------------
  const sunMaterial = new MeshBasicMaterial({ color: PALETTE.sunDay, toneMapped: false });
  const sun = new Mesh(new CircleGeometry(4.2, 28), sunMaterial);
  sun.position.set(22, 26, -66);
  root.add(sun);
  disposables.push(sunMaterial, sun.geometry);

  const clouds = new Group();
  clouds.position.z = -62;
  root.add(clouds);
  const cloudMaterial = new MeshBasicMaterial({ color: PALETTE.blossomWhite, toneMapped: false });
  disposables.push(cloudMaterial);
  const cloudRng = new Rng(0x0c10ad);
  for (let tile = -1; tile <= 1; tile += 1) {
    for (let i = 0; i < 4; i += 1) {
      const cloud = new Group();
      cloud.position.set(tile * TILE + cloudRng.range(0, TILE), cloudRng.range(16, 30), 0);
      const puffs = cloudRng.int(3, 4);
      for (let p = 0; p < puffs; p += 1) {
        const radius = cloudRng.range(1.6, 3.1);
        const puff = new Mesh(new CircleGeometry(radius, 18), cloudMaterial);
        puff.position.set(p * cloudRng.range(1.8, 2.6) - 2, cloudRng.range(-0.5, 0.7), 0);
        cloud.add(puff);
        disposables.push(puff.geometry);
      }
      clouds.add(cloud);
    }
  }
  layers.push({ group: clouds, parallax: 0.04, baseY: 0 });

  // --- hill ranges ----------------------------------------------------------
  const ranges = [
    { colour: PALETTE.markerLilac, parallax: 0.08, y: -6, height: 15, bumps: 2, seed: 0x11a11 },
    { colour: PALETTE.markerMint, parallax: 0.17, y: -8, height: 13, bumps: 3, seed: 0x22b22 },
    { colour: PALETTE.leafLight, parallax: 0.3, y: -10, height: 12, bumps: 4, seed: 0x33c33 },
    { colour: PALETTE.leafMid, parallax: 0.48, y: -12, height: 10, bumps: 6, seed: 0x44d44 },
  ];

  ranges.forEach((range, index) => {
    const material = new MeshBasicMaterial({ color: range.colour, toneMapped: false });
    disposables.push(material);
    const group = new Group();
    group.position.z = -55 + index * 6;
    for (let tile = -1; tile <= 1; tile += 1) {
      const geometry = hillGeometry(range.height, range.bumps, range.seed);
      const mesh = new Mesh(geometry, material);
      mesh.position.x = tile * TILE;
      group.add(mesh);
      disposables.push(geometry);
    }
    root.add(group);
    layers.push({ group, parallax: range.parallax, baseY: range.y });
  });

  return {
    root,
    update(cameraX: number, cameraY: number): void {
      // The whole backdrop rides with the camera; the layers then slide back
      // against it by their own parallax factor.
      root.position.set(cameraX, cameraY, 0);
      for (const layer of layers) {
        const shift = cameraX * layer.parallax;
        layer.group.position.x = -shift + Math.round(shift / TILE) * TILE;
        layer.group.position.y = layer.baseY - cameraY * layer.parallax;
      }
    },
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}

// ---------------------------------------------------------------- internals

/**
 * One tile of rolling hills, `TILE` metres wide.
 *
 * The profile is a sum of sines whose periods all divide the tile width, which
 * is what makes the left and right edges line up exactly — without that, every
 * repeat shows a step in the skyline.
 */
function hillGeometry(height: number, bumps: number, seed: number): ShapeGeometry {
  const rng = new Rng(seed);
  const phases = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const shape = new Shape();
  shape.moveTo(0, -30);

  const steps = 96;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = t * TILE;
    const y =
      height *
      (0.55 * Math.sin(t * Math.PI * 2 * bumps + (phases[0] ?? 0)) +
        0.3 * Math.sin(t * Math.PI * 2 * (bumps * 2) + (phases[1] ?? 0)) +
        0.15 * Math.sin(t * Math.PI * 2 * (bumps * 3) + (phases[2] ?? 0)));
    shape.lineTo(x, y);
  }
  shape.lineTo(TILE, -30);
  shape.closePath();
  return new ShapeGeometry(shape, 1);
}

/** The sky: a soft vertical gradient, painted rather than shaded. */
function gradientTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint the sky.');

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, hexToCss(PALETTE.skyDayTop));
  gradient.addColorStop(0.55, hexToCss(PALETTE.skyDayBottom));
  gradient.addColorStop(1, hexToCss(PALETTE.blossomWhite));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
