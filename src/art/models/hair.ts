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
 * nine spikes, eight messy tufts. Those were looked at in Blender too and left
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
  | 'messy';

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
  /** Tucks away anything that would poke through a hat. */
  setHatWorn(worn: boolean): void;
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
   * `short`, `bunches`, `spiky` and `messy` share the `crop` shell rather than
   * having one each. The crowd instances every prototype mesh whether it is
   * worn or not, so four crops would be three draw calls the park pays forever
   * to draw the same shape four times.
   */
  const shells: readonly (readonly [HairShellName, readonly HairStyle[]])[] = [
    ['long', ['long']],
    ['bob', ['bob']],
    ['bowl', ['bowl']],
    ['crop', ['short', 'bunches', 'spiky', 'messy']],
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
  // Nine fat cones standing up off the crop shell. Fat, because ART_DIRECTION's
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
      const surface = hairShellSampler(HAIR_SHELLS.crop, skull).surface;
      const radius = SPIKE_RADIUS * H;
      const spikes: BufferGeometry[] = [];
      for (let i = 0; i < 9; i += 1) {
        const azimuth = (i / 9) * Math.PI * 2 + 0.24;
        // Three lengths and three leans, dealt round, so the crown reads as
        // hacked about rather than machined.
        const [span, tilt] = SPIKES[i % SPIKES.length] as readonly [number, number];
        const length = span * H;
        const [x, y, z] = surface(azimuth, SPIKE_ROOT);
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
            // out of it (dot product with its own outward radial: 0.000 for all
            // nine, measured). That is what laid the cones down flat along the
            // dome and made the style read as scales rather than as hair.
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
  let hatWorn = false;

  const apply = (): void => {
    for (const part of parts) {
      part.mesh.visible = part.styles.includes(current) && !(hatWorn && part.hideUnderHat);
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
    setHatWorn: (worn: boolean) => {
      hatWorn = worn;
      apply();
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
 * Where the spikes are rooted on the crop shell, in metres up the drape frame.
 * High enough to fan off the crown, low enough that the shell is still wide
 * there and the ring of nine reads as a crown of points rather than a topknot.
 */
const SPIKE_ROOT = 0.44;

/**
 * The three spikes, as `[length in HEAD units, lean from vertical in radians]`,
 * dealt round the nine in turn.
 *
 * **The lean is the number this style lives or dies by.** It was a flat 0.66
 * (38°) for all nine — and since it was also being applied sideways (see the
 * build above), the cones lay down along the dome and the family read the whole
 * style as a bumpy texture rather than as hair. The brief is Bart Simpson:
 * points that radiate *up* and only slightly out, making a jagged crown in
 * silhouette. 14–23° does that; the old 38° cannot, at any length.
 *
 * Three different pairs rather than one repeated, because nine identical cones
 * on a ring read as a machined tiara — ART_DIRECTION §4's "nothing is plumb",
 * and the "hacked about" idea the first version had in its lengths and could
 * not show. The longest spike is also the most upright, so the variation adds
 * up rather than cancelling out.
 *
 * Against a 0.105 radius these run 1.6–2.1 spike-widths long: still a wedge,
 * not a needle (§1's "no thin parts" applies to a spike as much as to a limb),
 * but a wedge that comes to a point well clear of the skull — which is the
 * whole of what was wrong.
 *
 * **Sized to a height, deliberately.** Nine of these take the child to 2.329 m,
 * with the points standing 241 mm proud of the crown. Longer and more upright
 * both read better and both cost height, and she has to walk around a park
 * whose crowd is 2.12 m: nothing in the world actually stops her at 2.43 m
 * (the garlands hang at 3.1 and a shop floor is 3.6, and `npm run build` is
 * green either way), but she would then be half a metre over every other child
 * in the park, and a shorter dramatic spike beats a tall one that clips a
 * doorway somebody adds later. So this sits back at the ~2.3 m the style was
 * budgeted at before the shells landed.
 */
const SPIKES: readonly (readonly [number, number])[] = [
  [0.42, 0.24],
  [0.32, 0.4],
  [0.37, 0.31],
];

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
