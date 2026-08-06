import { Color, Group, Mesh, TorusGeometry, Vector3, type Material } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import {
  createBakedFace,
  createFacePatch,
  type BakedFace,
  type Expression,
  type FacePaintControl,
  type FacePaintDesign,
  type FacePatch,
} from '../style/faces';
import {
  applyWalk,
  blob,
  makeLimbs,
  stub,
  type CreatureHandle,
  type CreatureLimbs,
} from '../style/asset';
import { visibleTop } from '../style/measure';
import { buildHair, type HairPart, type HairStyle } from './hair';
import { buildBackpacks, type BackpackKind, type BackpackPart } from './backpacks';
import { buildShoes, type ShoeKind, type ShoePart } from './shoes';
import { kidAssetMesh } from './kidAsset';

/**
 * The player kid — Eleri by default.
 *
 * This is the toon restyle of `src/entities/CharacterModel.ts`: toon material,
 * painted face patch instead of sphere eyes, coloured ink outlines, and a little
 * backpack so the "cute things peek out of your bag" feature has somewhere to
 * live.
 *
 * **Cartoon pass (26 July 2026).** The family asked for heads about double the
 * size. The head is authored at {@link HEAD} × the original: 1.5 linear, which
 * is 2.25× the area it covers on screen — that is what "double" looks like once
 * it is rendered. The body was *shortened* rather than left alone, so the kid
 * only grew from 1.86 m to 2.12 m and the head went from 45% of her height to
 * 59%. Shortening matters: a big head on a full-length body reads as a medical
 * problem, a big head on a stumpy body reads as a toy.
 *
 * Every colour is a constructor option so the character creator can drive it.
 */

/**
 * How much bigger the head is than the original authoring.
 *
 * Every number inside the `head` group is written as `x * HEAD`, so this is the
 * one knob. Face patches, hair, ears and the hat anchor all ride along, which is
 * the whole reason the face is painted onto a patch sized from `skullR`.
 *
 * **Exported, because hats have to ride it too.** `art/models/hats.ts` is
 * authored against the *original* 0.44 m skull, and it lives in another file
 * with no reference to this number — so when the cartoon pass took this from 1
 * to 1.5, hair and ears and the hat anchor grew and every hat in the shop did
 * not. They spent two days at two thirds of the head they sat on, which is the
 * "the hats are all much too small" the family reported. `hats.ts` now scales
 * itself by this, so the next head retune carries the hats with it.
 */
export const KID_HEAD_SCALE = 1.5;

/** Local shorthand for {@link KID_HEAD_SCALE}: every head number is `x * HEAD`. */
const HEAD = KID_HEAD_SCALE;

/**
 * Height of the head pivot above the feet, in metres.
 *
 * Exported because the player's animator nudges `head.position.y` for secondary
 * motion and has to know what to nudge it *around*. It used to hard-code 1.34.
 */
export const KID_HEAD_HEIGHT = 1.36;

/**
 * Total height in metres, measured to the top of the hair.
 *
 * The **default** style's height. Since hair styles landed, a kid's real height
 * varies with what she is wearing — spikes reach a good 0.2 m higher than a bob
 * — so every handle carries its own measured `height` and that is what a name
 * label must use. This constant survives for callers that only need a rough
 * idea of how big a child is.
 */
export const KID_HEIGHT = 2.12;

/**
 * The height of the **tallest child the park can produce**, in metres — every
 * hair style crossed with every hat, measured with {@link visibleTop} on real
 * models.
 *
 * `KID_HEIGHT` is the *default* style and is nowhere near this: the measured
 * spread runs 2.087 (bob, short, bowl…) to 2.490 bare-headed (mohican's crest),
 * and a party hat takes it to **2.968** — 0.85 m more than `KID_HEIGHT`. Hats
 * dominate hair, and they count, because children wear them on rides:
 * `WornHat` and `NpcSystem.buildIndividualAvatar` both parent the hat model
 * into `hatAnchor` at its own natural scale.
 *
 * **Why this exists rather than being everybody's own guess:** anything sizing
 * a space a child has to fit through needs the worst case, not the typical one.
 * `train/clearance.ts` is the first caller — a bridge over the railway derived
 * from `KID_HEIGHT` would clear the average child and hit the tall ones.
 *
 * **It cannot go stale.** `test/procgen/invariants.ts`'s "the clearance over the
 * railway covers the train and everyone riding it" re-measures the full
 * hair × hat cross product from real models on every seed and fails if any
 * built child is taller than this. Add a taller hat and that goes red rather
 * than a bridge quietly getting too low.
 */
export const TALLEST_CHILD_HEIGHT = 2.97;

/**
 * How far the head is tipped back, in radians (≈ 10°).
 *
 * The game camera looks down at 38°. A head this big, sitting level, presents
 * the player with the top of a hairstyle; tipping it back brings the face — and
 * therefore the eyes, which are 80% of the cuteness — back into view. It also
 * reads as a chin-up, pleased-with-itself pose, which is no bad thing.
 */
const HEAD_TILT = 0.17;

/**
 * The skull's radius, and how a face *patch* worn on it is squashed to sit flat
 * against that curve.
 *
 * {@link FACE_SQUASH} is now only used on the crowd's patch path — see
 * `KidOptions.facePatch`. A baked face needs no such constant at all: it is
 * painted into the skull's own texture, so it inherits the skull's squash and
 * the crown's tilt by being the same surface. That is one of the two duplicated
 * numbers this change deletes, and duplicated numbers on this model have a
 * history (every hat sat at two thirds of its size for two days over one).
 */
export const SKULL_RADIUS = 0.44 * HEAD;
const FACE_SQUASH: readonly [number, number, number] = [1, 0.95, 0.98];

/**
 * Where the painted face sits on the skull.
 *
 * Exported, and spread into {@link createFacePatch} rather than written inline,
 * because **something now has to know where the eyes are**: `check:hair` proves
 * every fringe stops above them, and the alternative was a second copy of these
 * numbers in a script, which is exactly the drift that put every hat at two
 * thirds of its size for two days.
 */
