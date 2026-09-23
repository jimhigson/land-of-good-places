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
 * workflow, because `checks.yml` was at **26m55s against a 30-minute cap —
 * 89.7%, needing only 1.11x its own slowest run to breach** (measured by #523,
 * n=15 over `main`; the chain has since been split into parallel shards, #693,
 * which is what the shard section further down proves is still whole). A job
 * killed by `timeout-minutes` reports as `cancelled`, which is how this project
 * lost a deploy on 29 August. Calling those four orphans would be an instrument
 * measuring the wrong thing.
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
 * game is broken (see {@link KNOWN_ORPHANS}), so wiring them up is real work with
 * its own ticket — **#526**, which owns building and serving the game on a
 * non-default port. Until then they sit in an explicit, dated,
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
 * **Two left, and both were run for real before being put back here (#693).**
 * It held five for weeks and was printed on every run, which turned out to be
 * the same as holding nothing: a list that is merely stable is a list of checks
 * nobody runs. So each was resolved or measured: `check:wall-tunnelling` given
 * a failure path and put in a shard; the two that need a real GPU renamed out of
 * `check:` into {@link GPU_ONLY}; and these two served through
 * `scripts/with-dev-server.mts` and run on CI — where they proved **flaky**, so
 * wiring them in would have made the required gate flaky. Their entries carry
 * the measurement and the ticket; the wiring is one line in a shard once that
 * ticket is closed.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  'check:walking':
    'FLAKY on the hosted runner — run 35882256634: tap-to-move after the keychain view moved 0.000 m (keys fine); ' +
    'passed on 35879741766. Served by `pnpm run with-dev-server pnpm run check:walking`; ~10 min on CI, so it wants ' +
    'a shard of its own. Orphaned since #342. Fix and wire: #699',
  'check:deep-links':
    'FLAKY — /keychain-stall (continueGame) timed out at 60 s on 1 of 2 local runs; passed on CI run 35879741766 ' +
    '(5m06s). Served by `pnpm run with-dev-server pnpm run check:deep-links`. Orphaned since #314. Fix and wire: #700',
};

/**
 * **Checks that cannot run on a GitHub-hosted runner at all, and so are not
 * `check:*`.** Both assert on a real GPU's behaviour, and the hosted runner has
 * only a software rasteriser, on which their timings mean nothing (each script
 * detects that and fails). They sat in {@link KNOWN_ORPHANS} as `check:*` for
 * weeks, which read as "CI will get round to it". It will not — so they were
 * renamed out of the `check:` prefix (#693), and are named here so the rename
 * cannot quietly be undone and so the gap is still said out loud on every run.
 * A GPU runner would let them gate; that is a repository/billing decision.
 */
const GPU_ONLY: Record<string, string> = {
  'gpu:frame-time': 'asserts the frame-time tail on a real GPU (was check:frame-time, orphaned since #246)',
  'gpu:arrival-starts':
    'asserts a cold boot hands over control under a 6x CPU throttle on a real GPU (was check:arrival-starts, orphaned since #264)',
};

const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(REPO, 'package.json'), 'utf8'),
).scripts;

/**
 * Strip YAML comments before looking for invocations.
 *
 * **Without this, a comment is accepted as proof that CI runs something** — and
 * that is the one direction this file must never fail in. Every other
 * imprecision here fails *loudly*, reporting an orphan that is really covered,
 * which someone then argues with. This one fails *silently*: an orphan reported
 * as covered. One line of prose in a workflow —
 *
 * ```yaml
 * # ... reproduce this locally with `pnpm run check:walking`.
 * ```
 *
 * — with no `run:` step anywhere near it, would mark `check:walking` as run by
 * CI forever, and the file's promise that a new orphan cannot be introduced
 * quietly would be worth nothing. Found in review of this PR, which is the
 * subject of this PR happening to the check itself.
 *
 * Both forms go: a whole-line comment, and a trailing one after code. Measured
 * before adopting, on `origin/main` `f1c99347`: raw text yields 8 entry points,
 * stripping whole-line comments yields 7 — the loss is `sweep:seeds`, which is
 * named **only** in prose — and additionally stripping trailing comments loses
 * nothing further. The orphan set is **5 either way**, so this is behaviour-
 * neutral today and closes the hole for tomorrow.
 *
 * The residual imprecision, stated rather than hidden: a `pnpm run x` inside a
 * non-`run:` YAML string would still count as an entry point. That direction is
 * the safe one — it over-reports coverage of a script somebody has at least
 * written into a workflow, and it fails loudly if it ever bites, because the
 * script would show as covered while its step does not exist.
 */
const stripYamlComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s#.*$/, ''))
    .join('\n');

/** A workflow's `pnpm run <name> <args>`, with any matrix template expanded. */
interface Invocation {
  readonly name: string;
  readonly args: readonly string[];
  readonly file: string;
}

/** Instrument failures found while reading the workflows; reported with the rest. */
const instrumentFailures: string[] = [];

/**
 * **Expand `${{ matrix.KEY }}` into one invocation per value of `KEY: [..]`.**
 *
 * `checks.yml` runs the chain as a matrix — `pnpm run check:watchdog
 * check:shard-${{ matrix.shard }}` over `shard: [1, 2, ...]` — so the script a
 * shard runs is only written down as a template. Reading the template
 * literally would see `check:shard-` and nothing else, and every step would
 * look orphaned; ignoring the argument would fall back to the watchdog's
 * default (`check`, the whole chain) and every step would look covered **even
 * if a shard were dropped from the matrix** — the silent direction. So the
 * matrix is read, and a template whose key has no list, or two lists, is an
 * instrument failure rather than a guess.
 */
const expandMatrix = (text: string, line: string, file: string): string[] => {
  const template = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/.exec(line);
  if (!template) return [line];
  const key = template[1]!;
  const lists = [...text.matchAll(new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'gm'))];
  if (lists.length !== 1) {
    instrumentFailures.push(
      `instrument: ${file} uses \${{ matrix.${key} }} but declares ${lists.length} \`${key}: [...]\` lists — ` +
        'cannot tell which scripts it runs. Keep the matrix as one inline list per key',
    );
    return [];
  }
  const values = lists[0]![1]!
    .split(',')
    .map((v) => v.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return values.flatMap((value) => expandMatrix(text, line.replace(template[0], value), file));
};

/** Every `pnpm run X` / `npm run X` a workflow invokes: CI's real entry points. */
const workflowDir = join(REPO, '.github', 'workflows');
const invocations: Invocation[] = [];
const workflowFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
for (const file of workflowFiles) {
  const text = stripYamlComments(readFileSync(join(workflowDir, file), 'utf8'));
  for (const m of text.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)([^\n&|;]*)/g)) {
    for (const expanded of expandMatrix(text, m[2] ?? '', file)) {
      invocations.push({ name: m[1]!, args: expanded.trim().split(/\s+/).filter(Boolean), file });
    }
  }
}
const entryPoints = new Set(invocations.map((i) => i.name));

/**
 * **Runners: scripts that run another script named as a bare argument.**
 *
 * `pnpm run X` is not the only way one script causes another to run, and
 * assuming it was broke this check the first time a legitimate indirection
 * landed. #523 put the chain under a watchdog, so `checks.yml` stopped saying
 * `pnpm run check` and started saying `pnpm run check:watchdog`, whose body is:
 *
 * ```
 * node ... scripts/check-watchdog.mts check .github/workflows/checks.yml
 * ```
 *
 * The chain is named there as an **argument**, not as `pnpm run check`. Rebasing
 * onto that produced **63 false orphans out of 73 leaves** — `check` unreachable,
 * and every step of it unreachable with it.
 *
 * Two things worth keeping from that, because they are the argument for the
 * shape of this file. It failed **loudly** — 63 red, impossible to miss, in the
 * safe direction — rather than quietly exonerating anything. And it was caught
 * by a real merge rather than by imagination, which is why this table exists
 * instead of a cleverer guess.
 *
 * **Why a table rather than a general rule.** The tempting generalisation — "any
 * bare token in a script body that matches another script's name counts as
 * running it" — fails in the *dangerous* direction: it would silently exonerate
 * any check whose name happened to appear as an argument anywhere, which is the
 * same false-negative this file was reviewed for. So runners are named
 * explicitly, and the list is **ratcheted**: a listed runner that matches no
 * script body fails this check rather than rotting into a lie.
 */
