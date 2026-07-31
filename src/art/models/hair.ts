import {
  BufferGeometry,
  ConeGeometry,
  Group,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addOutline, solid } from '../style/materials';
import { PonytailChain } from './ponytail';
import {
  HAIR_SHELLS,
  hairShellGeometry,
  hairShellSampler,
  type HairShellName,
} from './hairShell';

/**
 * Every hairstyle in the game, in one place.
 *
 * ## Where the shapes come from (31 July 2026)
 *
 * Seven of the nine styles are now cut out of one Blender-modelled surface —
 * see `hairShell.ts`, which explains why hair was the one thing in this park
 * that primitive composition could not reach. This file supplies the hem table
 * that picks a style's silhouette, and adds the things that genuinely *are*
 * primitives on top: bunches and their bobbles, a bowl cut's stray strand,
 * sixteen spikes, eight messy tufts. Those were looked at in Blender too and left
 * exactly as they were — a spike is a cone and a bunch is a squashed sphere,
 * and modelling either by hand would have made them worse, not better.
 *
 * The two ponytails are deliberately untouched, cap and all: the simulated tail
 * is the one cost-sensitive thing in here (see {@link CROWD_HAIR_STYLES}) and
 * nothing about this change needed to go near it.
 *
 * ## Why this is not in `kid.ts`
 *
 * Two callers need very different things from the same hair. The **player** is
 * one model that wears one style. The **crowd** (`entities/npc/kidCrowd.ts`)
 * reads a single prototype kid and turns each of its meshes into an
 * `InstancedMesh` shared by every child in the park — so the crowd needs a
 * prototype carrying *all* the styles at once, showing each child only the
 * parts of its own. Both are served by building a tagged list of parts and
 * hiding the ones that do not belong, which is a thing worth having its own
 * file rather than another branch inside the kid's constructor.
 *
 * ## Why almost every style is exactly one mesh
 *
 * Because of that crowd. `InstancedCrowd` draws **one instanced mesh per
 * prototype mesh**, so every part the prototype owns costs the whole crowd a
 * draw call — whether anybody is currently wearing it or not. Bunches built as
 * two spheres and two bobbles is four draw calls for the park forever; the
 * same bunches built as one merged hair geometry and one merged bobble
 * geometry is two. So each style is merged down to one mesh per *material* it
 * needs, with {@link fuse}. The eight static styles together add seven parts.
 *
 * The exception is the floor-length ponytail, whose segments have to articulate
 * and therefore cannot be merged — see {@link CROWD_HAIR_STYLES}.
 *
 * ## Units
 *
 * Head-mounted parts are authored in the kid's `× HEAD` units, exactly like the
 * rest of `kid.ts`, so a retune of the head carries them along. The hanging
 * styles are authored inside {@link HairRig}'s *fall* group in **plain metres**:
 * they are about the body, not the head — they have to clear the backpack and
 * reach a sensible way down a 2.12 m child — and scaling them with the skull
 * would be wrong in both directions.
 */

/**
 * The styles the character creator offers.
 *
 * `state/types.ts` keeps a structurally identical copy of this union (it must
 * not import from `art/`); the two are checked against each other by
 * `CharacterCreation`, which types its picker from the `state` one and feeds it
 * straight into `KidOptions`.
 */
export type HairStyle =
  | 'bunches'
  | 'bob'
  | 'short'
  | 'long'
  | 'ponytail'
  | 'longPonytail'
  | 'bowl'
  | 'spiky'
  | 'messy'
  | 'mohican';

export const HAIR_STYLES: readonly HairStyle[] = [
  'bunches',
  'bob',
  'short',
  'long',
  'ponytail',
  'longPonytail',
  'bowl',
  'spiky',
  'messy',
  'mohican',
] as const;

/**
 * The styles a background child can wear — everything except the simulated
 * floor-length ponytail.
 *
 * **This is a deliberate cost decision, not an oversight.** A simulated tail is
 * eight articulated segments, which cannot be merged into one mesh, so putting
 * it in the crowd prototype would cost the whole park eight more instanced
 * draw calls plus eight more world-matrix writes per child per frame plus a
 * verlet chain per child — and the tail would then have to hang perfectly
 * still on every one of them, because a swing that reads as alive on the
 * character the camera is following reads as noise on a dozen strangers in the
 * middle distance. The child playing the game gets the swinging one. Everybody
 * else gets the other eight, which is plenty of variety in a crowd.
 */
export const CROWD_HAIR_STYLES: readonly HairStyle[] = HAIR_STYLES.filter(
  (style) => style !== 'longPonytail',
);

