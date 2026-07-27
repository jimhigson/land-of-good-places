import { Group } from 'three';
import { createKid, type KidHandle } from '../../art/models/kid';
import { PALETTE } from '../../core/palette';
import { applyWalk } from '../../art/style/asset';

/**
 * The couple of other children who hop off the bus with the player.
 *
 * Deliberately not the full `entities/npc` system (their own wander AI,
 * instancing, waypoint graph…) — that machinery is for the park's permanent
 * background cast, and it lives outside this feature's file ownership. These
 * two exist for one short scene: hop down, take a step or two into the park,
 * then fade into the ordinary background. A direct `createKid()` — the same
 * public art factory the player and every dodgem driver already use — is all
 * that scene needs.
 */

export interface DisembarkingKid {
  readonly root: Group;
  readonly height: number;
  /** `phase` 0..1 through one stride, `speed` 0..1 of a gentle walk. */
  setWalkPhase(phase01: number, speed01: number): void;
  waveArm(amount01: number): void;
  dispose(): void;
}

const KID_A_COLOURS = { hair: PALETTE.flowerBlue, outfit: PALETTE.flowerYellow, hairStyle: 'short' as const };
const KID_B_COLOURS = { hair: PALETTE.blossomPink, outfit: PALETTE.markerMint, hairStyle: 'bunches' as const };
/** The driver — reuses this same lightweight builder (index 2), just seated and scaled down. */
const DRIVER_COLOURS = { hair: PALETTE.hair, outfit: PALETTE.markerSky, hairStyle: 'bob' as const };

const VARIANTS = [KID_A_COLOURS, KID_B_COLOURS, DRIVER_COLOURS];

/** Builds one of the disembarking kids (0 or 1) or the driver (2). */
export function createDisembarkingKid(index: number): DisembarkingKid {
  const colours = VARIANTS[index % VARIANTS.length] ?? KID_A_COLOURS;
  const handle: KidHandle = createKid({
    hair: colours.hair,
    outfit: colours.outfit,
    hairStyle: colours.hairStyle,
    backpack: false,
  });
  handle.setExpression('happy');

  const root = new Group();
  root.name = `entrance-kid-${index}`;
  root.add(handle.root);

  return {
    root,
    height: handle.height,

    setWalkPhase(phase01: number, speed01: number): void {
      applyWalk(handle.limbs, handle.body, phase01, speed01);
    },

    waveArm(amount01: number): void {
      // The right arm lifts up and swings side to side — a cheerful wave
      // rather than the walk cycle's forward-back swing.
      handle.limbs.rightArm.rotation.x = -2.4;
      handle.limbs.rightArm.rotation.z = -0.6 + Math.sin(amount01 * Math.PI * 4) * 0.35;
    },

    dispose(): void {
      // `createKid()` exposes no `dispose()` of its own — same as the
      // player's own `CharacterModel`, whose materials are never explicitly
      // freed either. Removing the group from the scene is all a one-off
      // walk-on character needs.
      root.removeFromParent();
    },
  };
}
