/**
 * **Every asset's declared `height` must match the object it actually built.**
 *
 * ```
 * npm run check:assets            # or --verbose for the full table
 * ```
 *
 * ARCHITECTURE.md and ASSET_MANIFEST.md set one contract for every visual asset
 * in the park: 1 unit = 1 metre, origin at the feet, and an `AssetHandle`
 * carrying the model's total `height`. Until this script existed, **nothing
 * checked any of it**. A height is written by hand at the bottom of a factory,
 * a hundred lines from the geometry that decides it, and it is read by the
 * things that place name labels, seat riders in ferris-wheel gondolas and stand
 * stock on shelves.
 *
 * A number an author writes down is a claim; a number derived from the built
 * object is a fact. Three separate bugs in one night came from trusting the
 * claim, the worst of them in `art/models/pets.ts`, where every pet was scaled
 * from a hand-written "natural height" of 0.52 — the top of the *skull*. The
 * ears sat above it, were left out of the sum, and were then scaled up with
 * everything else, so the bunny stood **2.12 m** tall against a standard of
 * 1.46 for weeks while a function called `sizeToStandard` reported success. It
 * was caught only because it happened to break a ferris wheel seat.
 *
 * So this builds every asset, measures the finished object, and compares:
 *
 *  - **height** — the top of the visible geometry against the declared
 *    `height`, within {@link HEIGHT_TOLERANCE};
 *  - **origin** — the bottom of the visible geometry against zero, within
 *    {@link ORIGIN_TOLERANCE}. A model whose bounds start well above or below
 *    its origin floats or sinks, which is just as wrong and just as invisible;
 *  - **scale** — `root.scale` left at 1, which the contract reserves for the
 *    caller's squash-and-stretch.
 *
 * It is a script rather than a boot assert because it costs nothing at runtime
 * and covers every asset without building the whole park: it fails in a build
 * rather than in a child's face.
 *
 * ## What it found, and why the build is still green
 *
 * The park was carrying deviations everywhere, from 2 mm to 594 mm. Silently
 * correcting the lot would have moved every name label in the game with no
 * QA and no decision — a tuning conversation is not the same thing as a bug.
 * So each existing deviation is written down in {@link KNOWN_DRIFT} with what
 * it measured on the day the check landed, and the rule is a **ratchet**: an
 * asset may not drift further than its recorded figure, and a new asset gets
 * no allowance at all. Nothing here is *accepted* — it is *recorded*. The
 * summary line names the worst offender on every run so it stays visible.
 *
 * The ratchet only ratchets if it is **tightened as things are fixed**. An
 * asset that stops drifting must lose its entry, or the allowance stays open
 * and the check silently stops guarding it. Everything above 100 mm has now
 * gone that way — the turtle's missing sprout, the `tall` tree's canopy, the
 * puff hat's guessed ball, the shopkeeper's floating bust and the sweet's — so
 * what is left below is centimetre-scale tuning, waiting on the family rather
 * than on an engineer.
 *
 * **Assets are enumerated, not discovered.** The shop catalogue is walked
 * whole, so anything that goes on sale is covered the day it is added; the
 * rest are listed in {@link collect}. An asset that is in neither gets no
 * coverage — that is this script's one blind spot.
 */
import '../scripts/headless-canvas.mjs';
import { visibleBounds } from '../src/art/style/measure.ts';
import type { AssetHandle } from '../src/art/style/asset.ts';
import { SHOP_ITEMS, EGG_PRIZES } from '../src/world/building/shops/catalogue.ts';
import { PALETTE } from '../src/core/palette.ts';
import { createKid } from '../src/art/models/kid.ts';
import { createRipika } from '../src/art/models/ripika.ts';
import { createBiscuit } from '../src/art/models/biscuit.ts';
import { createKeeper } from '../src/art/models/keeper.ts';
import { createMini } from '../src/art/models/mini.ts';
import { createSpaceTurtle } from '../src/art/models/spaceTurtle.ts';
import { createPet, PET_KINDS } from '../src/art/models/pets.ts';
import { createBalloon } from '../src/art/models/balloons.ts';
import { createHat, HAT_KINDS } from '../src/art/models/hats.ts';
import { createLollipopTree, createPinkWall, createWoodWall } from '../src/art/models/props.ts';
import { HAIR_STYLES } from '../src/art/models/hair.ts';

