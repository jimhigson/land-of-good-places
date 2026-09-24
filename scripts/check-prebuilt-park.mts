/**
 * **`check:prebuilt-park` — does a park file build exactly the park it was
 * solved from?** On the canonical seed: solve it fresh and write its file,
 * hydrate a second process from the file, and compare the two built parks by
 * whole-park digest — with the hydrate process proven to have hydrated rather
 * than re-solved, and a perturbed file proven to digest differently
 * (`scripts/lib/parkFiles.mts` owns all three; `docs/design/PREBUILT-PARKS.md`).
 *
 * The canonical seed only, because the chain is where it runs. Every seed that
 * actually ships is proven the same way by `build:parks` itself, in the deploy
 * that ships it — this check exists so a change to the codec or to a plan type
 * goes red on the PR that makes it, not on the next deploy.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';
import { buildAndVerify } from './lib/parkFiles.mts';

const outDir = mkdtempSync(join(tmpdir(), 'lgp-prebuilt-park-'));
try {
  const { outcomes, controlProblem } = await buildAndVerify([CANONICAL_PARK_SEED], outDir, 1, (line) => console.log(line));
  const problems = [...outcomes.flatMap((o) => o.problems.map((p) => `seed ${o.seed}: ${p}`)), ...(controlProblem ? [controlProblem] : [])];
  process.stderr.write(
    'check:prebuilt-park NOTE: covers the canonical seed only. Every shipped seed is proven by build:parks in the deploy that ships it.\n',
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check:prebuilt-park: ${problem}`);
    process.exit(1);
  }
  const o = outcomes[0];
  console.log(
    `check:prebuilt-park passed: seed ${o?.seed} digest ${o?.solved.park} both ways; ` +
      `plan ${o?.solved.planCpuMs} ms searched, ${o?.hydrated.planCpuMs} ms hydrated; file ${o?.raw} bytes`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