/**
 * The styles whose hair hangs down the **back** — everything authored inside
 * {@link HairRig}'s `fall` group, plus the simulated tail.
 *
 * Kept here, next to the authoring that makes it true, because it is a fact
 * about the geometry rather than a preference: a curtain, a tail or a
 * floor-length ponytail parked at `z = -FALL_BACK × HEAD` is *entirely behind
 * the child's own head and body* in a dead-on front view, and no amount of
 * framing distance will reveal it. The character creator's preview reads this
 * to decide when to turn the plinth so the child can actually see what she
 * just picked — see `ui/characterCreationPreview.ts`.
 */
export const TRAILING_HAIR_STYLES: readonly HairStyle[] = ['long', 'ponytail', 'longPonytail'];

/** One built piece of hair, and the styles that show it. */
export interface HairPart {
  readonly mesh: Object3D;
  readonly styles: readonly HairStyle[];
  /**
   * True for parts that stick up past the bare hair cap and would spear
   * straight through a worn hat — in practice, the spikes. Everything else
   * sits inside the envelope hats already sit over.
   *
   * **Never hides this part.** Jim's refinement (31 July 2026), after the
   * first version of this rule tucked the hair away and Spiky turned out to
   * be structurally unpreviewable in the character creator, which always has
   * *some* hat selected: "just allow any hair other than rooster with a hat,
   * and disable the hat, not the hair in this case." So this flag now feeds
   * {@link HairRig.hidesHat} instead — a read the *hat* side checks
   * (`art/models/kid.ts`'s `hairHidesHat`, `entities/WornHat.ts`,
   * `ui/characterCreationPreview.ts`) before showing itself at all. The hair
   * is always fully there; whichever hat she picked simply does not render
   * while she is wearing a style like this — still hers, still "worn" as far
   * as the inventory/Cute-o-dex are concerned, just not drawn.
   */
  readonly hideUnderHat: boolean;
}

export interface HairOptions {
  /** The tilted head group every head-mounted part is added to. */
  readonly crown: Group;
  /** The model root. The ponytail simulation is drawn in its local space. */
  readonly root: Object3D;
  /** The kid's `HEAD` scale-up, so hair is authored in the same units. */
  readonly head: number;
  /**
   * The skull's radius in metres. The Blender-modelled shell's radial numbers
   * are multiples of it, so a head retune carries the hair with it — the same
   * job `× HEAD` does for everything else on the head.
   */
  readonly skull: number;
  /** The crown's backwards tilt in radians. The hanging hair undoes it. */
  readonly headTilt: number;
  readonly hairMaterial: Material;
  readonly hairDarkMaterial: Material;
  readonly bobbleMaterial: Material;
  /** Which style is shown. */
  readonly style: HairStyle;
  /** Which styles are *built*. Defaults to just {@link style}. */
  readonly styles?: readonly HairStyle[];
}

export interface HairRig {
  readonly parts: readonly HairPart[];
  /** The simulated tail, if `longPonytail` was built. Drive it every frame. */
  readonly ponytail: PonytailChain | null;
  /** Shows one style and hides the rest. */
  setStyle(style: HairStyle): void;
  /**
   * Whether the **current** style has any part that would spear through a
   * worn hat (`HairPart.hideUnderHat`) — Spiky, today. Live off {@link
   * setStyle}, not snapshotted: the character creator rebuilds the whole kid
   * per tap, but this stays correct even for a hypothetical caller that
   * switched styles on a live rig instead.
   *
   * The hair rig no longer hides anything for this reason itself — see
   * `HairPart.hideUnderHat`'s doc comment for why that inverted. This is the
   * read the hat side of that inversion checks.
   */
  readonly hidesHat: boolean;
}

/** How far back the hanging styles sit, in `HEAD` units, clear of the backpack. */
const FALL_BACK = 0.36;

/** Outline thicknesses, from ART_DIRECTION §2: 0.016–0.022 on the kid. */
const OUTLINE = 0.018;
const OUTLINE_SMALL = 0.014;

// -----------------------------------------------------------------------------

