/**
 * **Does each hat actually fit the head it is worn on?**
 *
 * ```
 * node --experimental-strip-types \
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
import { createHat, HAT_KINDS, HAT_SIZE, type HatKind } from '../src/art/models/hats.ts';

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
// Hair is excluded deliberately rather than left to `setHatWorn(true)`, which
// only tucks the parts that would spear *through* a hat (the spikes). Bunches
// stay, and they hang out to 1.82 m across — comparing a hat's brim against a
// pair of bunches would say the sun hat is too narrow when it is the skull, at
// the crown, that a hat has to look right against.
const kid = createKid();
kid.setHatWorn(true);
for (const part of kid.hairParts) part.mesh.visible = false;
const head = extentIn(kid.head, kid.hatAnchor);
const kidHeight = kid.height;

console.log(`kid: ${kidHeight.toFixed(3)} m tall, bare head ${head.width.toFixed(3)} m wide`);
console.log(`hat anchor (crown): ${kid.hatAnchorHeight.toFixed(3)} m above the feet`);
console.log(`hats are worn at ×${HAT_SIZE} life size (hats.ts: HAT_SIZE), crown and cap ×1.95\n`);

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
 * **Re-derived 31 July 2026**, when the family asked for every hat ×1.5 and the
 * crown and the Cheery Cap ×1.95 (`hats.ts`'s `HAT_SIZE`). The old bounds —
 * 0.45/1.15/1.45 — were fitted to the sizes the hats happened to have that
 * morning, so a deliberate change of size necessarily moves them. That is not
 * the same thing as weakening an assertion to make a number pass, and the
 * distinction is worth stating out loud: **`MIN_SPAN` and `MAX_SPAN` are drift
 * detectors around a size the family chose, not physical limits.** When the
 * family chooses a different size they are re-derived from the new one; when
 * anything *else* moves them, that is the drift they exist to catch.
 *
 * The measured park is now 0.87–2.12 wide and up to 1.51× tall.
 *
 * - **`MIN_SPAN` 0.75.** The important one, and the reason this whole branch
 *   exists. The pre-×1.5 hats spanned 0.58–1.09, and every one of them passed
 *   the old 0.45 bound — so when the Cheery Cap and the critter hoods were
 *   rebuilt at their original proportions and the family's ×1.5 was silently
 *   lost, `check:hat-fit` stayed green through it. 0.75 sits *above* the whole
 *   un-enlarged range and below the smallest enlarged hat (party, 0.87), so
 *   losing `HAT_SIZE` again fails here loudly. It also subsumes the old 0.45,
 *   which was set by the "much too small" party hat at 0.38.
 * - **`MAX_SPAN` 2.40**, ~13% above the widest hat built (the cap at 2.12).
 * - **`MAX_TIP` 1.60.** Squeezed deliberately: the tallest hat now takes the
 *   wearer to 1.51×, and the design the family rejected as "a second head, not
 *   a hat" — the old RiPika head worn whole — took her to 1.72×. A new hat has
 *   little room in this dimension on purpose, because it is the dimension a
 *   rejected design failed on.
 * - **`MIN_EYE`**, in metres, is not a drift detector but a rule:
 *   GAME_DESIGN.md's standing "a hood never comes down over the wearer's face".
 *   Taken from the game's own number for clear air above an eye — `check:hair`'s
 *   `EYE_MARGIN`, the margin a fringe must leave — because a brim in her eyes
 *   and a fringe in her eyes are the same complaint. The worst hat built has
 *   0.208 m, ten times over.
 */
const MIN_SPAN = 0.75;
const MAX_SPAN = 2.4;
const MAX_TIP = 1.6;
const MIN_EYE = 0.02;

interface Row {
  readonly kind: HatKind;
  readonly grip: number;
  readonly span: number;
  readonly eye: number;
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
  rows.push({ kind, grip, span, eye });

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

if (failures.length > 0) {
  console.error(`\nhat fit: ${failures.length} hat(s) do not fit the head:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`hat fit: all ${rows.length} hats fit the head they sit on.`);
}
