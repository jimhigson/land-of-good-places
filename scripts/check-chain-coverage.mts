/**
 * **`check:chain-coverage`** — every `check:*` script is actually reachable
 * from something CI runs (issue #464).
 *
 * ## The failure this exists to make impossible
 *
 * A check that is *defined* but in no chain is the quietest failure this repo
 * has. Nothing goes red. The diff stat looks clean. `package.json` parses. And
 * `grep` finds the name, because script names here are prefixes of one another
 * — `test:procgen` matches `test:procgen:watch`, `check:castle` matches
 * `check:castle-window` — so the obvious way to look is structurally unable to
 * answer the question. A green build then says, proudly, that everything
 * passed.
 *
 * CLAUDE.md records one instance: a banquet rebase swapped `check:stall-shape`
 * out for `check:hall-solid` one for one, **53 steps before, 53 after**, and
 * nobody noticed for a day. The count is what several agents had been told to
 * report, and **a count cannot see a swap**.
 *
 * That one was at least an accident of merging. Walking first-parent history
 * and parsing the chain at each commit — the only method that works, since
 * `git log -S` cannot see it (the script *definition* keeps the string alive in
 * the file) — turns up four that never had that excuse:
 *
 * | check | orphaned at | how long |
 * |---|---|---|
 * | `check:frame-time` | #246, 8 Aug 2026 | ~28 days |
 * | `check:arrival-starts` | #264, 9 Aug 2026 | ~27 days |
 * | `check:deep-links` | #314, 22 Aug 2026 | ~14 days |
 * | `check:walking` | #342, 27 Aug 2026 | ~9 days |
 *
 * Every one was **born orphaned** — wired to nothing on the day it was written,
 * and never run in CI once. `check:walking`'s own commit is titled *"Add
 * check:walking — a real arrow-key movement regression check"*: a regression
 * check for the control scheme GAME_DESIGN.md calls an absolute rule, which has
 * never executed. No bad merge was needed. Someone forgot a line, and nothing
 * anywhere could notice.
 *
 * ## What "reachable" means here, and why it is asked this way
 *
 * The question is **not** "is it in the `check` chain?" — that would be wrong in
 * both directions. `check:coplanar`, `check:live-version`, `check:gateway` and
 * `check:update-adoption` are deliberately *outside* it, each with its own
 * workflow, because `checks.yml` is already at 25 minutes against a 30-minute
 * cap and a job killed by `timeout-minutes` reports as `cancelled` — which is
 * how this project lost a deploy on 29 August. Calling those four orphans would
 * be an instrument measuring the wrong thing.
 *
 * So this starts from **what the workflows actually invoke** — every `pnpm run`
 * / `npm run` in `.github/workflows/*.yml` — and expands transitively through
 * `package.json`'s own scripts. A check is covered if CI can reach it by any
 * route. Add a workflow tomorrow and its entry points are picked up for free;
 * nothing here has to be kept in step by hand, which is the mistake this file
 * is about.
 *
 * ## The ratchet, and why it is not a baseline to hide behind
 *
 * The four above are red for want of a build or a dev server, not because the
 * game is broken (see {@link KNOWN_ORPHANS}), so wiring them up is real work
 * with its own ticket. Until then they sit in an explicit, dated,
 * ticket-referencing list, and this check:
 *
 * - **fails on any orphan not in that list** — a new one cannot be introduced
 *   quietly, which is the whole point;
 * - **fails when a listed orphan becomes reachable**, so the list cannot rot
 *   into a lie the way the thing it documents did;
 * - **prints the known gap on every run, pass or fail**, because a green line
 *   implying cover it does not give is how the next agent inherits a false
 *   belief.
 *
 * Do not add an entry to make this pass. An entry means "already unwired before
 * the gate existed"; a new orphan means you have just unwired one.
 *
 * Run: `pnpm run check:chain-coverage`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;

/**
 * Checks that are defined, unreachable, and known to be so — each with the
 * reason it is not merely a missing line, and the ticket that owns wiring it.
 *
 * All four need something the `check` chain cannot give them: a built `dist/`,
 * or a dev server. That is why appending them to `check` would not fix them —
 * they want a workflow that builds and serves first, the way
 * `update-adoption.yml` already does. Measured on `origin/main` 61e95fe5, each
 * run by hand: every one exits 1, and **not one of them fails on the game** —
 * they fail on their own preconditions.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  'check:frame-time': 'needs a built dist/ — "No dist/ to measure". Orphaned since #246, 8 Aug 2026. Wiring: #464',
  'check:arrival-starts': 'needs a dev server on 127.0.0.1:5173 — ERR_CONNECTION_REFUSED. Orphaned since #264, 9 Aug 2026. Wiring: #464',
  'check:deep-links': 'needs a dev server (has CHECK_DEEP_LINKS_URL override). Orphaned since #314, 22 Aug 2026. Wiring: #464',
  'check:walking': 'needs a dev server on 127.0.0.1:5173 — ERR_CONNECTION_REFUSED. Orphaned since #342, 27 Aug 2026. Wiring: #464',
  'check:wall-tunnelling':
    'TWO faults, not one. (1) Unreachable: only check:all names it, and no workflow runs check:all — ' +
    'wiring: #464. (2) It could not fail if it were reached: scripts/measure-wall-tunnelling.mts has ' +
    'no process.exit(1) and no failure path at all — 32 s, always exit 0, a measurement tool named as ' +
    'a check — #525, which offers assertions or a rename to measure:wall-tunnelling. Fixing only (1) ' +
    'would buy a green step that gates nothing',
};

const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(REPO, 'package.json'), 'utf8'),
).scripts;

/** Every `pnpm run X` / `npm run X` a workflow invokes: CI's real entry points. */
const workflowDir = join(REPO, '.github', 'workflows');
const entryPoints = new Set<string>();
const workflowFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
for (const file of workflowFiles) {
  const text = readFileSync(join(workflowDir, file), 'utf8');
  for (const m of text.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/g)) entryPoints.add(m[1]!);
}

