/**
 * Installs {@link ./ts-extension-resolver.mjs} so Node can run a script that
 * imports `src/` (Node strips the types natively; this only fixes the missing
 * file extensions). Must be a separate `--import` module: the hook has to be
 * registered before the target's imports are resolved.
 */
import { register } from 'node:module';

register('./ts-extension-resolver.mjs', import.meta.url);
