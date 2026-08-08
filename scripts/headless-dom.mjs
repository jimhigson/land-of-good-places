/**
 * A `document` and a `window` big enough to run a **whole mini-game** in Node.
 *
 * `headless-canvas.mjs` is the smallest DOM a *model factory* needs: art code
 * paints textures at construction time, and that is all it ever touches. A ride
 * wants more. `minigames/ferrisWheel/hud.ts` builds real elements with
 * `className`, `dataset` and `append`; `look.ts` listens on `window` for
 * pointer and key events — and a look-around trace that cannot *deliver* an
 * event is a trace of a child sitting on their hands.
 *
 * So this layers on top: import `headless-canvas.mjs` first for the canvas, then
 * upgrade the elements and give `window` a real listener bus that
 * {@link dispatch} can fire into. Nothing is emulated beyond what the code under
 * test reads back — an element remembers its `textContent` because the HUD
 * compares it, and remembers its children because `remove()` has to work.
 *
 * Used by `scripts/trace-ride-camera.mts`. Import it **before** anything from
 * `src/`.
 */

import './headless-canvas.mjs';

/** Every listener registered on `window`, by event type. */
const listeners = new Map();

class StubElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.id = '';
    this.style = new Proxy({}, { get: (o, k) => o[k] ?? '', set: (o, k, v) => ((o[k] = v), true) });
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.textContent = '';
    /** Recorded, not interpreted — see {@link StubElement.setAttribute}. */
    this.attributes = {};
  }

  /**
   * Remembered so a check can read back what the code under test declared.
   *
   * `ui/JourneyTitle.ts` sets `aria-label` and `role` on the title card, and an
   * element that throws on `setAttribute` cannot be constructed at all — which
   * would make the title the one piece of ride UI with no guard, for want of
   * two lines here.
   */
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
  }

  getAttribute(name) {
    return this.attributes[String(name)] ?? null;
  }

  get classList() {
    const names = () => String(this.className).split(/\s+/).filter(Boolean);
    return {
      contains: (name) => names().includes(name),
      add: (name) => {
        if (!names().includes(name)) this.className = [...names(), name].join(' ');
      },
      remove: (name) => {
        this.className = names().filter((n) => n !== name).join(' ');
      },
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  remove() {
    const siblings = this.parent?.children;
    if (!siblings) return;
    const at = siblings.indexOf(this);
    if (at >= 0) siblings.splice(at, 1);
    this.parent = null;
  }

  /** The ride measures taps against the canvas; a fixed box keeps them exact. */
  getBoundingClientRect() {
    return { left: 0, top: 0, width: viewport.width, height: viewport.height, right: viewport.width, bottom: viewport.height };
  }

  addEventListener() {}
  removeEventListener() {}
}

/** The size a tap is measured against — moved by {@link setViewport}. */
const viewport = { width: 1280, height: 720 };

/** Resize the notional screen. Taps are in these coordinates. */
export function setViewport(width, height) {
  viewport.width = width;
  viewport.height = height;
}

function findById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** Installs the richer DOM. Safe to call twice. */
export function installHeadlessDom() {
  if (globalThis.document?.__rideDom) return;

  const canvasFactory = globalThis.document.createElement;
  const head = new StubElement('head');
  const body = new StubElement('body');

  const document = {
    __rideDom: true,
    head,
    body,
    documentElement: new StubElement('html'),
    createElement(tag) {
      // The canvas keeps the 2D-context stub from `headless-canvas.mjs`: the art
      // code paints into it and this file has nothing better to offer.
      if (tag === 'canvas') return canvasFactory.call(this, tag);
      return new StubElement(tag);
    },
    createElementNS: () => new StubElement('svg'),
    getElementById: (id) => findById(head, id) ?? findById(body, id),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;

  globalThis.window = {
    document,
    devicePixelRatio: 1,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type);
      if (!bucket) return;
      const at = bucket.indexOf(listener);
      if (at >= 0) bucket.splice(at, 1);
    },
  };
  globalThis.navigator ??= { maxTouchPoints: 0, userAgent: 'node' };
  globalThis.localStorage ??= {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
}

/**
 * Fires an event at every `window` listener, oldest first — the order a browser
 * uses, and the order that decides whether the look control or the ride's tap
 * handler sees a press first.
 */
export function dispatch(type, event) {
  const bucket = listeners.get(type);
  if (!bucket) return;
  for (const listener of [...bucket]) listener({ type, preventDefault() {}, ...event });
}

/** A plain element to hang a HUD on. */
export function overlayElement() {
  return new StubElement('div');
}

installHeadlessDom();