/**
 * How far a declared height may sit from the measured one, in metres.
 *
 * 15 mm. Wide enough to absorb what a hand-written number legitimately rounds
 * away — an outline hull stands about 11 mm proud of the surface it wraps, and
 * a face decal a millimetre or two off a skull — and far too narrow to hide a
 * mistyped digit, a forgotten pair of ears, or a number left stale by a retune.
 * The bug that prompted all this was 660 mm out.
 */
const HEIGHT_TOLERANCE = 0.015;

/** How far the base of a model may sit from its origin, in metres. */
const ORIGIN_TOLERANCE = 0.02;

/** Where a model's origin is meant to be. */
type Origin =
  /** On the ground, per the asset contract: `bottom` must be ~0. */
  | 'base'
  /**
   * On a mount point rather than the ground. A hat's origin is the crown of the
   * head it sits on and its brim deliberately hangs below (see the header of
   * `art/models/hats.ts`), so only the height half of the contract applies.
   */
  | 'anchor';

/** A deviation that existed before this check did. See the header. */
interface Recorded {
  /** Measured minus declared, in metres, on the day the check landed. */
  readonly height?: number;
  /** Measured base, in metres, on the day the check landed. */
  readonly bottom?: number;
  /** What is actually going on. Every entry needs one. */
  readonly why: string;
}

/**
 * Deviations the park was already carrying. **Recorded, not accepted.**
 *
 * Do not add to this table to make a build pass. A new asset gets no entry: if
 * its height is wrong, the number is wrong, and the fix is to correct it or —
 * better — to derive it from the model with `visibleTop` the way `kid.ts` and
 * `pets.ts` already do. A key ending in `.*` matches by prefix.
 */
const KNOWN_DRIFT: Readonly<Record<string, Recorded>> = {
  // ---- The three gross ones — spaceTurtle +42%, prop.tree.tall -14%, hat.puff
  // ---- +37% — are gone. Each was a hand-kept second copy of the geometry, and
  // ---- each is now derived from the built model with `visibleTop` /
  // ---- `visibleBounds` instead, so no allowance is left behind for them to
  // ---- creep back into. The turtle keeps one line, for its origin only:
  spaceTurtle: {
    bottom: 0.034,
    why: 'It floats in the ferris wheel space show and has no ground to stand on, so its flippers hang 34 mm above an origin nothing ever rests on. Its *height* is measured now, sprout and all.',
  },

  // ---- The pets had four entries here — kitten -34 mm, mouse -55 mm, puff
  // ---- -68 mm and sunk 28 mm through the floor — because `sizeToStandard`
  // ---- closed over a `Box3`, the axis-aligned box of already axis-aligned
  // ---- boxes, which every rotation in the chain inflates. It now closes over
  // ---- `visibleBounds` and over the full extent rather than the top alone,
  // ---- so all four measure 1.460 with their feet on the floor. **The entries
  // ---- are gone, not relaxed**: the ratchet only guards an asset while its
  // ---- allowance is no wider than the truth, and each of those three errors
  // ---- was well outside HEIGHT_TOLERANCE, so this check would have caught
  // ---- last night's fix had the table been tightened with it.

  // ---- Origins that are deliberate, and would be better stated in the model.
  'prop.tree.*': {
    bottom: -0.135,
    why: 'The root flare is a whole squashed ball centred on the origin, so half of it is under the grass on purpose — a trunk with no flare reads as a pole stuck in a lawn.',
  },
  // `keeper` (+36 mm, 99 mm off the floor) and `candy.spookyHouse` (+33 mm,
  // 77 mm off it) used to be recorded here. Both bust and sweet now sit on
  // their own origin and measure their own height, so both entries are gone.
  // `Shops.ts` lifts its keepers back up by the 99 mm they used to float, so
  // nothing behind a counter moved — see `KEEPER_LIFT`.

  // ---- Centimetre drift. A tuning conversation, not a licence to move
  // ---- anything: each of these places a name label a couple of centimetres
  // ---- off, and no one number is worth a visual change on its own.
  'toy.biscuit': { height: -0.018, why: 'Hand-written 1.15; builds 1.13.' },
  biscuit: { height: -0.018, why: 'Hand-written 1.15; builds 1.13.' },
  'egg.prize.biscuit': { height: -0.018, why: 'Hand-written 1.15; builds 1.13.' },
  'toy.star': { height: 0.021, why: 'Hand-written 0.36; builds 0.38.' },
  'egg.prize.star': { height: 0.021, why: 'Hand-written 0.36; builds 0.38.' },
  'balloon.dalmatian': { height: 0.037, why: 'Ears clear the declared tip by 37 mm.' },
  'balloon.corgi': { height: 0.077, why: 'The flying goggles clear the declared tip by 77 mm.' },
  'ice.*': { height: -0.018, why: 'The scoop stack is 18 mm shorter than the formula claims.' },
  mini: { height: -0.023, bottom: -0.020, why: 'Builds 0.70 against a declared 0.72.' },
  'hat.crown': { height: -0.020, why: 'Hand-written; the points are 20 mm lower than claimed.' },
  'hat.sun': { height: -0.024, why: 'Hand-written; the dome is 24 mm lower than claimed.' },
  'hat.flower': {
    height: -0.038,
    why: 'Declares 0.06 m; the flower ring is 0.02 m tall. Small in absolute terms, but the claim is three times the truth.',
  },
  'hat.ripikaHat': { height: -0.028, why: 'Hand-written; the ears are 28 mm lower than claimed.' },
  'prop.pinkWall.*': { height: -0.025, why: 'Coping is 25 mm below the declared 1.62.' },
  'prop.woodWall.*': { height: -0.021, why: 'Top plank is 21 mm below the declared height.' },
  // The three `prop.tree` canopy entries (+70 to +109 mm) went with the `tall`
  // one: there was only ever one canopy formula and it is now one measurement,
  // so every variant lands on the nose. No tree is placed in the park yet, so
  // nothing on screen moved.
};

