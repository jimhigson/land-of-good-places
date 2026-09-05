/**
 * **Which Node is this?** — the first step of `pnpm run check`, and the answer
 * to a question that had been assumed rather than asked for months (#506).
 *
 * ## Why this is a gate and not a comment
 *
 * This repo's scripts and checks run TypeScript natively, with no bundler and
 * no transpile, so they need a current Node — CLAUDE.md says so and CI pins
 * one. Nothing enforced it locally, and nothing declared it either: the repo
 * carried neither `.node-version` nor `.nvmrc`, so every version manager on
 * every machine asked the project what it wanted and got no answer.
 *
 * The result, measured: `pnpm exec node --version` on this machine returned
 * **v25.6.1** — below the floor, with 26.x installed and one command away. So
 * every local "gates green on Node 26" report from a `pnpm run` line, across
 * several agents and several branches on one night, was a claim about a
 * runtime nobody had checked. That is #496's flakiness one level out: not a
 * wrong answer, but a confident answer to a question never asked.
 *
 * ## Why a declaration alone is not enough
 *
 * `.node-version` is now that answer, and `fnm` reads it. But **pnpm does
 * not** — measured: with `.node-version` saying 26 and fnm's active Node at
 * v25.6.1, `pnpm exec node --version` still returned v25.6.1. pnpm spawns
 * scripts with whatever `node` is first on `PATH` and has no opinion about
 * the file. Nor does the switch happen by itself outside an interactive
 * shell: `fnm env --use-on-cd` installs a `cd` hook, and an agent's
 * non-interactive shell never runs it.
 *
 * So the declaration says what is wanted, and this check is what makes
 * ignoring it loud. A declared version that nothing enforces is a lock on a
 * door that is not in the wall.
 *
 * ## The version has one owner
 *
 * **`.node-version`** — the file every manager already knows how to read, and
 * the file the seven CI workflows now read too (`node-version-file`), in place
 * of seven hand-kept `node-version: 26` literals.
 *
 * `package.json`'s `engines.node` is a second statement of the same fact,
 * kept because pnpm reads it and warns on install for free. Two statements of
 * one fact is this repo's most-filed bug, so they are not kept in step by a
 * comment promising they agree: this check **fails if they disagree**.
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
const repoRoot = join(here, '..');

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// The owner: .node-version
// ---------------------------------------------------------------------------

let declaredRaw: string;
try {
  declaredRaw = readFileSync(join(repoRoot, '.node-version'), 'utf8');
} catch {
  // **The gate cannot pass by having nothing to check.** A missing declaration
  // is the exact bug #506 was about, and a check that quietly succeeds when its
  // subject has vanished is the shape CLAUDE.md warns about.
  fail(
    'check:node FAILED — there is no .node-version at the repo root.\n' +
      '  That file is what tells fnm (and CI, via node-version-file) which Node this\n' +
      '  project wants. Without it every version manager asks and gets no answer,\n' +
      '  which is issue #506. Restore it — one line, the major version.',
  );
}

const declared = declaredRaw!.trim();
const declaredMatch = /^v?(\d+)(?:\.\d+)*$/.exec(declared);
if (!declaredMatch) {
  fail(
    `check:node FAILED — cannot read a major version from .node-version ${JSON.stringify(declared)}.\n` +
      '  Expected something like "26" or "26.5.0". Rejected loudly rather than\n' +
      '  half-understood, because a version this cannot parse would otherwise leave\n' +
      '  the check silently measuring nothing.',
  );
}
const floor = Number(declaredMatch![1]);

// ---------------------------------------------------------------------------
// The second statement, held to the first by a mechanism rather than a promise
// ---------------------------------------------------------------------------

type Manifest = { readonly engines?: { readonly node?: string } };
const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
) as Manifest;
const engines = manifest.engines?.node;

if (engines === undefined) {
  fail(
    'check:node FAILED — package.json has no engines.node.\n' +
      `  It should be ">=${floor}", matching .node-version. It is kept because pnpm\n` +
      '  reads it and warns on a mismatched install for free; dropping it silently\n' +
      '  removes that second signal.',
  );
}

const enginesMatch = /^>=\s*(\d+)/.exec(engines!.trim());
if (!enginesMatch) {
  fail(
    `check:node FAILED — cannot read a floor from engines.node ${JSON.stringify(engines)}.\n` +
      '  Only ">=MAJOR" is understood here. If a richer range is genuinely wanted,\n' +
      '  teach this check to read it rather than leaving it half-understood.',
  );
}

if (Number(enginesMatch![1]) !== floor) {
  fail(
    'check:node FAILED — the two declarations of this repo\'s Node version disagree.\n' +
      `    .node-version        ${declared}   (major ${floor})\n` +
      `    engines.node         ${engines}   (major ${enginesMatch![1]})\n` +
      '\n' +
      '  .node-version is the owner — it is what fnm and the CI workflows read.\n' +
      '  Bring engines.node to match it. This is a hard failure because a comment\n' +
      '  promising two numbers agree is not a mechanism, and the copy is always\n' +
      '  found wrong by somebody downstream rather than by a check.',
  );
}

// ---------------------------------------------------------------------------
// The runtime actually running this file
// ---------------------------------------------------------------------------

const running = process.versions.node;
const major = Number(running.split('.')[0]);

if (major < floor) {
  fail(
    `check:node FAILED — running on Node v${running}, but this repo needs >= ${floor}.\n` +
      '\n' +
      '  Fix it with fnm, which reads .node-version and needs no argument:\n' +
      '\n' +
      '    fnm use --install-if-missing\n' +
      '\n' +
      '  Then re-run your command in the same shell. (If fnm is not installed:\n' +
      '  `brew install fnm`, or `curl -fsSL https://fnm.vercel.app/install | bash`.)\n' +
      '\n' +
      '  Note that pnpm will NOT do this for you — measured: it ignores\n' +
      '  .node-version entirely and spawns scripts with whatever node is first on\n' +
      '  PATH. An interactive shell with `fnm env --use-on-cd` switches on cd; a\n' +
      "  script's shell does not, which is why this check exists.\n" +
      '\n' +
      '  Why a hard failure rather than a warning: every check below this one would\n' +
      '  have run on the same too-old runtime, and some behave differently on it.\n' +
      '  Issue #496 was a non-determinism that cannot occur below Node 26 at all, so\n' +
      '  days of "byte-identical locally" were measured on a runtime that could not\n' +
      '  show the bug being hunted. A wrong runtime does not produce wrong answers;\n' +
      '  it produces confident ones. See #506.',
  );
}

// To stderr, not stdout: this is a note about the run rather than the run's
// result, and it must be visible on a *passing* chain, which is the case it
// exists for.
process.stderr.write(
  `check:node ok — Node v${running}, against the >= ${floor} this repo declares ` +
    `(.node-version, matched by package.json engines.node).\n`,
);
