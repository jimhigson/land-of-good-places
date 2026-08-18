import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, CAMERA_ZOOM_STEP } from '../../src/core/constants';
import { IsoCamera } from '../../src/core/IsoCamera';
import { PointerControls, type PointerControlsOptions } from '../../src/core/input/PointerControls';
import type { FrameContext } from '../../src/core/types';

/**
 * Issue #242: a mouse/trackpad has no pinch, so before this the wheel did
 * nothing at all — a desktop player could not zoom.
 *
 * These tests dispatch a real `wheel` `Event` through a real `EventTarget`,
 * the same reasoning `test/input/text-entry-guard.test.ts` gives for issue
 * #189: a bug in *whether the listener actually moves the camera* is
 * invisible to a test that only checks the listener got attached. There is no
 * jsdom in this project, so `deltaY`/`deltaMode` are attached to a plain
 * `Event` with `Object.defineProperty`, exactly as that file attaches `code`
 * to a fake keydown.
 */

/** Stand-in for the canvas: a real `EventTarget`, so `dispatchEvent` genuinely
 *  runs `PointerControls`'s listener and `preventDefault` behaves for real. */
class FakeCanvas extends EventTarget {}

/**
 * Issue #282's fix moved pointer listening from the canvas to `window`
 * (capture phase), so `attach()`/`detach()` now unconditionally touch
 * `window.addEventListener`/`removeEventListener` — real in every browser,
 * absent in this project's plain-Node vitest environment (no jsdom, see
 * above). These tests only ever exercise the wheel path, which stays
 * canvas-scoped, so a bare `EventTarget` stand-in is enough to stop
 * `attach()` throwing; nothing here needs it to actually receive an event.
 */
if (typeof window === 'undefined') {
  (globalThis as { window: EventTarget }).window = new EventTarget();
}

function dispatchWheel(target: EventTarget, deltaY: number, deltaMode = 0): boolean {
  const event = new Event('wheel', { cancelable: true });
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  Object.defineProperty(event, 'deltaMode', { value: deltaMode });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function noop(): void {}

/**
 * Runs `IsoCamera`'s own per-frame damping to convergence. `nudgeZoom` only
 * ever moves the private, undamped `zoomTarget`; the public `.zoom` getter
 * reads the damped `zoomValue`, which chases it over time (0.12s half-life —
 * see `IsoCamera.update`). A `dt` this large collapses that gap to well under
 * a float epsilon, so `.zoom` reads back exactly what the wheel asked for
 * without this test reaching into a private field to check it.
 */
function settleZoom(camera: IsoCamera): void {
  const frame = {
    dt: 10,
    elapsed: 10,
    input: { justPressed: () => false },
    playerPosition: new Vector3(),
    cameraForward: new Vector3(0, 0, 1),
    frame: 0,
  } as unknown as FrameContext;
  camera.update(frame, new Vector3(), new Vector3());
}

/** Wires `onWheelZoom` exactly the way `Game.ts` does: straight into
 *  `IsoCamera.nudgeZoom`, the one function that owns "how far you may zoom" —
 *  see CLAUDE.md, "Two definitions of one thing, kept in step by hand". */
function wireToCamera(camera: IsoCamera): PointerControlsOptions {
  return {
    onTap: noop,
    onPinch: (delta) => camera.nudgeZoom(delta),
    onWheelZoom: (notches) => camera.nudgeZoom(notches * CAMERA_ZOOM_STEP),
  };
}

describe('wheel zoom drives IsoCamera.nudgeZoom — the same function pinch does', () => {
  it('a wheel-up notch zooms in, and stays clamped to the exact range pinch/keyboard use', () => {
    const canvas = new FakeCanvas();
    const camera = new IsoCamera();
    const startZoom = camera.zoom;
    const controls = new PointerControls(canvas as unknown as HTMLCanvasElement, wireToCamera(camera));
    controls.attach();

    // Wheel-up is a negative deltaY by platform convention (and stays negative
    // under macOS "natural" scrolling too — the OS folds that preference into
    // the sign before the page ever sees it). It must zoom IN, i.e. raise
    // `.zoom` — "Larger = closer", per IsoCamera's own doc comment.
    expect(dispatchWheel(canvas, -120), 'a wheel event on the canvas must be prevented').toBe(true);
    settleZoom(camera);
    expect(camera.zoom, 'a wheel-up notch must actually move the zoom, not leave it where it started').toBeGreaterThan(
      startZoom,
    );

    // Scrolling up far past the top of the range must land exactly on
    // CAMERA_ZOOM_MAX — pinch's own ceiling, imported rather than restated —
    // proving the wheel has no second, hand-copied limit of its own.
    for (let i = 0; i < 400; i++) dispatchWheel(canvas, -1000);
    settleZoom(camera);
    expect(camera.zoom).toBeCloseTo(CAMERA_ZOOM_MAX, 5);

    // And the floor, the same way.
    for (let i = 0; i < 400; i++) dispatchWheel(canvas, 1000);
    settleZoom(camera);
    expect(camera.zoom).toBeCloseTo(CAMERA_ZOOM_MIN, 5);

    controls.detach();
  });

  it('scrolling down zooms out', () => {
    const canvas = new FakeCanvas();
    const camera = new IsoCamera();
    const controls = new PointerControls(canvas as unknown as HTMLCanvasElement, wireToCamera(camera));
    controls.attach();

    dispatchWheel(canvas, 120); // positive deltaY: wheel down / scroll down
    settleZoom(camera);
    expect(camera.zoom).toBeLessThan(1);

    controls.detach();
  });

  it('a pixel-mode notch and a line-mode notch move the zoom by the same amount', () => {
    // deltaMode is the trap named in issue #242: a browser/device that reports
    // DOM_DELTA_LINE (Firefox on Windows, typically ~3) instead of
    // DOM_DELTA_PIXEL (Chrome/Safari, typically ~100) must still feel like an
    // ordinary wheel click, not fly or crawl.
    const pixelCanvas = new FakeCanvas();
    const pixelCamera = new IsoCamera();
    new PointerControls(pixelCanvas as unknown as HTMLCanvasElement, wireToCamera(pixelCamera)).attach();
    dispatchWheel(pixelCanvas, -100, 0); // DOM_DELTA_PIXEL

    const lineCanvas = new FakeCanvas();
    const lineCamera = new IsoCamera();
    new PointerControls(lineCanvas as unknown as HTMLCanvasElement, wireToCamera(lineCamera)).attach();
    dispatchWheel(lineCanvas, -3, 1); // DOM_DELTA_LINE

    settleZoom(pixelCamera);
    settleZoom(lineCamera);
    expect(lineCamera.zoom).toBeCloseTo(pixelCamera.zoom, 5);
  });

  it('does nothing if nothing is listening — proves the test can actually fail', () => {
    // The failure mode CLAUDE.md warns about: "the listener is attached"
    // passing while nothing moves. This test does not attach a wheel handler
    // at all — dispatching straight at a bare EventTarget with no
    // PointerControls involved — so it is the "disconnect the handler and
    // watch it go red" check made permanent: if a future refactor ever made
    // `.zoom` change on its own (e.g. some ambient per-frame drift), this is
    // what would catch a wheel test that could pass for the wrong reason.
    const canvas = new FakeCanvas();
    const camera = new IsoCamera();
    const startZoom = camera.zoom;

    dispatchWheel(canvas, -120);
    settleZoom(camera);

    expect(camera.zoom).toBe(startZoom);
  });
});
