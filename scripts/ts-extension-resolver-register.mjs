/**
 * Installs {@link ./ts-extension-resolver.mjs} so `node --experimental-strip-types`
 * can run a script that imports `src/`. Must be a separate `--import` module:
 * the hook has to be registered before the target's imports are resolved.
 */
import { register } from 'node:module';

register('./ts-extension-resolver.mjs', import.meta.url);
