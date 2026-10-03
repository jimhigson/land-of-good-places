/**
 * **Does the cat bus's body sweep through the Rail Race's drawn supports?**
 *
 * ```
 * pnpm run check:swept-bus                      # every seed in the pool
 * pnpm run check:swept-bus -- --verbose         # and every offending post
 * ```
 *
 * This is stage 3's independent instrument — the thing every later stage-3 step
 * is measured by. See `docs/DESIGN-round-robin-generation.md`, "Stage 3".
 *
 * Three facts about why it is shaped as it is, stated here rather than pointed
 * at, because the engineering brief they came from lives on the
 * `design/round-robin-generation` branch and a pointer to it from `main` would
 * dangle — which is this file's own subject, one level up:
 *
 * 1. **It was written before the fix**, deliberately, so that it could be
 *    watched failing. A check nobody has seen go red is not known to be able to.
 * 2. **It landed as a ratchet** (a per-seed baseline, 364 drawn posts inside
 *    the bus across the sixteen pool seeds) because the park was genuinely red
 *    on it, and green meant *no worse*.
 * 3. **Step 2 made the supports claims** — the plan projection of the drawn
 *    trunk and branches below the bus's own height, asked of the registry the
 *    road claimed its corridor in — and with that the ratchet is gone: **any
 *    drawn post inside the bus, on any pool seed, fails this check**, and so
 *    does a seed whose park cannot be built at all. There is no baseline file
 *    to add an entry to.
 *
 * ## The bug it is written against is a bug in the previous instrument
 *
 * `check:entrance-road` headlined *"0 legs hit on all sixteen seeds"* while
 * resolving each trestle to its **foot** and asking the question only there.
 * `track.ts` stands a trestle's trunk from the *nudged* foot to a top under the
 * rails, so a nudged post **leans**: its foot can be two metres from the part of
 * it the bus actually meets. A reviewer measuring along the drawn post found
 * 8–9 posts per seed inside the bus at height, against a headline of zero.
 *
 * That is CLAUDE.md's signature failure — *a measurement taken on a convenient
 * origin rather than on the thing that gets drawn* — and it is why every number
 * below comes off the **built scene**:
 *
 * - the **posts** are the `railRace:trestle-*` instanced meshes' own matrices,
 *   sampled every {@link POST_STEP} along each strut's length, with each
 *   sample's radius interpolated from that mesh's own `CylinderGeometry` and
 *   scaled by the instance's own across-axis. Trunk *and* both generations of
 *   branch: a trestle forks below bus-roof height, so a check that swept only
 *   `-legs` would report clean about a bus driving through a fork.
 * - the **bus** is `createCatBus()`'s own drawn geometry — its bounding box in
 *   its own frame, measured, not restated from constants. Whiskers, ears,
 *   fenders and all: if it is drawn, a post inside it is clipping.
 * - the comparison is in **absolute world Y**, because both `track.ts` and
 *   `ArrivalSequence.placeBus` put their geometry at `terrainHeight(x, z)`.
 *   Nothing here converts to "height above the ground" and so nothing here can
 *   convert wrongly — which is the mistake one layer down from the foot bug.
 *
 * ## The rename hazard, and why this check cannot fall into it
 *
 * Issue **#520**: `check:coplanar`'s ratchet is keyed on **mesh names**, so a
 * rename orphans the entry and nobody hears. This check has no baseline any
 * more (it had one, keyed on the seed number, until step 2 drove it to zero),
 * but it meets the same hazard one layer out and answers it: **the meshes it
 * measures are asserted to exist**, on every seed. This check finds posts *by
 * name*; rename `railRace:trestle-legs` and the sweep would find nothing and
 * report a triumphant zero. So a named mesh that is absent, or present with no
 * instances, fails the run and says the mesh is gone. A green line that could
 * only be produced by measuring nothing is the disease this whole file is
 * about.
 *
 * ## The controls, run on every seed on every run
 *
 * CLAUDE.md: *"run a control on the instrument first"*. Two run beside the real
 * measurement, from the same park, and both are printed whether or not the run
 * passes.
 *
 * - **Lifted bus** — the identical sweep with the bus box translated
 *   {@link CONTROL_LIFT} m upwards, clear of everything the ride draws. It must
 *   come back **zero**. If it does not, the sweep is not height-aware at all and
 *   is really a plan projection wearing a box, and the whole run is void.
 *
 *   The brief asked for a *flat* bus (body height 0) here. A zero-height box is
 *   a horizontal **plane**, and a post crossing that plane still legitimately
 *   intersects it, so a flat bus cannot read zero in a genuine box-to-post
 *   distance test — it would only read zero in an instrument that filters post
 *   samples by a height *band*, which is the shape this one deliberately does
 *   not have. The lifted bus asks the same question ("is this height-aware?")
 *   and can answer it.
 * - **Feet-only** — the identical sweep asking `check:entrance-road`'s original
 *   question and nothing else: the **trunks alone** (`railRace:trestle-legs`),
 *   each resolved to the single point at its **foot**. No branches, nowhere
 *   along the lean. Its count is printed beside the real one on every seed, and
 *   the two differing is the evidence that the foot was the wrong origin. The
 *   **post** count is the one that fails the run.
 *
 * ## What this covers, stated plainly
 *
 * Every seed in `PARK_SEED_POOL` — the parks a child can be given. Nothing
 * outside the pool. Separately, `check:park` is canonical-only and `test:procgen`
 * covers seven of the sixteen; that gap is **#510** and is not this check's to
 * close.
 *
 * **And only the stretch of road the bus is driven along** —
 * `entranceBusArriveAt()` to `entranceBusVanishAt()`. That is the right subject
 * for a check named "swept bus", and since the sphere (#511) collapsed the brow
 * it is about **2 m of a 145.7 m road, 1.4%**. The run now prints that fraction,
 * with the denominator, on every run: it printed only "from 1.00 to -1.00 m"
 * before, under a headline of "0 intruding posts on 14 seeds" that was then
 * quoted as acceptance evidence for the *road*. A span with no whole beside it is
 * not a coverage statement, and this file's whole subject is instruments that
 * report success about something they are not describing.
 *
 * `check:entrance-road` sweeps the **whole** road and has its own control for it.
 * Neither check covers the other's span; neither may be read as if it did.
 *
 * One park per seed, one child process per seed, because `parkManifest.ts`
 * reads `LGP_SEED` once at import.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import {
  CONTROL_LIFT,
  FINER_STEP_WARNING,
  SWEEP_STEP,
  TRESTLE_MESHES,
  type SeedReport,
  OWNER_SLACK,
  sweptBusIntrusion,
  sweptBusVoids,
} from './lib/sweptBus.mts';


const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);
const verbose = process.argv.includes('--verbose');
const isChild = process.env['LGP_SWEPT_BUS_CHILD'] === '1';
const started = performance.now();


// ------------------------------------------------------------------ the child

/**
 * Measures one seed, in this process, and prints the report as JSON.
 *
 * **One park.** Every number below — the real sweep and both controls — comes
 * off the same built world; the controls change what is *asked*, never what was
 * built, so they cannot disagree with the measurement for a reason other than
 * the one under test.
 */