export function buildHair(options: HairOptions): HairRig {
  const {
    crown,
    root,
    head: H,
    skull,
    headTilt,
    hairMaterial: hair,
    hairDarkMaterial: hairDark,
    bobbleMaterial: bobble,
    style,
  } = options;
  const wanted = new Set(options.styles ?? [style]);

  const parts: HairPart[] = [];
  let ponytail: PonytailChain | null = null;

  /**
   * Builds a part, but **only if some wanted style uses it**.
   *
   * A factory rather than a finished mesh on purpose. The character creator's
   * preview rebuilds the whole kid on every single tap — every swatch, every
   * hat — and a version of this that built all nine styles and threw eight
   * away would do nine styles' worth of sphere generation and geometry merging
   * per tap, on a phone, forever. Only the crowd ever asks for more than one.
   */
  const add = (
    styles: readonly HairStyle[],
    parent: Object3D,
    build: () => Mesh,
    hideUnderHat = false,
  ): void => {
    if (!styles.some((one) => wanted.has(one))) return;
    const mesh = build();
    parent.add(mesh);
    parts.push({ mesh, styles, hideUnderHat });
  };

  /**
   * The hanging-hair frame: parked behind the head and rotated to **undo** the
   * crown's backwards tilt, so everything inside it is authored against plain
   * world axes — down is down. Getting this wrong is how hair ends up growing
   * out of a child's shoulder blades: the crown is tipped back ten degrees so
   * the face points at the iso camera, and a curtain of hair authored in that
   * frame leans forward into the backpack by about six centimetres.
   */
  const fall = new Group();
  fall.name = 'hair.fall';
  fall.rotation.x = headTilt;
  fall.position.set(0, 0, -FALL_BACK * H);
  crown.add(fall);

  /**
   * The **draped**-hair frame: the same untilted, plain-metres space as
   * `fall`, but left on the head's own axis instead of parked behind it.
   *
   * `fall` is offset back by `FALL_BACK × HEAD` because a curtain or a tail
   * hangs *off* the back of the head and has to clear the backpack. Anything
   * that wraps *around* the head needs the opposite: authored in `fall`, a
   * shell meant to sit on the skull would be a shell centred half a metre
   * behind it. Same rotation, so down is still down.
   */
  const drape = new Group();
  drape.name = 'hair.drape';
  drape.rotation.x = headTilt;
  crown.add(drape);

  // --- the shells -------------------------------------------------------------
  /**
   * Four Blender-modelled shells cover seven of the nine styles. Each is one
   * closed surface with a hairline that goes all the way round, which is the
   * property the old hair kept losing: a gap between a side piece and a back
   * piece is not something this shape can express.
   *
   * `short`, `bunches`, `spiky`, `messy` and `mohican` share the `crop` shell rather than
   * having one each. The crowd instances every prototype mesh whether it is
   * worn or not, so four crops would be three draw calls the park pays forever
   * to draw the same shape four times.
   */
  const shells: readonly (readonly [HairShellName, readonly HairStyle[]])[] = [
    ['long', ['long']],
    ['bob', ['bob']],
    ['bowl', ['bowl']],
    // `mohican` rides the crop shell too, and that is the whole reason its
    // shaved sides cost the park nothing: the shell is already built and
    // already instanced for four other styles, so the Mohican adds exactly one
    // mesh to the crowd rather than two.
    ['crop', ['short', 'bunches', 'spiky', 'messy', 'mohican']],
  ];
  for (const [name, styles] of shells) {
    add(styles, drape, () => {
      const shell = solid(new Mesh(hairShellGeometry(HAIR_SHELLS[name], skull), hair));
      shell.name = `hair.shell.${name}`;
      addOutline(shell, OUTLINE);
      return shell;
    });
  }

  // --- the ponytails' cap and fringe -------------------------------------------
  // The two ponytails keep the primitive cap and fringe they have always worn.
  // The simulated tail is the one performance-sensitive thing in this file and
  // the shells did not need to go near it. Moving them onto `crop` later is one
  // line in `shells` above and this pair of builders deleted.

  // Stops well ABOVE the eye line. Every extra degree of theta here eats
  // forehead, and a character with no forehead has nowhere to put big eyes.
  add(['ponytail', 'longPonytail'], crown, () => {
    const cap = solid(
      new Mesh(new SphereGeometry(0.455 * H, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.46), hair),
    );
    cap.scale.set(1, 1.02, 1);
    cap.position.y = 0.035 * H;
    cap.rotation.x = -0.05;
    addOutline(cap, OUTLINE);
    return cap;
  });

  // Fringe: high and shallow, a suggestion of a sweep rather than a curtain.
  add(['ponytail', 'longPonytail'], crown, () =>
    solid(
      new Mesh(
        new SphereGeometry(0.17 * H, 18, 14).scale(1.3, 0.34, 0.48).translate(0, 0.305 * H, 0.29 * H),
        hair,
      ),
    ),
  );

  // --- bunches ----------------------------------------------------------------

  add(['bunches'], crown, () => {
    const bunches = solid(
      fuse(hair, [
        new SphereGeometry(0.17 * H, 18, 14)
          .scale(0.9, 1.15, 0.9)
          .translate(-0.42 * H, 0.04 * H, -0.12 * H),
        // A whisker bigger on the right. Nothing in this park is plumb.
        new SphereGeometry(0.17 * H, 18, 14)
          .scale(0.94, 1.2, 0.92)
          .translate(0.42 * H, 0.05 * H, -0.12 * H),
      ]),
    );
    addOutline(bunches, OUTLINE_SMALL);
    return bunches;
  });

  add(['bunches'], crown, () =>
    solid(
      fuse(bobble, [
        ringGeometry(0.085 * H, 0.033 * H).translate(-0.44 * H, 0.14 * H, -0.12 * H),
        ringGeometry(0.085 * H, 0.033 * H).translate(0.44 * H, 0.14 * H, -0.12 * H),
      ]),
    ),
  );

  // --- ponytails --------------------------------------------------------------
  // The gather and the tie are shared by both ponytails: the difference between
  // them is entirely what hangs off the bottom.

  add(['ponytail', 'longPonytail'], fall, () => {
    const gather = solid(
      fuse(hair, [new SphereGeometry(0.22, 18, 14).scale(1, 0.82, 0.95).translate(0, 0.15, -0.1)]),
    );
    addOutline(gather, OUTLINE_SMALL);
    return gather;
  });

  add(['ponytail', 'longPonytail'], fall, () =>
    solid(fuse(bobble, [ringGeometry(0.13, 0.045).translate(0, 0.02, -0.1)])),
  );

  add(['ponytail'], fall, () => {
    const shortTail = solid(
      fuse(hair, [
        new SphereGeometry(0.17, 16, 12).scale(0.95, 1, 0.95).translate(0, -0.1, -0.06),
        new SphereGeometry(0.145, 16, 12).scale(0.95, 1.05, 0.95).translate(0, -0.3, -0.1),
        new SphereGeometry(0.1, 14, 10).scale(1, 1.1, 1).translate(0, -0.46, -0.14),
      ]),
    );
    addOutline(shortTail, OUTLINE_SMALL);
    return shortTail;
  });

  if (wanted.has('longPonytail')) {
    // An empty anchor rather than hanging the chain off the tie mesh: the tie
    // is one of the merged parts and may be hidden, and a simulation pinned to
    // something that can be switched off is a bug waiting to be found by a
    // six-year-old in a hat.
    const anchor = new Group();
    anchor.name = 'hair.ponytailAnchor';
    anchor.position.set(0, 0.02, -0.12);
    fall.add(anchor);

    ponytail = new PonytailChain(anchor, root, hair, OUTLINE);
    root.add(ponytail.group);
    for (const segment of ponytail.segments) {
      parts.push({ mesh: segment, styles: ['longPonytail'], hideUnderHat: false });
    }
  }

  // --- bowl cut: one stray strand ----------------------------------------------
  // The helmet itself is the `bowl` shell. This is the asymmetric feature
  // ART_DIRECTION.md section 4 asks every head for, and it is a strand of hair
  // — a squashed sphere is exactly the right tool, so it stayed one. Darker
  // than the rest so it reads as a separate lock rather than a lump.
  add(['bowl'], crown, () => {
    const strand = solid(
      new Mesh(
        new SphereGeometry(0.07 * H, 12, 10)
          .scale(0.8, 1.5, 0.8)
          .translate(0.3 * H, 0.42 * H, -0.26 * H),
        hairDark,
      ),
    );
    addOutline(strand, OUTLINE_SMALL);
    return strand;
  });

  // --- spiky ------------------------------------------------------------------
  // Fat cones standing up all over the crop shell. Fat, because ART_DIRECTION's
  // "no thin parts" still applies to a spike: a needle reads as a rendering
  // artefact where a wedge reads as hair. A cone *is* the right primitive for a
  // spike, so these stayed cones — and every base is taken from the shell's own
  // surface (`hairShellSampler`) rather than from a hand-picked radius, so a
  // spike cannot come loose from the head it grows out of.
  //
  // Kept as one merged mesh, and hidden whole when a hat goes on: everything
  // else in this file sits inside the envelope hats already perch over, but a
  // spike goes straight through the party hat.
  add(
    ['spiky'],
    drape,
    () => {
      const { surface, radiusAt } = hairShellSampler(HAIR_SHELLS.crop, skull);
      const radius = SPIKE_RADIUS * H;
      const spikes: BufferGeometry[] = [];
      for (let i = 0; i < SPIKE_COUNT; i += 1) {
        // Up the dome on a golden-angle spiral — see SPIKE_BAND. `climb` is 0
        // at the hairline and 1 at the crown.
        const climb = Math.pow(i / (SPIKE_COUNT - 1), SPIKE_CROWD);
        const height = SPIKE_BAND[0] + (SPIKE_BAND[1] - SPIKE_BAND[0]) * climb;
        const azimuth = i * GOLDEN_ANGLE + 0.24;
        // Long at the hairline, short at the crown — the taper is what keeps
        // her inside the height budget while the outer spikes stay dramatic —
        // times a three-way jag so no two neighbours match.
        const length =
          (SPIKE_LONG + (SPIKE_SHORT - SPIKE_LONG) * climb) *
          (SPIKE_JAG[i % SPIKE_JAG.length] as number) *
          H;
        // Each spike stands off its **own** patch of scalp: take the shell's
        // slope where this one is rooted, and stand it up from there towards
        // vertical. Near the hairline the scalp falls away at ~51°, so a spike
        // there leans ~23° out; at the crown the scalp is flat and the spike is
        // near upright. That gradient is what makes them radiate out of a head
        // rather than sit on it in a ring — and it means no hand-authored lean
        // per spike, so moving one up the dome cannot leave its angle behind.
        const drop = (radiusAt(height + 0.01) - radiusAt(height - 0.01)) / 0.02;
        const tilt = SPIKE_STAND * Math.atan2(1, -drop);
        const [x, y, z] = surface(azimuth, height);
        spikes.push(
          new ConeGeometry(radius, length, 8)
            // Cone geometry is centred on its own height, so this drops the
            // base BELOW the surface and puts the tip at +length: a spike is
            // aimed about its buried base, never about its middle.
            .translate(0, length / 2 - SPIKE_BURY * radius, 0)
            // `rotateX` tips +Y towards +Z, so a negative angle tips it towards
            // -Z — which is the outward radial at azimuth 0, the shell
            // measuring its azimuth from the back of the skull. The half turn
            // then carries that outward lean round to this spike's own side.
            //
            // The pair used to be `rotateZ(tilt)` and the same `rotateY`, which
            // tips +Y towards -X and lands the lean **tangentially**: every
            // spike leaned sideways around the head like a pinwheel instead of
            // out of it (dot product with its own outward radial: 0.000 for
            // every one, measured). That is what laid the cones down flat along
            // the dome and made the style read as scales rather than as hair.
            .rotateX(-tilt)
            .rotateY(-azimuth)
            .translate(x, y, z),
        );
      }
      const spiky = solid(fuse(hair, spikes));
      addOutline(spiky, OUTLINE_SMALL);
      return spiky;
    },
    true,
  );

  // --- mohican ----------------------------------------------------------------
  // A stiff crest down the middle of the scalp, sides cropped close by the
  // `crop` shell everything else in this group already shares.
  //
  // **Aimed at "friendly rooster", not "punk".** The client is six. So the
  // blades are rounded lozenges rather than cones — ART_DIRECTION.md §4, sharp
  // is never cute, and a comb of rounded bumps is what a rooster actually has —
  // and the profile peaks a little forward of the crown and tapers away at both
  // ends, which is what stops a row of equal spikes reading as a dinosaur.
  //
  // Every root is taken from the shell's own surface, walked as a real path
  // over the scalp (see {@link sagittalPath}), for the same reason the spikes
  // are: a blade placed at a hand-picked coordinate comes loose from the head
  // the moment anybody retunes the skull. Neighbouring blades overlap at the
  // base, so the crest merges into one continuous ridge with a scalloped top
  // rather than reading as separate lumps.
  add(
    ['mohican'],
    drape,
    () => {
      const path = sagittalPath(skull, MOHICAN_SPAN[0], MOHICAN_SPAN[1]);
      const blades: BufferGeometry[] = [];
      for (let i = 0; i < MOHICAN_BLADES; i += 1) {
        const t = i / (MOHICAN_BLADES - 1);
        const { point, lean } = pathAt(path, t);
        // The comb profile: a raised cosine skewed forward, so the tallest
        // blade sits just ahead of the crown where a real crest's does, and
        // both ends taper into the cropped sides instead of stopping dead.
        const skew = Math.pow(t, MOHICAN_SKEW);
        const profile = MOHICAN_LOW + (1 - MOHICAN_LOW) * Math.sin(Math.PI * skew) ** MOHICAN_PEAK;
        const length = MOHICAN_LONG * profile * H;
        const halfW = MOHICAN_THICK * H;
        const halfZ = MOHICAN_DEPTH * H;
        blades.push(
          new SphereGeometry(1, 12, 10)
            .scale(halfW, length / 2, halfZ)
            // Stand the blade out of its own patch of scalp: half of it is
            // buried, so no blade can float however the shell is retuned.
            .translate(0, length / 2 - MOHICAN_BURY * length, 0)
            // A crest is stiff and near-upright, so it only takes a fraction of
            // the scalp's own lean — unlike a spike, which radiates.
            .rotateX(lean * MOHICAN_STAND)
            .translate(point[0], point[1], point[2]),
        );
      }
      const mohican = solid(fuse(hair, blades));
      addOutline(mohican, OUTLINE_SMALL);
      return mohican;
    },
    // A hat is never worn with this style in the character creator — picking
    // it clears the hat tab entirely (`ui/CharacterCreation.ts`'s
    // `HAT_EXCLUSIVE_HAIR_STYLES`). `true` here is the backstop for anywhere
    // that rule does not reach: if a hat is ever worn over this crest anyway
    // (bought from a shop after the fact, say), it is the *hat* that declines
    // to render, exactly like the spikes — see `hideUnderHat`'s doc comment,
    // and `entities/WornHat.ts`, which is what actually checks it.
    true,
  );

  // --- messy ------------------------------------------------------------------
  // Tufts poking out SIDEWAYS rather than upwards, deliberately: it keeps the
  // whole style inside the envelope a hat already perches over, so messy needs
  // no hat special case the way spiky does, and an early version with tufts
  // leaning hard upwards measured *taller than the spikes*, which is not what
  // "messy" means to anybody.
  //
  // **Every tuft is centred on the shell's surface.** On `main` they were at
  // hand-picked coordinates up to 1.13 m from the head's centre, over a cap
  // 0.68 m across — four of the eight were floating in mid-air with a 130 mm
  // gap, the very failure the family reported about the long hair. Centred on
  // the surface, half of every tuft is inside the shell whatever anyone does to
  // the numbers below.
  add(['messy'], drape, () => {
    const surface = hairShellSampler(HAIR_SHELLS.crop, skull).surface;
    const messy = solid(
      fuse(
        hair,
        MESSY_TUFTS.map(([radius, azimuth, height, lean]) =>
          tuftGeometry(radius * H, surface(azimuth, height * H), lean),
        ),
      ),
    );
    addOutline(messy, OUTLINE_SMALL);
    return messy;
  });

  // --------------------------------------------------------------------------

  let current: HairStyle = style;

  // No `hatWorn` any more — hair is never the thing that hides. See
  // `HairPart.hideUnderHat`'s doc comment.
  const apply = (): void => {
    for (const part of parts) {
      part.mesh.visible = part.styles.includes(current);
    }
  };

  apply();

  return {
    parts,
    ponytail,
    setStyle: (next: HairStyle) => {
      current = next;
      apply();
    },
    get hidesHat() {
      return parts.some((part) => part.styles.includes(current) && part.hideUnderHat);
    },
  };
}

