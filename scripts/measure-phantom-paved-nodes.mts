/**
 * **Lattice nodes the street lattice believes are paved, with no ribbon
 * drawn through them** — the defect `commitStreetPlan` now prevents.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-phantom-paved-nodes.mts 20260728 2 5 11 18
 *
 * A phantom node is not cosmetic: `planStreetToNetwork` treats any paved node
 * as a free place to terminate (`goalCost` returns 0 for one), so a later
 * spur can branch onto ground where nothing is drawn and come out "branching
 * off nothing" — seed 5's `spur-stall.facePaint`, seed 18's station spur.
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  for (const seed of seeds) {
    try {
      process.stdout.write(
        execFileSync(
          process.execPath,
          [
            '--no-warnings',
            '--import',
            './scripts/ts-extension-resolver-register.mjs',
            'scripts/measure-phantom-paved-nodes.mts',
            String(seed),
          ],
          { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
        ),
      );
    } catch (error) {
      process.stdout.write(`seed ${seed}: FAILED — ${(error as Error).message.split('\n')[0]}\n`);
    }
  }
  process.exit(0);
}

const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { PATH_GRAPH, routeCurve } = await import('../src/world/pathGraph.ts');
const { debugStreetLattice } = await import('../src/world/paths.ts');

/** Every drawn ribbon's centreline, densely sampled. */
const drawn: [number, number][] = [];
for (const edge of PATH_GRAPH.edges) {
  if (!edge.paved) continue;
  const curve = routeCurve(edge.route);
  const steps = Math.max(16, Math.ceil(curve.getLength() / 0.5));
  for (let i = 0; i <= steps; i += 1) {
    const point = curve.getPointAt(i / steps);
    drawn.push([point.x, point.z]);
  }
}

/** Generous: a node within this of any drawn centreline is genuinely on the
 * network. Wider than the ribbon's own half-width, so this only ever
 * under-reports. */
const ON_NETWORK = 3.0;

const paved = debugStreetLattice().nodes.filter((node) => node.paved);
const phantoms: string[] = [];
for (const node of paved) {
  let best = Infinity;
  for (const [x, z] of drawn) {
    const d = Math.hypot(node.x - x, node.z - z);
    if (d < best) best = d;
  }
  if (best > ON_NETWORK) phantoms.push(`(${node.x.toFixed(2)}, ${node.z.toFixed(2)}) ${best.toFixed(2)} m from any ribbon`);
}

console.log(
  `seed ${PARK_SEED}: ${paved.length} paved lattice nodes, ${phantoms.length} PHANTOM` +
    (phantoms.length ? `\n    ${phantoms.join('\n    ')}` : ''),
);
