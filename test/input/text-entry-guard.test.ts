import { describe, expect, it } from 'vitest';
import { InputSystem, isTextEntryTarget } from '../../src/core/input/InputSystem';

/**
 * Issue #189: a text field rendered over the running game used to lose every
 * key bound to a game action — `w a s d e f i p`, `Space` and `Backspace` —
 * because `InputSystem` listens on `window` for the whole session and
 * `preventDefault`s anything bound, with no check on where the keystroke was
 * going. A child called Wren could not type her own name into the "Look"
 * pill's character creator, and could not delete a character either.
 *
 * **These tests dispatch real events through a real `EventTarget`**, rather
 * than setting `input.value` directly. That distinction is the whole point:
 * the end-to-end test that was supposed to cover this typed with Playwright's
 * `fill()`, which assigns `.value` and dispatches only an `input` event — it
 * never produces a `keydown` at all, so `preventDefault` was never reached and
 * the bug was invisible to it. A test that cannot observe `defaultPrevented`
 * cannot catch this class of bug.
 */

/** The keys a name like "Wren", "Sadie" or "Pip" actually needs. */
const TYPEABLE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyI', 'KeyP', 'Space', 'Backspace'];

/**
 * A stand-in for the DOM node a keystroke lands on.
 *
 * A real `EventTarget` — so `dispatchEvent` genuinely runs the listener and
 * `preventDefault`/`defaultPrevented` behave exactly as the browser's do —
 * carrying just the two properties the guard reads. There is no jsdom in this
 * project, and adding one for this would be a heavier dependency than the
 * behaviour under test justifies; duck-typing the guard is independently the
 * right call anyway, since `instanceof HTMLInputElement` answers "no" for a
 * field inside an iframe.
 */
class FakeNode extends EventTarget {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {
    super();
  }
}

/** Dispatches a real, cancelable keydown from `node` and reports what happened. */
function pressFrom(node: FakeNode, code: string): { prevented: boolean } {
  const event = new Event('keydown', { cancelable: true, bubbles: true });
  // `code` is what `InputSystem` reads; a real `KeyboardEvent` would carry it.
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'repeat', { value: false });
  node.dispatchEvent(event);
  return { prevented: event.defaultPrevented };
}

describe('isTextEntryTarget', () => {
  it('claims keystrokes for text-entry elements', () => {
    expect(isTextEntryTarget(new FakeNode('INPUT'))).toBe(true);
    expect(isTextEntryTarget(new FakeNode('TEXTAREA'))).toBe(true);
    expect(isTextEntryTarget(new FakeNode('SELECT'))).toBe(true);
    expect(isTextEntryTarget(new FakeNode('DIV', true))).toBe(true);
  });

  it('leaves ordinary page elements to the game', () => {
    expect(isTextEntryTarget(new FakeNode('DIV'))).toBe(false);
    expect(isTextEntryTarget(new FakeNode('BUTTON'))).toBe(false);
    expect(isTextEntryTarget(new FakeNode('CANVAS'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('InputSystem over a text field (issue #189)', () => {
  it('lets every name-typing key through to the field', () => {
    const input = new FakeNode('INPUT');
    const system = new InputSystem();
    system.attach(input as unknown as Window);

    for (const code of TYPEABLE_CODES) {
      const { prevented } = pressFrom(input, code);
      expect(prevented, `${code} must reach the text field`).toBe(false);
    }

    system.detach(input as unknown as Window);
  });

  it('does not walk the player while she types', () => {
    const input = new FakeNode('INPUT');
    const system = new InputSystem();
    system.attach(input as unknown as Window);

    // Typing "Wren" — the W alone is bound to "walk forward". Deliberately not
    // "wasd": those four are opposite pairs that sum to a standstill, so an
    // unguarded `InputSystem` would pass that and prove nothing.
    for (const code of ['KeyW', 'KeyR', 'KeyE', 'KeyN']) pressFrom(input, code);
    system.update();

    expect(system.moveAmount, 'typing must not produce movement').toBe(0);
    expect(system.moveX).toBe(0);
    expect(system.moveY).toBe(0);

    system.detach(input as unknown as Window);
  });

  it('still claims those keys for the game when nothing is being typed into', () => {
    const canvas = new FakeNode('CANVAS');
    const system = new InputSystem();
    system.attach(canvas as unknown as Window);

    // The guard must not have simply disarmed the game's keyboard: the same
    // presses, from the park itself, are still the game's to consume.
    for (const code of TYPEABLE_CODES) {
      const { prevented } = pressFrom(canvas, code);
      expect(prevented, `${code} is still a game binding`).toBe(true);
    }

    system.detach(canvas as unknown as Window);
  });

  it('still walks the player when the key comes from the park', () => {
    const canvas = new FakeNode('CANVAS');
    const system = new InputSystem();
    system.attach(canvas as unknown as Window);

    // One key, not the whole set: W and S are opposite axes, as are A and D,
    // so holding all four sums to a standstill and would prove nothing.
    pressFrom(canvas, 'KeyW');
    system.update();

    expect(system.moveAmount, 'W from the park still walks her forward').toBeGreaterThan(0);
    expect(system.moveY).toBeGreaterThan(0);

    system.detach(canvas as unknown as Window);
  });
});
