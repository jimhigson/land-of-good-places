import type { Group } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng } from '../../core/mathUtils';
import { createKid, KID_SKIN_TONES } from '../../art/models/kid';
import { createPet, type PetKind } from '../../art/models/pets';
import type { CreatureHandle } from '../../art/style/asset';
import { BREAKFAST, CORRIDOR, LOBBY, type HotelRoom } from './layout';
import type { RoomKeepOut } from './Hotel';

/**
 * Other people, staying at the hotel.
 *
 * Jim, having played it: *"people should be walking around the hotel so it
 * feels alive at all times."* Four children and three pets, each of whom
 * belongs to exactly one room and strolls between a handful of seeded
 * waypoints inside it, forever.
 *
 * ## Why there is no pathfinding here, and why that is not a shortcut
 *
 * Every hotel room is **its own disjoint space** at its own far-off origin
 * (`hotel/layout.ts`), joined only by portals. A guest therefore has nowhere
 * to walk *to* outside its own room — there is no graph to search, because
 * there are no edges. What is left is the honest whole problem: pick some
 * points in a rectangle that are not inside the furniture, and walk between
 * them. The park's `poiGraph` exists because the park is one connected place;
 * importing it here would be machinery for a question that cannot be asked.
 *
 * ## Three rules these guests obey
 *
 * 1. **They are ambience, not obstacles.** Nothing here touches
 *    `CollisionWorld`. A six-year-old chasing across the lobby should not be
 *    stopped by a stranger, and the park's own NPC crowd is soft for exactly
 *    the same reason. The cost of walking through someone is a moment's
 *    oddness; the cost of being wedged in a corner by one is the game.
 * 2. **They never stand anywhere you need to be.** Waypoints are rejected
 *    against the keep-out discs the room's own dressing code registered as it
 *    placed each piece of furniture (`Hotel.blockLocal`), plus the lift alcove
 *    and every doorway, worked out here from the room's own `gaps` rather than
 *    listed by hand — a hand-kept copy of the floor plan is the bug this
 *    project files most often.
 * 3. **Seeded, never `Math.random`.** One `Rng` per guest, seeded from its own
 *    index, so guest 3's stroll cannot shift because guest 2 gained a
 *    waypoint. The hotel looks the same on every reload.
 *
 * ## The cost, and the one thing to watch
 *
 * `createKid` paints its own five expression canvases per child (it is a hero
 * factory — the park's background crowd shares one prototype instead, see
 * `entities/npc/kidCrowd.ts`). Four children is therefore twenty canvases, and
 * that is why there are four rather than a dozen, and why every other guest
 * here is a pet: `createPet` goes through `sharedFacePatch`, so pets three
 * through thirty would cost no textures at all.
 */

/** How close counts as arrived. */
const ARRIVED = 0.28;

/** Radians per second a guest turns to face where it is going. */
const TURN_RATE = 3.4;

/** Body radius, for keeping a guest's *edge* out of the furniture. */
const GUEST_RADIUS = 0.55;

/** How far from a wall a waypoint may be. */
const WALL_INSET = 1.9;

/** Waypoints per guest. Four is a circuit; two is pacing. */
const WAYPOINTS = 4;

/** How long a guest dawdles on arriving somewhere. */
const PAUSE_RANGE: readonly [number, number] = [0.7, 2.9];

/** Seconds between blinks, and how long one lasts. */
const BLINK_EVERY = 4.6;
const BLINK_FOR = 0.16;

interface Point {
  readonly x: number;
  readonly z: number;
}

interface Guest {
  readonly handle: CreatureHandle;
  readonly root: Group;
  readonly rng: Rng;
  readonly points: readonly Point[];
  /** Metres per second, and metres per stride — a pet's legs are shorter. */
  readonly speed: number;
  readonly stride: number;
  /** Where in the blink cycle this one is, so seven guests do not blink together. */
  readonly blinkOffset: number;
  target: number;
  x: number;
  z: number;
  yaw: number;
  phase: number;
  pause: number;
  blinking: boolean;
}

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

export class HotelGuests {
  private readonly guests: Guest[] = [];

  constructor(shellFor: (room: HotelRoom) => Group, keepOuts: readonly RoomKeepOut[]) {
    let index = 0;
    for (const plan of ROSTER) {
      const blocked = [
        ...keepOuts.filter((k) => k.room === plan.room),
        ...wayThroughKeepOuts(plan.room),
      ];
      const shell = shellFor(plan.room);

      for (let i = 0; i < plan.kids; i += 1) {
        index += 1;
        const rng = new Rng(0x6035 + index * 977);
        const kid = createKid({
          skin: (KID_SKIN_TONES[rng.int(0, KID_SKIN_TONES.length - 1)] ?? KID_SKIN_TONES[1])!.colour,
          hair: rng.pick(HAIRS),
          outfit: rng.pick(OUTFITS),
          shoe: PALETTE.shoe,
          hairStyle: rng.pick(HAIR_STYLES),
          backpack: rng.chance(0.5),
          backpackColour: rng.pick(OUTFITS),
        });
        this.enrol(shell, kid, plan.room, blocked, rng, 1.15, 1.15, index);
      }

      for (const kind of plan.pets) {
        index += 1;
        const rng = new Rng(0x6035 + index * 977);
        this.enrol(shell, createPet(kind), plan.room, blocked, rng, 0.85, 0.62, index);
      }
    }
  }

