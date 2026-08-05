import { beforeEach, describe, expect, it } from 'vitest';
import { OverlayPause } from '../../src/core/overlayPause';
import { gameStore } from '../../src/state';

/**
 * The round-2 defect, which took a whole review round to find and had no test
 * at all until this one.
 *
 * The "Look" pill's character creator froze the park with a `setPaused(true)`
 * on open and a restore on completion. Because the creator is not in
 * `Game.tick`'s "who owns Escape" chain and has no close button, Escape fell
 * through to the ordinary pause toggle and **unpaused the park behind the
 * still-open dialog** — from where the player could walk off or board a ride
 * mid-dialog, and where `/view`'s deliberately-frozen park never got re-frozen.
 *
 * The fix was not to special-case Escape but to re-derive the pause every
 * frame, so these tests are written against *that* property rather than
 * against the key that exposed it: something else changes `paused`, and the
 * next `sync` must put it back. A test that only pressed Escape would pass
 * against a version that special-cased Escape and nothing else.
 */

/** Stands in for a frame of `Game.tick` calling `syncLookPaused`. */
function tick(pause: OverlayPause, overlayOpen: boolean): void {
  pause.sync(overlayOpen);
}

/** Whatever else in the game flips the pause flag — Escape, a debug camera. */
function somethingElseSetsPaused(value: boolean): void {
  gameStore.setPaused(value);
}

describe('OverlayPause', () => {
  beforeEach(() => {
    gameStore.setPaused(false);
  });

  it('freezes the park while the overlay owns the screen', () => {
    const pause = new OverlayPause();

    tick(pause, true);

    expect(gameStore.get().paused).toBe(true);
    expect(pause.holdingPause).toBe(true);
  });

  /**
   * THE regression test for the round-2 bug. Fails against the one-shot
   * `setPaused(true)`-on-open version, which had nothing to put the pause back.
   */
  it('puts the pause back when something else unpauses behind the overlay', () => {
    const pause = new OverlayPause();
    tick(pause, true);

    // Escape, in the shipped bug. Anything that reaches `setPaused`, in general.
    somethingElseSetsPaused(false);
    expect(gameStore.get().paused, 'precondition: it really did get unpaused').toBe(false);

    // The very next frame.
    tick(pause, true);

    expect(gameStore.get().paused, 'an open overlay must win the argument').toBe(true);
  });

  it('keeps putting it back, however many times it is fought', () => {
    const pause = new OverlayPause();
    tick(pause, true);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      somethingElseSetsPaused(false);
      tick(pause, true);
      expect(gameStore.get().paused).toBe(true);
    }
  });

  it('lets the park go again once the overlay closes', () => {
    const pause = new OverlayPause();
    tick(pause, true);

    tick(pause, false);

    expect(gameStore.get().paused).toBe(false);
    expect(pause.holdingPause).toBe(false);
  });

  /**
   * `/view` freezes the park deliberately. The overlay must not adopt that
   * pause on the way in, or hand it back on the way out.
   */
  it('never unpauses a park it did not pause', () => {
    somethingElseSetsPaused(true);
    const pause = new OverlayPause();

    tick(pause, true);
    expect(pause.holdingPause, 'the pause was already someone else’s').toBe(false);

    tick(pause, false);
    expect(gameStore.get().paused, 'a deliberately frozen park stays frozen').toBe(true);
  });

  it('does not fight a park that a grown-up paused mid-dialog', () => {
    const pause = new OverlayPause();
    tick(pause, true);
    expect(pause.holdingPause).toBe(true);

    // Closing hands back exactly one pause, not more.
    tick(pause, false);
    somethingElseSetsPaused(true);
    tick(pause, false);

    expect(gameStore.get().paused, 'closing twice must not steal a later pause').toBe(true);
  });
});
