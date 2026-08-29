import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION_FILE_PATH } from '../src/version-file';

/**
 * **Is the live park actually running the newest commit on the default branch?**
 *
 * On 29 August 2026 the deployed game sat on `0a5f0380` while `main` was five
 * commits ahead. Nothing anywhere was red: `deploy.yml` carried
 * `cancel-in-progress: true`, so a merge landing during a deploy *cancelled* the
 * deploy, and a cancelled run is a grey tick, not a failure. Since that workflow
 * is also the only thing that publishes the site, the site simply stopped moving.
 * It was found because Jim said "Deployed still has the old cat bus" — i.e. by a
 * person, days later, which is the worst possible detector.
 *
 * The queueing fix (`cancel-in-progress: false`) stops that particular cause.
 * This check is the part that does not depend on having correctly guessed the
 * cause: whatever goes wrong — a cancelled run, a failed `wrangler deploy`, an
 * expired Cloudflare token, an edge cache pinning an old asset — the one fact
 * that matters is *what commit is the live site serving*, and this asks it
 * directly, of the real host, over the real network.
 *
 * Nothing here is hand-copied:
 *
 * - the file to fetch comes from `src/version-file.ts`, the same module
 *   `vite.config.ts` writes with and `src/version-check.ts` polls;
 * - the hostname comes from `wrangler.jsonc`'s own custom-domain route, so
 *   moving the game to another domain moves this check with it;
 * - the commit to expect comes from `git ls-remote origin HEAD`, which is the
 *   remote's *default branch* head — so the branch is never named here either.
 *
 * Deliberately **not** in the `build` chain (CLAUDE.md: a check that never runs
 * is worse than a check that fails — but so is one that fails for the wrong
 * reason). It makes a network call and asserts a fact about production, so on a
 * PR branch it would be red for a reason that has nothing to do with the PR.
 * `.github/workflows/live-version.yml` is what runs it.
 *
 * Usage:
 *   npm run check:live-version                  # expect the remote default branch head
 *   npm run check:live-version -- --expect=<sha>
 *   EXPECTED_VERSION=<sha> npm run check:live-version
 *   LIVE_VERSION_TIMEOUT_MS=30000 npm run check:live-version
 */

const NAME = 'check:live-version';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ------------------------------------------------------------------- inputs

/**
 * `wrangler.jsonc` is JSON *with comments*, and it also contains a `"$schema"`
 * value with a `//` inside a string — so a naive comment strip corrupts it. This
 * walks the text tracking whether it is inside a string, which is enough for
 * JSONC (no trailing commas are used in that file).
 */
function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += char;
  }
  return JSON.parse(out);
}

/** The hostname the family actually types, straight out of the deploy config. */
function liveHost(): string {
  const config = parseJsonc(readFileSync(`${repoRoot}wrangler.jsonc`, 'utf8')) as {
    routes?: readonly { pattern?: string; custom_domain?: boolean }[];
  };
  const domain = config.routes?.find((route) => route.custom_domain === true)?.pattern;
  if (!domain) {
    throw new Error(
      'wrangler.jsonc has no `custom_domain` route, so there is no live hostname to check. ' +
        'If the game moved to a plain workers.dev URL, teach this check where it lives — ' +
        'do not hard-code a host here.',
    );
  }
  return domain;
}

/** Marks an expectation that can be re-asked of the remote as `main` moves. */
const REMOTE_HEAD = 'git ls-remote origin HEAD';

/** The commit the live site *ought* to be serving. */
function expectedVersion(): { sha: string; source: string } {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith('--expect='));
  if (flag) return { sha: flag.slice('--expect='.length).trim(), source: '--expect' };
  const fromEnv = process.env.EXPECTED_VERSION?.trim();
  if (fromEnv) return { sha: fromEnv, source: 'EXPECTED_VERSION' };
  // `HEAD` on the remote is its default branch, so the branch name is never
  // written down here — and it is read fresh, not from the local checkout,
  // which may itself be behind.
  const sha = execFileSync('git', ['ls-remote', 'origin', 'HEAD'], { cwd: repoRoot })
    .toString()
    .split(/\s+/)[0]
    ?.trim();
  if (!sha) throw new Error('`git ls-remote origin HEAD` returned nothing');
  return { sha, source: 'git ls-remote origin HEAD' };
}

