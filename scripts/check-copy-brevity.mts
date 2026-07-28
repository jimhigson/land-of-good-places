/**
 * **Every line the game writes at a child must be short.**
 *
 * ```
 * npm run check:brevity            # or --verbose for the full table
 * ```
 *
 * GAME_DESIGN.md's BREVITY RULE, added 28 July 2026 after a photo of the real
 * phone showed the what's-new panel carrying roughly twice the text it should
 * ("this screen needs less text by about half, and clear guidelines to not
 * write this much"). The rule is absolute and it is arithmetic, which means it
 * can be measured:
 *
 *  - a **title** — a what's-new heading, a shop item's name, a sign's title —
 *    at most {@link TITLE_LIMIT} characters;
 *  - a **line** — a what's-new line, a shop blurb, a sign's subtitle — **one
 *    sentence**, at most {@link LINE_LIMIT} characters.
 *
 * It is checked, and the check runs in `npm run build`, because this codebase
 * has been bitten four separate times by a rule that lived only in prose. Copy
 * is the easiest thing in a repo to grow by accident: nobody reviews a string
 * as closely as they review a function, and every individual sentence looks
 * reasonable on its own. Only the total is unreasonable, and only a machine
 * counts the total on every commit.
 *
 * ## What it covers, and what it cannot
 *
 * The three sources named in the rule that are *data* rather than prose woven
 * into a builder: `whatsnew.json`, the shop catalogue (`displayName`, `blurb`)
 * and the anchor signs (`signTitle`, `signSubtitle`). Those are enumerated
 * from the real modules the game imports, so a new shop item or a new
 * what's-new entry is covered the day it is added, with no list to keep in
 * step.
 *
 * Not covered: sign text written inline at a builder call site (`Entrance.ts`,
 * `FacePaintStall.ts`, the mini-game plots), and the shopkeepers' `SKINS`
 * table in `Shops.ts`, which is module-private. Every one of those is inside
 * the limits today; if a future one grows, moving it into a table this script
 * already walks is the fix, rather than teaching the script to read source.
 *
 * ## Why some copy fails and the build is still green
 *
 * Seven shop blurbs are two sentences where the second sentence is the joke —
 * "One scoop. It wobbles when you walk." is 36 characters and would be worse
 * as one clause. Rewriting them is a *voice* decision for the family, not an
 * engineer's, and the rule's own words are "never two sentences where one will
 * do", which is a judgement this script cannot make. So, exactly as
 * `check-asset-contract.mts` does with height drift, each is written down in
 * {@link KNOWN_LONG} with what it measured on the day the check landed, and
 * the rule is a **ratchet**: recorded copy may not get longer or gain another
 * sentence, and new copy gets no allowance at all.
 *
 * A ratchet only ratchets if it is tightened. An entry whose copy now passes
 * is a **failure** here, not a shrug — a stale allowance is an unguarded
 * string. Delete it when you shorten the line.
 */
import { readFileSync } from 'node:fs';
import '../scripts/headless-canvas.mjs';
import { SHOP_ITEMS, EGG_PRIZES } from '../src/world/building/shops/catalogue.ts';
import { ANCHORS } from '../src/world/anchors.ts';

/**
 * The longest a title may be, in characters.
 *
 * Two lines of a `.shop-title` on a 390px phone, near enough — anything longer
 * wraps to three and starts pushing the thing it names off the screen.
 */
const TITLE_LIMIT = 24;

/** The longest a single line of copy may be, in characters. */
const LINE_LIMIT = 50;

/** How many sentences a line may be. The rule's answer is one. */
const SENTENCE_LIMIT = 1;

/** Copy that was already over the line when this check landed. */
interface Recorded {
  /** Its length in characters on the day the check landed. */
  readonly length?: number;
  /** Its sentence count on the day the check landed. */
  readonly sentences?: number;
  /** What is actually going on. Every entry needs one. */
  readonly why: string;
}

/**
 * Copy the park was already carrying. **Recorded, not accepted.**
 *
 * Do not add to this table to make a build pass. Every entry here is a second
 * sentence carrying the joke in a blurb that is already comfortably inside the
 * character limit — the length rule is not bent anywhere in the park, and it
 * must not start being. If you shorten one of these, delete its line: an
 * allowance left behind guards nothing.
 */
