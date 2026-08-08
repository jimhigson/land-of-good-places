import type { Object3D } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { NPC_RADIUS } from '../../core/constants';
import { Rng } from '../../core/mathUtils';
import { KID_SKIN_TONES } from '../../art/models/kid';
import { createPet, type PetKind } from '../../art/models/pets';
import { CharacterModel } from '../../entities/CharacterModel';
import {
  characterModelAvatar,
  creatureAvatar,
  type ResidentSpec,
  type Waypoint,
} from '../../entities/npc';
import { BREAKFAST, CORRIDOR, LOBBY, type HotelRoom } from './layout';
import type { RoomKeepOut } from './place';

/**
 * Other people, staying at the hotel.
 *
 * Jim, having played it: *"people should be walking around the hotel so it
 * feels alive at all times."* Four children and three pets, each of whom
 * belongs to exactly one room and strolls between a handful of seeded
 * waypoints inside it, forever.
 *
 * ## They are park NPCs. Not *like* park NPCs — the same ones.
 *
 * This file used to carry its own little movement layer: its own arrival
 * radius, its own turn rate, its own walk phase, its own blink clock, its own
 * idea of what a body was. Jim, having played it: *"even other children can be
 * walked through even though in the park NPCs are solid — they should be the
 * same code."* They are, now, and all of that is gone.
 *
 * What is left here is the two things that genuinely belong to a hotel: **who
 * stays where**, and **where standing about is sensible**. Everything else —
 * the body, the walk cycle, collision, the ground under their feet, the
 * push-apart from the player and from each other — is `NpcCharacter` and
 * `NpcSystem`, byte for byte the same code that moves the twelve children in
 * the park. A guest is handed over as a {@link ResidentSpec}; see that type
 * for the split.
 *
 * The one thing that *cannot* be shared is the decision layer, and that is
 * exactly the seam `entities/npc/driver.ts` exists to cut along. Every hotel
 * room is **its own disjoint space** at its own far-off origin (`layout.ts`),
 * joined only by portals, so a guest has nowhere to walk *to* — there is no
 * graph to search because there are no edges, and importing the park's
 * `poiGraph` would be machinery for a question that cannot be asked. A guest
 * is driven by a `WaypointDriver` round a circuit instead.
 *
 * ## Two rules the waypoints obey
 *
 * 1. **They never stand anywhere you need to be.** Waypoints are rejected
 *    against the keep-out discs `place.ts` registered as it put each piece of
 *    furniture down — the *same* footprints that made that furniture solid,
 *    which is what stops the two ever disagreeing — plus the lift alcove and
 *    every doorway, worked out here from the room's own `gaps` rather than
 *    listed by hand.
 * 2. **Seeded, never `Math.random`.** One `Rng` per guest, seeded from its own
 *    index, so guest 3's stroll cannot shift because guest 2 gained a
 *    waypoint. The hotel looks the same on every reload, and — because these
 *    are their own streams, salted away from `NPC_SEED` — the park's own
 *    twelve children are not moved a millimetre by anything in this file.
 *
 * ## The cost, and the one thing to watch
 *
 * A guest child is a {@link CharacterModel}: the same individually-rendered
 * model the player wears, and the same one `NpcSystem` already builds for a
 * pinned kid whose look needs a hat. It paints its own five expression
 * canvases, so four children is twenty — which is why there are four rather
 * than a dozen, and why every other guest here is a pet: `createPet` goes
 * through `sharedFacePatch`, so pets three through thirty would cost no
 * textures at all.
 */

/** How far from a wall a waypoint may be. */
const WALL_INSET = 1.9;

/** Waypoints per guest. Four is a circuit; two is pacing. */
const WAYPOINTS = 4;

/**
 * Fraction of the house walking pace a guest strolls at.
 *
 * A hotel is somewhere people amble; the park is somewhere children run. Half
 * pace is the difference, and it comes out of the same `CharacterIntent` the
 * park's own crowd fills in, so there is no second speed constant anywhere.
 */
const GUEST_PACE = 0.45;

/** …and a pet's legs are shorter still. */
const PET_PACE = 0.33;

/** Who stays where. Kids are expensive (see the header); pets are not. */
interface GuestPlan {
  readonly room: HotelRoom;
  readonly kids: number;
  readonly pets: readonly PetKind[];
}

