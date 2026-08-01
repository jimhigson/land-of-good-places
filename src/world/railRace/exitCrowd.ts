import { Group } from 'three';
import { createKid, type KidHandle } from '../../art/models/kid';
import { applyWalk } from '../../art/style/asset';
import { PLAYER_RADIUS } from '../../core/constants';
import { terrainHeight } from '../terrain';
import { resolveDismountGroup, type OccupiedSpot } from '../dismount';
import type { CollisionWorld } from '../Collision';

/**
 * **The rivals, waiting at the exit** — Pip, Nell and Otto standing about when
 * the race lets you off, as though the four of you had just climbed out
 * together.
 *
 * Jim, watching a race finish (1 August 2026): the player is set down at the
 * ride's exit patch and the three children she has just spent a lap racing
 * simply are not there. They are still out on the ring, because that is where
 * the ride needs them.
 *
 * ### Why these are look-alikes and not the racers themselves
 *
 * The racing rivals are **permanent**: `RailRace.buildCarts()` runs once in the
 * constructor, and each rival is a `createKid()` handle parented to its cart for
 * the lifetime of the park. The moment a race ends they are reset to the start
 * line and `driveIdleRivals()` laps them round the ring forever, so the ring
 * looks ready for the next visitor rather than abandoned — the same trick the
 * park train plays with an empty carriage.
 *
 * Walking the *real* rivals to the exit would therefore empty the ring for as
 * long as the scene lasted, and would need a second state machine inside the
 * one that drives the race. So this is a separate, throwaway cast wearing the
 * same clothes: three children who exist for one short scene and are then gone.
 * That is not a workaround, it is the pattern this codebase already has for
 * exactly this — see `world/entrance/disembarkingKids.ts`, whose header makes
 * the same argument for the children who hop off the bus ("a direct
 * `createKid()` … is all that scene needs"). The heavyweight `entities/npc`
 * machinery cannot do it at all: `KidCrowd` is a fixed-size instanced crowd
 * built once at park construction, with no `despawn`.
 *
 * ### Nothing here is solid
 *
 * These characters have **no collision**. A six-year-old must never be walled
 * in by scenery that appeared while she was looking at a result card, and the
 * cheapest way to guarantee that is to give the scene nothing to wall her in
 * with. Their *spacing* still matters — three children standing in each other
 * reads as a bug — so they are placed by {@link resolveDismountGroup}, with the
 * player's own spot passed in as occupied so nobody ever appears on top of her.
 */

/** How long each child spends arriving, standing about, and walking off. */
const POP_SECONDS = 0.32;
const IDLE_SECONDS = 1.7;
const WALK_SECONDS = 2.4;
const FADE_SECONDS = 0.45;
const TOTAL_SECONDS = POP_SECONDS + IDLE_SECONDS + WALK_SECONDS;

/** A gentle amble away from the exit — not a sprint, not a trudge. */
const WALK_SPEED = 1.15;
/** Strides per metre, so the feet keep up with the ground they cover. */
const STRIDE_PER_METRE = 0.55;

/** Each child needs about as much personal space as the player does. */
const BODY_RADIUS = PLAYER_RADIUS;

export interface ExitCrowdMember {
  readonly outfit: number;
  readonly hairStyle: 'short' | 'bob';
  /** Finishing place, 1 = won. Only used to pick who cheers hardest. */
  readonly place: number;
}

interface Walker {
  readonly handle: KidHandle;
  readonly root: Group;
  readonly startX: number;
  readonly startZ: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly place: number;
  /** Seconds since this child appeared. Staggered so they do not act in unison. */
  age: number;
  readonly delay: number;
}

export interface RailRaceExitCrowd {
  readonly root: Group;
  /**
   * Puts the crowd at the exit. `playerX/Z` is where the player has just been
   * set down; it is kept clear.
   */
  show(
    exitX: number,
    exitZ: number,
    playerX: number,
    playerZ: number,
    members: readonly ExitCrowdMember[],
  ): void;
  update(dt: number): void;
  /** True while anybody is still on screen. */
  readonly active: boolean;
  dispose(): void;
}

