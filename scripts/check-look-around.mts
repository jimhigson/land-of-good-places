/**
 * **Does dragging look around the park without ever walking her — and does the
 * camera come back?** (#419)
 *
 * ```
 * pnpm run check:look-around
 * ```
 *
 * Jim, 31 August 2026: *"while in normal gameplay (walking around) dragging the
 * screen with the mouse or a finger should pan the camera to look around the
 * park. Then, after about 3s of not swiping/dragging it should return to your
 * character"*.
 *
 * Two things can go wrong with that, and both are silent until a child finds
 * them:
 *
 * 1. **A drag walks her.** `PointerControls.onTap` is the *only* route from a
 *    pointer to a footstep — `Game` hands it to `Selection` and then to
 *    `TapNavigator`, and nothing else in the game can start a walk from a
 *    finger. So "a drag must never walk the player" is exactly "a drag must
 *    never fire `onTap`", and that is what section 2 asserts, against the real
 *    class driven by real `PointerEvent`-shaped events. This is
 *    GAME_DESIGN.md's CONTROL RULE at the only place it could be broken by this
 *    feature.
 * 2. **The camera does not come back**, or comes back at the wrong time. A
 *    stuck offset is a child looking at a hedge with her character off screen
 *    and no way she would know to get back.
 *
 * And one thing that must *not* break: **tap-to-walk everywhere it works
 * today.** Section 1 walks the whole boundary of what a tap is — well inside
 * the slop, one pixel inside it, one pixel outside, and over time — because
 * this feature's entire risk is that it moved that line.
 *
 * ## Why this is not a browser test
 *
 * Everything above is decided by two classes and no pixels: `PointerControls`
 * turns events into signals, `IsoCamera` turns signals into a camera position.
 * Both run in Node against a twenty-line DOM shim, so this costs a second and
 * runs on every PR inside `pnpm run check` — where a browser harness would not.
 * The *feel* was checked in a browser at 390x844 and desktop, which is a
 * different question and not one a check can hold.
 *
 * **Nothing here restates a threshold.** The drift slop and the tap timeout are
 * imported from `tapGesture.ts`, the delay and the leash from `constants.ts`.
 * A check that hard-codes 18 goes green the day someone changes the game to 24,
 * which is the failure `tapGesture.ts` itself was written to end.
 */

import { Vector3 } from 'three';
import {
  CAMERA_LOOK_MAX_DISTANCE,
  CAMERA_LOOK_RETURN_DELAY,
  CAMERA_LOOK_RETURN_HALF_LIFE,
} from '../src/core/constants.ts';
import { TAP_MAX_DRIFT_PX, TAP_MAX_MILLISECONDS } from '../src/core/input/tapGesture.ts';
import { circleBoundary } from '../src/world/boundary.ts';

let failures = 0;
let checks = 0;

function fail(message: string): void {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) fail(message);
}

