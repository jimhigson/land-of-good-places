import { CylinderGeometry, Group, Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ART } from '../style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../style/materials';
import {
  applyStaticBakedFace,
  createBakedFace,
  facePatchGeometry,
  type BakedFaceOptions,
  type Expression,
} from '../style/faces';
import { applyWalk, blob, makeLimbs, stub, type CreatureHandle } from '../style/asset';

/**
 * RiPika — the park's electric yellow mouse. Eleri's favourite.
 *
 * Design notes (why it looks the way it does, for anyone making a variant):
 *  - Head is 62% of the total height. That is extreme even for this game, and
 *    it is the reason RiPika reads as "cute" from three metres away in the iso
 *    camera while a realistic mouse would read as "rodent".
 *  - The ears are short-for-their-kind and rounded at the tip, with cocoa caps.
 *    Long needle ears look sharp and sharp is not cute.
 *  - The tail is a soft zig-zag "flash" of three rounded slabs, warming from
 *    yellow to amber at the tip — a lightning shape without a lightning edge.
 *  - The cheeks are painted, not modelled: solid tomato discs on the face patch,
 *    big enough to touch the eyes. Modelled cheeks catch shadow and go muddy.
 *  - A cream tummy and a cream collar flash break up the yellow so the body does
 *    not read as one undifferentiated blob at distance.
 *
 * **Cartoon pass (26 July 2026).** The head is authored at {@link HEAD} × its
 * original size. RiPika did not get the kid's full 1.5×: it started at half its
 * own height in skull alone, and a literal doubling leaves a mouse with no room
 * for a mouse. 1.32× puts the skull at 62% of the total and the ears still fit
 * on the screen.
 */

/**
 * Head scale-up over the original authoring. The one knob for RiPika's skull.
 *
 * Still exported, but nothing outside this file reads it any more. The RiPika
 * hat used to: it *was* this head, built at this scale and perched on the
 * wearer's crown. That is the reading the family rejected on 31 July — a hat
 * shaped like an animal and a shrunken live animal are different objects — so
 * the hat is now its own design in `hoodShell.ts` and takes nothing from here
 * but the palette and the character of the ears.
 */
export const RIPIKA_HEAD_SCALE = 1.32;

/** Local shorthand for {@link RIPIKA_HEAD_SCALE}. */
const HEAD = RIPIKA_HEAD_SCALE;

/**
 * The tail's resting pitch, in radians — how far the zig-zag flash is tipped
 * **back** from vertical, so it trails behind her the way a tail does.
 *
 * Applied as `rotation.x = -TAIL_CANT`: negative pitches the tail towards −Z,
 * and +Z is forward under the asset contract. At 1.05 rad it stands about 30°
 * above horizontal, which keeps the flash clear of the body without turning it
 * into a flagpole.
 *
 * **It used to be a roll (`rotation.z`), fanning the tail out sideways.** Jim
 * looked at it in the park on 5 August 2026: "tail should extend behind, not to
 * the side — rotate it 90º and relocate to match". Rotating alone would have
 * swung the tail through the hip it was still pinned to, so the mount moved to
 * the centre line at the back of the torso in the same change.
 *
 * The old sideways cant was defended in this file as the thing that stopped the
 * tail "hiding behind the body at every camera angle the game ever uses". That
 * worry does not survive contact with the actual camera: it looks **down** at
 * 38°, so a tail trailing back and up projects *up the screen*, landing around
 * shoulder height behind her rather than disappearing. Fanning it sideways was
 * solving a problem an isometric camera does not have.
 *
 * This is a named constant because it was a literal in two places that had to
 * agree and silently did not. `setWalkPhase` ended with
 *
 * ```ts
 * tail.rotation.z = Math.sin(...) * 0.18 * speed;   // the bug
 * ```
 *
 * which is zero whenever `speed` is zero — so it did not return the tail to its
 * rest pose, it **assigned the rest pose away**. Every RiPika in the park stood
 * with a limp, straight-down tail the instant she stopped walking, which is
 * exactly when a child is most likely to be standing still looking at her. The
 * cant is not decoration: the tail is documented right where it is built as the
 * thing without which she "is just a yellow mouse".
 *
 * The shape of the bug is worth remembering, because it is not specific to
 * tails. **A per-frame `x = f(speed)` that multiplies the whole expression by
 * an amplitude destroys any non-zero authored value of `x` when that amplitude
 * reaches zero.** An animation offset must be *added* to the rest pose
 * (`REST + swing`), or the rest pose has to be zero. `applyWalk` gets away with
 * the multiply-only form purely because every limb it drives is authored at
 * rotation zero.
 */
