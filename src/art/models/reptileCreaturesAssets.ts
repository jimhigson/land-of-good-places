import type { Mesh } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { REPTILE_CREATURES_GLB_BASE64 } from '../assets/reptileCreaturesGlb';
import type { GlbPart } from '../style/glb';
import { REPTILE_SNAKE_HEAD_LENGTH } from '../../world/reptileHouse/layout';
import { assertMeasured, loadReptileKit, partBox, type PartStyle } from './reptileKit';

/**
 * **The Reptile House's creature kit** (spec ASSET GROUPS 4) — the organic
 * parts primitives fight: one snake head every TypeScript snake wears under a
 * sizer group, the crocodile in four hinge-origin pieces, the tortoise's shell
 * and head, and one body each for the chameleon, frog, gecko, skink and
 * iguana. Everything else about an animal — legs, eyes, tongues, faces, the
 * slither — is TypeScript (`snake.ts`, `reptiles.ts`).
 *
 * Every creature faces +Z, origin on the floor under its belly, except the
 * snake head (origin at the neck joint on the body axis) and the four
 * **hinge-origin nodes**, whose node translation is the hinge:
 * `rr-snake-tongue` at the mouth (scale its length to flick), `rr-croc-jaw`
 * (rotate about X to yawn), `rr-croc-tail` (yaw to sway), `rr-tortoise-head`
 * (translate along −Z to stretch the neck). Read with {@link reptileCreaturePart}
 * and parented at that translation — never retyped.
 *
 * Colours here are the defaults a lone creature gets; a factory that wants a
 * different colourway passes its own {@link PartStyle} to
 * {@link reptileCreatureMesh}.
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rr-snake-head': { colour: ART.snakeMint, outline: 0.012 },
  'rr-snake-tongue': { colour: PALETTE.markerPink },
  'rr-croc-head': { colour: PALETTE.leafDeep, outline: 0.014 },
  'rr-croc-jaw': { colour: ART.cream, outline: 0.012 },
  'rr-croc-body': { colour: PALETTE.leafDeep, outline: 0.014 },
  'rr-croc-tail': { colour: PALETTE.leafDeep, outline: 0.014 },
  'rr-tortoise-shell': { colour: ART.shellOlive, outline: 0.014 },
  'rr-tortoise-head': { colour: ART.biscuitMuzzle, outline: 0.012 },
  'rr-chameleon-body': { colour: PALETTE.leafMid, outline: 0.012 },
  'rr-frog-body': { colour: PALETTE.leafLight, outline: 0.011 },
  'rr-gecko-body': { colour: PALETTE.leafLight, outline: 0.01 },
  'rr-skink-body': { colour: ART.biscuitFur, outline: 0.012 },
  'rr-iguana-body': { colour: PALETTE.leafDeep, outline: 0.012 },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

function creaturesKit(): ReturnType<typeof loadReptileKit> {
  if (kit) return kit;
  kit = loadReptileKit('reptileCreatures.glb', REPTILE_CREATURES_GLB_BASE64, STYLES);
  const head = partBox(kit.part('rr-snake-head'));
  assertMeasured('reptileCreatures.glb', 'the snake head length', head.maxZ, REPTILE_SNAKE_HEAD_LENGTH, 0.01);
  return kit;
}

/** The raw part, with its hinge translation where it has one. */
export function reptileCreaturePart(name: string): GlbPart {
  return creaturesKit().part(name);
}

/** One dressed mesh, carrying its node translation, in the kit's colours or `style`'s. */
export function reptileCreatureMesh(name: string, style?: PartStyle): Mesh {
  return creaturesKit().mesh(name, style);
}

/** A part's bounding box in its own metres. */
export function reptileCreatureBox(name: string): ReturnType<typeof partBox> {
  return partBox(creaturesKit().part(name));
}