/**
 * The roster.
 *
 * The suite is deliberately empty: it is *yours*, the door says so, and a
 * stranger padding about in your bedroom is the one place "the hotel feels
 * lived in" turns into "somebody is in my room".
 */
const ROSTER: readonly GuestPlan[] = [
  { room: LOBBY, kids: 2, pets: ['bunny'] },
  { room: BREAKFAST, kids: 2, pets: ['kitten'] },
  // Floor 50's corridor is a gallery of pet statues; the one live pet padding
  // between them is the joke, and it costs no canvases to tell.
  { room: CORRIDOR, kids: 0, pets: ['mouse'] },
];

/**
 * Names for the guests.
 *
 * Nobody sees one today — a resident deliberately gets no name pill (see
 * `ResidentSpec`), because a pill is park furniture capped to the ten nearest
 * and a room with three people in it does not want one. `NpcCharacter` asks
 * for a name regardless, and "guest-2" in a debugger is worth less than
 * "Suki" for the sake of one line.
 */
const GUEST_NAMES: readonly string[] = ['Suki', 'Otto', 'Nell', 'Bram', 'Pip', 'Moss', 'Wisp'];

/** Outfit colours, all from the world's own marker set. */
const OUTFITS: readonly number[] = [
  PALETTE.markerSky,
  PALETTE.markerMint,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  PALETTE.flowerRed,
  PALETTE.blossomPink,
];

const HAIRS: readonly number[] = [ART.kidHair, ART.kidHairBlonde, PALETTE.bark, PALETTE.barkDark];

/**
 * Hair a guest may wear.
 *
 * No ponytail: those styles carry a **world-space** simulated chain
 * (`KidHandle.resetHair`'s doc comment), which then wants driving every frame
 * and resetting on every re-parent. A background guest is not worth a second
 * thing that can go visibly wrong, and none of these styles has one.
 */
const HAIR_STYLES = ['bunches', 'bob', 'short', 'bowl', 'spiky'] as const;

/**
 * Builds the hotel's guests, ready to hand to `NpcSystem`.
 *
 * @param parent  the node every guest's model is added to. Must be a node with
 *   an **identity transform** — `Hotel.hotelRoot` — because an `NpcCharacter`
 *   writes world-space positions straight onto its model's root, and a parent
 *   with an offset would apply that offset twice. It is also what makes the
 *   guests appear and vanish with the hotel itself.
 * @param keepOuts  every footprint `place.ts` registered while the rooms were
 *   dressed. Must therefore be called **after** they are.
 */
export function hotelResidents(
  parent: Object3D,
  keepOuts: readonly RoomKeepOut[],
): ResidentSpec[] {
  const residents: ResidentSpec[] = [];
  let index = 0;

  for (const plan of ROSTER) {
    const blocked = [
      ...keepOuts.filter((k) => k.room === plan.room),
      ...wayThroughKeepOuts(plan.room),
    ];

    for (let i = 0; i < plan.kids; i += 1) {
      index += 1;
      const seed = 0x6035 + index * 977;
      const rng = new Rng(seed);
      // Drawn in this order, one statement each, because the order is the
      // guest: swap two of these lines and every child in the hotel is wearing
      // somebody else's clothes.
      const skin =
        (KID_SKIN_TONES[rng.int(0, KID_SKIN_TONES.length - 1)] ?? KID_SKIN_TONES[1])!.colour;
      const hair = rng.pick(HAIRS);
      const outfit = rng.pick(OUTFITS);
      const model = new CharacterModel(
        {
          skin,
          hair,
          outfit,
          // A guest's arms match their shirt — the plain, single-colour look
          // `createKid` gave these children before `CharacterModel` (which asks
          // for both) took over building them.
          outfitArms: outfit,
          shoe: PALETTE.shoe,
        },
        {
          hairStyle: rng.pick(HAIR_STYLES),
          backpack: rng.chance(0.5),
          backpackColour: rng.pick(OUTFITS),
        },
      );
      parent.add(model.root);
      residents.push({
        name: GUEST_NAMES[(index - 1) % GUEST_NAMES.length] ?? 'Guest',
        avatar: characterModelAvatar(model),
        waypoints: wanderPoints(plan.room, blocked, rng),
        seed,
        pace: GUEST_PACE,
      });
    }

    for (const kind of plan.pets) {
      index += 1;
      const seed = 0x6035 + index * 977;
      const rng = new Rng(seed);
      const pet = createPet(kind);
      parent.add(pet.root);
      residents.push({
        name: GUEST_NAMES[(index - 1) % GUEST_NAMES.length] ?? 'Pet',
        avatar: creatureAvatar(pet),
        waypoints: wanderPoints(plan.room, blocked, rng),
        seed,
        pace: PET_PACE,
      });
    }
  }

  return residents;
}

