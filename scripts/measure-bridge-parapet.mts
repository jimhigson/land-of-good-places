/**
 * **Can you see through a bridge's parapet?** — issue #489.
 *
 * Jim, 3 September 2026, standing on a bridge: *"bridges have a hole in them
 * and their near side, above the arch where some of the wall is missing"*.
 *
 * This marches a horizontal ray in at the outer face of every parapet, at a
 * ladder of heights below that wall's own top, and reports the first
 * **front-facing** triangle it meets. Front-facing is the whole question: the
 * game's materials are single-sided, so a wall whose outer face is missing is a
 * wall you look straight through even though its inner face is drawn — which is
 * exactly why this reads as daylight rather than as the inside of a wall.
 *
 * ## Where the probe line comes from
 *
 * From the **drawn** `wallTop` mesh, never from `parapetHeightFor` or any other
 * formula behind it. `buildShellGeometry` writes that geometry four vertices
 * per ring — `copingOuter[+], copingOuter[−], copingInner[+], copingInner[−]` —
 * so vertex `4r + 0..3` gives, for ring `r`, the outer and inner edge of each
 * side's parapet at that side's own top height. Outward is
 * `normalize(outer − inner)` in plan. If the sweep drew the wall somewhere
 * other than where the formula says, this probes where it really is.
 *
 * **Sampled halfway between consecutive rings, never at a ring itself.** A ring
 * point is the shared edge of the two quads either side of it, and the wall is
 * drawn as straight chords between rings while the ring points sit on the arc —
 * so on a curving spine a ray aimed at a ring along that ring's own normal
 * passes just outside both chords and reports a hole in solid masonry. That is
 * the same "on the outside of a curve a chord sits inside the arc it
 * approximates" fact `ShellGeometry.planEdge` was written for. Measured: it
 * produced 1–13 phantom samples on 9 of 23 bridges, all on the same flank, and
 * every one of them vanished when the probe moved to the middle of a face.
 *
 * ## It carries its own control
 *
 * Every sample is probed **twice**: once inward at the outer face, and once
 * outward from the roadway at the *inner* face of the same wall at the same
 * height. The inner probe is the control, and it is the right one because it
 * fails in exactly the ways a bad instrument would — a ray at the wrong height,
 * on the wrong ring, aimed along the wrong normal, or below the masonry
 * altogether misses both faces, not one.
 *
 * So a sample only counts against the bridge when the inner face is there and
 * the outer face is not: proof that there is wall at that height and that you
 * can still see through it. Samples where neither face answers are reported
 * separately rather than quietly folded in.
 *
 * Rings where the parapet has tapered away entirely are skipped, on the game's
 * own threshold ({@link PARAPET_GONE_HUMP}, read from `bridges.ts` rather than
 * restated here). `parapetHeightFor` deletes the wall below that on purpose —
 * a wing wall at a ramp foot severs the path junction the foot lands in — so
 * its absence there is correct, and counting it would be a check failing on
 * geometry that is right.
 *
 * `--control` runs the negative control: the same ladder taken {@link ABOVE_TOP}
 * metres *above* each parapet top, which is open air. It must find no wall on
 * either face. A "hole finder" that reports holes in the sky is measuring
 * something other than what it claims, and two agents on this project have had
 * clean, decisive and entirely wrong answers from a flood fill nobody ran a
 * control on.
 *
 * **The first version of this control was wrong, and saying so is the point.**
 * It probed a fixed 1.6 m below the parapet top, expecting solid wall, and
 * reported 35–42% see-through on a bridge that was fine there: at a tapered
 * ramp foot, 1.6 m below the parapet top is under the masonry entirely. The
 * control caught the instrument, which is what it is for.
 *
 * ## Usage
 *
 * ```
 * pnpm run measure:bridge-parapet            # canonical seed
 * LGP_SEED=5 pnpm run measure:bridge-parapet
 * pnpm run measure:bridge-parapet -- --pool  # every seed in PARK_SEED_POOL
 * pnpm run measure:bridge-parapet -- --control   # the negative control
 * ```
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Mesh, type Object3D, Raycaster, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { PARAPET_GONE_HUMP } from '../src/world/train/bridges.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const pool = process.argv.includes('--pool');
const control = process.argv.includes('--control');
const isChild = process.env['LGP_PARAPET_CHILD'] === '1';

/**
 * How far outside the wall the ray starts.
 *
 * Only has to clear the masonry's own outer face, which stands a little proud
 * of the `wallTop` outer edge where a course is unrecessed. Kept small so a
 * ray cannot pick up a neighbouring bridge or a fence post on its way in.
 */