async function measureOneSeed(): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { saveFlags } = await import('../src/state/flags.ts');
  const { measureSweptBus } = await import('./lib/sweptBus.mts');

  // The arrival only exists for a child who has not already arrived — the same
  // hydrate `check:cat-bus` does, and for the same reason: without it the park
  // builds no bus and this check would sweep an empty road and call it clear.
  saveFlags.hydrate({ arrivedByBus: false });

  const report = await measureSweptBus(buildHeadlessPark());
  process.stdout.write(`\n__SWEPT_BUS__${JSON.stringify(report)}\n`);
}

if (isChild) {
  await measureOneSeed();
  process.exit(0);
}

// ----------------------------------------------------------------- the parent

/**
 * Every park a child can actually be given — `parkSeedPool.ts` is the one owner
 * of that question, and the canonical seed is folded in because it is the park
 * every other check measures.
 */
const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);

const limit = Math.max(1, Math.min(seeds.length, cpus().length - 1));
const reports: SeedReport[] = [];
/** Seeds whose park threw before the bus could be swept, with the thrown reason. */
const unbuilt: { seed: number; reason: string }[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: limit }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const seed = seeds[index];
      if (seed === undefined) return;
      let stdout = '';
      try {
        ({ stdout } = await run(
          process.execPath,
          ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', HERE],
          {
            env: { ...process.env, LGP_SEED: String(seed), LGP_SWEPT_BUS_CHILD: '1' },
            maxBuffer: 64 * 1024 * 1024,
          },
        ));
      } catch (error) {
        // **A park that cannot be built is a failed seed, said in one line.**
        // The Rail Race refuses a duck bar's slot with a thrown Error when no
        // support can stand (track.ts, `trestleSpots`); the child dies with it,
        // and the reason belongs in this report beside the seeds that did build,
        // not as a stack trace that hides the other fifteen.
        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        const reason =
          stderr.split('\n').find((each) => each.startsWith('Error: '))?.slice('Error: '.length) ??
          stderr.trim().split('\n').slice(-1)[0] ?? 'unknown';
        unbuilt.push({ seed, reason });
        continue;
      }
      const line = stdout.split('\n').find((each) => each.startsWith('__SWEPT_BUS__'));
      if (!line) {
        unbuilt.push({ seed, reason: 'the child produced no report' });
        continue;
      }
      reports.push(JSON.parse(line.slice('__SWEPT_BUS__'.length)) as SeedReport);
    }
  }),
);
reports.sort((a, b) => a.seed - b.seed);

