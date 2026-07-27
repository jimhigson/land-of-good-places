/**
 * The smallest `document` a model factory needs in order to be built outside a
 * browser.
 *
 * The art code paints its own textures — faces, wood, stone — onto 2D canvases
 * (`src/core/textures.ts`, `src/art/style/faces.ts`). None of that affects a
 * model's *shape*, which is all a measuring script cares about, but it does run
 * unconditionally at construction, so a script that builds a pet in Node hits
 * `document.createElement('canvas')` before it ever sees a vertex.
 *
 * So the canvas is stubbed rather than emulated: a recording-free no-op that
 * accepts every 2D call and returns something plausible for the handful that
 * are read back. `three.CanvasTexture` only stores the element — nothing is
 * uploaded without a renderer, and there is no renderer here.
 *
 * Import this **before** anything from `src/`.
 */

/** Fake 2D context: accepts every call, answers the few that return a value. */
function context2d() {
  const gradient = { addColorStop() {} };
  const target = {
    canvas: null,
    measureText: (text) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: (_x, _y, w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  // Everything else — fillRect, arc, bezierCurveTo, the style properties — is
  // absorbed. A Proxy is used rather than a list so a new drawing call in the
  // art code never breaks the measurement.
  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      return () => undefined;
    },
    set() {
      return true;
    },
  });
}

function canvasElement() {
  return {
    width: 1,
    height: 1,
    style: {},
    getContext: (kind) => (kind === '2d' ? context2d() : null),
    toDataURL: () => 'data:,',
    addEventListener() {},
    removeEventListener() {},
  };
}

/** Installs the stub globals. Safe to call twice. */
export function installHeadlessCanvas() {
  if (globalThis.document) return;
  const document = {
    createElement: (tag) => (tag === 'canvas' ? canvasElement() : { style: {}, appendChild() {} }),
    createElementNS: () => ({ style: {} }),
    documentElement: { style: {} },
    body: { appendChild() {}, style: {} },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.window ??= {
    document,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.HTMLCanvasElement ??= class {};
}

installHeadlessCanvas();