const STANDOFF = 3.0;

/**
 * How far outward from the wall's own inner edge the control ray starts.
 *
 * Comfortably inside the roadway (the narrowest road half-width in the park is
 * well over this) so the control ray begins in open air over the deck and meets
 * the near parapet's inner face first.
 */
const INNER_STANDOFF = 1.2;

/** How far above a parapet top the negative control probes — open air. */
const ABOVE_TOP = 0.4;

/** Heights below the parapet top the real probe walks, metres. */
const PROBE_TOP = 0.03;
const PROBE_BOTTOM = 1.5;
const PROBE_STEP = 0.05;

/** How far past the wall line a hit still counts as *this* wall. */
const HIT_SLACK = 0.25;

interface Hole {
  /** How far below the parapet top the highest see-through sample sat. */
  readonly from: number;
  /** How far below the parapet top the lowest see-through sample sat. */
  readonly to: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface BridgeResult {
  readonly name: string;
  /** Samples where the control found an inner face — i.e. there is wall here. */
  readonly walled: number;
  /** Of those, how many had no outer face: wall you can see straight through. */
  readonly seeThrough: number;
  /** Samples where neither face answered — no wall at that height at all. */
  readonly noWall: number;
  /** Samples where the outer face answered but the control did not. */
  readonly outerOnly: number;
  /** The deepest single run of see-through wall found, in metres. */
  readonly worstBand: number;
  readonly worstAt: Hole | null;
}

function measureThisSeed(): { seed: number; bridges: BridgeResult[] } {
  const park = buildHeadlessPark();
  const raycaster = new Raycaster();
  const from = new Vector3();
  const direction = new Vector3();
  const results: BridgeResult[] = [];

  // Bridges hang under `railway-bridges`, not directly off the train group, so
  // this walks the tree rather than assuming a depth.
  const groups: Object3D[] = [];
  park.world.train.group.traverse((node) => {
    if (node.name.startsWith('bridge-')) groups.push(node);
  });

  for (const group of groups) {
    const wallTop = group.getObjectByName('wallTop');
    if (!(wallTop instanceof Mesh)) continue;
    const position = wallTop.geometry.getAttribute('position');
    if (!position || position.count % 4 !== 0) continue;

    let walled = 0;
    let seeThrough = 0;
    let noWall = 0;
    let outerOnly = 0;
    let worstBand = 0;
    let worstAt: Hole | null = null;

    /** First front face along `direction` from `from`, ignoring the marker. */
    const faceAt = (): boolean => {
      raycaster.set(from, direction);
      // `deck` is the invisible clearance marker, and `intersectObject` does
      // not consult `.visible` — measuring the drawn stone means stepping
      // over it.
      return raycaster
        .intersectObject(group, true)
        .some((candidate) => candidate.object.name !== 'deck');
    };

    const rings = position.count / 4;
    // One sample per FACE, taken at its middle — see the header on why a ring
    // point is the one place this must not probe.
    for (let ring = 0; ring + 1 < rings; ring += 1) {
      for (const side of [0, 1] as const) {
        const outerA = ring * 4 + side;
        const innerA = ring * 4 + 2 + side;
        const outerB = (ring + 1) * 4 + side;
        const innerB = (ring + 1) * 4 + 2 + side;
        const ox = (position.getX(outerA) + position.getX(outerB)) / 2;
        const oy = (position.getY(outerA) + position.getY(outerB)) / 2;
        const oz = (position.getZ(outerA) + position.getZ(outerB)) / 2;
        const ix = (position.getX(innerA) + position.getX(innerB)) / 2;
        const iz = (position.getZ(innerA) + position.getZ(innerB)) / 2;
        const nx = ox - ix;
        const nz = oz - iz;
        const norm = Math.hypot(nx, nz);
        if (norm < 1e-6) continue;

        const ux = nx / norm;
        const uz = nz / norm;
        // Is a parapet meant to exist here at all? Below the taper floor the
        // wall is deliberately gone and the drawn top sits on (or under) the
        // terrain — measured, every residual sample of #489's fix was one of
        // these, at hump 0.01 m or less.
        if (oy - terrainHeight(ox, oz) <= PARAPET_GONE_HUMP) continue;
        // Run down the ladder, tracking the deepest contiguous run of misses so
        // a band is reported as a band rather than as N unrelated samples.
        let runFrom: number | null = null;
        let runTo = 0;
        const closeRun = (): void => {
          if (runFrom === null) return;
          const band = runTo - runFrom + PROBE_STEP;
          if (band > worstBand) {
            worstBand = band;
            worstAt = { from: runFrom, to: runTo, x: ox, y: oy - runFrom, z: oz };
          }
          runFrom = null;
        };

        // The negative control walks the same ladder in open air above the
        // wall, so a `drop` there is negative.
        const drops: number[] = [];
        if (control) {
          for (let d = ABOVE_TOP; d <= ABOVE_TOP + 0.4 + 1e-9; d += PROBE_STEP) drops.push(-d);
        } else {
          for (let d = PROBE_TOP; d <= PROBE_BOTTOM + 1e-9; d += PROBE_STEP) drops.push(d);
        }

        for (const drop of drops) {
          const y = oy - drop;

          // The control: outward from over the roadway at this wall's inner
          // face. If this misses there is no wall here at this height at all,
          // and the outer probe has nothing to be wrong about.
          direction.set(ux, 0, uz);
          from.set(ix - ux * INNER_STANDOFF, y, iz - uz * INNER_STANDOFF);
          raycaster.far = INNER_STANDOFF + norm + HIT_SLACK;
          const innerFace = faceAt();

          // The probe: inward at the outer face, from outside the masonry.
          direction.set(-ux, 0, -uz);
          from.set(ox + ux * STANDOFF, y, oz + uz * STANDOFF);
          raycaster.far = STANDOFF + HIT_SLACK;
          const outerFace = faceAt();

          if (!innerFace) {
            if (outerFace) outerOnly += 1;
            else noWall += 1;
            closeRun();
            continue;
          }
          walled += 1;
          if (outerFace) {
            closeRun();
            continue;
          }
          seeThrough += 1;
          if (runFrom === null) runFrom = drop;
          runTo = drop;
        }
        closeRun();
      }
    }

    results.push({ name: group.name, walled, seeThrough, noWall, outerOnly, worstBand, worstAt });
  }

  return { seed: PARK_SEED, bridges: results };
}

function report(result: { seed: number; bridges: BridgeResult[] }): void {
  const label = control ? 'control' : 'probe';
  if (result.bridges.length === 0) {
    process.stdout.write(
      `seed ${result.seed}: no bridge with a drawn parapet — every crossing fell back to the flat\n`,
    );
    return;
  }
  for (const bridge of result.bridges) {
    const pct = ((bridge.seeThrough / Math.max(1, bridge.walled)) * 100).toFixed(1);
    const where = bridge.worstAt
      ? ` Worst band ${bridge.worstBand.toFixed(2)} m, ${bridge.worstAt.from.toFixed(2)}–` +
        `${bridge.worstAt.to.toFixed(2)} m below the top, at ` +
        `(${bridge.worstAt.x.toFixed(1)}, ${bridge.worstAt.z.toFixed(1)}).`
      : '';
    process.stdout.write(
      `seed ${result.seed} ${bridge.name} [${label}]: ${bridge.seeThrough}/${bridge.walled} ` +
        `walled samples see straight through (${pct}%); ${bridge.noWall} samples have no wall ` +
        `on either face; ${bridge.outerOnly} have an outer face and no inner.${where}\n`,
    );
  }
}

if (isChild) {
  process.stdout.write(`${JSON.stringify(measureThisSeed())}\n`);
  process.exit(0);
}

if (!pool) {
  report(measureThisSeed());
} else {
  const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);
  report(measureThisSeed());
  const run = promisify(execFile);
  const queue = seeds.filter((seed) => seed !== PARK_SEED);
  const collected: { seed: number; bridges: BridgeResult[] }[] = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let seed = queue.pop(); seed !== undefined; seed = queue.pop()) {
        const { stdout } = await run(
          process.execPath,
          [
            '--no-warnings',
            '--import',
            './scripts/ts-extension-resolver-register.mjs',
            'scripts/measure-bridge-parapet.mts',
            ...process.argv.slice(2),
          ],
          {
            env: { ...process.env, LGP_SEED: String(seed), LGP_PARAPET_CHILD: '1' },
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        collected.push(JSON.parse(stdout) as { seed: number; bridges: BridgeResult[] });
      }
    }),
  );
  for (const result of collected.sort((a, b) => a.seed - b.seed)) report(result);
}
