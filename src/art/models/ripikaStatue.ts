import { CylinderGeometry, Group, Mesh } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, disposeTree, inkTint, solid, toonMaterial } from '../style/materials';
import type { AssetHandle } from '../style/asset';
import { createRipika, type RipikaPalette } from './ripika';

/**
 * The grey-stone RiPika that stands in the middle of the wishing fountain.
 * Family request, 28 July 2026 (issue #121).
 *
 * ## Why this is not a second model
 *
 * It would have been easy to carve a statue of RiPika. It is better to render
 * RiPika *as* stone, and the difference is not stylistic — it is about which
 * version goes stale.
 *
 * A hand-authored statue is a second RiPika, and a second RiPika has to be kept
 * in step with the first by hand forever. Retune the head scale, change the
 * ears, repaint the face, and the statue silently becomes a statue of a mouse
 * the park no longer contains. This repo has written that post-mortem more than
 * once (the hood faces, the sky dome): a second thing positioned or shaped by a
 * formula that has to track the first is a place for a bug to hide.
 *
 * So the statue calls `createRipika` with a **stone colourway**. Every
 * proportion, every squash, every outline is the live mouse's, and a change to
 * her reaches her statue for free. ART_DIRECTION §7 asks for exactly this:
 * primitive composition is the preferred way to build a model, and the Blender
 * exemption is scoped to organic continuous forms like hair — which a statue of
 * an already-primitive-built mouse is not.
 *
 * ## What makes it read as stone rather than a grey mouse
 *
 * Not a single flat grey. `ART.statueStone*` is a five-step tonal ladder
 * ordered by the luminance of the colour each step replaces, so the cocoa ear
 * tips, the cream tummy and the amber tail tip survive the trip to stone as
 * tonal steps rather than disappearing. A statue that loses its markings reads
 * as a lump at play distance, which is precisely the failure the cream tummy
 * exists to prevent on the live mouse.
 *
 * The face is **repainted** in stone, not tinted and not removed — see
 * `ripika.ts`. Tinting leaves a grey statue with tomato cheeks; removing it
 * leaves a blank ball, because since the 31 July baked-face rework the face
 * lives in the skull's own texture and there is no separate mesh to hide.
 *
 * The outlines need no special handling at all, which is worth stating because
 * an earlier research note warned about re-materialling `addOutline`'s
 * inverted-hull shells and hitting their `BackSide` material. That danger only
 * exists if you build a yellow mouse and then walk the tree recolouring it.
 * Building in stone from the start means `addOutline` reads each mesh's own
 * stone colour as it goes and ink-tints it correctly — there is no second pass,
 * so there is nothing to get wrong.
 */

/** RiPika in carved stone. See `ART.statueStone*` for why it is a ladder. */
const STONE_PALETTE: RipikaPalette = {
  yellow: ART.statueStone,
  yellowDeep: ART.statueStoneMid,
  belly: ART.statueStoneLight,
  tip: ART.statueStoneDark,
  bolt: ART.statueStoneDeep,
  cheek: ART.statueStoneDeep,
};

/**
 * How tall the carved figure is, ear tips included — plinth not counted.
 *
 * **6.80 m: four times the 1.70 m this was first built at.** Jim looked at the
 * first version in the park on 5 August 2026 and said "far too small, make it
 * 4x this size, otherwise is ok" — everything else about it passed, only the
 * scale was wrong, and the issue title had asked for a *large* statue all
 * along.
 *
 * The earlier note here claimed 1.70 m was a ceiling because anything taller
 * would occlude the plaza ring. That was too cautious — the ring road's nearest
 * approach is 13.90 m from the fountain axis and the statue's occluded ground
 * wedge reaches 13.32 m, so the road stays visible. **By 0.58 m.** That is a
 * coincidence, not a margin: roughly 5% more height and the ring road goes
 * behind the statue.
 *
 * ## The cost, measured — do not raise this number without re-measuring
 *
 * When this was resized I justified it here by arguing that "the camera follows
 * the player, so the statue only ever hides the far side of a plaza the player
 * is already standing in". **That reasoning is wrong and the comment has been
 * corrected rather than quietly deleted, because it is a tempting mistake.**
 *
 * The camera is **orthographic** (`CAMERA_IS_ORTHOGRAPHIC`). An orthographic
 * projection has no parallax, so the occluded wedge is **fixed in world space**:
 * moving the camera changes whether that patch is on screen, not *what* is
 * hidden behind the statue. The player can therefore stand in it, and does.
 *
 * Surveyed on the built park at this height: a 2.12 m player is fully hidden
 * anywhere within **10.60 m** of the fountain centre — past the 9.4 m plaza
 * kerb — which is **32.8 m² of walkable ground**. At 1.70 m it was 2.70 m,
 * i.e. inside the basin, i.e. never. Two pickable flowers (at (-1.2, -0.7) and
 * (-2.5, -1.0)) are now permanently behind it.
 *
 * `FoliageFade` is the system that exists for exactly this ("no more rotating
 * round a tree that's in the way", design feedback #16) and it only accepts
 * trees, so the statue does not fade. If this height stays, that is the gap to
 * close — not a smaller statue.
 */
