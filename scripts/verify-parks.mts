/**
 * **`node … scripts/verify-parks.mts <dir>` — trust parks another run built,
 * only after checking them.** CI reuses a `.parks/` built on another branch
 * when its source hash is this tree's (`.github/workflows/parks.yml`); this
 * re-hydrates every file and requires the digest and restart its manifest
 * recorded, with nothing searched (`verifyParks`, `scripts/lib/parkFiles.mts`).
 * Exit 1, with the reasons, otherwise.
 */
import { cpus } from 'node:os';

import { verifyParks } from './lib/parkFiles.mts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: verify-parks.mts <dir>');
  process.exit(2);
}
const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 4), cpus().length));
const problems = await verifyParks(dir, lanes, (line) => console.log(line));
if (problems.length > 0) {
  for (const problem of problems) console.error(`verify-parks: ${problem}`);
  process.exit(1);
}
console.log(`verify-parks: every park in ${dir} builds the digest its manifest records`);