  /**
   * One frame of strolling.
   *
   * Runs whether or not the player is in the hotel — it is seven objects doing
   * arithmetic, and a room whose guests were frozen until you looked at it
   * would start every visit with everyone standing exactly where they were
   * when you left, which is the opposite of alive.
   */
  update(dt: number, elapsed: number): void {
    for (const guest of this.guests) {
      this.blink(guest, elapsed);

      if (guest.pause > 0) {
        guest.pause -= dt;
        // Not zero: `applyWalk`'s low-speed pose is a gentle bob on the spot,
        // which is what somebody waiting looks like.
        guest.handle.setWalkPhase(guest.phase, 0.12);
        continue;
      }

      const point = guest.points[guest.target];
      if (!point) continue;
      const dx = point.x - guest.x;
      const dz = point.z - guest.z;
      const distance = Math.hypot(dx, dz);

      if (distance <= ARRIVED) {
        guest.target = (guest.target + 1) % guest.points.length;
        guest.pause = guest.rng.range(PAUSE_RANGE[0], PAUSE_RANGE[1]);
        continue;
      }

      const step = Math.min(distance, guest.speed * dt);
      guest.x += (dx / distance) * step;
      guest.z += (dz / distance) * step;
      guest.phase = (guest.phase + step / guest.stride) % 1;
      guest.yaw = turnToward(guest.yaw, Math.atan2(dx, dz), TURN_RATE * dt);

      guest.root.position.set(guest.x, 0, guest.z);
      guest.root.rotation.y = guest.yaw;
      guest.handle.setWalkPhase(guest.phase, 1);
    }
  }

  // ------------------------------------------------------------- internals

  private enrol(
    shell: Group,
    handle: CreatureHandle,
    room: HotelRoom,
    blocked: readonly RoomKeepOut[],
    rng: Rng,
    speed: number,
    stride: number,
    index: number,
  ): void {
    const points = wanderPoints(room, blocked, rng);
    const start = points[0];
    if (!start) return;
    handle.root.position.set(start.x, 0, start.z);
    shell.add(handle.root);
    this.guests.push({
      handle,
      root: handle.root,
      rng,
      points,
      speed,
      stride,
      blinkOffset: (index * 1.37) % BLINK_EVERY,
      target: 1 % points.length,
      x: start.x,
      z: start.z,
      yaw: 0,
      phase: 0,
      pause: rng.range(0, PAUSE_RANGE[1]),
      blinking: false,
    });
  }

  /** A blink on each guest's own clock. Cheap: it is a texture swap (§3). */
  private blink(guest: Guest, elapsed: number): void {
    const wants = (elapsed + guest.blinkOffset) % BLINK_EVERY < BLINK_FOR;
    if (wants === guest.blinking) return;
    guest.blinking = wants;
    guest.handle.setExpression(wants ? 'blink' : 'happy');
  }
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
 * A little circuit of places to stand, inside one room.
 *
 * Rejection sampling with a per-guest `Rng`, in **two passes with different
 * spacing but the same keep-outs**. That split is the load-bearing part:
 *
 *  - the keep-outs are a *correctness* rule — a waypoint inside a table is a
 *    guest standing in a table forever — and are never relaxed, in either
 *    pass, which is CLAUDE.md's "never weaken an assertion to make something
 *    pass" applied to placement;
 *  - the 3.2 m spacing is only *taste*: it stops a circuit being a shuffle.
 *    Floor 50's corridor is 8 m deep with four plinths and two doorways in it,
 *    and at 3.2 m apart there is genuinely room for about two points — so a
 *    second pass at 1.6 m tops the circuit up rather than leaving a guest
 *    rooted to one spot, which is exactly the thing Jim asked to fix.
 */
function wanderPoints(room: HotelRoom, blocked: readonly RoomKeepOut[], rng: Rng): Point[] {
  const points: Point[] = [];
  const minX = -room.halfX + WALL_INSET;
  const maxX = room.halfX - WALL_INSET;
  const minZ = -room.halfZ + WALL_INSET;
  const maxZ = room.halfZ - WALL_INSET;

  const sample = (separation: number): void => {
    for (let attempt = 0; attempt < 400 && points.length < WAYPOINTS; attempt += 1) {
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      if (blocked.some((k) => Math.hypot(x - k.x, z - k.z) < k.radius + GUEST_RADIUS)) continue;
      if (points.some((p) => Math.hypot(x - p.x, z - p.z) < separation)) continue;
      points.push({ x, z });
    }
  };
  sample(3.2);
  if (points.length < 3) sample(1.6);

  // A room so full that nowhere is free would leave a guest with no home at
  // all; one point in the middle is a guest standing about, which still reads
  // as somebody being there.
  if (points.length === 0) points.push({ x: 0, z: 0 });
  return points;
}

/** Turns `from` towards `to` by at most `by`, the short way round. */
function turnToward(from: number, to: number, by: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + Math.max(-by, Math.min(by, delta));
}
