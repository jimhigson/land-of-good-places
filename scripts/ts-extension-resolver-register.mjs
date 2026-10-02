/**
 * Installs {@link ./ts-extension-resolver.mjs} so Node can run a script that
 * imports `src/` (Node strips the types natively; this only fixes the missing
 * file extensions). Must be a separate `--import` module: the hook has to be
 * registered before the target's imports are resolved.
 */
import { register } from 'node:module';
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

installDeterministicMath();
globalThis.__LGP_RESOLVE_RESTART__ = acceptedRestartSync;
register('./ts-extension-resolver.mjs', import.meta.url);