function near(actual: number, expected: number, tolerance: number, message: string): void {
  checks += 1;
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(`${message}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
  }
}

// ---------------------------------------------------------------- the shim

/**
 * The smallest DOM `PointerControls` will accept: a `window` that remembers
 * capture-phase listeners by type, and a canvas with a rectangle.
 *
 * `setPointerCapture` throws `NotFoundError` for a pointer id the shim has
 * never heard of — which is *exactly* what a real browser does for a
 * synthesised or already-released pointer, and what `PointerControls.capture`'s
 * try/catch exists to swallow. Kept faithful on purpose: a shim that quietly
 * succeeds where the browser throws would hide the bug that comment describes.
 */
type Listener = (event: unknown) => void;

const listeners = new Map<string, Listener[]>();

function addListener(type: string, handler: Listener): void {
  const existing = listeners.get(type);
  if (existing) existing.push(handler);
  else listeners.set(type, [handler]);
}

function removeListener(type: string, handler: Listener): void {
  const existing = listeners.get(type);
  if (!existing) return;
  const at = existing.indexOf(handler);
  if (at >= 0) existing.splice(at, 1);
}

const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 844;

const canvas = {
  addEventListener: addListener,
  removeEventListener: removeListener,
  getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    right: CANVAS_WIDTH,
    bottom: CANVAS_HEIGHT,
    x: 0,
    y: 0,
  }),
  setPointerCapture(): void {
    throw new Error('NotFoundError');
  },
  releasePointerCapture(): void {
    throw new Error('NotFoundError');
  },
};

(globalThis as { window?: unknown }).window = {
  addEventListener: addListener,
  removeEventListener: removeListener,
};

const { PointerControls } = await import('../src/core/input/PointerControls.ts');
const { IsoCamera } = await import('../src/core/IsoCamera.ts');

/**
 * A pointer event good enough for `PointerControls`, timed by **`timeStamp`**.
 *
 * That field is the whole reason this helper takes a time at all. Everything in
 * this game that measures a gesture reads `event.timeStamp` — when the browser
 * *created* the event — and never `performance.now()`, which is when the
 * handler finally ran: measured on this machine, a `pointerup` dispatched 80 ms
 * after its `pointerdown` reached the listener **2205 ms** later, and an
 * ordinary tap timed by the wall clock therefore intermittently stops counting.
 * Section 1's "a slow tap is still a tap" case only means anything because the
 * time below is the event's own.
 */
function pointerEvent(
  x: number,
  y: number,
  timeStamp: number,
  pointerId = 1,
  pointerType = 'touch',
): unknown {
  return {
    clientX: x,
    clientY: y,
    timeStamp,
    pointerId,
    pointerType,
    button: 0,
    target: canvas,
    preventDefault(): void {},
    stopPropagation(): void {},
  };
}

function dispatch(type: string, event: unknown): void {
  for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
}

interface Recorded {
  taps: number;
  lookX: number;
  lookY: number;
  lookEvents: number;
}

function makeControls(): { controls: InstanceType<typeof PointerControls>; log: Recorded } {
  const log: Recorded = { taps: 0, lookX: 0, lookY: 0, lookEvents: 0 };
  const controls = new PointerControls(canvas as unknown as HTMLCanvasElement, {
    onTap: () => {
      log.taps += 1;
    },
    onPinch: () => {},
    onWheelZoom: () => {},
    onLookDrag: (dx, dy) => {
      log.lookEvents += 1;
      log.lookX += dx;
      log.lookY += dy;
    },
  });
  controls.attach();
  return { controls, log };
}

/**
 * Presses at `(x, y)`, moves through `path` a step at a time, and lifts —
 * exactly as a finger produces `pointerdown` / many `pointermove` / `pointerup`.
 * `durationMs` is spread over the whole gesture on the event clock.
 */
function gesture(
  x: number,
  y: number,
  path: readonly (readonly [number, number])[],
  durationMs: number,
  pointerType = 'touch',
): Recorded {
  const { controls, log } = makeControls();
  const step = path.length > 0 ? durationMs / path.length : durationMs;
  dispatch('pointerdown', pointerEvent(x, y, 0, 1, pointerType));
  let at = 0;
  let last: readonly [number, number] = [x, y];
  for (const point of path) {
    at += step;
    dispatch('pointermove', pointerEvent(point[0], point[1], at, 1, pointerType));
    last = point;
  }
  dispatch('pointerup', pointerEvent(last[0], last[1], durationMs, 1, pointerType));
  controls.detach();
  return log;
}

/** A straight drag from `(x, y)` by `(dx, dy)`, in `steps` even moves. */
function straightDrag(
  x: number,
  y: number,
  dx: number,
  dy: number,
  steps = 20,
  durationMs = 500,
  pointerType = 'touch',
): Recorded {
  const path: [number, number][] = [];
  for (let i = 1; i <= steps; i += 1) {
    path.push([x + (dx * i) / steps, y + (dy * i) / steps]);
  }
  return gesture(x, y, path, durationMs, pointerType);
}

// --- 1. tap-to-walk, exactly as it worked before -----------------------------
console.log('tap-to-walk still works everywhere it works today');
{
  // A clean tap: down and up in the same place.
  check(gesture(120, 400, [], 90).taps === 1, 'a still tap must walk her');

  // A six-year-old's tap wobbles. `TAP_MAX_DRIFT_PX` is generous precisely
  // because of this, and that generosity must survive the new gesture.
  const wobble = Math.round(TAP_MAX_DRIFT_PX * 0.5);
  check(
    straightDrag(120, 400, wobble, 0, 4, 120).taps === 1,
    'a tap that wobbles half the slop must still walk her',
  );

  // One pixel inside the line, and one pixel outside it: the boundary itself,
  // which is the only place a new gesture could have moved it.
  const inside = straightDrag(120, 400, TAP_MAX_DRIFT_PX - 1, 0, 6, 200);
  check(inside.taps === 1, 'a tap one pixel inside the slop must still walk her');
  check(inside.lookEvents === 0, 'a tap inside the slop must not pan the camera');

  const outside = straightDrag(120, 400, TAP_MAX_DRIFT_PX + 1, 0, 6, 200);
  check(outside.taps === 0, 'a drag one pixel outside the slop must not walk her');
  check(outside.lookEvents > 0, 'a drag one pixel outside the slop must pan the camera');

  // Timed by the event clock, not the wall clock — see `pointerEvent`.
  check(
    gesture(120, 400, [], TAP_MAX_MILLISECONDS - 10).taps === 1,
    'a slow-but-in-time tap must still walk her',
  );
  check(
    gesture(120, 400, [], TAP_MAX_MILLISECONDS + 10).taps === 0,
    'a press held past the tap timeout must not walk her',
  );

  // A mouse, not only a finger: click-to-walk is the desktop half of the same
  // control and has to survive the same change.
  check(
    gesture(120, 400, [], 90, 'mouse').taps === 1,
    'a mouse click must still walk her',
  );
  check(
    straightDrag(120, 400, 0, TAP_MAX_DRIFT_PX + 20, 10, 300, 'mouse').taps === 0,
    'a held mouse drag must not walk her',
  );
}

// --- 2. a drag looks, and never walks (the CONTROL RULE) ---------------------
console.log('a drag looks around and never walks her');
{
  for (const [dx, dy] of [
    [140, 0],
    [-140, 0],
    [0, 180],
    [0, -180],
    [110, 130],
    [-90, -160],
  ] as const) {
    const dragged = straightDrag(195, 422, dx, dy);
    check(dragged.taps === 0, `dragging by (${dx}, ${dy}) must never walk her`);
    check(dragged.lookEvents > 0, `dragging by (${dx}, ${dy}) must pan the camera`);
    // The pan follows the finger, minus the slop spent finding out it was a
    // drag — so the sign must match and the size must be within that slop.
    check(
      Math.abs(dragged.lookX - dx) <= TAP_MAX_DRIFT_PX + 1e-6 &&
        Math.abs(dragged.lookY - dy) <= TAP_MAX_DRIFT_PX + 1e-6,
      `the pan must track the finger for (${dx}, ${dy}), got (${dragged.lookX.toFixed(1)}, ${dragged.lookY.toFixed(1)})`,
    );
  }

  // A long slow drift: never fast, never far in one step, but well past the
  // slop overall. `tapDriftedTooFar` measures from where the gesture *started*
  // for exactly this case, and it must not creep back into being a tap.
  const creep: [number, number][] = [];
  for (let i = 1; i <= 60; i += 1) creep.push([195 + i, 422]);
  const crept = gesture(195, 422, creep, 5000);
  check(crept.taps === 0, 'a slow creep across the screen must not walk her');
  check(crept.lookEvents > 0, 'a slow creep must pan the camera');

  // Two fingers are a zoom, not a look — and lifting one must not leave the
  // other panning.
  {
    const { controls, log } = makeControls();
    dispatch('pointerdown', pointerEvent(100, 400, 0, 1));
    dispatch('pointerdown', pointerEvent(300, 400, 10, 2));
    for (let i = 1; i <= 10; i += 1) {
      dispatch('pointermove', pointerEvent(100 - i * 6, 400, 10 + i * 10, 1));
      dispatch('pointermove', pointerEvent(300 + i * 6, 400, 10 + i * 10, 2));
    }
    dispatch('pointerup', pointerEvent(340, 400, 200, 2));
    for (let i = 1; i <= 10; i += 1) {
      dispatch('pointermove', pointerEvent(40 - i * 6, 400, 200 + i * 10, 1));
    }
    dispatch('pointerup', pointerEvent(-20, 400, 400, 1));
    controls.detach();
    check(log.lookEvents === 0, 'a pinch must never pan the park');
    check(log.taps === 0, 'neither finger of a pinch may walk her');
  }
}

// --- 3. the camera goes where the drag went ----------------------------------
console.log('the camera goes where the drag went, and no further');

const camera = new IsoCamera();
camera.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
const HOME = new Vector3(0, 0, 0);
camera.snapTo(HOME);

/** One frame of the game, at 60 fps, standing still. */
const frame = {
  dt: 1 / 60,
  elapsed: 0,
  frame: 0,
  playerPosition: HOME,
  cameraForward: camera.forward,
  input: { justPressed: () => false },
} as unknown as Parameters<IsoCamera['update']>[0];

const STILL = new Vector3(0, 0, 0);
/**
 * `IsoCamera.update`'s own `TEMP_LIFT` — the camera aims at chest height, not
 * at her feet, so "the view is back on her" means the follow point and not the
 * player's position. Restated here only because that constant is private to the
 * camera; if it ever moves, this check goes red and says so, which is the right
 * way round.
 */
const CHEST_HEIGHT = new Vector3(0, 1.25, 0);

function tick(seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) camera.update(frame, HOME, STILL);
}

{
  camera.snapTo(HOME);
  tick(0.5);
  near(camera.lookDistance, 0, 1e-9, 'the camera starts on her');

  // Drag right: the park follows the finger, so the *view* travels left. The
  // sign is the whole difference between direct manipulation and a control
  // that feels backwards, and it is not something a comment can guarantee.
  //
  // Read off `focusPoint` — where the camera is actually pointing — rather than
  // the offset, so this holds the composed result and not just the arithmetic
  // that feeds it. One frame is ticked after each drag because that is when the
  // camera's transform is rebuilt, exactly as in the game.
  const before = camera.focusPoint.clone();
  camera.lookByPixels(80, 0);
  tick(1 / 60);
  check(
    camera.focusPoint.clone().sub(before).dot(camera.right) < 0,
    'dragging right must move the view left, so the park follows the finger',
  );

  camera.cancelLook();
  camera.snapTo(HOME);
  const beforeDown = camera.focusPoint.clone();
  camera.lookByPixels(0, 80);
  tick(1 / 60);
  check(
    camera.focusPoint.clone().sub(beforeDown).dot(camera.forward) > 0,
    'dragging down must move the view up the screen, revealing what was above',
  );

  // Panning must *translate* only. If the rig ever started turning, "up the
  // screen" would stop meaning one thing and GAME_DESIGN.md's CONTROL RULE
  // would be in play — so this asserts the axes are the same objects' values
  // before and after a big drag.
  const forwardBefore = camera.forward.clone();
  const rightBefore = camera.right.clone();
  camera.lookByPixels(300, -220);
  check(
    camera.forward.distanceTo(forwardBefore) === 0 && camera.right.distanceTo(rightBefore) === 0,
    'panning must never rotate the rig — dragging looks, it does not steer',
  );

  // The leash from her.
  camera.cancelLook();
  camera.snapTo(HOME);
  for (let i = 0; i < 40; i += 1) camera.lookByPixels(200, 200);
  check(
    camera.lookDistance <= CAMERA_LOOK_MAX_DISTANCE + 1e-6,
    `an endless drag must stop at ${CAMERA_LOOK_MAX_DISTANCE} m, got ${camera.lookDistance.toFixed(2)}`,
  );
  check(camera.lookDistance > 1, 'an endless drag must still have gone somewhere');
}

// --- 4. she cannot look into a neighbouring floor's void ---------------------
console.log('panning stops at the edge of the space she is in');
{
  // The castle's floors are disjoint spaces hundreds of metres apart, and
  // per-space visibility means a camera off the floor renders empty sky. The
  // camera is leashed by `Collision.playBounds` — the same boundary the player
  // is leashed to, swapped on every change of space — so a small room is a
  // small leash without the camera knowing what a castle is.
  const ROOM = 6;
  camera.setLookBounds(circleBoundary(ROOM, 0, 0));
  camera.cancelLook();
  camera.snapTo(HOME);
  for (let i = 0; i < 40; i += 1) camera.lookByPixels(200, 200);
  check(
    camera.lookDistance <= ROOM + 1e-3,
    `indoors the view must stop at the room's own edge (${ROOM} m), got ${camera.lookDistance.toFixed(3)}`,
  );
  check(
    camera.lookDistance > ROOM * 0.5,
    'indoors panning must still reach most of the room — a dead gesture is worse than a short one',
  );

  // Every direction, not just the one that happened to be tested.
  for (const [dx, dy] of [
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
    [-150, 150],
  ] as const) {
    camera.cancelLook();
    camera.snapTo(HOME);
    for (let i = 0; i < 40; i += 1) camera.lookByPixels(dx, dy);
    check(
      camera.lookDistance <= ROOM + 1e-3,
      `dragging (${dx}, ${dy}) indoors must stay inside the room, got ${camera.lookDistance.toFixed(3)}`,
    );
  }
  camera.setLookBounds(null);
}

