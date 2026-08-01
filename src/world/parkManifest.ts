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
 *
 * **Why nearly everything is pinned:** these are the solved positions of the
 * park the family approved on 28 July. Pinning them keeps that park exactly
 * while new entries (the Sky Cruiser's stall was the first) are placed by
 * the solver around them — without pins, any addition re-rolled the whole
 * arrangement, which broke "adding an attraction is adding a line". To
 * re-roll the park deliberately: delete the pins and bump PARK_SEED.
 */
export const PARK_MANIFEST: readonly ManifestEntry[] = [
  // The fountain plaza: the park's social middle. Movable (family ruling:
  // everything moves but the entrance) but held near the centre so the park
  // stays legible to a six-year-old.
  {
    id: 'fountain',
    pin: [4.96489106075262, 7.750971156106802],
    footprint: { kind: 'circle', radius: 9.4 },
    boundingRadius: 10.5,
    band: { min: 0, max: 12 },
    solveOrder: 0,
  },
  {
    id: 'building',
    pin: [-17.379101772707354, -24.68456869332909],
    footprint: { kind: 'rect', halfX: 15, halfZ: 11 },
    boundingRadius: 19,
    band: { min: 26, max: 42 },
  },
  {
    id: 'waterFight',
    pin: [32.9413989483355, -14.5429227619724],
    footprint: { kind: 'rect', halfX: 12, halfZ: 11 },
    boundingRadius: 15,
    band: { min: 24, max: 40 },
  },
  {
    id: 'dodgems',
    pin: [-23.62827940709836, 26.640671757006064],
    footprint: { kind: 'rect', halfX: 12, halfZ: 10 },
    boundingRadius: 15,
    band: { min: 24, max: 40 },
  },
  {
    id: 'ferrisWheel',
    pin: [22.200529615211444, 30.762495788486575],
    footprint: { kind: 'circle', radius: 11 },
    boundingRadius: 13,
    band: { min: 24, max: 40 },
  },
  // The ginormous slide leaves the building's roof and lands here, so the
  // pit must stay within a slide's reach of the building whatever the seed.
  {
    id: 'ballPit',
    pin: [6.935078330951129, -27.93267837318263],
    footprint: { kind: 'circle', radius: 7.5 },
    boundingRadius: 9,
    band: { min: 10, max: 34 },
    near: { id: 'building', min: 24, max: 30 },
  },
  // Fun-fair stalls: doorways into mini-games, small plots near the paths.
  //
  // stall.railRacer stands at the park's rim (1 August 2026), close to the
  // rail-race loop it boards: `railRace/route.ts` flies that ring at a
  // constant 53.5 m nominal radius all the way round, so what "close to the
  // rails" means for a booth is *radial* distance from the middle, not
  // bearing — the arch that carries a rider out to the ring already tracks
  // whatever bearing the booth stands at (`route.ts`'s `startDistance`).
  //
  // 41 m keeps the plot's own edge (41 + 3.4 = 44.4) a solid margin short of
  // the train's 48 m inner edge, so the rail loop is untouched by this move.
  // An earlier attempt (PR #159) tried moving this pin, found `check:park`
  // failing with stranded `poiGraph` waypoints at every rim position it
  // swept, and concluded the move was blocked. It was not the rim itself
  // that was unreachable — two separate, fixable bugs were:
  //
  // 1. `paths.ts`'s spur `past` extension always overshot 2 m towards the
  //    plot regardless of how close the doormat already stood to the plot's
  //    edge — for every stall (2.6 m footprint, 1.4 m standoff) that put the
  //    waypoint 0.6 m *inside* the booth's own collision. Inland, with a
  //    dense waypoint mesh on every side, `findClearSpot`'s nudge search
  //    could rescue that overshoot in any direction and still land near a
  //    neighbour; at the rim, with only one way back to the network, a nudge
  //    onto the booth's far side stranded the waypoint behind its own wall.
  //    Fixed generically in `paths.ts` (`PAST_CLEARANCE`), for every stall,
  //    not just this one.
  // 2. Once fixed, most bearings still failed for two *unrelated* reasons
  //    that only a real sweep (not one hand-picked point) would separate:
  //    low bearings (0-15°) put this plot's edge within `CORRIDOR_GAP` of
  //    the `waterFight` anchor's own 15 m plot, which the solver correctly
  //    rejects as an unbuildable pin; and a band of bearings around 10-18°
  //    happened to shift `Scenery`'s single shared RNG stream (this spur is
  //    now ~2.5x longer, which changes how much ground counts as "on path"
  //    early in that stream) into placing a garden wall across the *ferris
  //    wheel kiosk's* own line of sight — a waypoint with no relation to
  //    this stall, stranded as pure collateral. Swept bearing 0-35° x radius
  //    38-46 m against the real built park (`sweep.sh`/`sweep2.sh` in the
  //    branch handoff) rather than chase one seed by hand; 20°/41 m is
  //    clean on every invariant, with headroom either side.
  {
    id: 'stall.railRacer',
    pin: [38.527397452222246, 14.022825876352417],
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 42 },
  },
  {
    id: 'stall.spookyHouse',
    pin: [-14.009419630595104, 2.531869221037949],
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
  },
  {
    id: 'stall.waterFight',
    pin: [16.198422689521646, -11.141212665997175],
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
    near: { id: 'waterFight', min: 17, max: 22 },
  },
  {
    id: 'stall.dodgems',
    pin: [-6.494351647680116, 24.895734667592652],
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 30 },
    near: { id: 'dodgems', min: 17, max: 22 },
  },
  {
    id: 'stall.skyCruiser',
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    // The pinned park is packed solid: a probe of the whole 13–36 annulus
    // found zero cells that keep CORRIDOR_GAP from every plot, and the outer
    // ring sits in the rail band (placing there deformed the train loop and
    // regressed rail.exclusion). The one real pocket is west of the castle —
    // inside the castle's rail shadow, so the train route never notices it.
    // The near relation reaches it the same way the other booths snuggle
    // their rides.
    band: { min: 13, max: 36 },
    near: { id: 'building', min: 21, max: 26 },
  },
  {
    id: 'stall.facePaint',
    pin: [-26.12933205483198, 2.951281913621141],
    footprint: { kind: 'circle', radius: 2.8 },
    boundingRadius: 3.6,
    band: { min: 13, max: 30 },
  },
];