const TAIL_CANT = 1.05;

/**
 * A few degrees of yaw at rest, so the tail is not dead-square behind her.
 * ART_DIRECTION §4, "nothing is plumb". Static — nothing animates it.
 */
const TAIL_YAW = 0.12;
/**
 * RiPika's six colours, as one swappable set.
 *
 * Exists so the fountain statue can be **this** mouse rendered in stone rather
 * than a second mouse carved to look like it (`models/ripikaStatue.ts`). Two
 * models of one character have to be kept in step by hand forever; one model
 * with two colourways cannot drift, and a retune of RiPika's proportions
 * reaches her statue for free.
 *
 * The fields are named for the live mouse's colours rather than for their role
 * ("yellow", not "primary") on purpose — every number inside this file is
 * written against RiPika, and renaming them to something colour-neutral would
 * make the model harder to read to buy nothing.
 */
export interface RipikaPalette {
  /** Skull, torso, ear shafts, arms — and the baked face's background fill. */
  readonly yellow: number;
  /** Cowlick tuft and thighs: one step down, so they read against the body. */
  readonly yellowDeep: number;
  /** Tummy and collar flash. The lightest step. */
  readonly belly: number;
  /** Ear tips, feet, paws, painted nose. The darkest step. */
  readonly tip: number;
  /** The tail's warm tip. */
  readonly bolt: number;
  /** The painted cheek discs. */
  readonly cheek: number;
}

/** RiPika as she actually is: the electric yellow mouse. */
export const RIPIKA_PALETTE: RipikaPalette = {
  yellow: ART.ripikaYellow,
  yellowDeep: ART.ripikaYellowDeep,
  belly: ART.ripikaBelly,
  tip: ART.ripikaTip,
  bolt: ART.ripikaBolt,
  cheek: ART.ripikaCheek,
};

/**
 * The tail's resting roll, and the value its **wag** swings around.
 *
 * ## The wag is on `z`, and it took a review to get that right
 *
 * When the tail moved behind her I moved the wag from `z` to `y`, reasoning
 * that a rear tail swinging in the vertical plane would bob like a lever where
 * a swing about Y would sweep it side to side. The Euler-order half of that was
 * right and verified — order is three.js's XYZ, `Rx·Ry·Rz`, so `y` applies
 * before the backward pitch.
 *
 * **The conclusion was still wrong, because every slab of this tail is built
 * along the group's own local +Y.** Rotating about Y therefore rotates the tail
 * about an axis half a degree off its own length: a roll, not a wag. Measured
 * on the real model over a full cycle:
 *
 * | axis | sweep | lateral tip travel |
 * | --- | --- | --- |
 * | `rotation.y` | 0.19° | 0.2 mm |
 * | `rotation.z` | 20.63° | 140 mm (against 14 mm vertical) |
 *
 * So `z` gives exactly the side-to-side sweep that was wanted, and `y` gives
 * nothing a human eye could resolve. The lesson is narrow and worth keeping:
 * **an axis argument about a rotation means nothing until you know which way
 * the geometry runs.** The rest pose was never in question — she trails
 * backwards at 29.9° above horizontal either way.
 *
 * Non-zero at rest on purpose, and that is load-bearing beyond the styling: it
 * is what keeps this a live test of the zero-speed invariant {@link TAIL_CANT}
 * documents. A rest value of zero would make the multiply-only bug undetectable
 * here all over again.
 */
