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
 * counting, every tablet tap would have pressed button 0. With the guard in
 * `onMouseDown` removed, the first two cases go red; the third is the control
 * that the guard does not swallow a real mouse.
 */
describe("a touch's compatibility mouse events", () => {
  it('a mouse click echoing a touch presses nothing', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    touch(target, 'touchstart', 5000);
    touch(target, 'touchend', 5080);
    mouse(target, 'mousedown', 2, 5081);
    mouse(target, 'mouseup', 2, 5081);
    input.update();
    expect(input.isDown('duck')).toBe(false);
  });

  it('Chromium saying the click came from touch is believed, with no touch event seen', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    mouse(target, 'mousedown', 2, 9000, true);
    mouse(target, 'mouseup', 2, 9000, true);
    input.update();
    expect(input.isDown('duck')).toBe(false);
  });

  it('a real mouse a while after a touch still works', () => {
    const { input, target } = fresh();
    input.setMouseCaptureActive(true);
    touch(target, 'touchend', 1000);
    mouse(target, 'mousedown', 2, 3000, false);
    mouse(target, 'mouseup', 2, 3000, false);
    input.update();
    expect(input.isDown('duck')).toBe(true);
  });
});
