import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';

/**
 * **What a park child can look like.** One list per slot, and one owner.
 *
 * These lived inside `entities/npc/NpcSystem.ts` as module-private constants,
 * which was fine while the crowd was the only thing that dressed a child. It
 * stopped being fine when the cat bus's journey needed to put twelve children
 * in a bus **before the park exists** — `NpcSystem.ts` reads `PARK_BOUNDARY` at
 * module scope to size its crowd, so importing it drags the whole solved park
 * into the module graph of the one scene whose entire purpose is to be on
 * screen while the park is still being solved.
 *
 * The alternative was a second palette in the journey, and the journey would
 * then have dressed its passengers out of a different tin from the park's own
 * children — a second definition of "what a child in this game looks like",
 * kept in step by hand, which is the bug this repo has paid for more than any
 * other. Colours are an **art** fact, not a park one, so they belong here.
 *
 * Skin tones are deliberately elsewhere ({@link KID_SKIN_TONES} in `kid.ts`):
 * they are the same hand-picked, inclusive range the character creator offers
 * the player, rather than one base hue scaled darker — a uniform scale drifts
 * warm skin towards grey at the low end and never reaches a deep tone. Every
 * child in the park should look plausibly reachable from the creator's own
 * swatch row.
 */

export const HAIR_COLOURS = [
  PALETTE.hair,
  ART.ripikaTip,
  ART.corgiTan,
  ART.biscuitFurDark,
  PALETTE.ink,
  ART.ripikaYellow,
  PALETTE.blossomPink,
  ART.miniLilac,
] as const;

export const OUTFIT_COLOURS = [
  PALETTE.outfit,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  ART.jumperRed,
  ART.miniLilac,
  ART.corgiTan,
  ART.heartPink,
] as const;

export const SHOE_COLOURS = [
  PALETTE.shoe,
  ART.jumperRed,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  ART.miniBelly,
] as const;

export const BAG_COLOURS = [
  ART.kidBackpack,
  PALETTE.markerLemon,
  PALETTE.markerPink,
  ART.miniBelly,
  ART.corgiTan,
] as const;
