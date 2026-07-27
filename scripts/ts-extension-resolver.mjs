/**
 * Lets a Node script import the game's own `src/` modules directly.
 *
 * `src` is written for a bundler, so its relative imports carry no extension
 * (`./constants`), which Node's ESM resolver will not follow. This hook adds
 * the `.ts` back, so a measurement script can drive the *real* collision code
 * rather than a copy of it that can drift.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[mc]?[jt]s$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL).href;
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      if (existsSync(fileURLToPath(candidate))) return next(candidate, context);
    }
  }
  return next(specifier, context);
}
