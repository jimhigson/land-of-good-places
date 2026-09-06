import { TRAIN_PLAN } from './train/plan';
import {
  CROSSING_SITES,
  maxCrossingDemands,
  publishCrossingSites,
  resolveCrossingSites,
} from './train/crossingPlan';
import { screenDrawnPathsForOffSiteCrossings } from './train/crossingPredicate';
import {
  drawnSamplesFor,
  pathGraphSearch,
  resetPathSolveState,
  type PathGraph,
  type RouteDefinition,
} from './paths';

/**
 * **The path solve and the crossing plan, negotiated until they agree.**
 *
 * ## The disagreement this exists to settle
 *
 * `crossingPlanSolve.ts` marches the loop before a single path is drawn and
 * keeps every point a real bridge provably fits — ranked by how square and how
 * roomy the ground is, spaced 24 m apart. `paths.ts` then routes the network,
 * and every leg that must cross the railway is supposed to cross at one of
 * those sites. **Nothing ever made the two agree**, and on two of the sixteen
 * pool seeds they do not: a drawn path crosses the rail where no bridge was
 * proven, and the park fails to build three systems later, out of scenery
 * planting.
 *
 * The site solver has, in its own words, "nothing here [that] prefers a site"
 * where the network needs one. That is the gap. It is not fixed by ranking
 * candidates better, because the network's needs are not knowable until the
 * network is routed — and the network cannot be routed until the sites exist.
 *
 * ## The shape of the fix, and the shape it deliberately is not
 *
 * The obvious fix is to let a fouling path *claim* a site: prove a bridge at
 * the distance it crossed and append it to `CROSSING_SITES`. That is what the
 * design first said, and it is wrong. It mutates a published list after
 * `crossingPlanSolve` has run, which collides with `bridgeKeepout.ts`'s
 * memoised footprints — cache invalidation across two generators, and a second
 * definition of freshness kept in step by hand.
 *
 * So instead: **the site solve is a pure function of a demand set, and no site
 * is ever added to an already-published list.** A foul does not claim a site,
 * it produces a *demand*; the whole plan is then solved again from the fixed
 * inputs plus the demands, and the paths are routed again against it. Round and
 * round until the committed routes foul nothing or the demand set stops
 * changing. `CROSSING_SITES` is published exactly once, at the end.
 *
 * That makes staleness impossible rather than merely unlikely, which is why
 * `bridgeKeepout` needs no invalidation — it needs an assertion, and it has one.
 *
 * ## Three things about this loop that are not obvious
 *
 * - **Iteration 0 costs nothing.** `crossingPlan.ts` already solved the empty
 *   demand set at module load, exactly as it always did, so the first pass
 *   through here re-solves nothing. On the fourteen pool seeds that foul
 *   nothing the loop runs once, re-solves nothing, and publishes what was
 *   already there — which is why their parks are byte-identical rather than
 *   merely intended to be.
 * - **The screen asks the routes that will actually be committed**, taken off
 *   the graph's own paved edges, and asks them of the *drawn* Catmull-Rom
 *   samples. Both halves have already caught a wrong answer here. A screen of
 *   the candidate under consideration measured geometry nobody lays, because a
 *   station spur with no lead plan falls back to `fallbackSpurRoute`; and a
 *   screen of the control polyline changed not one of seed 288's 1342 samples,
 *   because the polyline holds its rail side while the curve through it bulges
 *   across.
 * - **`pathGraphSearch()` is not idempotent** — see `resetPathSolveState()`,
 *   which is what makes iteration *n+1* start where iteration *n* did rather
 *   than on top of its paving.
 */

/** What one pass of the loop found, before deciding whether to go round again. */
interface Pass {
  readonly graph: PathGraph;
  readonly routes: readonly RouteDefinition[];
  readonly samplesScanned: number;
  /** Rail distances of the drawn fouls — the demands this pass produces. */
  readonly fouls: readonly { railDistance: number; x: number; z: number; run: number }[];
}

function write(line: string): void {
  const p = (globalThis as { process?: { stderr?: { write: (s: string) => void } } }).process;
  p?.stderr?.write(line);
}

function pavedRoutes(graph: PathGraph): readonly RouteDefinition[] {
  return graph.edges.filter((edge) => edge.paved).map((edge) => edge.route);
}

/**
 * One solve of the whole network against whatever `CROSSING_SITES` currently
 * holds, screened. Yields through the underlying search so the boot can spread
 * it across frames exactly as it always did.
 */
function* onePass(): Generator<number, Pass, void> {
  resetPathSolveState();
  const graph = yield* pathGraphSearch();
  const routes = pavedRoutes(graph);
  const samples = drawnSamplesFor(routes);
  const screened = screenDrawnPathsForOffSiteCrossings(TRAIN_PLAN.route, samples);
  return {
    graph,
    routes,
    samplesScanned: screened.samplesScanned,
    fouls: screened.fouls.map((f) => ({
      railDistance: f.railDistance,
      x: f.x,
      z: f.z,
      run: f.run,
    })),
  };
}

