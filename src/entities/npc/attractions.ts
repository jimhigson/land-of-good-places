import { ANCHORS } from '../../world/anchors';
import { STALLS } from '../../minigames/stalls';
import { STALL_STANDS_BY_ID } from '../../minigames/stallPlacement';
import type { ShopStand } from '../../world/building/shops/Shops';
import { SPACE_GARDEN, spaceAt, type SpaceId } from '../../world/spaces';
import { portalToward, type Portal } from './portals';
import type { GroundSampler } from '../Player';
import { TOP_REFERENCE } from '../../world/NavGrid';

/**
 * The places a child in this park would actually want to go.
 *
 * Issue #350. The crowd used to have no destinations at all — `WanderDriver`
 * walked a non-backtracking random walk on `PoiGraph`, one edge at a time, so
 * the question "where is that child going?" had no answer. A random walk is
 * diffusive, so its occupancy settles on whichever region has the highest
 * degree and the longest dwell, and in this park that is the plaza: six
 * mutually-visible ring nodes, every one of them `interesting` and so worth a
 * 0.62-chance pause. Hence Jim's report — "on entering the park, all the NPCs
 * gather in one place quite soon".
 *
 * The fix he asked for is the obvious one: **give every child somewhere to be**,
 * chosen at random from the attractions, walked to on the player's own
 * pathfinding, and re-chosen on arrival.
 *
 * ## Nothing here is a list
 *
 * Three things in this park already know where the attractions are and what
 * they are called, and this file is not allowed to become a fourth. Each entry
 * below is *joined* from an existing owner, never retyped:
 *
 * | Where | Owner | Name from | Position from |
 * | --- | --- | --- | --- |
 * | Rides and plots | `world/anchors.ts` `ANCHORS` | `signTitle` | `entrance` |
 * | Stalls | `minigames/stalls.ts` `STALLS` | `title` | `STALL_STANDS_BY_ID` |
 * | Inside the castle | `building/shops/Shops.ts` `stands` | `title` | `x, z, y` |
 *
 * The anchor's `signTitle` is deliberately the name a child says out loud: it
 * is the words painted on the sign they are walking towards, so "I'm going to
 * the Space Ferris Wheel" and the sign at the end of the walk agree by
 * construction rather than because somebody kept two strings in step.
 *
 * The stalls are the one join that needs doing here, and only because the
 * ownership is genuinely split: `STALL_STANDS` (in `stallPlacement.ts`, the
 * data-only module) derives *where a child stands to be served* from the
 * booth's position and facing, and carries no display name; the names live in
 * `stalls.ts` on `StallDefinition.title` — 'Dodgems!', 'Water Fight!' — because
 * that is where the booth's copy lives. Joining them by id is cheaper and far
 * safer than moving either.
 *
 * `Shops.stands` needs no join at all: it has already done exactly this work
 * for the shopkeepers, converting `SHOP_UNITS`' deck-local `x, z` to world
 * coordinates and standing the child `SHOP_STAND_Z` clear of the counter, with
 * `y` set to the deck's own height. Asking it is the whole of the castle case.
 *
 * ## Why `y` is not optional
 *
 * `NavGrid.findRoute` takes a `goalY` because a lattice cell can have several
 * levels and two taps at the same `x, z` on different floors are different
 * destinations. The castle's shops are on decks 0, 1 and 2, so a destination
 * that did not say which deck it meant would send a child to whichever level
 * happened to be nearest the ground. Outdoors the answer is the terrain, which
 * is why the garden entries sample it rather than assuming zero — the park has
 * hills, and a bridge deck over the railway is a second level in its own right.
 */
export interface Attraction {
  /** Stable id, for logs and checks. Not shown to anybody. */
  readonly id: string;
  /**
   * What a child calls it out loud — "I'm going to the {@link name}".
   *
   * Straight from the sign, the booth or the shop board, so the words in the
   * bubble are the words at the destination.
   */
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** Which level. See the file comment — the castle is three decks of shops. */
  readonly y: number;
  /**
   * Does this name take "the" in front of it? See {@link NO_ARTICLE}.
   *
   * Data rather than a rule, because **English article choice is not derivable
   * from the spelling** and the first attempt at deriving it shipped a bug:
   * a `/s$/` test gave "I'm going to Candy Floss" correctly and "I'm going to
   * the Ice Cream" incorrectly, and the two strings look alike. A field the
   * joins below fill in is checkable; a regex over a display name is a guess
   * that reads fine in eighteen cases and wrong in the nineteenth.
   */
  readonly articled: boolean;
  /** Derived from the coordinates, never authored — same rule as `PoiNode`. */
  readonly space: SpaceId;
}

