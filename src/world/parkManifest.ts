import type { AnchorFootprint } from './anchors';

/**
 * The park manifest — the single editable input to the layout generator.
 *
 * Decision 5 (ARCHITECTURE-DECISIONS.md): the park is generated, not
 * authored. This file is the API the family edits. **Adding an attraction is
 * adding an entry here; moving one is setting `pin`.** Everything without a
 * `pin` is placed by the solver in `parkLayout.ts`, deterministically from
 * {@link PARK_SEED}, and `check:park` proves the result is a working park.
 *
 * Only the entrance is conceptually pinned (family ruling, 02:40): it is a
 * hole in the boundary wall, not a manifest entry, and the generator keeps
 * the corridor from it clear instead of placing it.
 */

/**
 * The canonical seed. One park for everyone; bumping this is a deliberate
 * design act (it re-rolls the whole layout), never a side effect. Saves
 * carry {@link LAYOUT_VERSION}, so positions from an older park degrade to
 * the plaza spawn rather than to a spot inside a relocated ride.
 */
export const PARK_SEED = seedOverride() ?? 20260728;

/**
 * Node-only escape hatch for seed hunting: `LGP_SEED=n npm run check:park`
 * (and the sweep script) try other parks without touching the canonical
 * constant. Absent in the browser bundle — Vite ships no `process` — so a
 * player can never wander into a different park by accident.
 */
function seedOverride(): number | null {
  try {
    // `process` is a Node global the browser bundle does not have; reach for
    // it via globalThis so the browser build needs no Node type definitions.
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    const raw = nodeProcess?.env?.['LGP_SEED'];
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  } catch {
    return null;
  }
}

/** Bump alongside PARK_SEED (or any generator change that moves things). */
export const LAYOUT_VERSION = 2;

export interface ManifestEntry {
  readonly id: string;
  readonly footprint: AnchorFootprint;
  /** Radius used for path routing, scenery exclusion and solver spacing. */
  readonly boundingRadius: number;
  /** Preferred distance band of the plot's centre from the park's middle. */
  readonly band: { readonly min: number; readonly max: number };
  /**
   * Fix this entry at a position instead of letting the solver choose.
   * The solver still validates it — a pin that breaks an invariant fails
   * the build rather than silently producing a broken park.
   */
  readonly pin?: readonly [number, number];
  /**
   * Keep this entry's centre within [min, max] metres of another entry —
   * e.g. the ball pit must stay where the ginormous slide can reach it.
   * A near-pair is *exempt from the corridor gap* between the two of them:
   * relations exist precisely to put things deliberately close (the slide
   * flies over the ground between building and pit), so the manifest's own
   * min is the whole rule for that one pair.
   */
  readonly near?: { readonly id: string; readonly min: number; readonly max: number };
  /**
   * Placement priority: lower places earlier. Default is by size (largest
   * first, which packs reliably). The fountain overrides this to place
   * FIRST: it is the park's middle, and everything else arranges around it —
   * placed fifth, the big plots carve its central band down to nothing.
   */
  readonly solveOrder?: number;
}

/**
 * Hard bound on how far out a plot may reach: |centre| + boundingRadius must
 * stay inside this. The train loop rests beyond 55 (`train/route.ts`) and
 * `Scenery.isPlantable` refuses past 55, so plots stopping at 52 keep the
 * treeline clear while still letting a big plot shoulder into the rail band —
 * the route solver's raycasts then bend the loop around it into a *squeeze*,
 * which Decision 4 records as a feature (the castle squeeze), not a clash.
 */
export const PLOT_EXTENT_LIMIT = 52;

/** Half-width of the corridor kept clear from the gate to the plaza. */
export const GATE_CORRIDOR_HALF_WIDTH = 7;

/**
 * The attractions. Copy (sign titles, notes, accents) stays in `anchors.ts`,
 * keyed by id — this file owns only *where things may go*.
 */
export const PARK_MANIFEST: readonly ManifestEntry[] = [
  // The fountain plaza: the park's social middle. Movable (family ruling:
  // everything moves but the entrance) but held near the centre so the park
  // stays legible to a six-year-old.
  {
    id: 'fountain',
    footprint: { kind: 'circle', radius: 9.4 },
    boundingRadius: 10.5,
    band: { min: 0, max: 12 },
    solveOrder: 0,
  },
  {
    id: 'building',
    footprint: { kind: 'rect', halfX: 15, halfZ: 11 },
    boundingRadius: 19,
    band: { min: 26, max: 42 },
  },
  {
    id: 'waterFight',
    footprint: { kind: 'rect', halfX: 12, halfZ: 11 },
    boundingRadius: 15,
    band: { min: 24, max: 40 },
  },
  {
    id: 'dodgems',
    footprint: { kind: 'rect', halfX: 12, halfZ: 10 },
    boundingRadius: 15,
    band: { min: 24, max: 40 },
  },
  {
    id: 'ferrisWheel',
    footprint: { kind: 'circle', radius: 11 },
    boundingRadius: 13,
    band: { min: 24, max: 40 },
  },
  // The ginormous slide leaves the building's roof and lands here, so the
  // pit must stay within a slide's reach of the building whatever the seed.
  {
    id: 'ballPit',
    footprint: { kind: 'circle', radius: 7.5 },
    boundingRadius: 9,
    band: { min: 10, max: 34 },
    near: { id: 'building', min: 24, max: 30 },
  },
  // Fun-fair stalls: doorways into mini-games, small plots near the paths.
  {
    id: 'stall.railRacer',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
  },
  {
    id: 'stall.spookyHouse',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
  },
  {
    id: 'stall.waterFight',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
    near: { id: 'waterFight', min: 17, max: 22 },
  },
  {
    id: 'stall.dodgems',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
    near: { id: 'dodgems', min: 17, max: 22 },
  },
  {
    id: 'stall.facePaint',
    footprint: { kind: 'circle', radius: 2.8 },
    boundingRadius: 3.6,
    band: { min: 13, max: 30 },
  },
];