const FIGURE_HEIGHT = 6.8;

/**
 * Plinth height — also 4x, so the statue as a whole is the 4x that was asked
 * for and the plinth keeps its proportion to the figure (~21%).
 *
 * The plinth could not simply be scaled 4x in *every* dimension; see
 * {@link PLINTH_BASE_RADIUS}.
 */
const PLINTH_HEIGHT = 1.44;

/**
 * The plinth's widest radius, at the bottom of its footing.
 *
 * **This is the one dimension that could not go up 4x, and the constraint is
 * hard.** The plinth stands on the fountain's upper bowl of water, which is a
 * 1.2 m-radius disc (`world/Fountain.ts`). Four times the original 0.82 m would
 * be 3.28 m — it would overhang the bowl entirely and hang in mid-air over the
 * basin, nearly reaching the 4.2 m rim.
 *
 * So the plinth grows 4x in height and only ~1.4x in radius, and 1.15 m is what
 * that leaves: as wide as the bowl can host, with 5 cm of margin.
 *
 * The happy accident is that this is almost exactly the width the figure needs
 * anyway. At 4x, RiPika's feet span about 2.14 m across and her torso about
 * 2.28 m, against this plinth's 2.30 m — so she stands squarely on it and the
 * drum reads as the same width as the body above it. A plinth that had scaled
 * 4x in radius would have been far too wide for the figure standing on it; the
 * constraint pushed the proportion somewhere better than the naive scaling
 * would have.
 */
const PLINTH_BASE_RADIUS = 1.15;

export interface RipikaStatueHandle extends AssetHandle {
  /** The plinth alone, for anything that wants to light or decorate it. */
  readonly plinth: Group;
}

/**
 * Builds the statue. Origin at the **base of the plinth**, centred on X and Z,
 * facing +Z — the standard asset contract, so a caller seats it by setting
 * `root.position.y` to whatever it stands on and needs no fudge factor.
 */
