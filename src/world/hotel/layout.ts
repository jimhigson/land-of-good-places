import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_GARDEN_Z,
  HOTEL_LOBBY_Z,
  HOTEL_OCEAN_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
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
const STAIR_ARC_Z = -2.5;

export const LOBBY: HotelRoom = {
  space: SPACE_HOTEL_LOBBY,
  theme: LOBBY_THEME,
  originX: HOTEL_ORIGIN_X,
  originZ: HOTEL_LOBBY_Z,
  halfX: 13,
  // Deepened from 10 by exactly the gallery's own 4.8 m, so the open floor of
  // the lobby is the room it always was and the mezzanine is *added* space
  // rather than space taken off a child.
  halfZ: 12.4,
  // The imperial composition stands 5.44 m to the gallery and a child on it
  // wants `ARCH_CLEAR` of air over her head, so the two far walls rise to
  // 8.9 — over the asset's `LOBBY_MIN_WALL_HEIGHT` (8.81), which
  // `assertStairMatches` enforces. Only the two far walls are this tall; see
  // `nearWallHeight` for why the two the camera looks through are not.
  wallHeight: 8.9,
  nearWallHeight: 3.4,
  // South: the front door back out to the park. West: the lift.
  gaps: { south: [-DOOR_HALF, DOOR_HALF], west: [-1.6, 1.6] },
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
    west: { at: [-6.6, 3.2, 9.6], width: 1.8, sill: 1.2, head: 3.6, zoneAt: -6.6 },
  },
  // The imperial plan — see {@link Mezzanine} for what each piece is, and
  // HANDOFF-lobby-art.md for where every number comes from. The derivations,
  // for the reader (assertStairMatches proves them):
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
    minZ: -12.4,
    maxZ: -7.6,
    height: LOBBY_MEZZANINE_Y,
    landing: {
      minX: -4.93,
      maxX: 4.93,
      minZ: -7.6,
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
      frontZ: -5.008,
      walkWidth: 3.6,
      flankX: 2.01,
      treads: 5,
      rise: LOBBY_MEZZANINE_Y - LOBBY_LANDING_Y,
    },
  },
  liftZ: 0,
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
  halfX: 12,
  halfZ: 9,
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
export const SUITE_BED_SPOTS: readonly (readonly [number, number])[] = [
  [-6.9, -5.2],
  [-0.4, -5.2],
  [7.2, -5.2],
];

/** Where the bedside tables stand — beside each bed, same reasoning as above. */
export const SUITE_BEDSIDE_X: readonly number[] = [-5.4, 1.1, 8.7];
export const SUITE_BEDSIDE_Z = -5.2;

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
  // Grown from 8 × 6 to hold four rooms. The far corner is 13.6 m from the
  // origin, well inside `HOTEL_PLAY_RADIUS`'s 24 m.
  halfX: 11,
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
    { along: 'x', at: -1.7, from: -11, to: 11, doors: [-6.6, 0, 6.6] },
    { along: 'x', at: 1.7, from: -11, to: 11, doors: [4.4] },
    { along: 'z', at: -4.2, from: -8, to: -1.7, doors: [] },
    { along: 'z', at: 3.4, from: -8, to: -1.7, doors: [] },
    // The bathroom's own wall — the south half's answer to the bedroom
    // divider at the same x, so the plan reads as one grid. **Its doorway
    // opens off the lounge, not the hall** — an en-suite off the living
    // room — because a hall-side door boxed the pan into corners the fixed
    // camera cannot see (a 2.2 m partition hides 2.8 m of floor behind it)
    // or into the door band's own finger of tap clearance; watched in the
    // browser, not guessed. The door's north jamb lands exactly on the hall
    // wall's line, so the run's built span is one clean piece from jamb to
    // south wall.
    { along: 'z', at: -4.2, from: 1.7, to: 8, doors: [2.9] },
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
    // stand spot is blocked (the pet's four-poster lives in that bedroom), so
    // the default picker slid to the first bedroom's pane — 3.04 m from the
    // west wall's painting, inside the tap rule's finger.
    north: { at: [-9.5, -2.9, 9.7], width: 2.2, sill: 1.5, head: 2.6, zoneAt: 9.7 },
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
  halfX: 11,
  halfZ: 8,
  wallHeight: 3.2,
  gaps: { west: [-1.6, 1.6] },
  windows: {
    north: { at: [-8.4, -4.2, 0, 4.2, 8.4], width: 2.4, sill: 1.1, head: 2.75 },
    west: { at: [-5.6, 5.6], width: 1.6, sill: 1.1, head: 2.6 },
  },
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
  halfX: 10,
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
   * trigger fires on it (`Hotel.checkDoorways` looks bands up by the other
   * four kinds), it exists so `check:tap-spacing` holds every zone a finger
   * clear of it: a doorway a zone's pick area covers is a doorway a phone
   * cannot use, which is the exact bug the tap rule was written for.
   */
  readonly kind: 'exit' | 'suite-door' | 'corridor-door' | 'lift' | 'room-door';
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
  }
  if (room === CORRIDOR) {
    // The "yours" door into the suite. The outer envelope is the refusal
    // band (checkDoorways turns a keyless child away from 1.6 m out); the
    // step-through itself needs the innermost 0.6 m. Its own sign zone is
    // the door's handle and may cover it.
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
    // The bathroom's doorway, straight off the partition data so the two can
    // never disagree. Only the doored **z-runs** are banded (today: exactly
    // the bathroom door). Banding the x-runs' bedroom doorways too was
    // measured, and trips the bed zones by 0.03 m — the beds and their signs
    // would all have to shuffle, which is a reform for its own PR, not a
    // rider on this one.
    for (const run of room.partitions ?? []) {
      if (run.along !== 'z') continue;
      for (const door of run.doors) {
        bands.push({
          kind: 'room-door',
          what: "the suite bathroom's doorway",
          centreX: room.originX + run.at,
          centreZ: room.originZ + door,
          halfAlong: 0.6,
          halfAcross: SUITE_DOOR_WIDTH / 2 + 0.4,
          yaw: Math.PI / 2,
          y: 0,
        });
      }
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