// ------------------------------------------------------------------ helpers

/**
 * Merges pre-transformed geometries into one mesh.
 *
 * The inputs are always freshly built here and are consumed — they are disposed
 * once merged, so nothing is left holding a GPU buffer that is never drawn.
 * Transforms are baked into the vertices by the caller (`.scale().translate()`
 * and friends, which also carry the normals through their normal matrix), which
 * is what makes the merge possible at all and, as a bonus, gives the ink
 * outline an even thickness on squashed parts instead of a scaled-up one.
 */
function fuse(material: Material, geometries: readonly BufferGeometry[]): Mesh {
  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries([...geometries], false);
  if (!merged) {
    throw new Error('hair: geometry merge failed — mismatched attributes?');
  }
  if (geometries.length > 1) for (const geometry of geometries) geometry.dispose();
  return new Mesh(merged, material);
}

/**
 * How many spikes, and the band of the dome they grow out of — in metres up the
 * drape frame, from the lowest to the highest.
 *
 * **They cover the head; they are not a ring round the edge of it.** The first
 * pass rooted all nine at one height, and even standing up it read as a tiara
 * or a crown: the top of the head was bare dome, and from the game's own 38°
 * camera — which looks *down* at her — the bare bit is most of what you see.
 * The family's words were "all over the head, not a circle around the edge".
 *
 * 0.40 is just above the crop shell's hairline; 0.63 is close enough to the
 * crown (the dome's pole is at `semiY`, 0.72) to put spikes on the very top of
 * her head, while leaving the pole itself alone — a cone centred exactly on it
 * has a base wider than the dome it is standing on, and reads as a party hat.
 */