export function createRipikaStatue(): RipikaStatueHandle {
  const root = new Group();
  root.name = 'prop.ripikaStatue';

  // --- plinth ---------------------------------------------------------------
  // Three dressed courses rather than one drum: a footing, the drum itself, and
  // a cap that flares back out into an overhanging lip for the feet to stand
  // on. Flat colour, no stone map — a tiling cobble texture on something this
  // small reads as busy noise at play distance, and ART_DIRECTION §7 is explicit
  // that flat colours are material colours rather than maps. Two tones is all
  // it takes to read as dressed stone with a shadow line under the lip.
  const plinth = new Group();
  plinth.name = 'statuePlinth';
  root.add(plinth);

  // The plinth takes two steps from the figure's own ladder rather than a
  // dedicated pair of greys. Same rock, cut into blocks instead of a mouse —
  // which is both what a real plinth is and one fewer place for the park to
  // acquire a second, slightly different stone.
  const plinthStone = toonMaterial(ART.statueStoneMid);
  const plinthStoneDark = toonMaterial(ART.statueStoneDeep);
  const plinthInk = inkTint(ART.statueStoneDeep);

  const course = (
    topR: number,
    bottomR: number,
    height: number,
    centreY: number,
    material: typeof plinthStone,
  ): Mesh => {
    const mesh = solid(new Mesh(new CylinderGeometry(topR, bottomR, height, 28), material));
    mesh.position.y = centreY;
    plinth.add(mesh);
    return mesh;
  };

  // The three courses are written as FRACTIONS of the plinth's overall height
  // and base radius rather than as absolute metres, because those two grew by
  // different factors when the statue was resized (4x tall, 1.4x wide — see
  // PLINTH_BASE_RADIUS). Absolute numbers would have had to be re-derived by
  // hand for each course, twice, and a single fat-fingered digit would have gone
  // unnoticed. This way the plinth's shape is one thing and its size is another.
  const r = (fraction: number): number => fraction * PLINTH_BASE_RADIUS;
  const h = (fraction: number): number => fraction * PLINTH_HEIGHT;

  const footing = course(r(0.902), r(1), h(0.25), h(0.125), plinthStoneDark);
  const drum = course(r(0.756), r(0.902), h(0.583), h(0.542), plinthStone);
  course(r(0.854), r(0.756), h(0.167), h(0.917), plinthStoneDark);

  // --- the figure -----------------------------------------------------------
  // Scaled on a wrapper group rather than on RiPika's own root, because the
  // asset contract reserves `root.scale` for gameplay squash-and-stretch and a
  // scaled root would quietly break that promise for anything that later picks
  // this handle up. The wrapper scales the outlines along with the geometry,
  // which is what ART_DIRECTION §2 wants — an outline scales with its object.
  const figure = new Group();
  figure.name = 'statueFigure';
  figure.position.y = PLINTH_HEIGHT;
  root.add(figure);

  const ripika = createRipika({ palette: STONE_PALETTE, expressions: false });
  // Derived from the handle rather than written down, so if RiPika's height is
  // ever retuned the statue stays exactly FIGURE_HEIGHT tall instead of drifting
  // and pushing its own `height` — and the name label above it — out of true.
  const figureScale = FIGURE_HEIGHT / ripika.height;
  figure.scale.setScalar(figureScale);
  figure.add(ripika.root);

  // Outlines on the two courses that define the silhouette, not all three: the
  // cap sits inside the footing's line from every angle the iso camera reaches,
  // and outlining it too draws a stray line across the plinth's middle.
  //
  // Weight is taken from the FIGURE's, not from ART_DIRECTION §2's raw
  // 0.016–0.022 band, and the difference matters at this size. RiPika's own
  // parts are outlined at 0.014 in her local metres, and the wrapper group
  // multiplies that by `figureScale` — so at 4x the figure's lines come out
  // near 6.5 cm. A plinth still wearing a literal 0.02 would have looked like a
  // pencil sketch bolted to the bottom of a woodcut. Matching the figure's is
  // what makes the plinth and the mouse read as one carved object, and it stays
  // matched automatically if the statue is ever resized again.
  const plinthOutline = 0.014 * figureScale;
  addOutline(footing, plinthOutline, plinthInk);
  addOutline(drum, plinthOutline, plinthInk);

  // Pose. Deliberately NOT `setWalkPhase(0, 0)`: a freshly built RiPika is
  // already in the neutral stance (identity limbs, identity body), and
  // `setWalkPhase` would additionally flatten the tail's authored 1.05 rad cant
  // to zero — the cant that keeps the lightning flash fanned across the screen
  // instead of hidden behind the body.
  //
  // One raised arm, mid-wave. It gives the statue an asymmetric silhouette that
  // reads from across the plaza, which is the thing that actually decides
  // whether a six-year-old recognises it — and ART_DIRECTION §4 asks for
  // exactly this ("nothing is plumb"). A statue standing perfectly straight and
  // symmetrical looks like a placeholder.
  if (ripika.limbs) {
    ripika.limbs.rightArm.rotation.z = 1.3;
    ripika.limbs.rightArm.rotation.x = -0.15;
  }
  // A little life in the head to match the wave: tipped towards the raised arm
  // and turned a few degrees off dead-ahead. Rotating `head` does not move the
  // body — that is the contract on `CreatureHandle.head`.
  ripika.head.rotation.z = 0.07;
  ripika.head.rotation.y = -0.12;

  return {
    root,
    plinth,
    height: PLINTH_HEIGHT + FIGURE_HEIGHT,
    dispose: () => disposeTree(root),
  };
}
