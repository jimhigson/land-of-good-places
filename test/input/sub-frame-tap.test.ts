import { describe, expect, it } from 'vitest';
import { InputSystem } from '../../src/core/input/InputSystem';

/**
 * **A key pressed and released between two frames is still a press.**
 *
 * `InputSystem` samples held keys once per `update()`. Before this fix, a key
 * that went down *and* up between two updates was never seen: no `isDown`, no
 * `justPressed`. On a device drawing 5-10 frames a second an ordinary quick
 * tap is shorter than a frame, so Escape, jump or the menu key could simply be
 * lost. In the browser it left the keychain view open (she stayed `riding`).
 * Found while investigating #699/#700: it is the likely (unreproduced) cause
 * of #700, and not the cause of #699, which was a tap landing on a tree.
 *
 * Real events through a real `EventTarget`, as `text-entry-guard.test.ts` does:
 * the listeners are the thing under test.
 */
class Target extends EventTarget {}

function key(target: Target, type: 'keydown' | 'keyup', code: string): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'repeat', { value: false });
  Object.defineProperty(event, 'target', { value: null });
  target.dispatchEvent(event);
}

function mouse(
  target: Target,
  type: 'mousedown' | 'mouseup',
  button: number,
  at = 0,
  firesTouchEvents?: boolean,
): void {
  const event = new Event(type);
  Object.defineProperty(event, 'button', { value: button });
  Object.defineProperty(event, 'timeStamp', { value: at });
  if (firesTouchEvents !== undefined) {
    Object.defineProperty(event, 'sourceCapabilities', { value: { firesTouchEvents } });
  }
  target.dispatchEvent(event);
}

function pointer(target: Target, pointerType: 'mouse' | 'touch' | 'pen', at: number): void {
  const event = new Event('pointerdown');
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'timeStamp', { value: at });
  target.dispatchEvent(event);
}

function touch(target: Target, type: 'touchstart' | 'touchend', at: number): void {
  const event = new Event(type);
  Object.defineProperty(event, 'timeStamp', { value: at });
  target.dispatchEvent(event);
}

function fresh(): { input: InputSystem; target: Target } {
  const target = new Target();
  const input = new InputSystem();
  input.attach(target as unknown as Window);
  input.update();
  return { input, target };
}

describe('a press shorter than one frame', () => {
  it('Escape down-and-up between two updates is a menu press, for exactly one frame', () => {
    const { input, target } = fresh();
    key(target, 'keydown', 'Escape');
    key(target, 'keyup', 'Escape');
    input.update();
    expect(input.justPressed('menu')).toBe(true);
    input.update();
    expect(input.justPressed('menu')).toBe(false);
    expect(input.isDown('menu')).toBe(false);
  });

  it('a jump tapped between frames still hops', () => {
    const { input, target } = fresh();
    key(target, 'keydown', 'Space');
    key(target, 'keyup', 'Space');
    input.update();
    expect(input.justPressed('jump')).toBe(true);
  });

  it('a held key behaves exactly as before: down every frame, pressed only on the first', () => {
    const { input, target } = fresh();
    key(target, 'keydown', 'Escape');
    input.update();
    expect(input.justPressed('menu')).toBe(true);
    input.update();
    expect(input.justPressed('menu')).toBe(false);
    expect(input.isDown('menu')).toBe(true);
    key(target, 'keyup', 'Escape');
    input.update();
    expect(input.isDown('menu')).toBe(false);
  });

  it('a tap pending when the window loses focus is dropped, not fired later', () => {
    const { input, target } = fresh();
    key(target, 'keydown', 'Escape');
    key(target, 'keyup', 'Escape');
    target.dispatchEvent(new Event('blur'));
    input.update();
    expect(input.justPressed('menu')).toBe(false);
  });

  it('a mouse click shorter than a frame reaches its bound action', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    mouse(target, 'mousedown', 2);
    mouse(target, 'mouseup', 2);
    input.update();
    expect(input.isDown('duck')).toBe(true);
    input.update();
    expect(input.isDown('duck')).toBe(false);
  });
});

/**
 * **A finger is not a mouse.** A touch tap is followed by the browser's
 * compatibility mousedown/mouseup in one task; once sub-frame clicks started
 * counting, every tablet tap would have pressed button 0. A mouse press counts
 * only if the `pointerdown` before it was a mouse.
 *
 * With the guard in `onMouseDown` removed, the first two cases go red. The last
 * case went red against the previous, time-window guard (a real right-button
 * hold within a second of a touch was swallowed on a touchscreen laptop).
 */
describe("a touch's compatibility mouse events", () => {
  it('a mouse click echoing a touch presses nothing', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    pointer(target, 'touch', 5000);
    mouse(target, 'mousedown', 2, 5081);
    mouse(target, 'mouseup', 2, 5081);
    input.update();
    expect(input.isDown('duck')).toBe(false);
  });

  it('a pen is not a mouse either', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    pointer(target, 'pen', 9000);
    mouse(target, 'mousedown', 2, 9000);
    mouse(target, 'mouseup', 2, 9000);
    input.update();
    expect(input.isDown('duck')).toBe(false);
  });

  it('a real mouse click counts', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    pointer(target, 'mouse', 3000);
    mouse(target, 'mousedown', 2, 3000);
    mouse(target, 'mouseup', 2, 3000);
    input.update();
    expect(input.isDown('duck')).toBe(true);
  });

  it('with no pointer events at all, a mouse is a mouse (the behaviour before the guard)', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    mouse(target, 'mousedown', 2, 100);
    input.update();
    expect(input.isDown('duck')).toBe(true);
  });

  it('a touchscreen laptop: a real mouse held within a second of a touch still ducks', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    pointer(target, 'touch', 1000);
    touch(target, 'touchstart', 1000);
    touch(target, 'touchend', 1080);
    // Then her hand goes to the mouse and holds the right button.
    pointer(target, 'mouse', 1500);
    mouse(target, 'mousedown', 2, 1500, false);
    input.update();
    expect(input.isDown('duck')).toBe(true);
    input.update();
    expect(input.isDown('duck')).toBe(true);
  });
});