// ----------------------------------------------------- can this measure at all

/**
 * **The guards that stop a green line meaning "I looked at nothing"** —
 * `sweptBusVoids`, one owner with the acceptance loop (see `lib/sweptBus.mts`).
 */
const voids: string[] = reports.flatMap((report) => sweptBusVoids(report));

// ------------------------------------------------------------------- report
//
// **Every run prints every seed**, pass or fail, to stderr — CLAUDE.md: a check
// that stops covering something must say so on every run, and a coverage note
// written to stdout is one nobody reads on a green run.

const intruding = reports.filter((report) => report.posts > 0);
const bus = reports[0]?.bus;
const route = reports[0]?.route;

/**
 * **What this check covers, in metres and as a fraction of the road, every run.**
 *
 * CLAUDE.md: *"when a check stops covering something, it must say so on every
 * run"*. This one covers the stretch the bus is **driven** along —
 * `entranceBusArriveAt()` to `entranceBusVanishAt()`, which is the whole and only
 * honest subject of a check named "swept bus". But since the sphere (#511)
 * collapsed the brow, that stretch is about **2 m of a 145.7 m road, 1.4%**, and
 * the run said only "from 1.00 to -1.00 m" — a span with no denominator beside
 * it, printed under a headline of "0 intruding posts on 14 seeds". That headline
 * was then quoted as acceptance evidence for the road merge, which it cannot
 * support: it says the bus does not hit the ride *where the bus goes*, and says
 * nothing whatever about the other 98.6% of the road.
 *
 * So the denominator is printed, and so is the sentence saying which question the
 * number answers and which it does not. `check:entrance-road` is the one that
 * sweeps the whole road; this is the one that sweeps the driven run. Neither
 * covers the other, and neither may be read as if it did.
 */
function coverageNote(at: NonNullable<typeof route>, seed: number): string {
  const swept = Math.abs(at.fromAt - at.toAt);
  const percent = (100 * swept) / at.roadLength;
  // The road's length is seeded, so the seed this was measured on is named
  // rather than left for a reader to assume it is every seed's.
  return (
    `  SWEPT (on seed ${seed}; the road's length is seeded): ${swept.toFixed(1)} m of a ` +
    `${at.roadLength.toFixed(1)} m road ` +
    `(${percent.toFixed(1)}%), from ${at.fromAt.toFixed(2)} to ${at.toAt.toFixed(2)} m ` +
    `either side of the gate, every ${SWEEP_STEP} m\n` +
    `  That is the stretch \`ArrivalSequence\` actually drives the bus along, which is what ` +
    `this check is about.\n` +
    (percent < 99
      ? `  COVERS NOTHING ELSE: the remaining ${(at.roadLength - swept).toFixed(1)} m ` +
        `(${(100 - percent).toFixed(1)}%) of the road is NOT swept here. A zero below means the\n` +
        `  bus clears the ride where the bus goes — it is not a statement about the road.\n` +
        `  \`check:entrance-road\` is the check that sweeps the whole road; read that one for that.\n`
      : '  That is the whole road.\n')
  );
}

