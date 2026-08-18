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
 *
 * 4: issues #119/#225 — the keychain stall's manifest entry. Per-entry RNG
 * streams (#241's own doc comment above) mean adding it cannot move any
 * *other* entry's candidates, but this still forces a fresh solve rather than
 * risk `cachedSolve` handing back a `localStorage` layout from before the
 * stall existed on some browser that visited an earlier build of this seed.
 */
export const LAYOUT_VERSION = 4;

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
  /**
   * This entry's front faces the CAMERA (roughly +Z), not the park middle.
   *
   * GAME_DESIGN #16 is absolute: a stall's counter must face the one
   * direction the fixed isometric camera can read. The booths have always
   * been built that way (`stallPlacement.ts`), but the solver used to put
   * every doormat on the middle side regardless — two authorities for which
   * side of a booth is the front, which agreed by luck on the old pinned
   * park and disagreed the moment stalls spread (issue #241): stand points
   * ended up behind their own counters and their waypoints stranded.
   */
  readonly cameraFacing?: boolean;
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
    // 19.3: the castle's own masonry reaches 19.0 exactly, and on some seeds
    // the dressing spills another few centimetres (the reach sweep measured
    // 19.1 on seed 2). Declared at what stands, plus breathing room.
    boundingRadius: 19.3,
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
    // The pools and hedges are seeded per park and the worst sweep measured
    // 18.4 (seed 5); 16.3 was only ever the canonical seed's number.
    boundingRadius: 18.5,
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
    // max 26.5, from 30 via 28 (issue #241): the slide's chute has a 75 m
    // rideable ceiling (length is gradient — see slide/plan.ts), and every
    // time the rides re-solve, the seeds whose pit rolled the far end of
    // the ring are the ones whose every solvable route comes out 80-90 m —
    // the chute detours round whatever the cruiser grew between castle and
    // pit. Each 1.5 m off the relation's far end has bought a failing seed
    // back without costing the near end anything a player can see.
    near: { id: 'building', min: 24, max: 26.5 },
  },
  // The Land Hotel (issue #236, Eleri's own spec): a crystal tower CLOSE TO
  // THE CASTLE — the near relation is her requirement verbatim. Fifty
  // storeys in the fiction; the inside is four disjoint spaces reached
  // through the door (see world/hotel/). min 28 keeps the tower's crystal
  // skirt clear of the castle rect's corner; max 42 keeps "close" honest.
  {
    id: 'hotel',
    footprint: { kind: 'circle', radius: 8 },
    boundingRadius: 9,
    band: { min: 10, max: 90 },
    near: { id: 'building', min: 28, max: 42 },
    // Jim's ruling, 7 Aug: ALL assets face the camera. The tower's door, its
    // awning and its doormat all derive from this one flag, exactly like a
    // stall's counter — without it the solver faced the door at the park
    // middle, which from most placements is straight away from the camera:
    // a hotel you could walk all round without ever seeing a way in.
    cameraFacing: true,
  },
  // Fun-fair stalls: doorways into mini-games, small plots near the paths.
  //
  // stall.railRacer boards a ride that is a ring OUTSIDE the boundary wall
  // (`railRace/route.ts`), and the arch that carries a rider out to the ring
  // tracks whatever bearing the booth stands at — so the booth's one real
  // requirement is to hug the rim, which `nearEdge` states directly.
  {
    id: 'stall.railRacer',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 110 },
    nearEdge: { min: 2, max: 10 },
  },
  {
    id: 'stall.spookyHouse',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 60 },
  },
  {
    id: 'stall.waterFight',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    near: { id: 'waterFight', min: 17, max: 22 },
  },
  {
    id: 'stall.dodgems',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    near: { id: 'dodgems', min: 17, max: 22 },
  },
  {
    id: 'stall.skyCruiser',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 90 },
    // The booth snuggles its ride the way the other booths do: the Sky
    // Cruiser's loop is woven around the castle (Decision 7's influence).
    near: { id: 'building', min: 21, max: 26 },
  },
  {
    id: 'stall.facePaint',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.8 },
    boundingRadius: 3.6,
    band: { min: 13, max: 60 },
  },
  // The keychain stall (#119/#225): a garden cart, not a walk-in booth, so it
  // sizes like the mini-game stalls above rather than the wider face-paint
  // booth — see `world/KeychainShop.ts`'s own `STALL_WIDTH`.
  {
    id: 'stall.keychain',
    cameraFacing: true,
    footprint: { kind: 'circle', radius: 2.6 },
    boundingRadius: 3.4,
    band: { min: 13, max: 60 },
  },
];
