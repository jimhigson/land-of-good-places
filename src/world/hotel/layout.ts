import {
  CAMERA_PITCH_DEGREES,
  CAMERA_YAW_DEGREES,
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_GARDEN_Z,
  HOTEL_LOBBY_Z,
  HOTEL_OCEAN_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
  PLAYER_RADIUS,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import {
  SPACE_HOTEL_BREAKFAST,
  SPACE_HOTEL_CORRIDOR,
  SPACE_HOTEL_GARDEN,
  SPACE_HOTEL_LOBBY,
  SPACE_HOTEL_OCEAN,
  SPACE_HOTEL_SUITE,
  type SpaceId,
} from '../spaces';
import type { PortalBand } from '../tapSpacing';

/**
 * The Land Hotel's floor plan — rooms as data, in each room's own local
 * metres (origin at the room's centre; +Z is the same world +Z everywhere,
 * so nothing ever rotates between spaces).
 *
 * Eleri's brief (issue #236) mapped onto Jim's ruling that **every room is
 * its own disjoint space**: fifty storeys exist in the fiction — the lift
 * panel, the HUD pill and the tower's window rows all say so — and four
 * rooms exist in the world, which is all a six-year-old ever visits:
 *
 *  - the **lobby** (ground): reception that gives you your key, the giant
 *    RiPika statue with a disco ball above it, and a small café corner;
 *  - the **breakfast room** (Floor 1): the big one — seven tables and a
 *    twelve-metre buffet with somebody serving behind it;
 *  - the **corridor** (floor 50): life-sized statues of the cute pets, and
 *    the door that says "yours";
 *  - **your suite**, behind that door: rainbow walls, its own disco ball,
 *    and three beds to sleep on or go jumpy-jumpy between.
 *
 * **Breakfast is on Floor 1, and Floor 1 is the one above the ground** — the
 * British numbering, which is the numbering the family uses (Jim, 6 August
 * 2026, having played it: *"Breakfast should be on the 1st floor (British: the
 * floor ABOVE ground, not 25)"*). The lobby is therefore storey **0**, and the
 * lift's indicator says "Ground" rather than "Floor 0" while it passes it.
 */

/**
 * A floor's own colours — what makes stepping out of the lift read instantly
 * as *a different floor*.
 *
 * Jim, 6 August 2026: *"each floor gets its own theme, and decorate it
 * accordingly."* Four rooms of pale pink walls and one crystal floor is a
 * hotel where every storey is the same storey, and the lift's whole promise is
 * that it takes you somewhere.
 *
 * Five colours, all from `PALETTE` (ART_DIRECTION §5 — no colour is invented
 * here), and the room shell reads all five: `wall` and `floor` are the plate
 * and the walls, `trim` is the lift alcove you literally step out of, `accent`
 * dresses the soft furnishings and `glow` is what every lamp on that floor
 * burns. Dressing code takes its colours from **here** rather than naming
 * them again, so re-theming a floor is one edit in one place.
 */
export interface HotelTheme {
  readonly wall: number;
  readonly floor: number;
  /** The lift alcove, and anything that frames a way through. */
  readonly trim: number;
  /** Rugs, sofas, planters. */
  readonly accent: number;
  /** Sconces, crystals, lamps. */
  readonly glow: number;
}

/**
 * WCAG relative luminance of a `PALETTE` colour — how bright it reads,
 * 0 (black) to 1 (white), through the standard sRGB linearisation.
 */
export function relativeLuminance(hex: number): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear((hex >> 16) & 255) +
    0.7152 * linear((hex >> 8) & 255) +
    0.0722 * linear(hex & 255)
  );
}

/**
 * The least a theme's wall and floor may differ in {@link relativeLuminance}.
 *
 * Jim, looking at the suite, 8 Aug 2026: *"The walls and floor colours are
 * too similar — hard to distinguish."* Where a wall meets the floor at the
 * iso camera's 38°, luminance separation is what draws the line; hue barely
 * helps when both are pastel.
 *
 * The number is **measured, not invented** — from this hotel's own floors on
 * the day the rule landed. The rooms that read well at a glance: lobby 0.274,
 * corridor 0.251, ocean 0.232, garden 0.186. The rooms that did not: the
 * suite Jim reported at 0.115, and the breakfast room — unreported but
 * measured twelve times worse at 0.009, cream on cream. 0.15 sits beneath
 * the weakest good reader and above both offenders. `check:hotel` probe 20
 * holds every theme to it, so a future floor cannot quietly go
 * wall-coloured.
 */
export const THEME_FLOOR_CONTRAST_MIN = 0.15;

/** A wall of a room. `north` is −Z, `west` is −X — the two the camera sees. */
export type WallSide = 'north' | 'south' | 'east' | 'west';

/**
 * The windows in one wall — **declared here, built by
 * `Hotel.buildRoomShell`**.
 *
 * Jim, having played it: *"a room without windows is not inviting"* and *"the
 * windowless building is weird and claustrophobic"*. The first answer to that
 * was one hand-built glowing band nailed to the breakfast room's north wall,
 * which is exactly the shape of problem this repo keeps filing: a fact about
 * a room, written down somewhere that is not the room, that only one room has
 * and no other room can inherit. It is gone. A room now *says* where its
 * windows are and the builder puts them there, so a new floor gets windows by
 * adding four numbers rather than by remembering to copy a block of geometry.
 *
 * The builder clips every pane to the wall's **own solid spans** — the spans
 * it is already computing to leave the doorways out — so a pane can never end
 * up floating across a doorway however carelessly `at` is written. That is the
 * part that makes this data safe to edit: the doorway is not repeated here,
 * it is respected automatically.
 */
export interface WindowWall {
  /**
   * Pane centres along the wall's own axis: x on the north and south walls,
   * z on the east and west ones.
   */
  readonly at: readonly number[];
  /** Pane width along that same axis. */
  readonly width: number;
  /** Bottom and top of the glass, metres above the floor. */
  readonly sill: number;
  readonly head: number;
  /**
   * The pane the wall's "Look out" zone stands at, when the default choice —
   * the middle-most pane a child can stand in front of, kept a finger clear
   * of every doorway band (`world/tapSpacing.ts`) — would land somewhere the
   * tap-spacing rule forbids for reasons the picker cannot see (the lobby's
   * café tables crowd its northern pane). `check:tap-spacing` measures the
   * chosen pane either way, so this cannot be used to break the rule.
   */
  readonly zoneAt?: number;
  /**
   * `false` when this wall's panes are **light only** — no "Look out" zone
   * may stand at any of them. The suite's west pane lights its bathroom, and
   * a stand spot inside that small privacy-roofed room cannot keep the tap
   * rule's finger of clearance from the room's own tap target (the pan) —
   * measured, not guessed: every candidate pairing came up 0.2–0.9 m short.
   * The suite's "Look out" lives on the north wall instead.
   */
  readonly lookZone?: false;
}

/**
 * One curved flight of the imperial staircase: a quarter-turn arc of treads,
 * swept about `(centreX, centreZ)` from `fromAngle` to `toAngle` (radians,
 * measured the way the rest of this game measures a yaw — 0 is +Z, turning
 * toward −X; a **descending** range is a left-hand flight). The last tread
 * lands level with the landing.
 */
export interface StairArc {
  readonly centreX: number;
  readonly centreZ: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly fromAngle: number;
  readonly toAngle: number;
  readonly treads: number;
}

/**
 * The lobby's raised levels and the imperial staircase between them —
 * **declared here, built by `Hotel.buildMezzanine`**, exactly like
 * {@link WindowWall}.
 *
 * Jim's commission, 8 August 2026, from his reference photograph of a grand
 * resort lobby: two mirrored curved flights sweep up to an intermediate
 * **landing**, a single wide straight flight carries on to the **gallery**
 * (the true mezzanine level), and the arch *under* the landing is the whole
 * subject — you can see, and walk, straight through it along the room's axis.
 *
 * ## Why the landing may overhang now (the law changed)
 *
 * This used to be a solid mass, and the doc here said why: `CollisionWorld`
 * was height-agnostic, so the balustrade holding a child on the deck was the
 * same collider that invisibly walled off the floor beneath it. The imperial
 * composition's entire point is the see-through arch, so the law grew a third
 * answer: a **banded collider** (`Collision.ts`'s `baseHeight`) exists only
 * for movers at or above its own base. The landing's rails carry
 * `height − 0.5` — solid to a child stood on the landing, thin air to the
 * child walking under the arch below, unreachable by a ground jump. The
 * gallery is a **colonnade**: open underneath all the way to the north wall,
 * its deck held up by columns, so the axis genuinely goes through.
 *
 * The plan's numbers are the artist's, frozen here as data; `Hotel.ts`'s
 * `assertStairMatches` compares every one against `art/models/hotelAssets.ts`
 * at build time, so the two cannot drift apart silently (this file must stay
 * a leaf data module and cannot import the asset itself).
 */
export interface Mezzanine {
  /** The gallery deck — the true level — in room-local metres. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Height of the gallery's walking surface (`LOBBY_MEZZANINE_Y`). */
  readonly height: number;
  /**
   * The intermediate landing the curves gather onto. A true overhang: the
   * arch under it is open, walkable floor. `slab` is its visual thickness —
   * bounded by the asset's `LANDING_SLAB_MIN`/`MAX`, because past MAX the
   * arch stops clearing a hatted child and Jim's ruling is silently undone.
   */
  readonly landing: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly height: number;
    readonly slab: number;
  };
  /** The two mirrored curved flights, floor → landing. */
  readonly stairs: readonly StairArc[];
  /**
   * The wide straight flight, landing → gallery. Centred on `centreX`, its
   * bottom riser at `frontZ`, climbing toward −Z; it lands exactly on the
   * gallery's `minZ`-side edge at `height`. `flankX` is where its solid
   * flanks stand either side of the walk.
   */
  readonly straight: {
    readonly centreX: number;
    readonly frontZ: number;
    readonly walkWidth: number;
    readonly flankX: number;
    readonly treads: number;
    readonly rise: number;
  };
}

/**
 * How far past a stair's first and last tread its walk path stands, metres.
 *
 * Far enough that the endpoint clears the stair's own flank colliders once
 * they are fattened by the walker's radius (the flanks end 0.9 m either side
 * of the arc's centreline; `hypot(1.2, 0.9) = 1.5 m` beats the 0.84 m
 * fattened reach), close enough that "walk to the mouth, then up" reads as
 * one movement rather than a detour.
 */
export const CONNECTOR_APPROACH = 1.2;

/**
 * How far below its deck's walking surface a banded balustrade collider's
 * base sits (`Collision.ts`'s `baseHeight`).
 *
 * Deep enough that a walker whose damped `y` briefly dips below the deck
 * plane — stepping off a flight's last tread, landing from a bounce — is
 * still held by the rail; far above anything a ground jump reaches
 * (`JUMP_APEX_HEIGHT` is 1.28 m, and the lowest banded base in the lobby is
 * 3.34 m). A walker between those two heights does not exist in this game:
 * the levels are 0, 3.84 and 5.44, and nothing walkable sits between.
 *
 * Here rather than in `Hotel.ts` because the edge schedule below is the one
 * owner of which edges are guarded, and `check:hotel` reads that schedule.
 */
export const RAIL_BASE_DROP = 0.5;

/**
 * The direction from any point in the world **towards the camera**.
 *
 * A single vector works because the camera is orthographic: it looks along
 * one fixed direction from everywhere, so "can the camera see this point" is
 * one ray, not a per-position calculation. Derived from the rig's own numbers
 * rather than transcribed — a hardcoded triple would go quietly stale the
 * first time anyone touched `CAMERA_PITCH_DEGREES`.
 */
/**
 * How far above a deck's walking surface its rails and furniture stand.
 *
 * Measured off the built room rather than guessed: the tallest thing on the
 * landing is a balustrade baluster whose box tops out at 4.65 m over a 3.84 m
 * deck, so 1.1 m clears it with a little room for the sofas and planters on
 * the gallery.
 */
const DECK_CLUTTER_HEIGHT = 1.1;

const TO_CAMERA = ((): { x: number; y: number; z: number } => {
  const yaw = (CAMERA_YAW_DEGREES * Math.PI) / 180;
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const horizontal = Math.cos(pitch);
  const x = Math.sin(yaw) * horizontal;
  const z = Math.cos(yaw) * horizontal;
  const y = Math.sin(pitch);
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
})();

/**
 * Does the mezzanine stand between this point and the camera?
 *
 * Room-local metres. This is what decides whether the overhang ghosts itself
 * so a child can see where she is: under the arch and under the whole
 * colonnade she was drawn *behind* 4.8 m of gallery deck, and QA found only
 * her pet's head and a sliver of hat showing across roughly the northern
 * 10 m of a 24.8 m room. A theme park you cannot see yourself in is not a
 * theme park a six-year-old can play.
 *
 * Exact rather than approximate, because the camera is orthographic and the
 * decks are axis-aligned rectangles: march from the point along
 * {@link TO_CAMERA} to each deck's walking surface and ask whether it lands
 * inside that deck. `check:hotel` proves this against the *built meshes* with
 * a real raycast rather than against this arithmetic, so the two cannot agree
 * with each other while both being wrong.
 */