/**
 * Every record that applies to `name`, merged, most specific winning per field.
 *
 * Merged rather than "best match wins" because the two halves of the contract
 * fail for different reasons: a lollipop tree's buried root flare is recorded
 * once for all trees under `prop.tree.*`, while each variant's canopy formula
 * is wrong by its own amount.
 */
function recordedFor(name: string): Recorded | undefined {
  const matches: { key: string; record: Recorded }[] = [];
  for (const [key, record] of Object.entries(KNOWN_DRIFT)) {
    if (key === name) matches.push({ key, record });
    else if (key.endsWith('.*') && name.startsWith(key.slice(0, -1))) matches.push({ key, record });
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => a.key.length - b.key.length); // general first, specific last
  let merged: Recorded = { why: '' };
  for (const { record } of matches) {
    merged = {
      ...merged,
      ...record,
      why: merged.why ? `${merged.why} ${record.why}` : record.why,
    };
  }
  return merged;
}

interface Subject {
  readonly name: string;
  readonly origin: Origin;
  readonly handle: AssetHandle;
}

function collect(): Subject[] {
  const subjects: Subject[] = [];
  const seen = new Set<string>();
  const add = (name: string, handle: AssetHandle, origin: Origin = 'base'): void => {
    if (seen.has(name)) return;
    seen.add(name);
    subjects.push({ name, handle, origin });
  };

  // Everything the shops sell, straight from the table the shelves are built
  // from — its own comment promises "origin at the base, facing +Z".
  for (const item of [...SHOP_ITEMS, ...EGG_PRIZES]) {
    add(item.id, item.model(), item.id.startsWith('hat.') ? 'anchor' : 'base');
  }

  // Variants the catalogue might only sample one of.
  for (const kind of PET_KINDS) add(`pet.${kind}`, createPet(kind));
  for (const kind of HAT_KINDS) add(`hat.${kind}`, createHat(kind), 'anchor');
  for (const kind of ['dalmatian', 'corgi', 'chicken'] as const) {
    add(`balloon.${kind}`, createBalloon(kind));
  }

  // The characters, which are not for sale.
  add('kid', createKid());
  add('ripika', createRipika());
  add('ripika.space', createRipika({ space: true }));
  add('biscuit', createBiscuit());
  add('keeper', createKeeper({ colour: PALETTE.markerMint }));
  add('mini', createMini());
  add('spaceTurtle', createSpaceTurtle());

  // Every hairstyle changes the player's height, and her handle re-measures on
  // each change — so each style is its own subject.
  for (const style of HAIR_STYLES) {
    const kid = createKid();
    kid.setHairStyle(style);
    add(`kid.hair.${style}`, kid);
  }

  // Scenery. Seeded, so a few seeds each is a fair sample of what a seed can do.
  for (const seed of [0, 1, 2, 3]) {
    for (const variant of ['plain', 'blossom', 'fruit', 'tall'] as const) {
      add(`prop.tree.${variant}.${seed}`, createLollipopTree({ seed, variant }));
    }
    add(`prop.pinkWall.${seed}`, createPinkWall({ seed }));
    for (const height of ['low', 'mid', 'high'] as const) {
      add(`prop.woodWall.${height}.${seed}`, createWoodWall({ seed, height }));
    }
  }

  return subjects;
}

