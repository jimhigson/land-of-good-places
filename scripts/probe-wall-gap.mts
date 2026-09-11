/**
 * Throwaway instrument: **how big a hole does the drawn boundary wall have,
 * and can a child get to it?**
 *
 * Measures the park that was built, not the rules that built it: it takes the
 * `boundary-blocks` instance matrices out of the finished scene, projects each
 * onto the boundary outline by arc length, and reports every run of edge with
 * no stone on it. The gate is the control — a hole of a known, independently
 * documented width that must show up in every run, on every seed. If the gate
 * does not appear at about the arch's width, the instrument is measuring the
 * wrong thing and none of its other numbers mean anything.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';

const OUT = process.env['LGP_GAP_OUT'] ?? '/tmp/wall-gap';

interface Gap {
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly midX: number;
  readonly midZ: number;
  readonly toTrack: number;
  readonly playRadiusClearance: number;
}

interface SeedReport {
  readonly seed: number;
  readonly perimeter: number;
  readonly blocks: number;
  readonly gaps: Gap[];
}

/** Cumulative arc length round the outline, and the projector onto it. */
function arcLengths(): {
  readonly perimeter: number;
  readonly project: (x: number, z: number) => number;
  readonly at: (s: number) => readonly [number, number];
} {
  const points = PARK_BOUNDARY.outline();
  const count = points.length;
  const cumulative: number[] = [0];
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = points[i] as readonly [number, number];
    const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
    cumulative.push((cumulative[i] as number) + Math.hypot(bx - ax, bz - az));
  }
  const perimeter = cumulative[count] as number;

  const project = (x: number, z: number): number => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < count; i += 1) {
      const [ax, az] = points[i] as readonly [number, number];
      const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSquared = dx * dx + dz * dz;
      const t =
        lengthSquared > 1e-12
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared))
          : 0;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestDistance) {
        bestDistance = d;
        best = (cumulative[i] as number) + Math.hypot(dx, dz) * t;
      }
    }
    return best;
  };

  const at = (s: number): readonly [number, number] => {
    const target = ((s % perimeter) + perimeter) % perimeter;
    for (let i = 0; i < count; i += 1) {
      if ((cumulative[i + 1] as number) < target) continue;
      const [ax, az] = points[i] as readonly [number, number];
      const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
      const segment = (cumulative[i + 1] as number) - (cumulative[i] as number);
      const t = segment > 1e-9 ? (target - (cumulative[i] as number)) / segment : 0;
      return [ax + (bx - ax) * t, az + (bz - az) * t];
    }
    return points[0] as readonly [number, number];
  };

  return { perimeter, project, at };
}

function distanceToTrack(x: number, z: number): number {
  const route = TRAIN_PLAN.route;
  const probe = new Vector3();
  const near = route.pointAt(route.distanceNear(x, z), probe);
  return Math.hypot(near.x - x, near.z - z);
}

if (process.env['LGP_GAP_CHILD'] === '1') {
  const park = buildHeadlessPark();
  park.scene.updateMatrixWorld(true);

  let blocks: InstancedMesh | null = null;
  park.scene.traverse((n: Object3D) => {
    if (n instanceof InstancedMesh && n.name === 'boundary-blocks') blocks = n;
  });
  if (!blocks) throw new Error('no boundary-blocks in the built park');
  const mesh = blocks as InstancedMesh;

  const { perimeter, project, at } = arcLengths();
  const matrix = new Matrix4();
  const position = new Vector3();
  const stations: number[] = [];
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
    stations.push(project(position.x, position.z));
  }
  stations.sort((a, b) => a - b);

  // A gap is a run of edge carrying no block centre. Anything under one block
  // width is just the ordinary spacing between neighbours.
  const BLOCK_WIDTH = 1.7;
  const gaps: Gap[] = [];
  for (let i = 0; i < stations.length; i += 1) {
    const from = stations[i] as number;
    const to = (stations[(i + 1) % stations.length] as number) + (i + 1 === stations.length ? perimeter : 0);
    const length = to - from;
    if (length <= BLOCK_WIDTH * 1.25) continue;
    const midpoint = (from + to) / 2;
    const [mx, mz] = at(midpoint);
    gaps.push({
      from,
      to,
      length,
      midX: mx,
      midZ: mz,
      toTrack: distanceToTrack(mx, mz),
      playRadiusClearance: Math.hypot(mx, mz) - 58,
    });
  }

  const report: SeedReport = { seed: PARK_SEED, perimeter, blocks: mesh.count, gaps };
  await writeFile(`${OUT}/seed-${PARK_SEED}.json`, JSON.stringify(report), 'utf8');
} else {
  const run = promisify(execFile);
  await mkdir(OUT, { recursive: true });
  const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);
  await Promise.all(
    seeds.map(async (seed) => {
      await run(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/probe-wall-gap.mts',
        ],
        {
          env: { ...process.env, LGP_SEED: String(seed), LGP_GAP_CHILD: '1', LGP_GAP_OUT: OUT },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    }),
  );
  for (const seed of seeds) {
    const report = JSON.parse(await readFile(`${OUT}/seed-${seed}.json`, 'utf8')) as SeedReport;
    const lines = report.gaps
      .sort((a, b) => b.length - a.length)
      .map(
        (g) =>
          `    ${g.length.toFixed(2)} m at (${g.midX.toFixed(1)}, ${g.midZ.toFixed(1)})` +
          `  track ${g.toTrack.toFixed(1)} m  outside play radius by ${g.playRadiusClearance.toFixed(1)} m`,
      );
    process.stdout.write(
      `seed ${report.seed}: perimeter ${report.perimeter.toFixed(1)} m, ` +
        `${report.blocks} block instances, ${report.gaps.length} gap(s)\n${lines.join('\n')}\n`,
    );
  }
}
