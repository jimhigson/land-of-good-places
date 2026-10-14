import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { ART } from '../../../art/style/artPalette';
import { blob, type AssetHandle, type CreatureHandle } from '../../../art/style/asset';
import { disposeTree, solid, toonMaterial } from '../../../art/style/materials';
import { visiblePoints } from '../../../art/style/measure';
import { createPet } from '../../../art/models/pets';
import { createBiscuit } from '../../../art/models/biscuit';
import { createKid, type KidHandle } from '../../../art/models/kid';
import { createGlasses } from '../../../art/models/glasses';
import { createRipikaStatue } from '../../../art/models/ripikaStatue';
import { createBalloon, type BalloonKind } from '../../../art/models/balloons';
import { createKeychain, KEYCHAIN_KINDS, type KeychainKind } from '../../../art/models/keychains';
import { createBreakfastBowl, createPetBed, type BreakfastKind } from '../../../art/models/hotelAssets';
import { createStarToy } from '../../../art/models/shopItems';
import { duckBarAssetGeometry } from '../../../art/models/duckBarAsset';
import { createStoryBook, createStoryDragon } from './readerAssets';
import { hazardTapeTexture } from '../../../core/textures';
import { createCatBus } from '../../entrance/catBus';
import { createCart } from '../../railRace/cart';
import { RIDE_SCALE } from '../../railRace/dimensions';
import type { BackpackKind, GlassesKind, HairStyle, ShoeKind } from '../../../state';
import type { PagePicture, PictureActor } from '../books';

/**
 * **A page's picture: the park's own models, rendered to a texture** (#717).
 *
 * Jim: *"render the 3d models to textures, and then use those mapped onto the
 * pages."* So a {@link PagePicture} — a stage direction from `books.ts` — is
 * built here out of the very factories the park builds its creatures with,
 * lit, rendered into a `WebGLRenderTarget` on the game's own renderer (so the
 * toon programs it needs are the ones the park already compiled), and read
 * back into a 2D canvas. `pageFaces.ts` then paints that canvas onto the page
 * beside its sentence: **one canvas per page face**, picture and words in the
 * same texture, never a picture floating in front of the paper (the floating
 * decal `art/models/CLAUDE.md` warns against).
 *
 * ## Why read it back rather than map the render target itself
 *
 * Because the words go on the same surface. A page that is a render target
 * plus a text overlay is two surfaces kept in step by hand; a page that is one
 * canvas cannot disagree with itself.
 *
 * ## Colour
 *
 * three renders into a render target in its *working* (linear) colour space,
 * with no tone mapping — tone mapping is a screen-output step. The readback is
 * therefore linear, and is encoded to sRGB here, pixel by pixel, before it
 * reaches a canvas (which is sRGB by definition). The page it lands on is then
 * lit and tone-mapped once, on its way to the screen, exactly as a model in the
 * park is — so a RiPika in a book is the same yellow as the RiPika beside you.
 *
 * The background clears to transparent, so the backdrop (sky, sun, stars) is
 * painted under the picture in 2D. Multisampling resolves the silhouette's
 * edge pixels against that transparent clear, which leaves them premultiplied;
 * they are un-premultiplied here, or every outline would carry a dark fringe.
 *
 * ## Cost
 *
 * Built and rendered once per page and look, then cached by the reader as a
 * small canvas (`pageFaces.ts`) for as long as the book is open. Everything
 * built for a picture — the models and the hill under them — is disposed
 * straight after the render.
 */

/** Width and height of a rendered picture, in pixels. 7:6 — the shape of the picture box on a page. */
export const PICTURE_WIDTH = 672;
export const PICTURE_HEIGHT = 576;

/** How the reader's girl looks — `gameStore`'s player, reduced to what the kid model needs. */
export interface ReaderLook {
  readonly skin: number;
  readonly hair: number;
  readonly hairStyle: HairStyle;
  readonly outfit: number;
  readonly outfitArms: number;
  readonly eye: number;
  readonly backpackKind: BackpackKind;
  readonly backpackColour: number;
  readonly shoeKind: ShoeKind;
  readonly shoe: number;
  readonly glasses: GlassesKind | null;
}

/** A stable string for a look, so a cached picture of her is redrawn when she changes. */
export function lookKey(look: ReaderLook): string {
  return [
    look.skin,
    look.hair,
    look.hairStyle,
    look.outfit,
    look.outfitArms,
    look.eye,
    look.backpackKind,
    look.backpackColour,
    look.shoeKind,
    look.shoe,
    look.glasses ?? '-',
  ].join(':');
}