process.stderr.write(
  `\ncheck:swept-bus — the drawn cat bus against the drawn rail-race posts, ` +
    `${reports.length} of ${seeds.length} seed(s) of PARK_SEED_POOL built.\n` +
    (bus && route
      ? `  swept the walk-past ring only (railRace:walk-past-ring), by name: the ride-scale ring exists only ` +
        `mid-race, when the bus is gone, and keeps every leg by Jim's ruling; race-ring instances seen and not swept: ` +
        `${Object.entries(reports[0]?.excludedByDesign ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n` +
        `  bus body as drawn: ${bus.length.toFixed(2)} m long, ${bus.width.toFixed(2)} m wide, ` +
        `${bus.bottom.toFixed(2)} to ${bus.top.toFixed(2)} m above the ground it stands on\n` +
        `  owner check: CAT_BUS_TOP ${bus.ownerTop.toFixed(4)} m vs the drawn top ${bus.top.toFixed(4)} m ` +
        `(off by ${(bus.top - bus.ownerTop).toFixed(4)} m, slack ${OWNER_SLACK})\n` +
        `  driven check: CAT_BUS_DRIVEN_TOP ${bus.ownerDrivenTop.toFixed(4)} m vs the drawn bus posed at its highest ` +
        `${bus.drivenTop.toFixed(4)} m (${bus.drivenPose}; off by ${(bus.drivenTop - bus.ownerDrivenTop).toFixed(4)} m, slack ${OWNER_SLACK})\n` +
        `  swept as driven: top ${bus.drivenTop.toFixed(4)} m, +${(bus.drivenTop - bus.top).toFixed(4)} m over rest\n` +
        coverageNote(route, reports[0]?.seed ?? 0)
      : '') +
    `  seed   posts  feet(control)  lifted(control)  worst penetration\n`,
);
for (const report of reports) {
  const worst = report.worst[0];
  process.stderr.write(
    `  ${String(report.seed).padStart(5)}  ${String(report.posts).padStart(5)}  ` +
      `${String(report.feet).padStart(13)}  ${String(report.lifted).padStart(15)}  ` +
      (worst
        ? `${worst.penetration.toFixed(3)} m at ${worst.up.toFixed(2)} m up (${worst.post})`
        : '—') +
      '\n',
  );
  if (verbose) {
    for (const intrusion of report.worst) {
      process.stderr.write(
        `           ${intrusion.post}  ${intrusion.penetration.toFixed(3)} m in, at ` +
          `(${intrusion.x.toFixed(2)}, ${intrusion.y.toFixed(2)}, ${intrusion.z.toFixed(2)}) ` +
          `= ${intrusion.up.toFixed(2)} m up, bus at x=${intrusion.busX.toFixed(2)}\n`,
      );
    }
  }
}
for (const { seed, reason } of unbuilt) {
  process.stderr.write(`  ${String(seed).padStart(5)}  NOT BUILT — ${reason}\n`);
}

/**
 * **The control's own number, said out loud on every run.**
 *
 * The feet-only column is the question `check:entrance-road` was asking. Step 2
 * of stage 3 is the reason the two columns should now agree at zero: a support
 * is claimed as the plan projection of the drawn trunk and branches, so a foot
 * that is clear means a post that is clear. The moment they disagree again, a
 * post is leaning through the bus with its foot outside the road — the exact
 * bug this instrument was written to see, and the claim has stopped
 * describing the drawn geometry.
 */
const differs = reports.filter((report) => report.feet !== report.posts).length;
process.stderr.write(
  `\n  CONTROL, feet-only vs the drawn post: the two counts differ on ${differs} of ` +
    `${reports.length} built seed(s).\n` +
    `  CONTROL, bus lifted ${CONTROL_LIFT} m: ` +
    `${reports.every((report) => report.lifted === 0) ? 'zero on every seed, as it must be' : 'NOT ZERO — see above'}.\n`,
);

// **Said on the run where somebody would act on it, not in a handoff.** A zero
// here is where the under-counting in POST_STEP stops being the safe direction.
if (intruding.length < reports.length) {
  process.stderr.write(
    `\n  ${reports.length - intruding.length} seed(s) read ZERO.\n` + FINER_STEP_WARNING,
  );
}

// -------------------------------------------------------------------- verdict

if (voids.length > 0) {
  console.error(
    `\ncheck:swept-bus VOID — this run measured nothing it can be trusted about:\n`,
  );
  for (const line of voids) console.error(`  ${line}`);
  process.exit(1);
}

if (unbuilt.length > 0) {
  console.error(
    `\ncheck:swept-bus — ${unbuilt.length} seed(s) could not be built, so the bus was not ` +
      'swept on them:\n',
  );
  for (const { seed, reason } of unbuilt) console.error(`  seed ${seed}: ${reason}`);
  console.error(
    '\nA park that does not build is not a clear park. If the Rail Race refused a support,\n' +
      'the placer needs a different decision (a second support shape) or the blocker must\n' +
      'move — see docs/DESIGN-round-robin-generation.md, "Stage 3, ruled".',
  );
  process.exit(1);
}

if (intruding.length > 0) {
  console.error(
    `\ncheck:swept-bus — the bus drives through the drawn ride on ${intruding.length} seed(s):\n`,
  );
  for (const report of intruding) console.error(`  ${sweptBusIntrusion(report) ?? ''}`);
  console.error(
    '\nThe fix is a support placement that clears, never a tolerance — the trestle placer\n' +
      'claims the plan projection of everything it draws below the bus (track.ts,\n' +
      '`trestleClaims`), so a post in the bus means a claim that stopped describing the\n' +
      'drawn geometry, or a road whose corridor claim is narrower than the bus it carries.',
  );
  process.exit(1);
}

console.log(
  `check:swept-bus OK — swept ${reports.length} seed(s); the drawn bus reaches no drawn ` +
    `trestle post on any of them (both controls held). ` +
    `${((performance.now() - started) / 1000).toFixed(1)} s.`,
);
