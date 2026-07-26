import {
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';
import { hexToCss, nameLabelTexture, PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { toonMaterial } from '../style/materials';
import type { AssetHandle, CreatureHandle } from '../style/asset';
import { createRipika } from '../models/ripika';
import { createBiscuit } from '../models/biscuit';
import { createKid } from '../models/kid';
import { createMini } from '../models/mini';
import { createBalloon } from '../models/balloons';
import { createLollipopTree, createPinkWall, createWoodWall } from '../models/props';

/**
 * The art sample gallery — a soft-lit showroom for the client (Eleri, age 6).
 *
 * Lighting, tone mapping and shadow settings are copied from `src/core/Engine.ts`
 * on purpose: a sample that looks great under gallery lighting and dull in the
 * game is worse than useless.
 *
 * URL parameters:
 *   ?only=ripika      one exhibit, centred and close for a portrait screenshot
 *   ?spin=1           full turntable instead of the default showroom sway
 *   ?grid=1           show the plinth grid guides
 */

interface Exhibit {
  key: string;
  label: string;
  handle: AssetHandle;
  /** x, z on the showroom floor. */
  x: number;
  z: number;
  plinth: number;
  /** Plinth radius; 0 for props that stand on the floor. */
  plinthR: number;
  /** Extra label lift for tall things. */
  labelY?: number;
}

const params = new URLSearchParams(location.search);
const only = params.get('only');
const fullSpin = params.get('spin') === '1';

// ------------------------------------------------------------------ renderer

const canvas = document.getElementById('gallery-canvas') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = VSMShadowMap;

const scene = new Scene();
scene.background = backdropTexture();

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const CAMERA_PITCH = 0.34; // ~19.5°: flatter than gameplay so faces read clearly
const CAMERA_YAW = 0.16;

// ------------------------------------------------------------------- lighting
// Matches the game's midday key: warm sun, cool sky bounce, soft VSM shadows.

const hemi = new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.05);
scene.add(hemi);

const key = new DirectionalLight(PALETTE.sunDay, 2.35);
key.position.set(9, 15, 11);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 6;
key.shadow.bias = -0.0008;
const cam = key.shadow.camera;
cam.left = -18;
cam.right = 18;
cam.top = 14;
cam.bottom = -8;
cam.near = 1;
cam.far = 60;
cam.updateProjectionMatrix();
scene.add(key);

// A cool fill from the opposite side keeps the shadow side of every toy from
// going flat — the toon ramp handles shape, this handles colour temperature.
const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.55);
fill.position.set(-11, 6, -7);
scene.add(fill);

// A gentle bounce from the floor, so chins and tummies are not dark.
const bounce = new DirectionalLight(ART.stageFloor, 0.35);
bounce.position.set(0, -6, 6);
scene.add(bounce);

// --------------------------------------------------------------- showroom floor

// A soft cream-to-mint wash rather than a flat colour: a big untextured plane
// under pastel characters goes grey and drags the whole image down.
const floorTexture = radialWashTexture();
const floor = new Mesh(
  new CylinderGeometry(15, 15, 0.5, 64),
  new MeshStandardMaterial({ map: floorTexture, roughness: 0.98, metalness: 0 }),
);
floor.position.y = -0.25;
floor.receiveShadow = true;
scene.add(floor);

// ------------------------------------------------------------------- exhibits

const PLINTH_COLOURS = [
  ART.stagePlinthA,
  ART.stagePlinthB,
  ART.stagePlinthC,
  ART.stagePlinthD,
];

const exhibits: Exhibit[] = [];
let plinthIndex = 0;

function add(
  key_: string,
  label: string,
  handle: AssetHandle,
  x: number,
  z: number,
  plinthR = 0.85,
  labelY = 0,
): void {
  exhibits.push({
    key: key_,
    label,
    handle,
    x,
    z,
    plinth: PLINTH_COLOURS[plinthIndex++ % PLINTH_COLOURS.length] ?? ART.stagePlinthA,
    plinthR,
    labelY,
  });
}

// Front row: the four characters, closest to the client.
add('ripika', 'RiPika', createRipika(), -4.85, 3.1, 0.78);
add('biscuit', 'Biscuit', createBiscuit(), -1.6, 3.1, 0.78);
add('eleri', 'Eleri', createKid(), 1.75, 3.1, 0.92);
add('mini', 'Mini', createMini(), 4.75, 3.1, 0.6);

// Back row: the three balloons between the two props.
add('tree', 'Lollipop tree', createLollipopTree({ variant: 'blossom', seed: 4 }), -7.7, -5.2, 0, 0.55);
add('dalmatian', 'Fire Pup', createBalloon('dalmatian'), -3.95, -5.2, 0.6);
add('corgi', 'Sky Corgi', createBalloon('corgi'), -0.6, -5.2, 0.6);
add('chicken', 'Chicken-looter', createBalloon('chicken'), 2.75, -5.2, 0.6);
add('wall', 'Pink wall', createPinkWall({ length: 1, seed: 2 }), 6.9, -5.2, 0, 0.15);

// Kept out of the lineup so the wide shot stays legible, but still viewable on
// its own with ?only=woodwall.
const woodwall: Exhibit = {
  key: 'woodwall',
  label: 'Wooden wall',
  handle: createWoodWall({ length: 1, height: 'mid', seed: 6 }),
  x: 0,
  z: 0,
  plinth: ART.stagePlinthD,
  plinthR: 0,
};

