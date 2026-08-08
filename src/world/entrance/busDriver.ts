import { Group } from 'three';
import { createKid, type KidHandle } from '../../art/models/kid';
import { PALETTE } from '../../core/palette';
import { applyRidePose } from '../../entities/ridePose';

/**
 * **The one person on the cat bus who is not a park NPC: the driver.**
 *
 * This file used to build the children too, and the comment here used to argue
 * that they were *"deliberately not the full `entities/npc` system"* because
 * they *"exist for one short scene: hop down, take a step or two into the park,
 * then fade into the ordinary background"*. They did not fade into the
 * background. They were `dispose()`d, and Jim watched eleven children walk into
 * his park and blink out of existence: *"the children still get off the bus,
 * walk in and vanish"*.
 *
 * The children are now park NPCs from birth — `NpcSystem` builds them, they
 * ride in, they get off, and they carry on being exactly what they already
 * were. See `ArrivalSequence` and `activities/busArrival.ts`.
 *
 * **The driver is genuinely different and stays here.** He never gets out, he
 * leaves with the bus, and he is gone the moment it does — so making him one of
 * the park's twenty-four children would spend a permanent inhabitant on
 * somebody who drives off-screen after fifteen seconds and never comes back. A
 * one-off `createKid()` is exactly right for him, which is what the original
 * argument above was actually correct about.
 */

export interface BusDriver {
  readonly root: Group;
  readonly height: number;
  dispose(): void;
}

/** The grown-up at the wheel. Sober colours: he is working. */
const DRIVER_LOOK = {
  hair: PALETTE.grownUpCoat,
  outfit: PALETTE.grownUpScarf,
  hairStyle: 'short' as const,
};

/** Builds the bus driver, seated at the wheel. */
export function createBusDriver(): BusDriver {
  const handle: KidHandle = createKid({
    hair: DRIVER_LOOK.hair,
    outfit: DRIVER_LOOK.outfit,
    hairStyle: DRIVER_LOOK.hairStyle,
    backpack: false,
  });
  handle.setExpression('happy');

  const root = new Group();
  root.name = 'cat-bus-driver';
  root.add(handle.root);

  // **Seated, through the game's own pose.** Jim's *"aren't sitting on seats,
  // they're clipped through the floor"* named the children, but the driver was
  // built the same way — dropped into his seat group with no pose at all — and
  // was therefore standing at the wheel and 0.17 m under the floor with them.
  // He only escaped the complaint because the ride never lingers on him.
  applyRidePose(
    { root: handle.root, body: handle.body, head: handle.head, ...handle.limbs },
    0,
    0,
  );

  return {
    root,
    height: handle.height,

    // **No `setWalkPhase`, deliberately.** He had one, and both call sites used
    // it identically — `setWalkPhase(0, 0)`, meaning "stand still" — which is a
    // walk cycle at zero speed and therefore writes *zero* into all four limb
    // rotations. Called after the seated pose above, as both did, that silently
    // straightened his legs and stood him back up at the wheel. A second way to
    // pose the driver, whose only use was to undo the first: exactly CLAUDE.md's
    // "two definitions of one thing", and the fix is to have one.
    //
    // He never walks. The file's own header says so: he never gets out, he
    // leaves with the bus.

    dispose(): void {
      // `createKid()` exposes no `dispose()` of its own — same as the player's
      // own `CharacterModel`, whose materials are never explicitly freed
      // either. Removing the group from the scene is all a one-off walk-on
      // character needs. (And unlike the children this file used to build,
      // the driver really is one.)
      root.removeFromParent();
    },
  };
}
