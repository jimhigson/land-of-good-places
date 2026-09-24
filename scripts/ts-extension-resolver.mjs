/**
 * Where an extensionless relative import of a `src/` module really is — the
 * one rule `ts-extension-resolver-register.mjs` installs as a Node hook.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The `.ts` (or `/index.ts`) URL an extensionless relative specifier means, or null to leave it alone. */
export function resolveTsExtension(specifier, parentURL) {
  if (!parentURL || !specifier.startsWith('.') || /\.[mc]?[jt]s$/.test(specifier)) return null;
  const base = new URL(specifier, parentURL).href;
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}
