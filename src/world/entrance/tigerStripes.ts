import { CanvasTexture, RepeatWrapping, type BufferGeometry, type Mesh } from 'three';
import { PALETTE, hexToCss } from '../../core/palette';
import { markShared } from '../../art/style/materials';

/**
 * **Tiger stripes for the cat bus** — one tiling canvas, painted into the
 * bodywork's own UV space.
 *
 * Jim, 29 August 2026: the bus *"should have a tiger stripe textured design"*.
 * He confirmed the same day that the stripes go on the **body**, not on the
 * wheels — which is what makes the vehicle read as a big friendly cat rather
 * than as a bus with unusual tyres.
 *
 * ## Why this is a texture and not a mesh
 *
 * CLAUDE.md's rule, written after both critter hoods' faces were invisible in
 * the running game for a fortnight: **paint a flat appliqué into the item's own
 * UV space; never add a second mesh positioned by a formula that has to track
 * the first one's surface.** A stripe is exactly that kind of appliqué. Built
 * as geometry it would be thirty-odd curved shells, each of which has to agree
 * with a `RoundedBoxGeometry`'s fillet, and each of which is a place for the
 * hood-face bug to hide. Painted, there is one surface and nothing to keep in
 * step.
 *
 * ART_DIRECTION §3's governing rule still binds — *a painted texture must look
 * like something that could have been built as geometry, just wasn't.* So a
 * stripe here is a **flat fill with a bold ink outline**, in the house palette,
 * with a clear silhouette: no gradient, no soft edge, no painted shading. It is
 * drawn the way a stripe cut out of felt and stuck on would look, which is the
 * point.
 *
 * ## The unwrap, and why it is one line
 *
 * A `RoundedBoxGeometry`'s own UVs run 0..1 across each of the six faces, so a
 * single tile stretched over them would be six differently-squashed copies of
 * the same picture: the flanks are 15.8 x 1.5 m and the front is 5.3 x 1.5, and
 * a stripe would be four times as wide on one as on the other. Every part of
 * this bus is a different size, so **there is no `repeat` that works.**
 *
 * Instead the UVs are rewritten from the vertex's **position in the bus's own
 * space**, so a stripe is the same number of metres wide wherever it lands and
 * the pattern runs unbroken from the lower shell up over the header band and
 * across the roof, though those are three separate meshes:
 *
 * ```
 * u = z / STRIPE_PITCH_ALONG
 * v = (|x| + max(0, spineY - y) + capDepth) / STRIPE_PITCH_DRAPE
 * ```
 *
 * `v` is a **drape**: how far the paint has run from the spine, over the roof
 * and down the flank, which is where a tiger's stripes come from. It is
 * continuous everywhere — on the roof the second term is zero so it reads `|x|`,
 * at the roof edge `|x|` is already the half-width, and down the flank the first
 * term is pinned at the half-width while the second grows. There is no seam to
 * hide because the two expressions agree at the join by construction rather
 * than by two numbers being kept equal by hand.
 *
 * `capDepth` folds the front and back caps into the same drape, so the stripes
 * wrap round the ends as bands instead of one stripe being smeared the whole
 * width of the bus.
 *
 * ## And why the canvas tiles both ways
 *
 * Because the unwrap above is in **metres**, not in 0..1 — a 15.8 m flank is
 * nearly four tiles along and the drape is one tile down. So every stripe that
 * crosses an edge of the canvas is drawn again on the opposite edge, and every
 * stripe's horizontal wander and width are periodic in `v`, which is what makes
 * the top edge meet the bottom.
 */

/** How many metres along the bus one tile of the pattern covers. */
const STRIPE_PITCH_ALONG = 6.0;
/** How many metres of drape — spine, over the roof, down the flank — likewise. */
const STRIPE_PITCH_DRAPE = 3.2;
/** Per ART_DIRECTION §7's texture budget: tiling maps are 512². */
const STRIPE_CANVAS = 512;

/**
 * The stripes in one tile, as fractions of it.
 *
 * Roughly a fifth of a tile wide each — **twice what they were first drawn at**,
 * which came out as a fine pinstripe: at 6 m to the tile a 0.04 stripe is 0.24 m
 * on a 15.8 m bus, and at the distance the arrival's camera actually sits from
 * it that reads as corrugation rather than as a tiger. Sized against the frame
 * a player sees, not against the canvas.
 *
 * Hand-placed rather than evenly spaced, because evenly spaced stripes read as
 * a barcode: a tiger's are irregular, and irregular is the whole difference
 * between "striped" and "corrugated". `wander` and `phase` bend each stripe as
 * it runs down the drape, `taper` pinches it, and both are periodic in `v` so
 * the tile's top edge meets its bottom.
 */
const STRIPES: readonly { at: number; width: number; wander: number; phase: number; taper: number }[] = [
  { at: 0.06, width: 0.105, wander: 0.030, phase: 0.0, taper: 0.42 },
  { at: 0.26, width: 0.076, wander: 0.020, phase: 2.1, taper: 0.55 },
  { at: 0.41, width: 0.120, wander: 0.036, phase: 4.0, taper: 0.34 },
  { at: 0.60, width: 0.068, wander: 0.024, phase: 1.2, taper: 0.60 },
  { at: 0.75, width: 0.112, wander: 0.032, phase: 5.1, taper: 0.40 },
  { at: 0.91, width: 0.084, wander: 0.018, phase: 3.3, taper: 0.50 },
];

