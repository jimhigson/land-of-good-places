/**
 * **Does the park's camera breathe — gently, everywhere?**
 *
 * ```
 * pnpm run check:camera-breath
 * CAMERA_BREATH_MUTATE=still pnpm run check:camera-breath   # the camera held dead still: every floor must go red
 * CAMERA_BREATH_MUTATE=wild pnpm run check:camera-breath    # the breath ten times over: every ceiling must go red
 * CAMERA_BREATH_MUTATE=degrees pnpm run check:camera-breath # the breath's raw degrees on every lens, not sized on the screen: the narrow lenses go red
 * ```
 *
 * Jim, 26 October 2026, of the drift in story time's held shot: *"I like this
 * wobble and would like this small wobble to apply all of the time"*; and
 * 11 November 2026: *"yes to camera sway everywhere"*. So `IsoCamera` turns
 * its view about the eye by `core/cameraBreath.ts`, all of the time.
 *
 * Measured **from the screen**, the way a child sees it: the real `IsoCamera`,
 * following a child who stands still, and a ring of points fixed in the world
 * around her projected through it into CSS pixels every frame for twelve
 * seconds — on a laptop (1280×800) and a phone held upright (390×844), at the
 * park's middle and out where the ground leans, and at the default zoom, the
 * closest and the furthest. With her still and the follow settled, the breath
 * is the only thing that can move them. Each point's largest distance from its
 * own middle must be at least {@link FLOOR_PX} (under half a pixel is still)
 * and at most {@link CEILING_PX} (half a degree of a laptop's lens), and no
 * point may move more than {@link STEP_PX} in one frame (a twitch) — the same
 * numbers `check:library` holds story time's shot to, because it is the same
 * breath and Jim asked for the same gentle size everywhere.
 *
 * **The instrument's control runs first, on each screen and lens**: with the
 * breath held still the points must not move at all (so nothing else is
 * moving them), and with a still breath tilted by a known 0.1° the point at the
 * screen's middle must move by exactly what the lens says 0.1° is, sized on the
 * screen. (A tilt, not a turn: the turn is about the ground's up, so on a lens
 * pitched down it moves the picture by `cos(pitch)` of itself — a lens fact,
 * not a breath one.)
 */
import './headless-dom.mjs';
import { Vector3 } from 'three';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from '../src/core/constants.ts';
import { cameraBreath, CAMERA_BREATH_REFERENCE_FOV, STILL_BREATH, type CameraBreath } from '../src/core/cameraBreath.ts';

const MUTATIONS = ['', 'still', 'wild', 'degrees'] as const;
const MUTATE = process.env['CAMERA_BREATH_MUTATE'] ?? '';
if (!(MUTATIONS as readonly string[]).includes(MUTATE)) {
  throw new Error(`CAMERA_BREATH_MUTATE=${MUTATE} is not one of this check's mutations: ${MUTATIONS.filter((m) => m !== '').join(', ')}`);
}

/** Pixels: a fixed point's least and most distance from its own middle, and the most it may move in a frame. */
const FLOOR_PX = 0.5;
const CEILING_PX = 6;
const STEP_PX = 0.5;
const DT = 1 / 60;
/** Seconds the follow is given to settle on her, and seconds watched. */
const SETTLE = 20;
const WATCH = 12;

let failures = 0;
let passes = 0;
function say(ok: boolean, message: string): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
}

const frame = {
  dt: DT,
  elapsed: 0,
  frame: 0,
  playerPosition: new Vector3(),
  cameraForward: new Vector3(),
  input: { justPressed: () => false },
} as unknown as Parameters<IsoCamera['update']>[0];
const STILL = new Vector3();

/** The breath as the game has it — or as this run's mutation has it. */
const breathOf = (): ((seconds: number, out: CameraBreath) => CameraBreath) => {
  if (MUTATE === 'still') return STILL_BREATH;
  if (MUTATE === 'wild') {
    return (seconds, out) => {
      cameraBreath(seconds, out);
      out.yawDegrees *= 10;
      out.pitchDegrees *= 10;
      out.reach *= 10;
      return out;
    };
  }
  return cameraBreath;
};

/** A camera on this screen, at this zoom, settled on a child standing still at `at`, breathing `breath`. */
function settled(width: number, height: number, zoom: number, at: Vector3, breath: (seconds: number, out: CameraBreath) => CameraBreath): IsoCamera {
  const camera = new IsoCamera();
  camera.resize(width, height);
  camera.snapZoomTarget(zoom);
  camera.breath = breath;
  camera.snapTo(at);
  for (let t = 0; t < SETTLE; t += DT) camera.update(frame, at, STILL);
  return camera;
}

/** Points fixed in the world round the focus: the middle and a ring out to two-thirds of the frame, in the frame's own plane. */
function ringAround(camera: IsoCamera): Vector3[] {
  const focus = camera.focusPoint.clone();
  const right = camera.screenRightAxis.clone();
  const up = camera.screenUpAxis.clone();
  const w = camera.viewHalfWidth;
  const h = camera.viewHalfHeight;
  const points = [focus];
  for (const [a, b] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
    points.push(focus.clone().addScaledVector(right, (a * 2 * w) / 3).addScaledVector(up, (b * 2 * h) / 3));
  }
  return points;
}

function project(camera: IsoCamera, points: readonly Vector3[], width: number, height: number): [number, number][] {
  camera.camera.updateMatrixWorld();
  return points.map((point) => {
    const v = point.clone().project(camera.camera);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  });
}