/** A rendered picture, and what the readback measured about it. */
export interface RenderedPicture {
  readonly canvas: HTMLCanvasElement;
  /**
   * The fraction of the picture's pixels the models actually covered — read
   * off the pixels, not off the scene. `check:book-reader` holds every page to
   * more than nothing, which is the "does the texture resolve" question asked
   * of the one thing that could fail silently: a render that drew no model.
   */
  readonly coverage: number;
}

/** How far a limb swings for each {@link PictureActor.pose}. */
function applyPose(handle: CreatureHandle, pose: PictureActor['pose']): void {
  const limbs = handle.limbs;
  if (!limbs || !pose || pose === 'stand') return;
  if (pose === 'armsUp') {
    limbs.leftArm.rotation.z = -2.5;
    limbs.rightArm.rotation.z = 2.5;
  } else if (pose === 'wave') {
    limbs.rightArm.rotation.z = 2.6;
    limbs.leftArm.rotation.z = -0.25;
  } else if (pose === 'sit') {
    limbs.leftLeg.rotation.x = -1.35;
    limbs.rightLeg.rotation.x = -1.25;
    limbs.leftArm.rotation.x = -0.35;
    limbs.rightArm.rotation.x = -0.35;
  }
}

/** True for a handle with a face and limbs — every creature factory returns one. */
function isCreature(handle: AssetHandle): handle is CreatureHandle {
  return typeof (handle as Partial<CreatureHandle>).setExpression === 'function';
}

/** The duck bar from the Rail Race, as one standalone gate: two posts and the striped bar. */
function createDuckBarGate(): AssetHandle {
  const root = new Group();
  const post = duckBarAssetGeometry('post');
  const bar = duckBarAssetGeometry('bar');
  post.computeBoundingBox();
  bar.computeBoundingBox();
  const postBox = post.boundingBox;
  const barBox = bar.boundingBox;
  // A picture is its own little flat stage, never on the planet, and these are
  // the prop's own local bounds — upright by construction, nothing leans.
  const postHeight = postBox ? postBox.max.y - postBox.min.y : 1; // flat-ok: a picture prop's own local bounds
  const postFoot = postBox?.min.y ?? 0; // flat-ok: a picture prop's own local bounds
  const halfBar = barBox?.max.x ?? 1;
  // The gate is a picture prop, not a hazard: one post height tall, so the
  // bar is over a child's head the way it is in the race.
  const frame = toonMaterial(PALETTE.buildingTrim);
  for (const side of [-1, 1] as const) {
    const mesh = solid(new Mesh(post, frame));
    mesh.position.set(side * halfBar * 0.92, -postFoot, 0);
    root.add(mesh);
  }
  const barMesh = solid(new Mesh(bar, toonMaterial(0xffffff, { map: hazardTapeTexture() })));
  barMesh.position.set(0, postHeight * 0.92, 0);
  root.add(barMesh);
  return { root, height: postHeight };
}

/** Builds one actor's model. Every branch is a factory the park itself uses. */
function buildActor(actor: PictureActor, look: ReaderLook): AssetHandle {
  const colour = actor.colour ? PALETTE[actor.colour] : undefined;
  switch (actor.model) {
    case 'kid': {
      const kid: KidHandle = createKid({
        skin: look.skin,
        hair: look.hair,
        hairStyle: look.hairStyle,
        outfit: look.outfit,
        outfitArms: look.outfitArms,
        eyeColour: look.eye,
        backpackKind: look.backpackKind,
        backpackColour: look.backpackColour,
        shoeKind: look.shoeKind,
        shoe: look.shoe,
      });
      if (look.glasses) kid.glassesAnchor.add(createGlasses(look.glasses).root);
      return kid;
    }
    case 'ripika':
      return createPet('ripika');
    case 'trilla':
      return createPet('puff');
    case 'bunny':
      return createPet('bunny');
    case 'kitten':
      return createPet('kitten');
    case 'mouse':
      return createPet('mouse');
    case 'biscuit':
      return createBiscuit();
    case 'catBus':
      return createCatBus();
    case 'statue':
      return createRipikaStatue();
    case 'cart': {
      // At the size the race draws it: `RailRace` scales every cart by
      // `RIDE_SCALE`, so a bare one would be a toy beside the girl riding it.
      const cart = createCart(colour ?? PALETTE.markerPink);
      const root = new Group();
      cart.root.scale.setScalar(RIDE_SCALE);
      root.add(cart.root);
      return { root, height: RIDE_SCALE, dispose: () => cart.dispose() };
    }
    case 'balloon':
      return createBalloon((actor.variant as BalloonKind | undefined) ?? 'dalmatian');
    case 'keychain': {
      const kind = actor.variant as KeychainKind | undefined;
      return createKeychain(kind && KEYCHAIN_KINDS.includes(kind) ? kind : 'star');
    }
    case 'bowl':
      return createBreakfastBowl((actor.variant as BreakfastKind | undefined) ?? 'cheerios');
    case 'petBed':
      return createPetBed();
    case 'star':
      return createStarToy(colour ?? PALETTE.flowerYellow);
    case 'dragon':
      return createStoryDragon();
    case 'book':
      return createStoryBook(colour ?? PALETTE.markerPink);
    case 'duckBar':
      return createDuckBarGate();
  }
}

