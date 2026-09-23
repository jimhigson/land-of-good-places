import { describe, expect, it } from 'vitest';
import { InputSystem } from '../../src/core/input/InputSystem';

/**
 * **A key pressed and released between two frames is still a press** (#699,
 * #700).
 *
 * `InputSystem` samples held keys once per `update()`. Before this fix, a key
 * that went down *and* up between two updates was never seen: no `isDown`, no
 * `justPressed`. On a device drawing 5-10 frames a second an ordinary quick
 * tap is shorter than a frame, so Escape, jump or the menu key could simply be
 * lost. In the browser it left the keychain view open (she stayed `riding`),
 * which is what made `check:walking` and `check:deep-links` flaky.
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

function mouse(target: Target, type: 'mousedown' | 'mouseup', button: number): void {
  const event = new Event(type);
  Object.defineProperty(event, 'button', { value: button });
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
