/**
 * Lets a Node script import the game's own `src/` modules directly, and plugs
 * the build-time park solver (`procgen/`) into them.
 *
 * **Extensions.** `src` is written for a bundler, so its relative imports
 * carry no extension (`./constants`), which Node's resolver will not follow.
 * The hook below adds the `.ts` back (Node strips the types natively). It is a
 * *synchronous* hook (`registerHooks`), so it serves `require()` as well as
 * `import` — which the solver loader below depends on.
 *
 * **The solver.** The game as delivered carries no park solver
 * (`docs/design/PREBUILT-PARKS.md`); `src/` only has a port for one
 * (`src/world/prebuilt/solverPort.ts`). Node tooling — every check, every
 * measurement, `build:parks` — gets the real one here, **lazily**: the loader
 * runs the first time a park is asked for with no park file offered, so a
 * script that never builds a park never loads it, and one that sets
 * `LGP_SEED` in-process before importing the park still gets its own seed.
 * `require` of an ES module shares the one module cache with `import`, so the
 * solver installs into the same `solverPort` instance the park reads.
 *
 * Must be a separate `--import` module: the hook has to be registered before
 * the target's imports are resolved.
 */
import { createRequire, registerHooks } from 'node:module';
// Also the Node end of `src/core/deterministicMath.ts`: every script that
// imports `src/` comes through here, before its own modules evaluate, so every
// park built by a script uses the same `Math` on a Mac as on the CI runner.
// Imported by full path because the resolver below is not registered yet.
import { installDeterministicMath } from '../src/core/deterministicMath.ts';
// And the Node end of the accepted restart: `src/world/parkRestart.ts` asks
// this when a supported seed's park is built with no explicit restart. It reads
// the acceptance loop's verdict at this source, or runs the loop (lazily: only
// a process that builds a park ever calls it). Node builtins only, so it loads
// before the resolver below is registered.
import { acceptedRestartSync } from './lib/acceptedPark.mts';
import { builtParkFileOf, parkSwitches } from './lib/builtParks.mts';

installDeterministicMath();
globalThis.__LGP_RESOLVE_RESTART__ = acceptedRestartSync;
// And the shipped park file itself, when there is one for this source: a
// process that builds a supported seed's park with no explicit restart and no
// park-changing switch hydrates it from `.parks/` (`builtParkFileOf`) instead of
// solving it — the park the game ships, proven equal to the solve.
globalThis.__LGP_RESOLVE_PARK_FILE__ = (seed) => builtParkFileOf(process.cwd(), seed, process.env);

import { resolveTsExtension } from './ts-extension-resolver.mjs';

registerHooks({
  resolve(specifier, context, next) {
    return next(resolveTsExtension(specifier, context.parentURL) ?? specifier, context);
  },
});

const require = createRequire(import.meta.url);
const port = await import('../src/world/prebuilt/solverPort.ts');
port.setParkSolverLoader(() => {
  require('../procgen/install.ts');
});
// The boundary's search on its own: it is first needed while the game's
// modules are still loading, and this one imports none of them.
port.setBoundarySolverLoader(() => {
  require('../procgen/world/boundaryRadii.ts');
});

// **`LGP_PARK_FILE=<park file>`: build that file's park, as the browser does.**
// The file's restart is set, and the file offered, before the script imports
// anything of the park — exactly `boot/prebuiltPark.ts`'s order — so every
// script run under it (an acceptance attempt, and each check script the
// attempt runs in its own process) builds the park hydrated from that file
// and searches nothing. This is how `build:parks` asks every acceptance
// measure of the file it is about to ship, rather than of a fresh solve.
// A child that sets a switch the park's code reads (builtWell's
// `LGP_LAYOUT_RUNG=off` solve, run under an acceptance attempt that set
// LGP_PARK_FILE) is asking for a park other than the file's, so it solves.
const parkFilePath =
  process.env['LGP_PARK_FILE'] &&
  !Object.keys(process.env).some((key) => process.env[key] && parkSwitches(process.cwd()).has(key))
    ? process.env['LGP_PARK_FILE']
    : undefined;
if (parkFilePath) {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(parkFilePath, 'utf8'));
  const askedRestart = process.env['LGP_PARK_RESTART'];
  if (askedRestart !== undefined && askedRestart !== '' && Number(askedRestart) !== file.restart) {
    throw new Error(
      `LGP_PARK_FILE ${parkFilePath} is restart ${file.restart}, but LGP_PARK_RESTART=${askedRestart} asks for another park`,
    );
  }
  const askedSeed = process.env['LGP_SEED'];
  if (askedSeed !== undefined && askedSeed !== '' && Number(askedSeed) !== file.seed) {
    throw new Error(`LGP_PARK_FILE ${parkFilePath} is seed ${file.seed}, but LGP_SEED=${askedSeed} asks for another park`);
  }
  process.env['LGP_SEED'] = String(file.seed);
  globalThis.__LGP_PARK_RESTART__ = file.restart;
  const { offerParkFile } = await import('../src/world/prebuilt/parkFileStore.ts');
  offerParkFile(file);
}
