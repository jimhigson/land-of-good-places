/**
 * **Runs `pnpm run check` under a clock that can speak.**
 *
 * ## The failure this exists to end
 *
 * `checks.yml` caps the job with `timeout-minutes: 30`. When that fires,
 * **GitHub reports the job as `cancelled`, not `failure`** — the same
 * conclusion a superseded push produces. So a gate that ran out of clock is
 * indistinguishable, at a glance, from one somebody cancelled, and neither is
 * red. That is not a hypothetical: it is the 29 August outage, where the
 * deploy ran past its cap and the site sat stale for hours with nothing red,
 * and it is CLAUDE.md's "a check that never runs is worse than a check that
 * fails" in its purest form.
 *
 * This wrapper puts a **shorter** clock inside the job's own. When it fires it
 * kills the chain and exits **124** — a real non-zero, so the job is a
 * **`failure`**, red, with a message naming the step that was running. The
 * job's `timeout-minutes` stays above it as the backstop for the case this
 * process itself wedges.
 *
 * ## And it prints the budget on every run, pass or fail
 *
 * The margin is what nobody could see. `main` sits at ~26m20s against a 30m
 * cap — 88% — and the same chain measures 16m37s on a fast runner and 26m20s
 * on an ordinary one, every script scaling by the same ~1.6x. That is runner
 * speed, not workload: **the cap is breached by luck rather than by growth**,
 * and a run that passes today at 88% is not evidence of health. So the last
 * thing this prints, on a pass as much as on a failure, is elapsed against cap
 * and the percentage used.
 *
 * ## Why Node rather than GNU `timeout`
 *
 * `timeout(1)` would do the killing, but not the *saying*: it cannot name the
 * step that was running, which is the whole point. Node also runs identically
 * on a developer's Mac, where GNU coreutils may not be installed at all —
 * and a watchdog that only works on CI cannot be tried before it is trusted.
 *
 * Usage (CI, and locally if you want the same view):
 *   pnpm run check:watchdog
 *   CHECK_WATCHDOG_MARGIN_SECONDS=120 pnpm run check:watchdog
 *   CHECK_WATCHDOG_BUDGET_SECONDS=30 pnpm run check:watchdog   # to prove it fires
 */

import { spawn } from 'node:child_process';
import { capSeconds, formatDuration, stepName } from './checkChain.mts';

/**
 * How much of the job's cap to leave the runner for its own work — checkout,
 * install, uploading logs, and reporting the failure this may be about to
 * produce.
 *
 * It has to be more than nothing: a watchdog that fires at exactly the cap
 * loses the race with `timeout-minutes` and the job goes grey anyway, which is
 * the outcome this exists to prevent. Three minutes against a 30-minute cap
 * measured comfortably: checkout and install together are ~20 s on this job.
 */
const DEFAULT_MARGIN_SECONDS = 180;

const cap = capSeconds();
const margin = Number(process.env.CHECK_WATCHDOG_MARGIN_SECONDS ?? DEFAULT_MARGIN_SECONDS);
/** Overridable only so the watchdog can be proved to fire — see the PR body. */
const budget = Number(process.env.CHECK_WATCHDOG_BUDGET_SECONDS ?? cap - margin);

if (!Number.isFinite(budget) || budget <= 0) {
  throw new Error(`nonsensical watchdog budget: ${budget}s (cap ${cap}s, margin ${margin}s)`);
}

/**
 * Written with `process.stdout.write`, never `console.log`.
 *
 * Measured by another agent on this project: on a **passing** Vitest run
 * `console.*` is intercepted and invisible, while `process.stdout.write` and
 * `process.stderr.write` are both shown. The distinction is `console.*`
 * interception, not stdout-versus-stderr. This particular process is not under
 * Vitest, but the rule is the one that matters for any note that must survive
 * a green run — and a budget line nobody can read on a pass is the exact fault
 * being fixed here.
 */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const started = Date.now();
const elapsed = (): number => (Date.now() - started) / 1000;

say(
  `check:watchdog — budget ${formatDuration(budget)} against checks.yml's ` +
    `${formatDuration(cap)} cap (${formatDuration(margin)} left for the runner).`,
);

/**
 * `detached: true` puts the chain in **its own process group**, and that is
 * load-bearing rather than tidy.
 *
 * The first version of this spawned normally and killed `child` on timeout.
 * The control run proved the alarm fired and named the step correctly — and
 * then the chain **carried on running for another three minutes**, advancing
 * well past the step it had supposedly been killed in. `pnpm run check` is a
 * chain of `&&`-ed `pnpm run check:*`, so signalling the direct child leaves
 * every grandchild alive, and `close` does not arrive until they release the
 * stdio pipes.
 *
 * On CI that watchdog would have been **decorative**: it would have printed
 * its failure and then let the job run on to `timeout-minutes` anyway — a
 * `cancelled`, which is the exact silence it exists to end. A watchdog that
 * cannot actually stop the thing it is watching is worse than none, because
 * it looks like a solution.
 *
 * So: own group, and signal the *group* (`-pid`) rather than the process.
 */