/** Expand through the scripts object: a step that calls a step is covered too. */
const reachable = new Set<string>();
const visit = (name: string, depth: number): void => {
  if (depth > 16 || reachable.has(name)) return;
  const body = scripts[name];
  if (body === undefined) return;
  reachable.add(name);
  for (const m of body.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/g)) visit(m[1]!, depth + 1);
};
for (const entry of entryPoints) visit(entry, 0);

/**
 * An **aggregate** is a `check:*` script whose body is nothing but other `run`
 * steps — `check:all` is the one today, the local pre-push sweep. It is not a
 * check and has no assertions of its own, so asking whether CI reaches *it* is
 * the wrong question: what matters is whether CI reaches each of its steps, and
 * those are judged on their own below. A **leaf** is anything that actually
 * invokes a tool, and a leaf that CI cannot reach never runs.
 *
 * This distinction is load-bearing rather than tidy-minded. Reaching a leaf
 * *through* an unreachable aggregate is exactly how `check:wall-tunnelling`
 * hid: it sits in `check:all`, so it reads as wired, while no workflow runs
 * `check:all` at all. An earlier hand-rolled version of this analysis seeded
 * its walk with `check:all` as an entry point and therefore reported that check
 * as covered — a confident, wrong answer of precisely the kind this file exists
 * to stop. Entry points come from the workflows or they are not entry points.
 */
const isAggregate = (name: string): boolean => {
  const body = scripts[name] ?? '';
  return body
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => /^(?:pnpm|npm)\s+run\s+[A-Za-z0-9:_-]+$/.test(part));
};

const defined = Object.keys(scripts).filter((k) => k.startsWith('check:'));
const leaves = defined.filter((k) => !isAggregate(k));
const orphans = leaves.filter((k) => !reachable.has(k));

const failures: string[] = [];

// **The control.** If the parsing broke, every check would look orphaned or
// every check would look covered, and either way this file would be reporting
// success about something it is not describing. These two assertions are what
// make a green run mean anything: they fail loudly rather than passing quietly.
if (workflowFiles.length === 0) {
  failures.push(`instrument: found no workflow files under .github/workflows — this check cannot see CI, so it is measuring nothing`);
}
if (entryPoints.size === 0) {
  failures.push(`instrument: parsed ${workflowFiles.length} workflow file(s) and found no "pnpm run" invocation in any of them — the entry-point regex has stopped matching`);
}
const chainSteps = [...(scripts['check'] ?? '').matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/g)];
if (chainSteps.length < 20) {
  failures.push(`instrument: the "check" chain parsed to only ${chainSteps.length} steps, which is far fewer than this repo has — the chain regex has stopped matching`);
}

console.log(
  `  ${defined.length} check:* scripts defined (${leaves.length} leaves, ` +
    `${defined.length - leaves.length} aggregate); ${leaves.length - orphans.length} of the leaves ` +
    `reachable from ${entryPoints.size} workflow entry point(s) across ${workflowFiles.length} ` +
    `workflow file(s); "check" chain parses to ${chainSteps.length} steps`,
);

// **Say what is not covered, on every run.** This is the line that stops a green
// exit code from implying cover this repo does not have.
for (const [name, why] of Object.entries(KNOWN_ORPHANS)) {
  if (orphans.includes(name)) console.log(`  NOT RUN BY ANYTHING (known): ${name} — ${why}`);
}

for (const orphan of orphans) {
  if (orphan in KNOWN_ORPHANS) continue;
  failures.push(
    `${orphan} is defined in package.json but no workflow can reach it, directly or through any ` +
      `chain — so it never runs, and nothing goes red when it would have failed. Add it to a chain ` +
      `(e.g. "check"), or give it its own workflow as check:coplanar has, or if it genuinely cannot ` +
      `run yet, add it to KNOWN_ORPHANS with its reason and ticket`,
  );
}

// The ratchet only tightens: once something is wired up, it may not quietly
// return to the list, or the list becomes the same kind of stale claim as the
// comment that promised two numbers agreed.
for (const name of Object.keys(KNOWN_ORPHANS)) {
  if (!defined.includes(name)) {
    failures.push(`KNOWN_ORPHANS lists ${name}, which is no longer a check:* script at all — delete the entry`);
  } else if (!leaves.includes(name)) {
    failures.push(`KNOWN_ORPHANS lists ${name}, which is now an aggregate rather than a leaf check — delete the entry`);
  } else if (!orphans.includes(name)) {
    failures.push(`KNOWN_ORPHANS lists ${name}, but it is now reachable from CI — delete the entry so the ratchet holds`);
  }
}

if (failures.length > 0) {
  console.error(`check:chain-coverage FAILED — ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check:chain-coverage ok — every one of the ${leaves.length} check:* leaf scripts is reachable from CI, ` +
    `except the ${Object.keys(KNOWN_ORPHANS).length} listed above, which are named on every run so the ` +
    `gap cannot be inherited silently`,
);
