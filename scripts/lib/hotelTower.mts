/**
 * **`check:hotel`'s probe 22, as a function of a built park** — the tower is
 * solid from every bearing but the door. One owner, asked by `check:hotel`
 * (which fails on all of it) and by the root acceptance loop
 * (`scripts/park-attempt.mts`), which asks only what a park decides: scenery
 * the park stood in front of the tower that stops every march short of the
 * shell, or walls up the doorway. Whether the shell itself is closed is the
 * hotel's code, the same on every park, and is never restarted around.
 *
 *
 * Jim, playing, 9 Aug 2026: *"The hotel building is not solid. I can walk
 * straight through it."* He was right, and the reason was in
 * `registerTowerCollision`: the octagon was built by trimming the *start* of
 * every sector by the door's arc, so six evenly-spaced 0.32 rad gaps stood
 * open round the tower and the "doorway" itself was a 1.43 rad hole, nearly
 * four times the door.
 *
 * So this walks up to the building the way a child does, from all round it:
 * a player-sized body marched at the centre from 16 m out, on 32 bearings,
 * **twice** — once creeping at 5 cm and once at `PLAYER_LONGEST_STEP`, the
 * longest stride the loop can hand out, because a gap you cannot walk into
 * you may still be able to tunnel into on a stuttering frame.
 *
 * Every bearing but the doorway's own cone must be stopped outside the shell
 * unless it came in **through the doorway** — judged by where the march crossed
 * the facade plane, not where it ended. On seed 10 two posts and the jamb's end
 * cap steer the 22.5° marches round into the door; the old end-point test read
 * that as a hole 5.97 m from the centre, when the shell was closed all along.
 * The doorway's cone must let her in, and the count of bearings that actually
 * reach the shell is asserted too — otherwise a park that happened to fence
 * the tower off with trees would pass this without ever testing the tower.
 *
 * Proven red before trusted green, on the pre-fix build: **19 of the 64
 * marches walked inside the 6.65 m shell**, at nine distinct bearings from 23°
 * to 169° off the doorway, and the closest approach was 0.00 m — the middle of
 * the tower. It also trips the reach guard ("only 25 of 64 marches reached the
 * shell"), because a body that walks straight through a wall never stops
 * against it.
 */
import { Vector3 } from 'three';
import type { HeadlessPark } from '../park-harness.mts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS } from '../../src/core/constants.ts';

export interface HotelTowerFindings {
  /** The shell let a body in off the doorway — code. */
  readonly code: readonly string[];
  /** What the park put in front of the tower — decisions. */
  readonly decisions: readonly string[];
  readonly notes: readonly string[];
}