const SPIKE_COUNT = 16;
const SPIKE_BAND: readonly [number, number] = [0.4, 0.63];

/**
 * The golden angle. Successive spikes land as far from their predecessors as it
 * is possible to be, so sixteen of them cover the dome evenly and *never* line
 * up into rings — which a spiral with any rational turn does, and which is the
 * exact failure being fixed here. Sunflowers do the same thing for the same
 * reason.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How the sixteen are shared out up the band, as an exponent on the climb.
 *
 * Above 1 they bunch towards the hairline, which is where the dome has the
 * circumference to hold them: spacing them evenly in *height* instead crowds
 * the crown, where the shell has drawn in to a third of its width, and the top
 * spikes merge into a lump.
 */
const SPIKE_CROWD = 1.5;

/**
 * Spike length in `HEAD` units at the hairline and at the crown, and the
 * three-way jag dealt round them so no two neighbours match.
 *
 * The taper is not decoration — it is the height budget. A spike rooted at the
 * crown starts 0.3 m higher up than one at the hairline, so it has to be that
 * much shorter to finish at the same place; without it the crown spikes alone
 * would put her past 2.5 m. Long at the edges and short on top is also what a
 * head of spiky hair looks like.
 *
 * Against a 0.105 radius these run 1.3–2.0 spike-widths long: still a wedge,
 * not a needle (ART_DIRECTION §1's "no thin parts" applies to a spike as much
 * as to a limb), but a wedge that comes to a point well clear of the skull —
 * which is the whole of what was wrong.
 *
 * **Sized to a height, deliberately.** Sixteen of these take the child to
 * 2.34 m. Longer and more upright both read better and both cost height, and
 * she has to walk around a park whose crowd is 2.12 m: nothing in the world
 * actually stops her at 2.43 m (the garlands hang at 3.1 and a shop floor is
 * 3.6, and `npm run build` is green either way), but she would then be half a
 * metre over every other child in the park, and a shorter dramatic spike beats
 * a tall one that clips a doorway somebody adds later. So this sits at the
 * ~2.3 m the style was budgeted at before the shells landed.
 */
