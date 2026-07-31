import { Color, Group, Mesh, TorusGeometry, Vector3 } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import {
  createFacePaintOverlay,
  createFacePatch,
  type Expression,
  type FacePaintOverlayHandle,
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
 * How far the head is tipped back, in radians (≈ 10°).
 *
 * The game camera looks down at 38°. A head this big, sitting level, presents
 * the player with the top of a hairstyle; tipping it back brings the face — and
 * therefore the eyes, which are 80% of the cuteness — back into view. It also
 * reads as a chin-up, pleased-with-itself pose, which is no bad thing.
 */
const HEAD_TILT = 0.17;

/**
 * The skull's radius, and how the face patch worn on it is squashed to sit
 * flat against that curve.
 *
 * Module constants rather than locals inside {@link createKid} because
 * {@link attachFacePaint} builds a second decal layer onto the same skull and
 * has to agree with the first one exactly. They used to be *copied* into
 * `world/FacePaintStall.ts`, which said so in a comment and asked to be kept
 * in step by hand; there is now one of each.
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

export interface KidOptions {
  skin?: number;
  hair?: number;
  outfit?: number;
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
   * Every backpack mesh built, each tagged with the kinds that show it.
   *
   * The twin of {@link hairParts}, and exposed for the same caller: the NPC
   * crowd maps prototype meshes onto shapes without knowing what a strap is.
   */
  readonly backpackParts: readonly BackpackPart[];
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
  setHairColour(colour: number): void;
  setOutfitColour(colour: number): void;
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
    shoe = ART.kidShoe,
    shoeKind = 'plain',
    hairStyle = 'bunches',
    backpack = true,
    backpackColour = ART.kidBackpack,
    backpackKind = 'satchel',
    eyeColour = ART.kidEye,
  } = options;

  const root = new Group();
  root.name = 'kid';
  const body = new Group();
  root.add(body);

  const skinMat = toonMaterial(skin);
  const outfitMat = toonMaterial(outfit);
  const outfitDarkMat = toonMaterial(new Color(outfit).multiplyScalar(0.82).getHex());
  const hairMat = toonMaterial(hair);
  const hairDarkMat = toonMaterial(new Color(hair).multiplyScalar(0.86).getHex());
  const shoeMat = toonMaterial(shoe);
  const bagMat = toonMaterial(backpackColour);
  const bagDarkMat = toonMaterial(new Color(backpackColour).multiplyScalar(0.82).getHex());
  const bobbleMat = toonMaterial(ART.kidBobble);

  const limbs = makeLimbs();

  // --- torso -------------------------------------------------------------------
  // Short and wide. Under a head this big the torso is a dumpling, not a trunk:
  // 0.80 m tall where it used to be 0.88, and the top 0.27 m of it disappears up
  // inside the skull, which is exactly what hides the neck.
  const torso = stub(0.325, 0.15, outfitMat);
  // Named so the character creator's preview can measure the jumper and frame
  // the body on it when the child changes their clothes colour — see
  // `ui/characterCreationPreview.ts`. The limb pivots alone stop at the
  // shoulders, which leaves the collar and most of the jumper out of shot.
  torso.name = 'torso';
  torso.position.y = 0.6;
  torso.scale.set(1.06, 1, 0.92);
  body.add(torso);
  addOutline(torso, 0.02);

  // Neckline. Sits just *below* the bottom of the skull — any higher and the
  // head swallows it whole and the jumper appears to have no opening.
  const collar = solid(new Mesh(new TorusGeometry(0.26, 0.055, 8, 22), outfitDarkMat));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.71;
  body.add(collar);

  // Skirt hem — a flared ring that stops the torso reading as a plain pill.
  const hem = solid(new Mesh(new TorusGeometry(0.3, 0.075, 8, 24), outfitDarkMat));
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.4;
  hem.scale.set(1.06, 1.06, 0.7);
  body.add(hem);

  // --- arms ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    // Shoulders set wide and low so the arms swing clear of the skull, and wider
    // than the skirt hem (0.32) so the hands are not swallowed by it — with a
    // torso this short, an arm tucked inside the silhouette simply disappears.
    pivot.position.set(side * 0.38, 0.72, 0);
    body.add(pivot);

    const upper = stub(0.105, 0.16, outfitMat);
    upper.position.y = -0.14;
    pivot.add(upper);

    const hand = blob(0.135, skinMat, [1, 1, 1], 18);
    // Named for the same reason as the backpack: the arc these swing through
    // is the other thing long hair must not be caught in.
    hand.name = 'hand';
    hand.position.y = -0.32;
    pivot.add(hand);
    addOutline(hand, 0.012);
  }

  const holdAnchor = new Group();
  holdAnchor.position.set(0, -0.42, 0.1);
  limbs.rightArm.add(holdAnchor);

  // --- legs ---------------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.155, 0.36, 0);
    body.add(pivot);

    const leg = stub(0.12, 0.1, skinMat);
    leg.position.y = -0.1;
    pivot.add(leg);

    // Big round shoes. Oversized feet read as "toy" from the iso camera — and
    // they carry even more weight now, because they are most of the body.
    const foot = blob(0.175, shoeMat, [1, 0.78, 1.28], 18);
    foot.position.set(0, -0.22, 0.045);
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

  // --- head --------------------------------------------------------------------
  // Everything below is authored at `× HEAD`. The pivot came *down* from 1.34 to
  // 1.36 rather than up by half the extra radius, because the head is meant to
  // sit ON the shoulders like a snowman's — a big head on a visible neck wobbles.
  const head = new Group();
  head.position.y = KID_HEAD_HEIGHT;
  body.add(head);

  // Everything visible hangs off `crown`, which is tilted back a few degrees so
  // the face still points at the ISO CAMERA rather than at the grass. From 38°
  // above, an untilted head this large shows the player nothing but hair.
  const crown = new Group();
  crown.rotation.x = -HEAD_TILT;
  head.add(crown);

  const skullR = SKULL_RADIUS;
  const skull = blob(skullR, skinMat, [1, 0.95, 0.98], 38);
  crown.add(skull);
  addOutline(skull, 0.02);

  const hatAnchor = new Group();
  hatAnchor.position.set(0, 0.42 * HEAD, 0);
  crown.add(hatAnchor);

  // Tucked over the left bunch, clear of the hat anchor's crown-centre mount —
  // a flower worn here reads as "in her hair" alongside a hat rather than
  // fighting it for the same spot.
  const hairAnchor = new Group();
  hairAnchor.position.set(0.32 * HEAD, 0.22 * HEAD, 0.14 * HEAD);
  crown.add(hairAnchor);

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
    const ear = decal(blob(0.085 * HEAD, skinMat, [0.55, 1, 0.85], 12));
    ear.position.set(side * 0.42 * HEAD, -0.04 * HEAD, 0.02 * HEAD);
    crown.add(ear);
  }

  // --- face ------------------------------------------------------------------
  const face = createFacePatch({
    radius: skullR,
    ...KID_FACE,
    size: 512,
    iris: eyeColour,
    mouth: 'smile',
    mouthW: 0.075,
    mouthDrop: 0.215,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.1,
  });
  face.mesh.scale.set(...FACE_SQUASH);
  crown.add(face.mesh);

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
    backpackParts: backpackRig?.parts ?? [],
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
    setExpression: (name: Expression) => face.setExpression(name),
    setHairStyle: (style: HairStyle) => {
      hairRig.setStyle(style);
      measuredHeight = visibleTop(root);
    },
    // No re-measure: every backpack shape sits on the small of her back, a
    // metre below the top of her hair, so none of them can be what makes the
    // character taller. A `visibleTop` walk per switch would be a whole model's
    // worth of vertices for a number that cannot have changed.
    setBackpackKind: (kind: BackpackKind) => backpackRig?.setKind(kind),
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
    setSkinColour: (colour: number) => skinMat.color.setHex(colour),
    setHairColour: (colour: number) => {
      hairMat.color.setHex(colour);
      hairDarkMat.color.copy(new Color(colour).multiplyScalar(0.86));
    },
    setOutfitColour: (colour: number) => {
      outfitMat.color.setHex(colour);
      outfitDarkMat.color.copy(new Color(colour).multiplyScalar(0.82));
    },
    setShoeColour: (colour: number) => shoeMat.color.setHex(colour),
  };
}