export function mezzanineHidesPoint(
  plan: Mezzanine,
  localX: number,
  localY: number,
  localZ: number,
): boolean {
  // Each deck is a **box**, not a plane, and it is taller than its slab.
  // Both of those were learned by raycasting the built room: a ray from the
  // colonnade meets the gallery slab on its *underside* at 5.04 m, 0.4 m
  // below the walking surface, and a ray from beside the landing meets a
  // balustrade baluster standing at 4.65 m — a metre above the landing it
  // guards. Marching to the walking surface alone missed 59 of 1,487
  // standable spots that the real geometry hides.
  const decks = [
    {
      minX: plan.minX,
      maxX: plan.maxX,
      minZ: plan.minZ,
      maxZ: plan.maxZ,
      minY: plan.height - plan.landing.slab,
      maxY: plan.height + DECK_CLUTTER_HEIGHT,
    },
    {
      minX: plan.landing.minX,
      maxX: plan.landing.maxX,
      minZ: plan.landing.minZ,
      maxZ: plan.landing.maxZ,
      minY: plan.landing.height - plan.landing.slab,
      maxY: plan.landing.height + DECK_CLUTTER_HEIGHT,
    },
  ];
  for (const deck of decks) {
    // Standing on it (or above it) is never standing under it.
    if (deck.minY <= localY + 0.05) continue;
    let near = 0;
    let far = Number.POSITIVE_INFINITY;
    const axes: readonly [number, number, number, number][] = [
      [localX, TO_CAMERA.x, deck.minX, deck.maxX],
      [localY, TO_CAMERA.y, deck.minY, deck.maxY],
      [localZ, TO_CAMERA.z, deck.minZ, deck.maxZ],
    ];
    let missed = false;
    for (const [origin, direction, low, high] of axes) {
      if (Math.abs(direction) < 1e-9) {
        if (origin < low || origin > high) missed = true;
        continue;
      }
      const t1 = (low - origin) / direction;
      const t2 = (high - origin) / direction;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
    }
    if (!missed && far >= near) return true;
  }
  return false;
}

/**
 * One stretch of deck edge that a walker must not be able to step off.
 *
 * `outwardX`/`outwardZ` is the unit normal pointing **off** the deck — the
 * way a child walks when she walks over the edge — so a probe can push a
 * body that way and watch whether anything stops her.
 */
export interface DeckEdge {
  readonly what: string;
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  /** The level a walker on this deck stands at. */
  readonly deckHeight: number;
  /** `baseHeight` for the collider that guards it. */
  readonly base: number;
  readonly outwardX: number;
  readonly outwardZ: number;
}

/**
 * Every edge of the mezzanine's two decks that is a **drop**, already split
 * around the openings the stairs need, derived from the plan alone.
 *
 * **One owner, because the alternative shipped a hole.** The rails used to be
 * five hand-written `addWall` calls in `Hotel.ts` and three hand-picked spot
 * checks in `check:hotel`, and the landing's *north* edge appeared in neither:
 * the gallery's front balustrade is drawn along that very line, but banded to
 * the gallery's own 4.94 m, so a child standing on the landing at 3.84 m
 * walked straight through the rail she could see and fell 3.84 m to the lobby
 * floor. The check was green throughout, because nothing had ever told it that
 * edge existed. Now the builder and the probe enumerate the same list, and an
 * edge that is not guarded is a red test rather than a silent hole.
 *
 * `railRadius` is `STAIR_RAIL_RADIUS`, passed in rather than imported so this
 * stays a leaf data module (see the file header).
 */
export function mezzanineGuardedEdges(plan: Mezzanine, railRadius: number): DeckEdge[] {
  const { landing, straight } = plan;
  const landingBase = landing.height - RAIL_BASE_DROP;
  const deckBase = plan.height - RAIL_BASE_DROP;
  const edges: DeckEdge[] = [];

  // The straight flight's mouth, which both the gallery's front edge and the
  // landing's north edge open onto. Same gap in both, from the same number.
  const mouthMin = straight.centreX - straight.flankX;
  const mouthMax = straight.centreX + straight.flankX;

  // The gallery's front (south) edge, minus that mouth. Below it is open
  // floor — the colonnade — so this is a genuine drop the whole way.
  edges.push({
    what: "the gallery's front balustrade, west of the flight",
    x1: plan.minX,
    z1: plan.maxZ,
    x2: mouthMin,
    z2: plan.maxZ,
    deckHeight: plan.height,
    base: deckBase,
    outwardX: 0,
    outwardZ: 1,
  });
  edges.push({
    what: "the gallery's front balustrade, east of the flight",
    x1: mouthMax,
    z1: plan.maxZ,
    x2: plan.maxX,
    z2: plan.maxZ,
    deckHeight: plan.height,
    base: deckBase,
    outwardX: 0,
    outwardZ: 1,
  });

  // **The landing's north edge** — the one that was missing. It lies on the
  // same line as the gallery's front edge, but what stands on it is a landing
  // walker at 3.84 m, so it needs its own, lower band.
  edges.push({
    what: "the landing's north balustrade, west of the flight",
    x1: landing.minX,
    z1: landing.minZ,
    x2: mouthMin,
    z2: landing.minZ,
    deckHeight: landing.height,
    base: landingBase,
    outwardX: 0,
    outwardZ: -1,
  });
  edges.push({
    what: "the landing's north balustrade, east of the flight",
    x1: mouthMax,
    z1: landing.minZ,
    x2: landing.maxX,
    z2: landing.minZ,
    deckHeight: landing.height,
    base: landingBase,
    outwardX: 0,
    outwardZ: -1,
  });

  // The landing's front (south) edge, between the two curves' top newels —
  // the gaps either side of it are where the curves arrive.
  const frontHalf = Math.abs(plan.stairs[0]?.centreX ?? 0) - railRadius;
  edges.push({
    what: "the landing's front balustrade",
    x1: -frontHalf,
    z1: landing.maxZ,
    x2: frontHalf,
    z2: landing.maxZ,
    deckHeight: landing.height,
    base: landingBase,
    outwardX: 0,
    outwardZ: 1,
  });

  // The landing's sides.
  edges.push({
    what: "the landing's west balustrade",
    x1: landing.minX,
    z1: landing.minZ,
    x2: landing.minX,
    z2: landing.maxZ,
    deckHeight: landing.height,
    base: landingBase,
    outwardX: -1,
    outwardZ: 0,
  });
  edges.push({
    what: "the landing's east balustrade",
    x1: landing.maxX,
    z1: landing.minZ,
    x2: landing.maxX,
    z2: landing.maxZ,
    deckHeight: landing.height,
    base: landingBase,
    outwardX: 1,
    outwardZ: 0,
  });

  return edges;
}

/** A point on a connector's walk path, room-local metres. */
export interface LocalConnectorPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The walk paths between the lobby's three levels — **declared here,
 * registered by `Hotel.buildMezzanine`**, consumed by `NavGrid` as graph
 * edges (ARCHITECTURE-DECISIONS.md Decision 11).
 *
 * Three paths, one per flight, each derived from the plan that builds the
 * flight's treads: both curves (floor ↔ landing) and the straight flight
 * (landing ↔ gallery). Each is just an edge to the router, so
 * floor → landing → gallery multi-hops with no further declaration — the
 * exact property Decision 11 named this composition as the test of. Move a
 * flight and its path moves with it; there is no coordinate here to go stale.
 *
 * The climb direction along an arc at angle `a` is `(−cos a, −sin a)` for an
 * **ascending** sweep and its negation for a descending one — the left-hand
 * flight climbs through decreasing angles (the same fact that makes
 * hand-subdivided tread ranges silently fail `covers()`, per the asset's
 * `treadArc` warning). The first cut of this function assumed ascending and
 * put the left flight's floor approach on the wrong side of its foot —
 * *inside* the flight's own mass — so the sign is taken from the sweep, once,
 * here.
 */
export function mezzanineWalkConnectors(
  plan: Mezzanine,
): readonly (readonly LocalConnectorPoint[])[] {
  const paths: LocalConnectorPoint[][] = [];

  for (const stair of plan.stairs) {
    const midRadius = (stair.innerRadius + stair.outerRadius) / 2;
    const riser = plan.landing.height / stair.treads;
    const sweep = stair.toAngle - stair.fromAngle;
    const sign = Math.sign(sweep);
    const at = (angle: number): { x: number; z: number } => ({
      x: stair.centreX - Math.sin(angle) * midRadius,
      z: stair.centreZ + Math.cos(angle) * midRadius,
    });

    const points: LocalConnectorPoint[] = [];
    // One stride out from the bottom tread, on the floor — backwards along
    // the climb direction, whichever hand the flight is.
    const bottom = at(stair.fromAngle);
    points.push({
      x: bottom.x + Math.cos(stair.fromAngle) * CONNECTOR_APPROACH * sign,
      y: 0,
      z: bottom.z + Math.sin(stair.fromAngle) * CONNECTOR_APPROACH * sign,
    });
    for (let i = 0; i < stair.treads; i += 1) {
      const centre = at(stair.fromAngle + (sweep * (i + 0.5)) / stair.treads);
      points.push({ x: centre.x, y: riser * (i + 1), z: centre.z });
    }
    // One stride past the top tread, on the landing.
    const top = at(stair.toAngle);
    points.push({
      x: top.x - Math.cos(stair.toAngle) * CONNECTOR_APPROACH * sign,
      y: plan.landing.height,
      z: top.z - Math.sin(stair.toAngle) * CONNECTOR_APPROACH * sign,
    });
    paths.push(points);
  }

  // The straight flight: landing → gallery, climbing toward −Z.
  {
    const { straight, landing } = plan;
    // It lands on the gallery's near (maxZ) edge, so that is what the run is.
    const run = straight.frontZ - plan.maxZ;
    const going = run / straight.treads;
    const riser = straight.rise / straight.treads;
    const points: LocalConnectorPoint[] = [];
    points.push({
      x: straight.centreX,
      y: landing.height,
      z: straight.frontZ + CONNECTOR_APPROACH,
    });
    for (let i = 0; i < straight.treads; i += 1) {
      points.push({
        x: straight.centreX,
        y: landing.height + riser * (i + 1),
        z: straight.frontZ - going * (i + 0.5),
      });
    }
    points.push({
      x: straight.centreX,
      y: plan.height,
      z: straight.frontZ - run - CONNECTOR_APPROACH,
    });
    paths.push(points);
  }

  return paths;
}

export interface HotelRoom {
  readonly space: SpaceId;
  /** This floor's colours. See {@link HotelTheme}. */
  readonly theme: HotelTheme;
  readonly originX: number;
  readonly originZ: number;
  /** Half-extent of the floor plate, local metres. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Wall height. Rooms are open-topped — the iso camera looks in. */
  readonly wallHeight: number;
  /**
   * Height of the **south and east** walls, when they should be lower than the
   * rest. Defaults to {@link wallHeight}.
   *
   * The camera sits at focus + (+X, +Y, +Z) at a fixed 38° pitch, so those two
   * walls are the ones *between it and the room*: a wall of height H hides the
   * floor for 1.28·H metres behind it. At the 3.0–3.4 m every room used to be
   * that is a 4 m shadow you never notice, because you are rarely that close to
   * a near wall. The lobby is 8.9 m tall now (the imperial composition stands
   * 5.44 m to its gallery), and 8.9 m of near wall would hide eleven metres —
   * which is a child standing in her own hotel and seeing a wall.
   *
   * So the two walls the camera looks *through* stay low and the two it looks
   * *at* go up. That is not a fudge: it is the same rule `windows` and
   * `hangOnWalls` already obey, written down once more for the one dimension
   * that had been assuming every wall was the same.
   */
  readonly nearWallHeight?: number;
  /** Gaps in the walls, per side, as [from, to] along that wall's axis. */
  readonly gaps: Partial<Record<WallSide, readonly [number, number]>>;
  /**
   * Where the daylight comes in. See {@link WindowWall}.
   *
   * The camera sits at focus + (+X, +Y, +Z), so it looks at the inside faces
   * of the **north and west** walls and at the *outside* of the other two —
   * a window on the south or east wall is a window nobody will ever look
   * through. Every room therefore declares north, west, or both, and where
   * one of those two is missing the room's own entry below says why.
   */
  readonly windows: Partial<Record<WallSide, WindowWall>>;
  /** An upper level, if this room has one. See {@link Mezzanine}. */
  readonly mezzanine?: Mezzanine;
  /** Internal walls dividing this room up. See {@link SuitePartition}. */
  readonly partitions?: readonly SuitePartition[];
  /** The lift alcove's centre on the west wall, local Z. */
  readonly liftZ: number | null;
  /** Which lift floor this room answers to (index into HOTEL_FLOORS). */
  readonly liftFloor: number | null;
  /** What the HUD's floor pill says here. */
  readonly floorLabel: string;
}

/** Half-width of every door gap. */
export const DOOR_HALF = 1.3;

/** Half-thickness of a room's outer walls. `Hotel.buildRoomShell` builds the
 *  boxes from it; {@link clearFloorAround} keeps the rugs off them. */
export const WALL_HALF_DEPTH = 0.25;

