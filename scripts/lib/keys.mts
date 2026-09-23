import type { Page } from 'playwright-core';

/**
 * **Escape, pressed and released inside one frame — every time, not by luck.**
 *
 * Playwright's `keyboard.press` is keydown then keyup as two separate
 * round-trips, so whether both land between the same two frames is a race:
 * measured, it dropped the Escape on 6 of 10 seeds in one run and on 0 of 2 in
 * the next. That race *was* the flake (#699, #700). Dispatching both events in
 * one task makes it certain there is no frame between them, which is the exact
 * case `InputSystem` must not drop — so this is deterministic, and it is the
 * regression check for the fix rather than a coin toss over it.
 */
export async function tapEscapeWithinOneFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const type of ['keydown', 'keyup']) {
      window.dispatchEvent(new KeyboardEvent(type, { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    }
  });
}
