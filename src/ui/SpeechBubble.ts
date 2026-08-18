import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from 'three';
import type { IsoCamera } from '../core/IsoCamera';
import { hexToCss, PALETTE } from '../core/palette';
import { minTextPx } from '../core/uiScale';

/**
 * The little speech bubble a chatting child gets over their head (see
 * GAME_DESIGN.md, "Chatting (27 July 2026)", and the chat block in
 * `entities/npc/wanderDriver.ts`).
 *
 * Deliberately built the same way as `NameLabel` — a screen-constant sprite
 * with a canvas texture — rather than sharing that class outright, because a
 * bubble needs a rebuilt-every-line canvas sized for wrapped text and a
 * little tail pointing down at the speaker, neither of which a name pill
 * needs. Same look and feel (rounded pill, soft ink text, a coloured rim), so
 * it reads as the same game rather than a second UI idiom.
 *
 * **Screen-space clamped** (QA on #280, PR #280 round 2): a bubble pinned in
 * world space near its speaker can, on a narrow enough screen, project
 * partly or wholly off the visible frustum — the receptionist's own greeting
 * did exactly this on a 390×844 portrait phone, clipped and unreadable. Every
 * caller still hands {@link updateScreenSize} the sprite's natural,
 * unclamped world anchor (via `sprite.position`, same as before this fix);
 * the clamp is applied on top, every call, via `IsoCamera.clampToFrustum` —
 * see that method's own doc for why the camera owns the screen axes rather
 * than this class reconstructing them.
 */

/** Beyond this many metres from the camera a bubble is not worth drawing. */
const BUBBLE_MAX_DISTANCE = 40;

const CANVAS_WIDTH = 512;
/** Font size the line is painted at inside the canvas. The bubble is then
 *  scaled on screen so this lands on the TEXT RULE's minimum — see
 *  {@link SpeechBubble.updateScreenSize}. */
const FONT_PX = 44;
const FONT = `bold ${FONT_PX}px "Trebuchet MS", "Segoe UI", sans-serif`;
const PADDING_X = 40;
const LINE_HEIGHT = 54;
const TAIL_HEIGHT = 28;

/** Screen-space breathing room the clamp leaves past a bubble's own edge —
 *  a phone's bezel/safe-area inset, not just the mathematical frustum edge. */
const EDGE_MARGIN_PX = 12;

// Scratch for `getWorldPosition` in `updateScreenSize` — read immediately,
// never stored, so safe to share across every bubble's own call.
const SCRATCH_ANCHOR = new Vector3();

export class SpeechBubble {
  readonly sprite: Sprite;

  private texture: CanvasTexture | null = null;
  private readonly material: SpriteMaterial;
  private aspect = 512 / 220;
  /** Canvas height of the current bubble: a one-line bubble is shorter than a
   *  two-line one, and the on-screen size is derived from it so the *text*
   *  ends up the same size either way. */
  private canvasHeight = 220;
  private currentText: string | null = null;

  private readonly accent: number;

  constructor(accent: number = PALETTE.markerSky) {
    this.accent = accent;
    this.material = new SpriteMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.name = 'speech-bubble';
    this.sprite.renderOrder = 11;
    this.sprite.visible = false;
  }

  /** `null` hides the bubble. Rebuilds the texture only when the text changes. */
  setText(text: string | null): void {
    if (text === this.currentText) return;
    this.currentText = text;

    if (!text) {
      this.sprite.visible = false;
      return;
    }

    const previous = this.texture;
    this.texture = drawBubble(text, this.accent);
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    this.canvasHeight = this.texture.image.height;
    this.aspect = this.texture.image.width / this.canvasHeight;
    previous?.dispose();
    // `updateScreenSize` sets real visibility/size next frame; this just
    // keeps it from flashing at whatever scale it last had.
    this.sprite.visible = true;
  }

  /**
   * Same screen-constant-size trick as `NameLabel.updateScreenSize`, and the
   * same TEXT RULE arithmetic: the bubble is drawn on screen at whatever
   * height makes its {@link FONT_PX} line land exactly on `minTextPx()`. It
   * used to be a flat 30px tall for the *whole* canvas, which left the words
   * themselves around 10px — the smallest text in the game.
   *
   * `camera` is also where the bubble gets clamped onto the visible screen —
   * see the class doc and `IsoCamera.clampToFrustum`. The caller sets
   * `sprite.position` to the bubble's natural, unclamped world anchor (as
   * before this fix) immediately before calling this; the clamp is worked
   * out fresh from that anchor every call, so there is no drift from
   * clamping an already-clamped position on the next frame.
   */
  updateScreenSize(camera: IsoCamera): void {
    if (!this.currentText) return;
    const anchor = this.sprite.getWorldPosition(SCRATCH_ANCHOR);
    const distanceToCamera = anchor.distanceTo(camera.focusPoint);
    if (distanceToCamera > BUBBLE_MAX_DISTANCE) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    const worldUnitsPerPixel = camera.worldUnitsPerPixel;
    const height = worldUnitsPerPixel * this.canvasHeight * (minTextPx() / FONT_PX);
    const width = height * this.aspect;
    this.sprite.scale.set(width, height, 1);

    const clamped = camera.clampToFrustum(anchor, width / 2, height / 2, worldUnitsPerPixel * EDGE_MARGIN_PX);
    const parent = this.sprite.parent;
    if (parent) parent.worldToLocal(clamped);
    this.sprite.position.copy(clamped);
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
  }
}

/** Wraps `text` onto at most two lines at `CANVAS_WIDTH - PADDING_X * 2`. */
function wrap(ctx: CanvasRenderingContext2D, text: string): string[] {
  const maxWidth = CANVAS_WIDTH - PADDING_X * 2;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawBubble(text: string, accent: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.font = FONT;
  const lines = wrap(ctx, text);
  const pillHeight = 34 + lines.length * LINE_HEIGHT;
  const height = pillHeight + TAIL_HEIGHT + 12;

  canvas.width = CANVAS_WIDTH;
  canvas.height = height;
  // The font is reset because resizing the canvas clears all context state.
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let pillWidth = 0;
  for (const line of lines) pillWidth = Math.max(pillWidth, ctx.measureText(line).width);
  pillWidth = Math.min(CANVAS_WIDTH - 16, pillWidth + PADDING_X * 2);
  const pillX = (CANVAS_WIDTH - pillWidth) / 2;
  const pillY = 6;

  // Drop shadow, matching NameLabel's.
  ctx.fillStyle = '#4a3a5233';
  roundedRect(ctx, pillX, pillY + 6, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.fillStyle = '#fff6ea';
  roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.strokeStyle = hexToCss(accent);
  ctx.lineWidth = 7;
  roundedRect(ctx, pillX + 4, pillY + 4, pillWidth - 8, pillHeight - 8, (pillHeight - 8) / 2);
  ctx.stroke();

  // The tail: a small triangle pointing down from the middle of the pill,
  // towards wherever the speaker's head actually is.
  const tailX = CANVAS_WIDTH / 2;
  const tailTop = pillY + pillHeight - 6;
  ctx.fillStyle = '#fff6ea';
  ctx.beginPath();
  ctx.moveTo(tailX - 16, tailTop);
  ctx.lineTo(tailX + 16, tailTop);
  ctx.lineTo(tailX, tailTop + TAIL_HEIGHT);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = hexToCss(PALETTE.ink);
  ctx.font = FONT;
  const firstLineY = pillY + 34 + LINE_HEIGHT / 2 - 6;
  lines.forEach((line, i) => {
    ctx.fillText(line, CANVAS_WIDTH / 2, firstLineY + i * LINE_HEIGHT);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