const TAIL_ROLL = 0.06;

export interface RipikaOptions {
  /** Adds the astronaut helmet for the space ferris wheel show. */
  space?: boolean;
  /** Colourway. Defaults to {@link RIPIKA_PALETTE} — the yellow mouse. */
  palette?: RipikaPalette;
  /**
   * Set `false` for a RiPika that will never change expression — the fountain
   * statue is the only caller that does.
   *
   * Paints **one** face canvas rather than the five-expression set, and
   * `setExpression` becomes a no-op. See `applyStaticBakedFace`: a statue that
   * cannot blink has no use for four extra 512² textures, and the park's whole
   * budget is forty of them.
   */
  expressions?: boolean;
}

export interface RipikaHandle extends CreatureHandle {
  /** Wags when RiPika is happy. */
  readonly tail: Group;
}

/** What {@link buildRipikaHead} hands back — everything a wearer needs. */
export interface RipikaHeadHandle {
  /** Skull, ears, tuft and painted face, all parented under one group. The
   *  group's origin is the skull centre — exactly where `head` sits on
   *  RiPika's own body, so a caller mounting the whole group elsewhere (the
   *  hat shop, for one) gets the same head with no offset maths. */
  readonly group: Group;
  /** The bare skull radius (before ears/tuft), for callers sizing around it. */
  readonly skullR: number;
  setExpression(name: Expression): void;
}

/**
 * Builds RiPika's head — skull, cowlick, ears, painted face, optional space
 * helmet — at any scale. `createRipika` below is one caller, authored at
 * {@link HEAD}; the RiPika hat (`src/art/models/hats.ts`) is another, authored
 * much bigger. Keeping this in one place means the two never drift apart by
 * accident.
 */
