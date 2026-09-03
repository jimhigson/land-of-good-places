import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { hexToCss, PALETTE } from './palette';
import { Rng } from './mathUtils';
import { markShared } from '../art/style/materials';
import { ART } from '../art/style/artPalette';

/**
 * Every texture in the game is drawn here with the 2D canvas API.
 *
 * The design rule is "no external assets of any kind", so there are no image
 * files, no fonts to download and no atlases — just code that paints pixels.
 * Textures are cached by key because several systems ask for the same wood or
 * stone map and uploading it once keeps the GPU happy.
 */

const cache = new Map<string, Texture>();

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot generate textures.');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function cached<T extends Texture>(key: string, build: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing as T;
  // This cache owns every texture it hands out, so `disposeTree` must never
  // free one — see the ownership note in `art/style/materials.ts`.
  const texture = markShared(build());
  cache.set(key, texture);
  return texture;
}

/** Soft blotchy grass with little blades and the odd daisy. */
export function grassTexture(repeat = 26): CanvasTexture {
  return cached(`grass:${repeat}`, () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x6a51d);

    ctx.fillStyle = hexToCss(PALETTE.grass);
    ctx.fillRect(0, 0, size, size);

    // Broad soft patches so large areas of lawn don't read as flat colour.
    for (let i = 0; i < 90; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const r = rng.range(28, 92);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = rng.chance(0.5) ? PALETTE.grassLight : PALETTE.grassDark;
      gradient.addColorStop(0, `${hexToCss(tone)}55`);
      gradient.addColorStop(1, `${hexToCss(tone)}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blades. Drawn four times with wrap offsets so the tile seams disappear.
    ctx.lineCap = 'round';
    for (let i = 0; i < 1400; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const height = rng.range(4, 11);
      const lean = rng.range(-3, 3);
      ctx.strokeStyle = rng.chance(0.5) ? hexToCss(PALETTE.grassLight) : hexToCss(PALETTE.grassDark);
      ctx.globalAlpha = rng.range(0.25, 0.6);
      ctx.lineWidth = rng.range(1, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.5, y - height * 0.6, x + lean, y - height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Daisies and buttercups — tiny, but they make the lawn feel loved.
    for (let i = 0; i < 60; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const petal = rng.chance(0.6) ? PALETTE.blossomWhite : PALETTE.flowerYellow;
      ctx.fillStyle = hexToCss(petal);
      for (let p = 0; p < 5; p += 1) {
        const angle = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * 2.4, y + Math.sin(angle) * 2.4, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    return finish(canvas, repeat);
  });
}

/** Warm sandy path with pebbles, for the winding walkways. */
export function pathTexture(repeat = 8): CanvasTexture {
  return cached(`path:${repeat}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x1f00d);

    ctx.fillStyle = hexToCss(PALETTE.pathSand);
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 220; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const r = rng.range(1.2, 4.4);
      ctx.fillStyle = rng.chance(0.55)
        ? hexToCss(PALETTE.pathSandDark)
        : hexToCss(PALETTE.pathEdge);
      ctx.globalAlpha = rng.range(0.3, 0.85);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rng.range(0.6, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return finish(canvas, repeat);
  });
}

/**
 * **The road the cat bus drives in on** — a cross-section of a lane, tiling
 * along its length.
 *
 * Jim, 7 August 2026, having ridden it: *"the texture on the road is too plain,
 * make it more detailed."* It was one flat `PALETTE.pathSand`, so twenty
 * seconds of driving had nothing moving past underneath the bus and the ride's
 * whole sense of speed rested on the hedges.
 *
 * ## Why it is a cross-section rather than a tile
 *
 * The road is one long ribbon whose `u` runs **across** it and whose `v` runs
 * **along** it, so a texture repeated `(1, N)` paints the lane's whole width
 * once and marches it up the road N times. That is what lets the kerbs stay at
 * the kerbs and the centre line stay down the centre: they are painted at fixed
 * `u`, not scattered and hoped over. A square tile repeated in both directions
 * cannot have a centre line at all.
 *
 * ## What is painted, and why each thing earns its place
 *
 * ART_DIRECTION §7's governing rule is that a texture should look like
 * something that *could have been* geometry and merely wasn't — flat fills,
 * clear silhouettes, no photographic grain. So the detail here is all
 * **structure**: courses of paving slabs in running bond, kerb stones down both
 * verges, and a dashed centre line. Every one of those is a shape a child could
 * point at. None of it is noise, and there is no gradient anywhere.
 *
 * The kerbs are the park's own `stonePink` family — the same material as the
 * boundary wall and the gate posts — which is not decoration: the lane and the
 * park are meant to read as one road arriving at one place, and matching the
 * stone is how the eye is told that before the gate is even in shot. They are
 * painted the same on **both** tones below, and so is the centre line, for that
 * reason: the carriageway changes stone, the road does not change identity.
 *
 * ## Two tones, and why the ladder is swapped rather than the material tinted
 *
 * Jim, 3 September 2026 (issue #477): *"the paving outside the park that the
 * bus arrives on should be grey during gameplay - don't change the intro
 * sequence."*
 *
 * The obvious way to grey a sandy road is to tint its material, and it does not
 * work: `pathSand` is a warm 0xf3ddb2, so any grey multiplied through it comes
 * out as darker sand. Grey has to be *painted*, which means a second bake of
 * this canvas with the slab ladder substituted — and a second bake is free to
 * cache under its own key, so both tones can exist at once. That is what lets
 * the park's own entrance road be grey while `BusJourney`'s lane, which the
 * intro is twenty seconds of, keeps the sand it has always had. Nothing about
 * the ride is touched: it asks for the default and gets exactly the bytes it
 * got before.
 *
 * The grey is `ART.statueStone*` — the park's **one** documented grey, already
 * reasoned about against `stonePink` in `artPalette.ts` (a nine-point red lift,
 * so it reads as grey without punching a desaturated hole in a pink park). No
 * new colour is invented here; ART_DIRECTION §5 forbids a second opinion about
 * a colour the world already names, and this is the same rock the fountain
 * statue is carved from.
 */