export const KID_FACE = {
  spreadX: 1.7,
  spreadY: 1.7,
  tilt: 0.03,
  eyeY: 0.43,
  eyeGap: 0.44,
  eyeW: 0.122,
  eyeH: 0.158,
} as const;

/**
 * Height of {@link KidHandle.hatAnchor} inside the `crown` group, in metres.
 *
 * Exported because a hat is authored about that anchor while the eyes are
 * described about the skull's centre, so anything comparing the two — the
 * eye-clearance gate in `check:hat-fit` — needs the one offset between them
 * rather than its own copy of `0.42 * HEAD`.
 */
export const KID_HAT_ANCHOR_Y = 0.42 * HEAD;

/**
 * **Where the top of an eye is**, at azimuth `azimuth` radians round the face
 * (0 is dead ahead, +x is the wearer's left as the camera sees it), measured in
 * the **`crown` group's frame** — the frame a worn hat lives in. `null` outside
 * the eyes' own arc.
 *
 * This exists so that nothing has to reconstruct it. `check:hair` had the only
 * copy, and it is written in the *hair shells'* frame — `hair.ts` hangs them
 * off a `drape` group carrying `rotation.x = headTilt` — so it rotates the
 * result by `HEAD_TILT` on the way out and, being about hair rather than about
 * the painted surface, leaves {@link FACE_SQUASH} out. Both are right there and
 * wrong anywhere else: reusing that formula for hats puts the eyes 106 mm too
 * high. One surface must have one description (ART-AGENT-NOTES §5); this is it,
 * and it is checked against the built patch's own vertices by `check:hat-fit`.
 *
 * An eye is an **ellipse**, so this is a function of azimuth rather than one
 * number: at its outer corner an eye has no height at all, and comparing a
 * brim's lowest point anywhere in the eye's azimuth range against the eye's
 * tallest point condemns every hat that correctly frames a face.
 */
export function kidEyeTopAt(azimuth: number): number | null {
  const band =
    Math.PI / 2 - KID_FACE.spreadY / 2 + KID_FACE.tilt + KID_FACE.eyeY * KID_FACE.spreadY;
  const centre = (KID_FACE.eyeGap / 2) * KID_FACE.spreadX;
  const halfW = (KID_FACE.eyeW / 2) * KID_FACE.spreadX;
  const halfH = (KID_FACE.eyeH / 2) * KID_FACE.spreadY;
  const offset = Math.abs(Math.abs(azimuth) - centre) / halfW;
  if (offset >= 1) return null;
  const theta = band - halfH * Math.sqrt(1 - offset * offset);
  return SKULL_RADIUS * Math.cos(theta) * FACE_SQUASH[1];
}

/**
 * **The centre of one painted eye**, in the `crown` group's frame — the same
 * frame {@link kidEyeTopAt} and `hatAnchor`/`glassesAnchor` live in. `side` is
 * -1 (the wearer's left, as she experiences it) or +1.
 *
 * Same sphere trigonometry as {@link kidEyeTopAt}, evaluated at the eye's own
 * azimuth (`offset = 0`) instead of at its outer corner: an eye's ellipse sits
 * at its vertical centre directly above its own horizontal centre, so this is
 * `kidEyeTopAt`'s formula with the `halfH` dip dropped, not a second
 * description of the eye. Both read the same `KID_FACE` numbers, so a future
 * retune of the face has one place to change, not two — exactly the drift
 * ART-AGENT-NOTES.md §2 warns about.
 *
 * Exists for {@link createKid}'s `glassesAnchor` and for `art/models/glasses.ts`,
 * which needs the eyes' own spacing to centre a lens on each one.
 */
export function kidEyeCentre(side: -1 | 1): Vector3 {
  const theta =
    Math.PI / 2 - KID_FACE.spreadY / 2 + KID_FACE.tilt + KID_FACE.eyeY * KID_FACE.spreadY;
  const azimuth = side * (KID_FACE.eyeGap / 2) * KID_FACE.spreadX;
  const phi = Math.PI / 2 + azimuth;
  return new Vector3(
    -SKULL_RADIUS * Math.cos(phi) * Math.sin(theta) * FACE_SQUASH[0],
    SKULL_RADIUS * Math.cos(theta) * FACE_SQUASH[1],
    SKULL_RADIUS * Math.sin(phi) * Math.sin(theta) * FACE_SQUASH[2],
  );
}

/**
 * **How far above the horizon a level head is already looking**, in radians.
 *
 * The kid does not look straight ahead when her head joint is at zero: the
 * skull is tipped back by {@link HEAD_TILT}, and the painted eyes sit a little
 * above the skull's equator ({@link KID_FACE}), so her gaze leaves the face
 * already climbing. Both terms are read from the numbers that put them there
 * rather than restated, so retuning either moves this with it.
 *
 * Exported because aiming her face at something now needs it. The whole gaze
 * is linear in the two joints above the eyes and nothing else:
 *
 * ```
 * gaze elevation = KID_REST_GAZE_PITCH − body.rotation.x − head.rotation.x
 * ```
 *
 * — verified against a really-built kid's own glasses anchor, to 4 decimal
 * places at six different joint combinations, by `check:climb-wave`. That is
 * what lets `Player.ts` solve for the head angle that points her at the camera
 * instead of guessing a pitch that looks about right from one screenshot.
 */
export const KID_REST_GAZE_PITCH =
  HEAD_TILT + Math.asin(kidEyeCentre(-1).add(kidEyeCentre(1)).multiplyScalar(0.5).normalize().y);

/** One named swatch — a skin tone or an eye colour, ready to drop onto a button. */
export interface ToneSwatch {
  readonly colour: number;
  readonly label: string;
}

