/**
 * **Why does the gateway path lie on the park's own paving, and by how much?**
 *
 * `check:coplanar` reports three seams made by the run in through the gate:
 * `entrance-gateway-path|garden/path-surface` at 0.240 m², and its two kerb
 * bands against `garden/path-kerb` at 0.048 and 0.060 m². The standing
 * diagnosis — inherited, not measured — is that the far end of the run is
 * placed against `forEachPavedDisc`, which is an *approximation* of the drawn
 * network by discs at its centreline samples, while the seam is measured
 * against the network's real triangles.
 *
 * This asks whether that is actually true, and it is written to be able to say
 * "no". Two numbers, and the second is the one that decides the fix:
 *
 * 1. **The overlap itself**, rasterised at 1 cm over the run's own bounding
 *    box. If this does not come back near the areas the sweep reports, the
 *    diagnosis is measuring a different thing than the sweep is and nothing
 *    below it can be trusted.
 * 2. **How far the drawn paving reaches past the published disc union.** A
 *    ribbon is drawn as a quad strip between consecutive centreline samples;
 *    the discs are circles *at* those samples. Between two samples the discs
 *    pinch in to `sqrt(r^2 - (s/2)^2)` while the drawn ribbon runs straight
 *    across at `r`, so the drawn surface pokes out of the disc union in a
 *    scallop. Any column of the run that stops where the discs say clear is
 *    then laid on top of that scallop. If the measured depth matches
 *    `r - sqrt(r^2 - (s/2)^2)` the diagnosis holds; if the overrun is metres,
 *    it is something else entirely and the fix would have been wrong.
 *
 * Run with `LGP_SEED=<n>`; the sweep names seed 5 for the surface seam, 288 and
 * 24 for the two kerb bands.
 */
import './headless-canvas.mjs';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { forEachPavedDisc } = await import('../src/world/paving.ts');

const park = buildHeadlessPark();

/** One world-space triangle, flattened to the ground plane. */
interface Tri {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly cx: number;
  readonly cz: number;
}

function trianglesOf(meshName: string): Tri[] {
  const out: Tri[] = [];
  park.scene.traverse((object) => {
    const mesh = object as { name?: string; isMesh?: boolean; geometry?: unknown; updateWorldMatrix?: unknown };
    if (!mesh.isMesh || mesh.name !== meshName) return;
    const node = object as unknown as {
      updateWorldMatrix: (a: boolean, b: boolean) => void;
      matrixWorld: { elements: number[] };
      geometry: {
        getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } | undefined;
        getIndex: () => { count: number; getX: (i: number) => number } | null;
      };
    };
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const px: number[] = [];
    const pz: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      // Full 4x4 transform, so a mesh parented under a moved group is read
      // where it is drawn rather than where it was authored.
      px.push((e[0] as number) * x + (e[4] as number) * y + (e[8] as number) * z + (e[12] as number));
      pz.push((e[2] as number) * x + (e[6] as number) * y + (e[10] as number) * z + (e[14] as number));
    }
    const index = node.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      out.push({
        ax: px[a] as number,
        az: pz[a] as number,
        bx: px[b] as number,
        bz: pz[b] as number,
        cx: px[c] as number,
        cz: pz[c] as number,
      });
    }
  });
  return out;
}

function insideAny(tris: readonly Tri[], x: number, z: number): boolean {
  for (const t of tris) {
    // Barycentric sign test, tolerant of either winding.
    const d1 = (x - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (z - t.bz);
    const d2 = (x - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (z - t.cz);
    const d3 = (x - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (z - t.az);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

/** Every published paving disc, as the router and the gateway path see them. */
const discs: { x: number; z: number; r: number }[] = [];
const published = forEachPavedDisc((x, z, r) => void discs.push({ x, z, r }));
if (!published) throw new Error('probe-gateway-seam: no paving published — the park did not build its paths.');

function inDiscUnion(x: number, z: number): boolean {
  for (const d of discs) if (Math.hypot(x - d.x, z - d.z) < d.r) return true;
  return false;
}

/** How far outside the disc union this point is — 0 if inside one. */
function depthOutsideDiscs(x: number, z: number): number {
  let best = Infinity;
  for (const d of discs) best = Math.min(best, Math.hypot(x - d.x, z - d.z) - d.r);
  return best;
}

const CELL = 0.01;

function report(runName: string, networkName: string): void {
  const run = trianglesOf(runName);
  const network = trianglesOf(networkName);
  if (run.length === 0) {
    process.stderr.write(`${runName}: not drawn on this seed — nothing to measure.\n`);
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of run) {
    minX = Math.min(minX, t.ax, t.bx, t.cx);
    maxX = Math.max(maxX, t.ax, t.bx, t.cx);
    minZ = Math.min(minZ, t.az, t.bz, t.cz);
    maxZ = Math.max(maxZ, t.az, t.bz, t.cz);
  }
  let overlapCells = 0;
  let worstBeyondDiscs = 0;
  let overlapOutsideDiscs = 0;
  for (let x = minX; x <= maxX; x += CELL) {
    for (let z = minZ; z <= maxZ; z += CELL) {
      if (!insideAny(run, x, z)) continue;
      if (!insideAny(network, x, z)) continue;
      overlapCells += 1;
      // The decisive question: is this overlapping ground somewhere the discs
      // said was clear? If so the run stopped honestly and the approximation
      // is what put it here.
      if (!inDiscUnion(x, z)) {
        overlapOutsideDiscs += 1;
        worstBeyondDiscs = Math.max(worstBeyondDiscs, depthOutsideDiscs(x, z));
      }
    }
  }
  const area = overlapCells * CELL * CELL;
  const outsideArea = overlapOutsideDiscs * CELL * CELL;
  process.stderr.write(
    `${runName} | ${networkName}\n` +
      `    overlap                 ${area.toFixed(4)} m²\n` +
      `    of which discs called clear ${outsideArea.toFixed(4)} m² ` +
      `(${area > 0 ? ((outsideArea / area) * 100).toFixed(0) : '0'}%)\n` +
      `    worst reach past the disc union ${worstBeyondDiscs.toFixed(4)} m\n`,
  );
}

/** The scallop the arithmetic predicts, for comparison with what was measured. */
const radii = discs.map((d) => d.r).sort((a, b) => a - b);
const median = radii[Math.floor(radii.length / 2)] as number;
const SAMPLE_SPACING = 0.8; // pathGraph.ts: divisions = length / 0.8
const predicted = median - Math.sqrt(Math.max(0, median * median - (SAMPLE_SPACING / 2) ** 2));
process.stderr.write(
  `seed ${process.env.LGP_SEED ?? 'canonical'}: ${discs.length} published discs, median radius ${median.toFixed(2)} m\n` +
    `predicted scallop depth at ${SAMPLE_SPACING} m sample spacing: ${predicted.toFixed(4)} m\n\n`,
);

report('entrance-gateway-path', 'path-surface');
report('entrance-gateway-path-kerb-left', 'path-kerb');
report('entrance-gateway-path-kerb-right', 'path-kerb');
