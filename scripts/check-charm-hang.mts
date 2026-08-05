/**
 * **Every backpack shape hangs a keychain on itself, not in mid-air.**
 *
 * ```
 * npm run check:charm-hang
 * ```
 *
 * `backpacks.ts`'s `CHARM_HANGS` says where a charm clips on for each of the
 * five authored bags, and `entities/WornKeychain.ts` hangs one there. A number
 * that misses the bag is invisible in code review and in a diff — it looks like
 * every other number in the table — and shows up only as a charm floating a
 * hand's width off a six-year-old's rucksack.
 *
 * That is not hypothetical. The original keychain work measured **one** offset
 * against the **one** bag the model had in July, and by the time five shapes
 * landed it was wrong for all of them; re-measuring per shape then found the
 * `heart` sitting **0.122 m** clear of its own surface, because a heart tapers
 * to a point at the bottom where every other bag has a corner. Four of five
 * looked fine. This script is the ratchet so the sixth shape cannot repeat it.
 *
 * It measures the *built* bags — every visible vertex of the parts that shape
 * actually shows — and asks how far the charm anchor is from the nearest one.
 * It never re-derives `CHARM_HANGS` from the geometry, which would only prove
 * the table agrees with itself.
 */
import '../scripts/headless-canvas.mjs';
import { Group, Vector3 } from 'three';
import { visiblePoints } from '../src/art/style/measure.ts';
import { toonMaterial } from '../src/art/style/materials.ts';
import { buildBackpacks, BACKPACK_KINDS } from '../src/art/models/backpacks.ts';

/**
 * How far a charm anchor may sit from the nearest bit of its bag, in metres.
 *
 * Not zero, and not the table's own precision: an anchor is meant to sit just
 * *proud* of the surface so the charm's ring is not buried in it, and
 * `visiblePoints` samples vertices rather than the continuous surface, so a
 * point genuinely on a rounded flank still reads a couple of centimetres from
 * the nearest sampled vertex. The five healthy shapes measure 0.015-0.042 m.
 *
 * 0.08 m is where a charm stops touching the bag at all — twice the worst
 * healthy shape, and well inside the 0.122 m the broken `heart` measured, so
 * this catches that class of error with room for ordinary authoring drift.
 */
const TOLERANCE = 0.08;

const rows: string[] = [];
const complaints: string[] = [];

for (const kind of BACKPACK_KINDS) {
  const body = new Group();
  const rig = buildBackpacks({
    body,
    bagMaterial: toonMaterial(0xff88aa),
    bagDarkMaterial: toonMaterial(0xcc6688),
    kind,
    kinds: [kind],
  });
  // Through `setKind`, not the constructor's default: this is the path a child
  // switching bags in the creator actually takes, and the anchor has to move.
  rig.setKind(kind);
  const anchor = rig.charmAnchor.position;

  let nearest = Infinity;
  for (const part of rig.parts) {
    if (!part.kinds.includes(kind)) continue;
    visiblePoints(
      part.mesh,
      (point) => {
        const distance = point.distanceTo(anchor);
        if (distance < nearest) nearest = distance;
      },
      body,
    );
  }

  rows.push(
    `  ${kind.padEnd(11)} anchor (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)}, ` +
      `${anchor.z.toFixed(2)})  ${nearest.toFixed(3)} m from the bag`,
  );
  if (!Number.isFinite(nearest)) {
    complaints.push(`${kind} built no visible geometry to hang a charm on`);
  } else if (nearest > TOLERANCE) {
    complaints.push(
      `${kind}'s charm anchor is ${nearest.toFixed(3)} m from the nearest bit of the bag, ` +
        `over the ${TOLERANCE} m tolerance — a keychain clipped there hangs in mid-air. ` +
        `Fix the '${kind}' row of CHARM_HANGS in src/art/models/backpacks.ts.`,
    );
  }
}

console.log(rows.join('\n'));
if (complaints.length > 0) {
  console.error(`\nCHARM HANG: ${complaints.length} problem(s)\n${complaints.join('\n')}`);
  process.exit(1);
}
console.log(
  `charm hang: all ${BACKPACK_KINDS.length} backpack shapes clip a keychain to real geometry. ✓`,
);