/**
 * The character creator's skin-tone swatches — and the range the park's NPC
 * crowd draws from (see `entities/npc/kidCrowd.ts`, which imports this same
 * list rather than keeping its own).
 *
 * Hand-picked, not one base hue scaled darker and lighter: a uniform scale
 * drifts warm skin towards grey at the low end, which is exactly what an
 * inclusive range must not do. Every entry keeps its own warm undertone
 * instead, chosen to sit comfortably in the toon ramp next to `ART.blush`.
 * `Fair` is `ART.kidSkin`, the game's long-standing default, so a save from
 * before this list existed still renders identically.
 */
export const KID_SKIN_TONES: readonly ToneSwatch[] = [
  { colour: 0xffe6d1, label: 'Porcelain' },
  { colour: ART.kidSkin, label: 'Fair' },
  { colour: 0xf0b787, label: 'Honey' },
  { colour: 0xd99b6c, label: 'Caramel' },
  { colour: 0xb97748, label: 'Sienna' },
  { colour: 0x8f5a37, label: 'Umber' },
  { colour: 0x6b4226, label: 'Espresso' },
] as const;

/**
 * The character creator's eye-colour swatches.
 *
 * `Brown`, `Green`, `Blue` and `Violet` (the existing default) are also the
 * four the NPC crowd bakes as instanced face variants (`kidCrowd.ts`'s
 * `EYE_VARIANTS`); `Hazel` and `Grey` only ever paint the player's own,
 * un-instanced face, so they cost nothing beyond this list.
 */
export const KID_EYE_COLOURS: readonly ToneSwatch[] = [
  { colour: ART.kidEyeBrown, label: 'Brown' },
  { colour: 0xa87a4a, label: 'Hazel' },
  { colour: ART.kidEyeGreen, label: 'Green' },
  { colour: ART.kidEyeBlue, label: 'Blue' },
  { colour: 0x8a93a0, label: 'Grey' },
  { colour: ART.kidEye, label: 'Violet' },
] as const;

/**
 * The name of every mesh the kid's **body and head** are built from.
 *
 * One table, used three ways, which is the whole point of it existing:
 *
 * 1. `createKid` names each mesh from it as it builds;
 * 2. `scripts/export-kid-glb.mts` walks it to decide what goes in the asset,
 *    and a glTF node has to be *named* or it comes back from a round trip as
 *    `mesh_1`, `mesh_2` (ART-AGENT-NOTES.md §8);
 * 3. the parity harness pairs authored part against procedural part by it.
 *
 * Hair, backpacks, hats and shoes are **not** here: they are separate rigs
 * (`hair.ts`, `backpacks.ts`, `hats.ts`, `shoes.ts`) that mount on anchors and
 * are chosen per child, and they keep their current procedural build.
 *
 * The `.l` / `.r` suffix is the character's own left and right — the sign used
 * for `side` in the loops below, so `.l` is `side === -1`, i.e. −X.
 */
export const KID_BODY_PARTS = [
  'torso',
  'collar',
  'hem',
  'arm-upper-l',
  'arm-upper-r',
  'hand-l',
  'hand-r',
  'leg-upper-l',
  'leg-upper-r',
  'foot-l',
  'foot-r',
  'skull',
  'ear-l',
  'ear-r',
] as const;

export type KidBodyPart = (typeof KID_BODY_PARTS)[number];

/** `'l'` for the character's left (−X), `'r'` for her right. */
function sideTag(side: -1 | 1): 'l' | 'r' {
  return side < 0 ? 'l' : 'r';
}

export interface KidOptions {
  skin?: number;
  hair?: number;
  outfit?: number;
  /**
   * The arms' own colour, for a two-tone shirt — a red body with white arms,
   * say. Defaults to {@link outfit}, which is what keeps every existing
   * single-colour swatch (`ui/CharacterCreation.ts`'s `OUTFIT_SWATCHES`)
   * rendering exactly as it did before this option existed: arms simply match
   * the body unless a caller asks for something else.
   *
   * Only the arms read this — the torso, collar and hem stay {@link outfit}
   * and its darker derivative, same as always. See {@link KidHandle.setOutfitColour}.
   */
  outfitArms?: number;
  shoe?: number;
  /** Which pair is worn. `plain` by default — today's shoe, unchanged. See `art/models/shoes.ts`. */
  shoeKind?: ShoeKind;
  /**
   * Which pairs are *built*, if more than the one worn.
   *
   * The twin of {@link hairStyles}/`backpackKinds`, and only the NPC crowd
   * wants it, for the same reason: its prototype has to carry every pair a
   * background child can wear at once (`CROWD_SHOE_KINDS`). Everybody else
   * builds one.
   */
  shoeKinds?: readonly ShoeKind[];
  /** Which style is worn. `bunches` by default. See `art/models/hair.ts`. */
  hairStyle?: HairStyle;
  /**
   * Which styles are *built*, if more than the one worn.
   *
   * Only the NPC crowd wants this: it reads one prototype kid and instances
   * every mesh it finds, so its prototype has to carry every style the crowd
   * can wear at once (`CROWD_HAIR_STYLES`). Everybody else builds one.
   */
  hairStyles?: readonly HairStyle[];
  backpack?: boolean;
  backpackColour?: number;
  /** Which shape is worn on her back. `satchel` by default. See `backpacks.ts`. */
  backpackKind?: BackpackKind;
  /**
   * Which backpack shapes are *built*, if more than the one worn.
   *
   * The twin of {@link hairStyles}, and only the NPC crowd wants it, for the
   * same reason: its prototype has to carry every shape a background child can
   * wear at once (`CROWD_BACKPACK_KINDS`). Everybody else builds one.
   */
  backpackKinds?: readonly BackpackKind[];
  /** Iris colour. Defaults to `ART.kidEye` — every kid but Ethan wears it. */
  eyeColour?: number;
  /**
   * Build the face as a separate patch mesh instead of baking it into the
   * skull's texture.
   *
   * **Only the NPC crowd wants this**, and it is not a preference — it is what
   * makes an instanced crowd possible. `entities/npc/kidCrowd.ts` gives every
   * child their skin tone as an `instanceColor` multiply against a flat white
   * material, and finds the face by the mesh literally named `facePatch` to
   * give it its twelve (expression × eye-colour) material variants. Bake the
   * face into the skull and that skin multiply lands on the eyes too — a deep
   * skin tone would drive the plum ink to near-black, and there is no black in
   * this game — and the twelve variants would have to be crossed with skin tone
   * as well, which is the combinatorial blow-up the crowd exists to avoid.
   *
   * See `createBakedFace`'s header for the general rule: bake when the texture
   * can carry the head's colour, keep the patch when something else has to.
   */
  facePatch?: boolean;
  /**
   * Where the body and head's shape comes from.
   *
   * - `'authored'` (the default) — `art/assets/kid.glb`, via
   *   `models/kidAsset.ts`. Geometry and UVs authored together in one file.
   * - `'procedural'` — the primitives the asset was generated from, still here
   *   and still built by the same code.
   *
   * **The procedural path is kept for one reason and it is not nostalgia.** A
   * parity claim has to be checked against the *previous* rendering, not
   * against the constants of the change being made; comparing new code with
   * new code is a tautology, and this project has filed a false "verified" that
   * way twice (ART-AGENT-NOTES.md §6). `check:character-parity` builds one of
   * each in a single process and measures the difference. Nothing in the game
   * passes this — it is for the harness.
   */
  geometry?: 'authored' | 'procedural';
}