export function createRailRaceExitCrowd(collision: CollisionWorld): RailRaceExitCrowd {
  const root = new Group();
  root.name = 'railRaceExitCrowd';
  let walkers: Walker[] = [];

  function clear(): void {
    for (const walker of walkers) {
      // `createKid()` exposes no `dispose()` of its own — the same as the
      // player's own `CharacterModel`, whose materials are never explicitly
      // freed either. Removing the group is all a one-off character needs.
      walker.root.removeFromParent();
    }
    walkers = [];
  }

  return {
    root,

    get active(): boolean {
      return walkers.length > 0;
    },

    show(exitX, exitZ, playerX, playerZ, members): void {
      clear();
      if (members.length === 0) return;

      const occupied: OccupiedSpot[] = [{ x: playerX, z: playerZ, radius: PLAYER_RADIUS }];
      const spots = resolveDismountGroup(
        collision,
        exitX,
        exitZ,
        BODY_RADIUS,
        members.length,
        occupied,
      );

      members.forEach((member, index) => {
        const spot = spots[index];
        if (!spot) return;

        const handle = createKid({
          outfit: member.outfit,
          hairStyle: member.hairStyle,
          backpack: false,
        });
        handle.setExpression('happy');

        const group = new Group();
        group.name = `railRaceExitKid-${index}`;
        group.add(handle.root);
        group.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z);
        root.add(group);

        // They wander off towards the middle of the park — away from the rails
        // and the boundary wall, which is the only direction that is always
        // somewhere rather than nowhere, whatever bearing the exit sits at.
        const inwardX = -spot.x;
        const inwardZ = -spot.z;
        const length = Math.hypot(inwardX, inwardZ) || 1;
        // Fanned a little per child so three of them do not walk off in a
        // column, and so they visibly spread rather than converge.
        const fan = (index - (members.length - 1) / 2) * 0.42;
        const cos = Math.cos(fan);
        const sin = Math.sin(fan);
        const ux = inwardX / length;
        const uz = inwardZ / length;

        walkers.push({
          handle,
          root: group,
          startX: spot.x,
          startZ: spot.z,
          dirX: ux * cos - uz * sin,
          dirZ: ux * sin + uz * cos,
          place: member.place,
          age: 0,
          // A stagger, so they pop in one after another like a group arriving
          // rather than three copies of one event.
          delay: index * 0.16,
        });

        // Face the player while they are standing about.
        group.rotation.y = Math.atan2(playerX - spot.x, playerZ - spot.z);
      });
    },

    update(dt: number): void {
      if (walkers.length === 0) return;
      let anyAlive = false;

      for (const walker of walkers) {
        walker.age += dt;
        const t = walker.age - walker.delay;
        const { handle, root: group } = walker;

        if (t < 0) {
          group.visible = false;
          anyAlive = true;
          continue;
        }
        group.visible = true;
        handle.update(dt);

        if (t >= TOTAL_SECONDS) {
          group.visible = false;
          continue;
        }
        anyAlive = true;

        if (t < POP_SECONDS) {
          // The same overshooting pop everything else in this game arrives
          // with (see `ferrisWheel/friends.ts`'s `setPresence`).
          const p = t / POP_SECONDS;
          group.scale.setScalar(Math.max(0.001, p * (1 + Math.sin(p * Math.PI) * 0.25)));
          applyWalk(handle.limbs, handle.body, 0, 0);
          cheer(handle, walker.place, t);
        } else if (t < POP_SECONDS + IDLE_SECONDS) {
          group.scale.setScalar(1);
          applyWalk(handle.limbs, handle.body, 0, 0);
          cheer(handle, walker.place, t);
        } else {
          // Walking off. Position is integrated from the *start* point rather
          // than accumulated per frame, so a dropped frame cannot leave one
          // child behind the others.
          const walked = t - POP_SECONDS - IDLE_SECONDS;
          const distance = walked * WALK_SPEED;
          const x = walker.startX + walker.dirX * distance;
          const z = walker.startZ + walker.dirZ * distance;
          group.position.set(x, terrainHeight(x, z), z);
          group.rotation.y = Math.atan2(walker.dirX, walker.dirZ);
          handle.head.rotation.x = 0;
          applyWalk(handle.limbs, handle.body, distance * STRIDE_PER_METRE, 1);

          // Shrink away over the last moment rather than blinking out.
          const remaining = WALK_SECONDS - walked;
          group.scale.setScalar(
            remaining < FADE_SECONDS ? Math.max(0.001, remaining / FADE_SECONDS) : 1,
          );
        }
      }

      if (!anyAlive) clear();
    },

    dispose(): void {
      clear();
      root.removeFromParent();
    },
  };
}

/**
 * Standing-about pose: arms up and waving, higher and faster for whoever won.
 *
 * Posed by hand rather than through `applyWalk`, the same way `RailRace.animate`
 * poses a rival's arms in her cart — one place decides what an arm is doing.
 */
function cheer(handle: KidHandle, place: number, t: number): void {
  const winner = place === 1;
  const lift = winner ? -2.5 : -1.9;
  const flap = Math.sin(t * (winner ? 12 : 8)) * (winner ? 0.34 : 0.2);
  handle.limbs.rightArm.rotation.x = lift + flap;
  handle.limbs.leftArm.rotation.x = lift - flap;
  handle.limbs.rightArm.rotation.z = -0.25;
  handle.limbs.leftArm.rotation.z = 0.25;
  // A little bob, so standing still is not standing frozen.
  handle.head.rotation.x = Math.sin(t * 3.1) * 0.06;
}
