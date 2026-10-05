import type { Page } from 'playwright-core';

/**
 * **Escape, pressed and released inside one frame — every time, not by luck.**
 *
 * Playwright's `keyboard.press` is keydown then keyup as two separate
 * round-trips, so whether both land between the same two frames depends on
 * timing. One probe saw it drop the Escape on several seeds; a reviewer's
 * re-measurement saw 0 drops in 5. Either way it is a coin toss over the case
 * that matters. Dispatching both events in one task makes it certain there is
 * no frame between them — the exact case `InputSystem` once dropped — so the
 * keychain-view steps in `check:walking` and `check:deep-links` are a
 * deterministic regression check for that fix.
 *
 * This is not what made #699 flaky (that was the tap spot landing on a tree);
 * it is the likely, unreproduced, cause of #700.
 */
export async function tapEscapeWithinOneFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const type of ['keydown', 'keyup']) {
      window.dispatchEvent(new KeyboardEvent(type, { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    }
  });
}