/** Degrees to radians. */
const DEG = Math.PI / 180;

/** Where the camera looks from, relative to the picture's centre: in front, a little above. */
const VIEW_DIRECTION = new Vector3(0, 0.18, 1).normalize();
/** Vertical field of view of the picture camera, degrees — long-ish, so a toy is not distorted. */
const PICTURE_FOV = 26;
/** Breathing room round the cast: 1 would touch the picture's edges. */
const FRAME_MARGIN = 1.16;

/**
 * Points the camera at everything in `cast`, fitted to the picture's aspect:
 * the cast's visible vertices are measured in the camera's own frame, the aim
 * is moved to the middle of them, and the camera backs off until the widest
 * and tallest of them are inside the frame with {@link FRAME_MARGIN} to spare.
 */
function frameCast(camera: PerspectiveCamera, cast: readonly Object3D[]): { target: Vector3; distance: number } {
  const points: Vector3[] = [];
  for (const root of cast) {
    root.updateMatrixWorld(true);
    visiblePoints(root, (point) => points.push(point.clone().applyMatrix4(root.matrixWorld)));
  }
  if (points.length === 0) {
    camera.position.set(0, 1, 6);
    camera.lookAt(0, 1, 0);
    return { target: new Vector3(0, 1, 0), distance: 6 }; // flat-ok: a point on the picture's own flat stage
  }
  const forward = VIEW_DIRECTION.clone();
  // The picture stage is a self-contained flat scene, not on the planet: its up is +Y.
  const right = new Vector3(0, 1, 0).cross(forward).normalize(); // flat-ok: the picture stage's own up
  const up = forward.clone().cross(right).normalize();
  const tanV = Math.tan((PICTURE_FOV * DEG) / 2);
  const tanH = tanV * (PICTURE_WIDTH / PICTURE_HEIGHT);

  // The middle of the cast as the camera sees it, then the distance that fits it.
  let target = new Vector3();
  for (const point of points) target.add(point);
  target.multiplyScalar(1 / points.length);
  let distance = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const offset = new Vector3();
    for (const point of points) {
      offset.subVectors(point, target);
      const x = offset.dot(right);
      const y = offset.dot(up);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    target = target
      .clone()
      .addScaledVector(right, (minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2);
    distance = 0;
    for (const point of points) {
      offset.subVectors(point, target);
      const x = Math.abs(offset.dot(right));
      const y = Math.abs(offset.dot(up));
      const z = offset.dot(forward);
      distance = Math.max(distance, z + (x * FRAME_MARGIN) / tanH, z + (y * FRAME_MARGIN) / tanV);
    }
  }
  camera.position.copy(target).addScaledVector(forward, distance);
  camera.near = Math.max(0.01, distance * 0.05);
  camera.far = distance * 6 + 40;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  return { target, distance };
}

/** The light rig: the park's three (hemisphere, warm key, cool fill) plus a soft rim from behind. */
function addLights(scene: Scene, picture: PagePicture): void {
  const ground = picture.ground ? PALETTE[picture.ground] : PALETTE.grass;
  if (picture.night) {
    scene.add(new HemisphereLight(PALETTE.ambientNight, ART.creamDark, 1.55));
    const moon = new DirectionalLight(PALETTE.moon, 1.5);
    moon.position.set(-2.4, 3.8, 2.6);
    scene.add(moon);
    // The soft rim: warm, from behind, so the silhouette glows as if a lamp
    // (or a cloud of fireflies) were just out of the picture.
    const rim = new DirectionalLight(PALETTE.fairyWarm, 1.6);
    rim.position.set(1.5, 2.4, -3.2);
    scene.add(rim);
    return;
  }
  scene.add(new HemisphereLight(PALETTE.ambientDay, ground, 1.2));
  const key = new DirectionalLight(PALETTE.sunDay, 2.0);
  key.position.set(2.4, 3.6, 2.8);
  scene.add(key);
  const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.55);
  fill.position.set(-2.6, 1.8, -1.6);
  scene.add(fill);
  const rim = new DirectionalLight(ART.cream, 1.1);
  rim.position.set(-1, 2.2, -3.4);
  scene.add(rim);
}

