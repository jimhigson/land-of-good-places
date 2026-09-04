/**
 * **Which Node is this?** — the first step of `pnpm run check`, and the answer
 * to a question that has been assumed rather than asked for months (#506).
 *
 * ## Why this is a gate and not a comment
 *
 * This repo's scripts and checks run TypeScript natively, with no bundler and
 * no transpile, so they need a current Node — CLAUDE.md says so and CI pins
 * one. Nothing enforced it locally. `scripts/with-node` exists to put a
 * current Node in front of a command, but **no script in `package.json`
 * routes through it**: every `check:*` step invokes a bare `node`, so the
 * chain has always run on whatever Node happened to be first on `PATH`.
 *
 * On the machine this was written on that is **v25.6.1**, below the floor,
 * while v26.7.0 sits installed a directory away. So every local
 * "gates green on Node 26" report — from several agents, across several
 * branches, on one night — was a claim about a runtime nobody had checked.
 * That is the same defect as #496's flakiness one level out: not a wrong
 * answer, but a confident answer to a question that was never asked.
 *
 * A lock on a door that is not in the wall is what `with-node` was. This is
 * the wall.
 *
 * ## The floor has one owner
 *
 * `package.json`'s `engines.node`, which is the standard place for it and
 * which pnpm already reads (it prints its own `Unsupported engine` warning on
 * install, for free). `scripts/with-node` reads the same field. There is no
 * second copy of the number to drift — the fault this repo files most often,
 * and one I had already committed here by writing `MIN_MAJOR=26` into
 * `with-node` before this existed.
 *
 * ## What it prints
 *
 * The runtime, on every run, pass or fail — because a transcript that does not
 * record the runtime a measurement was taken on cannot be checked afterwards,
 * and that is precisely how the #496 hunt's local runs went unquestioned.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', 'package.json');

type Manifest = { readonly engines?: { readonly node?: string } };

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const declared = manifest.engines?.node;

if (declared === undefined) {
  // **The gate cannot pass by having nothing to check.** A missing floor is a
  // repo-configuration bug, not a satisfied requirement — and a check that
  // quietly succeeds when its subject has vanished is exactly the shape
  // CLAUDE.md warns about.
  console.error(
    'check:node FAILED — package.json has no engines.node, so there is no floor to check.\n' +
      '  This check exists because the Node version was being assumed; deleting the\n' +
      '  declaration would return us to assuming it. Restore engines.node (">=26").',
  );
  process.exit(1);
}

// Deliberately a small subset of semver range syntax: this file's job is to be
// obviously correct, and the repo has only ever wanted a floor. Anything richer
// is rejected loudly rather than half-understood — a range this cannot parse
// would otherwise be a check silently measuring the wrong thing.
const floorMatch = /^>=\s*(\d+)/.exec(declared.trim());
if (!floorMatch) {
  console.error(
    `check:node FAILED — cannot read a floor from engines.node ${JSON.stringify(declared)}.\n` +
      '  Only ">=MAJOR" is understood here. If a richer range is genuinely wanted,\n' +
      '  teach this check to read it rather than leaving it half-understood.',
  );
  process.exit(1);
}

const floor = Number(floorMatch[1]);
const running = process.versions.node;
const major = Number(running.split('.')[0]);

if (major < floor) {
  console.error(
    `check:node FAILED — running on Node v${running}, but this repo needs >= ${floor}.\n` +
      '\n' +
      '  Every check below this one would have run on this same too-old runtime, and\n' +
      '  some of them behave differently on it — issue #496 was a non-determinism that\n' +
      '  cannot occur below Node 26 at all, so days of "byte-identical locally" were\n' +
      '  measured on a runtime that could not show it.\n' +
      '\n' +
      '  Run the chain under a current Node:\n' +
      '\n' +
      '    scripts/with-node pnpm run check\n' +
      '\n' +
      '  (`scripts/with-node` finds the newest installed Node and fails loudly if there\n' +
      '  is none — see #506.)',
  );
  process.exit(1);
}

// To stderr, not stdout: this is a note about the run rather than the run's
// result, and it must be visible on a *passing* chain, which is the case it
// exists for.
process.stderr.write(
  `check:node ok — Node v${running}, against the >= ${floor} this repo requires ` +
    `(package.json engines.node).\n`,
);
