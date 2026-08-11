/**
 * **Does each hat actually fit the head it is worn on?**
 *
 * ```
 * node \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/measure-hat-fit.mts
 * ```
 *
 * `check:assets` already guards a hat's *declared* height against its built
 * one. Nothing guarded the thing the family actually complained about: how big
 * a hat is **next to the head it sits on**. Hats are authored in
 * `art/models/hats.ts` in absolute metres; the kid's skull is authored in
 * `art/models/kid.ts` as `0.44 * HEAD`. When the cartoon pass took `HEAD` to
 * 1.5 every head-mounted thing scaled with it — hair, ears, face patch, the
 * hat anchor itself — except the hats, which are in another file and carry no
 * reference to it. So every hat shrank to two thirds of its intended fit
 * overnight and no check noticed.
 *
 * This builds the real kid and the real hats and measures both, then prints
 * three numbers per hat:
 *
 * - **span**, the hat's widest horizontal reach over the wearer's bare head's,
 *   both about the same vertical axis (the hat anchor's), so a tilted sun brim
 *   is measured where it really is rather than through an axis-aligned box;
 * - **of kid**, where the top of the whole child ends up as a multiple of her
 *   bare height;
 * - **eye**, the clearance between the lowest the hat comes in front of her
 *   eyes and the top of an eye.
 *
 * Vertices, not bounding boxes, and instanced meshes expanded, via
 * `art/style/measure.ts`'s own `visiblePoints` — so the rules about which
 * meshes count are the same ones the models are measured by, rather than a
 * second copy of the traversal (hidden meshes and meshes under hidden parents
 * do not count: the kid tucks her hair away under a hat, and measuring it would
 * report a bunch).
 */
import '../scripts/headless-canvas.mjs';
import { Object3D } from 'three';
import { createKid, KID_HAT_ANCHOR_Y, kidEyeTopAt } from '../src/art/models/kid.ts';
import { visiblePoints } from '../src/art/style/measure.ts';
import {
  createHat,
  hatDisplayScale,
  hatSize,
  HAT_KINDS,
  HAT_STAND_SPACING,
  type HatKind,
} from '../src/art/models/hats.ts';

const TAU = Math.PI * 2;

/** Horizontal and vertical extent of a model, about some other object's axes. */
interface Extent {
  /** Widest span across the frame's vertical axis, in metres. */
  readonly width: number;
  /** Highest visible point above the frame's origin, in metres. */
  readonly top: number;
  /** Lowest visible point, in metres. Negative below the frame's origin. */
  readonly bottom: number;
}

function extentIn(root: Object3D, frame: Object3D): Extent {
  let radius = 0;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  visiblePoints(
    root,
    (point) => {
      radius = Math.max(radius, Math.hypot(point.x, point.z));
      top = Math.max(top, point.y);
      bottom = Math.min(bottom, point.y);
    },
    frame,
  );
  if (top === Number.NEGATIVE_INFINITY) return { width: 0, top: 0, bottom: 0 };
  return { width: radius * 2, top, bottom };
}

/** How wide `root` is in a thin horizontal slice at `y`, in `frame`'s space. */
function widthAt(root: Object3D, frame: Object3D, y: number, band = 0.04): number {
  let radius = 0;
  visiblePoints(
    root,
    (point) => {
      if (Math.abs(point.y - y) > band) return;
      radius = Math.max(radius, Math.hypot(point.x, point.z));
    },
    frame,
  );
  return radius * 2;
}

/**
 * How much clear air a hat leaves above the wearer's eyes, in metres.
 *
 * Per azimuth against {@link kidEyeTopAt}, and for the reason given there: an
 * eye is an ellipse with no height at all at its outer corner, so the lowest
 * brim anywhere in the eyes' azimuth range is not a fair comparison and
 * condemns every hat that correctly frames a face. `Infinity` if nothing the
 * hat is made of crosses her eyes at all.
 *
 * `kidEyeTopAt` is in the `crown` group's frame and a hat is measured about the
 * hat anchor, hence the one shift by {@link KID_HAT_ANCHOR_Y}. Nothing here
 * reconstructs where the eyes are; the whole point of that export is that there
 * is one description of them. Do not be tempted by `check:hair`'s copy — it is
 * written in the *hair shells'* frame and puts the eyes 106 mm too high here.
 */
