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
 * The canonical seed only, because the chain is where it runs. Every seed that
 * actually ships is proven the same way by `build:parks` itself, in the deploy
 * that ships it — this check exists so a change to the codec or to a plan type
 * goes red on the PR that makes it, not on the next deploy.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';
import { buildAcceptedParks } from './lib/parkFiles.mts';
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
  const { outcomes, controlProblem } = await buildAcceptedParks([CANONICAL_PARK_SEED], outDir, 1, (line) => console.log(line));
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