export async function hotelTowerFindings(park: Pick<HeadlessPark, 'world'>): Promise<HotelTowerFindings> {
  const { placedEntry } = await import('../../src/world/parkLayout.ts');
  const { TOWER_DOOR_HALF, TOWER_FACADE_ALONG } = await import('../../src/world/hotel/Hotel.ts');
  const code: string[] = [];
  const decisions: string[] = [];
  const notes: string[] = [];

  // The tower is out in the park and its own leash is nothing to do with
  // this; lifted here and put back before returning.
  const collision = park.world.collision;
  const leash = collision.playBounds;
  collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });
  try {
  const plot = placedEntry('hotel');
  const facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);
  /** Where a bearing has to stop to count as "outside": the shell's own flat. */
  const facade = TOWER_FACADE_ALONG;
  /** Half the angle the doorway subtends at the tower's centre. */
  const doorCone = Math.atan2(TOWER_DOOR_HALF, facade);

  // Along / across the door's axis, relative to the tower's centre.
  const alongOf = (px: number, pz: number): number =>
    (px - plot.x) * Math.sin(facadeYaw) + (pz - plot.z) * Math.cos(facadeYaw);
  const acrossOf = (px: number, pz: number): number =>
    (px - plot.x) * Math.sin(facadeYaw + Math.PI / 2) +
    (pz - plot.z) * Math.cos(facadeYaw + Math.PI / 2);

  /**
   * March in and report the closest approach, and how deep she got **without
   * having come through the doorway**. Ask what she crossed, not where she
   * landed: scenery in front of the hotel can turn an off-axis march into the
   * doorway (seed 10: two posts and the jamb's end cap slide a 22.5° march
   * round into the door, and she walks in properly between the jambs), and
   * that is the door working, not a hole in the shell. So a step that carries
   * her across the facade plane *between the jambs* marks the march as
   * entered-by-the-door; any depth inside the shell reached before that — or
   * without it at all — is a hole.
   */
  const marchIn = (
    bearing: number,
    step: number,
  ): { closest: number; closestNotByDoor: number; byDoor: boolean } => {
    const probe = new Vector3(
      plot.x + Math.sin(bearing) * 16,
      0,
      plot.z + Math.cos(bearing) * 16,
    );
    let closest = Infinity;
    let closestNotByDoor = Infinity;
    let byDoor = false;
    for (let travelled = 0; travelled < 20; travelled += step) {
      const fromAlong = alongOf(probe.x, probe.z);
      const fromAcross = acrossOf(probe.x, probe.z);
      collision.resolveMovement(
        probe,
        -Math.sin(bearing) * step,
        -Math.cos(bearing) * step,
        PLAYER_RADIUS,
        0,
        MAX_FRAME_DELTA,
      );
      const toAlong = alongOf(probe.x, probe.z);
      const toAcross = acrossOf(probe.x, probe.z);
      if (!byDoor && fromAlong >= facade && toAlong < facade) {
        const t = (fromAlong - facade) / (fromAlong - toAlong);
        const crossedAt = fromAcross + t * (toAcross - fromAcross);
        if (Math.abs(crossedAt) < TOWER_DOOR_HALF) byDoor = true;
      }
      const r = Math.hypot(probe.x - plot.x, probe.z - plot.z);
      closest = Math.min(closest, r);
      if (!byDoor) closestNotByDoor = Math.min(closestNotByDoor, r);
    }
    return { closest, closestNotByDoor, byDoor };
  };

  const BEARINGS = 32;
  let reachedShell = 0;
  let doorwaysIn = 0;
  /** Off-axis marches scenery steered in through the door — not holes, but said aloud. */
  let turnedInByDoor = 0;
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = facadeYaw + (i / BEARINGS) * Math.PI * 2;
    // Signed angle off the door's axis, wrapped into (−π, π].
    const offAxis = Math.abs(
      Math.atan2(Math.sin(bearing - facadeYaw), Math.cos(bearing - facadeYaw)),
    );
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      const { closest, closestNotByDoor, byDoor } = marchIn(bearing, step);
      if (closest < facade + 1.2) reachedShell += 1;
      if (offAxis > doorCone) {
        if (byDoor && closest < facade) turnedInByDoor += 1;
        if (closestNotByDoor < facade) {
          code.push(
            `the hotel tower is not solid ${((offAxis * 180) / Math.PI).toFixed(0)}° off its ` +
              `doorway: a player-sized body marched at it in ${step.toFixed(2)} m steps got to ` +
              `${closestNotByDoor.toFixed(2)} m from the centre, inside the ${facade.toFixed(2)} m shell, ` +
              `without coming through the doorway ` +
              `(world/hotel/Hotel.ts registerTowerCollision)`,
          );
        }
      } else if (closest < facade) {
        doorwaysIn += 1;
      }
    }
  }
  if (doorwaysIn === 0) {
    decisions.push(
      'no bearing inside the tower doorwaylets a child in at all — the front door is walled up',
    );
  }
  if (turnedInByDoor > 0) {
    notes.push(
      `  note: ${turnedInByDoor} off-doorway march(es) at the hotel tower were steered in through ` +
        `the doorway by scenery in front of it — counted as the door, not a hole\n`,
    );
  }
  // Green must mean "measured", not "never got near it".
  if (reachedShell < BEARINGS) {
    decisions.push(
      `only ${reachedShell} of ${BEARINGS * 2} marches at the hotel tower reached its shell at ` +
        `all — the rest were stopped by other scenery, so this probe is not measuring the tower`,
    );
  }
  } finally {
    collision.setPlayBounds(leash);
  }
  return { code, decisions, notes };
}
