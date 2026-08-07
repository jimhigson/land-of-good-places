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

/**
 * **A busload of individuals, not four copies of three children.**
 *
 * This was a three-entry table read with `index % VARIANTS.length`, which was
 * fine while exactly two children got off. Jim then asked for twelve seats with
 * children on them, and twelve children through a three-entry modulo is four
 * identical sets of triplets — the one thing a crowd must not look like.
 *
 * So there is now one distinct entry per seat, plus the driver on the end. Hair
 * style and both colours vary together, and the styles are drawn from
 * `HAIR_STYLES` so a busload shows off the range a child can actually pick from
 * in the character creator.
 */
const VARIANTS = [
  { hair: PALETTE.flowerBlue, outfit: PALETTE.flowerYellow, hairStyle: 'short' as const },
  { hair: PALETTE.blossomPink, outfit: PALETTE.markerMint, hairStyle: 'bunches' as const },
  { hair: PALETTE.hair, outfit: PALETTE.markerSky, hairStyle: 'bob' as const },
  { hair: PALETTE.flowerRed, outfit: PALETTE.markerLilac, hairStyle: 'ponytail' as const },
  { hair: PALETTE.woodDark, outfit: PALETTE.flowerViolet, hairStyle: 'long' as const },
  { hair: PALETTE.markerLemon, outfit: PALETTE.flowerBlue, hairStyle: 'spiky' as const },
  { hair: PALETTE.barkDark, outfit: PALETTE.markerPink, hairStyle: 'bowl' as const },
  { hair: PALETTE.flowerViolet, outfit: PALETTE.grassLight, hairStyle: 'messy' as const },
  { hair: PALETTE.wood, outfit: PALETTE.markerSky, hairStyle: 'longPonytail' as const },
  { hair: PALETTE.ink, outfit: PALETTE.flowerYellow, hairStyle: 'mohican' as const },
  { hair: PALETTE.markerPink, outfit: PALETTE.leafLight, hairStyle: 'bunches' as const },
  { hair: PALETTE.blossomWhite, outfit: PALETTE.markerLilac, hairStyle: 'bob' as const },
  /** The driver, last — reuses this same lightweight builder, just seated. */
  { hair: PALETTE.grownUpCoat, outfit: PALETTE.grownUpScarf, hairStyle: 'short' as const },
];

/** Builds one of the disembarking children, or the driver (the last index). */
export function createDisembarkingKid(index: number): DisembarkingKid {
  const colours = VARIANTS[index % VARIANTS.length] ?? VARIANTS[0]!;
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