/**
 * Puts a face-paint decal layer on an already-built kid and hands back the
 * handle that swaps the design (or hides it again, for "wash it off").
 *
 * Opt-in rather than part of {@link createKid}, because most kids in the park
 * never wear paint and the NPC crowd instances every mesh it finds on its
 * prototype — an always-present overlay would cost the whole crowd a draw
 * layer nobody asked for.
 *
 * **One implementation, two callers**, which is the point of it living here:
 * `world/FacePaintStall.ts` paints the real player with this, and the face
 * stall's picker previews the choice with the very same call
 * (GAME_DESIGN.md's PREVIEW RULE — the preview must be the same code as the
 * thing it previews, or the two drift). The stall used to carry its own copies
 * of {@link SKULL_RADIUS}, {@link FACE_SQUASH} and `HEAD_TILT` with a note
 * asking for them to be updated by hand if the head was ever retuned; that
 * note is now unnecessary.
 *
 * The tilt group reproduces `crown`'s own rotation, so the overlay sits in
 * exactly the space `createFacePatch`'s mesh does — the expression it is drawn
 * over — rather than in the untilted head's.
 *
 * Takes the head rather than a whole {@link KidHandle} because that is all it
 * needs, and because the two callers hold the same kid in different wrappers:
 * the preview has the `KidHandle` itself, while the stall has a
 * `entities/CharacterModel`, which keeps its handle private and re-exposes
 * `head`. Anything passed here must be a head built by {@link createKid} —
 * the radius and tilt above are this model's, not a general creature's.
 */
export function attachFacePaint(model: { readonly head: Group }, size = 512): FacePaintOverlayHandle {
  const tilt = new Group();
  tilt.name = 'facePaintTilt';
  tilt.rotation.x = -HEAD_TILT;
  model.head.add(tilt);

  const overlay = createFacePaintOverlay(SKULL_RADIUS, { size });
  overlay.mesh.scale.set(...FACE_SQUASH);
  tilt.add(overlay.mesh);
  return overlay;
}