function eyeClearance(hat: Object3D, frame: Object3D): number {
  const buckets = 360;
  const lowest = new Array<number>(buckets).fill(Number.POSITIVE_INFINITY);
  visiblePoints(
    hat,
    (point) => {
      if (point.z <= 0) return;
      const bucket = Math.floor(((Math.atan2(point.x, point.z) + Math.PI) / TAU) * buckets);
      lowest[bucket] = Math.min(lowest[bucket] as number, point.y);
    },
    frame,
  );
  let clearance = Number.POSITIVE_INFINITY;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const brim = lowest[bucket] as number;
    if (!Number.isFinite(brim)) continue;
    const eye = kidEyeTopAt(((bucket + 0.5) / buckets) * TAU - Math.PI);
    if (eye === null) continue;
    clearance = Math.min(clearance, brim - (eye - KID_HAT_ANCHOR_Y));
  }
  return clearance;
}

// The bare head: skull, ears and face patch, with every hair part hidden.
//
// Hair is hidden by hand here, in full, rather than through `setHatWorn`:
// that call no longer touches hair visibility at all (31 July 2026 — hair is
// now always fully drawn regardless of whether a hat is worn; only Mohican's
// crest is handled specially, by a *worn hat* declining to render instead,
// see `art/models/hair.ts`'s `HairPart.hideUnderHat`), and even before that
// change it only ever tucked the spikes, which no longer applies to Spiky at
// all — spiky and a hat are now allowed to overlap, clipping included.
// Bunches were always left alone by it, and they hang out to 1.82 m across —
// comparing a hat's brim against a pair of bunches would say the sun hat is too narrow
// when it is the skull, at the crown, that a hat has to look right against.
// `setHatWorn(true)` is still called, purely so `kid.height` below re-measures.
const kid = createKid();
kid.setHatWorn(true);
for (const part of kid.hairParts) part.mesh.visible = false;
const head = extentIn(kid.head, kid.hatAnchor);
const kidHeight = kid.height;

console.log(`kid: ${kidHeight.toFixed(3)} m tall, bare head ${head.width.toFixed(3)} m wide`);
console.log(`hat anchor (crown): ${kid.hatAnchorHeight.toFixed(3)} m above the feet`);
// Read the real per-hat multiplier off `hats.ts` rather than typing it out —
// see `hatSize`'s own doc comment for why a hand-typed copy here is exactly
// what went stale on 31 July.
const sizeNote = HAT_KINDS.map((k) => `${k} ×${hatSize(k).toFixed(3)}`).join(', ');
console.log(`worn size, per hat: ${sizeNote}\n`);