export interface KidHandle extends CreatureHandle {
  /** The kid always has all four limbs, so callers need no null check. */
  readonly limbs: CreatureLimbs;
  /** Where a hat sits. Parent hat meshes here. */
  readonly hatAnchor: Group;
  /**
   * Height of {@link hatAnchor} above the feet, in metres — the crown of the
   * (bare) head. A worn hat's own `height` (`art/models/hats.ts`, measured
   * from that same anchor point to its tip) adds on top of this, which is
   * what lets a name label clear whatever is currently worn instead of
   * sitting at a fixed height tuned only for bare hair.
   */
  readonly hatAnchorHeight: number;
  /**
   * Where a single hair accessory sits — a picked flower, say.
   *
   * Offset from `hatAnchor` (the crown centre) rather than sharing it, so a
   * hat and a hair flower can be worn at the same time instead of one
   * replacing the other.
   */
  readonly hairAnchor: Group;
  /** Where a carried toy sits. */
  readonly holdAnchor: Group;
  /**
   * Where a peeking creature's head pops out of the bag.
   *
   * Moves with the shape worn — a creature-head bag opens above its ears, a
   * sewn one at its rim — so a caller that keeps this group (the parade does)
   * always has the mouth of the bag actually on the child's back.
   */
  readonly backpackAnchor: Group;
  /**
   * Where a jet pack straps on — the middle of her back.
   *
   * A separate anchor from {@link backpackAnchor}, which is the *mouth* of the
   * bag (higher, and wherever the worn shape happens to open). See
   * `art/models/jetpack.ts`.
   */
  readonly jetpackAnchor: Group;
  /**
   * Where glasses sit — the bridge of the nose, at the painted eyes' own
   * height. A separate anchor from {@link hatAnchor} (the crown) and
   * {@link hairAnchor} (a clip, up and to one side), so a sun hat and
   * sunglasses can be worn together without either fighting the other for a
   * mount point: a hat's brim already has to clear the eye line by contract
   * (`hats.ts`'s `browLine`, gated against {@link kidEyeTopAt}), and this
   * anchor sits exactly at that line, so nothing legitimately worn on the
   * head competes with it. See `art/models/glasses.ts`.
   */
  readonly glassesAnchor: Group;
  /**
   * Every backpack mesh built, each tagged with the kinds that show it.
   *
   * The twin of {@link hairParts}, and exposed for the same caller: the NPC
   * crowd maps prototype meshes onto shapes without knowing what a strap is.
   */
  readonly backpackParts: readonly BackpackPart[];
  /**
   * Where a worn keychain hangs — low on the bag's side, clear of
   * {@link backpackAnchor} (the bag's *mouth*, used by a peeking creature's
   * head) so the two never overlap. See `entities/WornKeychain.ts`.
   */
  readonly keychainAnchor: Group;
  /**
   * Every hair mesh built, each tagged with the styles that show it.
   *
   * Exposed as typed objects rather than found by name, so the NPC crowd can
   * map prototype meshes onto styles without knowing what a "bunch" is — see
   * `entities/npc/kidCrowd.ts`.
   */
  readonly hairParts: readonly HairPart[];
  /**
   * Whether the **worn hairstyle**, not any hat, decides a hat cannot show —
   * Mohican, today (`art/models/hair.ts`'s `HairPart.hideUnderHat`; its own
   * `HairRig.hidesHat` is what this mirrors). Read by whoever is about to
   * attach or show a hat mesh — `entities/WornHat.ts` in the running park,
   * `ui/characterCreationPreview.ts` in the creator — **before** doing so:
   * the hat is what disappears, never the hair. Jim's words, 31 July 2026:
   * "just allow any hair other than rooster with a hat, and disable the hat,
   * not the hair in this case."
   */
  readonly hairHidesHat: boolean;
  /**
   * Every shoe mesh built beyond the bare foot blob, each tagged with the
   * kinds that show it — the twin of {@link backpackParts}/{@link hairParts},
   * for the same caller: the NPC crowd maps prototype meshes onto pairs
   * without knowing what a toe cap is. The plain pair has no parts of its
   * own here — it *is* the bare, painted foot blob, which is not a "part" any
   * kind can hide, so it is not in this list.
   */
  readonly shoeParts: readonly ShoePart[];
  setSkinColour(colour: number): void;
  /**
   * Paints a face-paint design over the face, or washes it off.
   *
   * On a baked face this repaints the skull's own canvases in place; the design
   * lands on the eyes and cheeks this character actually has, rather than on
   * the default layout a separate overlay decal had to assume.
   */
  setFacePaint(design: FacePaintDesign | null): void;
  setHairColour(colour: number): void;
  /**
   * Recolours the outfit. `armsColour` defaults to `colour` — a plain,
   * single-tone repaint, exactly what every existing caller does — so it is
   * only ever passed when the arms should read as a different colour from the
   * body, the way {@link KidOptions.outfitArms} works at construction time.
   */
  setOutfitColour(colour: number, armsColour?: number): void;
  setShoeColour(colour: number): void;
  /**
   * Switches which built style is shown. Only styles passed as
   * `KidOptions.hairStyles` exist to switch to; anything else hides all hair.
   */
  setHairStyle(style: HairStyle): void;
  /**
   * Switches which built backpack shape is shown. Only shapes passed as
   * `KidOptions.backpackKinds` exist to switch to; anything else leaves her
   * wearing nothing but the straps.
   */
  setBackpackKind(kind: BackpackKind): void;
  /**
   * Switches which built pair is shown, and repaints the foot blob for it
   * (see `art/models/shoes.ts`'s `FOOT_COLOUR` — a sandal bares the foot in
   * skin tone regardless of the chosen shoe colour, everything else keeps the
   * chosen colour). Only pairs passed as `KidOptions.shoeKinds` exist to
   * switch to.
   */
  setShoeKind(kind: ShoeKind): void;
  /**
   * Tells the model a hat's attachment just changed, so `height` re-measures
   * — a hat mesh added to `hatAnchor` (which sits inside `root`) can change
   * what `visibleTop` finds. Called by `entities/WornHat.ts` and by the
   * creator's preview, right after they attach or remove a hat mesh.
   *
   * Despite the name, this **no longer decides whether any hair tucks away**
   * — see {@link hairHidesHat}, which the caller has to check *before*
   * deciding whether to attach a hat mesh at all. `worn` is kept only
   * because callers already know it at the call site and a bare
   * "remeasure()" reads oddly out of context; the remeasure itself happens
   * either way.
   */
  setHatWorn(worn: boolean): void;
  /**
   * Tells the model a jet pack is on, so her bag gets out of its way — you
   * cannot strap two things to one back. See `BackpackRig.setHidden`.
   * Called by `entities/WornJetpack.ts`.
   */
  setJetpackWorn(worn: boolean): void;
  /**
   * Advances the simulated ponytail, if this kid is wearing one. `dt` is the
   * game's already-time-scaled delta. Safe (and free) to call on any kid.
   */
  update(dt: number): void;
  /**
   * Hangs the simulated ponytail straight down from wherever its anchor is
   * **now**, with no catch-up swing. Safe (and free) to call on any kid.
   *
   * Call this after moving or re-parenting a kid that has already been built:
   * the tail is simulated in world space, so a model constructed at the origin
   * and then added to something rotated (the character creator's turntable) or
   * placed somewhere else has a tail that is, as far as the simulation knows,
   * simply in the wrong place — and it will visibly whip across to catch up.
   * `update()` recovers from that on its own only past
   * `PonytailChain`'s teleport threshold, which a metre-scale move does not
   * reach.
   */
  resetHair(): void;
}

