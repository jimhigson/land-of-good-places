import { PARK_SEED } from '../parkManifest';
import { unplain, parkFileProblem, type BuiltDecision } from './parkFile';
import { offeredParkFile, parkFileMissingReason } from './parkFileStore';
import { ParkUnavailable } from './parkUnavailable';
import { parkSolver, type ParkSolver } from './solverPort';

/**
 * **One decision the park makes while it builds, read or searched** — the
 * cruiser's pylons, the slide's legs, the rail race's exit and arch, the ferris
 * wheel's exit, the boundary (`docs/design/PREBUILT-PARKS.md`).
 *
 * With a park file: its recorded value, as plain data. Without one: the
 * installed solver's search — build tooling only (`procgen/`), which also
 * records what it decided for `build:parks` to write. The game as delivered
 * has no solver, so there it is the file or {@link ParkUnavailable}.
 */
export function decideBuilt<T>(key: BuiltDecision, search: (solver: ParkSolver) => T): T {
  const file = offeredParkFile();
  if (file) {
    const problem = parkFileProblem(file, PARK_SEED);
    if (problem) throw new ParkUnavailable(PARK_SEED, problem);
    return unplain(file.features.built[key] as never, `built.${key}`) as T;
  }
  const solver = parkSolver();
  if (!solver) throw new ParkUnavailable(PARK_SEED, parkFileMissingReason() ?? 'no park file was loaded');
  return search(solver);
}
