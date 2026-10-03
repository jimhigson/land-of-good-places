/**
 * **`node … scripts/merge-parks.mts <dir>…` — the per-seed `build:parks` outputs
 * of CI's parks matrix (`.github/workflows/parks.yml`), made one `.parks/`.**
 *
 * Each `<dir>` is one `build:parks` run's output (`LGP_PARKS_OUT`): its seed
 * files and a manifest. The merge refuses anything but a complete, consistent
 * set — every manifest of this source (`parkSourceHash`) and format, every
 * supported seed exactly once, each with its file — so a partial or stale
 * matrix can never be cached as the parks. It copies the files into
 * `.parks/` and writes the one manifest `vite build` and `builtRestartOf` read.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PARK_FILE_FORMAT,
  PREBUILT_PARKS_MANIFEST,
  PREBUILT_PARKS_OUT,
  SUPPORTED_PARK_SEEDS,
  type PrebuiltParksManifest,
} from '../src/world/prebuilt/parkFileName.ts';
import { parkSourceHash } from './lib/park-source-hash.mjs';

const root = process.cwd();
const dirs = process.argv.slice(2);
const sourceHash = parkSourceHash(root);
const problems: string[] = [];
const restarts: Record<string, number> = {};
const digests: Record<string, string> = {};
const files = new Map<number, string>();

for (const dir of dirs) {
  const path = join(dir, PREBUILT_PARKS_MANIFEST);
  if (!existsSync(path)) {
    problems.push(`${dir}: no manifest (its build:parks did not finish)`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PrebuiltParksManifest;
  if (manifest.format !== PARK_FILE_FORMAT) problems.push(`${dir}: format ${manifest.format}, this tree writes ${PARK_FILE_FORMAT}`);
  if (manifest.sourceHash !== sourceHash) problems.push(`${dir}: source ${manifest.sourceHash.slice(0, 12)}, this tree is ${sourceHash.slice(0, 12)}`);
  for (const seed of manifest.seeds) {
    const file = join(dir, `${seed}.json`);
    if (files.has(seed)) problems.push(`seed ${seed} built twice (${files.get(seed)} and ${file})`);
    if (!existsSync(file)) problems.push(`seed ${seed}: ${file} is missing`);
    files.set(seed, file);
    restarts[String(seed)] = manifest.restarts[String(seed)] as number;
    digests[String(seed)] = manifest.digests[String(seed)] as string;
  }
}
for (const seed of SUPPORTED_PARK_SEEDS) if (!files.has(seed)) problems.push(`seed ${seed}: not built`);
for (const seed of files.keys()) if (!SUPPORTED_PARK_SEEDS.includes(seed)) problems.push(`seed ${seed}: not a supported seed`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`merge-parks: ${problem}`);
  console.error('merge-parks: FAILED — nothing written');
  process.exit(1);
}

const out = join(root, PREBUILT_PARKS_OUT);
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) if (name.endsWith('.json')) rmSync(join(out, name));
const seeds = [...SUPPORTED_PARK_SEEDS];
for (const seed of seeds) copyFileSync(files.get(seed) as string, join(out, `${seed}.json`));
const manifest: PrebuiltParksManifest = { format: PARK_FILE_FORMAT, sourceHash, seeds, restarts, digests };
writeFileSync(join(out, PREBUILT_PARKS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `merge-parks: ${seeds.length} parks into ${PREBUILT_PARKS_OUT}/ at source ${sourceHash.slice(0, 12)} — restarts ` +
    seeds.map((seed) => `${seed}:${restarts[String(seed)]}`).join(' '),
);