/** How many steps each stripe's outline is drawn in, down the tile. */
const STRIPE_STEPS = 48;

let cached: CanvasTexture | null = null;

/**
 * The tiling stripe map. Built once and shared, so it is `markShared` — every
 * mesh on the bus points at this one texture and a `disposeTree` on any of them
 * must not free it out from under the others.
 */
export function tigerStripeTexture(): CanvasTexture {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = STRIPE_CANVAS;
  canvas.height = STRIPE_CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('tigerStripeTexture: no 2d context');

  // The bus's own colour, as the background the stripes sit on. Painting the
  // base into the texture rather than leaving it transparent is the same
  // "one surface, one texture" move `paintFaceOnFill` makes — everything the
  // stripes do not cover comes out exactly the bodywork's flat colour, from the
  // one map, with no second material to disagree with.
  ctx.fillStyle = hexToCss(PALETTE.pathEdge);
  ctx.fillRect(0, 0, STRIPE_CANVAS, STRIPE_CANVAS);

  // Each stripe drawn three times — at its own u, and one tile either side —
  // so a stripe that runs off the right edge arrives on the left. Nothing is
  // clipped, so this is simply how the seam closes.
  for (const stripe of STRIPES) {
    for (const wrap of [-1, 0, 1] as const) {
      paintStripe(ctx, stripe, wrap);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  cached = markShared(texture);
  return texture;
}

/** Frees the shared stripe map. For the material cache's own teardown only. */
export function disposeTigerStripes(): void {
  cached?.dispose();
  cached = null;
}

function paintStripe(
  ctx: CanvasRenderingContext2D,
  stripe: (typeof STRIPES)[number],
  wrap: number,
): void {
  const size = STRIPE_CANVAS;
  // Two edges walked in opposite directions and closed — a ribbon, not a
  // stroked line, so its width can vary down its length the way a real stripe
  // tapers towards the belly.
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let step = 0; step <= STRIPE_STEPS; step += 1) {
    const v = step / STRIPE_STEPS;
    const angle = v * Math.PI * 2 + stripe.phase;
    const centre = (stripe.at + wrap) * size + Math.sin(angle) * stripe.wander * size;
    // Never narrower than a third of its nominal width: a stripe that pinches
    // to nothing loses its ink outline to mip-mapping and reads as a smudge.
    const half = ((stripe.width * (1 - stripe.taper * (0.5 + 0.5 * Math.cos(angle)))) * size) / 2;
    const y = v * size;
    left.push([centre - half, y]);
    right.push([centre + half, y]);
  }

  ctx.beginPath();
  ctx.moveTo(...(left[0] as [number, number]));
  for (const point of left.slice(1)) ctx.lineTo(...point);
  for (const point of [...right].reverse()) ctx.lineTo(...point);
  ctx.closePath();

  ctx.fillStyle = hexToCss(PALETTE.woodDark);
  ctx.fill();
  // A bold ink edge, per ART_DIRECTION §4 — never black, always `PALETTE.ink`.
  // This is what stops a flat fill reading as a stain and makes it read as a
  // shape somebody cut out and stuck on.
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = size * 0.008;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * Rewrites `mesh`'s UVs so the stripe map lands on it at a fixed world scale.
 *
 * `offset` is where the mesh's own origin sits in the bus's space, because the
 * unwrap is a function of position on the *vehicle* and a mesh's vertices are
 * in its own local frame. Passed in rather than read off `mesh.position` so
 * that a mesh hanging on a hinge — the door — can be given the position it
 * occupies when shut, which is the pose its stripes should line up in.
 *
 * `spineY` is the top of the bodywork, where the paint runs from. `alongFrom`
 * and `alongTo` are where the flanks stop and the end caps begin — **a pair
 * rather than a half-span**, because this bus's bodywork is not centred on its
 * own origin: `bodyCentreZ` is pulled 1.51 m forward so the boxy body sinks
 * into the round cat face, and a symmetric `|z| > half` test would have put the
 * cap band 1.5 m inside the back wall and 1.5 m out in front of the nose.
 *
 * **Mutates the geometry**, so never hand it a geometry shared with something
 * that must not be striped. Every mesh this is called on in `catBus.ts` builds
 * its own `RoundedBoxGeometry`; the window pillars, which share one geometry
 * between ten posts, deliberately do not get stripes — they sit between the
 * panes and read as window frames, which is not a thing a tiger has.
 */
export function drapeStripeUvs(
  mesh: Mesh,
  offset: { x: number; y: number; z: number },
  spineY: number,
  alongFrom: number,
  alongTo: number,
): void {
  const geometry: BufferGeometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!position || !uv) return;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i) + offset.x;
    const y = position.getY(i) + offset.y;
    const z = position.getZ(i) + offset.z;
    const capDepth = Math.max(0, alongFrom - z, z - alongTo);
    const drape = Math.abs(x) + Math.max(0, spineY - y) + capDepth;
    uv.setXY(i, z / STRIPE_PITCH_ALONG, drape / STRIPE_PITCH_DRAPE);
  }
  uv.needsUpdate = true;
}