export type RoadTone = 'sand' | 'grey';

/**
 * The three slab tones and the mortar behind them, per {@link RoadTone}.
 *
 * Ordered light → mid → dark, matching the luminance order of the sand ladder
 * they replace, so the running bond keeps the same rhythm of light and dark
 * slabs rather than becoming a flat sheet. The mortar is the dark step in both,
 * which is what makes every joint read as a joint.
 */
const ROAD_TONES: Record<RoadTone, { light: number; mid: number; dark: number }> = {
  sand: { light: PALETTE.pathEdge, mid: PALETTE.pathSand, dark: PALETTE.pathSandDark },
  grey: { light: ART.statueStoneLight, mid: ART.statueStone, dark: ART.statueStoneMid },
};

export function roadTexture(tone: RoadTone = 'sand'): CanvasTexture {
  return cached(`road:${tone}`, () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size);
    // The same seed for both tones, deliberately: the grey road is the sand
    // road cut from different stone, not a differently-laid one, so the two
    // bakes must put their light and dark slabs in exactly the same places.
    const rng = new Rng(0x0ad0a1);
    const stone = ROAD_TONES[tone];

    /** Where the kerb stops and the carriageway starts, as a fraction across. */
    const KERB = 0.085;
    const seam = `${hexToCss(PALETTE.ink)}2e`;

    // The mortar the slabs are bedded in, showing through every joint.
    ctx.fillStyle = hexToCss(stone.dark);
    ctx.fillRect(0, 0, size, size);

    /** A slab with a soft corner and an inked joint, in the house style. */
    const slab = (x: number, y: number, w: number, h: number, fill: number): void => {
      const r = Math.min(w, h) * 0.22;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = hexToCss(fill);
      ctx.fill();
      ctx.strokeStyle = seam;
      ctx.lineWidth = size * 0.004;
      ctx.stroke();
    };

    // --- the carriageway: eight courses of slabs, in running bond ------------
    // The half-slab offset on alternate courses is what stops it reading as
    // graph paper, and eight courses divide the canvas exactly so the joints
    // still line up where the tile wraps.
    const COURSES = 8;
    const ACROSS = 4;
    const courseH = size / COURSES;
    const laneX = size * KERB;
    const laneW = size * (1 - 2 * KERB);
    const slabW = laneW / ACROSS;
    const joint = size * 0.008;

    for (let course = 0; course < COURSES; course += 1) {
      const y = course * courseH;
      const shift = course % 2 === 0 ? 0 : slabW / 2;
      // One extra slab either end, clipped by the kerbs below, so the offset
      // courses are not short a slab at the edges.
      for (let i = -1; i <= ACROSS; i += 1) {
        const x = laneX + shift + i * slabW;
        const shade = rng.range(0, 1);
        const fill = shade > 0.72 ? stone.light : shade > 0.3 ? stone.mid : stone.dark;
        slab(x + joint / 2, y + joint / 2, slabW - joint, courseH - joint, fill);
      }
    }

    // --- the kerbs -----------------------------------------------------------
    // Painted last so they cover the slab courses that were allowed to run
    // under them, which is how a kerb sits on a road anyway.
    ctx.fillStyle = hexToCss(stone.dark);
    ctx.fillRect(0, 0, size * KERB, size);
    ctx.fillRect(size * (1 - KERB), 0, size * KERB, size);
    const KERB_STONES = 6;
    const stoneH = size / KERB_STONES;
    for (let i = 0; i < KERB_STONES; i += 1) {
      const y = i * stoneH;
      const light = i % 2 === 0;
      for (const x of [0, size * (1 - KERB)] as const) {
        slab(
          x + joint / 2,
          y + joint / 2,
          size * KERB - joint,
          stoneH - joint,
          light ? PALETTE.stonePink : PALETTE.stonePinkLight,
        );
      }
    }

    // --- the centre line -----------------------------------------------------
    // Two dashes per tile, so it reads as a rhythm going past rather than a
    // continuous stripe — the thing that actually sells speed at 11 m/s.
    const DASHES = 2;
    const dashH = size / DASHES;
    const lineW = size * 0.035;
    for (let i = 0; i < DASHES; i += 1) {
      const y = i * dashH + dashH * 0.22;
      slab((size - lineW) / 2, y, lineW, dashH * 0.56, PALETTE.markerLemon);
    }

    // Repeat `(1, 1)`: every road writes its own `v` in **tiles** rather than
    // scaling this, so one bake serves a road of any length and
    // `ROAD_TILE_METRES` is the only place the scale is decided — which is also
    // why the two tones stay interchangeable, differing in pixels and in
    // nothing else.
    return finish(canvas, 1);
  });
}