/**
 * **The converge loop.** Returns the graph whose committed routes cross the
 * railway only where a bridge is proven, and publishes the site list it agreed
 * with.
 *
 * @throws if the loop cannot converge — a park nobody can build, named loudly
 * at the point of decision rather than thrown out of scenery planting three
 * systems later.
 */
export function* pathGraphConvergeSearch(): Generator<number, PathGraph, void> {
  // The bound is derived, not typed: `roundDemands` folds two demands closer
  // than SITE_SPACING into one, so the loop can never accept more demands than
  // the loop has room for. One extra pass because the final one is the pass
  // that *confirms* no foul rather than one that adds a demand.
  const bound = maxCrossingDemands() + 1;
  const demands: number[] = [];
  let iterations = 0;

  for (;;) {
    iterations += 1;
    const pass = yield* onePass();

    // **A zero scan is a failure, not a clean report.** A screen that looks in
    // the wrong place finds nothing and says so exactly as confidently as a
    // screen that looked everywhere. This is the leg that caught the first
    // wiring of this check, against a `pathCentreline()` that is empty until
    // world-build; it stays armed for the next person who moves it.
    if (pass.samplesScanned === 0) {
      throw new Error(
        'crossing recovery: the screen scanned 0 drawn samples, so "no fouls" ' +
          `describes nothing. ${pass.routes.length} paved route(s) were offered to it. ` +
          'The samples are being taken somewhere the drawn geometry does not exist.',
      );
    }

    if (pass.fouls.length === 0) {
      write(
        `crossing recovery: seed converged in ${iterations} iteration(s), ` +
          `${demands.length} demand(s), ${pass.routes.length} paved routes, ` +
          `${pass.samplesScanned} drawn samples scanned, ${CROSSING_SITES.length} site(s)\n`,
      );
      if (demands.length === 0) {
        // Said out loud, every run, because a loop that silently did nothing
        // and a loop that had nothing to do are otherwise indistinguishable —
        // and only one of them is working.
        write('crossing recovery: 0 demands — nothing crossed off-site on this seed\n');
      }
      publishCrossingSites();
      return pass.graph;
    }

    // A foul is a demand at the rail distance the **drawn curve** crossed at —
    // the router's own measurement, never the control polyline's. Folding two
    // demands that land within one site's spacing into one is the solve's
    // business, not this loop's.
    write(
      `crossing recovery: iteration ${iterations} — ${pass.samplesScanned} samples, ` +
        `${pass.fouls.length} off-site crossing(s)\n`,
    );
    const added: number[] = [];
    for (const foul of pass.fouls) {
      const route = pass.routes[foul.run];
      write(
        `  FOUL railD ${foul.railDistance.toFixed(1)} at ` +
          `(${foul.x.toFixed(1)}, ${foul.z.toFixed(1)}) drawn by ` +
          `"${route?.name ?? `run #${foul.run}`}"\n`,
      );
      if (!demands.includes(foul.railDistance)) added.push(foul.railDistance);
    }

    // **The demand set stopped changing while fouls remain.** Going round again
    // would solve the identical site plan and route the identical paths, so
    // this is not slow convergence, it is the second rung failing: every foul
    // here is a route whose producer could not re-route and whose demand could
    // not be proven.
    if (added.length === 0) {
      throw new Error(
        `crossing recovery: the demand set stopped changing with ` +
          `${pass.fouls.length} off-site crossing(s) still drawn, after ` +
          `${iterations} iteration(s). Demands: ` +
          `${demands.map((d) => d.toFixed(1)).join(', ') || '(none)'}. Fouls: ` +
          pass.fouls
            .map(
              (f) =>
                `railD ${f.railDistance.toFixed(1)} at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})` +
                ` drawn by "${pass.routes[f.run]?.name ?? `run #${f.run}`}"`,
            )
            .join('; ') +
          '. Every rung is spent: no bridge can be proven where these paths cross, ' +
          'and their producers have no re-route left. This seed cannot be built.',
      );
    }

    demands.push(...added);
    if (iterations >= bound) {
      throw new Error(
        `crossing recovery: did not converge in ${bound} iteration(s) — the bound ` +
          `derived from loopLength / SITE_SPACING, which no honest demand set can ` +
          `exceed. ${demands.length} demand(s) accumulated: ` +
          `${demands.map((d) => d.toFixed(1)).join(', ')}. This is a bug in the loop, ` +
          'not a hard seed.',
      );
    }

    const solved = resolveCrossingSites(demands);
    if (solved.unservable.length > 0) {
      write(
        `crossing recovery: ${solved.unservable.length} demand(s) unservable — ` +
          `${solved.unservable.map((d) => d.toFixed(1)).join(', ')}; ` +
          'the fouling routes must re-route instead\n',
      );
    }
  }
}

/** The same loop, driven straight through — Node, the harness, and any boot
 *  that did not pre-warm. */
export function convergePathGraph(): PathGraph {
  const search = pathGraphConvergeSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}
