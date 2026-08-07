import type { AnchorFootprint } from './anchors';

/**
 * The park manifest — the single editable input to the layout generator.
 *
 * Decision 5 (ARCHITECTURE-DECISIONS.md): the park is generated, not
 * authored. This file is the API the family edits. **Adding an attraction is
 * adding an entry here; moving one is a re-roll or a `pin`.** Everything
 * without a `pin` is placed by the solver in `parkLayout.ts`,
 * deterministically from {@link PARK_SEED}, and `check:park` proves the
 * result is a working park.
 *
 * Only the entrance is conceptually pinned (family ruling, 02:40): it is a
 * hole in the boundary wall, not a manifest entry, and the generator keeps
 * the corridor from it clear instead of placing it.
 *
 * **Nothing here is pinned any more** (issue #241). The 28 July park was
 * held together by 15-decimal pasted pins because every entry drew from one
 * shared RNG stream, so any manifest edit re-rolled everything after it.
 * The solver now gives each entry a stream of its own
 * (`candidateRng(hashString(id), …)`), which is what makes an unpinned
 * manifest safe to edit: adding or removing an entry cannot move any other
 * entry's candidates, only (at worst) change which of them still fit.
 * `pin` survives in the type for the day the family wants to nail one thing
 * down, but the park itself is the seed's own — every park is unique
 * (Jim's ruling, 5 Aug 2026).
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

/**
 * Bump alongside PARK_SEED (or any generator change that moves things).
 *
 * 3: issue #241 — the pins are gone and plots spread across the whole
 * spline-bounded park, so every position from layout 2 is meaningless.
 */
export const LAYOUT_VERSION = 3;

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
   * Keep this entry's *edge* within [min, max] metres of the park boundary —
   * for the things whose whole point is the rim. Distance is measured from
   * the plot's bounding circle to the spline edge, per candidate, so "near
   * the edge" stays true on every bearing of every seed even though the
   * edge is 57 m out at the pinch and 100+ at the bulge. The Rail Race
   * stall is the first user: its ride is a ring *outside* the wall, so what
   * "close to the rails" means for the booth is small distance-to-edge —
   * a radius band stopped meaning that when the park stopped being a circle.
   */
  readonly nearEdge?: { readonly min: number; readonly max: number };
  /**
   * Placement priority: lower places earlier. Default is by size (largest
   * first, which packs reliably). The fountain overrides this to place
   * FIRST: it is the park's middle, and everything else arranges around it —
   * placed fifth, the big plots carve its central band down to nothing.
   */
  readonly solveOrder?: number;
}

/** Half-width of the corridor kept clear from the gate to the plaza. */
export const GATE_CORRIDOR_HALF_WIDTH = 7;

/**
 * Walkable ground kept between a plot's edge and the boundary spline, so the
 * perimeter lane survives whatever the solver does: wide enough for the
 * player (2 x PLAYER_RADIUS = 1.24) plus the boundary wall's own footing.
 * This replaces `PLOT_EXTENT_LIMIT = 52`, which capped every plot to the old
 * circular park and left the added ground empty (issue #241) — the limit is
 * now the park's real edge, asked per bearing.
 */
export const BOUNDARY_CLEARANCE = 2.5;

/**
 * The attractions. Copy (sign titles, notes, accents) stays in `anchors.ts`,
 * keyed by id — this file owns only *where things may go*.
 *
 * Bands are preferences, not the limit: the spline boundary is the limit,
 * asked per candidate in `parkLayout.ts`. A band's `min` is what keeps the
 * middle legible (the plaza stays a plaza); a generous `max` is what lets
 * the solver use the park that now exists.
 */
export const PARK_MANIFEST: readonly ManifestEntry[] = [
  // The fountain plaza: the park's social middle. Held near the centre so
  // the park stays legible to a six-year-old.
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
    band: { min: 26, max: 60 },
  },
  // Bounding radii for these two are the MEASURED build-out (`check:park`'s
  // anchor-bounds sweep: water fight 16.3 m, dodgems 18.8 m), not the plot
  // rectangle: both rides dress past their plots, and everything that routes
  // or scatters around an anchor plans around this number. Declaring the
  // rectangle's 15 left the overhang unowned, which is where the dodgems
  // doormat kept ending up (anchor.reach ratchet).
  {
    id: 'waterFight',
    footprint: { kind: 'rect', halfX: 12, halfZ: 11 },
    boundingRadius: 16.5,
    band: { min: 24, max: 80 },
  },
  {
    id: 'dodgems',
    footprint: { kind: 'rect', halfX: 12, halfZ: 10 },
    boundingRadius: 19,
    band: { min: 24, max: 80 },
  },
  {
    id: 'ferrisWheel',
    footprint: { kind: 'circle', radius: 11 },
    boundingRadius: 13,
    band: { min: 24, max: 80 },
  },
  // The ginormous slide leaves the building's roof and lands here, so the
  // pit must stay within a slide's reach of the building whatever the seed.
  {
    id: 'ballPit',
    footprint: { kind: 'circle', radius: 7.5 },
    boundingRadius: 9,
    band: { min: 10, max: 80 },
    near: { id: 'building', min: 24, max: 30 },
  },
  // Fun-fair stalls: doorways into mini-games, small plots near the paths.
  //
  // stall.railRacer boards a ride that is a ring OUTSIDE the boundary wall
  // (`railRace/route.ts`), and the arch that carries a rider out to the ring
  // tracks whatever bearing the booth stands at — so the booth's one real
  // requirement is to hug the rim, which `nearEdge` states directly.
  {
    id: 'stall.railRacer',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 110 },
    nearEdge: { min: 2, max: 10 },
  },
  {
    id: 'stall.spookyHouse',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 60 },
  },
  {
    id: 'stall.waterFight',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    near: { id: 'waterFight', min: 17, max: 22 },
  },
  {
    id: 'stall.dodgems',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    near: { id: 'dodgems', min: 17, max: 22 },
  },
  {
    id: 'stall.skyCruiser',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    // The booth snuggles its ride the way the other booths do: the Sky
    // Cruiser's loop is woven around the castle (Decision 7's influence).
    near: { id: 'building', min: 21, max: 26 },
  },
  {
    id: 'stall.facePaint',
    footprint: { kind: 'circle', radius: 2.8 },
    boundingRadius: 3.6,
    band: { min: 13, max: 60 },
  },
];
