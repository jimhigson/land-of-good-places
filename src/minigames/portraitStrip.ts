import { hexToCss } from '../core/palette';
import { ART } from '../art/style/artPalette';
import { paintExpressions, type Expression } from '../art/style/faces';

/**
 * A row of little flat head portraits — the framework-shared half of what the
 * water fight built for its "replace the pop-up messages with faces at the
 * edge of the HUD" fix (GAME_DESIGN, 27 July 2026).
 *
 * **Why this lives at `minigames/`, not inside `waterFight/`.** The dodgems
 * are getting the same treatment next (labels over the cars covering too much
 * of the play area, replaced with mood shown on a portrait, no text for an
 * apple bonk). Rather than that PR copying the water fight's version or
 * reaching into its folder, the reusable part — build a little painted head,
 * lay it in a row, swap its expression — lives here where any mini-game can
 * import it. What is water-fight-specific (the drippy wet overlay, the
 * splash/score timing) stays in `waterFight/portraits.ts`, which uses this
 * module rather than duplicating it. A future dodgems module would do the
 * same: call `createPortraitStrip` for the row of heads, then layer its own
 * bonk reaction on top the same way.
 *
 * **Cheap on purpose.** A portrait is not a second camera on a character — it
 * is the exact trick `art/style/faces.ts` already uses for the 3D heads
 * ("faces are PAINTED, not built"), pointed at a small flat canvas instead of
 * a curved patch: `paintExpressions` draws the whole five-expression set once,
 * transparent, and this module lays each one over a skin-tone disc with a
 * hair-colour fringe band. Nothing is repainted after that — swapping the
 * visible expression is a `drawImage` of an already-painted canvas, the same
 * "swap the texture" idea `setExpression` is everywhere else in this game.
 */

const PORTRAIT_SIZE = 128;

/** How far down the portrait the hair fringe reaches (fraction of the canvas). */
const FRINGE_DEPTH = 0.32;

export interface PortraitInfo {
  readonly name: string;
  /** Hair colour, painted as a flat fringe band across the top of the portrait. */
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
  dispose(): void;
}

/** One `paintExpressions` call, composited over a skin disc and a hair fringe. */
function buildPortraitCanvases(info: PortraitInfo): Record<Expression, HTMLCanvasElement> {
  const s = PORTRAIT_SIZE;
  const faces = paintExpressions({
    size: s,
    iris: info.eye ?? ART.kidEye,
    blush: ART.blush,
  });

  const result = {} as Record<Expression, HTMLCanvasElement>;
  for (const [name, texture] of Object.entries(faces) as [Expression, { image: unknown; dispose(): void }][]) {
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Portrait strip: 2D canvas context unavailable.');

    // Skin disc and hair fringe, both clipped to the circle so neither needs
    // to be a careful shape of its own — the circle does that job for free.
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = hexToCss(info.skin ?? ART.kidSkin);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = hexToCss(info.hair);
    ctx.fillRect(0, 0, s, s * FRINGE_DEPTH);
    ctx.restore();

    // The face itself, painted transparent and laid straight on top — the
    // same texture a 3D character's head would wear, just smaller and flat.
    ctx.drawImage(texture.image as HTMLCanvasElement, 0, 0, s, s);
    result[name] = canvas;
  }
  // The source textures were only ever needed for their canvases.
  for (const texture of Object.values(faces)) texture.dispose();

  return result;
}

interface Entry extends PortraitStripEntry {
  readonly canvases: Record<Expression, HTMLCanvasElement>;
  readonly faceElement: HTMLCanvasElement;
}

/**
 * Builds a ready-to-show row of portraits and appends it to `container`.
 *
 * Order is significant and is not re-derived: entry `i` in the returned strip
 * always corresponds to `portraits[i]`, so a caller with its own indexed list
 * of characters (fighters, drivers, whatever this game calls them) can use
 * the same index into both without keeping a lookup around.
 */
export function createPortraitStrip(
  container: HTMLElement,
  portraits: readonly PortraitInfo[],
): PortraitStrip {
  const row = document.createElement('div');
  row.className = 'mg-portrait-row';

  const entries: Entry[] = portraits.map((info) => {
    // Two levels: `.mg-portrait-item` lays the name out below without
    // clipping it, and `.mg-portrait` is the circular, `overflow: hidden`
    // part that holds the face (and, for callers who want one, an overlay).
    const item = document.createElement('div');
    item.className = 'mg-portrait-item';
    if (info.isPlayer) item.dataset.you = 'true';

    const circle = document.createElement('div');
    circle.className = 'mg-portrait';
    circle.style.setProperty('--mg-portrait-accent', hexToCss(info.accent));

    const canvases = buildPortraitCanvases(info);

    const faceElement = document.createElement('canvas');
    faceElement.className = 'mg-portrait-face';
    faceElement.width = PORTRAIT_SIZE;
    faceElement.height = PORTRAIT_SIZE;
    faceElement.getContext('2d')?.drawImage(canvases.neutral, 0, 0);
    circle.append(faceElement);

    const label = document.createElement('div');
    label.className = 'mg-portrait-name';
    label.textContent = info.isPlayer ? 'You' : info.name;

    item.append(circle, label);
    row.append(item);

    return { circle, canvases, faceElement };
  });

  container.append(row);

  return {
    entries,

    setExpression(index: number, expression: Expression): void {
      const entry = entries[index];
      if (!entry) return;
      const ctx = entry.faceElement.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
      ctx.drawImage(entry.canvases[expression], 0, 0);
    },

    dispose(): void {
      row.remove();
    },
  };
}