export function createKid(options: KidOptions = {}): KidHandle {
  const {
    skin = ART.kidSkin,
    hair = ART.kidHair,
    outfit = ART.kidOutfit,
    // Defaults to the body colour — see `KidOptions.outfitArms`'s doc comment.
    outfitArms = outfit,
    shoe = ART.kidShoe,
    shoeKind = 'plain',
    hairStyle = 'bunches',
    backpack = true,
    backpackColour = ART.kidBackpack,
    backpackKind = 'satchel',
    eyeColour = ART.kidEye,
  } = options;

  const authored = options.geometry !== 'procedural';

  const root = new Group();
  root.name = 'kid';
  const body = new Group();
  // Named for the same reason the meshes below are: the exported asset is a
  // node hierarchy, and `applyWalk` finds nothing by name but a glTF round trip
  // renames anything anonymous. See {@link KID_BODY_PARTS}.
  body.name = 'body';
  root.add(body);

  const skinMat = toonMaterial(skin);
  const outfitMat = toonMaterial(outfit);
  const outfitDarkMat = toonMaterial(new Color(outfit).multiplyScalar(0.82).getHex());
  // A separate material from `outfitMat` even when the two colours are equal —
  // the ordinary case — rather than reusing one material for both: the arms
  // need their own colour to be independently settable later
  // (`setOutfitColour`'s `armsColour`), and sharing a material would tie them
  // to the torso's colour again the moment anyone recoloured it.
  const outfitArmsMat = toonMaterial(outfitArms);
  const hairMat = toonMaterial(hair);
  const hairDarkMat = toonMaterial(new Color(hair).multiplyScalar(0.86).getHex());
  const shoeMat = toonMaterial(shoe);
  const bagMat = toonMaterial(backpackColour);
  const bagDarkMat = toonMaterial(new Color(backpackColour).multiplyScalar(0.82).getHex());
  const bobbleMat = toonMaterial(ART.kidBobble);

  const limbs = makeLimbs();

  /**
   * One body or head part — from the authored asset, or built from primitives.
   *
   * The asset (`art/assets/kid.glb`, read by `models/kidAsset.ts`) owns each
   * part's **shape, UVs and where that shape sits in its own parent**. The rig
   * around them — `body`, `head`, `crown`, the limb pivots and the four anchors
   * — stays here, driven by `KID_HEAD_HEIGHT`, `SKULL_RADIUS` and
   * `KID_HEAD_SCALE`, because hats, hair and three check scripts import those
   * and a copy in the asset would be a second description of them.
   *
   * `make` is the *procedural* shape, and it is the code the asset was
   * generated from — kept alive, and reachable with `geometry: 'procedural'`,
   * because a parity claim has to compare against the previous rendering rather
   * than against the new code. That mistake has been made twice on this
   * project; see ART-AGENT-NOTES.md §6. `check:character-parity` builds both in
   * one process and compares them vertex for vertex.
   */
  const part = (
    name: KidBodyPart,
    material: Material,
    shadow: <T extends Mesh>(mesh: T) => T,
    make: () => Mesh,
  ): Mesh => {
    const mesh = authored ? kidAssetMesh(name, material) : make();
    mesh.name = name;
    // Applied here rather than left to `blob`/`stub`, so the authored path and
    // the procedural one cannot disagree about whether a part casts a shadow.
    return shadow(mesh);
  };

  // --- torso -------------------------------------------------------------------
  // Short and wide. Under a head this big the torso is a dumpling, not a trunk:
  // 0.80 m tall where it used to be 0.88, and the top 0.27 m of it disappears up
  // inside the skull, which is exactly what hides the neck.
  //
  // Named so the character creator's preview can measure the jumper and frame
  // the body on it when the child changes their clothes colour — see
  // `ui/characterCreationPreview.ts`. The limb pivots alone stop at the
  // shoulders, which leaves the collar and most of the jumper out of shot.
  const torso = part('torso', outfitMat, solid, () => {
    const mesh = stub(0.325, 0.15, outfitMat);
    mesh.position.y = 0.6;
    mesh.scale.set(1.06, 1, 0.92);
    return mesh;
  });
  body.add(torso);
  addOutline(torso, 0.02);

  // Neckline. Sits just *below* the bottom of the skull — any higher and the
  // head swallows it whole and the jumper appears to have no opening.
  const collar = part('collar', outfitDarkMat, solid, () => {
    const mesh = new Mesh(new TorusGeometry(0.26, 0.055, 8, 22), outfitDarkMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.71;
    return mesh;
  });
  body.add(collar);

  // Skirt hem — a flared ring that stops the torso reading as a plain pill.
  const hem = part('hem', outfitDarkMat, solid, () => {
    const mesh = new Mesh(new TorusGeometry(0.3, 0.075, 8, 24), outfitDarkMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.4;
    mesh.scale.set(1.06, 1.06, 0.7);
    return mesh;
  });
  body.add(hem);

  // --- arms ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.name = `arm-pivot-${sideTag(side)}`;
    // Shoulders set wide and low so the arms swing clear of the skull, and wider
    // than the skirt hem (0.32) so the hands are not swallowed by it — with a
    // torso this short, an arm tucked inside the silhouette simply disappears.
    pivot.position.set(side * 0.38, 0.72, 0);
    body.add(pivot);

    // The one part that wears `outfitArmsMat` rather than `outfitMat` — see
    // `KidOptions.outfitArms`. Everything else the jumper touches (torso,
    // collar, hem) stays on the body colour.
    const upper = part(`arm-upper-${sideTag(side)}`, outfitArmsMat, solid, () => {
      const mesh = stub(0.105, 0.16, outfitArmsMat);
      mesh.position.y = -0.14;
      return mesh;
    });
    pivot.add(upper);

    // The hands are named for the same reason as the backpack: the arc these
    // swing through is the other thing long hair must not be caught in.
    // Side-suffixed since the asset needs every node uniquely named —
    // `check:hair` sweeps both, so it looks them up through `KID_BODY_PARTS`
    // rather than by a bare `'hand'` that used to match two meshes at once.
    const hand = part(`hand-${sideTag(side)}`, skinMat, solid, () => {
      const mesh = blob(0.135, skinMat, [1, 1, 1], 18);
      mesh.position.y = -0.32;
      return mesh;
    });
    pivot.add(hand);
    addOutline(hand, 0.012);
  }

  const holdAnchor = new Group();
  holdAnchor.name = 'holdAnchor';
  holdAnchor.position.set(0, -0.42, 0.1);
  limbs.rightArm.add(holdAnchor);

  // --- legs ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.name = `leg-pivot-${sideTag(side)}`;
    pivot.position.set(side * 0.155, 0.36, 0);
    body.add(pivot);

    const leg = part(`leg-upper-${sideTag(side)}`, skinMat, solid, () => {
      const mesh = stub(0.12, 0.1, skinMat);
      mesh.position.y = -0.1;
      return mesh;
    });
    pivot.add(leg);

    // Big round shoes. Oversized feet read as "toy" from the iso camera — and
    // they carry even more weight now, because they are most of the body.
    const foot = part(`foot-${sideTag(side)}`, shoeMat, solid, () => {
      const mesh = blob(0.175, shoeMat, [1, 0.78, 1.28], 18);
      mesh.position.set(0, -0.22, 0.045);
      return mesh;
    });
    pivot.add(foot);
    addOutline(foot, 0.014);
  }

  // The plain pair *is* the foot blob just built above, painted `shoeMat` —
  // `art/models/shoes.ts`'s own doc comment is explicit that this file dresses
  // that blob rather than replacing it, unlike `buildBackpacks` below, which
  // fully owns what it draws. One call, not one per leg: `buildShoes` takes
  // both pivots at once and mirrors internally, the same shape `buildHair`
  // and `buildBackpacks` already use for a part that is naturally a pair.
  const shoeRig = buildShoes({
    legs: [limbs.leftLeg, limbs.rightLeg],
    footMaterial: shoeMat,
    kind: shoeKind,
    ...(options.shoeKinds ? { kinds: options.shoeKinds } : {}),
  });

  // --- backpack -------------------------------------------------------------------
  // Every shape lives in `art/models/backpacks.ts`, for the same reason hair
  // does: the NPC crowd needs one prototype carrying several shapes at once
  // while the player wears exactly one. `backpack: false` (the pet-shop display
  // kids, say) builds nothing at all and leaves the anchor sitting at the origin.
  const backpackRig = backpack
    ? buildBackpacks({
        body,
        bagMaterial: bagMat,
        bagDarkMaterial: bagDarkMat,
        kind: backpackKind,
        ...(options.backpackKinds ? { kinds: options.backpackKinds } : {}),
      })
    : null;
  const backpackAnchor = backpackRig?.anchor ?? new Group();

  // Where a jet pack straps on — the middle of the bag's own patch of back, so
  // the rocket takes the place the rucksack was in rather than hovering behind
  // it. `art/models/jetpack.ts` is authored around this exact point, which is
  // what lets it mount with no offset maths at all.
  const jetpackAnchor = new Group();
  jetpackAnchor.name = 'jetpackAnchor';
  jetpackAnchor.position.set(0, 0.56, -0.32);
  body.add(jetpackAnchor);

  // Where a worn keychain hangs. Comes from the bag's own rig, per shape, and
  // moves when she switches bags — `backpacks.ts` owns the number because it
  // owns the shapes (see `CHARM_HANGS`). A separate anchor from
  // `backpackAnchor`, which is the bag's *mouth*: a charm hung there would
  // dangle over a peeking creature's head (`BackpackPeek`).
  //
  // `backpack: false` (the pet-shop display kids) leaves this an unparented
  // `Group` at the origin, exactly as `backpackAnchor` does — a real object to
  // hand back rather than `undefined`, with nothing to hang off.
  const keychainAnchor = backpackRig?.charmAnchor ?? new Group();

  // --- head --------------------------------------------------------------------
  // Everything below is authored at `× HEAD`. The pivot came *down* from 1.34 to
  // 1.36 rather than up by half the extra radius, because the head is meant to
  // sit ON the shoulders like a snowman's — a big head on a visible neck wobbles.
  const head = new Group();
  head.name = 'head';
  head.position.y = KID_HEAD_HEIGHT;
  body.add(head);

  // Everything visible hangs off `crown`, which is tilted back a few degrees so
  // the face still points at the ISO CAMERA rather than at the grass. From 38°
  // above, an untilted head this large shows the player nothing but hair.
  const crown = new Group();
  crown.name = 'crown';
  crown.rotation.x = -HEAD_TILT;
  head.add(crown);

  const skullR = SKULL_RADIUS;
  const skull = part('skull', skinMat, solid, () => blob(skullR, skinMat, [1, 0.95, 0.98], 38));
  crown.add(skull);
  addOutline(skull, 0.02);

  const hatAnchor = new Group();
  hatAnchor.name = 'hatAnchor';
  hatAnchor.position.set(0, 0.42 * HEAD, 0);
  crown.add(hatAnchor);

  // Tucked over the left bunch, clear of the hat anchor's crown-centre mount —
  // a flower worn here reads as "in her hair" alongside a hat rather than
  // fighting it for the same spot.
  const hairAnchor = new Group();
  hairAnchor.name = 'hairAnchor';
  hairAnchor.position.set(0.32 * HEAD, 0.22 * HEAD, 0.14 * HEAD);
  crown.add(hairAnchor);

  // Midpoint between the painted eyes, at their own height — see
  // `kidEyeCentre`'s doc comment for why this is one description of "where the
  // eyes are" rather than a second, hand-placed one. `kidEyeCentre(-1).y` and
  // `.z` already equal `kidEyeCentre(1)`'s (the two eyes are mirror images at
  // the same height and depth), but the midpoint is taken explicitly anyway
  // so this keeps doing the sensible thing if the face layout ever stops being
  // perfectly symmetric.
  const glassesAnchor = new Group();
  glassesAnchor.name = 'glassesAnchor';
  const eyeL = kidEyeCentre(-1);
  const eyeR = kidEyeCentre(1);
  glassesAnchor.position.set(0, (eyeL.y + eyeR.y) / 2, (eyeL.z + eyeR.z) / 2);
  crown.add(glassesAnchor);

  // --- hair --------------------------------------------------------------------
  // Every style lives in `art/models/hair.ts`, which hangs the head-mounted
  // parts off `crown` and the simulated ponytail off `root`. It is a separate
  // module because the NPC crowd needs a prototype carrying *all* the styles at
  // once while the player needs exactly one — see that file's header.
  const hairRig = buildHair({
    crown,
    root,
    head: HEAD,
    skull: SKULL_RADIUS,
    headTilt: HEAD_TILT,
    hairMaterial: hairMat,
    hairDarkMaterial: hairDarkMat,
    bobbleMaterial: bobbleMat,
    style: hairStyle,
    ...(options.hairStyles ? { styles: options.hairStyles } : {}),
  });

  for (const side of [-1, 1] as const) {
    const ear = part(`ear-${sideTag(side)}`, skinMat, decal, () => {
      const mesh = blob(0.085 * HEAD, skinMat, [0.55, 1, 0.85], 12);
      mesh.position.set(side * 0.42 * HEAD, -0.04 * HEAD, 0.02 * HEAD);
      return mesh;
    });
    crown.add(ear);
  }

  // --- face ------------------------------------------------------------------
  //
  // Baked into the skull's own texture by default (ART_DIRECTION.md §3, and
  // CLAUDE.md's rule for worn faces — this is the same idea applied to a head).
  // The skull is a `blob`, which is to say a plain `SphereGeometry` with the
  // squash on `mesh.scale`, so remapping its UVs costs nothing and the face
  // comes out on exactly the part of the skull the patch used to cover.
  //
  // The crowd's prototype keeps the old patch — see `KidOptions.facePatch`.
  const facePaint = {
    ...KID_FACE,
    size: 512,
    iris: eyeColour,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.215,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  } as const;

  let bakedFace: BakedFace | null = null;
  let patchFace: FacePatch | null = null;
  if (options.facePatch) {
    patchFace = createFacePatch({ radius: skullR, ...facePaint });
    patchFace.mesh.scale.set(...FACE_SQUASH);
    crown.add(patchFace.mesh);
  } else {
    bakedFace = createBakedFace({ fill: skin, ...facePaint });
    // An authored skull already **is** the face window: the unwrap was made
    // beside the geometry rather than recomputed from it afterwards, which is
    // the whole point of Stage A. `remapSphereFaceUv` is therefore not called
    // at all on that path — one fewer description of the same surface, and the
    // one geometry can then be shared by every child in the park because
    // nothing writes to it.
    bakedFace.applyTo(skull, { uvsAuthored: authored });
  }

  // Measured rather than hand-derived from `KID_HEAD_HEIGHT` + the anchor's
  // own local offset: the anchor rides on `crown`, which is tipped back by
  // `HEAD_TILT`, and reading the real world position is one call instead of
  // a trigonometry sum that would need re-deriving every time the head rig
  // changes. `root` has no transform of its own, so this world position is
  // already "above the feet".
  root.updateMatrixWorld(true);
  const hatAnchorWorldPosition = new Vector3();
  hatAnchor.getWorldPosition(hatAnchorWorldPosition);

  // Hang the tail straight down before measuring, so the segments are in a
  // real rest pose rather than piled at the model's origin.
  hairRig.ponytail?.reset();

  let measuredHeight = visibleTop(root);

  return {
    root,
    body,
    head,
    limbs,
    hatAnchor,
    hatAnchorHeight: hatAnchorWorldPosition.y,
    hairAnchor,
    holdAnchor,
    backpackAnchor,
    jetpackAnchor,
    glassesAnchor,
    backpackParts: backpackRig?.parts ?? [],
    keychainAnchor,
    hairParts: hairRig.parts,
    get hairHidesHat() {
      return hairRig.hidesHat;
    },
    shoeParts: shoeRig.parts,
    // Measured, not `KID_HEIGHT`: spiky hair is a good 0.24 m taller than a
    // bob, and a name label placed from a constant would sit inside it.
    //
    // A **getter**, because the answer changes while the character is alive:
    // switching from a bob to Spiky changes it by that same 0.24 m, and a
    // height snapshotted at construction would leave the label pointing at
    // nowhere near her actual crown. Re-measured only when the style or a
    // hat's own attachment actually changes — never per frame.
    get height() {
      return measuredHeight;
    },
    setExpression: (name: Expression) => (bakedFace ?? patchFace)?.setExpression(name),
    setHairStyle: (style: HairStyle) => {
      hairRig.setStyle(style);
      measuredHeight = visibleTop(root);
    },
    // No re-measure: every backpack shape sits on the small of her back, a
    // metre below the top of her hair, so none of them can be what makes the
    // character taller. A `visibleTop` walk per switch would be a whole model's
    // worth of vertices for a number that cannot have changed.
    setBackpackKind: (kind: BackpackKind) => backpackRig?.setKind(kind),
    // No re-measure either, and for the same reason: a bag hidden under a jet
    // pack is a metre below the top of her hair, so neither it nor the rocket
    // that replaced it can be what makes the character taller.
    setJetpackWorn: (worn: boolean) => backpackRig?.setHidden(worn),
    // No re-measure, for the same reason `setBackpackKind` skips one: every
    // shoe part is cut from the foot blob's own small ellipsoid, nowhere near
    // tall enough to be what `visibleTop` finds.
    setShoeKind: (kind: ShoeKind) => shoeRig.setKind(kind),
    // `worn` itself is unused now — see the interface doc comment on
    // `setHatWorn` for why this stays a "tell me something changed" call
    // rather than losing the parameter, and why the hair rig is no longer
    // told anything at all.
    setHatWorn: (_worn: boolean) => {
      measuredHeight = visibleTop(root);
    },
    update: (dt: number) => hairRig.ponytail?.update(dt),
    resetHair: () => hairRig.ponytail?.reset(),
    setWalkPhase: (phase: number, speed: number) => applyWalk(limbs, body, phase, speed, 0.85, 0.09),
    setSkinColour: (colour: number) => {
      // Two things wear the skin now: the shared material (hands, legs, ears)
      // and, on a baked face, the skull's own texture, whose background fill
      // *is* the skin. `setFill` no-ops when the colour has not changed, so the
      // creator repainting on every tap costs nothing when only hair moved.
      skinMat.color.setHex(colour);
      bakedFace?.setFill(colour);
    },
    setFacePaint: (design: FacePaintDesign | null) => bakedFace?.setFacePaint(design),
    setHairColour: (colour: number) => {
      hairMat.color.setHex(colour);
      hairDarkMat.color.copy(new Color(colour).multiplyScalar(0.86));
    },
    setOutfitColour: (colour: number, armsColour: number = colour) => {
      outfitMat.color.setHex(colour);
      outfitDarkMat.color.copy(new Color(colour).multiplyScalar(0.82));
      outfitArmsMat.color.setHex(armsColour);
    },
    setShoeColour: (colour: number) => shoeMat.color.setHex(colour),
  };
}