/** Rounded pink cobbles — the park's signature wall material. */
export function pinkStoneTexture(repeatX = 4, repeatY = 1): CanvasTexture {
  return cached(`pinkStone:${repeatX}:${repeatY}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xb100d5);

    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fillRect(0, 0, size, size);

    const rows = 5;
    const rowHeight = size / rows;
    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 === 0 ? 0 : rowHeight * 0.9;
      for (let col = -1; col < 5; col += 1) {
        const w = rowHeight * 1.8;
        const x = col * w + offset;
        const y = row * rowHeight;
        const pad = 3;
        const shade = rng.range(0, 1);
        ctx.fillStyle =
          shade > 0.7
            ? hexToCss(PALETTE.stonePinkLight)
            : shade > 0.3
              ? hexToCss(PALETTE.stonePink)
              : '#ffd2e3';
        roundedRect(ctx, x + pad, y + pad, w - pad * 2, rowHeight - pad * 2, 9);
        ctx.fill();
        // Top highlight makes each cobble read as domed rather than flat.
        ctx.fillStyle = '#ffffff44';
        roundedRect(ctx, x + pad + 3, y + pad + 2, w - pad * 2 - 6, rowHeight * 0.3, 6);
        ctx.fill();
      }
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/**
 * The voussoir ring: large, single-course wedge stones framing a masonry
 * arch's opening, distinct from the smaller randomised cobbles
 * {@link pinkStoneTexture} draws everywhere else on the shell — Jim's
 * 2026-08-24 request, "keep the current height but make the tunnel an
 * arch, with a texture giving arch stones around the tunnel", once the
 * humpback bridges' new curved soffit had no visual callout of its own.
 *
 * Painted straight onto the tunnel's own soffit (the arch's visible
 * underside, flat crown and curved haunch alike — see `bridges.ts`) —
 * never a second mesh standing in front of it (CLAUDE.md's "one surface,
 * one texture", the hood-face lesson). The joints are drawn dead straight,
 * parallel to `v` (the tunnel's own depth): a real voussoir's wedge shape
 * comes from the soffit's own curvature doing the foreshortening as it
 * sweeps through 3D, not from a taper baked into flat UV space — a
 * straight joint on a curved haunch already reads as radiating once
 * rendered, and a taper drawn on top of that would double up and read as
 * warped instead.
 *
 * Same three pink-stone tones {@link pinkStoneTexture} uses
 * (`PALETTE.stonePink*` — this file's own header: "never a new colour"),
 * so the ring reads as distinct by scale and joint width, not a fourth
 * hue.
 */
export function archStoneTexture(repeatX = 3, repeatY = 1): CanvasTexture {
  return cached(`archStone:${repeatX}:${repeatY}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);

    // Mortar: a wide, dark joint between voussoirs — noticeably wider than
    // pinkStoneTexture's ordinary coursing gap, so the ring reads as
    // deliberately dressed stone rather than more rubble.
    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fillRect(0, 0, size, size);

    const stones = 3;
    const stoneWidth = size / stones;
    const mortar = 10;

    for (let i = 0; i < stones; i += 1) {
      const x = i * stoneWidth;
      const shade = i % 2 === 0 ? PALETTE.stonePinkLight : PALETTE.stonePink;
      ctx.fillStyle = hexToCss(shade);
      roundedRect(ctx, x + mortar / 2, mortar / 2, stoneWidth - mortar, size - mortar, 10);
      ctx.fill();
      // Top highlight — the same dome cue `pinkStoneTexture` uses, so the
      // ring reads as one lit family with the wall around it rather than a
      // flatter, separately-lit material.
      ctx.fillStyle = '#ffffff44';
      roundedRect(ctx, x + mortar / 2 + 4, mortar / 2 + 4, stoneWidth - mortar - 8, size * 0.22, 8);
      ctx.fill();
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/** Vertical plank boards with knots, for the wooden hiding walls. */
export function woodTexture(repeatX = 3, repeatY = 1): CanvasTexture {
  return cached(`wood:${repeatX}:${repeatY}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xdecaf);

    ctx.fillStyle = hexToCss(PALETTE.wood);
    ctx.fillRect(0, 0, size, size);

    const planks = 5;
    const plankWidth = size / planks;
    for (let i = 0; i < planks; i += 1) {
      const x = i * plankWidth;
      const tint = rng.range(0, 1);
      ctx.fillStyle =
        tint > 0.66
          ? hexToCss(PALETTE.woodLight)
          : tint > 0.33
            ? hexToCss(PALETTE.wood)
            : hexToCss(PALETTE.woodDark);
      ctx.fillRect(x + 1.5, 0, plankWidth - 3, size);

      // Grain
      ctx.strokeStyle = `${hexToCss(PALETTE.woodDark)}55`;
      ctx.lineWidth = 1;
      for (let g = 0; g < 7; g += 1) {
        const gx = x + rng.range(4, plankWidth - 4);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + rng.range(-4, 4), size / 3, gx + rng.range(-4, 4), (size * 2) / 3, gx, size);
        ctx.stroke();
      }

      // A knot or two per plank
      if (rng.chance(0.7)) {
        const kx = x + plankWidth / 2 + rng.range(-6, 6);
        const ky = rng.range(20, size - 20);
        ctx.strokeStyle = `${hexToCss(PALETTE.woodDark)}aa`;
        ctx.lineWidth = 1.6;
        for (let r = 2; r < 8; r += 2) {
          ctx.beginPath();
          ctx.ellipse(kx, ky, r, r * 1.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Plank gap shadow
      ctx.fillStyle = '#00000022';
      ctx.fillRect(x, 0, 2, size);
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/**
 * Chunky rounded mosaic tiles, for The Land Hotel's reception floor.
 *
 * Jim, 6 August 2026, after playing the hotel: *"the hotel looks much too
 * plain — make the reception have an interesting and playful mosaic on the
 * tiles of the floor."*
 *
 * ### Why this is allowed to be a map at all
 *
 * ART_DIRECTION §7 is firm that **flat colours are material colours, not
 * maps** — a texture that only carries one colour is a canvas doing a
 * material's job. A mosaic is the case the same line explicitly leaves room
 * for ("tiling maps 512²"): the floor is genuinely made of *many* small
 * differently-coloured pieces, and the honest alternative — one mesh per
 * tile — is 1 300 draw calls for a lobby floor.
 *
 * ### Why it still reads under the toon ramp
 *
 * §3's governing rule: a painted texture has to look like something that
 * *could have been* built as geometry. So every tile here is a big flat fill
 * with a hard edge — an 8 × 8 grid of 64 px cells, rounded corners, a pale
 * grout gap between them, and a flat top highlight band exactly like the one
 * `pinkStoneTexture` uses to make a cobble read as domed. No gradients, no
 * noise. At the repeat the lobby uses (one canvas per 4 m) a tile is half a
 * metre across, which is chunky enough to survive being toon-banded and to be
 * legible from the iso camera rather than dissolving into fizz.
 *
 * Every sixth-ish tile carries one flat motif — a heart, a star, a flower or
 * a paw print — in another palette colour. They are what makes it *playful*
 * rather than merely tiled, and they are drawn as solid silhouettes for the
 * same reason the eyes are: a shape with an outline reads at gameplay
 * distance, a shaded one does not.
 *
 * The grid is axis-aligned at exact multiples of the cell size, so the canvas
 * wraps seamlessly and a non-integer `repeat` (the lobby is 26 × 20 m, i.e.
 * 6.5 × 5 canvases) simply cuts a tile at the plate's edge rather than
 * showing a seam.
 */
export function mosaicTexture(repeatX = 6, repeatY = 6): CanvasTexture {
  return cached(`mosaic:${repeatX}:${repeatY}`, () => {
    const size = 512;
    const cells = 8;
    const cell = size / cells;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x0541c);

    // Grout first, as a full-bleed fill: every tile is then drawn inset, and
    // what shows between them is this.
    ctx.fillStyle = hexToCss(PALETTE.stonePinkLight);
    ctx.fillRect(0, 0, size, size);

    const tileColours = [
      PALETTE.markerPink,
      PALETTE.markerMint,
      PALETTE.markerSky,
      PALETTE.markerLemon,
      PALETTE.markerLilac,
      PALETTE.blossomWhite,
      PALETTE.flowerViolet,
      PALETTE.stonePink,
    ] as const;
    const motifColours = [
      PALETTE.markerPink,
      PALETTE.markerLilac,
      PALETTE.flowerYellow,
      PALETTE.markerMint,
      PALETTE.markerSky,
    ] as const;
    const motifs = ['heart', 'star', 'flower', 'paw'] as const;

    for (let row = 0; row < cells; row += 1) {
      for (let col = 0; col < cells; col += 1) {
        const x = col * cell;
        const y = row * cell;
        const pad = 4;
        const colour = rng.pick(tileColours);
        ctx.fillStyle = hexToCss(colour);
        roundedRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, 14);
        ctx.fill();

        // The glaze highlight — one flat band across the top third, the same
        // trick (and the same strength) as the pink cobbles'.
        ctx.fillStyle = '#ffffff3a';
        roundedRect(ctx, x + pad + 4, y + pad + 3, cell - pad * 2 - 8, (cell - pad * 2) * 0.3, 8);
        ctx.fill();

        if (rng.chance(0.28)) {
          drawMotif(
            ctx,
            rng.pick(motifs),
            x + cell / 2,
            y + cell / 2,
            cell * 0.3,
            hexToCss(pickContrast(motifColours, colour, rng)),
          );
        }
      }
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/** A motif colour that is not the colour of the tile it is painted on. */
function pickContrast(choices: readonly number[], avoid: number, rng: Rng): number {
  const usable = choices.filter((colour) => colour !== avoid);
  return rng.pick(usable.length > 0 ? usable : choices);
}

/**
 * One flat mosaic motif, centred, drawn as a solid silhouette.
 *
 * Each is built from arcs and straight lines only — no curve a child could not
 * have cut out of card — because the whole point is that it reads as an inlaid
 * tile shape rather than as a picture printed on the floor.
 */
function drawMotif(
  ctx: CanvasRenderingContext2D,
  motif: 'heart' | 'star' | 'flower' | 'paw',
  cx: number,
  cy: number,
  r: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  switch (motif) {
    case 'heart': {
      ctx.beginPath();
      ctx.arc(cx - r * 0.45, cy - r * 0.28, r * 0.5, Math.PI * 0.9, Math.PI * 1.95);
      ctx.arc(cx + r * 0.45, cy - r * 0.28, r * 0.5, Math.PI * 1.05, Math.PI * 0.1);
      ctx.lineTo(cx, cy + r * 0.85);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.44;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'flower': {
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r * 0.52, cy + Math.sin(angle) * r * 0.52, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'paw': {
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.34, r * 0.56, r * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy, rr] of [
        [-0.66, -0.5, 0.24],
        [-0.24, -0.78, 0.25],
        [0.24, -0.78, 0.25],
        [0.66, -0.5, 0.24],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
  }
}

/**
 * Diagonal yellow-and-black hazard tape, for the Rail Race duck bar.
 *
 * Jim, 1 August 2026: "give it a yellow-and-black texture like diagonal
 * hazard/warning tape." Painted here, not baked into the Blender asset —
 * the same "shape from the asset, appearance from code" split the kid's
 * skin/hair and the cart's lane colour already use (ART_DIRECTION.md §7),
 * so the bar's material stays a plain, swappable texture rather than a
 * second copy of it living inside the geometry file. The asset's own UVs
 * (`art/blend/duckbar_export.py`, a cube projection) run `u` along the bar's
 * length, which is what makes the stripes repeat evenly along it rather
 * than stretching across its short ends.
 *
 * Drawn by rotating the canvas 45° and filling wide vertical bands across a
 * generously oversized area (comfortably past the rotated canvas's own
 * diagonal, `size * sqrt(2)`) — simpler and exactly as sharp as computing
 * each stripe's clipped parallelogram by hand, and immune to the classic
 * rotated-fill trap of leaving corners unpainted.
 */
export function hazardTapeTexture(repeat = 4): CanvasTexture {
  return cached(`hazardTape:${repeat}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);

    ctx.fillStyle = hexToCss(PALETTE.markerLemon);
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = hexToCss(PALETTE.ink);
    const stripe = size / 4;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-size, -size);
    for (let x = -size; x < size * 3; x += stripe * 2) {
      ctx.fillRect(x, -size, stripe, size * 4);
    }
    ctx.restore();

    const texture = finish(canvas, 1);
    // Repeats along the bar's length only — see this function's own doc
    // comment on why that is the `u` axis, not both.
    texture.repeat.set(repeat, 1);
    return texture;
  });
}