// --- 5. and after about three seconds, it comes back to her ------------------
console.log('after about three seconds the camera returns to her');
{
  camera.cancelLook();
  camera.snapTo(HOME);
  for (let i = 0; i < 10; i += 1) camera.lookByPixels(60, 40);
  const dragged = camera.lookDistance;
  check(dragged > 1, 'the drag must have moved the view somewhere to return from');

  // It holds still for the whole delay. A camera that starts sliding back
  // immediately is not "look around the park", it is a rubber band.
  tick(CAMERA_LOOK_RETURN_DELAY - 0.2);
  near(camera.lookDistance, dragged, 1e-6, 'the view must hold still for the whole delay');
  check(
    camera.lookIdle >= CAMERA_LOOK_RETURN_DELAY - 0.25,
    'the idle timer must be counting towards the return',
  );

  // Then it eases — gently. One half-life in, roughly half the offset is gone;
  // the exponential is asserted against its own definition rather than a
  // hand-copied number, and the tolerance is one frame's worth of decay.
  tick(0.2 + CAMERA_LOOK_RETURN_HALF_LIFE);
  const halfway = camera.lookDistance;
  const expected = dragged * 0.5;
  check(
    Math.abs(halfway - expected) < dragged * 0.03,
    `one half-life in, about half the offset should remain: expected ~${expected.toFixed(2)}, got ${halfway.toFixed(2)}`,
  );
  check(halfway < dragged, 'the return must have started');

  // Gentle means monotonic and never past her: a spring would overshoot, and a
  // camera that sails past the character and rocks back is the "snapped"
  // feeling this is meant to avoid.
  let previous = camera.lookDistance;
  for (let i = 0; i < 600; i += 1) {
    camera.update(frame, HOME, STILL);
    if (camera.lookDistance > previous + 1e-9) {
      fail('the return must never move away from her — no overshoot, no wobble');
      break;
    }
    previous = camera.lookDistance;
  }
  checks += 1;

  // Arrives, rather than approaching zero forever — see `LOOK_HOME_EPSILON`.
  near(camera.lookDistance, 0, 0, 'the camera must actually arrive back on her');
  near(
    camera.focusPoint.distanceTo(HOME.clone().add(CHEST_HEIGHT)),
    0,
    1e-6,
    'once home the view point is the follow point, right on her',
  );

  // A drag while the return is under way takes the view straight back out —
  // she is looking again, and the three seconds start over.
  camera.cancelLook();
  camera.snapTo(HOME);
  camera.lookByPixels(120, 0);
  tick(CAMERA_LOOK_RETURN_DELAY + 0.5);
  const partWayHome = camera.lookDistance;
  check(partWayHome > 0 && partWayHome < 120, 'the return should be under way');
  camera.lookByPixels(-40, 0);
  near(camera.lookIdle, 0, 1e-9, 'a new drag must restart the three seconds');
}

// --- 6. a ride takes the view back at once, not gently ----------------------
console.log('a ride takes the view back at once');
{
  camera.cancelLook();
  camera.snapTo(HOME);
  for (let i = 0; i < 10; i += 1) camera.lookByPixels(60, 40);
  check(camera.lookDistance > 1, 'the view is out before the ride starts');
  // `Game.tick` calls this the frame `lookAroundBlocked()` becomes true. It
  // must land in that one frame: an eased return would still be in flight when
  // the ride handed the camera back, fighting a camera already in motion.
  camera.cancelLook();
  near(camera.lookDistance, 0, 0, 'a ride must put the view back on her in one frame');
  camera.update(frame, HOME, STILL);
  near(camera.lookDistance, 0, 0, 'and it must stay there while the ride has her');
}

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\nPASS: ${checks} checks. Dragging looks around the park, tapping still walks her, and the camera comes home.`
    : `\n${failures} FAILURE(S) out of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
