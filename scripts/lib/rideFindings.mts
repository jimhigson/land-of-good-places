/**
 * **Two Sky Cruiser checks, as functions of a built park** — one owner each,
 * asked by their scripts (`check:castle-window`, `check:cruiser-turn-radius`,
 * which print and exit) and by the root acceptance loop
 * (`scripts/park-attempt.mts`). Both judge the ride's **route**, which is a
 * per-park decision: a different restart draws a different loop, so a park
 * whose loop fails either is a park to start again, not one to ship.
 *
 * Seeded modules are imported inside the functions, never at module scope.
 */
import { Quaternion, Vector3 } from 'three';
import type { HeadlessPark } from '../park-harness.mts';

/** What `castleWindowFindings` measured, for the script's transcript. */
export interface CastleWindowFindings {
  readonly complaints: readonly string[];
  /** How far the drawn shell stands from `CASTLE_FRAME`. */
  readonly offMetres: number;
  readonly offRadians: number;
  /** One line per opening the loop cut, empty when the loop goes round the castle. */
  readonly openings: readonly string[];
}

/**
 * **The Sky Cruiser's castle pass, measured on the park that was built** (#113).
 * `checkCastleWindows` reasons about the opening from geometry and says *why*;
 * `sweptCartHits` fires the car's envelope through the castle as rays and says
 * what it struck. A loop that misses the castle has no windows: a pass here
 * (`skyCruiserAlwaysFliesThroughTheCastle` is the invariant that asks for one).
 */
export async function castleWindowFindings(park: HeadlessPark): Promise<CastleWindowFindings> {
  const { CASTLE_FRAME } = await import('../../src/world/building/layout.ts');
  const { CASTLE_WINDOWS, checkCastleWindows, sweptCartHits } = await import(
    '../../src/world/coaster/castleWindows.ts'
  );
  const route = park.world.coaster.route;
  const castleRoot = park.scene.getObjectByName('the-big-building-outside');
  if (!castleRoot) {
    // An instrument fault, not a park fault: the check finds the castle by name.
    throw new Error('castle-window: could not find the garden castle (`the-big-building-outside`) in the built scene');
  }
  // **The drawn shell IS `CASTLE_FRAME`.** The route solve and the window cut
  // describe the castle through that frame; if the shell stood anywhere else the
  // hole would be cut off the stone it sits in. It once did, by 6.82 cm /
  // 3.1e-4 rad on the canonical seed, because the frame read the base height as a
  // world `y` while `standInPlot` stood it up the leaning local vertical.
  castleRoot.updateWorldMatrix(true, false);
  const drawnAt = new Vector3();
  const drawnSpin = new Quaternion();
  castleRoot.matrixWorld.decompose(drawnAt, drawnSpin, new Vector3());
  const offMetres = drawnAt.distanceTo(CASTLE_FRAME.at.toWorld(new Vector3()));
  const offRadians = drawnSpin.angleTo(CASTLE_FRAME.q);
  const complaints: string[] = [];
  if (offMetres > 1e-6 || offRadians > 1e-6) {
    complaints.push(
      `the drawn castle stands ${(offMetres * 100).toFixed(2)} cm / ${offRadians.toExponential(1)} rad ` +
        'from CASTLE_FRAME, the transform its window was solved and cut in — two definitions of ' +
        'where the castle is. Building.ts must place the shell from CASTLE_FRAME.',
    );
  }
  complaints.push(...checkCastleWindows(route, CASTLE_WINDOWS), ...sweptCartHits(route, castleRoot));
  return {
    complaints,
    offMetres,
    offRadians,
    openings: CASTLE_WINDOWS.map((w) => `${w.wall} ${(w.maxZ - w.minZ).toFixed(2)} m wide at z ${w.trackZ.toFixed(2)}`),
  };
}

/** Arc spacing the turning radius is measured over. */
const TURN_SPACING = 2.5;

function mengerRadius(a: Vector3, b: Vector3, c: Vector3): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
}

/** What `cruiserTurnRadius` measured. */
export interface CruiserTurnRadius {
  /** The tightest radius of the curve riders are on, and where. */
  readonly built: number;
  readonly at: number;
  /** What the plan promised, and the ride's limit. */
  readonly planned: number;
  readonly limit: number;
  readonly complaints: readonly string[];
}

/**
 * Does the **built** Sky Cruiser curve honour the turning radius its plan
 * promised? Menger curvature over three points {@link TURN_SPACING} apart along
 * the built `CatmullRomCurve3`, horizontal only — see the script's header for
 * why validating the plan is not enough.
 */
export async function cruiserTurnRadius(): Promise<CruiserTurnRadius> {
  const { COASTER_PLANS } = await import('../../src/world/coaster/plan.ts');
  const { MIN_TURN_RADIUS } = await import('../../src/world/coaster/route.ts');
  const route = COASTER_PLANS.cruiser.route;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let built = Infinity;
  let at = 0;
  for (let d = 0; d < route.length; d += 0.5) {
    route.pointAt(d - TURN_SPACING, a);
    route.pointAt(d, b);
    route.pointAt(d + TURN_SPACING, c);
    const radius = mengerRadius(a, b, c);
    if (radius < built) {
      built = radius;
      at = d;
    }
  }
  const complaints =
    built >= MIN_TURN_RADIUS
      ? []
      : [
          `the built Sky Cruiser curve turns at ${built.toFixed(2)} m at ${at.toFixed(0)} m along, tighter than ` +
            `the ${MIN_TURN_RADIUS} m this ride promises (plan ${route.plan.minCurvature.toFixed(2)} m) — ` +
            'the resampling into control points has to keep the promise too',
        ];
  return { built, at, planned: route.plan.minCurvature, limit: MIN_TURN_RADIUS, complaints };
}