/* ---------------------------------------------------------------------------
   Canvas-painted text and the TEXT RULE (GAME_DESIGN.md).

   A canvas texture has no "font size on screen" of its own: what a child
   actually sees is the font's size *as a fraction of the canvas*, multiplied
   by however many screen pixels the thing wearing that texture covers. So the
   rule is kept in two places, and both are exported from here rather than
   being copied around:

   - the fractions below say how big the text is relative to its canvas;
   - the caller (`ui/NameLabel.ts`, `ui/SpeechBubble.ts`) sizes the canvas on
     screen so that fraction lands at or above `uiScale.ts`'s `minTextPx()`.

   The park's sign boards used to be the third of these. There are no sign
   boards any more (family ruling, 28 July 2026) and `signTexture` went with
   them: what a thing is called is DOM text now, so it is simply covered by the
   TEXT RULE's ordinary `--lgp-text-min` like every other word in the game.

   **One deliberate, one-off exception: {@link welcomeSignTexture}.** Jim,
   23 August 2026, on PR #303's welcome sign: the interact-chip text the board
   shipped with was not what he asked for — the board itself has to carry
   real, readable words, painted on, visible on approach rather than after a
   button press. This is not a reopening of the 28 July ruling for signage in
   general; it is one board, named by him, that gets its words back.
--------------------------------------------------------------------------- */