/** Half-thickness of an internal partition (`Hotel.partitionRoom`). */
export const SUITE_PARTITION_HALF = 0.2;

/** A rectangle of a room's floor, local metres. */
export interface ClearRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The clear floor around a point — the rectangle bounded by the nearest wall
 * *faces*: the outer walls, and every partition run whose line crosses the
 * point's own row or column.
 *
 * This exists so a rug's extents can be **derived** rather than hand-sized.
 * Jim, looking at the suite bedroom: *"The rainbow rug goes under the walls"*
 * — the hall's rug was a number typed next to a partition plan that did not
 * know about it, and the day the plan moved, nothing owned the disagreement.
 * Dressing code now asks this function for the floor it may cover, so a rug
 * *cannot* reach a wall and a partition move re-fits the rugs by itself
 * (`check:hotel` probe 19 measures the built scene either way).
 *
 * A doorway does not widen the answer: the run's whole `from`–`to` line
 * bounds it, because a rug poking through a doorway into the next room is
 * the same bug wearing a smaller hat.
 */
export function clearFloorAround(room: HotelRoom, x: number, z: number): ClearRect {
  let minX = -room.halfX + WALL_HALF_DEPTH;
  let maxX = room.halfX - WALL_HALF_DEPTH;
  let minZ = -room.halfZ + WALL_HALF_DEPTH;
  let maxZ = room.halfZ - WALL_HALF_DEPTH;
  for (const run of room.partitions ?? []) {
    if (run.along === 'x') {
      if (x < run.from || x > run.to) continue;
      if (run.at >= z) maxZ = Math.min(maxZ, run.at - SUITE_PARTITION_HALF);
      else minZ = Math.max(minZ, run.at + SUITE_PARTITION_HALF);
    } else {
      if (z < run.from || z > run.to) continue;
      if (run.at >= x) maxX = Math.min(maxX, run.at - SUITE_PARTITION_HALF);
      else minX = Math.max(minX, run.at + SUITE_PARTITION_HALF);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * A doorway's clearance zone, in the room's own local metres — an
 * axis-aligned rectangle a piece of furniture must never overlap. The same
 * shape as {@link ClearRect}; kept as its own name so a reader sees at the
 * call site that this rectangle is about a *doorway*, not a wall.
 */
export type DoorwayZone = ClearRect;

/**
 * How far past `clearance` a doorway's zone reaches **into the room**, on top
 * of the thin band hugging the wall itself.
 *
 * Jim, 18 Aug 2026, on `/hotel-suite`: *"is this a joke? … dumb furniture
 * clearly still in the way … non-functional by any degree."* The lounge
 * sofa's placement comment claimed a clean 0.28 m margin from the doorway —
 * true, but only of a zone that reached exactly `clearance` (0.62 m) past the
 * wall plane. A sofa is 2.6 m deep; parking its *front* edge 0.28 m past that
 * thin band still put its bulk squarely across most of the doorway's own
 * width, because nothing had ever asked "is there room to take a stride once
 * you're actually through" — only "is the wall's own opening clear". A
 * player-sized probe marched straight through the built doorway (the ground
 * truth this file's header insists on) got stuck 0.42 m short of the far
 * side, at the sofa's own edge — `scripts/check-hotel.mts`'s
 * doorway-crossing probe (`marchCrossing`, over every `doorwayCrossings`)
 * reproduces exactly that march on every doorway in the hotel now.
 *
 * One more player-width, so a body that has just cleared the wall can still
 * take a full stride before meeting anything solid, not just half of one.
 */
export const DOORWAY_THROUGH_DEPTH = PLAYER_RADIUS;

/**
 * Every doorway a body can walk through in this room — an outer wall's gap
 * or a partition's own door — widened by `clearance` **along** the wall (so a
 * body doesn't graze the jamb) and by `clearance + `{@link
 * DOORWAY_THROUGH_DEPTH} **through** it, into the room on both sides (so a
 * body has a real stride of clear floor once it's past the wall, not just
 * the width of the opening itself — see that constant's header).
 *
 * **Derived straight from {@link HotelRoom.gaps} and {@link
 * HotelRoom.partitions}, never re-typed.** Those two fields are already this
 * room's one description of where its walls have holes in them; a wall or a
 * partition that moves takes its doorway's clearance zone with it for free,
 * with nothing here that could go stale the way a hand-copied doorway list
 * would. `world/hotel/place.ts`'s `isClearOfDoorways` checks every solid
 * prop's footprint against this list as it goes down, so furniture that
 * would leave a doorway too narrow — or too shallow — to use is a thrown
 * error at hotel construction rather than a bug a child finds by walking
 * into a sofa (issue #273 — CLAUDE.md's "anything that looks solid must be
 * solid", aimed at the door instead of the wall).
 *
 * This is deliberately a **superset** of {@link hotelDoorBands}: that list
 * exists for the walk-through trigger and the tap-spacing rule, and leaves
 * out the suite's bedroom-to-hall doorways on purpose (banding them there
 * trips the bed zones by 0.03 m — a change for its own PR). A sofa does not
 * care about tap targets; it cares whether a body can get through the gap
 * *and keep walking*, so every gap counts here.
 */
export function doorwayClearanceZones(room: HotelRoom, clearance: number): DoorwayZone[] {
  const zones: DoorwayZone[] = [];
  const reach = clearance + DOORWAY_THROUGH_DEPTH;

  for (const side of ['north', 'south', 'east', 'west'] as const) {
    const gap = room.gaps[side];
    if (!gap) continue;
    const [from, to] = gap;
    if (side === 'north' || side === 'south') {
      const wallZ = side === 'north' ? -room.halfZ : room.halfZ;
      zones.push({
        minX: from - clearance,
        maxX: to + clearance,
        minZ: wallZ - reach,
        maxZ: wallZ + reach,
      });
    } else {
      const wallX = side === 'west' ? -room.halfX : room.halfX;
      zones.push({
        minX: wallX - reach,
        maxX: wallX + reach,
        minZ: from - clearance,
        maxZ: to + clearance,
      });
    }
  }

  for (const run of room.partitions ?? []) {
    const doorHalf = SUITE_DOOR_WIDTH / 2;
    for (const at of run.doors) {
      if (run.along === 'x') {
        zones.push({
          minX: at - doorHalf - clearance,
          maxX: at + doorHalf + clearance,
          minZ: run.at - reach,
          maxZ: run.at + reach,
        });
      } else {
        zones.push({
          minX: run.at - reach,
          maxX: run.at + reach,
          minZ: at - doorHalf - clearance,
          maxZ: at + doorHalf + clearance,
        });
      }
    }
  }

  return zones;
}

/** How far the lift alcove pokes out of the west wall. */
export const LIFT_ALCOVE_DEPTH = 3.4;

/** Where the boarding pose is, out from the west wall. */
export const LIFT_CAR_X = -1.9;

/** **Ground — a grand crystal welcome.** Lilac walls, glass floor, gold lamps. */
const LOBBY_THEME: HotelTheme = {
  wall: PALETTE.flowerViolet,
  floor: PALETTE.glassTint,
  trim: PALETTE.markerLilac,
  accent: PALETTE.markerLilac,
  glow: PALETTE.liftFrame,
};

/**
 * **Floor 1 — a sunny morning.** Cream walls over a golden-toast floor,
 * honey-gold trim: the colours of toast and butter, which is the entire
 * point of the only room in the hotel you go to in order to eat.
 *
 * The floor was `buildingWall` — cream on cream, measured at 0.009
 * luminance apart from the walls, the worst reader in the hotel (see
 * {@link THEME_FLOOR_CONTRAST_MIN}) — nobody had reported it only because
 * seven tables and a buffet were doing the walls' job of drawing the room's
 * edges. `pathSandDark` keeps the toast and gives the floor its own value
 * (0.31 apart).
 */
const BREAKFAST_THEME: HotelTheme = {
  wall: PALETTE.signBoard,
  floor: PALETTE.pathSandDark,
  trim: PALETTE.liftFrame,
  accent: PALETTE.flowerYellow,
  glow: PALETTE.markerLemon,
};

/**
 * **Floor 50 — up among the clouds.** Sky-blue walls over a deeper sky floor,
 * because fifty storeys up is the one floor whose *number* is the interesting
 * thing about it. Stars and clouds do the rest (`dressCorridor`).
 */
const CORRIDOR_THEME: HotelTheme = {
  wall: PALETTE.skyDayBottom,
  floor: PALETTE.markerSky,
  trim: PALETTE.buildingRoofDeep,
  accent: PALETTE.flowerBlue,
  glow: PALETTE.flowerYellow,
};

/**
 * **Yours — the rainbow room.** Eleri's own spec, and the only theme here she
 * asked for by name: *"the room is rainbow coloured, only for the top room"*.
 * The walls stay near-white on purpose — the rainbow is the stripes, the rug
 * and the blankets, and a rainbow on a coloured wall is a rainbow you cannot
 * see.
 *
 * So when Jim found the room hard to read — *"the walls and floor colours
 * are too similar"* — the **floor** is what moved: `stonePinkLight` was
 * 0.115 of luminance from the white walls, `stonePink` is 0.27, the same
 * separation the lobby reads with, and still unmistakably the pink room.
 * See {@link THEME_FLOOR_CONTRAST_MIN}.
 */
const SUITE_THEME: HotelTheme = {
  wall: PALETTE.blossomWhite,
  floor: PALETTE.stonePink,
  trim: PALETTE.markerPink,
  accent: PALETTE.markerPink,
  glow: PALETTE.markerPink,
};

/**
 * **Floor 12 — the garden floor.** Pale meadow-green walls over a mossy
 * blue-green floor, deep-leaf trim, blossom-pink furnishings and sunny lamps:
 * an indoor meadow with planters, trellises and butterflies, twelve storeys
 * up.
 *
 * Jim, 7 August 2026: *"you should be able to go to certain other floors with
 * their own schemes."* The test a scheme has to pass is the one the lift makes
 * a promise about — step out and know instantly that this is **not** the floor
 * you were on — and a floor of grass under a floor of toast passes it before
 * you have looked at a single prop.
 */
const GARDEN_THEME: HotelTheme = {
  wall: PALETTE.grassLight,
  floor: PALETTE.leafBlue,
  trim: PALETTE.leafDeep,
  accent: PALETTE.blossomPink,
  glow: PALETTE.flowerYellow,
};

/**
 * **Floor 33 — the ocean floor.** Bright water-blue walls over the deep, with
 * foam-white trim, mint furnishings and a pale glow like light coming down
 * through the surface. Fish, seaweed and portholes do the rest
 * (`dressOcean`).
 *
 * Thirty-three, and not a rounder number, on purpose: it sits between Floor 12
 * and Floor 50 so the lift's indicator has a proper long count to do in both
 * directions, which is most of what makes a fifty-storey hotel feel tall.
 */
const OCEAN_THEME: HotelTheme = {
  wall: PALETTE.waterTop,
  floor: PALETTE.waterDeep,
  trim: PALETTE.waterFoam,
  accent: PALETTE.markerMint,
  glow: PALETTE.bubbleSkin,
};

/**
 * The gallery deck — the composition's **true level** — and the intermediate
 * landing under it, in metres above the lobby floor.
 *
 * These stopped being this file's choice on 8 August 2026 (the artist's
 * handoff calls it "the arrow turned round"): the landing is now derived from
 * how tall a child in a party hat is (`hotelAssets.ts`'s `ARCH_CLEAR`, twelve
 * 0.32 m risers → 3.84) and the gallery is wherever the five-tread straight
 * flight lands (another 1.60 → 5.44). They are written here as data because
 * this file must stay a leaf module; `Hotel.assertStairMatches` proves them
 * against the asset's own exports at build time.
 */
export const LOBBY_MEZZANINE_Y = 5.44;
export const LOBBY_LANDING_Y = 3.84;

/**
 * How thick the landing's slab is drawn: 0.40, the artist's recommended
 * build, leaving the arch 3.44 m clear — 0.07 m over `ARCH_CLEAR` and 7 cm
 * inside `LANDING_SLAB_MAX`, past which the arch stops clearing a hatted
 * child and Jim's ruling is undone by a thickness nobody thought was
 * load-bearing. `assertStairMatches` holds it inside the asset's range.
 */
export const LOBBY_LANDING_SLAB = 0.4;

/**
 * The arc centres stand at `(±STAIR_ARC_C, STAIR_ARC_Z)`: the artist's
 * `C = STAIR_RAIL_RADIUS + n·BRIDGE_RAIL_TILE/2` at n = 6, so the landing's
 * front balustrade between the two curves' top newels is exactly six whole
 * tiles (6.12 m), the clear archway between the flights' masses is 5.85 m,
 * and the whole composition spans 16.21 m — all measured off the placed
 * meshes in the artist's handoff.
 */
export const STAIR_ARC_C = 7.99;

/**
 * How much deeper the entrance foyer grew, 17 August 2026 — the fix to a
 * fix. Issue #271's own repair removed the lobby's two wall paintings
 * outright, because every candidate spot on both walls was spoken for:
 * north by the mezzanine's shadow (unfixable — {@link LOBBY.mezzanine}
 * reaches the whole width of that wall), west by the lift's own
 * tap-spacing exclusion (`|z − liftZ| ≥ 5.73`, from `LIFT_ALCOVE_DEPTH`'s
 * boarding band — `liftZ` was still 0 at the time) squeezed against the
 * crystal column, the seating group and the café already there. Jim's call:
 * don't drop the paintings, make room for them.
 *
 * **Both halves of the room move; only the foyer's own furniture does.**
 * `LOBBY.halfZ` grows by this constant and {@link HOTEL_LOBBY_Z}
 * (`core/constants.ts`) moves by it too — `originZ − halfZ` is the north
 * wall's world position, and adding the same number to both terms leaves
 * that subtraction, so the wall the room is *built* with (`Hotel.ts`'s
 * `buildRoomShell`, which places both outer walls at `±room.halfZ` — a
 * formula, not a literal) does not move in the world at all. `originZ +
 * halfZ` (the south wall, the front door) moves by **twice** this constant,
 * because both terms grew by it.
 *
 * **The mezzanine is not a formula, though — it is `LOBBY.mezzanine`'s own
 * set of literals, `minZ: −12.4` and everything derived from it, and
 * nothing makes a literal follow a wall that moved out from under it.**
 * The first cut of this fix left them alone, on the theory that "the north
 * wall doesn't move" meant "the hall doesn't move" — and shipped a 7 m gap
 * of genuinely walkable, genuinely mezzanine-shadowed floor between the
 * built wall and the built mezzanine, standable and *silently unfaded*:
 * `check:hotel`'s own probe 25 casts a ray at the **built meshes**, not this
 * arithmetic, and found six spots hidden with nothing fading them, exactly
 * because the overhang group's real geometry sat 7 m south of where the
 * fade's own box-model (`mezzanineHidesPoint`, reading `LOBBY.mezzanine`
 * unchanged) still thought it was. So `LOBBY.mezzanine` and every other
 * hall fixture keyed to the north wall (the lift, the foyer/hall partition,
 * the chandelier, the north runner, the west sconce that lit the old arch,
 * the hall-side crystal column and clusters) carry `− LOBBY_FOYER_GROWTH`
 * of their own, the same distance the wall moved, so the hall is
 * *translated*, not left behind: everything that answers to `check:nav-routes`
 * — the doorway off the statue's footprint, the stairs' own paired connector
 * clearances — moves as one rigid piece, and that suite is what re-proves
 * it still holds together at the new position.
 *
 * Every **foyer** fixture (south of the partition: the statue, the seating,
 * the café, the south crystal column, reception, the runner, the door) has
 * its own *local* z increased by this same constant — which, added to the
 * origin's own equal shift, lands it at twice this constant further from
 * the lift, matching how far the door moved. The whole room translates in
 * two rigid pieces meeting at the (also-moved) partition, rather than being
 * redesigned — the same pattern `SUITE.halfX`'s bedroom-widening PR used for
 * its own untouched bedrooms. The two returning paintings are new, not
 * translated: they hang in the gap this growth actually opens, between the
 * lift's exclusion line and the relocated seating group.
 */
export const LOBBY_FOYER_GROWTH = 7;

/**
 * Depth of the new reception room the front door now opens directly into,
 * south of {@link LOBBY_HALFZ_BEFORE_RECEPTION} (defined further down, once
 * the room's other geometry is in scope — this constant only needs its own
 * value).
 *
 * Jim explicitly authorized growing the floor's footprint rather than
 * cramming ("Growing the floor's overall footprint to fit is explicitly
 * authorized... don't cram"). 12 m gives real walking room: `RECEPTION_X/Z`
 * (`Hotel.ts`) put the desk dead centre, 6 m from both the new partition's
 * doorway and the front door — comfortably past `DOORWAY_THROUGH_DEPTH` +
 * `DOORWAY_CLEARANCE` (1.24 m) on both sides (`doorwayClearanceZones`,
 * `place.ts`), so the desk's own footprint (halfZ 0.45) can never be
 * flagged as blocking either doorway.
 *
 * **Not 9, which `check:hotel`'s own generic walk-through probe caught
 * live**: it starts every "back out to the park" walk 4 m inside whatever
 * the front door currently is (`scripts/check-hotel.mts`'s `portals`), and
 * at depth 9 that fixed 4 m offset landed her almost exactly on the desk's
 * own south edge (0.05 m clear against a 0.62 m player radius) — she spawned
 * embedded in the reception desk and the doorway-crossing walk failed on
 * every phase and stride. 12 m puts that same test point comfortably clear
 * of the desk (over 1.5 m) regardless of which side of the room a future
 * change nudges the desk toward.
 */
export const RECEPTION_ROOM_DEPTH = 12;

/**
 * How far the room's own local-coordinate origin moves south to make room
 * for {@link RECEPTION_ROOM_DEPTH} of new floor **without moving the north
 * wall** — half the new depth, the same halving `LOBBY_FOYER_GROWTH`'s own
 * doc explains (shift the origin and the half-extent by the same amount and
 * the north wall, `originZ − halfZ`, doesn't move at all; the south wall,
 * `originZ + halfZ`, moves by twice the shift).
 *
 * **Every existing local-z coordinate in `LOBBY` needs this subtracted** —
 * hall-side, foyer-side, and the handful with no `LOBBY_FOYER_GROWTH` term
 * at all (the two returning `#271` paintings) alike — to stay at the exact
 * world position it already had, because *all* of that content is now
 * "north of the new reception partition" from this shift's point of view,
 * unlike `LOBBY_FOYER_GROWTH` itself (which deliberately moves the foyer
 * one way and the hall the other).
 *
 * **Found live, not guessed**: the first cut of this fix grew `halfZ`
 * alone, moving the south wall out by `RECEPTION_ROOM_DEPTH` as intended
 * but also dragging the *north* wall out by the same amount, since
 * `buildRoomShell` builds both outer walls at `±room.halfZ` — a formula,
 * exactly the trap `LOBBY_FOYER_GROWTH`'s own doc already names ("the
 * mezzanine is not a formula... nothing makes a literal follow a wall that
 * moved out from under it"). That shipped two real bugs, both caught by
 * `check:hotel` without a browser: (1) 6 of several thousand standable
 * spots in the new gap between the mezzanine's own fixed box and the
 * (moved) wall were hidden from the camera by a `dressMezzanine` wall
 * sconce with nothing fading them — the exact `#271` failure mode, on a
 * *different* fixture; (2) that sconce, and the seating nook, and the
 * gallery planters — every hand-placed hall fixture that is a *literal*,
 * not derived from `plan` — were left standing exactly where they always
 * were, now floating in open air nowhere near the wall they used to be
 * flush against. This constant, subtracted everywhere alongside
 * {@link LOBBY_FOYER_GROWTH}, keeps every one of those fixtures — and the
 * room's own outer geometry — moving together as what
 * {@link LOBBY_FOYER_GROWTH}'s own doc calls "one rigid piece," the same
 * discipline applied a second time.
 */
export const RECEPTION_ORIGIN_SHIFT = RECEPTION_ROOM_DEPTH / 2;

const STAIR_ARC_Z = -2.5 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT;

/**
 * Splits the lobby into the two rooms issue #270 asked for: the **entrance
 * foyer** south of this line — the front door, reception, the RiPika statue
 * and the café corner, exactly Eleri's own list at the top of this file — and
 * the **stairs and lifts hall** north of it, where the imperial staircase, the
 * mezzanine and the lift alcove stand.
 *
 * Jim, 17 August 2026: *"the reception desk is too far from where the player
 * enters. Rework the layout so the player enters directly into the lobby, then
 * proceeds onward to a separate room containing the stairs and lifts."* The
 * desk used to stand at local z −5.2, 17.6 m from the door and beside the
 * staircase — QA's own *"suggests getting a key near the staircase"* bug from
 * 7 August, reopened by the same layout. Reception now stands south of this
 * line, a few strides from the door; nothing north of it is reachable without
 * first passing through it.
 *
 * **Still one `SPACE_HOTEL_LOBBY`.** The suite already turns one space into
 * four rooms this exact way — an ordinary internal wall
 * ({@link SuitePartition}) with a doorway in it — so a fifth room reuses that
 * mechanism rather than inventing new space plumbing (NavGrid, save flags,
 * portals) for what is, underneath, still a floor a child never leaves.
 *
 * See {@link LOBBY_HALL_DOOR_X} for exactly where the doorway sits along
 * this line — it moved off the promenade axis and then back onto it as the
 * room's own geometry changed underneath it.
 *
 * **Carries `− LOBBY_FOYER_GROWTH`**, same as every other hall fixture keyed
 * to the north wall — see that constant's own doc. The line itself is still
 * 5.0 m south of the (translated) hall; it is the wall on both sides of it
 * that moved.
 *
 * **Moved 3.0 m further from the stairs, 18 August 2026** (from a base of 2.0
 * to 5.0), fixing a real CI failure: `check:hotel`'s doorway-crossing march
 * (#278) found the two "stair clearance" doors below led a body straight into
 * the curved flights' own outer-radius flank collider (`Hotel.ts`'s stair
 * builder, `for (const radius of [flight.innerRadius, flight.outerRadius])`).
 * That collider's closest point to this wall sits at local
 * `(STAIR_ARC_C, STAIR_ARC_Z + flight.outerRadius)` — with the *old* base of
 * 2.0 that point measured only 1.2 m past the wall plane, well inside the
 * march's own `CROSSING_APPROACH` (1.0 m) before the wall even starts, so a
 * body approaching the inner stair-clearance door from the foyer collided
 * with the balustrade before it ever reached the doorway. Measured directly
 * against the built `CollisionWorld` (not the rule that placed it): the old
 * base (2.0) left every bearing on both stair-clearance doors blocked; 4.0
 * already cleared every bearing with margin; 5.0 was chosen for headroom
 * beyond that minimum, still gives the hall a full `RECEPTION_ROOM_DEPTH`
 * scale of empty floor before the stairs, and touches nothing else — nothing
 * but this partition's own `at` reads {@link LOBBY_HALL_Z}.
 */
export const LOBBY_HALL_Z = 5.0 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT;

/**
 * Where the foyer/hall doorway sits along {@link LOBBY_HALL_Z}.
 *
 * **On the promenade axis (x = 0), which was not always true.** The first cut
 * of #270 put a doorway here, square with the statue and the arch beyond, and
 * `check:nav-routes` found a real bug hiding behind "square with the statue":
 * the statue's own collision footprint, fattened by a player's own radius,
 * reached to within about 0.6 m of the (then much closer) partition on that
 * exact line, leaving a dogleg not much wider than a child. The fix at the
 * time moved the doorway off-axis instead of re-tuning Eleri's own statue
 * placement.
 *
 * **#271's later foyer growth made that fix obsolete, and put a new one in
 * its place.** {@link LOBBY_FOYER_GROWTH} pushes the statue and the doorway
 * 16 m+ apart in world terms — nowhere near the 0.6 m clearance that forced
 * the move — so this went back to x = 0. But at x = 0 exactly, the *hall*
 * side of the doorway now grazes the **left curved stair's own outer
 * balustrade**, which sweeps to within about 0.13 m of x = −3, the old
 * doorway spot precisely: `check:hotel`'s "walker on the doorway line" probe
 * (the same one #270's original fix was proven against) is what caught this
 * one, pushed 0.71 m sideways rather than blocked outright. x = 0 clears both
 * the statue (by a wide margin now) and both stairs' balustrades (each
 * curve's own closest approach to the axis is ≈3.1 m) — the one spot that
 * was ever actually a problem was −3, not 0.
 */
export const LOBBY_HALL_DOOR_X = 0;

/**
 * Where each curved flight's own foot stands, along the partition — the
 * **second** reason this wall carries more than one doorway.
 *
 * `check:nav-routes` found this one after {@link LOBBY_HALL_DOOR_X}: a
 * flight's floor-level connector anchor (`mezzanineWalkConnectors`'
 * `CONNECTOR_APPROACH` point, one stride out from the bottom tread) sits at
 * `±(STAIR_ARC_C + CONNECTOR_APPROACH)`, and the wall — even pushed as far
 * from the statue as {@link LOBBY_HALL_Z} allows — still fattens, by a
 * walker's own radius, across that exact point. A blocked anchor is not a
 * detour, it is a connector with nowhere to start: `findRoute` never climbed
 * at all, ending every route to the gallery at floor level with the goal
 * still unreached (`lastRouteReachedGoal` false), which is what the multi-hop
 * probes in `check:nav-routes` exist to catch.
 *
 * So the wall does not run past either flight's own foot — the same
 * principle as the lift alcove's gap, just for a staircase instead of a car.
 * A grand staircase's own structure is where a dividing wall stops anyway;
 * nothing here is holding a door open beside the stairs, the stairs simply
 * are the opening.
 *
 * **A single {@link SUITE_DOOR_WIDTH} gap here is not enough**, and this one
 * doorway is why: `check:nav-routes`' walked leg (not just its planned route)
 * still wedged, 0.4 m off the jamb — a wall's own registered half-thickness
 * plus a walker's radius rounds a doorway's *corner* off by about 0.87 m, and
 * a route arriving at this doorway on the diagonal (from the foyer, off to
 * one side, to a point on the far side of the room) clips exactly that
 * corner rather than passing through the middle the way a square-on suite
 * doorway is normally crossed. Two doors, `±0.8` either side of the same
 * centre, give one continuous 4 m opening — plenty of room for a diagonal
 * crossing to clear both corners — where one alone gives 2.4 m with two
 * corners already eating most of it.
 */
export const LOBBY_HALL_STAIR_CLEARANCE_X = STAIR_ARC_C + CONNECTOR_APPROACH;
const STAIR_CLEARANCE_DOOR_SPREAD = 0.8;

/**
 * Where the (old) front door stood before this room grew a reception room of
 * its own — now the position of the **reception/lobby partition**, the wall
 * that used to be the room's own south outer wall.
 *
 * Jim, 18 August 2026, on PR #280: *"still way too hidden. The desk should be
 * in a separate ROOM (like the split rooms in the bedroom) and the lobby in
 * the next room. The desk should be dead centre of this new reception room
 * prior to the main lobby."* Two rounds of nudging `RECEPTION_X`/`RECEPTION_Z`
 * inside the one giant foyer never fixed it because the desk was never the
 * first thing in the room — the statue, the seating and the café all
 * competed with it for the same open floor. A genuinely separate room fixes
 * that structurally: nothing else can be sharing the frame, because nothing
 * else is in the room.
 *
 * **Same mechanism the suite bedroom split uses** ({@link SuitePartition}):
 * an ordinary internal wall with a doorway, inside the one
 * `SPACE_HOTEL_LOBBY` — not a new room/space/portal. Everything that used to
 * be "the foyer" (the statue, the seating, the café, both crystal columns,
 * the hall beyond) keeps its exact local position; only the desk moves, into
 * the new room this line and {@link RECEPTION_ROOM_DEPTH} carve out south of
 * it. This constant is exactly the room's old `halfZ`
 * (`12.4 + LOBBY_FOYER_GROWTH`), named rather than re-typed, so the wall it
 * places the new partition at can never drift from the position it is
 * replacing.
 */
export const LOBBY_HALFZ_BEFORE_RECEPTION = 12.4 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT;

export const LOBBY: HotelRoom = {
  space: SPACE_HOTEL_LOBBY,
  theme: LOBBY_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_LOBBY_Z,
  // Held at 13 deliberately — issue #281's bathroom fix first tried widening
  // this, which moved the west wall (everything here is measured from
  // `±halfX`) far enough that the west window's own "Look out" stand-spot
  // search (pinned to this wall by `zoneAt: -6.6`) landed squarely on the
  // crystal column at local (-11.9, -6.6) from every candidate depth and
  // lateral offset it tried — `check:hotel` found the zone offering "Look
  // out" from nowhere a child could stand. The bathroom's own east-west room
  // comes from widening the *nook itself* into already-empty floor instead
  // (its west wall moved from local x = 9.4 to 7.0 — nothing else in this
  // room occupies x > 7 at z ≥ 9), which touches none of the room's outer
  // walls at all.
  halfX: 13,
  // Deepened from 10 by exactly the gallery's own 4.8 m, so the open floor of
  // the lobby is the room it always was and the mezzanine is *added* space
  // rather than space taken off a child; deepened again by
  // {@link LOBBY_FOYER_GROWTH} for the entrance foyer's own paintings (see
  // that constant's doc for why the south wall actually moves by twice
  // this), and deepened once more by {@link RECEPTION_ROOM_DEPTH} for the
  // new reception room the front door now opens into — see
  // {@link LOBBY_HALFZ_BEFORE_RECEPTION}'s own doc.
  halfZ: LOBBY_HALFZ_BEFORE_RECEPTION + RECEPTION_ROOM_DEPTH,
  // The imperial composition stands 5.44 m to the gallery and a child on it
  // wants `ARCH_CLEAR` of air over her head, so the two far walls rise to
  // 8.9 — over the asset's `LOBBY_MIN_WALL_HEIGHT` (8.81), which
  // `assertStairMatches` enforces. Only the two far walls are this tall; see
  // `nearWallHeight` for why the two the camera looks through are not.
  wallHeight: 8.9,
  nearWallHeight: 3.4,
  // South: the front door back out to the park (formula-derived from
  // `halfZ`, so it needs no edit of its own — `Hotel.ts`'s `buildRoomShell`
  // builds both outer walls at `±room.halfZ`). West: the lift, centred on
  // `liftZ` — this gap must track that field by hand (nothing derives one
  // from the other), so it carries `LOBBY_FOYER_GROWTH` the same way.
  gaps: {
    south: [-DOOR_HALF, DOOR_HALF],
    west: [
      -1.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      1.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
    ],
  },
  // **Clerestory.** The north row sits above the gallery deck (5.44), so the
  // panes read as the windows the gallery looks out of and throw the room's
  // brightest band high across the double-height space. `lookZone: false`:
  // a ground-level "Look out" stand spot for a pane 6 m up would put a child
  // in the colonnade staring at a wall — the west wall carries the zone.
  windows: {
    north: { at: [-11, -6, -1, 4, 9], width: 2.2, sill: 5.9, head: 7.7, lookZone: false },
    // West: the stretch south of the colonnade — plus the lift gap, which
    // `glazeWall` clips these to automatically. The northernmost pane used to
    // sit at -3.8; it moved to -6.6 (8 Aug 2026) so one pane stands a clear
    // finger outside the lift's boarding band, and `zoneAt` pins "Look out"
    // to it — the default picker's other candidates are the pane over the
    // lift band and the pane the café tables crowd.
    //
    // **3.2 stays put; 9.6 moves with the café it lights.** The foyer's
    // {@link LOBBY_FOYER_GROWTH} translates every foyer *fixture* south, and
    // every hall fixture (this pane included — it lights the old arch, not
    // anything in the foyer) north by the same constant, in lockstep (see
    // that constant's doc). The one exception, kept deliberately unmoved: 3.2
    // lights the statue's end of the promenade regardless of how much
    // further south the room now reaches, so moving it would only separate
    // it from what it lights. 9.6 lights the café table it was placed beside
    // (`dressLobby`'s `lobby-a`/`-b`), which *did* move, so this pane follows
    // it — 9.6 + growth.
    west: {
      at: [
        -6.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        3.2 - RECEPTION_ORIGIN_SHIFT,
        9.6 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
        // The reception room's own pane — north of the desk (which sits
        // dead centre, `RECEPTION_Z`), so it lights the walk in from the
        // partition doorway without competing with the desk's own "Look!"
        // stand spot for floor space. Same style as the rest of the foyer's
        // west glazing.
        LOBBY_HALFZ_BEFORE_RECEPTION + 2.5,
      ],
      width: 1.8,
      sill: 1.2,
      head: 3.6,
      zoneAt: -6.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
    },
  },
  // Four partitions, three purposes:
  //
  // 1. **The reception/lobby divide** — issue #280's room split (18 August
  //    2026, Jim: *"the desk should be in a separate ROOM ... dead centre of
  //    this new reception room prior to the main lobby"*). A single centred
  //    doorway, on the promenade axis like every other doorway in this room:
  //    nothing this side of it competes for space with the desk, so a single
  //    {@link SUITE_DOOR_WIDTH} gap is plenty — no stair, no statue, nothing
  //    to dogleg around.
  // 2. **The foyer/hall divide** — see {@link LOBBY_HALL_Z}. Five doorways:
  //    {@link LOBBY_HALL_DOOR_X} for foot traffic, {@link SUITE_DOOR_WIDTH}
  //    wide like every other room doorway in the hotel, and a paired,
  //    double-wide one either side at ±{@link LOBBY_HALL_STAIR_CLEARANCE_X}
  //    where the wall would otherwise fatten across a stair's own connector
  //    anchor (see that constant's own doc for why one doorway's width was
  //    not enough there).
  // 3. **The bathroom** (issue #272, own-room rewrite issue #281 — Jim: "make
  //    the bathrooms … a new room adjoining the existing floorplan, don't try
  //    to squeeze it into the existing"). South-east corner of the *foyer*
  //    (#280's split put this whole area — statue, seating, café — south of
  //    {@link LOBBY_HALL_Z}, so the bathroom is a foyer fixture and every one
  //    of its z-literals carries the same
  //    `+ LOBBY_FOYER_GROWTH − RECEPTION_ORIGIN_SHIFT` every other foyer
  //    fixture does; see that constant's own doc for why). Two runs: the
  //    room's own east wall (x = 13, untouched by #280) closes one side for
  //    free; the *south* side no longer does, though — #280 moved the real
  //    south (front-door) wall out to `halfZ` = 25.4, so what used to be the
  //    room's outer wall at old z = 12.4 is now
  //    {@link LOBBY_HALFZ_BEFORE_RECEPTION}, the reception/lobby partition
  //    above. It closes for free just the same (solid there — its only door
  //    is at x = 0, 7 m clear of this bathroom), so `to` below reads that
  //    constant directly rather than re-deriving the same number, the same
  //    reasoning {@link LOBBY_HALFZ_BEFORE_RECEPTION}'s own doc gives for
  //    referencing it instead of retyping `12.4 + LOBBY_FOYER_GROWTH −
  //    RECEPTION_ORIGIN_SHIFT`. The other run closes the remaining two sides
  //    — the door sits on the west wall, well clear of both corners (0.5 m of
  //    solid wall either side of it, `check:hotel` probe 18's "every
  //    partition end reaches a wall or a doorway jamb" — untouched by the
  //    shift, since it is a rigid translation). **The west wall sits at
  //    x = 7.0, not the doorway's original 9.4** — widened into open floor
  //    nobody else uses south of (old) z = 9, now `9.0 + LOBBY_FOYER_GROWTH −
  //    RECEPTION_ORIGIN_SHIFT` (the seating groups, breakfast tables and
  //    planters all sit north of it, and none of them reach x > 3.4, well
  //    clear of this bathroom's x ≥ 7). `check:tap-spacing` ruled out every
  //    narrower version: the "Use" zone needs a finger clear of the doorway's
  //    own tap-spacing band *and* of the east wall's face at once, and the
  //    old 3.6 m nook could satisfy one only by failing the other (`halfX`'s
  //    own comment has the version of this fix that tried widening the
  //    *room* instead, and what that broke).
  //
  // All four runs reach both outer walls or another partition (CLAUDE.md's
  // own lesson from the suite — a partition that stops short of a wall is a
  // free-standing wall end you can see, and walk, around).
  partitions: [
    {
      along: 'x',
      at: LOBBY_HALFZ_BEFORE_RECEPTION,
      from: -13,
      to: 13,
      doors: [0],
    },
    {
      along: 'x',
      at: LOBBY_HALL_Z,
      from: -13,
      to: 13,
      doors: [
        LOBBY_HALL_DOOR_X,
        LOBBY_HALL_STAIR_CLEARANCE_X - STAIR_CLEARANCE_DOOR_SPREAD,
        LOBBY_HALL_STAIR_CLEARANCE_X + STAIR_CLEARANCE_DOOR_SPREAD,
        -LOBBY_HALL_STAIR_CLEARANCE_X - STAIR_CLEARANCE_DOOR_SPREAD,
        -LOBBY_HALL_STAIR_CLEARANCE_X + STAIR_CLEARANCE_DOOR_SPREAD,
      ],
    },
    {
      along: 'z',
      at: 7.0,
      from: 9.0 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      to: LOBBY_HALFZ_BEFORE_RECEPTION,
      doors: [10.7 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT],
    },
    {
      along: 'x',
      at: 9.0 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      from: 7.0,
      to: 13,
      doors: [],
    },
  ],
  // The imperial plan — see {@link Mezzanine} for what each piece is, and
  // HANDOFF-lobby-art.md for where every number comes from. The derivations,
  // for the reader (assertStairMatches proves them, and none of them cares
  // about absolute z — only relative heights, radii and sweeps — so the
  // whole plan carries `LOBBY_FOYER_GROWTH` below without disturbing any of
  // it, per that constant's own doc):
  //   arc centres (±7.99, −2.5); radii 3.06/4.86; twelve treads over ±90°;
  //   landing x ±4.93 (= C − innerRadius, lapping 3 cm into each curve's
  //   inner string — the designed STAIR_STRING_BITE overlap), z −7.6…−2.5
  //   (five balustrade tiles deep), at 3.84;
  //   straight flight centred on the axis, bottom riser at
  //   −7.6 + STRAIGHT_RUN (2.592) = −5.008, landing on the gallery at −7.6;
  //   gallery full-width at 5.44, a colonnade — open underneath to the
  //   north wall, which is what makes the arch a genuine see-through.
  mezzanine: {
    minX: -13,
    maxX: 13,
    minZ: -12.4 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
    maxZ: -7.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
    height: LOBBY_MEZZANINE_Y,
    landing: {
      minX: -4.93,
      maxX: 4.93,
      minZ: -7.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      maxZ: STAIR_ARC_Z,
      height: LOBBY_LANDING_Y,
      slab: LOBBY_LANDING_SLAB,
    },
    stairs: [
      // 'right' — the flight that turns right as you climb it — on +X, and
      // its mirror on −X, both at fromAngle 0 (no rotation at all): at a
      // quarter turn a flight's foot is square to the room AND its top square
      // to the landing, which is the whole reason the sweep is 90°.
      {
        centreX: STAIR_ARC_C,
        centreZ: STAIR_ARC_Z,
        innerRadius: 3.06,
        outerRadius: 4.86,
        fromAngle: 0,
        toAngle: Math.PI / 2,
        treads: 12,
      },
      {
        centreX: -STAIR_ARC_C,
        centreZ: STAIR_ARC_Z,
        innerRadius: 3.06,
        outerRadius: 4.86,
        fromAngle: 0,
        toAngle: -Math.PI / 2,
        treads: 12,
      },
    ],
    straight: {
      centreX: 0,
      frontZ: -5.008 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
      walkWidth: 3.6,
      flankX: 2.01,
      treads: 5,
      rise: LOBBY_MEZZANINE_Y - LOBBY_LANDING_Y,
    },
  },
  // Carries `− LOBBY_FOYER_GROWTH`, same as every other hall fixture keyed
  // to the north wall — the lift alcove is a hall feature.
  liftZ: 0 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT,
  liftFloor: 0,
  floorLabel: 'Lobby',
};

/**
 * The breakfast room — the biggest space in the hotel, and on purpose.
 *
 * 24 × 18 m against the lobby's 26 × 20: Jim asked for *"a large room with lots
 * of tables and a buffet with breakfast foods"*, and rooms are disjoint spaces,
 * so floor area here costs nothing anywhere else. The one real bound is
 * `HOTEL_PLAY_RADIUS` (24 m from the room's origin, the circle
 * `Hotel.boundTo` sets): the far corner of this plate is 15 m out and the
 * lift alcove's back wall 15.4 m, both comfortably inside it.
 */
export const BREAKFAST: HotelRoom = {
  space: SPACE_HOTEL_BREAKFAST,
  theme: BREAKFAST_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_BREAKFAST_Z,
  // Held at 12 deliberately — issue #281's own bathroom fix first tried
  // growing this too, which moved the west wall (everything here is
  // measured from `±halfX`) close enough to the crystal cluster at local
  // (-10.6, -7.4) to put a painting's "Look" stand spot inside it
  // (`check:hotel` found this). The bathroom's east-west room comes from
  // `halfZ` and the door's own position instead — see below.
  halfX: 12,
  // Grown from 9 (issue #281). The south-east nook's own doorway needs
  // distance from table b1-d (local 8.8, 4.6) that a 9 m room did not have:
  // with the run only 3.2 m long the door could not sit far enough south of
  // the table to clear the tap-spacing rule for either the table's own
  // chairs or the bathroom's "Use" zone (`check:tap-spacing`), nor the
  // doorway-clearance check for a chair's footprint (`check:hotel`). The
  // extra 2.3 m — split evenly, so it also opens up welcome floor between
  // the buffet and the north wall — gives the run enough length to push the
  // door within a stride of the south wall, well clear of the table.
  //
  // A further 0.6 m south (PR #281 review, 18 Aug 2026): the bathroom's own
  // NW corner — where `partitions[0]`'s west wall meets `partitions[1]`'s
  // north wall — sat only 0.226 m from table b1-d's own chair (local 8.49,
  // 5.60; a real 0.324 m disc-into-wall overlap, since `CollisionWorld`
  // clamps a wall's closest point to its segment, so the corner is a capsule
  // cap, not just two flat faces). The whole bathroom sub-room (both
  // partitions, the door, `buildBathroomFixtures`' rect query and every
  // fixture coordinate in `dressBreakfast`) is translated south by the same
  // 0.6 m together, so its own internal layout — door position, fixture
  // spacing, rug sizing — is unchanged; only its distance from the chair
  // moves. Verified against the real `CollisionWorld` — see
  // `check-hotel.mts`'s furniture-vs-wall probe.
  halfZ: 11.9,
  wallHeight: 3.0,
  gaps: { west: [-1.6, 1.6] },
  // Seven of them along the north wall, above the buffet — this is the room
  // you eat breakfast in, so it is the room that has to read as *morning*.
  // They replace the one hand-built glowing band that used to be nailed here,
  // and which no other room could have.
  windows: {
    north: { at: [-10, -6.6, -3.2, 0.2, 3.6, 7, 10.4], width: 2.2, sill: 1.5, head: 2.75 },
    west: { at: [-8.1, -3, 2.9, 8.1], width: 1.4, sill: 1.1, head: 2.6 },
  },
  // The bathroom (issue #272/#281) — south-east corner, same shape as the
  // lobby's. The door sits on the west wall, jamb touching the (now further
  // south) south outer wall exactly (a valid, zero-length jamb —
  // `check:hotel` probe 18 skips a jamb end's own wall-touching check, the
  // same pattern the suite's own hall-to-bathroom door already uses), which
  // puts it a full 5.5 m south of table b1-d — comfortably clear of both its
  // footprint and its chairs' "Sit" zones. **The whole room is a further
  // 0.6 m south of that** (`halfZ`'s own comment) — the room's own NW corner,
  // not its west wall's face, is what actually sits closest to b1-d's own
  // chair, and needed the margin the corner (not the face) was short of.
  partitions: [
    { along: 'z', at: 8.6, from: 6.4, to: 11.9, doors: [10.7] },
    { along: 'x', at: 6.4, from: 8.6, to: 12, doors: [] },
  ],
  liftZ: 0,
  liftFloor: 1,
  floorLabel: 'Floor 1',
};

export const CORRIDOR: HotelRoom = {
  space: SPACE_HOTEL_CORRIDOR,
  theme: CORRIDOR_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_CORRIDOR_Z,
  halfX: 11,
  halfZ: 4,
  wallHeight: 3.0,
  // East: the "yours" door into the suite. West: the lift.
  gaps: { east: [-1.1, 1.1], west: [-1.6, 1.6] },
  // Fifty storeys up, so these are the windows with the view — set between the
  // wall's five stars and below them, with a pet statue silhouetted against
  // each. **No west windows**: that wall is 8 m deep, has the lift gap through
  // the middle of it and a sconce in each remaining 2.4 m span, and a pane
  // squeezed into what is left would read as a mistake rather than a window.
  windows: {
    north: { at: [-7.3, -2.5, 2.5, 7.3], width: 2, sill: 0.9, head: 1.95 },
  },
  liftZ: 0,
  liftFloor: 4,
  floorLabel: 'Floor 50',
};

/**
 * The suite's internal partitions — **declared here, built by
 * `Hotel.partitionSuite`**, the same way windows and the mezzanine are.
 *
 * Jim, 7 August 2026: *"four sub-rooms in the ONE suite space — three rainbow
 * bedrooms + a lounge."* One space, four rooms: the partitions are ordinary
 * walls inside it, so nothing about portals, saves or `spaceAt` changes — it
 * is still `hotel.suite` wherever you stand.
 *
 * A partition is a run along one axis with a **doorway** taken out of it, and
 * the doorway is generous (2.4 m) on purpose: a child does not aim, and a
 * standard 1.1 m door that she has to line herself up with is exactly the
 * fiddliness the lift's auto-boarding exists to delete.
 */
export interface SuitePartition {
  /** `'x'` for a wall running along X (so it separates north from south). */
  readonly along: 'x' | 'z';
  /** Where it sits on the other axis. */
  readonly at: number;
  /** Its extent along `along`. */
  readonly from: number;
  readonly to: number;
  /** Doorway centres along `along`. Each is {@link SUITE_DOOR_WIDTH} wide. */
  readonly doors: readonly number[];
}

/** How wide a doorway inside the suite is. Generous — see {@link SuitePartition}. */
export const SUITE_DOOR_WIDTH = 2.4;

/**
 * Where the three beds stand, one per bedroom, in the suite's local metres.
 *
 * **Here rather than in `Hotel.dressSuite`, because two things need them**:
 * the dressing that builds them, and `check:hotel`, which asserts each one is
 * soft (a bed is a walk surface — a collider round its edge would shove a
 * jumping child off it) and standable. The check used to carry its own copy of
 * these three pairs, and the day the suite was split into four rooms all three
 * went stale at once and it failed with six problems about beds that were
 * simply somewhere else. One list, two readers — CLAUDE.md's opening rule.
 *
 * Each bed's own bedroom is the strip of floor between the partitions either
 * side of it, so moving a bed without moving its partition is a bed in a wall;
 * `check:hotel` measures that too.
 */
// Bedroom1's and bedroom3's spots shifted 3.8 m with their bedrooms when
// `SUITE.halfX` grew for issue #274 (see the comment there); bedroom2's is
// untouched, since bedroom2 grew symmetrically about its own centre.
export const SUITE_BED_SPOTS: readonly (readonly [number, number])[] = [
  [-10.7, -5.2],
  [-0.4, -5.2],
  [11.0, -5.2],
];

/** Where the bedside tables stand — beside each bed, same reasoning as above. */
export const SUITE_BEDSIDE_X: readonly number[] = [-9.2, 1.1, 12.5];
export const SUITE_BEDSIDE_Z = -5.2;

/**
 * A human bed's own footprint half-extents — `Hotel.dressSuite`'s
 * `props.place` call and its matching `Plate`, and {@link petBedSlots}'s own
 * keep-out rectangle around it, all read this rather than each carrying its
 * own copy of 0.7/1 (found duplicated three ways in review on #279).
 */
export const SUITE_BED_HALF_X = 0.7;
export const SUITE_BED_HALF_Z = 1;

/** A bedside table's own footprint radius — same reasoning as {@link SUITE_BED_HALF_X}. */
export const SUITE_BEDSIDE_RADIUS = 0.36;

/**
 * A pet bed's whole footprint radius — the posts and canopy, not just
 * {@link PET_BED_CUSHION_RADIUS}'s cushion (`art/models/hotelAssets.ts`).
 */
export const PET_BED_FOOTPRINT_RADIUS = 0.62;

/** Centre-to-centre spacing {@link petBedSlots} tiles pet beds at — comfortably
 *  past the 1.24 m two {@link PET_BED_FOOTPRINT_RADIUS} circles need to clear
 *  each other. */
const PET_BED_PITCH = 1.3;

/**
 * How far short of the hall doorway's own line (the bedroom's `maxZ` from
 * {@link clearFloorAround}) the last pet-bed row must stay — a flat safety
 * margin well past `PLAYER_RADIUS`'s real clearance, chosen so this function
 * never has to import `place.ts`'s doorway math (and risk the circular
 * import that would make) just to reason about one specific door.
 * `HotelProps.place`'s own doorway check (issue #273) is still the real,
 * load-bearing proof that every placed bed clears it — this is what keeps
 * {@link petBedSlots} from wasting rows it would only have to throw away.
 */
const PET_BED_DOORWAY_MARGIN = 0.6;

/**
 * The rectangle around a bedroom's own human bed and bedside table (both
 * {@link SUITE_BED_SPOTS}`[bedIndex]` and {@link SUITE_BEDSIDE_X}`[bedIndex]`)
 * that a pet bed must stay clear of, widened by {@link PET_BED_FOOTPRINT_RADIUS}
 * so a pet bed's own footprint clears it, not just its centre.
 *
 * Takes `bedIndex` rather than always reading bedroom 2 (issue #279's
 * original shape) because issue #274/#275's follow-up bug (Jim, 18 Aug 2026:
 * *"the pet didn't get into any bed when I went to sleep"*) traced to every
 * pet bed living in bedroom 2 alone: a nap taken from bedroom 1 or 3 — the
 * first bedroom door a child actually reaches from the corridor, per
 * `Hotel.enterSuite`'s own doc comment — is a solid partition and the fixed
 * camera's whole field of view away from where any pet lies down, so it
 * looked exactly like nothing had happened. See {@link petBedSlots}.
 */
function humanFurnitureKeepOutX(bedIndex: number): { readonly minX: number; readonly maxX: number } {
  const [bedX] = SUITE_BED_SPOTS[bedIndex] ?? [0, 0];
  const bedsideX = SUITE_BEDSIDE_X[bedIndex] ?? 0;
  return {
    minX: Math.min(bedX - SUITE_BED_HALF_X, bedsideX - SUITE_BEDSIDE_RADIUS) - PET_BED_FOOTPRINT_RADIUS,
    maxX: Math.max(bedX + SUITE_BED_HALF_X, bedsideX + SUITE_BEDSIDE_RADIUS) + PET_BED_FOOTPRINT_RADIUS,
  };
}

/**
 * Every pet-bed row's z in `bedIndex`'s own bedroom, tiled from the
 * bedroom's own north wall down to {@link PET_BED_DOORWAY_MARGIN} short of
 * the hall doorway — derived from {@link clearFloorAround} rather than the
 * wall positions themselves (any point in the bedroom's own column gives the
 * same answer, since nothing inside it subdivides the room further), so a
 * future move of any wall re-fits every row automatically. The representative
 * x is the bedroom's own bed — always inside its own bedroom's column by
 * construction, whichever of the three bedrooms `bedIndex` names.
 */
function petBedRowsZ(bedIndex: number): number[] {
  const [bedX, bedZ] = SUITE_BED_SPOTS[bedIndex] ?? [0, 0];
  const rect = clearFloorAround(SUITE, bedX, bedZ);
  const southLimit = rect.maxZ - PET_BED_DOORWAY_MARGIN;
  const rows: number[] = [];
  for (
    let z = rect.minZ + PET_BED_FOOTPRINT_RADIUS + 0.1;
    z + PET_BED_FOOTPRINT_RADIUS <= southLimit;
    z += PET_BED_PITCH
  ) {
    rows.push(z);
  }
  return rows;
}

/**
 * Does a pet bed centred at `(x, z)` clear every zone in `doors`? The same
 * clamped-point-to-rectangle test `place.ts`'s `isClearOfDoorways` uses for
 * every other prop, reimplemented here (four lines of pure geometry) rather
 * than imported — `place.ts` already imports {@link doorwayClearanceZones}
 * *from* this file, so importing back would be circular.
 *
 * {@link PET_BED_DOORWAY_MARGIN} only ever bounded the row's own *z*, one
 * doorway at a flat distance; it stayed blind to a row's *columns*, which
 * can sit close enough to a doorway's own width to graze its zone on the
 * diagonal even while comfortably clear on z alone (found on #279's rebase
 * over #278's widened `DOORWAY_THROUGH_DEPTH`: the innermost west column of
 * the bedroom's last row, 0.57 m off the door's own edge in x and 0.19 m in
 * z, at 0.601 m from the zone's corner — inside the bed's own 0.62 m
 * radius). Checking every candidate against the real zones this room's own
 * doorways produce is what actually proves the whole footprint clears them,
 * not just the row that carries it.
 */
function clearsDoorways(x: number, z: number, doors: readonly DoorwayZone[]): boolean {
  return doors.every((door) => {
    const nearestX = Math.max(door.minX, Math.min(x, door.maxX));
    const nearestZ = Math.max(door.minZ, Math.min(z, door.maxZ));
    return Math.hypot(x - nearestX, z - nearestZ) >= PET_BED_FOOTPRINT_RADIUS;
  });
}

/**
 * Enough non-overlapping pet-bed slots for `count` pets, in one bedroom's own
 * local metres — one per pet the player owns, see `Hotel.dressPetBeds`
 * (issue #275). **Here, not a hand-typed list in `Hotel.ts`, for the same
 * reason {@link SUITE_BED_SPOTS} is a list and not a literal in
 * `Hotel.dressSuite`**: `check:hotel` needs this function too, to prove it
 * never overlaps, and `store.ts` puts **no ceiling at all** on how many pets
 * a child can own — a fixed, hand-typed slot list silently started placing
 * every pet past its own length at the exact same coordinates as the last
 * slot (issue #275's original review bug: identical overlapping bed and pet
 * meshes, not graceful degradation).
 *
 * `bedIndex` picks which of {@link SUITE_BED_SPOTS}' three bedrooms the row
 * tiles across — **default 1, the middle bedroom**, exactly the original
 * (and still primary) behaviour: that room alone was doubled by issue #274
 * for this, and its four rows of seven columns tile out to 28 raw slots —
 * minus whichever ones {@link clearsDoorways} throws out for actually
 * grazing the hall doorway's own zone (one, at the middle bedroom's current
 * geometry: the innermost west column of the southmost row), leaving 27
 * usable — twice what `check:hotel` asks this function to place at once.
 * `Hotel.dressPetBeds` passes 0 or 2 for the two side bedrooms, one slot at
 * a time — see the doc comment on {@link humanFurnitureKeepOutX} for why a
 * second bedroom's worth of calls exists at all now.
 *
 * Tiles every row {@link petBedRowsZ} finds for that bedroom — north of its
 * own human bed and bedside table, south of them down to short of the hall
 * doorway — outward from that furniture, west then east, across the
 * bedroom's own **real** clear floor at each row ({@link clearFloorAround},
 * never a hand-typed wall position), then drops any candidate
 * {@link clearsDoorways} rejects. A `count` past a bedroom's own capacity is
 * capped rather than reusing a slot: nothing drawn is safer than something
 * drawn twice in the same spot, and no purchase this game's shop can
 * produce reaches the middle bedroom's 27 (four species, so a genuinely
 * dedicated collector would need to buy the same pet seven times over before
 * a bed failed to appear for one of them).
 */
export function petBedSlots(
  count: number,
  bedIndex = 1,
): readonly { readonly x: number; readonly z: number }[] {
  const keepOut = humanFurnitureKeepOutX(bedIndex);
  const bedX = (SUITE_BED_SPOTS[bedIndex] ?? [0, 0])[0];
  const doors = doorwayClearanceZones(SUITE, PLAYER_RADIUS);
  const slots: { readonly x: number; readonly z: number }[] = [];
  for (const z of petBedRowsZ(bedIndex)) {
    const rect = clearFloorAround(SUITE, bedX, z);
    const west: number[] = [];
    for (
      let x = keepOut.minX - PET_BED_FOOTPRINT_RADIUS - 0.05;
      x - PET_BED_FOOTPRINT_RADIUS >= rect.minX;
      x -= PET_BED_PITCH
    ) {
      if (clearsDoorways(x, z, doors)) west.push(x);
    }
    const east: number[] = [];
    for (
      let x = keepOut.maxX + PET_BED_FOOTPRINT_RADIUS + 0.05;
      x + PET_BED_FOOTPRINT_RADIUS <= rect.maxX;
      x += PET_BED_PITCH
    ) {
      if (clearsDoorways(x, z, doors)) east.push(x);
    }
    // Closest to the human furniture first, alternating west and east.
    const columns = Math.max(west.length, east.length);
    for (let i = 0; i < columns && slots.length < count; i += 1) {
      if (west[i] !== undefined) slots.push({ x: west[i]!, z });
      if (east[i] !== undefined && slots.length < count) slots.push({ x: east[i]!, z });
    }
    if (slots.length >= count) break;
  }
  return slots.slice(0, count);
}

/**
 * How tall the suite's internal partitions are.
 *
 * **Lower than the room's own walls, and that is a camera decision.** At the
 * fixed 38° pitch a wall hides 1.28·H metres of floor behind it, and an
 * internal wall is always between the camera and *something*: at the outer
 * walls' 3.0 m each partition would black out 3.8 m of the room behind it,
 * which in a 6.4 m deep bedroom is most of the bedroom. At 2.2 m it hides
 * 2.8 m, which clears the bed. Partitions in a child's suite reading as
 * room dividers rather than as full walls is also simply truer to what this
 * is — a big room divided up, not a corridor of cells.
 */
export const SUITE_PARTITION_HEIGHT = 2.2;

export const SUITE: HotelRoom = {
  space: SPACE_HOTEL_SUITE,
  theme: SUITE_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_SUITE_Z,
  // Grown from 8 × 6 to hold four rooms, then widened again (issue #274,
  // 17 Aug 2026: *"the hotel bedroom should be roughly double its current
  // size"*) so the middle bedroom — the one with the pet's own furniture,
  // see {@link SUITE.partitions} — could hold a small bed for each pet the
  // player owns rather than one shared four-poster (issue #275).
  //
  // **Width only, and by exactly the middle bedroom's own old width.** The
  // west and east bedrooms keep their existing footprint and furniture,
  // simply translated outward by 3.8 m each; every extra metre of the 7.6 m
  // `halfX` grew by goes to the middle bedroom alone, taking it from 7.6 to
  // 15.2 m wide — literally double, area included, since its 6.3 m depth is
  // untouched. Depth was deliberately left alone: the room is one rectangle,
  // so growing `halfZ` too would have grown the hall, lounge and bathroom's
  // *depth* by the same amount for free, which is a much bigger change than
  // "the bedroom" asked for. The far corner is now 17 m from the origin,
  // still comfortably inside `HOTEL_PLAY_RADIUS`'s 24 m.
  //
  // **`halfX` alone still could not be made free of side effects — the room
  // is one rectangle, so both outer walls move for every row, not just the
  // bedrooms'.** The bathroom keeps its own old footprint anyway, because
  // its own dividing wall is deliberately re-anchored to the bedroom1/2
  // divider it grids with (see `partitions` below) and moves the same 3.8 m
  // with it. The **lounge did not get an equivalent anchor and genuinely
  // grew** — both its walls (the bathroom wall on the west, `SUITE`'s own
  // outer wall on the east) moved away from it — which review on #279 found
  // `Hotel.dressLounge` had not been redressed for: its furniture was still
  // at the old fixed coordinates, sitting in the middle of several new bare
  // metres of floor on both sides. `dressLounge` now redresses that
  // properly (its own comments explain how) rather than this file adding a
  // second wall purely to keep the lounge the size it used to be.
  halfX: 14.8,
  halfZ: 8,
  wallHeight: 3.0,
  // West: back out to the corridor.
  gaps: { west: [-1.1, 1.1] },
  // Three bedrooms across the north half, the lounge and the bathroom across
  // the south, and a hall between them that the corridor door opens straight
  // into. The hall is z ±1.7 and the door gap only z ±1.1, so the partitions
  // meeting the west wall leave the doorway untouched.
  //
  // **Every run reaches a wall or a doorway jamb — nothing ends in open
  // air.** The two long runs used to stop at −9.4, 1.6 m short of the west
  // wall, on the theory that this kept the hall clear; what it actually built
  // was a free-standing wall end past which you could see (and walk) around
  // every "room" — Jim, looking at the bedroom: *"The dividing walls don't go
  // to the edge of the space."* `check:hotel` probe 18 now measures every
  // partition end in the hotel against the built walls.
  partitions: [
    { along: 'x', at: -1.7, from: -14.8, to: 14.8, doors: [-10.4, 0, 10.4] },
    { along: 'x', at: 1.7, from: -14.8, to: 14.8, doors: [4.4] },
    // Bedroom1/bedroom2 boundary — was x = −4.2, moved 3.8 m west so bedroom2
    // (east of here) gains that much extra width.
    { along: 'z', at: -8.0, from: -8, to: -1.7, doors: [] },
    // Bedroom2/bedroom3 boundary — was x = 3.4, moved 3.8 m east for the
    // same reason, from the other side.
    { along: 'z', at: 7.2, from: -8, to: -1.7, doors: [] },
    // The bathroom's own wall — the south half's answer to the bedroom1/2
    // divider at the same x, so the plan still reads as one grid; it moved
    // with that divider (−4.2 → −8.0) rather than staying put, which is what
    // keeps the bathroom itself exactly the size it always was. **Its
    // doorway opens off the lounge, not the hall** — an en-suite off the
    // living room — because a hall-side door boxed the pan into corners the
    // fixed camera cannot see (a 2.2 m partition hides 2.8 m of floor behind
    // it) or into the door band's own finger of tap clearance; watched in
    // the browser, not guessed. The door's north jamb lands exactly on the
    // hall wall's line, so the run's built span is one clean piece from jamb
    // to south wall.
    { along: 'z', at: -8.0, from: 1.7, to: 8, doors: [2.9] },
  ],
  // **One per room.** The suite is four rooms now, and a bedroom with no
  // window is the thing Jim objected to in the first place (*"a room without
  // windows is not inviting"*) — so the north wall gets one per bedroom and
  // the west wall keeps the pair flanking your own front door. The rainbow
  // Eleri asked for by name is still painted right across the north and east
  // walls; these three panes are threaded between its bands rather than
  // through them (`dressSuite` lays the stripes to 2.6 m, the sills start at
  // 1.5 m on the wall's own upper half).
  windows: {
    // One per bedroom still, but between each bed and its partition rather
    // than dead over the bed (8 Aug 2026): a pane centred on a bed put the
    // wall's "Look out" zone and the bed's "Sleep" zone a quarter-metre
    // apart, and the tap-spacing rule (`world/tapSpacing.ts`) wants a full
    // finger between different actions.
    // `zoneAt` pins "Look out" to the third bedroom's pane: the middle one's
    // stand spot is blocked (the pet beds live in that bedroom — see
    // `Hotel.dressPetBeds`), so the default picker slid to the first
    // bedroom's pane — 3.04 m from the west wall's painting, inside the tap
    // rule's finger. Bedroom1's and bedroom3's panes shifted 3.8 m with their
    // bedrooms (see `SUITE.halfX`); bedroom2's is untouched, since bedroom2
    // grew symmetrically about its own centre.
    north: { at: [-13.3, -2.9, 13.5], width: 2.2, sill: 1.5, head: 2.6, zoneAt: 13.5 },
    // One pane, lighting the bathroom — light only, no zone (see
    // {@link WindowWall.lookZone}). The pair that used to flank the front
    // door (±1.95) could not survive the partitions reaching the west wall:
    // the junctions land at z ±1.7, straight through the middle of each old
    // pane, and a wall running into a window is worse than no window. The
    // slot between the door gap (±1.1) and the junction (±1.5) is 0.4 m —
    // no pane fits there — so the west light moves to the one stretch of
    // that wall with room for it, which the bathroom is glad of. Bedroom 1
    // keeps its own north pane like the others.
    west: { at: [5.9], width: 1.5, sill: 0.9, head: 2.6, lookZone: false },
  },
  liftZ: null,
  liftFloor: 4,
  floorLabel: 'Floor 50',
};

/**
 * **Floor 12, the garden floor** — an indoor meadow.
 *
 * Wide and shallow like the breakfast room, because what this floor is *for*
 * is walking through a meadow: a lawn down the middle, planters and trellises
 * either side, and a little pond. Windows on both visible walls — a garden
 * with no sky is a cellar.
 */
export const GARDEN_FLOOR: HotelRoom = {
  space: SPACE_HOTEL_GARDEN,
  theme: GARDEN_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_GARDEN_Z,
  // Grown from 11 (issue #281 — Jim: "it is fine to make the floor bigger")
  // so the bathroom's own east-wall room has real depth for a doorway rather
  // than the old two-wall nook squeezed against the existing east wall. The
  // extra 1.4 m lands on both the east (the bathroom's own gain) and west
  // (empty, past the lift alcove) sides — nothing else in this room is
  // positioned relative to the old halfX, so nothing else moves.
  halfX: 12.4,
  halfZ: 8,
  wallHeight: 3.2,
  gaps: { west: [-1.6, 1.6] },
  windows: {
    north: { at: [-8.4, -4.2, 0, 4.2, 8.4], width: 2.4, sill: 1.1, head: 2.75 },
    west: { at: [-5.6, 5.6], width: 1.6, sill: 1.1, head: 2.6 },
  },
  // The bathroom (issue #272/#281) — against the (new, further-out) east
  // wall, between the two hedges, now a real four-sided room: the two
  // north/south partitions that used to be the nook's only walls, closed on
  // the west (open) side by a third partition carrying the door. That run is
  // only 3.0 m, so the door (2.4 m) leaves a thinner 0.3 m jamb each side
  // than the lobby's — still real wall, not a corner-touching jamb, so
  // `check:hotel` probe 18 (partition ends must reach a wall) has something
  // to reach.
  partitions: [
    { along: 'x', at: -4.6, from: 8.35, to: 12.4, doors: [] },
    { along: 'x', at: -1.6, from: 8.35, to: 12.4, doors: [] },
    { along: 'z', at: 8.35, from: -4.6, to: -1.6, doors: [-3.1] },
  ],
  liftZ: 0,
  liftFloor: 2,
  floorLabel: 'Floor 12',
};

/**
 * **Floor 33, the ocean floor** — under the sea.
 *
 * Squarer than the garden, so the shoal of fish overhead has somewhere to
 * swim, and the shallowest wall in the hotel apart from the corridor: the
 * things worth seeing here are *above* the wall line, the way Floor 50's
 * clouds are.
 */
export const OCEAN_FLOOR: HotelRoom = {
  space: SPACE_HOTEL_OCEAN,
  theme: OCEAN_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_OCEAN_Z,
  // Grown from 10 (issue #281 — "it is fine to make the floor bigger"), the
  // same reasoning as the garden floor: real depth for the bathroom's own
  // doorway rather than a nook with no fourth wall. The gain lands on the
  // west side (the bathroom's own, plus the lift alcove which re-derives its
  // position from halfX for free) and the east (empty, unused).
  halfX: 11.4,
  halfZ: 8.5,
  wallHeight: 3.1,
  gaps: { west: [-1.6, 1.6] },
  // Round portholes are hung over these by `dressOcean` — the pane is the
  // window and the brass ring round it is dressing, one surface each, rather
  // than a second glowing mesh trying to line itself up with the first.
  windows: {
    north: { at: [-7, -2.4, 2.4, 7], width: 1.7, sill: 1.15, head: 2.55 },
    west: { at: [-5.4, 5.4], width: 1.7, sill: 1.15, head: 2.55 },
  },
  // The bathroom (issue #272/#281) — against the west wall, now a real
  // four-sided room: two horizontal partitions (the north one shifted from
  // the old nook's z = 1.6 to 2.0, clearing the outer wall's own lift gap,
  // `gaps.west` z ±1.6, by a clean 0.4 m rather than sitting flush on its
  // very edge the way the old two-wall nook silently did —
  // `buildBathroomWall` built its own collider straight into the
  // `CollisionWorld` and was never checked against the lift gap at all)
  // closed on the east (open) side by a third partition carrying the door.
  // The south wall sits at z = 6.8, not the old nook's 5.6 — `check:hotel`
  // and `check:tap-spacing` between them ruled out every position for the
  // pan closer to the door: too close to the door's own doorway band, too
  // close to the lift's boarding band, or (at exactly z = 6.0) close enough
  // to the wall's own face to shove a standing child sideways. There was
  // room to spare between the old nook's south wall and `halfZ` (8.5), so
  // the wall moved rather than the room.
  partitions: [
    { along: 'x', at: 2.0, from: -11.4, to: -7.6, doors: [] },
    { along: 'x', at: 6.8, from: -11.4, to: -7.6, doors: [] },
    { along: 'z', at: -7.6, from: 2.0, to: 6.8, doors: [4.0] },
  ],
  liftZ: 0,
  liftFloor: 3,
  floorLabel: 'Floor 33',
};

export const ROOMS: readonly HotelRoom[] = [
  LOBBY,
  BREAKFAST,
  GARDEN_FLOOR,
  OCEAN_FLOOR,
  CORRIDOR,
  SUITE,
];

/**
 * The walk-through trigger bands of every doorway in the hotel — **the** list,
 * in world metres.
 *
 * `Hotel.checkDoorways` and `Hotel.atLiftDoors` fire on exactly these
 * rectangles, and `scripts/check-tap-spacing.mts` holds every interact zone
 * clear of them (the tap-spacing rule, `world/tapSpacing.ts`). They were
 * inline comparisons in `checkDoorways` until 8 August 2026, which meant the
 * only way a check could know where the doors were was to copy the
 * arithmetic — the "two definitions of one thing" trap, resolved the usual
 * way: one owner, everyone else asks.
 */
export interface HotelDoorBand extends PortalBand {
  /**
   * `room-door` is an internal doorway between sub-rooms — no walk-through
   * trigger fires on it (`Hotel.checkDoorways` looks bands up by the kinds
   * that change space), it exists so `check:tap-spacing` holds every zone a
   * finger clear of it: a doorway a zone's pick area covers is a doorway a
   * phone cannot use, which is the exact bug the tap rule was written for.
   */
  readonly kind:
    | 'exit'
    | 'suite-door'
    | 'suite-portal'
    | 'corridor-door'
    | 'lift'
    | 'room-door';
}

export function hotelDoorBands(room: HotelRoom): HotelDoorBand[] {
  const bands: HotelDoorBand[] = [];
  if (room === LOBBY) {
    // The front door out to the park: the south wall's gap, 0.6 m deep.
    bands.push({
      kind: 'exit',
      what: "the lobby's front door",
      centreX: room.originX,
      centreZ: room.originZ + room.halfZ,
      halfAlong: 0.6,
      halfAcross: DOOR_HALF + 0.4,
      yaw: 0,
      y: 0,
    });
    // The foyer/hall doorway — straight off the partition data (see
    // {@link LOBBY_HALL_Z}) so the two can never disagree, exactly the
    // suite's own bathroom-doorway derivation below. `yaw: 0` because this
    // wall runs along X (an `along: 'x'` run), the same orientation as the
    // front door above, not the suite's `Math.PI / 2` internal walls.
    for (const run of room.partitions ?? []) {
      if (run.along !== 'x') continue;
      for (const door of run.doors) {
        bands.push({
          kind: 'room-door',
          what: "the lobby's doorway through to the stairs and lifts",
          centreX: room.originX + door,
          centreZ: room.originZ + run.at,
          halfAlong: 0.6,
          halfAcross: SUITE_DOOR_WIDTH / 2 + 0.4,
          yaw: 0,
          y: 0,
        });
      }
    }
  }
  if (room === CORRIDOR) {
    // The "yours" door into the suite, as **two** rectangles, because the
    // door does two different things at two different distances and the
    // depths are not a detail somebody should re-derive in `checkDoorways`:
    //
    //  * `suite-door` is the refusal envelope — a keyless child is turned
    //    away from 1.6 m out, because `Hotel`'s lock wall stops her at
    //    `halfX − 0.92` and a refusal she cannot reach is a mute wall;
    //  * `suite-portal` is the doorway itself, the 0.6 m either side of the
    //    wall plane that she actually steps *through* once she has the key —
    //    the same depth every other portal in the hotel uses.
    //
    // Both carry `ownZoneId`, because the "yours" sign is this door's own
    // handle and may sit on it. The portal is a strict subset of the
    // refusal envelope, so the tap-spacing rule sees no new keep-out.
    bands.push({
      kind: 'suite-door',
      what: 'the suite door',
      centreX: room.originX + room.halfX - 0.5,
      centreZ: room.originZ,
      halfAlong: 1.1,
      halfAcross: 1.5,
      yaw: Math.PI / 2,
      y: 0,
      ownZoneId: 'hotel-yours-door',
    });
    bands.push({
      kind: 'suite-portal',
      what: "the suite door's own threshold",
      centreX: room.originX + room.halfX,
      centreZ: room.originZ,
      halfAlong: 0.6,
      halfAcross: 1.5,
      yaw: Math.PI / 2,
      y: 0,
      ownZoneId: 'hotel-yours-door',
    });
  }
  if (room === SUITE) {
    bands.push({
      kind: 'corridor-door',
      what: "the suite's door back to the corridor",
      centreX: room.originX - room.halfX,
      centreZ: room.originZ,
      halfAlong: 0.6,
      halfAcross: 1.5,
      yaw: Math.PI / 2,
      y: 0,
    });
  }
  // Every partitioned room's own bathroom doorway, straight off the
  // partition data so the two can never disagree — the suite's bathroom
  // originally (issue #278), and now every guest floor's own-room bathroom
  // too (issue #281: "a new room adjoining the existing floorplan"). Only
  // the doored **z-runs** are banded. For the suite specifically that also
  // means the x-runs' bedroom doorways stay unbanded: measured once, and
  // banding them trips the bed zones by 0.03 m — the beds and their signs
  // would all have to shuffle, which is a reform for its own PR, not a rider
  // on this one. The four floor bathrooms have no x-run doors at all (their
  // "north"/"south" walls are solid, no-door runs), so this loop bands
  // exactly one doorway per floor, same as it always banded exactly one for
  // the suite.
  for (const run of room.partitions ?? []) {
    if (run.along !== 'z') continue;
    for (const door of run.doors) {
      bands.push({
        kind: 'room-door',
        what: `${room.floorLabel}'s bathroom doorway`,
        centreX: room.originX + run.at,
        centreZ: room.originZ + door,
        halfAlong: 0.6,
        halfAcross: SUITE_DOOR_WIDTH / 2 + 0.4,
        yaw: Math.PI / 2,
        y: 0,
      });
    }
  }
  if (room.liftZ !== null) {
    // The lift's auto-boarding band: the alcove and the floor in front of it.
    bands.push({
      kind: 'lift',
      what: `${room.floorLabel}'s lift alcove`,
      centreX: room.originX - room.halfX,
      centreZ: room.originZ + room.liftZ,
      halfAlong: LIFT_ALCOVE_DEPTH,
      halfAcross: 2.6,
      yaw: Math.PI / 2,
      y: 0,
    });
  }
  return bands;
}

export function roomFor(space: SpaceId): HotelRoom | null {
  return ROOMS.find((room) => room.space === space) ?? null;
}

/**
 * The lift's floor list, bottom to top. Fifty storeys in the fiction; the
 * **five** a child can press. "Yours" on the top button is Eleri's own spec:
 * *"it says 'yours' ... on the lift button for your floor"*.
 *
 * `storey` is the number the lift's indicator counts through on the way, and
 * it is **British**: the ground floor is 0, so breakfast on Floor 1 is one
 * above it and the suite is still fifty up. Nothing but the indicator reads
 * these numbers — the rooms themselves are `room`, and the buttons are
 * `glyph` — which is exactly why renumbering the hotel is a data edit.
 *
 * **Every button on this panel is always pressable**, floor 50 included. It
 * used to refuse without the key, which meant a child who had walked past
 * reception met a dead button and no explanation. Jim, 7 August 2026: *"go to
 * level 50 before you have your key but not through the door to the room."*
 * The lift is now transport and the **suite door** is the lock — see
 * `Hotel.checkDoorways`, which turns her away at the door itself, where the
 * sign that tells her what to do next is standing.
 *
 * `liftFloor` on a room is an **index into this array**, so inserting a floor
 * here means fixing the indexes there. They are written out on each room
 * rather than derived so that a room can share a button with another (the
 * suite and its corridor both answer to ★).
 */
export const HOTEL_FLOORS: readonly {
  readonly name: string;
  readonly glyph: string;
  readonly storey: number;
  readonly room: HotelRoom;
}[] = [
  { name: 'Lobby', glyph: 'G', storey: 0, room: LOBBY },
  { name: 'Breakfast · Floor 1', glyph: '1', storey: 1, room: BREAKFAST },
  { name: 'Garden · Floor 12', glyph: '12', storey: 12, room: GARDEN_FLOOR },
  { name: 'Ocean · Floor 33', glyph: '33', storey: 33, room: OCEAN_FLOOR },
  { name: 'Yours! · Floor 50', glyph: '★', storey: 50, room: CORRIDOR },
];
