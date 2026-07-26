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
 * The painted backdrop behind the rail: sky, four ranges of pastel hills and a
 * few clouds, all sliding past at different speeds.
 *
 * **Everything here is unlit on purpose.** These are paintings, not objects —
 * the same decision `world/Sky.ts` makes for the park's sky. Toon-shading a
 * distant hill only makes it a darker hill; keeping it flat is what makes the
 * mini-game read as a storybook page with 3D toys running across it.
 *
 * **It hangs off the camera, not the world.** With an orthographic camera
 * pitched down, a plane a hundred metres behind the action projects a long way
 * *up* the frame — the first version put the sun and every cloud comfortably
 * above the top of the screen. Parented to the camera instead, x and y are
 * screen metres and the pitch stops mattering at all. The `z` values below are
 * therefore distances in front of the camera, and they must all be greater than
 * `CAMERA_DISTANCE` or the backdrop paints over the track.
 *
 * Parallax with an orthographic camera has to be faked, because parallel
 * projection gives no depth cue for free: a layer at "distance" p simply moves
 * against the camera by p, and is tiled so it can never run out. Each layer is
 * three copies of a seam-matching tile, slid by whole tiles as the camera
 * travels, so a 640 m race costs three hills' worth of geometry.
 */

/** Width of one repeating tile, in metres. */
const TILE = 80;

interface Layer {
  readonly group: Group;
  readonly parallax: number;
  readonly baseY: number;
}

export interface Backdrop {
  /** Parent this to the **camera**, not the scene. */
  readonly root: Group;
  /** Call every frame with where the camera is looking, in world metres. */
  update(cameraX: number, cameraY: number): void;
  dispose(): void;
}

export function createBackdrop(): Backdrop {
  const root = new Group();
  root.name = 'railracer:backdrop';

  const layers: Layer[] = [];
  const disposables: { dispose(): void }[] = [];

  // --- sky ------------------------------------------------------------------
  const skyTexture = gradientTexture();
  const skyMaterial = new MeshBasicMaterial({ map: skyTexture, toneMapped: false, depthWrite: false });
  const sky = new Mesh(new PlaneGeometry(220, 120), skyMaterial);
  sky.position.set(0, 8, -220);
  sky.renderOrder = -100;
  root.add(sky);
  disposables.push(skyTexture, skyMaterial, sky.geometry);

  // --- sun and clouds -------------------------------------------------------
  const sunMaterial = new MeshBasicMaterial({ color: PALETTE.sunDay, toneMapped: false });
  const sun = new Mesh(new CircleGeometry(2.4, 28), sunMaterial);
  sun.position.set(13, 8.5, -210);
  root.add(sun);
  disposables.push(sunMaterial, sun.geometry);

  const clouds = new Group();
  clouds.position.z = -200;
  root.add(clouds);
  const cloudMaterial = new MeshBasicMaterial({ color: PALETTE.blossomWhite, toneMapped: false });
  disposables.push(cloudMaterial);
  const cloudRng = new Rng(0x0c10ad);
  for (let tile = -1; tile <= 1; tile += 1) {
    for (let i = 0; i < 3; i += 1) {
      const cloud = new Group();
      cloud.position.set(tile * TILE + cloudRng.range(0, TILE), cloudRng.range(4, 10.5), 0);
      const puffs = cloudRng.int(3, 4);
      for (let p = 0; p < puffs; p += 1) {
        const radius = cloudRng.range(1.1, 2.1);
        const puff = new Mesh(new CircleGeometry(radius, 18), cloudMaterial);
        puff.position.set(p * cloudRng.range(1.3, 1.9) - 1.6, cloudRng.range(-0.4, 0.5), 0);
        cloud.add(puff);
        disposables.push(puff.geometry);
      }
      clouds.add(cloud);
    }
  }
  layers.push({ group: clouds, parallax: 0.04, baseY: 0 });

  // --- hill ranges ----------------------------------------------------------
  // `y` is where the range's midline sits on screen, in metres from the middle
  // of the frame; the frame is 24 m tall, so -9 is near the bottom.
  const ranges = [
    { colour: PALETTE.markerLilac, parallax: 0.08, y: -3, height: 9, bumps: 2, depth: -190, seed: 0x11a11 },
    { colour: PALETTE.markerMint, parallax: 0.17, y: -5, height: 8, bumps: 3, depth: -180, seed: 0x22b22 },
    { colour: PALETTE.leafLight, parallax: 0.3, y: -7, height: 7, bumps: 4, depth: -170, seed: 0x33c33 },
    { colour: PALETTE.leafMid, parallax: 0.46, y: -9, height: 6, bumps: 6, depth: -160, seed: 0x44d44 },
  ];

  for (const range of ranges) {
    const material = new MeshBasicMaterial({ color: range.colour, toneMapped: false });
    disposables.push(material);
    const group = new Group();
    group.position.z = range.depth;
    for (let tile = -1; tile <= 1; tile += 1) {
      const geometry = hillGeometry(range.height, range.bumps, range.seed);
      const mesh = new Mesh(geometry, material);
      mesh.position.x = tile * TILE;
      group.add(mesh);
      disposables.push(geometry);
    }
    root.add(group);
    layers.push({ group, parallax: range.parallax, baseY: range.y });
  }

  return {
    root,
    update(cameraX: number, cameraY: number): void {
      for (const layer of layers) {
        const shift = cameraX * layer.parallax;
        layer.group.position.x = -shift + Math.round(shift / TILE) * TILE;
        // The hills rise and fall a little as the rail climbs, but far less
        // than the track does — which is the only depth cue an orthographic
        // camera can give for free.
        layer.group.position.y = layer.baseY + cameraY * layer.parallax * 0.6;
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
  shape.moveTo(0, -40);

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
  shape.lineTo(TILE, -40);
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