const KNOWN_LONG: Readonly<Record<string, Recorded>> = {
  'blurb:balloon.corgi': {
    sentences: 2,
    why: '"Pink flying glasses. Hold on tight and float!" — 45 characters. The second sentence is the instruction, and a corgi in flying goggles needs one.',
  },
  'blurb:balloon.chicken': {
    sentences: 2,
    why: '"A white and red chicken. Watch your snacks!" — 43 characters. The second sentence is the joke.',
  },
  'blurb:ice.bubblegum': {
    sentences: 2,
    why: '"One scoop. It wobbles when you walk." — 36 characters, and the wobble is the whole point of the item.',
  },
  'blurb:ice.rainbowTriple': {
    sentences: 2,
    why: '"Three whole scoops. The famous one." — 35 characters.',
  },
  'blurb:hat.ripikaHat': {
    sentences: 2,
    why: '"Wear the whole of RiPika on your head. Very silly." — 50 characters, exactly on the limit. "Very silly" is the sell.',
  },
  'blurb:pet.bunny': {
    sentences: 2,
    why: '"Hops. Will follow you about." — 28 characters, two sentences of three words.',
  },
  'blurb:egg.surprise': {
    sentences: 2,
    why: '"Nobody knows what is inside. Not even the shop." — 47 characters. The second sentence is the joke, and this one is quoted back at us by a six-year-old.',
  },
};

type Shape = 'title' | 'line';

interface Copy {
  /** Stable key, and the {@link KNOWN_LONG} key: `<field>:<id>`. */
  readonly key: string;
  /** Where a reader should go to fix it. */
  readonly where: string;
  readonly shape: Shape;
  readonly text: string;
}

interface WhatsNewFile {
  readonly entries: readonly { id: number; title: string; line: string }[];
}

/**
 * Everything this script measures.
 *
 * Read from the same modules the game imports, never re-listed: the catalogue
 * is walked whole, so anything that goes on sale is covered the day it is
 * added.
 */
function collect(): Copy[] {
  const copy: Copy[] = [];

  const whatsnewPath = new URL('../whatsnew.json', import.meta.url);
  const whatsnew = JSON.parse(readFileSync(whatsnewPath, 'utf8')) as WhatsNewFile;
  for (const entry of whatsnew.entries) {
    copy.push({
      key: `whatsnew.title:${entry.id}`,
      where: 'whatsnew.json',
      shape: 'title',
      text: entry.title,
    });
    copy.push({
      key: `whatsnew.line:${entry.id}`,
      where: 'whatsnew.json',
      shape: 'line',
      text: entry.line,
    });
  }

  for (const item of [...SHOP_ITEMS, ...EGG_PRIZES]) {
    copy.push({
      key: `displayName:${item.id}`,
      where: 'src/world/building/shops/catalogue.ts',
      shape: 'title',
      text: item.displayName,
    });
    copy.push({
      key: `blurb:${item.id}`,
      where: 'src/world/building/shops/catalogue.ts',
      shape: 'line',
      text: item.blurb,
    });
  }

  for (const anchor of ANCHORS) {
    copy.push({
      key: `signTitle:${anchor.id}`,
      where: 'src/world/anchors.ts',
      shape: 'title',
      text: anchor.signTitle,
    });
    copy.push({
      key: `signSubtitle:${anchor.id}`,
      where: 'src/world/anchors.ts',
      shape: 'line',
      text: anchor.signSubtitle,
    });
  }

  return copy;
}

/**
 * Length in characters as a reader counts them.
 *
 * Spread, not `.length`: an emoji is one thing on the screen and several UTF-16
 * code units, and `"🛍️".length` is 3. Counting a shopping bag as three
 * characters would spend an eighth of a title's budget on one glyph.
 */
function characters(text: string): number {
  return [...text].length;
}

/**
 * How many sentences the line is.
 *
 * Terminal punctuation followed by a space or the end of the string, so "Not
 * even me!" is one, "One scoop. It wobbles." is two, and a full stop inside
 * something like "3.5" is not a sentence break. An em dash or a comma is not a
 * sentence break either, which is the point — the rule is about how many
 * complete thoughts a child has to hold, not about punctuation.
 */
function sentences(text: string): number {
  return text
    .split(/[.!?…]+(?=\s|$)/)
    .filter((part) => part.trim().length > 0).length;
}