const RUNNERS: ReadonlyArray<{
  file: string;
  /** Which positional argument names the script to run. */
  argIndex: number;
  /** Flags that take a value, so the value is not mistaken for a positional. */
  valueFlags: readonly string[];
  /** What the runner runs when given no script at all. */
  defaultTarget: string;
  why: string;
}> = [
  {
    file: 'scripts/check-watchdog.mts',
    argIndex: 0,
    valueFlags: ['--job'],
    defaultTarget: 'check',
    why: '#523 — runs the named script under a clock set inside the job timeout, so a chain overrun goes red naming its step instead of reporting as cancelled',
  },
];

/**
 * Script names a runner is given, e.g. `check:shard-3` and `test:procgen`.
 *
 * The arguments are the script body's own **followed by whatever the caller
 * passed** — pnpm appends `pnpm run check:watchdog check:shard-3`'s
 * `check:shard-3` to the body, which is how one `check:watchdog` entry serves
 * every shard. A runner given no script at all runs its default, and that is
 * reported as reached too: it is what would really execute.
 */
const runnerTargets = (body: string, passed: readonly string[]): string[] => {
  const found: string[] = [];
  for (const runner of RUNNERS) {
    const at = body.indexOf(runner.file);
    if (at < 0) continue;
    const args = [
      ...body
        .slice(at + runner.file.length)
        .trim()
        .split(/\s+/)
        .filter(Boolean),
      ...passed,
    ];
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (runner.valueFlags.includes(args[i]!)) i++;
      else if (args[i] !== '--') positional.push(args[i]!);
    }
    found.push(positional[runner.argIndex] ?? runner.defaultTarget);
  }
  return found;
};

/** Expand through the scripts object: a step that calls a step is covered too. */
const reachable = new Set<string>();
/** Scripts a workflow runs *directly* — itself, or as a runner's target. */
const directlyRunByCi: string[] = [];
const seen = new Set<string>();
const visit = (name: string, depth: number, passed: readonly string[] = []): void => {
  const key = `${name} ${passed.join(' ')}`;
  if (depth > 16 || seen.has(key)) return;
  const body = scripts[name];
  if (body === undefined) return;
  seen.add(key);
  reachable.add(name);
  for (const m of body.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/g)) visit(m[1]!, depth + 1);
  for (const target of runnerTargets(body, passed)) {
    if (depth === 0) directlyRunByCi.push(target);
    visit(target, depth + 1);
  }
};
for (const invocation of invocations) {
  if (scripts[invocation.name] !== undefined && !RUNNERS.some((r) => scripts[invocation.name]!.includes(r.file))) {
    directlyRunByCi.push(invocation.name);
  }
  visit(invocation.name, 0, invocation.args);
}

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
// A runner that no longer runs anything is a stale exemption, and this file is
// about exemptions that stopped being true. Fail rather than carry it.
for (const runner of RUNNERS) {
  const used = Object.values(scripts).some((body) => body.includes(runner.file));
  if (!used) {
    failures.push(
      `RUNNERS lists ${runner.file}, which no script invokes any more — delete the entry, and ` +
        `check whether whatever it used to run is still reached some other way (${runner.why})`,
    );
  }
}

failures.push(...instrumentFailures);

/**
 * ## The shards: every step of the gate runs, exactly once, in CI
 *
 * The chain outgrew one runner, so `check` is a list of `check:shard-N`
 * scripts and `checks.yml` runs one per runner. That split is exactly where a
 * step can go quiet: a shard missing from the matrix, a step pasted into two
 * shards (run twice, harmless but a sign the map is being edited by hand), or
 * a step left in `check` itself where only a local run would ever see it. So:
 *
 * 1. `check` is **nothing but** `pnpm run check:shard-N` parts, naming every
 *    defined shard exactly once — the shards *are* the chain, not a copy of it;
 * 2. every step (each `&&` part, `tsc --noEmit` included) is in **exactly
 *    one** shard;
 * 3. every shard is run **directly** by a workflow, exactly once — not merely
 *    reachable through `check`, which no workflow runs.
 *
 * Steps are compared as **sets of parsed parts**, never by count (a count
 * cannot see a swap) and never by grep (script names are prefixes of each
 * other).
 */
