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
