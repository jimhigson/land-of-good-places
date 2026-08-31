/**
 * **A plan view of one bridge and everything drawn around it** — #414
 * diagnostic. Writes an SVG: the rail loop, every drawn path run (labelled
 * by run id, sized by its own halfWidth), the bridge's walkable extent and
 * its paving extent, and which path samples got draped up onto the bridge.
 *
 *   LGP_SEED=2 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/plot-bridge-neighbourhood.mts <centreX> <centreZ> <halfSpan> <out.svg>
 */
import { writeFileSync } from 'node:fs';

const cx = Number(process.argv[2] ?? 0);
const cz = Number(process.argv[3] ?? 0);
const half = Number(process.argv[4] ?? 40);
const out = process.argv[5] ?? 'bridge.svg';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { world } = buildHeadlessPark();
const { pathCentreline } = await import('../src/world/pathGraph.ts');
const { terrainHeight } = await import('../src/world/terrain.ts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');

const SCALE = 900 / (half * 2);
const px = (x: number): number => (x - cx + half) * SCALE;
const py = (z: number): number => (z - cz + half) * SCALE;

const parts: string[] = [];
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="960" viewBox="0 0 900 960">` +
    `<rect width="900" height="960" fill="#dff0d0"/>`,
);

// --- the bridges: walkable extent and paving extent, sampled on a grid ----
const STEP = 0.4;
for (const bridge of world.train.bridges) {
  for (let x = cx - half; x <= cx + half; x += STEP) {
    for (let z = cz - half; z <= cz + half; z += STEP) {
      const paving = bridge.pavingHeightAt(x, z);
      if (paving === null) continue;
      const lift = paving - terrainHeight(x, z);
      const shade = Math.min(255, Math.round(60 + lift * 40));
      parts.push(
        `<rect x="${px(x).toFixed(1)}" y="${py(z).toFixed(1)}" width="${(STEP * SCALE).toFixed(1)}" ` +
          `height="${(STEP * SCALE).toFixed(1)}" fill="rgb(${shade},${Math.round(shade * 0.6)},${Math.round(shade * 0.7)})"/>`,
      );
    }
  }
}

// --- the rail loop --------------------------------------------------------
{
  const route = world.train.route;
  const pts: string[] = [];
  for (let d = 0; d < route.length; d += 1) {
    const p = route.pointAt(d, new (await import('three')).Vector3());
    if (Math.abs(p.x - cx) > half + 5 || Math.abs(p.z - cz) > half + 5) {
      if (pts.length) pts.push('M');
      continue;
    }
    pts.push(`${pts[pts.length - 1] === 'M' || pts.length === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.z).toFixed(1)}`);
  }
  parts.push(`<path d="${pts.filter((s) => s !== 'M').join(' ')}" stroke="#8a5a2b" stroke-width="3" fill="none"/>`);
}

// --- the drawn path runs --------------------------------------------------
const samples = pathCentreline();
const byRun = new Map<number, { x: number; z: number; halfWidth: number }[]>();
for (const s of samples) {
  if (Math.abs(s.x - cx) > half + 10 || Math.abs(s.z - cz) > half + 10) continue;
  const list = byRun.get(s.run) ?? [];
  list.push(s);
  byRun.set(s.run, list);
}
const colours = ['#0044cc', '#cc0044', '#008800', '#aa00aa', '#cc6600', '#008888', '#444400', '#000088'];
for (const [run, list] of byRun) {
  const colour = colours[run % colours.length] as string;
  const w = ((list[0] as { halfWidth: number }).halfWidth * 2 * SCALE).toFixed(1);
  const d = list.map((s, i) => `${i === 0 ? 'M' : 'L'}${px(s.x).toFixed(1)},${py(s.z).toFixed(1)}`).join(' ');
  parts.push(`<path d="${d}" stroke="${colour}" stroke-width="${w}" fill="none" opacity="0.45"/>`);
  parts.push(`<path d="${d}" stroke="${colour}" stroke-width="1.5" fill="none"/>`);
  const mid = list[Math.floor(list.length / 2)] as { x: number; z: number };
  parts.push(
    `<text x="${px(mid.x).toFixed(1)}" y="${py(mid.z).toFixed(1)}" font-size="15" font-weight="bold" fill="${colour}">run ${run}</text>`,
  );
  // Mark each run's two ends — a run that ENDS inside a bridge is a dead end.
  for (const end of [list[0], list[list.length - 1]] as { x: number; z: number }[]) {
    parts.push(`<circle cx="${px(end.x).toFixed(1)}" cy="${py(end.z).toFixed(1)}" r="4" fill="${colour}" stroke="#fff"/>`);
  }
}

parts.push(
  `<text x="10" y="930" font-size="18">seed ${PARK_SEED} — centred (${cx}, ${cz}), ` +
    `${half * 2} m across. Pink = bridge paving extent, darker = higher above ground.</text>`,
);
parts.push('</svg>');
writeFileSync(out, parts.join('\n'));
console.log(`wrote ${out}`);
