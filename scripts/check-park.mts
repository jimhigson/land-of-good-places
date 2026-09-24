/**
 * **The park invariant checker.** ARCHITECTURE-DECISIONS Decision 5, §"The
 * invariants (machine-checked, not claimed)".
 *
 * ```
 * npm run check:park            # or --verbose for the full route table
 * ```
 *
 * The park is about to stop being authored. A seeded solver will place the
 * castle, the fountain and every ride; a solver will grow both railways; paths
 * will be generated to react to them. Decision 5's own words for why this
 * script exists first: *"Four of tonight's bugs were claims nobody re-derived —
 * a generated park without a machine-checked contract would be that disease at
 * park scale."*
 *
 * So the six invariants are stated here as measurements of the **real** park —
 * the actual `World`, built headlessly by `scripts/park-harness.mts`, with the
 * actual `CollisionWorld`, the actual `NavGrid` lattice and the actual solved
 * train curve. Nothing here models the park; the precedent is
 * `scripts/measure-hop-clearance.mts`, and the reason is
 * `scripts/check-asset-contract.mts`'s: a number an author writes down is a
 * claim, a number derived from the built thing is a fact.
 *
 * ## The six
 *
 * 1. **Every attraction routes from the entrance** on the real nav lattice.
 * 2. **No route crosses the railway** except over a bridge deck — issue #116,
 *    Decision 8. Every crossing `world/train/crossings.ts` finds gets a real
 *    bridge (`world/train/bridges.ts`), so this is no longer a vacuous "no
 *    crossings exist to check": a route that meets the rail anywhere the
 *    deck does not clear it by {@link BRIDGE_RISE} is a genuine finding.
 * 3. **`poiGraph` is one connected component containing every POI.** The graph
 *    already validates its nodes and its edges; nothing checked that they add
 *    up to a single network, which is exactly what the three dead indoor seeds
 *    were.
 * 4. **Rail exclusion is continuous** — invisible walls flank the whole solved
 *    curve, and no walkable cell lies on the track.
 * 5. **The boot asserts pass** — `checkHoppableColliders`, `checkSubstepBudget`.
 * 6. **Anchor keep-outs are respected** — `building/dressing.ts`'s "no bench in
 *    a stairwell" rule, generalised to the park.
 *
 * ## The ratchet
 *
 * Proved against the hand-authored park, and the hand-authored park does not
 * satisfy all six. It was never asked to: invariant 4's exclusion wall is
 * Decision 4 work nobody has built yet. Invariant 2 was the same story until
 * issue #116/Decision 8 built the bridges it needed — silently passing it
 * before that would have made this script decorative on the night it was
 * most needed, which is why it always measured the real park rather than
 * assuming "no bridges built yet" meant "nothing to check".
 *
 * So, {@link RATCHET}, after `check-asset-contract.mts`: each existing
 * deviation is recorded with the number it measured on the day this landed, and
 * an invariant may not deviate **further** than its recorded figure. Nothing
 * here is accepted; it is recorded, and the summary line names the worst
 * offender on every run so it stays visible. A new violation gets no allowance
 * at all — which is the whole point, because every generator step from tonight
 * lands under this.
 *
 * An entry that stops being needed must be **deleted**, or the allowance stays
 * open and the check quietly stops guarding that invariant. A stale entry is
 * called out by name in the output (`RATCHET LOOSE`) rather than failing the
 * build, so that fixing something never blocks the person who fixed it.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { measureParkFindings } from './lib/parkFindings.mts';

const verbose = process.argv.includes('--verbose');

/**
 * `LGP_RATCHET=off` (the seed sweep sets it): the RATCHET table's recorded
 * deviations are tuned to the canonical park — the slide's reach literally
 * depends on how far this seed put the pit from the castle — so when
 * hunting seeds, only the hard invariants decide pass/fail and the drift
 * numbers are reported for the eye. The canonical build never sets this.
 */
const ratchetEnforced =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['LGP_RATCHET'] !==
  'off';

const started = performance.now();
const park = buildHeadlessPark();
const { findings, table, regressions, loose, drift, measured, worst, worstDetail, summary } = measureParkFindings(
  park,
  ratchetEnforced,
  verbose,
);
const elapsed = performance.now() - started;
for (const line of drift) console.log(`drift (not enforced this run): ${line}`);

if (verbose || regressions.length > 0) {
  for (const line of table) console.log(line);
  console.log('');
  for (const finding of findings) console.log(`  [${finding.invariant}] ${finding.detail}`);
  if (findings.length > 0) console.log('');
  for (const line of park.said) console.log(`  world said: ${line}`);
}

for (const line of loose) {
  console.log(`RATCHET LOOSE: ${line} — delete its entry in scripts/lib/parkFindings.mts.`);
}

if (regressions.length > 0) {
  console.error(`check:park: ${regressions.length} invariant regression(s):\n`);
  for (const line of regressions) console.error(`  ${line}`);
  console.error(
    '\nThe park contract is in ARCHITECTURE-DECISIONS Decision 5. Fix the' +
      '\nlayout — do not silence this by adding to RATCHET.',
  );
  process.exit(1);
}


if (measured.size === 0) {
  console.log(`${summary}. All six invariants hold. ${elapsed.toFixed(0)} ms.`);
} else {
  console.log(
    `${summary}; ${measured.size} recorded deviation(s), worst ${worst.key} ` +
      `(${worst.amount}) — ${worstDetail}. ` +
      `RATCHET in scripts/lib/parkFindings.mts; --verbose for all of them. ` +
      `${elapsed.toFixed(0)} ms.`,
  );
}