/**
 * Face paint on an already-built kid, and the handle that swaps the design (or
 * washes it off).
 *
 * **This used to build a second decal patch** over the face patch: a third
 * curved shell, at its own radius, in its own tilt group, mirroring
 * {@link FACE_SQUASH} by hand. It is now a repaint of the skull's own texture,
 * so it is a layer in a canvas rather than a layer in the scene — one fewer
 * mesh, one fewer draw call, and nothing left to keep aligned.
 *
 * That alignment was not hypothetical. The overlay defaulted to `tilt: 0.1` and
 * the *default* eye layout, while the kid's face is built at `KID_FACE`'s
 * `tilt: 0.03` and `eyeY: 0.43` — so every design was aimed at cheeks about
 * 8 cm from where the kid's actually are. Sharing one canvas makes that
 * impossible: the paint and the face are drawn in the same coordinates now.
 *
 * **One implementation, two callers**, which is the point of it living here:
 * `world/FacePaintStall.ts` paints the real player with this, and the face
 * stall's picker previews the choice with the very same call
 * (GAME_DESIGN.md's PREVIEW RULE — the preview must be the same code as the
 * thing it previews, or the two drift).
 *
 * Takes the narrowest thing that can wear paint rather than a whole
 * {@link KidHandle}, because the two callers hold the same kid in different
 * wrappers: the preview has the `KidHandle` itself, while the stall has an
 * `entities/CharacterModel`, which keeps its handle private and re-exposes what
 * is needed.
 */
export function attachFacePaint(model: {
  setFacePaint(design: FacePaintDesign | null): void;
}): FacePaintControl {
  return {
    setDesign(design: FacePaintDesign | null) {
      model.setFacePaint(design);
    },
  };
}
