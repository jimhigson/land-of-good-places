import { BufferAttribute, CanvasTexture, Mesh, MeshToonMaterial, PlaneGeometry } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { css } from '../../art/style/faces';
import { glbCanvasTexture } from '../../art/style/glb';
import { decal, markShared, toonMaterial } from '../../art/style/materials';

/**
 * **Every sign in the Reptile House is one canvas.**
 *
 * Fifteen nameplates, the Noodle-o-meter's board, the stall's sign and the
 * anchor sign would be eighteen canvases against a game-wide budget of about
 * forty that is already spent (ASSET_MANIFEST.md). So they are cells of one
 * atlas: a nameplate is a plane whose UVs are remapped to its cell, and an
 * authored plank (the kit's `rs-sign`, `rs-meter-board`, `rh-sign`, which
 * carry 0..1 UVs) wears a clone of the texture with `offset`/`repeat` set to
 * its cell — the same image on the GPU either way.
 *
 * The atlas is painted with `flipY` off (`glbCanvasTexture`), the glTF
 * convention the planks are authored to; the nameplate planes are remapped to
 * match, so the two kinds of sign cannot come out the opposite way up from
 * each other.
 */
const COLUMNS = 2;
const ROWS = 9;
const CELL_WIDTH = 1024;
const CELL_HEIGHT = 128;

export class SignAtlas {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D | null;
  private next = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = COLUMNS * CELL_WIDTH;
    canvas.height = ROWS * CELL_HEIGHT;
    this.ctx = canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.fillStyle = css(PALETTE.signBoard);
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.texture = markShared(glbCanvasTexture(canvas));
  }

  /** Paints a title and, under it, a line of blurb into the next free cell; returns the cell. */
  paint(title: string, blurb = '', glyph = ''): number {
    const cell = this.next;
    this.next += 1;
    if (cell >= COLUMNS * ROWS) throw new Error(`SignAtlas: out of cells painting '${title}'`);
    const ctx = this.ctx;
    if (!ctx) return cell;
    const x0 = (cell % COLUMNS) * CELL_WIDTH;
    const y0 = Math.floor(cell / COLUMNS) * CELL_HEIGHT;
    ctx.fillStyle = css(PALETTE.signBoard);
    ctx.fillRect(x0, y0, CELL_WIDTH, CELL_HEIGHT);
    ctx.strokeStyle = css(PALETTE.markerPink);
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 6, y0 + 6, CELL_WIDTH - 12, CELL_HEIGHT - 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css(ART.ink);
    const heading = glyph ? `${glyph} ${title}` : title;
    if (blurb) {
      ctx.font = 'bold 54px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.fillText(heading, x0 + CELL_WIDTH / 2, y0 + 42);
      ctx.font = '36px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.fillText(blurb, x0 + CELL_WIDTH / 2, y0 + 94);
    } else {
      ctx.font = 'bold 72px "Trebuchet MS", "Segoe UI", sans-serif';
      ctx.fillText(heading, x0 + CELL_WIDTH / 2, y0 + CELL_HEIGHT / 2);
    }
    this.texture.needsUpdate = true;
    return cell;
  }

  /** A flat plate `width × height` m showing `cell`, facing +Z, origin at its centre. */
  plate(cell: number, width: number, height: number): Mesh {
    const geometry = new PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv') as BufferAttribute;
    const { left, top, cellWidth, cellHeight } = this.cellRect(cell);
    for (let i = 0; i < uv.count; i += 1) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      // PlaneGeometry puts v = 1 at the top; the atlas has v = 0 at the top.
      uv.setXY(i, left + u * cellWidth, top + (1 - v) * cellHeight);
    }
    uv.needsUpdate = true;
    const mesh = decal(new Mesh(geometry, toonMaterial(0xffffff, { map: this.texture })));
    mesh.name = 'reptile-sign';
    return mesh;
  }

  /** Dresses an authored plank (0..1 UVs, glTF way up) in `cell`. */
  applyTo(plank: Mesh, cell: number): void {
    const { left, top, cellWidth, cellHeight } = this.cellRect(cell);
    const texture = this.texture.clone();
    texture.offset.set(left, top);
    texture.repeat.set(cellWidth, cellHeight);
    texture.needsUpdate = true;
    const material = plank.material as MeshToonMaterial;
    material.map = texture;
    material.color.setHex(0xffffff);
    material.needsUpdate = true;
  }

  private cellRect(cell: number): { left: number; top: number; cellWidth: number; cellHeight: number } {
    return {
      left: (cell % COLUMNS) / COLUMNS,
      top: Math.floor(cell / COLUMNS) / ROWS,
      cellWidth: 1 / COLUMNS,
      cellHeight: 1 / ROWS,
    };
  }
}