interface Failure {
  readonly name: string;
  readonly problem: string;
}

const failures: Failure[] = [];
const rows: string[] = [];
let drifting = 0;
let worst = { name: '', error: 0 };

/** True if `error` is inside tolerance, or no worse than what was recorded. */
function withinRecord(error: number, recorded: number | undefined, tolerance: number): boolean {
  if (Math.abs(error) <= tolerance) return true;
  if (recorded === undefined) return false;
  // Same direction, no further out than the day it was written down.
  return Math.sign(error) === Math.sign(recorded) && Math.abs(error) <= Math.abs(recorded) + 1e-3;
}

function check(subject: Subject): void {
  const { name, handle, origin } = subject;
  const bounds = visibleBounds(handle.root);
  const recorded = recordedFor(name);
  const heightError = bounds.top - handle.height;
  const flags: string[] = [];

  if (!withinRecord(heightError, recorded?.height, HEIGHT_TOLERANCE)) {
    flags.push('HEIGHT');
    failures.push({
      name,
      problem:
        `declares height ${handle.height.toFixed(3)} m but measures ` +
        `${bounds.top.toFixed(3)} m (${heightError > 0 ? '+' : ''}${heightError.toFixed(3)} m)` +
        (recorded?.height === undefined ? '' : ` — worse than the recorded ${recorded.height.toFixed(3)} m`),
    });
  } else if (Math.abs(heightError) > HEIGHT_TOLERANCE) {
    flags.push('drift');
    drifting += 1;
    if (Math.abs(heightError) > Math.abs(worst.error)) worst = { name, error: heightError };
  }

  if (origin === 'base' && !withinRecord(bounds.bottom, recorded?.bottom, ORIGIN_TOLERANCE)) {
    flags.push('ORIGIN');
    failures.push({
      name,
      problem:
        `origin is not at the base: geometry starts ${Math.abs(bounds.bottom).toFixed(3)} m ` +
        `${bounds.bottom > 0 ? 'above' : 'below'} y = 0`,
    });
  }

  const { x, y, z } = handle.root.scale;
  if (x !== 1 || y !== 1 || z !== 1) {
    flags.push('SCALE');
    failures.push({
      name,
      problem: `root.scale is (${x}, ${y}, ${z}); the contract reserves it for the caller`,
    });
  }

  rows.push(
    [
      name.padEnd(26),
      handle.height.toFixed(3).padStart(8),
      bounds.top.toFixed(3).padStart(8),
      `${heightError >= 0 ? '+' : ''}${heightError.toFixed(3)}`.padStart(8),
      bounds.bottom.toFixed(3).padStart(8),
      flags.join(' '),
    ].join('  '),
  );
}

const subjects = collect();
for (const subject of subjects) check(subject);

if (process.argv.includes('--verbose') || failures.length > 0) {
  console.log(['asset'.padEnd(26), 'declared', 'measured', '   error', '  bottom'].join('  '));
  for (const row of rows) console.log(row);
  console.log('');
}

if (failures.length > 0) {
  console.error(`asset contract: ${failures.length} problem(s) across ${subjects.length} assets.\n`);
  for (const failure of failures) console.error(`  ${failure.name}: ${failure.problem}`);
  console.error(
    '\nThe declared height is what places name labels and seats riders. Correct' +
      '\nthe number — or better, derive it from the model with `visibleTop`.' +
      '\nDo not silence this by adding to KNOWN_DRIFT.',
  );
  process.exit(1);
}

const summary = `asset contract: ${subjects.length} assets check out`;
if (drifting === 0) {
  console.log(`${summary}.`);
} else {
  console.log(
    `${summary}; ${drifting} still carry recorded drift ` +
      `(worst: ${worst.name} ${worst.error > 0 ? '+' : ''}${worst.error.toFixed(3)} m). ` +
      'See KNOWN_DRIFT in scripts/check-asset-contract.mts.',
  );
}