const child = spawn('pnpm', ['run', 'check'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
  detached: true,
});

/**
 * Signals the whole process group the chain runs in.
 *
 * Negative pid means "the group" to `kill(2)`. Wrapped because the group is
 * gone the instant the last member exits, and signalling a dead group throws
 * `ESRCH` — which is success for our purposes, not an error to report.
 */
const killChain = (signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
};

/**
 * If *this* process is killed — by the job's own `timeout-minutes`, or by an
 * agent pressing ctrl-c — take the chain with it rather than orphaning a
 * dozen node processes on somebody's machine. CLAUDE.md is emphatic about not
 * leaving strays behind, and the control run left nine.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    killChain('SIGKILL');
    process.exit(1);
  });
}

/**
 * The last step pnpm announced.
 *
 * pnpm echoes each script as `$ <command>` before running it, which is the
 * only per-step marker that exists — `checks.yml` runs the whole chain as a
 * single `run:` step, so GitHub's own step timings cannot see inside it.
 */
let currentStep = '(nothing yet — still starting up)';
let currentStepStarted = started;
let stepsSeen = 0;

/**
 * Forwards the child's output verbatim while watching for those markers.
 *
 * Verbatim matters: this is the log a human reads to find out what failed, and
 * a wrapper that reformatted it would be lying about what the chain printed.
 */
const watch = (stream: NodeJS.ReadableStream, to: NodeJS.WritableStream): void => {
  let pending = '';
  stream.on('data', (chunk: Buffer) => {
    to.write(chunk);
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const marker = /^\s*\$\s+(.*)$/.exec(line);
      // The chain itself is echoed as one `$ pnpm run a && pnpm run b && ...`
      // line; that is not a step, every later one is.
      if (!marker || marker[1]!.includes('&&')) continue;
      currentStep = stepName(marker[1]!);
      currentStepStarted = Date.now();
      stepsSeen += 1;
    }
  });
};

watch(child.stdout, process.stdout);
watch(child.stderr, process.stderr);

let firedAt: number | null = null;

const alarm = setTimeout(() => {
  firedAt = elapsed();
  const inStep = (Date.now() - currentStepStarted) / 1000;
  say('');
  say('='.repeat(72));
  say('check:watchdog — THE CHECK CHAIN RAN OUT OF CLOCK');
  say('='.repeat(72));
  say(`  ran for            ${formatDuration(firedAt)}`);
  say(`  watchdog budget    ${formatDuration(budget)}`);
  say(`  checks.yml cap     ${formatDuration(cap)}`);
  say(`  steps completed    ${Math.max(0, stepsSeen - 1)}`);
  say(`  killed during      ${currentStep}  (after ${formatDuration(inStep)} in it)`);
  say('');
  say('  This is a FAILURE, not a cancellation. Without this watchdog the job');
  say("  would have hit checks.yml's own `timeout-minutes` and GitHub would");
  say('  have reported it as `cancelled` — grey, not red, and identical to a');
  say('  superseded push. That silence is the 29 August outage.');
  say('');
  say('  The step named above is where the clock ran out; it is not');
  say('  necessarily the slow one. Measure before blaming it:');
  say('      gh run view <run-id> --log > run.log');
  say('      pnpm run measure:check-chain run.log');
  say('='.repeat(72));
  // The whole group, not the direct child — see the `detached` comment above.
  killChain('SIGTERM');
  // A check mid-park-build can ignore SIGTERM for a while; do not wait on
  // politeness, because every second here is spent against the job's own cap.
  setTimeout(() => killChain('SIGKILL'), 5_000).unref();
}, budget * 1000);

child.on('error', (error) => {
  clearTimeout(alarm);
  say(`check:watchdog — could not start the chain: ${error.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  clearTimeout(alarm);
  const took = elapsed();

  // --- the budget line, on every run, pass or fail -------------------------
  const pct = ((100 * took) / cap).toFixed(1);
  say('');
  say(
    `check:watchdog — chain took ${formatDuration(took)} of a ${formatDuration(cap)} cap ` +
      `(${pct}% used, ${formatDuration(cap - took)} spare) across ${Math.max(0, stepsSeen - 1)} steps.`,
  );
  if (firedAt === null && took > cap * 0.8) {
    say(
      `  NOTE: over 80% of the cap. The same chain has measured 1.58x slower on ` +
        `a slow runner than a fast one, so this margin is spent by luck, not by growth.`,
    );
  }

  if (firedAt !== null) {
    // 124 is `timeout(1)`'s convention for "the command timed out", and any
    // non-zero is what makes GitHub call this a `failure` rather than a
    // `cancelled`.
    process.exit(124);
  }
  if (signal) {
    say(`check:watchdog — the chain was killed by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