const TIMEOUT_MS = Number(process.env.LIVE_VERSION_TIMEOUT_MS ?? 180_000);
const INTERVAL_MS = Number(process.env.LIVE_VERSION_INTERVAL_MS ?? 10_000);

// ------------------------------------------------------------------ probing

interface Reading {
  readonly version?: string;
  readonly problem?: string;
}

async function readLiveVersion(url: string): Promise<Reading> {
  try {
    // `no-store` for the same reason the running game uses it: a cached read
    // would let this check pass on a copy of the answer rather than the answer.
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return { problem: `HTTP ${response.status} ${response.statusText}` };
    const version = (await response.text()).trim();
    if (!version) return { problem: 'served an empty version file' };
    return { version };
  } catch (error) {
    return { problem: `request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// -------------------------------------------------------------------- check

const host = liveHost();
const url = `https://${host}${VERSION_FILE_PATH}`;
let expected = expectedVersion();

const startedAt = Date.now();
let attempts = 0;
let last: Reading = {};

// Publishing is quick once a build has passed (DEPLOY_NOTES.md: live "in about
// 40 seconds") but not instant, and the edge takes a moment more — so a
// disagreement seen in the first seconds is a race, not a defect. Poll the whole
// window before calling it: a check that fails while the answer is still on its
// way is a flaky check, and flaky is failing (CLAUDE.md).
//
// The much longer wait — a deploy still grinding through the 46-step build gate,
// during which main is *correctly* ahead of live for tens of minutes — is not
// handled here. `.github/workflows/live-version.yml` waits that out before it
// ever starts this script.
for (;;) {
  attempts++;
  last = await readLiveVersion(url);
  if (last.version === expected.sha) break;
  const elapsed = Date.now() - startedAt;
  if (elapsed + INTERVAL_MS > TIMEOUT_MS) break;
  process.stderr.write(
    `${NAME}: attempt ${attempts} after ${(elapsed / 1000).toFixed(0)} s — ` +
      `live says ${last.version ?? `<${last.problem}>`}, want ${expected.sha}; ` +
      `retrying (publishing takes about 40 s once a build has passed)\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  // Re-ask the remote what its head is, unless the caller pinned one. Somebody
  // merging again while this polls would otherwise leave it waiting for a commit
  // the site has already, correctly, moved past — a check going red because the
  // world moved on is the same disease as one that cannot fail, pointed the
  // other way.
  if (expected.source === REMOTE_HEAD) expected = expectedVersion();
}

const elapsedMs = Date.now() - startedAt;
const elapsedS = (elapsedMs / 1000).toFixed(1);
/** How long publishing takes once the build has passed (DEPLOY_NOTES.md: "about 40 seconds"). */
const TYPICAL_PUBLISH_MS = 40_000;

if (last.version === expected.sha) {
  console.log(
    `${NAME}: ${host} is serving ${expected.sha} — the head of the default branch ` +
      `(via ${expected.source}). Agreed after ${attempts} attempt(s), ${elapsedS} s.`,
  );
} else {
  console.error(`${NAME}: FAILED — the live site is not serving the newest commit.`);
  console.error(`  live (${url}): ${last.version ?? `unreadable — ${last.problem}`}`);
  console.error(`  wanted:        ${expected.sha}  (from ${expected.source})`);
  // Say honestly how long it actually waited. Quoting "well past the ~40 s
  // publishing takes" after a 25 s run — which a shortened
  // `LIVE_VERSION_TIMEOUT_MS` makes easy — would be a claim the run does not
  // support.
  console.error(
    elapsedMs >= TYPICAL_PUBLISH_MS
      ? `  gave it ${elapsedS} s over ${attempts} attempt(s), well past the ~40 s publishing takes.`
      : `  gave it ${elapsedS} s over ${attempts} attempt(s) — a shortened window ` +
          `(LIVE_VERSION_TIMEOUT_MS), less than the ~40 s publishing normally takes.`,
  );
  console.error('');
  console.error('  This is exactly the shape of "Deployed still has the old cat bus":');
  console.error('  the site quietly stops moving while main goes on ahead. Check the Deploy');
  console.error('  workflow for a cancelled or failed run, then republish by hand with:');
  console.error('');
  console.error('      gh workflow run deploy.yml');
  console.error('');
  process.exitCode = 1;
}