/** Each point's largest distance from its own middle over `frames`, and the most any moved in one frame. */
function swayOf(frames: readonly [number, number][][]): { sway: number; step: number } {
  let sway = 0;
  let step = 0;
  const n = frames[0]!.length;
  for (let k = 0; k < n; k += 1) {
    const mx = frames.reduce((sum, at) => sum + at[k]![0], 0) / frames.length;
    const my = frames.reduce((sum, at) => sum + at[k]![1], 0) / frames.length;
    frames.forEach((at, i) => {
      sway = Math.max(sway, Math.hypot(at[k]![0] - mx, at[k]![1] - my));
      if (i > 0) step = Math.max(step, Math.hypot(at[k]![0] - frames[i - 1]![k]![0], at[k]![1] - frames[i - 1]![k]![1]));
    });
  }
  return { sway, step };
}

/** Watch `camera` for {@link WATCH} seconds, her standing still at `at`. */
function watch(camera: IsoCamera, at: Vector3, width: number, height: number): { sway: number; step: number } {
  const points = ringAround(camera);
  const frames: [number, number][][] = [project(camera, points, width, height)];
  for (let t = 0; t < WATCH; t += DT) {
    camera.update(frame, at, STILL);
    frames.push(project(camera, points, width, height));
  }
  return swayOf(frames);
}

const screens = [
  { width: 1280, height: 800, what: 'a laptop' },
  { width: 390, height: 844, what: 'a phone held upright' },
] as const;
const places = [
  { at: new Vector3(0, 0, 0), what: "the park's middle" },
  { at: new Vector3(140, 0, -60), what: 'out where the ground leans' },
] as const;
const zooms = [
  { zoom: 1, what: 'the default zoom' },
  { zoom: CAMERA_ZOOM_MAX, what: 'zoomed right in' },
  { zoom: CAMERA_ZOOM_MIN, what: 'zoomed right out' },
] as const;

/** `degrees`: the breath's raw angles on this lens — undoing `IsoCamera`'s sizing on the screen, as a mutation. */
const rawDegrees = (camera: IsoCamera): ((seconds: number, out: CameraBreath) => CameraBreath) => (seconds, out) => {
  cameraBreath(seconds, out);
  const onScreen = Math.tan((camera.camera.fov * Math.PI) / 360) / Math.tan((CAMERA_BREATH_REFERENCE_FOV * Math.PI) / 360);
  out.yawDegrees /= onScreen;
  out.pitchDegrees /= onScreen;
  return out;
};

console.log('THE CAMERA BREATHES — the park camera, following a child standing still, sways fixed scenery gently on every screen, at every zoom:');
if (MUTATE) console.log(`  (MUTATED: CAMERA_BREATH_MUTATE=${MUTATE} — this run must go red)`);
for (const screen of screens) {
  for (const zoom of zooms) {
    // The instrument's control on this screen and lens: nothing moves the points but the breath, and a known turn reads as itself.
    const at = places[0].at;
    const still = settled(screen.width, screen.height, zoom.zoom, at, STILL_BREATH);
    const quiet = watch(still, at, screen.width, screen.height);
    const turned = settled(screen.width, screen.height, zoom.zoom, at, STILL_BREATH);
    const middle = [turned.focusPoint.clone()];
    const before = project(turned, middle, screen.width, screen.height)[0]!;
    turned.breath = (_s, out) => Object.assign(out, { yawDegrees: 0, pitchDegrees: 0.1, reach: 0 });
    turned.update(frame, at, STILL);
    const after = project(turned, middle, screen.width, screen.height)[0]!;
    // What 0.1° of breath is on this lens, at the screen's middle: sized on the screen against the 66° lens.
    const fov = turned.camera.fov;
    const pxPerRadian = screen.height / 2 / Math.tan((fov * Math.PI) / 360);
    const expected = pxPerRadian * Math.tan(((0.1 * Math.PI) / 180) * (Math.tan((fov * Math.PI) / 360) / Math.tan((CAMERA_BREATH_REFERENCE_FOV * Math.PI) / 360)));
    const got = Math.hypot(after[0] - before[0], after[1] - before[1]);
    say(
      quiet.sway < 0.01 && Math.abs(got - expected) < 0.01,
      `the instrument's control, ${screen.what} at ${zoom.what} (lens ${fov.toFixed(1)}°): breath held still, the ring moved ${quiet.sway.toFixed(4)} px (under 0.01 wanted); ` +
        `a breath tilting 0.1° moved the screen's middle ${got.toFixed(3)} px (${expected.toFixed(3)} expected)`,
    );
    for (const place of places) {
      const camera = settled(screen.width, screen.height, zoom.zoom, place.at, breathOf());
      if (MUTATE === 'degrees') camera.breath = rawDegrees(camera);
      const { sway, step } = watch(camera, place.at, screen.width, screen.height);
      say(
        sway >= FLOOR_PX && sway <= CEILING_PX && step <= STEP_PX,
        `${screen.what} (${screen.width}×${screen.height}), ${zoom.what} (lens ${camera.camera.fov.toFixed(1)}°), ${place.what}: over ${WATCH} s fixed scenery swayed ${sway.toFixed(2)} px from its middle ` +
          `(${FLOOR_PX}–${CEILING_PX} wanted), never more than ${step.toFixed(3)} px in a frame (${STEP_PX} allowed)`,
      );
    }
  }
}

console.log(`\n${passes} ✓ ${failures} ✗`);
if (failures > 0) {
  console.error(`check:camera-breath: ${failures} failed${MUTATE ? ` (CAMERA_BREATH_MUTATE=${MUTATE}, as it should)` : ''}`);
  process.exit(1);
}
