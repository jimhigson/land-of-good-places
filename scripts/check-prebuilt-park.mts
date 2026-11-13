/**
 * **`check:prebuilt-park` — does a park file build exactly the park it was
 * solved from?** On the canonical seed: solve it fresh and write its file,
 * hydrate a second process from the file, and compare the two built parks by
 * whole-park digest — with the hydrate process proven to have hydrated rather
 * than re-solved, and a perturbed file proven to digest differently
 * (`scripts/lib/parkFiles.mts` owns all three; `docs/design/PREBUILT-PARKS.md`).
 *
 * Also: the boot reads the park file before any park module loads, because
 * the file names the restart to build and the restart is read at module load
 * (`boot/prebuiltPark.ts`). Proved of `bootstrap.ts`'s static imports, with a
 * control: the game's own entry (`main.ts`) must be caught.
 *
 * The canonical seed only, because the chain is where it runs, and it is **one
 * solve**: the only one the check chain still pays for. Every checked-in park
 * was proven the same way by `build:parks` when it was solved; this check
 * exists so a change to the codec or to a plan type goes red on the PR that
 * makes it.
 *
 * **And it is the tell for a generator that has drifted from the parks.** The
 * parks are checked in and are not re-solved when the code changes, so the
 * park this source's generator *would* solve for a seed need no longer be the
 * one that ships. Every run says, on stderr, whether the fresh solve of the
 * canonical seed made byte-identical decisions to `parks/<seed>.json`. A
 * difference is a note, not a failure: the checked-in park is still the park,
 * for as long as `validate:parks` accepts it.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';
import { PREBUILT_PARKS_OUT } from '../src/world/prebuilt/parkFileName.ts';
import { checkedInPark } from './lib/checked-in-parks.mjs';
import { proveParkFile } from './lib/parkFiles.mts';
import { PARK_MODULES_AFTER_FILE, staticImportClosure } from './lib/bootStaticImports.mts';

{
  const early = staticImportClosure(process.cwd(), 'src/bootstrap.ts');
  const bad = PARK_MODULES_AFTER_FILE.filter((m) => early.includes(m));
  const control = staticImportClosure(process.cwd(), 'src/main.ts');
  if (!PARK_MODULES_AFTER_FILE.every((m) => control.includes(m))) {
    console.error(`check:prebuilt-park: control failed — main.ts's static imports should reach ${PARK_MODULES_AFTER_FILE.join(', ')}`);
    process.exit(1);
  }
  if (bad.length > 0 || !early.includes('src/boot/prebuiltPark.ts')) {
    console.error(
      `check:prebuilt-park: bootstrap.ts loads ${bad.join(', ') || '(no prebuiltPark.ts)'} before the park file names its restart ` +
        `(${early.length} modules load first)`,
    );
    process.exit(1);
  }
  console.log(
    `check:prebuilt-park: boot order ok — ${early.length} modules load before the park file, none of them the park ` +
      `(control: main.ts's ${control.length} do reach it)`,
  );
}

const outDir = mkdtempSync(join(tmpdir(), 'lgp-prebuilt-park-'));
try {
  // **At the checked-in restart** — the proof is about the codec, not about
  // which restart is accepted, so it needs one solve, not the accept loop's
  // whole run of attempts and measures: on #708 the canonical seed accepts at
  // restart 3, and asking all four with every measure took this check past its
  // shard's watchdog (run 37221975719). A tree with no checked-in park for the
  // canonical seed is broken, and `checkedInPark` throws saying how to mend it.
  const shipped = checkedInPark(process.cwd(), CANONICAL_PARK_SEED);
  const restart = shipped.entry.restart;
  const proof = await proveParkFile(CANONICAL_PARK_SEED, restart, outDir, (line) => console.log(line));
  const problems = proof.problems.map((p) => `seed ${CANONICAL_PARK_SEED}: ${p}`);
  const summary =
    `seed ${CANONICAL_PARK_SEED} restart ${restart} digest ${proof.solved.park} and placement ${proof.solved.layout} both ways; ` +
    `plan ${proof.solved.planCpuMs} ms searched, ${proof.hydrated.planCpuMs} ms hydrated; file ${proof.raw} bytes`;

  // The tell: is the park this source would solve still the park that is checked in?
  const fresh = JSON.parse(readFileSync(proof.file, 'utf8')) as Record<string, unknown>;
  const decided = ['features', 'planOrder', 'measures'] as const;
  const differing = decided.filter((key) => JSON.stringify(fresh[key]) !== JSON.stringify(shipped.park[key]));
  process.stderr.write(
    differing.length === 0
      ? `check:prebuilt-park NOTE: this source still solves seed ${CANONICAL_PARK_SEED} restart ${restart} to decisions byte-identical to ` +
          `${PREBUILT_PARKS_OUT}/${CANONICAL_PARK_SEED}.json (${decided.join(', ')}); placement ${proof.solved.layout}, the manifest records ${shipped.entry.layout}.\n`
      : `check:prebuilt-park NOTE: THE GENERATOR HAS DRIFTED FROM THE CHECKED-IN PARK — a fresh solve of seed ${CANONICAL_PARK_SEED} restart ${restart} ` +
          `differs from ${PREBUILT_PARKS_OUT}/${CANONICAL_PARK_SEED}.json in ${differing.join(', ')}. Not a failure: the checked-in park is the ` +
          'park that ships for as long as validate:parks accepts it. But the search-subject checks now measure a park that is not the shipped one; ' +
          `\`LGP_SEEDS=${CANONICAL_PARK_SEED} pnpm run build:parks -- --force\` brings them back together.\n`,
  );
  process.stderr.write(
    'check:prebuilt-park NOTE: covers the canonical seed only. Every checked-in park was proven this way by build:parks when it was solved, ' +
      'and is held to this source by validate:parks.\n',
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check:prebuilt-park FAILED: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`check:prebuilt-park passed: ${summary}`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