interface Failure {
  readonly key: string;
  readonly where: string;
  readonly problem: string;
}

const failures: Failure[] = [];
const rows: string[] = [];
let recordedStillLong = 0;
const seenRecords = new Set<string>();

function check(copy: Copy): void {
  const { key, where, shape, text } = copy;
  const recorded = KNOWN_LONG[key];
  if (recorded) seenRecords.add(key);

  const limit = shape === 'title' ? TITLE_LIMIT : LINE_LIMIT;
  const length = characters(text);
  const count = shape === 'title' ? 1 : sentences(text);
  const flags: string[] = [];
  let recordApplied = false;

  if (length > limit) {
    if (recorded?.length !== undefined && length <= recorded.length) {
      flags.push('recorded');
      recordApplied = true;
    } else {
      flags.push('LENGTH');
      failures.push({
        key,
        where,
        problem:
          `${length} characters, ${length - limit} over the ${shape} limit of ${limit}` +
          (recorded?.length === undefined ? '' : ` — longer than the recorded ${recorded.length}`),
      });
    }
  }

  if (count > SENTENCE_LIMIT) {
    if (recorded?.sentences !== undefined && count <= recorded.sentences) {
      flags.push('recorded');
      recordApplied = true;
    } else {
      flags.push('SENTENCES');
      failures.push({
        key,
        where,
        problem:
          `${count} sentences; a line is one` +
          (recorded?.sentences === undefined ? '' : ` — more than the recorded ${recorded.sentences}`),
      });
    }
  }

  if (recordApplied) recordedStillLong += 1;

  rows.push(
    [
      key.padEnd(38),
      shape.padEnd(5),
      String(length).padStart(3),
      String(count).padStart(2),
      flags.join(' '),
    ].join('  '),
  );
}

const everything = collect();
for (const copy of everything) check(copy);

// A recorded entry whose copy now passes is a stale allowance — the ratchet
// stops guarding that string the moment its record is wider than the truth.
for (const key of Object.keys(KNOWN_LONG)) {
  if (!seenRecords.has(key)) {
    failures.push({
      key,
      where: 'scripts/check-copy-brevity.mts',
      problem: 'recorded in KNOWN_LONG but no such copy exists any more — delete the entry',
    });
  }
}
for (const [key, record] of Object.entries(KNOWN_LONG)) {
  const copy = everything.find((entry) => entry.key === key);
  if (!copy) continue;
  const length = characters(copy.text);
  const count = copy.shape === 'title' ? 1 : sentences(copy.text);
  const limit = copy.shape === 'title' ? TITLE_LIMIT : LINE_LIMIT;
  const stillLong = record.length !== undefined && length > limit;
  const stillWordy = record.sentences !== undefined && count > SENTENCE_LIMIT;
  if (!stillLong && !stillWordy) {
    failures.push({
      key,
      where: 'scripts/check-copy-brevity.mts',
      problem: 'now within the rule — delete its KNOWN_LONG entry so the ratchet keeps guarding it',
    });
  }
}

if (process.argv.includes('--verbose') || failures.length > 0) {
  console.log(['copy'.padEnd(38), 'shape', 'len', 'st', 'flags'].join('  '));
  for (const row of rows) console.log(row);
  console.log('');
}

if (failures.length > 0) {
  console.error(
    `\nBREVITY RULE (GAME_DESIGN.md): ${failures.length} problem${failures.length === 1 ? '' : 's'} ` +
      `across ${everything.length} pieces of copy.\n`,
  );
  for (const failure of failures) console.error(`  ${failure.key}  (${failure.where})\n    ${failure.problem}\n`);
  console.error(
    'A title is at most ' +
      `${TITLE_LIMIT} characters; a line is ONE sentence of at most ${LINE_LIMIT}.\n` +
      'Say what the child can now do, never how it works. Cut the words rather\n' +
      'than growing the panel. Do not silence this by adding to KNOWN_LONG.\n',
  );
  process.exit(1);
}

const summary = `BREVITY RULE: ${everything.length} pieces of copy are short enough`;
if (recordedStillLong === 0) {
  console.log(`${summary}. ✓`);
} else {
  console.log(
    `${summary}; ${recordedStillLong} still carry a recorded exception. ` +
      'See KNOWN_LONG in scripts/check-copy-brevity.mts. ✓',
  );
}