export function buildRipikaHead(scale: number, options: RipikaOptions = {}): RipikaHeadHandle {
  const head = new Group();
  head.name = 'ripikaHead';

  const palette = options.palette ?? RIPIKA_PALETTE;
  const yellow = toonMaterial(palette.yellow);
  const yellowDeep = toonMaterial(palette.yellowDeep);
  const cocoa = toonMaterial(palette.tip);

  const skullR = 0.315 * scale;
  const skull = blob(skullR, yellow, [1.06, 0.97, 1], 32);
  head.add(skull);
  addOutline(skull, 0.014);

  // Cowlick — one little tuft so the silhouette is not a perfect circle.
  const tuft = blob(0.07 * scale, yellowDeep, [0.7, 1.25, 0.7], 14);
  tuft.position.set(-0.05 * scale, 0.31 * scale, -0.03 * scale);
  tuft.rotation.z = -0.45;
  head.add(tuft);

  // Ears: chunky tapered cones with rounded cocoa caps. Built from a tapered
  // CYLINDER rather than a cone so the tip has width — a needle-sharp ear point
  // is the fastest way to make a cute creature look spiky.
  for (const side of [-1, 1] as const) {
    const ear = new Group();
    ear.position.set(side * 0.185 * scale, 0.235 * scale, -0.02 * scale);
    ear.rotation.z = side * 0.44;
    ear.rotation.x = -0.14;
    head.add(ear);

    const shaft = solid(
      new Mesh(new CylinderGeometry(0.036 * scale, 0.105 * scale, 0.24 * scale, 18, 1), yellow),
    );
    shaft.position.y = 0.11 * scale;
    ear.add(shaft);
    addOutline(shaft, 0.011);

    const base = blob(0.1 * scale, yellow, [1, 0.75, 1], 16);
    ear.add(base);

    const tipCone = solid(
      new Mesh(new CylinderGeometry(0.014 * scale, 0.038 * scale, 0.1 * scale, 16, 1), cocoa),
    );
    tipCone.position.y = 0.27 * scale;
    ear.add(tipCone);
    addOutline(tipCone, 0.009);

    const tipBall = solid(blob(0.016 * scale, cocoa, [1, 1, 1], 10));
    tipBall.position.y = 0.318 * scale;
    ear.add(tipBall);
  }

  // --- face ------------------------------------------------------------------
  // Baked into the skull's own texture rather than worn on a patch in front of
  // it — ART_DIRECTION.md §3. Same window, same paint options, so the face lands
  // where it always did; it just no longer floats 1.2% of a skull proud of the
  // head, and no longer needs the squash below copied from the skull's own.
  //
  // Every colour here comes from the palette, so a stone RiPika's face is
  // *repainted in stone* rather than tinted or hidden. That distinction is the
  // whole reason this is a palette and not a `traverse`-and-re-material pass:
  // the face lives in the skull's own texture now, so re-materialling the skull
  // would delete the face outright and leave a blank stone ball, and tinting it
  // would leave a grey statue with tomato cheeks.
  const faceOptions: BakedFaceOptions = {
    fill: palette.yellow,
    spreadX: 1.85,
    spreadY: 1.85,
    tilt: 0.2,
    size: 512,
    eyeY: 0.44,
    eyeGap: 0.46,
    eyeW: 0.118,
    eyeH: 0.15,
    mouth: 'cat',
    mouthW: 0.082,
    mouthDrop: 0.235,
    nose: palette.tip,
    blush: palette.cheek,
    blushStyle: 'disc',
    blushR: 0.105,
  };

  // The eyes, mouth and catchlights stay `ART.ink` and `ART.shine` whatever the
  // palette says, and that is right for stone as well as for fur: carved
  // features read as dark lines, the house dark is a warm plum, and a statue
  // with two catchlights looks alive where one with dead flat eyes looks eerie.
  let setExpression: (name: Expression) => void;
  if (options.expressions === false) {
    applyStaticBakedFace(skull, faceOptions);
    setExpression = () => {};
  } else {
    const face = createBakedFace(faceOptions);
    face.applyTo(skull);
    setExpression = (name: Expression) => face.setExpression(name);
  }

  if (options.space) {
    // The helmet used to clone the face patch's geometry. There is no face mesh
    // to clone now, so it builds the same sector directly — the numbers are the
    // face window's, which is what the clone was giving it anyway.
    const helmet = new Mesh(
      facePatchGeometry(skullR, 1.85, 1.85, 0.2),
      toonMaterial(0xffffff, { transparent: true, opacity: 0.34 }),
    );
    helmet.scale.setScalar(1.55);
    helmet.name = 'spaceHelmet';
    head.add(helmet);
  }

  return { group: head, skullR, setExpression };
}