// ----------------------------------------------------------------- helpers

/**
 * The doorways and the lift alcove, as keep-out discs.
 *
 * Derived from the room's own `gaps` and `liftZ` rather than written down
 * again beside them: a gap that moves takes its keep-out with it, and the
 * failure this prevents — a guest standing in the lift doors — is one a child
 * would find long before a check would.
 */
function wayThroughKeepOuts(room: HotelRoom): RoomKeepOut[] {
  const blocked: RoomKeepOut[] = [];
  const push = (x: number, z: number, radius: number): void => {
    blocked.push({ room, x, z, radius });
  };

  for (const side of ['north', 'south', 'east', 'west'] as const) {
    const gap = room.gaps[side];
    if (!gap) continue;
    const mid = (gap[0] + gap[1]) / 2;
    if (side === 'north') push(mid, -room.halfZ + 1.8, 2.9);
    else if (side === 'south') push(mid, room.halfZ - 1.8, 2.9);
    else if (side === 'west') push(-room.halfX + 1.8, mid, 2.9);
    else push(room.halfX - 1.8, mid, 2.9);
  }

  // The alcove itself is outside the room rectangle, so no waypoint can land
  // in it; this is the apron in front of its mouth, where somebody standing
  // would be somebody you have to walk round to press the button.
  if (room.liftZ !== null) push(-room.halfX + 2.4, room.liftZ, 3.2);
  return blocked;
}

/**
 * A little circuit of places to stand, inside one room, in **world** metres.
 *
 * Rejection sampling with a per-guest `Rng`, in **two passes with different
 * spacing but the same keep-outs**. That split is the load-bearing part:
 *
 *  - the keep-outs are a *correctness* rule — a waypoint inside a table is a
 *    guest walking into a table forever, and now that the table is genuinely
 *    solid it is a guest leaning on one forever — and are never relaxed, in
 *    either pass, which is CLAUDE.md's "never weaken an assertion to make
 *    something pass" applied to placement;
 *  - the 3.2 m spacing is only *taste*: it stops a circuit being a shuffle.
 *    Floor 50's corridor is 8 m deep with four plinths and two doorways in it,
 *    and at 3.2 m apart there is genuinely room for about two points — so a
 *    second pass at 1.6 m tops the circuit up rather than leaving a guest
 *    rooted to one spot, which is exactly the thing Jim asked to fix.
 *
 * The clearance is the *game's* `NPC_RADIUS`, the same girth the body is
 * actually resolved against, rather than a number of this file's own: a
 * waypoint a guest's own collider cannot reach is a leg that times out for
 * ever.
 */
function wanderPoints(room: HotelRoom, blocked: readonly RoomKeepOut[], rng: Rng): Waypoint[] {
  const points: Waypoint[] = [];
  const minX = -room.halfX + WALL_INSET;
  const maxX = room.halfX - WALL_INSET;
  const minZ = -room.halfZ + WALL_INSET;
  const maxZ = room.halfZ - WALL_INSET;

  const sample = (separation: number): void => {
    for (let attempt = 0; attempt < 400 && points.length < WAYPOINTS; attempt += 1) {
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      if (blocked.some((k) => Math.hypot(x - k.x, z - k.z) < k.radius + NPC_RADIUS)) continue;
      if (points.some((p) => Math.hypot(x - (p.x - room.originX), z - (p.z - room.originZ)) < separation))
        continue;
      points.push({ x: room.originX + x, z: room.originZ + z });
    }
  };
  sample(3.2);
  if (points.length < 3) sample(1.6);

  // A room so full that nowhere is free would leave a guest with no home at
  // all; one point in the middle is a guest standing about, which still reads
  // as somebody being there.
  if (points.length === 0) points.push({ x: room.originX, z: room.originZ });
  return points;
}
