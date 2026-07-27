/**
 * The one root scale of the whole UI — the TypeScript half of GAME_DESIGN.md's
 * TEXT RULE.
 *
 * The rule has two halves: a generous minimum font size everywhere, and a UI
 * that scales with the screen. Both come from a single number, and that number
 * is defined **once**, in `src/style.css`:
 *
 * ```css
 * html { font-size: clamp(20px, 0.62vw + 0.55vh + 8px, 38px); }
 * ```
 *
 * `1rem` is simultaneously the minimum text size (`--lgp-text-min`) and the
 * unit every other size in that file is a multiple of.
 *
 * Canvas-painted text — name pills, speech bubbles, the park map, in-world
 * signs — cannot use `rem`, so it reads that same computed value back out of
 * the document instead of keeping a second copy of the formula. There is
 * therefore still exactly one definition of "how big is the UI right now" in
 * the game, and a change to the CSS moves the canvas text with it.
 *
 * {@link FALLBACK_UNIT_PX} is only used before/outside a document (tests, a
 * worker); it is the floor, so text is never accidentally *smaller* than the
 * minimum when the real value is unavailable.
 */

/** The floor of the clamp in style.css. Also the fallback outside a document. */
export const FALLBACK_UNIT_PX = 20;

let cached: number | null = null;

/**
 * One "UI unit" in CSS pixels: the computed root font size, i.e. `1rem`.
 *
 * This is *also* the minimum readable text size — see {@link minTextPx} — so
 * canvas text is written as `minTextPx()` for body-sized text and multiples of
 * {@link uiUnitPx} for anything larger, exactly as the stylesheet does.
 *
 * Cached, because it is read every frame by the screen-constant sprites; the
 * cache is dropped on resize (and on a zoom change, which fires `resize` too).
 */
export function uiUnitPx(): number {
  if (cached !== null) return cached;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK_UNIT_PX;
  }
  const computed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  cached = Number.isFinite(computed) && computed > 0 ? computed : FALLBACK_UNIT_PX;
  return cached;
}

/**
 * The minimum size, in CSS pixels, that any text in the game may be drawn at —
 * canvas or DOM. Identical to {@link uiUnitPx} by construction: the root scale
 * *is* the floor.
 */
export function minTextPx(): number {
  return uiUnitPx();
}

/**
 * How much bigger the UI currently is than at its smallest (1 on a phone,
 * up to 1.9 on a very large monitor). For sizes that are naturally expressed
 * as "the old pixel number, but scaled".
 */
export function uiScale(): number {
  return uiUnitPx() / FALLBACK_UNIT_PX;
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    cached = null;
  });
  window.addEventListener('orientationchange', () => {
    cached = null;
  });
}