const SPIKE_LONG = 0.42;
const SPIKE_SHORT = 0.33;
const SPIKE_JAG: readonly number[] = [1, 0.85, 0.93];

/**
 * How far each spike is stood up from the scalp it grows out of, as a fraction
 * of that scalp's own slope. 0 is straight up; 1 is flat along the shell.
 *
 * **The lean is what this style lives or dies by.** It was a flat 0.66 rad
 * (38°) everywhere — and since it was also being applied sideways (see the
 * build above), the cones lay down along the dome and the family read the whole
 * style as a bumpy texture rather than as hair. The brief is Bart Simpson:
 * points that radiate *up* and only slightly out.
 *
 * A fraction of the local slope rather than a fixed angle, because the two ends
 * of the band want different answers: the scalp falls away at ~51° down at the
 * hairline and is nearly flat at the crown, so 0.45 gives ~23° of lean at the
 * bottom and ~5° at the top. Fixing the angle instead would either lay the
 * crown spikes over sideways or stand the hairline ones up into each other.
 */
const SPIKE_STAND = 0.45;

/** Spike base radius, in `HEAD` units. Fat on purpose — see above. */
const SPIKE_RADIUS = 0.105;

/**
 * How deep a spike's base sits below the point it grows out of, in **base
 * radii** — so it tracks {@link SPIKE_RADIUS} and a head retune.
 *
 * A cone lying along the dome hugs it; a cone standing up out of a scalp that
 * slopes away meets it at an angle, and part of its base disc is left showing.
 * The first version buried 0.06 m — 0.38 base radii — which was enough for
 * cones leaning 38° and is not enough for these.
 *
 * **Deeper is not simply better, which is the trap here.** Measured against the
 * real shell as the fraction of each base rim left outside it: 0.38 radii
 * leaves 183 rim samples of 288 out, 1.0 leaves 147 — and then it turns round
 * again, because past about 1.4 radii the front spike is driven so far in that
 * its base passes clean through the other side of the shell and *every* one of
 * its rim samples ends up outside (32 of 32 at 1.65). There is an optimum in
 * the middle rather than a direction to push in, and this is it.
 *
 * `check:hair` holds the property this is really for — that all nine spikes
 * stay rooted in the head — rather than trusting the number.
 */
