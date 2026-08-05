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
 * 1.70 m is a deliberate ceiling, not a round number. On the plinth, in the
 * fountain, this tops out around y 4.2 in world space, level with the fairy
 * poles. Taller and the statue starts occluding the plaza ring behind it from
 * the iso camera, which costs more than the extra grandeur buys.
 */
const FIGURE_HEIGHT = 1.7;

/** Plinth height. The figure's feet stand on top of it. */
const PLINTH_HEIGHT = 0.36;

/**
 * The plinth's widest radius, at the bottom of its footing.
 *
 * Hard ceiling is 1.2 m: the fountain's upper bowl of water is a 1.2 m-radius
 * disc and the plinth stands **on** it (see `world/Fountain.ts`). 0.82 leaves
 * 0.38 m of margin, which is margin the statue does not need but the six jets
 * arcing out at radius 1.22 very much do.
 */
const PLINTH_BASE_RADIUS = 0.82;

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

  const plinthStone = toonMaterial(ART.statuePlinth);
  const plinthStoneDark = toonMaterial(ART.statuePlinthDark);
  const plinthInk = inkTint(ART.statuePlinthDark);

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

  const footing = course(0.74, PLINTH_BASE_RADIUS, 0.09, 0.045, plinthStoneDark);
  const drum = course(0.62, 0.74, 0.21, 0.195, plinthStone);
  course(0.7, 0.62, 0.06, 0.33, plinthStoneDark);

  // Outlines on the two courses that define the silhouette, not all three: the
  // cap sits inside the footing's line from every angle the iso camera reaches,
  // and outlining it too draws a stray line across the plinth's middle.
  // Thickness 0.02 — the prop end of ART_DIRECTION §2's 0.016–0.022 band, since
  // this is a big solid object rather than a small creature part.
  addOutline(footing, 0.02, plinthInk);
  addOutline(drum, 0.02, plinthInk);

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
  figure.scale.setScalar(FIGURE_HEIGHT / ripika.height);
  figure.add(ripika.root);

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
