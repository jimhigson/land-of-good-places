import { Group } from 'three';
import { createKid, type KidHandle } from '../../art/models/kid';
import { PALETTE } from '../../core/palette';
import { applyWalk } from '../../art/style/asset';

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
  /** `phase` 0..1 through one stride, `speed` 0..1 of a gentle walk. */
  setWalkPhase(phase01: number, speed01: number): void;
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

  return {
    root,
    height: handle.height,

    setWalkPhase(phase01: number, speed01: number): void {
      applyWalk(handle.limbs, handle.body, phase01, speed01);
    },

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
