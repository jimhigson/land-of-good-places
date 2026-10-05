import { describe, expect, it } from 'vitest';

/**
 * `PARK_CHANGING_SWITCHES` must name every `LGP_*` the generator reads that is
 * not identity (seed, restart) or a diagnostic. A switch missing from it would
 * let the acceptance-restart resolver run the loop under an altered generator
 * (`check:layout-rung`'s machinery case did, with `LGP_LAYOUT_REFUSE`).
 */
const ACCEPTED_PARK_MODULE = '../scripts/lib/acceptedPark.mts';
const FS = 'node:fs';
const PATH = 'node:path';

describe('park-changing switches', () => {
  it('covers every LGP_* switch src/ reads, apart from identity and diagnostics', async () => {
    const { PARK_CHANGING_SWITCHES } = (await import(/* @vite-ignore */ ACCEPTED_PARK_MODULE)) as {
      PARK_CHANGING_SWITCHES: readonly string[];
    };
    const fs = (await import(/* @vite-ignore */ FS)) as { readdirSync(p: string): string[]; statSync(p: string): { isDirectory(): boolean }; readFileSync(p: string, e: string): string };
    const path = (await import(/* @vite-ignore */ PATH)) as { join(...p: string[]): string };
    const found = new Set<string>();
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bLGP_[A-Z_]*[A-Z]\b/g)) found.add(m[0]);
      }
    };
    walk('src');
    // And the generator, which moved out of the game into procgen/ (#705).
    walk('procgen');
    const identityOrDiagnostic = (k: string): boolean =>
      k === 'LGP_SEED' || k === 'LGP_PARK_RESTART' || k.startsWith('LGP_DEBUG_') || k === 'LGP_TRACE_LIVE' || k.startsWith('LGP_PARK_RESTART_') || k.startsWith('LGP_RESOLVE_RESTART');
    const missing = [...found].filter((k) => !identityOrDiagnostic(k) && !PARK_CHANGING_SWITCHES.includes(k));
    expect(missing, `add to PARK_CHANGING_SWITCHES (scripts/lib/acceptedPark.mts): ${missing.join(', ')}`).toEqual([]);
  });
});