export function createRipika(options: RipikaOptions = {}): RipikaHandle {
  const root = new Group();
  root.name = 'ripika';
  const body = new Group();
  root.add(body);

  const palette = options.palette ?? RIPIKA_PALETTE;
  const yellow = toonMaterial(palette.yellow);
  const yellowDeep = toonMaterial(palette.yellowDeep);
  const belly = toonMaterial(palette.belly);
  const cocoa = toonMaterial(palette.tip);
  const amber = toonMaterial(palette.bolt);

  const limbs = makeLimbs();

  // --- torso: a pear, wider at the bottom -----------------------------------
  const torso = blob(0.245, yellow, [1.02, 1.08, 0.94]);
  torso.position.y = 0.33;
  body.add(torso);
  addOutline(torso, 0.014);

  const tummy = decal(blob(0.155, belly, [0.98, 1.02, 0.5]));
  tummy.position.set(0, 0.28, 0.17);
  body.add(tummy);

  // Cream collar flash — the one graphic marking on the body.
  const collar = decal(blob(0.1, belly, [1.5, 0.38, 0.55]));
  collar.position.set(0, 0.47, 0.16);
  body.add(collar);

  // --- legs: short, with oversized rounded feet ------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    pivot.position.set(side * 0.125, 0.19, 0);
    body.add(pivot);

    const thigh = stub(0.072, 0.06, yellowDeep);
    thigh.position.y = -0.05;
    pivot.add(thigh);

    const foot = blob(0.105, cocoa, [1, 0.72, 1.32], 18);
    foot.position.set(0, -0.12, 0.035);
    pivot.add(foot);
    addOutline(foot, 0.011);
  }

  // --- arms: little mitten stubs --------------------------------------------
  for (const side of [-1, 1] as const) {
    const pivot = side < 0 ? limbs.leftArm : limbs.rightArm;
    pivot.position.set(side * 0.235, 0.4, 0);
    body.add(pivot);

    const arm = stub(0.062, 0.075, yellow);
    arm.position.y = -0.06;
    arm.rotation.z = side * 0.28;
    pivot.add(arm);

    const paw = blob(0.075, cocoa, [1, 0.92, 1], 16);
    paw.position.set(side * 0.035, -0.14, 0.01);
    pivot.add(paw);
  }

  // --- tail: a soft zig-zag flash -------------------------------------------
  // Mounted on the centre line at the back of the torso, and tipped back so the
  // zig-zag trails behind her (see TAIL_CANT for the history — it used to hang
  // off her left hip and fan out sideways).
  //
  // The mount moved with the rotation rather than after it, because the two are
  // one change: swinging the tail 90° about the old hip position would have
  // driven it straight through the torso it was pinned beside. -0.20 in z puts
  // the root just inside the torso's back surface (radius 0.245, squashed to
  // 0.94 in z, so the skin is at -0.230), which is what stops the first slab
  // floating off the body.
  const tail = new Group();
  tail.position.set(0, 0.24, -0.2);
  tail.rotation.set(-TAIL_CANT, TAIL_YAW, TAIL_ROLL);
  tail.scale.setScalar(1.15);
  body.add(tail);

  const slab = (w: number, h: number, mat: typeof yellow): Mesh =>
    solid(new Mesh(new RoundedBoxGeometry(w, h, 0.075, 4, 0.032), mat));

  const t1 = slab(0.1, 0.2, yellowDeep);
  t1.position.y = 0.09;
  t1.rotation.z = 0.42;
  tail.add(t1);

  const t2 = slab(0.13, 0.21, yellow);
  t2.position.set(-0.1, 0.19, 0);
  t2.rotation.z = -0.5;
  tail.add(t2);

  const t3 = slab(0.19, 0.19, amber);
  t3.position.set(0.03, 0.19, 0);
  t3.rotation.z = 0.55;
  t2.add(t3);
  addOutline(t3, 0.012);
  addOutline(t2, 0.012);
  addOutline(t1, 0.012);

  // --- head ------------------------------------------------------------------
  const headPivot = new Group();
  headPivot.position.y = 0.75;
  body.add(headPivot);

  const ripikaHead = buildRipikaHead(HEAD, options);
  headPivot.add(ripikaHead.group);

  const handle: RipikaHandle = {
    root,
    body,
    head: headPivot,
    tail,
    limbs,
    // Measured to the ear tips, not the skull — the name label must clear them.
    height: 1.46,
    setExpression: (name: Expression) => ripikaHead.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => {
      applyWalk(limbs, body, phase, speed, 0.7, 0.06);
      // The swing is added to the rest pose, not multiplied over it. Writing
      // this as `sin(...) * 0.18 * speed` alone made the whole expression zero
      // at `speed = 0` and so *assigned away* the cant rather than returning to
      // it — see {@link TAIL_CANT}.
      tail.rotation.z = TAIL_ROLL + Math.sin(phase * Math.PI * 4) * 0.18 * speed;
    },
  };
  return handle;
}