const SPIKE_BURY = 1.0;

/**
 * The messy tufts: radius, azimuth from the back of the skull, height in HEAD
 * units, and how much the tuft cants. Positions are (azimuth, height) rather
 * than (x, y, z) precisely so that a tuft cannot be authored off the head.
 */
const MESSY_TUFTS: readonly (readonly [number, number, number, number])[] = [
  [0.14, 1.06, 0.3, 1.15],
  [0.12, -1.06, 0.36, 0.9],
  [0.14, 2.83, 0.34, 1.3],
  [0.11, -1.89, 0.18, 0.8],
  [0.13, 2.19, 0.06, 1.05],
  [0.1, -0.5, 0.34, 1.4],
  [0.12, 3.11, 0.24, 0.7],
  [0.1, -2.36, 0.3, 1.2],
];

/** A hair tie or bobble: a torus lying flat, ready to be positioned. */
function ringGeometry(radius: number, tube: number): BufferGeometry {
  return new TorusGeometry(radius, tube, 8, 18).rotateX(Math.PI / 2);
}

/**
 * One messy tuft: a squashed blob poking radially out of the head.
 *
 * Elongated on **Z**, not X, and then spun by `atan2(x, z)`: `rotateY` maps +Z
 * onto the outward direction, so the tuft sticks out of the skull. Elongating
 * on X instead lays it flat *around* the head, which reads as a scale rather
 * than a tuft — worth the note, it was wrong the first time.
 */
/**
 * The scalp's mid-line, from the nape up over the crown to the brow.
 *
 * The hair shell is parameterised by (azimuth, height), which does not walk a
 * path over the top of the head: the back of the mid-line is azimuth 0 and the
 * front is azimuth π, and they meet only at the crown. So this samples both
 * branches finely, right up to the apex where the shell's radius goes to zero
 * and the two coincide, and hands back one ordered path from nape to brow.
 *
 * Sampled rather than solved because the shell applies the head's own tilt on
 * the way out — the crown apex lands at z ≈ −0.12, not at z = 0 — and asking
 * the sampler is always right where reproducing its maths here would be one
 * more thing to keep in step.
 */