const parts = (body: string): string[] =>
  body
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
const SHARD = /^check:shard-\d+$/;
const shardNames = Object.keys(scripts).filter((k) => SHARD.test(k));
const checkParts = parts(scripts['check'] ?? '');
const inCheck: string[] = [];
for (const part of checkParts) {
  const m = /^(?:pnpm|npm)\s+run\s+(\S+)$/.exec(part);
  if (!m || !SHARD.test(m[1]!)) {
    failures.push(
      `"check" contains \`${part}\`, which is not a shard — CI runs shards, not "check", so this step ` +
        'would run locally and never in CI. Move it into a check:shard-N',
    );
  } else inCheck.push(m[1]!);
}
for (const shard of shardNames) {
  const n = inCheck.filter((s) => s === shard).length;
  if (n !== 1) failures.push(`${shard} appears ${n} times in "check" — every shard must be in it exactly once`);
}
for (const shard of inCheck) {
  if (!shardNames.includes(shard)) failures.push(`"check" runs ${shard}, which is not defined`);
}
const owner = new Map<string, string[]>();
for (const shard of shardNames) {
  for (const step of parts(scripts[shard]!)) owner.set(step, [...(owner.get(step) ?? []), shard]);
}
for (const [step, owners] of owner) {
  if (owners.length > 1) failures.push(`\`${step}\` is in ${owners.length} shards (${owners.join(', ')}) — each step belongs to exactly one`);
  if (/(?:pnpm|npm)\s+run\s+check(?::shard-\d+)?$/.test(step)) {
    failures.push(`${owners.join(', ')} runs \`${step}\` — a shard must hold steps, not other shards or the whole chain`);
  }
}
for (const shard of shardNames) {
  const n = directlyRunByCi.filter((s) => s === shard).length;
  if (n !== 1) {
    failures.push(
      `${shard} is run directly by ${n} workflow invocation(s) — it must be exactly 1 (checks.yml's ` +
        `\`shard: [...]\` matrix). ${n === 0 ? 'Its steps never run in CI' : 'It runs more than once'}`,
    );
  }
}
const chainSteps = [...owner.keys()];
if (shardNames.length === 0 || chainSteps.length < 20) {
  failures.push(
    `instrument: ${shardNames.length} check:shard-N scripts holding ${chainSteps.length} steps, which is far ` +
      'fewer than this repo has — the shard or step parsing has stopped matching',
  );
}

console.log(
  `  ${defined.length} check:* scripts defined (${leaves.length} leaves, ` +
    `${defined.length - leaves.length} aggregate); ${leaves.length - orphans.length} of the leaves ` +
    `reachable from ${entryPoints.size} workflow entry point(s) across ${workflowFiles.length} ` +
    `workflow file(s); "check" is ${shardNames.length} shard(s) holding ${chainSteps.length} distinct steps`,
);
for (const shard of shardNames) console.log(`    ${shard}: ${parts(scripts[shard]!).length} steps`);

for (const [name, why] of Object.entries(GPU_ONLY)) {
  if (scripts[name] === undefined) {
    failures.push(`GPU_ONLY lists ${name}, which is not a script any more — delete the entry`);
  }
  const asCheck = name.replace(/^gpu:/, 'check:');
  if (scripts[asCheck] !== undefined) {
    failures.push(
      `${asCheck} is defined again — it cannot run on a hosted runner (${why}). Keep it as ${name}, ` +
        'or give it a GPU runner and delete the GPU_ONLY entry',
    );
  }
  console.log(`  NOT RUN BY CI (needs a GPU): ${name} — ${why}`);
}

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
  `check:chain-coverage ok — every one of the ${leaves.length} check:* leaf scripts is reachable from CI` +
    (Object.keys(KNOWN_ORPHANS).length === 0
      ? ', with no known exceptions'
      : `, except the ${Object.keys(KNOWN_ORPHANS).length} listed above, which are named on every run so the ` +
        'gap cannot be inherited silently'),
);
