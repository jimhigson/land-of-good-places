import { CanvasTexture, Mesh, MeshToonMaterial } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { css } from '../../art/style/faces';
import { planarUvCanvasTexture } from '../../art/style/glb';
import { markShared } from '../../art/style/materials';

/**
 * **The three authored sign planks wear one canvas, and no words.**
 *
 * The stall's plank (`rs-sign`, 1.5 × 0.5 m), the Noodle-o-meter's board
 * (`rs-meter-board`, 1.0 × 0.45 m) and Sunny's anchor sign (`rh-sign`,
 * 1.7 × 0.85 m) each get a cell of this atlas painted **at the plank's own
 * aspect, measured off its geometry** — so nothing here or in Blender owns a
 * second copy of a plank's proportions, and a motif cannot come out
 * stretched (the first cut painted 8:1 cells onto 2:1 planks).
 *
 * ## Why there are no words on them
 *
 * GAME_DESIGN.md's TEXT RULE sets one minimum on-screen size for every word in
 * the game, canvas-painted signs included, and `core/textures.ts` records the
 * 28 July 2026 family ruling that followed from it: in-world sign boards carry
 * no painted text, what a thing is called is DOM text, and the welcome sign is
 * the one named exception. These planks are 0.45–0.85 m tall; the longest name
 * that would go on one ('Scales & Tails', 'Noodle-o-meter') fits its width
 * only at a quarter of the plank's height — 11–22 cm letters, about ten
 * screen pixels at the park's zoom. Measured on the first cut's frames: every
 * title was a smudge from its own stand spot. So the names are where the rule
 * puts them — the stall's and the meter's zone labels, the entrance zone's
 * label, the shop panel's title — and the planks carry the house motif: a
 * mint snake with the house face, on the cream board with the pink rim every
 * other sign in the park wears. The fifteen exhibit nameplates of the first
 * cut are gone for the same reason; an exhibit's one line is said in a bubble
 * on its first hello instead (`exhibits.ts`).
 *
 * ## The way up
 *
 * The planks' UVs are authored the gate arch's way (`v = (hi_z − z) / h`,
 * pre-inverted for the exporter), so the texture is flipped on upload —
 * `planarUvCanvasTexture`, whose doc comment owns the convention. With the
 * flip on, `v = 1` is the canvas's top row, which is what {@link SignAtlas.applyTo}
 * assumes when it turns a cell's pixel rows into `offset`/`repeat`.
 */
const CELL_HEIGHT = 256;
/** The widest plank is 3:1. */
const CANVAS_WIDTH = CELL_HEIGHT * 3;
const CELLS = 3;

export class SignAtlas {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly canvasHeight: number;
  private next = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CELLS * CELL_HEIGHT;
    this.canvasHeight = canvas.height;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.fillStyle = css(PALETTE.signBoard);
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.texture = markShared(planarUvCanvasTexture(canvas));
  }

  /**
   * Dresses an authored plank (planar 0..1 UVs, width along its own x and
   * height along its own y) in a cell painted at the plank's own aspect.
   */
  applyTo(plank: Mesh): void {
    const cell = this.next;
    this.next += 1;
    if (cell >= CELLS) throw new Error(`SignAtlas: out of cells dressing '${plank.name}'`);
    const aspect = plankAspect(plank);
    const width = Math.min(CANVAS_WIDTH, Math.round(CELL_HEIGHT * aspect));
    const y0 = cell * CELL_HEIGHT;
    if (this.ctx) {
      paintMotif(this.ctx, 0, y0, width, CELL_HEIGHT);
      this.texture.needsUpdate = true;
    }
    // Flipped on upload, so the cell's rows [y0, y0 + h) are
    // v ∈ [1 − (y0 + h) / H, 1 − y0 / H], bottom to top — the plank's own v.
    const texture = this.texture.clone();
    texture.offset.set(0, 1 - (y0 + CELL_HEIGHT) / this.canvasHeight);
    texture.repeat.set(width / CANVAS_WIDTH, CELL_HEIGHT / this.canvasHeight);
    texture.needsUpdate = true;
    const material = plank.material as MeshToonMaterial;
    material.map = texture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
  }
}