/** Canvas height of the name pill (see {@link nameLabelTexture}). */
export const NAME_LABEL_CANVAS_HEIGHT = 160;
/** Font size the name is painted at inside that canvas. */
export const NAME_LABEL_FONT_PX = 62;
/**
 * The floating name pill above a character's head.
 *
 * Not cached by key alone — names change when the player renames themselves —
 * so callers should dispose the previous texture when they rebuild it.
 */
export function nameLabelTexture(name: string, accent: number = PALETTE.markerPink): CanvasTexture {
  const width = 512;
  const height = NAME_LABEL_CANVAS_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.font = `bold ${NAME_LABEL_FONT_PX}px "Trebuchet MS", "Segoe UI", sans-serif`;
  const textWidth = ctx.measureText(name).width;
  const pillWidth = Math.min(width - 16, textWidth + 96);
  const pillX = (width - pillWidth) / 2;
  const pillY = 26;
  const pillHeight = 96;

  // Drop shadow
  ctx.fillStyle = '#4a3a5233';
  roundedRect(ctx, pillX, pillY + 8, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.fillStyle = '#fff6ea';
  roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.strokeStyle = hexToCss(accent);
  ctx.lineWidth = 8;
  roundedRect(ctx, pillX + 4, pillY + 4, pillWidth - 8, pillHeight - 8, (pillHeight - 8) / 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexToCss(PALETTE.ink);
  ctx.fillText(name, width / 2, pillY + pillHeight / 2 + 3);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Canvas the welcome-sign plaque text is painted at (see {@link welcomeSignTexture}). */
export const WELCOME_SIGN_CANVAS_WIDTH = 1024;
export const WELCOME_SIGN_CANVAS_HEIGHT = 380;
/** Font size the welcome text is painted at inside that canvas. */
export const WELCOME_SIGN_FONT_PX = 96;

/**
 * The welcome sign's own painted plaque — see this file's own note above on
 * why this one board is allowed words when the rest of the park's signage is
 * DOM text.
 *
 * A serif face, deliberately: every other painted or DOM label in the game
 * uses `--lgp-font` (Baloo 2 / Nunito, the game's rounded playground voice),
 * and this is the one place asked to read like an actual carved or lettered
 * sign rather than another UI chip — Georgia/Times as a plain CSS `serif`
 * fallback stack, no webfont to fetch (ART_DIRECTION's "no external assets").
 *
 * Cached by text alone: the greeting is a fixed string, so — like
 * {@link signTexture} before it — every caller shares one canvas and one GPU
 * upload rather than each rebuilding its own.
 */
export function welcomeSignTexture(text: string): CanvasTexture {
  return cached(`welcomeSign:${text}`, () => {
    const width = WELCOME_SIGN_CANVAS_WIDTH;
    const height = WELCOME_SIGN_CANVAS_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    // A cream plaque face, bordered like the hotel's picture mounts
    // (`world/hotel/dressing.ts`) so it reads as one deliberate object rather
    // than a sticker.
    ctx.fillStyle = hexToCss(PALETTE.signBoard);
    roundedRect(ctx, 0, 0, width, height, 30);
    ctx.fill();

    ctx.strokeStyle = hexToCss(PALETTE.markerPink);
    ctx.lineWidth = 14;
    roundedRect(ctx, 12, 12, width - 24, height - 24, 24);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexToCss(PALETTE.ink);

    const maxTextWidth = width - 160;
    const lines = wrapCanvasText(ctx, text, maxTextWidth, WELCOME_SIGN_FONT_PX);
    const lineHeight = WELCOME_SIGN_FONT_PX * 1.16;
    const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + i * lineHeight, maxTextWidth);
    });

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

/**
 * Greedy word-wrap for a canvas string: sets `ctx.font` to the serif welcome
 * face at `fontPx`, then packs words onto lines no wider than `maxWidth`.
 * Never shrinks the font to fit — the TEXT RULE forbids that — only breaks
 * the line, same as `fillText`'s own max-width argument does for a single
 * line in {@link signTexture}.
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontPx: number,
): string[] {
  ctx.font = `700 ${fontPx}px Georgia, "Times New Roman", serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Soft round blob used for fairy-light glows and the sun/moon halo. */
export function glowTexture(colour = 0xffffff): CanvasTexture {
  return cached(`glow:${colour}`, () => {
    const size = 128;
    const { canvas, ctx } = createCanvas(size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const css = hexToCss(colour);
    gradient.addColorStop(0, `${css}ff`);
    gradient.addColorStop(0.35, `${css}88`);
    gradient.addColorStop(1, `${css}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  });
}

/**
 * The two maps that turn the castle's inside from a painted box into masonry
 * (issue #363). Both are **tiled in metres**, which is not a coincidence and
 * is the reason they can be this simple.
 *
 * `extrudePlan` builds the decks and the walls with `ExtrudeGeometry`, whose
 * default UV generator emits *world* coordinates: a slab's top face gets
 * `(x, y)` straight out of the plan, and a wall's side face gets
 * `(distance along the wall, extrusion height)`. Both are already in metres
 * before we lay the geometry down. So a caller says how many metres one tile
 * of the drawing should cover and `repeat` is simply its reciprocal — there is
 * no per-mesh UV fixing anywhere, and a wall and the floor it meets agree at
 * the skirting for free.
 *
 * The colours are the ones the castle **facade** already stands in out in the
 * garden (`buildingWall` cream, the `stonePink*` family): walking through the
 * front door must not swap material worlds. Per this file's own rule, no new
 * colour is invented here.
 */

/** Metres of wall one tile of {@link castleCoursingTexture} covers. */
export const CASTLE_COURSE_TILE_METRES = 4.8;
/** Metres of floor one tile of {@link castleFlagstoneTexture} covers. */
export const CASTLE_FLAG_TILE_METRES = 6;

/**
 * Coursed ashlar for the castle's inside walls: four courses of big dressed
 * blocks, staggered, with a wide mortar joint.
 *
 * Blocks are **1.6 m × 1.2 m** — storybook-huge, and deliberately so. The
 * solid wall band is only 2.15 m tall, so a child sees not quite two courses
 * of it; at a realistic 0.4 m the same wall would be five courses of speckle
 * that reads as wallpaper from the 38° camera. §4's "recognisable beats
 * measured" applied to a texture.
 */
export function castleCoursingTexture(): CanvasTexture {
  return cached('castleCoursing', () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xca5713);

    // Mortar first, as the whole background: every joint is then simply the
    // gap left between blocks, and no joint can go missing at a tile seam.
    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fillRect(0, 0, size, size);

    const courses = 4;
    const courseHeight = size / courses;
    const blockWidth = size / 3;
    const joint = 5;
    const tones = [PALETTE.buildingWall, PALETTE.blossomWhite, PALETTE.stonePinkLight];

    for (let course = 0; course < courses; course += 1) {
      // Half-block stagger on alternate courses — the thing that stops four
      // rows of blocks reading as a grid of tiles.
      const offset = course % 2 === 0 ? 0 : blockWidth / 2;
      const y = course * courseHeight;
      for (let col = -1; col <= 3; col += 1) {
        const x = col * blockWidth + offset;
        ctx.fillStyle = hexToCss(rng.pick(tones));
        roundedRect(
          ctx,
          x + joint,
          y + joint,
          blockWidth - joint * 2,
          courseHeight - joint * 2,
          7,
        );
        ctx.fill();
        // A light top edge and a shaded bottom one: the block reads as having
        // a thickness, which is what says "cut stone" rather than "painted
        // rectangle". Cheap, and it survives the toon ramp because it is a
        // colour difference in the map, not a lighting one.
        ctx.fillStyle = '#ffffff55';
        roundedRect(ctx, x + joint + 4, y + joint + 3, blockWidth - joint * 2 - 8, 7, 3);
        ctx.fill();
        ctx.fillStyle = '#00000010';
        roundedRect(
          ctx,
          x + joint + 4,
          y + courseHeight - joint - 8,
          blockWidth - joint * 2 - 8,
          5,
          3,
        );
        ctx.fill();
      }
    }

    const texture = finish(canvas, 1);
    const repeat = 1 / CASTLE_COURSE_TILE_METRES;
    texture.repeat.set(repeat, repeat);
    return texture;
  });
}

/**
 * Flagstones for the castle's inside floors: a four-by-four of big irregular
 * flags, 1.5 m across, with the odd worn one.
 *
 * The floor plate is 60 × 44 m and is the largest single surface anywhere in
 * the game. Flat pink over 2 640 m² is most of what made the room read as a
 * warehouse; giving it a joint pattern is the cheapest large change available
 * — one shared texture, no extra draw call, no extra triangle.
 */
export function castleFlagstoneTexture(): CanvasTexture {
  return cached('castleFlagstone', () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xf1a65);

    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fillRect(0, 0, size, size);

    const flags = 4;
    const cell = size / flags;
    const joint = 4;
    const tones = [PALETTE.stonePinkLight, PALETTE.blossomWhite, PALETTE.buildingWall];

    for (let row = 0; row < flags; row += 1) {
      for (let col = 0; col < flags; col += 1) {
        // Each flag is nudged and shrunk by its own seeded amount, so no two
        // are the same size and the joints wander like laid stone rather than
        // ruling a grid. Seeded, so the floor is identical on every reload.
        const jx = rng.range(-1.5, 1.5);
        const jy = rng.range(-1.5, 1.5);
        const shrink = rng.range(0, 2.5);
        ctx.fillStyle = hexToCss(rng.pick(tones));
        roundedRect(
          ctx,
          col * cell + joint + jx + shrink,
          row * cell + joint + jy + shrink,
          cell - joint * 2 - shrink * 2,
          cell - joint * 2 - shrink * 2,
          6,
        );
        ctx.fill();
        // One flag in five is worn pale in the middle, as though a few
        // centuries of children have crossed it. It is the sort of detail
        // nobody is meant to notice and everybody would miss.
        if (rng.range(0, 1) > 0.8) {
          ctx.fillStyle = '#ffffff40';
          roundedRect(
            ctx,
            col * cell + cell * 0.28,
            row * cell + cell * 0.28,
            cell * 0.44,
            cell * 0.44,
            8,
          );
          ctx.fill();
        }
      }
    }

    const texture = finish(canvas, 1);
    const repeat = 1 / CASTLE_FLAG_TILE_METRES;
    texture.repeat.set(repeat, repeat);
    return texture;
  });
}

/** Frees every cached texture. Only needed when tearing the game down. */
export function disposeTextureCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
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

/**
 * **Paint for the castle's inside** (issue #376).
 *
 * Jim, looking at the merged interior: *"still feels very sparse … mostly empty
 * rooms right now."* Most of what follows is answering that with a canvas
 * rather than with geometry, because a picture on a flat quad is the cheapest
 * thing in the game that a child will actually stop and look at.
 *
 * These are **decals, not tiling maps**, so unlike {@link castleCoursingTexture}
 * and {@link castleFlagstoneTexture} they build their `CanvasTexture` by hand
 * instead of going through `finish()`: `finish` sets `RepeatWrapping`, which on
 * a single quad wraps the edge of a picture round onto its opposite side and
 * puts a seam down a portrait's face. `ClampToEdgeWrapping` is the default and
 * is what these want.
 *
 * All are 256², which is ART_DIRECTION §3's decal budget.
 */

const DECAL_SIZE = 256;

/** A decal texture: no repeat, no wrap, no seam. */
function decalTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The smoke stain above a torch.
 *
 * A soft plume, widest at the top, with a hard-ish core just above the flame —
 * which is what soot actually does, and more usefully is what reads as soot
 * from ten metres at 38°. Drawn in **white with alpha**, because the mesh's
 * material carries the colour: one texture then works over cream stone and over
 * the storey tints without a second canvas per colourway.
 */
export function castleSootTexture(): CanvasTexture {
  return cached('castleSoot', () => {
    const { canvas, ctx } = createCanvas(DECAL_SIZE);
    const rng = new Rng(0x5007);
    const mid = DECAL_SIZE / 2;

    // The plume: a stack of circles that widen and fade as they rise. Drawn
    // from the bottom up so the densest part is where the flame licks the wall.
    const puffs = 26;
    for (let i = 0; i < puffs; i += 1) {
      const t = i / (puffs - 1);
      // y = 0 is the top of the canvas and the top of the stain.
      const y = DECAL_SIZE * (1 - t) * 0.96;
      const radius = 26 + t * 74;
      const alpha = (1 - t) * 0.5 + 0.04;
      const gradient = ctx.createRadialGradient(
        mid + rng.range(-12, 12),
        y,
        0,
        mid,
        y,
        radius,
      );
      gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y - radius, DECAL_SIZE, radius * 2);
    }

    // A few flecks, so the edge of the plume is not a perfect airbrush.
    for (let i = 0; i < 40; i += 1) {
      const t = rng.range(0, 1);
      ctx.fillStyle = `rgba(255,255,255,${(0.3 * (1 - t)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(
        mid + rng.range(-1, 1) * (24 + t * 62),
        DECAL_SIZE * (1 - t),
        rng.range(2, 7),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    return decalTexture(canvas);
  });
}

/** The heraldry the castle's cloth is painted with. */
export type CastleDevice = 'dragon' | 'star' | 'heart';

/**
 * A banner: a bold field, a chevron and one big device.
 *
 * **Three shapes and two colours, and no more than that.** A banner is seen at
 * ten metres from a 38° camera and mostly in the top third of frame, where it
 * is also the thing furthest from the eye. Everything that made earlier drafts
 * look "detailed" — a border, a motto, quartering — turned to mush at that size
 * and cost the silhouette, which is the only part that survives. §4's
 * "recognisable beats measured", applied to a picture.
 */
export function castleBannerTexture(field: number, device: CastleDevice): CanvasTexture {
  return cached(`castleBanner:${field}:${device}`, () => {
    const { canvas, ctx } = createCanvas(DECAL_SIZE);
    const mid = DECAL_SIZE / 2;

    ctx.fillStyle = hexToCss(field);
    ctx.fillRect(0, 0, DECAL_SIZE, DECAL_SIZE);

    // A chevron across the top third, in cream: it stops a long cloth reading
    // as one flat rectangle when only its top half is above a child's eyeline.
    ctx.fillStyle = hexToCss(PALETTE.blossomWhite);
    ctx.beginPath();
    ctx.moveTo(0, 44);
    ctx.lineTo(mid, 96);
    ctx.lineTo(DECAL_SIZE, 44);
    ctx.lineTo(DECAL_SIZE, 78);
    ctx.lineTo(mid, 130);
    ctx.lineTo(0, 78);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hexToCss(PALETTE.blossomWhite);
    drawDevice(ctx, device, mid, 178, 58);

    return decalTexture(canvas);
  });
}

/**
 * The coat of arms over the front door: the same devices on a shield outline.
 *
 * Shares {@link drawDevice} with the banners on purpose — a castle whose door
 * carries a different dragon from its cloth is a castle with two heraldries.
 */
export function castleArmsTexture(field: number, device: CastleDevice): CanvasTexture {
  return cached(`castleArms:${field}:${device}`, () => {
    const { canvas, ctx } = createCanvas(DECAL_SIZE);
    const mid = DECAL_SIZE / 2;

    // The shield: square-shouldered, curving to a point. Drawn as alpha so the
    // quad it lives on has no visible corners.
    ctx.beginPath();
    ctx.moveTo(24, 20);
    ctx.lineTo(DECAL_SIZE - 24, 20);
    ctx.lineTo(DECAL_SIZE - 24, 132);
    ctx.quadraticCurveTo(DECAL_SIZE - 24, 216, mid, DECAL_SIZE - 14);
    ctx.quadraticCurveTo(24, 216, 24, 132);
    ctx.closePath();

    ctx.fillStyle = hexToCss(PALETTE.woodDark);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = hexToCss(field);
    ctx.fillRect(14, 30, DECAL_SIZE - 28, DECAL_SIZE - 30);
    ctx.fillStyle = hexToCss(PALETTE.blossomWhite);
    drawDevice(ctx, device, mid, 128, 66);
    ctx.restore();

    return decalTexture(canvas);
  });
}

/**
 * One heraldic device, centred on `(cx, cy)` and `size` across.
 *
 * The dragon is four shapes — body, neck, head, wing — and that is the whole
 * animal. Anything more disappears at the size it is actually seen.
 */
function drawDevice(
  ctx: CanvasRenderingContext2D,
  device: CastleDevice,
  cx: number,
  cy: number,
  size: number,
): void {
  if (device === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 === 0 ? size : size * 0.44;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (device === 'heart') {
    const r = size * 0.52;
    ctx.beginPath();
    ctx.arc(cx - r * 0.55, cy - r * 0.3, r * 0.62, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.55, cy - r * 0.3, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.12, cy - r * 0.14);
    ctx.lineTo(cx, cy + r * 1.16);
    ctx.lineTo(cx + r * 1.12, cy - r * 0.14);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // A dragon, sitting up, wing out, looking to the left.
  const s = size / 60;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 8 * s, 26 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Neck and head.
  ctx.beginPath();
  ctx.moveTo(cx - 6 * s, cy - 4 * s);
  ctx.lineTo(cx - 30 * s, cy - 34 * s);
  ctx.lineTo(cx - 14 * s, cy - 36 * s);
  ctx.lineTo(cx + 6 * s, cy - 8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - 30 * s, cy - 38 * s, 15 * s, 10 * s, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Wing, and the tail.
  ctx.beginPath();
  ctx.moveTo(cx + 4 * s, cy - 6 * s);
  ctx.lineTo(cx + 40 * s, cy - 40 * s);
  ctx.lineTo(cx + 34 * s, cy - 2 * s);
  ctx.lineTo(cx + 44 * s, cy + 6 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 18 * s, cy + 18 * s);
  ctx.lineTo(cx + 52 * s, cy + 34 * s);
  ctx.lineTo(cx + 18 * s, cy + 30 * s);
  ctx.closePath();
  ctx.fill();
}

/** Which picture hangs in a frame on the castle wall. */
export type CastlePainting = 'lady' | 'dragon' | 'knight';

/**
 * A painting for a frame on the wall.
 *
 * Deliberately naive — flat shapes on a flat ground, the way a child paints a
 * person. It is a picture *in the world*, so it must not out-render the world
 * it hangs in: a realistic portrait in this park reads as a photograph
 * somebody has taped to a toy castle.
 */
export function castlePaintingTexture(subject: CastlePainting): CanvasTexture {
  return cached(`castlePainting:${subject}`, () => {
    const { canvas, ctx } = createCanvas(DECAL_SIZE);
    const mid = DECAL_SIZE / 2;

    const ground = subject === 'dragon' ? PALETTE.skyDayBottom : PALETTE.stonePinkDark;
    ctx.fillStyle = hexToCss(ground);
    ctx.fillRect(0, 0, DECAL_SIZE, DECAL_SIZE);

    if (subject === 'dragon') {
      // Hills, then the dragon over them, so the animal is plainly in front.
      ctx.fillStyle = hexToCss(PALETTE.leafDeep);
      ctx.beginPath();
      ctx.ellipse(60, DECAL_SIZE + 20, 120, 96, 0, 0, Math.PI * 2);
      ctx.ellipse(210, DECAL_SIZE + 34, 110, 90, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexToCss(PALETTE.leafMid);
      drawDevice(ctx, 'dragon', mid + 6, 116, 70);
      // One eye, because a face with an eye is a face.
      ctx.fillStyle = hexToCss(PALETTE.ink);
      ctx.beginPath();
      ctx.arc(mid - 32, 68, 6, 0, Math.PI * 2);
      ctx.fill();
      return decalTexture(canvas);
    }

    // A portrait: shoulders, head, hair, and a hat if it is the knight.
    const bodyColour = subject === 'knight' ? PALETTE.buildingTrimDeep : PALETTE.blossomPink;
    ctx.fillStyle = hexToCss(bodyColour);
    ctx.beginPath();
    ctx.ellipse(mid, DECAL_SIZE + 42, 104, 128, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToCss(PALETTE.hair);
    ctx.beginPath();
    ctx.ellipse(mid, 118, 70, 78, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToCss(PALETTE.skin);
    ctx.beginPath();
    ctx.ellipse(mid, 128, 52, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToCss(PALETTE.ink);
    for (const dx of [-20, 20]) {
      ctx.beginPath();
      ctx.arc(mid + dx, 124, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hexToCss(PALETTE.ink);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(mid, 148, 18, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.fillStyle = hexToCss(PALETTE.cheek);
    for (const dx of [-36, 36]) {
      ctx.beginPath();
      ctx.arc(mid + dx, 146, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    if (subject === 'knight') {
      ctx.fillStyle = hexToCss(PALETTE.stonePinkLight);
      roundedRect(ctx, mid - 62, 44, 124, 34, 12);
      ctx.fill();
    }

    return decalTexture(canvas);
  });
}

/**
 * The big round rug that goes on the roundel.
 *
 * Concentric bands with a scalloped inner ring, so it reads as woven from
 * directly overhead — which, at 38° over a floor, is roughly how it is seen.
 * Non-tiling: it is one disc, and a repeat would put a seam across its middle.
 */
export function castleRugTexture(): CanvasTexture {
  return cached('castleRug', () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size);
    const mid = size / 2;

    const bands: readonly [number, number][] = [
      [0.5, PALETTE.blossomPink],
      [0.44, PALETTE.buildingTrimDeep],
      [0.4, PALETTE.blossomWhite],
      [0.3, PALETTE.markerLilac],
      [0.12, PALETTE.flowerYellow],
    ];
    for (const [radius, colour] of bands) {
      ctx.fillStyle = hexToCss(colour);
      ctx.beginPath();
      ctx.arc(mid, mid, size * radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // A ring of scallops round the pale band: the one detail that stops five
    // concentric circles reading as a dartboard.
    ctx.fillStyle = hexToCss(PALETTE.markerPink);
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(
        mid + Math.cos(angle) * size * 0.35,
        mid + Math.sin(angle) * size * 0.35,
        size * 0.035,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    return decalTexture(canvas);
  });
}