/** linear 0..1 → sRGB 0..255, the standard transfer curve. */
function encodeSrgb(linear: number): number {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** 8-bit linear → 8-bit sRGB, for the fully opaque pixels (nearly all of them). */
const LINEAR_TO_SRGB = (() => {
  const table = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) table[i] = encodeSrgb(i / 255);
  return table;
})();

/**
 * Renders one picture into a fresh canvas of {@link PICTURE_WIDTH} ×
 * {@link PICTURE_HEIGHT}, transparent where no model is. Restores everything it
 * changes on the renderer.
 */
export function renderPicture(renderer: WebGLRenderer, picture: PagePicture, look: ReaderLook): RenderedPicture {
  const scene = new Scene();
  addLights(scene, picture);

  const cast: Object3D[] = [];
  const handles: AssetHandle[] = [];
  for (const actor of picture.cast) {
    const handle = buildActor(actor, look);
    handles.push(handle);
    const root = handle.root;
    const [x, y, z] = actor.at ?? [0, 0, 0];
    root.position.set(x, y, z);
    root.rotation.y = (actor.turn ?? 0) * DEG;
    if (actor.size !== undefined) root.scale.setScalar(actor.size);
    if (isCreature(handle)) {
      handle.setExpression(actor.mood ?? 'happy');
      applyPose(handle, actor.pose);
    }
    scene.add(root);
    cast.push(root);
  }
  for (const handle of handles) (handle as Partial<KidHandle>).resetHair?.();

  const camera = new PerspectiveCamera(PICTURE_FOV, PICTURE_WIDTH / PICTURE_HEIGHT, 0.05, 100);
  const framed = frameCast(camera, cast);

  // The hill under their feet: a wide, gentle dome in the ground colour whose
  // top is the floor. Not part of the framing — it is scenery — and sized from
  // it, so it always runs out under the camera and off both sides of the
  // picture, and only its far edge shows, as the brow of a hill.
  if (picture.ground) {
    const radius = Math.max(6, framed.distance * 1.1);
    const rise = 0.9;
    const hill = blob(radius, toonMaterial(PALETTE[picture.ground]), [1, rise / radius, 1], 64);
    hill.position.set(framed.target.x, -rise, 0);
    scene.add(hill);
    camera.far = Math.max(camera.far, framed.distance + radius * 2);
    camera.updateProjectionMatrix();
  }

  const target = new WebGLRenderTarget(PICTURE_WIDTH, PICTURE_HEIGHT, { samples: 4 });
  const previousTarget = renderer.getRenderTarget();
  const previousClear = renderer.getClearColor(new Color());
  const previousAlpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    target.dispose();
    // Everything in the scene — the cast *and* the hill, which is scenery and
    // so never in `cast` — goes with it. `disposeTree` skips what a cache owns
    // (the toon ramp, the hazard tape), so only this picture's own is freed.
    disposeTree(scene);
    for (const handle of handles) handle.dispose?.();
  }

  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_WIDTH;
  canvas.height = PICTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pagePictures: no 2D context to paint a picture into.');
  const image = ctx.createImageData(PICTURE_WIDTH, PICTURE_HEIGHT);
  const out = image.data;
  let covered = 0;
  const row = PICTURE_WIDTH * 4;
  for (let y = 0; y < PICTURE_HEIGHT; y += 1) {
    // GL's rows run bottom-up; a canvas's run top-down.
    const from = (PICTURE_HEIGHT - 1 - y) * row;
    const to = y * row;
    for (let x = 0; x < row; x += 4) {
      const alpha = pixels[from + x + 3] ?? 0;
      if (alpha === 0) continue;
      covered += 1;
      if (alpha === 255) {
        out[to + x] = LINEAR_TO_SRGB[pixels[from + x] ?? 0] ?? 0;
        out[to + x + 1] = LINEAR_TO_SRGB[pixels[from + x + 1] ?? 0] ?? 0;
        out[to + x + 2] = LINEAR_TO_SRGB[pixels[from + x + 2] ?? 0] ?? 0;
      } else {
        // An edge pixel the multisample resolve blended with the transparent
        // clear: premultiplied, so divide the alpha back out before encoding.
        const a = alpha / 255;
        out[to + x] = encodeSrgb((pixels[from + x] ?? 0) / 255 / a);
        out[to + x + 1] = encodeSrgb((pixels[from + x + 1] ?? 0) / 255 / a);
        out[to + x + 2] = encodeSrgb((pixels[from + x + 2] ?? 0) / 255 / a);
      }
      out[to + x + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, coverage: covered / (PICTURE_WIDTH * PICTURE_HEIGHT) };
}