/** Width over height of the plank's drawn face, off its own vertices. */
function plankAspect(plank: Mesh): number {
  plank.geometry.computeBoundingBox();
  const box = plank.geometry.boundingBox;
  if (!box) throw new Error(`SignAtlas: '${plank.name}' has no geometry to measure`);
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  if (!(width > 0) || !(height > 0)) throw new Error(`SignAtlas: '${plank.name}' is ${width} × ${height} m — not a plank`);
  return width / height;
}

/**
 * The house motif in a cell: the cream board with the pink rim, and a mint
 * snake lying along it — a wavy body, a round head at the right with the two
 * ink eyes, the catchlights and the smile of every other face in the park, and
 * a flick of pink tongue. Everything is a fraction of the cell's height, so the
 * same snake fits a 2:1 board and a 3:1 one.
 */
function paintMotif(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = css(PALETTE.signBoard);
  ctx.fillRect(0, 0, w, h);
  const rim = h * 0.04;
  ctx.strokeStyle = css(PALETTE.markerPink);
  ctx.lineWidth = rim;
  ctx.lineJoin = 'round';
  ctx.strokeRect(rim, rim, w - rim * 2, h - rim * 2);

  const headR = h * 0.17;
  const bodyR = h * 0.075;
  const pad = h * 0.2;
  const headX = w - pad - headR;
  const midY = h * 0.52;
  const tailX = pad;
  const waves = 1.5;
  const amp = h * 0.16;

  // The body: a wave from the tail to the back of the head, drawn thick.
  ctx.strokeStyle = css(ART.snakeMint);
  ctx.lineWidth = bodyR * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const bodyEnd = headX - headR * 0.6;
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const x = tailX + (bodyEnd - tailX) * t;
    const y = midY + Math.sin(t * Math.PI * 2 * waves) * amp * (0.35 + 0.65 * t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // A belly stripe along it, the way the snakes' bands fall.
  ctx.strokeStyle = css(ART.snakeBelly);
  ctx.lineWidth = bodyR * 0.7;
  ctx.beginPath();
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const x = tailX + (bodyEnd - tailX) * t;
    const y = midY + Math.sin(t * Math.PI * 2 * waves) * amp * (0.35 + 0.65 * t) + bodyR * 0.55;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // The head and its face.
  const headY = midY + Math.sin(Math.PI * 2 * waves) * amp;
  ctx.fillStyle = css(ART.snakeMint);
  ctx.beginPath();
  ctx.ellipse(headX, headY, headR * 1.15, headR, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tongue, out of the snout.
  ctx.strokeStyle = css(PALETTE.markerPink);
  ctx.lineWidth = headR * 0.14;
  ctx.beginPath();
  ctx.moveTo(headX + headR * 1.1, headY + headR * 0.15);
  ctx.lineTo(headX + headR * 1.5, headY + headR * 0.15);
  ctx.lineTo(headX + headR * 1.7, headY - headR * 0.05);
  ctx.moveTo(headX + headR * 1.5, headY + headR * 0.15);
  ctx.lineTo(headX + headR * 1.7, headY + headR * 0.35);
  ctx.stroke();
  // Two tall ink eyes, each with two catchlights (ART_DIRECTION §3), blush, a smile.
  for (const side of [-1, 1]) {
    const ex = headX + side * headR * 0.42;
    const ey = headY - headR * 0.15;
    ctx.fillStyle = css(ART.ink);
    ctx.beginPath();
    ctx.ellipse(ex, ey, headR * 0.17, headR * 0.23, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(ART.shine);
    ctx.beginPath();
    ctx.ellipse(ex - side * headR * 0.05, ey - headR * 0.09, headR * 0.065, headR * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex + side * headR * 0.06, ey + headR * 0.08, headR * 0.03, headR * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(ART.blush);
    ctx.beginPath();
    ctx.ellipse(ex + side * headR * 0.28, ey + headR * 0.32, headR * 0.14, headR * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = css(ART.ink);
  ctx.lineWidth = headR * 0.08;
  ctx.beginPath();
  ctx.arc(headX, headY + headR * 0.18, headR * 0.3, Math.PI * 0.15, Math.PI * 0.85, false);
  ctx.stroke();
  ctx.restore();
}