/**
 * The attractions whose names take **no** "the", by id.
 *
 * Ids rather than names, because an id is a stable key and a sign's wording is
 * not. Three kinds of name end up here and they are all ordinary English:
 *
 * - **plurals** — "Dodgems", "Stickers & Pets", "Surprise Eggs";
 * - **mass nouns** — "Ice Cream", "Candy Floss". You go to Ice Cream the way
 *   you go to Lunch, not the way you go to the Ball Pit.
 *
 * Names that already begin with "The" — "The Castle", "The Land Hotel", "The
 * Spooky House", "The Rail Race!" — are **not** listed here: they are handled
 * by {@link announcementFor}, because that fact *is* visible in the string and
 * so does not need saying twice.
 *
 * A new attraction defaults to taking "the", which is right far more often
 * than not. `scripts/check-npc-dispersal.mts` prints every attraction's finished
 * line in its report and fails on a doubled article, so a new name that reads
 * wrong is seen rather than shipped.
 */
const NO_ARTICLE: ReadonlySet<string> = new Set([
  'anchor:dodgems',
  'stall:dodgems',
  'shop:iceCream',
  'shop:candyFloss',
  'shop:stickerPet',
  'shop:surpriseEgg',
]);

/** True when `id`'s name reads naturally with "the" in front of it. */
function articledFor(id: string): boolean {
  return !NO_ARTICLE.has(id);
}

/**
 * "I'm going to the Ball Pit" / "I'm going to Dodgems" / "I'm going to The
 * Castle" — Jim's line, with exactly one article.
 *
 * Half the park's signs are already articled, so pasting the template straight
 * on gave "I'm going to the The Castle", which the browser QA pass caught on
 * screen. The names are not the place to fix that: "The Castle" is what is
 * painted on the sign, and the sign is right. The sentence bends instead.
 */
export function announcementFor(attraction: Attraction): string {
  if (/^the\s/i.test(attraction.name)) return `I'm going to ${attraction.name}`;
  return attraction.articled
    ? `I'm going to the ${attraction.name}`
    : `I'm going to ${attraction.name}`;
}

/**
 * Everywhere outdoors worth walking to: every anchor's entrance, every stall's
 * stand.
 *
 * `sample` is the game's own ground sampler (`WalkSurfaces.sample`), asked from
 * {@link TOP_REFERENCE} down so it answers with the top surface at that point —
 * the same convention `NavGrid` builds its lattice with.
 */
export function gardenAttractions(sample: GroundSampler): Attraction[] {
  const attractions: Attraction[] = [];

  for (const anchor of ANCHORS) {
    const x = anchor.entrance[0];
    const z = anchor.entrance[1];
    const id = `anchor:${anchor.id}`;
    attractions.push({
      id,
      name: anchor.signTitle,
      x,
      z,
      y: sample(x, z, TOP_REFERENCE),
      space: spaceAt(x, z),
      articled: articledFor(id),
    });
  }

  for (const stall of STALLS) {
    // The join the file comment describes: the name is the booth's, the spot is
    // the stand's. A stall whose placement has gone missing is skipped rather
    // than sent a child to (0, 0).
    const stand = STALL_STANDS_BY_ID.get(stall.id);
    if (!stand) continue;
    const id = `stall:${stall.id}`;
    attractions.push({
      id,
      name: stall.title,
      x: stand.x,
      z: stand.z,
      y: sample(stand.x, stand.z, TOP_REFERENCE),
      space: spaceAt(stand.x, stand.z),
      articled: articledFor(id),
    });
  }

  return attractions;
}

/**
 * Everywhere inside the castle worth walking to — the seven shops, on their
 * own decks.
 *
 * Jim asked for these explicitly: "This can include things inside the castle."
 * `Shops` has already done every part of the conversion (see the file comment),
 * so this is a rename and nothing else.
 */
export function castleAttractions(stands: readonly ShopStand[]): Attraction[] {
  return stands.map((stand) => ({
    id: `shop:${stand.id}`,
    name: stand.title,
    x: stand.x,
    z: stand.z,
    y: stand.y,
    space: spaceAt(stand.x, stand.z),
    articled: articledFor(`shop:${stand.id}`),
  }));
}

/**
 * True if a child standing in `space` may choose `attraction` as their next
 * destination.
 *
 * Somewhere in this space, or somewhere one **portal** away — see
 * `portals.ts`. Getting between spaces is a step through a door, never a walk
 * across the six hundred metres of empty world that separates their
 * coordinates; `poiGraph.ts` says the same about its own edges.
 *
 * This used to be same-space-only, and that was the bug: it made every castle
 * destination unreachable for every child in the game, because children spawn
 * only on garden waypoints. Jim asked for the castle by name.
 */
export function reachableFrom(
  space: SpaceId,
  attraction: Attraction,
  portals: readonly Portal[] = [],
): boolean {
  if (attraction.space === space) return true;
  return portalToward(portals, space, attraction.space) !== null;
}

/** True for the garden — the space the park's own crowd lives in. */
export function isGarden(space: SpaceId): boolean {
  return space === SPACE_GARDEN;
}
