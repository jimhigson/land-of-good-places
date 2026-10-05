/**
 * **Compare park identities across platforms** (`scripts/park-identity.mts`).
 *
 * ```
 * node … scripts/compare-park-identity.mts <dirA> <dirB>
 * ```
 *
 * Each directory holds `<seed>.json` files, one platform's identities. For
 * every seed in both: the decision structure (the three solve traces, the mesh
 * set and every mesh's vertex and instance counts) must be identical — a
 * difference is a decision that flipped between the two machines, a different
 * park, and fails. Where the structure agrees, **any centroid drift at all
 * fails too**: since `src/core/deterministicMath.ts` the two platforms build the
 * same park to the bit (0.00e+0 m on all sixteen, run 36952601192), so a drift
 * of one ulp means something has started computing differently again, the
 * first step towards a decision flipping. Printing it and passing would have
 * let it accumulate (PR #706 review). Exit 1 on any structural difference, any
 * drift, or a seed missing from either side.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Identity {
  seed: number;
  restart: number;
  platform: string;
  traces: Record<string, string>;
  traceText?: Record<string, string[]>;
  structure: string;
  meshes: { name: string; vertices: number; instances: number; centroid: [number, number, number] }[];
}

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('usage: compare-park-identity.mts <dirA> <dirB>');
  process.exit(2);
}
const read = (dir: string): Map<number, Identity> => {
  const out = new Map<number, Identity>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const id = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Identity;
    out.set(id.seed, id);
  }
  return out;
};
const a = read(dirA);
const b = read(dirB);
let failures = 0;
const seeds = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
for (const seed of seeds) {
  const x = a.get(seed);
  const y = b.get(seed);
  if (!x || !y) {
    failures += 1;
    console.log(`seed ${seed}: MISSING on ${x ? y?.platform ?? dirB : dirA}`);
    continue;
  }
  const problems: string[] = [];
  if (x.restart !== y.restart) problems.push(`restart ${x.restart} vs ${y.restart}`);
  for (const key of Object.keys(x.traces)) {
    if (x.traces[key] !== y.traces[key]) {
      // Name the first line that differs: the decision that flipped.
      const tx = x.traceText?.[key] ?? [];
      const ty = y.traceText?.[key] ?? [];
      let at = 0;
      while (at < tx.length && at < ty.length && tx[at] === ty[at]) at += 1;
      problems.push(
        `${key} trace differs from line ${at + 1} of ${tx.length}/${ty.length}` +
          (tx.length || ty.length ? `:\n      ${x.platform}: ${(tx[at] ?? '(end)').slice(0, 220)}\n      ${y.platform}: ${(ty[at] ?? '(end)').slice(0, 220)}` : ''),
      );
    }
  }
  if (x.structure !== y.structure) problems.push('mesh set or counts differ');
  let worst = 0;
  let worstName = '';
  if (problems.length === 0) {
    for (let i = 0; i < x.meshes.length; i += 1) {
      const p = x.meshes[i]!.centroid;
      const q = y.meshes[i]!.centroid;
      const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      if (d > worst) {
        worst = d;
        worstName = x.meshes[i]!.name;
      }
    }
  }
  if (problems.length > 0) {
    failures += 1;
    console.log(`seed ${seed} (${x.platform} vs ${y.platform}): DIFFERENT PARK — ${problems.join('; ')}`);
  } else if (worst > 0) {
    failures += 1;
    console.log(
      `seed ${seed} (${x.platform} vs ${y.platform}): same decisions but NOT the same bits — worst centroid drift ` +
        `${worst.toExponential(2)} m (${worstName}). The platforms have started computing differently; find what ` +
        'no longer goes through src/core/deterministicMath.ts.',
    );
  } else {
    console.log(
      `seed ${seed} (${x.platform} vs ${y.platform}): same decisions, ${x.meshes.length} meshes; ` +
        `worst centroid drift ${worst.toExponential(2)} m${worstName ? ` (${worstName})` : ''}`,
    );
  }
}
console.log(`compare-park-identity: ${seeds.length - failures}/${seeds.length} seeds are the same park on both`);
process.exit(failures > 0 ? 1 : 0);
