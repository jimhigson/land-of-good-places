import { hexToCss } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { paintExpressions, type Expression } from '../art/style/faces';

/**
 * Little flat head portraits, docked along the edges of a mini-game's HUD —
 * the framework-shared half of the "replace the pop-up messages with faces at
 * the edge" fix (GAME_DESIGN, 27 July 2026).
 *
 * **Why this lives at `minigames/`, not inside `waterFight/`.** The water
 * fight built it first; the dodgems now use the same thing, for the same
 * reason (labels over the cars covering too much of the rink). Rather than the
 * second game copying the first's version, the reusable part — build a little
 * painted head, lay it out, swap its expression, bounce it — lives here where
 * any mini-game can import it. What is game-specific stays in that game's own
 * module: `waterFight/portraits.ts` adds the drippy wet overlay, and the
 * dodgems drive expressions straight off each car's `surprise` timer.
 *
 * **Where they sit, and why it is two banks (28 July 2026 feedback).** The
 * family: *"put the icons down the left and right sides too (half on each
 * side) when in landscape and top/bottom when in portrait"*. So the strip is
 * always **two banks with the list split down the middle**, and only their
 * placement changes: a column down each side in landscape, a row along the top
 * and bottom in portrait. Because the split is the same either way, the swap
 * is **pure CSS** — one `@media (orientation: portrait)` block — so it happens
 * live when a phone is turned, with no JavaScript to forget to re-run and no
 * resize handler to leak. Turning the phone mid-fight rearranges the heads
 * before the frame is out.
 *
 * (This supersedes the earlier note in `style.css` arguing for a single row
 * along the top edge. The family asked for the edges; the family wins.)
 *
 * **Cheap on purpose — and cheaper than it was.** A portrait is not a second
 * camera on a character: it is the trick `art/style/faces.ts` already uses for
 * the 3D heads ("faces are PAINTED, not built"), pointed at a small flat
 * canvas. What changed is *how many* canvases that takes. It used to paint the
 * five-expression set **per character** and then composite five more canvases
 * per character to lay each one over a skin disc and a hair fringe — sixty
 * canvases for a six-child water fight, against a game-wide budget of about
 * forty (ART_DIRECTION.md §7), before the dodgems asked for a set of their
 * own. Now:
 *
 * - the five expressions are painted **once**, cached here, and shared by
 *   every portrait in every mini-game for the life of the page;
 * - each is kept as a data URL, so the browser decodes one image per
 *   expression however many faces are showing;
 * - the skin tone and hair fringe are a **CSS gradient** on the circle rather
 *   than pixels — they were only ever two flat colours clipped to a circle,
 *   which is precisely what a gradient stop is.
 *
 * That is **five canvases in total**, not five per character per game, and it
 * is what let the portraits get bigger without costing anything.
 */

/**
 * Pixel size of the shared expression images.
 *
 * Comfortably above the biggest a portrait is ever drawn (4.25rem, so 162 CSS
 * px on the largest monitor the root clamp goes to). Affordable now that there
 * are five of these in the whole game rather than five per character.
 */
const PORTRAIT_SIZE = 192;

/** How far down the portrait the hair fringe reaches (fraction of the circle). */
const FRINGE_DEPTH = 0.32;

/** How long the attention bounce runs, matching `mg-portrait-pop` in style.css. */
const POP_MS = 340;

export interface PortraitInfo {
  readonly name: string;
  /** Hair colour, drawn as a flat fringe band across the top of the portrait. */
  readonly hair: number;
  /** The ring round the portrait — pick whatever colour already tells this
   * character apart in the game (a gun, a car, an outfit). */
  readonly accent: number;
  readonly isPlayer: boolean;
  /** Defaults to the shared kid skin tone (`ART.kidSkin`). */
  readonly skin?: number;
  /** Iris colour behind the pupil. Defaults to `ART.kidEye`. */
  readonly eye?: number;
}

export interface PortraitStripEntry {
  /** The circular, `overflow: hidden` element — parent a custom overlay (a
   * wet effect, a dizzy-stars sticker, whatever this game's reaction is) here
   * so it clips to the same circle the face does. */
  readonly circle: HTMLElement;
}

export interface PortraitStrip {
  readonly entries: readonly PortraitStripEntry[];
  /** Swaps which pre-painted expression is showing. Instant — no fade. */
  setExpression(index: number, expression: Expression): void;
  /**
   * The little "something just happened to me" bounce.
   *
   * Retriggers cleanly if this portrait is already mid-bounce, so two quick
   * hits read as two moments rather than one stretched one. Every mini-game
   * gets this from here rather than poking the data attribute itself — that
   * restart dance is exactly the sort of three-line detail that goes subtly
   * wrong in the second copy.
   */
  pop(index: number): void;
  dispose(): void;
}