function sagittalPath(
  skull: number,
  backHeight: number,
  frontHeight: number,
): readonly (readonly [number, number, number])[] {
  const { surface } = hairShellSampler(HAIR_SHELLS.crop, skull);
  const apex = HAIR_SHELLS.crop.semiY * skull;
  const steps = 90;
  const path: [number, number, number][] = [];
  // Up the back, then down the front. Cosine spacing, because the profile turns
  // fastest near the apex and even steps in height leave a gap over the crown.
  for (let i = 0; i <= steps; i += 1) {
    const ease = (1 - Math.cos((i / steps) * Math.PI)) / 2;
    path.push(surface(0, backHeight + (apex - backHeight) * ease) as [number, number, number]);
  }
  for (let i = steps - 1; i >= 0; i -= 1) {
    const ease = (1 - Math.cos((i / steps) * Math.PI)) / 2;
    path.push(surface(Math.PI, frontHeight + (apex - frontHeight) * ease) as [number, number, number]);
  }
  return path;
}

/**
 * A point a fraction of the way along a path by **arc length**, and how far the
 * scalp leans there.
 *
 * Arc length rather than index, because the two branches of
 * {@link sagittalPath} are sampled in their own heights: stepping by index
 * bunches the blades up wherever the profile happens to be sampled densely.
 */
function pathAt(
  path: readonly (readonly [number, number, number])[],
  t: number,
): { point: readonly [number, number, number]; lean: number } {
  const lengths: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as readonly [number, number, number];
    const b = path[i] as readonly [number, number, number];
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = lengths[lengths.length - 1] as number;
  const target = t * total;
  let i = 1;
  while (i < lengths.length - 1 && (lengths[i] as number) < target) i += 1;
  const a = path[i - 1] as readonly [number, number, number];
  const b = path[i] as readonly [number, number, number];
  const span = (lengths[i] as number) - (lengths[i - 1] as number);
  const f = span > 0 ? (target - (lengths[i - 1] as number)) / span : 0;
  const point: [number, number, number] = [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
  // The scalp's outward direction here, as an angle from vertical in the
  // sagittal plane: the path's tangent turned a quarter turn. Positive leans
  // forward, which is what `rotateX` wants.
  const lean = Math.atan2(b[1] - a[1], b[2] - a[2]);
  return { point, lean };
}

/** Where the crest starts and stops, as shell heights: nape end, brow end. */
const MOHICAN_SPAN: readonly [number, number] = [0.40, 0.46];
/** Blades along the crest. Enough that neighbours overlap into one ridge. */
const MOHICAN_BLADES = 13;
/** The tallest blade, in head units. Comparable to a spike, deliberately. */
const MOHICAN_LONG = 0.34;
/**
   * How tall the end blades are as a fraction of the tallest.
   *
   * High, and that is the whole difference between a crest and a fin. The sides
   * are the `crop` shell — a full cap of hair — so a blade only reads at all
   * once it clears that cap. At 0.3 the ends sank into the hair and the style
   * came out as a single shark fin over the crown; at 0.6 the crest stays proud
   * from nape to brow, which is what makes it a Mohican.
   */
const MOHICAN_LOW = 0.72;
/**
   * Skews the profile's peak forward of the crown, where a real crest's is.
   *
   * **Above 1, not below.** `t` runs 0 at the nape to 1 at the brow, and the
   * peak of `sin(π · tᵏ)` sits at `t = 0.5^(1/k)` — so a value under 1 drags the
   * peak *backwards*. The first pass used 0.78 and put the tallest blade at
   * t = 0.41, behind the crown, which is exactly where it looked wrong. 1.3
   * puts it at t = 0.59.
   */
const MOHICAN_SKEW = 1.15;
/** Sharpens the peak. 1 is a plain raised cosine; higher is more of a quiff. */
const MOHICAN_PEAK = 1.25;
/** Half-width across the head. Thin enough to read as a strip, fat enough that
 *  ART_DIRECTION's "no thin parts" still holds. */
const MOHICAN_THICK = 0.092;
/** Half-depth along the crest — bigger than the width, so blades overlap. */
const MOHICAN_DEPTH = 0.115;
/** How much of each blade is buried in the scalp, as a fraction of its length. */
const MOHICAN_BURY = 0.22;
/** How much of the scalp's lean a blade takes. A crest is stiff and upright, so
 *  much less than a spike, which radiates out of the head. */
const MOHICAN_STAND = 0.35;

function tuftGeometry(
  radius: number,
  centre: readonly [number, number, number],
  lean: number,
): BufferGeometry {
  const [x, y, z] = centre;
  return new SphereGeometry(radius, 12, 10)
    .scale(0.85, 0.72, 1.5)
    // A modest cant, not a flick: the tuft is 1.5 radii long, so every extra
    // radian here buys height much faster than it buys character.
    .rotateX(lean * (x >= 0 ? -1 : 1) * 0.28)
    .rotateY(Math.atan2(x, z))
    .translate(x, y, z);
}
