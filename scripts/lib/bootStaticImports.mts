/**
 * **What `src/bootstrap.ts` loads before the park file has been read** — the
 * closure of its static imports (dynamic `import()` excluded: that is how it
 * loads the game, afterwards). A module in it evaluates before
 * `boot/prebuiltPark.ts` has set the file's restart, so none of them may be
 * the park's: `parkManifest.ts` reads the restart once, at load
 * (`parkRestart.ts`), and a park module evaluated early would build the
 * restart the bundle guessed, not the one the file names.
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const STATIC = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    try {
      readFileSync(candidate);
      if (candidate.endsWith('.ts')) return candidate;
    } catch {
      // next
    }
  }
  return null;
}

/** Repo-relative paths, sorted, of every local module `entry` loads statically (itself included). */
export function staticImportClosure(root: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC)) {
      const target = resolveLocal(file, match[1] as string);
      if (target) queue.push(target);
    }
  }
  return [...seen].map((f) => relative(root, f)).sort();
}

/** Modules that must not evaluate before the boot has read the park file. */
export const PARK_MODULES_AFTER_FILE = ['src/world/parkManifest.ts'];
