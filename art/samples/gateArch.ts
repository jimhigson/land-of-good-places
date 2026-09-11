import {
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';
import { PALETTE } from '../../src/core/palette';
import { grassTexture, pathTexture } from '../../src/core/textures';
import { createGateArch, GATE_ARCH_LOGO_CENTRE_Y } from '../../src/art/models/gateArch';
import { createKid, KID_HEIGHT } from '../../src/art/models/kid';

/**
 * **The entrance arch, on its own, under the game's own light.**
 *
 * `scripts/render-gate-arch.mts` drives this page to write the review pictures
 * in `art/renders/gate-arch-*.png`; a person can open it too —
 * `/gate-arch.html?shot=walk-up`.
 *
 * ## Why this and not a Blender render
 *
 * The thing being judged here is **the lettering and the logo**, and both live
 * in a canvas texture painted by `gateArch.ts`. A Blender render could only
 * show the arch's shape, or else keep its own copy of the painting code — and
 * a render script with its own copy of anything is exactly the bug the bridge
 * kit shipped (`ASSET_MANIFEST.md` §32): its build script read the constants
 * properly, its render script hand-copied them, and five committed pictures
 * were of a bridge that was not on the branch.
 *
 * So there is one renderer, of the real thing. It imports `createGateArch()`
 * and `createKid()` and copies **no** number out of either — including the
 * child's height, which `ASSET_MANIFEST.md` records being typed wrong into a
 * Blender scale post for weeks while every human who read those pictures drew
 * a confident wrong conclusion about how big the asset was. The child in these
 * shots is the actual child.
 *
 * Lighting is copied from `src/core/Engine.ts` (via `art/samples/main.ts`), for
 * that file's own reason: a picture taken under nicer light than the game's is
 * a picture of something that does not exist.
 */

const params = new URLSearchParams(location.search);

const canvas = document.getElementById('arch-canvas') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = VSMShadowMap;

const scene = new Scene();

// -------------------------------------------------------------------- lights
// The game's midday key, verbatim from `art/samples/main.ts`.

scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.05));

const key = new DirectionalLight(PALETTE.sunDay, 2.35);
key.position.set(11, 17, 14);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.radius = 6;
key.shadow.bias = -0.0008;
const shadowCam = key.shadow.camera;
shadowCam.left = -16;
shadowCam.right = 16;
shadowCam.top = 14;
shadowCam.bottom = -6;
shadowCam.near = 1;
shadowCam.far = 70;
shadowCam.updateProjectionMatrix();
scene.add(key);

const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.55);
fill.position.set(-13, 7, -9);
scene.add(fill);

// -------------------------------------------------------------------- ground
// Lawn, and the sand path the bus drops her on, running through the gateway.

const lawn = new Mesh(
  new CircleGeometry(90, 64),
  new MeshStandardMaterial({ map: grassTexture(40), roughness: 0.95, metalness: 0 }),
);
lawn.rotation.x = -Math.PI / 2;
lawn.receiveShadow = true;
scene.add(lawn);

const path = new Mesh(
  new PlaneGeometry(5.4, 60),
  new MeshStandardMaterial({ map: pathTexture(6), roughness: 0.92, metalness: 0 }),
);
path.rotation.x = -Math.PI / 2;
// Lifted a hair off the lawn rather than laid in its plane: two ground planes
// at one height is the coplanar strobe `check:coplanar` exists for, and this
// page is a showroom rather than the park, so it does not get to be sloppy
// about the thing the asset itself is careful about.
path.position.y = 0.012;
path.receiveShadow = true;
scene.add(path);

scene.background = null;
renderer.setClearColor(PALETTE.skyDayBottom);

// ---------------------------------------------------------------------- cast

const arch = createGateArch();
scene.add(arch.root);

/**
 * A real child, walking in, for scale.
 *
 * Not a post typed at a height — this is `createKid()`, so what the picture
 * says about how big the arch is stays true when the child changes.
 */
const kid = createKid();
kid.root.position.set(1.35, 0, 4.4);
kid.root.rotation.y = Math.PI;
scene.add(kid.root);

// ------------------------------------------------------------------ the shots
//
// `+Z` is out of the park, at the arriving child. Every eye height below is
// derived from `KID_HEIGHT`, never typed.

/** Where a 2.12 m child's eyes are, as a fraction of her height. */
const EYE = KID_HEIGHT * 0.8;

interface Shot {
  readonly from: [number, number, number];
  readonly at: [number, number, number];
  readonly fov: number;
}

const SHOTS: Record<string, Shot> = {
  /** The test that matters: walking up the road, at her eye height. */
  'walk-up': { from: [0.9, EYE, 19], at: [0, 4.6, 0], fov: 52 },
  /** Close enough to be about to go under it. */
  'walk-up-near': { from: [0.9, EYE, 9.5], at: [0, 5.0, 0], fov: 58 },
  /** The game's own camera: 38° down, 45° round. */
  iso: { from: [17, 15.5, 21], at: [0, 3.6, 0], fov: 42 },
  /** Three-quarters from the pavement, so the arch reads as a solid object. */
  'three-quarter': { from: [13, 3.4, 15], at: [0, 4.2, 0], fov: 48 },
  /** The mark, close up — is it a ferris wheel, and is it *our* ferris wheel? */
  logo: { from: [0, GATE_ARCH_LOGO_CENTRE_Y - 0.4, 7.5], at: [0, GATE_ARCH_LOGO_CENTRE_Y, 0], fov: 30 },
  /** Standing underneath, looking up. What the headroom actually feels like. */
  under: { from: [0.6, EYE, 2.6], at: [0, 5.4, -1.5], fov: 72 },
  /** From inside the park, looking back out — the sign reads this way too. */
  'from-inside': { from: [-1.2, EYE, -11], at: [0, 4.6, 0], fov: 52 },
};

const shot = SHOTS[params.get('shot') ?? 'walk-up'] ?? SHOTS['walk-up'];
if (!shot) throw new Error('gate-arch: no shots defined');

const camera = new PerspectiveCamera(shot.fov, 1, 0.1, 400);
camera.position.set(...shot.from);
camera.lookAt(new Vector3(...shot.at));

function resize(): void {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// The screenshot driver waits on this rather than on a timer, so a slow
// machine cannot photograph a half-built scene.
(window as unknown as { gateArchReady: boolean }).gateArchReady = true;