/**
 * The five expression images, painted once and shared by every portrait.
 *
 * Keyed by iris colour, which is the only thing about the painted face that
 * varies between characters — skin and hair are drawn by CSS underneath.
 * Never evicted: there is one entry in practice, it is a few hundred
 * kilobytes, and a mini-game that reopens should not repaint anything.
 */
const faceSets = new Map<number, Readonly<Record<Expression, string>>>();

function faceSetFor(iris: number): Readonly<Record<Expression, string>> {
  const cached = faceSets.get(iris);
  if (cached) return cached;

  const painted = paintExpressions({ size: PORTRAIT_SIZE, iris, blush: ART.blush });
  const urls = {} as Record<Expression, string>;
  for (const [name, texture] of Object.entries(painted) as [Expression, { image: unknown }][]) {
    urls[name] = (texture.image as HTMLCanvasElement).toDataURL();
  }
  // The textures were only ever wanted for the canvases they painted.
  for (const texture of Object.values(painted)) texture.dispose();

  faceSets.set(iris, urls);
  return urls;
}

interface Entry extends PortraitStripEntry {
  readonly faces: Readonly<Record<Expression, string>>;
  readonly faceElement: HTMLElement;
  /** Cleared and re-set to restart the bounce; held so `dispose` can cancel it. */
  popHandle: number;
}

/**
 * Builds a ready-to-show set of portraits and appends it to `container`.
 *
 * Order is significant and is not re-derived: entry `i` in the returned strip
 * always corresponds to `portraits[i]`, so a caller with its own indexed list
 * of characters (fighters, drivers, whatever this game calls them) can use the
 * same index into both without keeping a lookup around. The list is split down
 * the middle between the two banks in that same order, so who ends up on which
 * side is stable from one ride to the next.
 */
export function createPortraitStrip(
  container: HTMLElement,
  portraits: readonly PortraitInfo[],
): PortraitStrip {
  const strip = document.createElement('div');
  strip.className = 'mg-portrait-strip';

  // Half on each side. The first bank takes the larger half of an odd list, so
  // with five drivers it is 3 + 2 rather than 2 + 3 — the same way up as the
  // reading order.
  const split = Math.ceil(portraits.length / 2);
  const banks = [document.createElement('div'), document.createElement('div')];
  for (const bank of banks) bank.className = 'mg-portrait-bank';

  const entries: Entry[] = portraits.map((info, index) => {
    // Two levels: `.mg-portrait-item` lays the name out beside (landscape) or
    // below (portrait) without clipping it, and `.mg-portrait` is the
    // circular, `overflow: hidden` part that holds the face — and, for callers
    // who want one, an overlay.
    const item = document.createElement('div');
    item.className = 'mg-portrait-item';
    if (info.isPlayer) item.dataset.you = 'true';

    const circle = document.createElement('div');
    circle.className = 'mg-portrait';
    circle.style.setProperty('--mg-portrait-accent', hexToCss(info.accent));
    // Skin and hair, as two stops of one gradient rather than two fills on a
    // canvas of their own. The circle's own `border-radius` does the clipping
    // that `ctx.clip()` used to.
    circle.style.setProperty('--mg-portrait-skin', hexToCss(info.skin ?? ART.kidSkin));
    circle.style.setProperty('--mg-portrait-hair', hexToCss(info.hair));
    circle.style.setProperty('--mg-portrait-fringe', `${(FRINGE_DEPTH * 100).toFixed(1)}%`);

    const faces = faceSetFor(info.eye ?? ART.kidEye);

    const faceElement = document.createElement('div');
    faceElement.className = 'mg-portrait-face';
    faceElement.style.backgroundImage = `url(${faces.neutral})`;
    circle.append(faceElement);

    const label = document.createElement('div');
    label.className = 'mg-portrait-name';
    label.textContent = info.isPlayer ? 'You' : info.name;

    item.append(circle, label);
    (banks[index < split ? 0 : 1] ?? banks[0])?.append(item);

    return { circle, faces, faceElement, popHandle: 0 };
  });

  strip.append(banks[0] as Node, banks[1] as Node);
  container.append(strip);

  return {
    entries,

    setExpression(index: number, expression: Expression): void {
      const entry = entries[index];
      if (!entry) return;
      entry.faceElement.style.backgroundImage = `url(${entry.faces[expression]})`;
    },

    pop(index: number): void {
      const entry = entries[index];
      if (!entry) return;
      // A CSS animation only restarts when the attribute genuinely changes, so
      // it is cleared and re-set on the next frame.
      window.clearTimeout(entry.popHandle);
      entry.circle.dataset.pop = 'false';
      requestAnimationFrame(() => {
        entry.circle.dataset.pop = 'true';
      });
      entry.popHandle = window.setTimeout(() => {
        entry.circle.dataset.pop = 'false';
      }, POP_MS);
    },

    dispose(): void {
      for (const entry of entries) window.clearTimeout(entry.popHandle);
      strip.remove();
    },
  };
}