const shown = only
  ? [...exhibits, woodwall].filter((e) => e.key === only)
  : exhibits;
if (shown.length === 0) shown.push(...exhibits);

const turntables: Group[] = [];
const creatures: CreatureHandle[] = [];

for (const exhibit of shown) {
  const stand = new Group();
  stand.position.set(only ? 0 : exhibit.x, 0, only ? 0 : exhibit.z);
  scene.add(stand);

  if (exhibit.plinthR > 0) {
    const plinth = new Mesh(
      new CylinderGeometry(exhibit.plinthR, exhibit.plinthR * 1.06, 0.16, 40),
      toonMaterial(exhibit.plinth),
    );
    plinth.position.y = 0.08;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    stand.add(plinth);
  }

  const turntable = new Group();
  turntable.position.y = exhibit.plinthR > 0 ? 0.16 : 0;
  stand.add(turntable);
  turntable.add(exhibit.handle.root);
  turntables.push(turntable);

  const creature = exhibit.handle as Partial<CreatureHandle>;
  if (creature.setWalkPhase && creature.setExpression) creatures.push(creature as CreatureHandle);

  // The game's own name pill, floating above the exhibit.
  const texture = nameLabelTexture(exhibit.label, exhibit.plinth);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  const w = only ? 2.4 : 1.85;
  sprite.scale.set(w, (w * 160) / 512, 1);
  sprite.position.set(0, exhibit.handle.height + 0.42 + (exhibit.labelY ?? 0), 0);
  sprite.renderOrder = 10;
  stand.add(sprite);
}

// ---------------------------------------------------------------------- camera

const focus = new Vector3(0, only ? 0.9 : 1.85, only ? 0 : -1.1);

function layoutCamera(): void {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const aspect = width / Math.max(1, height);

  // The lineup is framed by WIDTH (horizontal extent is what must fit); a single
  // portrait is framed by HEIGHT (so the exhibit and its label always fit
  // whatever the window shape).
  let viewWidth: number;
  let viewHeight: number;
  if (only) {
    viewHeight = focusHeight(only);
    viewWidth = viewHeight * aspect;
  } else {
    viewWidth = 18.2;
    viewHeight = viewWidth / aspect;
  }

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.near = 0.1;
  camera.far = 400;
  camera.updateProjectionMatrix();

  const dist = 120;
  camera.position.set(
    focus.x + Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * dist,
    focus.y + Math.sin(CAMERA_PITCH) * dist,
    focus.z + Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * dist,
  );
  camera.lookAt(focus);

  renderer.setSize(width, height, false);
}

/**
 * Vertical world units to show for a single-exhibit portrait: the exhibit plus
 * generous headroom for its name pill, so no close-up ever crops an ear.
 */
function focusHeight(k: string): number {
  const target = [...exhibits, woodwall].find((e) => e.key === k);
  const h = target?.handle.height ?? 1.4;
  return h * 1.62 + 0.75;
}

if (only) {
  const target = [...exhibits, woodwall].find((e) => e.key === only);
  const h = target?.handle.height ?? 1.4;
  focus.y = h * 0.56 + 0.18;
}

window.addEventListener('resize', layoutCamera);
layoutCamera();

// ------------------------------------------------------------------- animation

let last = performance.now();
let elapsed = 0;
let blinkTimer = 1.5;
let blinking = false;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;

  for (let i = 0; i < turntables.length; i += 1) {
    const table = turntables[i];
    if (!table) continue;
    if (fullSpin) {
      table.rotation.y = elapsed * 0.42 + i * 0.7;
    } else {
      // Showroom sway: the exhibit turns to show its shape but never turns its
      // face away from the client. Screenshots always catch a smile.
      table.rotation.y = Math.sin(elapsed * 0.45 + i * 0.85) * 0.52;
    }
  }

  for (const creature of creatures) {
    creature.setWalkPhase(elapsed * 0.55, 0.3);
  }

  for (const exhibit of shown) exhibit.handle.update?.(dt, elapsed);

  // Everybody blinks together — it is a gallery, not a crowd scene, and
  // synchronised blinking reads as charming rather than eerie at this scale.
  blinkTimer -= dt;
  if (blinkTimer <= 0) {
    blinking = !blinking;
    blinkTimer = blinking ? 0.13 : 2.4 + Math.random() * 2.2;
    for (const creature of creatures) creature.setExpression(blinking ? 'blink' : 'neutral');
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --------------------------------------------------------------------- backdrop

/** The showroom floor: warm cream in the middle, cool mint at the rim. */
function radialWashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fffdf6');
  grad.addColorStop(0.45, hexToCss(ART.stageFloor));
  grad.addColorStop(1, '#dcefe1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A soft sky-to-cream vertical wash, painted rather than lit. */
function backdropTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, hexToCss(ART.stageBackTop));
  grad.addColorStop(0.62, '#e8f4ff');
  grad.addColorStop(1, hexToCss(ART.stageBackBottom));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Tell the harness (and any humans watching) that the scene is ready to shoot.
requestAnimationFrame(() => {
  document.body.dataset.galleryReady = 'true';
  document.getElementById('gallery-loading')?.remove();
});
