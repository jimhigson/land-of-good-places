/**
 * **Nothing that peeks out of the backpack may be bigger than the backpack.**
 *
 * ```
 * npm run check:backpack-peek       # or --verbose for the full table
 * ```
 *
 * `BackpackPeek` (see its own header) pops a random owned item up out of the
 * player's bag for a couple of seconds every so often. It scales whatever it
 * picked to `PEEK_HEIGHT` — bag-sized — by dividing that target by the model's
 * own size. Until 2 August 2026 "own size" meant `AssetHandle.height` alone,
 * the model's *vertical* extent, which is the right stand-in for a teddy or a
 * mouse but not for the sun hat: 0.38 m tall and 2.33 m wide, so
 * `PEEK_HEIGHT / height` came out to ≈1.0 and its full-width brim erupted from
 * the bag at almost life size, overlapping the player, for the couple of
 * seconds before it ducked back down — reported live by the family as "a giant
 * sun hat randomly appears overlapping with the player and vanishes after a
 * few seconds."
 *
 * The fix bounds the peek scale by the model's width as well as its height
 * ({@link footprint} in `BackpackPeek.ts`). This script is the ratchet: it
 * builds every catalogue item, calls the *real* `footprint`/`PEEK_HEIGHT`
 * BackpackPeek actually uses (not a copy that could drift out of step with
 * it), and asserts the resulting peek stays within a bag-sized box. A future
 * change to the formula — or a future item shaped like the sun hat, wide
 * rather than tall — fails here instead of waiting for a family live-QA
 * session to spot a giant hat on a six-year-old's back.
 */
import '../scripts/headless-canvas.mjs';
import { visiblePoints } from '../src/art/style/measure.ts';
import { SHOP_ITEMS, EGG_PRIZES } from '../src/world/building/shops/catalogue.ts';
import { PEEK_HEIGHT, footprint } from '../src/entities/parade/BackpackPeek.ts';

/**
 * How far over `PEEK_HEIGHT` a peeked item's width or height may land, in
 * metres. Not zero: `footprint`'s own `Math.max(0.12, …)` floor means a
 * vanishingly thin item (the flower crown is 63 mm tall unscaled) is scaled up
 * rather than down, and `place()`'s `easeOutBack` overshoot bounces a couple
 * of percent past 1 on the way in. Both are deliberate and small; anything
 * past this tolerance is the sun-hat bug's shape again — a whole axis the
 * scale formula is not accounting for.
 */
const TOLERANCE = 0.08;

interface Row {
  readonly id: string;
  readonly height: number;
  readonly width: number;
  readonly peekHeight: number;
  readonly peekWidth: number;
}

const rows: Row[] = [];
const failures: string[] = [];

for (const item of [...SHOP_ITEMS, ...EGG_PRIZES]) {
  const handle = item.model();
  let top = 0;
  let bottom = 0;
  let radius = 0;
  visiblePoints(handle.root, (point) => {
    if (point.y > top) top = point.y;
    if (point.y < bottom) bottom = point.y;
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  });
  const height = top - bottom;
  const width = radius * 2;

  const scale = PEEK_HEIGHT / Math.max(0.12, footprint(handle.root));
  const peekHeight = height * scale;
  const peekWidth = width * scale;

  rows.push({ id: item.id, height, width, peekHeight, peekWidth });

  const worst = Math.max(peekHeight, peekWidth);
  if (worst > PEEK_HEIGHT + TOLERANCE) {
    failures.push(
      `${item.id}: peeks at ${peekWidth.toFixed(3)} m wide × ${peekHeight.toFixed(3)} m tall ` +
        `— exceeds the ${PEEK_HEIGHT} m target by more than ${TOLERANCE} m`,
    );
  }
}

if (process.argv.includes('--verbose') || failures.length > 0) {
  console.log(
    ['id'.padEnd(22), 'height', 'width', '| peekH', 'peekW'].map((h) => h.padStart(8)).join('  '),
  );
  for (const row of rows) {
    console.log(
      [
        row.id.padEnd(22),
        row.height.toFixed(3).padStart(8),
        row.width.toFixed(3).padStart(8),
        '|',
        row.peekHeight.toFixed(3).padStart(6),
        row.peekWidth.toFixed(3).padStart(6),
      ].join('  '),
    );
  }
  console.log('');
}

if (failures.length > 0) {
  console.error(`check:backpack-peek: ${failures.length} item(s) peek out oversized.\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `\nEvery item BackpackPeek can show must stay within ${PEEK_HEIGHT} m (+${TOLERANCE} m tolerance)` +
      '\nin both height and width. See footprint() and PEEK_HEIGHT in' +
      '\nsrc/entities/parade/BackpackPeek.ts.',
  );
  process.exit(1);
}

console.log(`check:backpack-peek: ${rows.length} catalogue items all peek bag-sized.`);