const header = [
  'hat'.padEnd(12),
  'width'.padStart(7),
  'head'.padStart(7),
  'grip'.padStart(6),
  'span'.padStart(6),
  'rise'.padStart(7),
  'tip'.padStart(7),
  'of kid'.padStart(7),
  'eye'.padStart(7),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

/**
 * How wide a hat may be as a fraction of the bare head, how far past her own
 * height it may take the wearer, and how much clear air it must leave above her
 * eyes.
 *
 * **Re-derived 1 August 2026**, from Jim's live-screenshot verdict on every hat
 * in the character-creation preview: the Cheery Cap was "literally wider than
 * the kid is tall" at the old ×1.95 (2.392 m span on a 2.087 m child), and the
 * Flower Crown, RiPika Cap and Trilla Hat were all "too big". Only the Sparkly
 * Crown and the two hats named "good as-is" (Party, Bobble) kept their size —
 * see `hats.ts`'s `HAT_SIZE_EXTRA` for the corrected per-hat multiplier and the
 * quote it came from.
 *
 * As before (31 July 2026), **`MIN_SPAN`/`MAX_SPAN` are drift detectors around
 * a size the family chose, not physical limits.** Re-deriving them when the
 * family deliberately changes a size is correct; the thing that would be wrong
 * is weakening them to paper over a size nobody signed off on. So each bound
 * below is checked against *why* it would have caught the bug it exists for,
 * not just moved to wherever today's numbers happen to sit.
 *
 * The measured park is now 0.83–1.66 wide and up to 1.43× tall — tighter on
 * both ends than the 31 July range (0.87–2.12, up to 1.51×), because this pass
 * mostly made hats *smaller*.
 *
 * - **`MIN_SPAN` 0.7.** Sits below the narrowest hat today (the Flower Crown,
 *   0.83) and still above the whole pre-×1.5 range from 31 July (0.58–1.09) —
 *   the failure mode `MIN_SPAN` exists for (a hat quietly losing its `HAT_SIZE`
 *   multiplier, exactly as happened when the Cheery Cap was rebuilt) still
 *   trips it just as loudly as before.
 * - **`MAX_SPAN` 2.0**, comfortably above the widest hat built (the Sun Hat,
 *   1.66, now the widest after the Cheery Cap's own reduction) but well below
 *   both the old ×1.95 Cheery Cap (2.12) and the "wider than she is tall" one
 *   (2.392) — so either of those regressing reintroduces would fail here.
 * - **`MAX_TIP` 1.5.** The tallest hat is unchanged (Party, ×1.43 — Jim's own
 *   calibration reference, untouched by this pass) with headroom kept for the
 *   same reason as before: the design the family rejected as "a second head,
 *   not a hat" took her to 1.72×, and a hat should have little room in this
 *   dimension.
 * - **`MIN_EYE`**, in metres, is unchanged and is not a drift detector but a
 *   rule: GAME_DESIGN.md's standing "a hood never comes down over the wearer's
 *   face", taken from `check:hair`'s `EYE_MARGIN`. The crown now comes closest
 *   at 195 mm, still nearly ten times over.
 */
const MIN_SPAN = 0.7;
const MAX_SPAN = 2.0;
const MAX_TIP = 1.5;
const MIN_EYE = 0.02;

/**
 * How much air two hats must leave between them on neighbouring stands.
 *
 * The hat shop's stands are {@link HAT_STAND_SPACING} apart, and nothing ever
 * measured whether what stood on them fitted: the RiPika cap and the Trilla
 * bonnet were overlapping by 9 mm on `main`, and the 31 July ×1.95 put the
 * Cheery Cap 109 mm into the sun hat beside it.
 *
 * Checked against **the widest two hats in the shop**, not against the pairs
 * that happen to be adjacent today, so it holds however `fitouts.ts` reorders
 * the row — and it is strictly the harder test.
 */
const MIN_STAND_GAP = 0.06;

interface Row {
  readonly kind: HatKind;
  readonly grip: number;
  readonly span: number;
  readonly eye: number;
  /** Width on a shop stand, in metres. */
  readonly display: number;
}
const rows: Row[] = [];
const failures: string[] = [];

for (const kind of HAT_KINDS) {
  const hat = createHat(kind);
  kid.hatAnchor.add(hat.root);
  const worn = extentIn(hat.root, kid.hatAnchor);
  // Where the hat's band or brim meets the skull, and how wide the skull is
  // right there. **This** is fit: a band narrower than the skull it sits on
  // has the head bulging out through it, and no amount of overall width makes
  // up for it. Overall width only says how far a brim reaches past the ears.
  const bandY = worn.bottom;
  const band = widthAt(hat.root, kid.hatAnchor, bandY);
  const eye = eyeClearance(hat.root, kid.hatAnchor);
  // Take the hat off *before* measuring the skull. `hatAnchor` is inside
  // `kid.head`, so a hat left on is walked as part of the head — which read as
  // a flawless `grip` of exactly 1.00 for all eight hats the moment they grew
  // wide enough to be the widest thing in that slice.
  kid.hatAnchor.remove(hat.root);
  const skull = widthAt(kid.head, kid.hatAnchor, bandY);

  const grip = skull > 0 ? band / skull : 0;
  const span = worn.width / head.width;
  rows.push({ kind, grip, span, eye, display: worn.width * hatDisplayScale(kind) });

  // `tip` is where the top of the whole child ends up, and `of kid` is that as
  // a multiple of her bare height — a hat that adds three quarters of a child
  // is not a hat, whatever its width says.
  const tip = kid.hatAnchorHeight + worn.top;
  if (span < MIN_SPAN || span > MAX_SPAN) {
    failures.push(
      `${kind} is ${span.toFixed(2)}× the head wide; hats run ${MIN_SPAN}–${MAX_SPAN}×.`,
    );
  }
  if (tip / kidHeight > MAX_TIP) {
    failures.push(
      `${kind} takes the wearer to ${(tip / kidHeight).toFixed(2)}× her own height ` +
        `(limit ${MAX_TIP}×) — that is a second head, not a hat.`,
    );
  }
  if (eye < MIN_EYE) {
    failures.push(
      `${kind} comes to within ${(eye * 1000).toFixed(0)} mm of the top of her eyes ` +
        `(limit ${(MIN_EYE * 1000).toFixed(0)} mm) — that hat is over her face.`,
    );
  }
  console.log(
    [
      kind.padEnd(12),
      band.toFixed(3).padStart(7),
      skull.toFixed(3).padStart(7),
      grip.toFixed(2).padStart(6),
      span.toFixed(2).padStart(6),
      worn.top.toFixed(3).padStart(7),
      tip.toFixed(3).padStart(7),
      (tip / kidHeight).toFixed(2).padStart(7),
      (Number.isFinite(eye) ? eye.toFixed(3) : '  none').padStart(7),
    ].join(' '),
  );
}

// `grip` is reported but not gated, and now reads the other way round from the
// way it used to. Before the ×1.5 a rim was *buried* in the skull (under 1) and
// that is how a band grips rather than hovers; an oversized dressing-up hat on
// an unchanged head has to stand proud of it instead, so over 1 is now right
// and the number says how loosely it perches. `span` is the number that says
// "too small" out loud, and `eye` the one that says "I can't see".
console.log(
  '\nwidth/head = the hat at its lowest ring against the skull there;\n' +
    'grip = that ratio (oversized hats perch, so ≳ 1); span = widest ÷ bare head;\n' +
    'eye = clear air between the hat and the top of an eye, in metres.',
);
const loosest = rows.reduce((a, b) => (b.grip > a.grip ? b : a));
const narrow = rows.reduce((a, b) => (b.span < a.span ? b : a));
const nearest = rows.reduce((a, b) => (b.eye < a.eye ? b : a));
console.log(
  `loosest rim: ${loosest.kind} at ${loosest.grip.toFixed(2)}×; ` +
    `narrowest hat: ${narrow.kind} at ${narrow.span.toFixed(2)}× the head;\n` +
    `closest to an eye: ${nearest.kind}, ${(nearest.eye * 1000).toFixed(0)} mm clear.`,
);

// ------------------------------------------------------------ the shop stands
const widest = [...rows].sort((a, b) => b.display - a.display);
const [first, second] = widest as [Row, Row];
const gap = HAT_STAND_SPACING - (first.display + second.display) / 2;
console.log(
  `\nshop stands ${HAT_STAND_SPACING} m apart: widest two are ${first.kind} at ` +
    `${first.display.toFixed(3)} m and ${second.kind} at ${second.display.toFixed(3)} m, ` +
    `leaving ${(gap * 1000).toFixed(0)} mm between them.`,
);
if (gap < MIN_STAND_GAP) {
  failures.push(
    `${first.kind} and ${second.kind} would come within ${(gap * 1000).toFixed(0)} mm on ` +
      `neighbouring stands (want ${(MIN_STAND_GAP * 1000).toFixed(0)} mm) — turn ` +
      `HAT_DISPLAY_HEAD down in hats.ts.`,
  );
}

if (failures.length > 0) {
  console.error(`\nhat fit: ${failures.length} hat(s) do not fit the head:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`hat fit: all ${rows.length} hats fit the head they sit on.`);
}
