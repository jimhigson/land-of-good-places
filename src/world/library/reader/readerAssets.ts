import { CylinderGeometry, Group, Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../../core/palette';
import { ART } from '../../../art/style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../../../art/style/materials';
import { createBakedFace, type Expression } from '../../../art/style/faces';
import { applyWalk, blob, makeLimbs, stub, type AssetHandle, type CreatureHandle } from '../../../art/style/asset';
import { LIBRARY_GLB_STYLES } from '../../../art/models/libraryAssets';
import { createStoryClosedBook } from './storyProps';

/**
 * **The book reader's own models** (#717, part 3 of the Library epic #714):
 * the cover it turns pages in, built from primitives until the Artist's
 * arrives, and the storybook dragon, a page illustration from before the
 * Blender ruling (Jim, 22 Oct 2026) that every new picture model is the
 * Artist's — see `storyProps.ts` for those.
 *
 * They live beside the reader rather than in `art/models/` because nothing but
 * the reader uses them, and because `art/models/libraryAssets.ts` belongs to
 * the library building (#716): its shelves, desk, lamps and shelf books. A
 * shelf book is not a picture-book prop; the two are drawn at different scales
 * for different jobs, and each has its own owner.
 *
 * Three factories, each the one owner of its thing:
 *
 * - {@link createReaderCover} — the open book the reader turns pages in: two
 *   cover boards and a rounded spine. The Artist is authoring this as
 *   `library.reader.cover` on `art/library-715`; until that `.glb` lands this
 *   is the stand-in, **behind this one factory**, so swapping it is a change to
 *   this file and nothing else. When it lands, the dimensions below must be
 *   *measured off the glb* (`visibleBounds`), never typed a second time — the
 *   reader reads them from here, and only from here.
 * - {@link createStoryBook} — the closed storybook in the pictures (a dragon's
 *   pile of them): the story-props kit's `closed-book`, behind the name the
 *   picture books' pages already use, so the twelve and the six name one
 *   closed book.
 * - {@link createStoryDragon} — the baby dragon in *The Dragon Who Reads*. The
 *   epic's fifth PR brings a Blender dragon to live in the secret den; this one
 *   is a page illustration, built the way the mini is (`mini.ts`): squashed
 *   spheres, a baked face, stubby nubs where a scary dragon would have spikes.
 *
 * ## The reader's frame
 *
 * Book-local, and every number in the reader is in it: **x** across the open
 * spread (the spine at x = 0, the right-hand page on +x), **y** up the page
 * (the spine runs from y = 0 to {@link READER_PAGE_HEIGHT}), **z** out of the
 * paper towards whoever is reading. The origin is the **spine base** — the
 * bottom of the spine, on the boards' inner face — which is the origin the
 * Artist's cover is being authored with.
 */

/** One page, spine to fore-edge. Portrait: a square picture and a sentence below it. */
export const READER_PAGE_WIDTH = 0.45;
/** One page, along the spine. */
export const READER_PAGE_HEIGHT = 0.6;
/** How far the boards stand proud of the paper on the three open sides. */
export const READER_BOARD_OVERHANG = 0.022;
/** Board thickness. */
export const READER_BOARD_THICKNESS = 0.016;
/**
 * The block of pages under each open side — the paper's own thickness, which
 * is what makes it read as a book rather than two cards. The flat pages lie on
 * top of it, at this height above the boards.
 */
export const READER_BLOCK_THICKNESS = 0.012;

export interface ReaderCoverHandle extends AssetHandle {
  /** The left board, page block included — it never moves. */
  readonly left: Group;
  /** The right board, likewise. */
  readonly right: Group;
}

/**
 * The open reader book's cover: two boards in `colour`, a spine between them,
 * and a cream page block on each — origin at the spine base, see the file
 * comment.
 */
export function createReaderCover(colour: number): ReaderCoverHandle {
  const root = new Group();
  root.name = 'library.reader.cover';
  const board = toonMaterial(colour);
  const paper = toonMaterial(PALETTE.signBoard);
  const edge = toonMaterial(ART.creamDark);

  const boardW = READER_PAGE_WIDTH + READER_BOARD_OVERHANG;
  const boardH = READER_PAGE_HEIGHT + READER_BOARD_OVERHANG * 2;
  const sides: Group[] = [];
  for (const side of [-1, 1] as const) {
    const group = new Group();
    group.name = side < 0 ? 'reader.board.left' : 'reader.board.right';
    const slab = solid(
      new Mesh(new RoundedBoxGeometry(boardW, boardH, READER_BOARD_THICKNESS, 3, 0.007), board),
    );
    slab.position.set((side * boardW) / 2, READER_PAGE_HEIGHT / 2, -READER_BOARD_THICKNESS / 2);
    group.add(slab);
    addOutline(slab, 0.006);

    // The page block: just inside the board, cream on top, a shade darker on
    // its edges so the stack of paper reads as a stack. Its top face is the
    // plane every flat page lies on.
    const block = solid(
      new Mesh(
        new RoundedBoxGeometry(READER_PAGE_WIDTH - 0.004, READER_PAGE_HEIGHT - 0.004, READER_BLOCK_THICKNESS, 2, 0.003),
        [edge, edge, edge, edge, paper, edge],
      ),
    );
    block.position.set((side * READER_PAGE_WIDTH) / 2, READER_PAGE_HEIGHT / 2, READER_BLOCK_THICKNESS / 2 - 0.001);
    group.add(block);
    root.add(group);
    sides.push(group);
  }

  // The spine: half a fat cylinder behind the gutter, the colour of the boards.
  const spine = solid(
    new Mesh(new CylinderGeometry(0.03, 0.03, boardH, 18, 1, false, Math.PI / 2, Math.PI), board),
  );
  spine.position.set(0, READER_PAGE_HEIGHT / 2, -READER_BOARD_THICKNESS);
  root.add(spine);

  const [left, right] = sides as [Group, Group];
  return { root, height: boardH, left, right };
}

/**
 * A closed picture book lying flat, its cover in `colour`: the story-props
 * kit's `closed-book` ({@link createStoryClosedBook}), whose size is the glb's
 * own. Origin at the bottom, spine to the front. One closed book for the
 * twelve picture books and the six chapter books alike — this is the picture
 * books' name for it, kept so their pages did not change.
 */
export function createStoryBook(colour: number): AssetHandle {
  return createStoryClosedBook(colour);
}

/** Head scale-up over the original authoring, the mini's own trick for a big cute skull. */
const DRAGON_HEAD = 1.35;

/**
 * A colour of the baby dragon who lives in the library's secret den (#719) —
 * its `LIBRARY_GLB_STYLES` row — so the dragon a child reads about and the one
 * she finds behind the bookcase are one dragon, with one owner of its look.
 */
function denDragonColour(node: 'dragon-body' | 'dragon-head' | 'dragon-belly' | 'dragon-horns' | 'dragon-wings'): number {
  const style = LIBRARY_GLB_STYLES[node];
  if (!style) throw new Error(`readerAssets: LIBRARY_GLB_STYLES has no '${node}' row for the storybook dragon`);
  return style.colour;
}

/**
 * The little dragon who would rather have books than gold. Mint, with a cream
 * tummy, two stubby cream horns, a pair of lilac wings that could not lift a
 * biscuit, and a curly tail. Origin at the feet, facing +Z, ~0.8 m tall.
 *
 * Its mint, tummy, horns, wings and the skin its face is painted on are the
 * den dragon's colours ({@link denDragonColour}); only the darker feet and
 * paws are the storybook's own.
 */
export function createStoryDragon(): CreatureHandle {
  const root = new Group();
  root.name = 'library.storyDragon';
  const body = new Group();
  root.add(body);

  const scales = toonMaterial(denDragonColour('dragon-body'));
  const scalesDark = toonMaterial(PALETTE.leafLight);
  const tummyMat = toonMaterial(denDragonColour('dragon-belly'));
  const hornMat = toonMaterial(denDragonColour('dragon-horns'));
  const wingMat = toonMaterial(denDragonColour('dragon-wings'));

  const limbs = makeLimbs();

  const torso = blob(0.16, scales, [1.05, 1.0, 0.95]);
  torso.position.y = 0.2;
  body.add(torso);
  addOutline(torso, 0.012);

  const tummy = decal(blob(0.1, tummyMat, [1, 1.1, 0.5], 24));
  tummy.position.set(0, 0.19, 0.12);
  body.add(tummy);

  for (const side of [-1, 1] as const) {
    const leg = side < 0 ? limbs.leftLeg : limbs.rightLeg;
    leg.position.set(side * 0.085, 0.1, 0);
    body.add(leg);
    const foot = blob(0.07, scalesDark, [1, 0.62, 1.3], 16);
    foot.position.set(0, -0.06, 0.03);
    leg.add(foot);
    addOutline(foot, 0.009);

    const arm = side < 0 ? limbs.leftArm : limbs.rightArm;
    arm.position.set(side * 0.15, 0.25, 0.02);
    arm.rotation.z = side * 0.35;
    body.add(arm);
    const limb = stub(0.035, 0.07, scales);
    limb.position.y = -0.05;
    arm.add(limb);
    const paw = blob(0.045, scalesDark, [1, 1, 1], 12);
    paw.position.y = -0.105;
    arm.add(paw);

    // A wing: a flattened blob, tipped back, far too small to fly with.
    const wing = blob(0.11, wingMat, [0.25, 0.85, 1.15], 16);
    wing.position.set(side * 0.13, 0.3, -0.12);
    wing.rotation.set(0.5, side * 0.6, side * -0.55);
    body.add(wing);
    addOutline(wing, 0.008);
  }

  // The tail: three blobs getting smaller, curling up at the end.
  const tailBits: readonly [number, number, number, number][] = [
    [0, 0.12, -0.17, 0.08],
    [0, 0.1, -0.29, 0.06],
    [0, 0.15, -0.37, 0.045],
  ];
  for (const [x, y, z, r] of tailBits) {
    const bit = blob(r, scales, [1, 0.9, 1.2], 14);
    bit.position.set(x, y, z);
    body.add(bit);
    addOutline(bit, 0.008);
  }

  const head = new Group();
  head.position.y = 0.48;
  body.add(head);
  const skull = blob(0.16 * DRAGON_HEAD, scales, [1.12, 0.98, 1], 28);
  head.add(skull);
  addOutline(skull, 0.012);

  for (const side of [-1, 1] as const) {
    const horn = solid(new Mesh(new CylinderGeometry(0.012, 0.03, 0.08, 10), hornMat));
    horn.position.set(side * 0.09 * DRAGON_HEAD, 0.15 * DRAGON_HEAD, -0.02);
    horn.rotation.z = side * -0.35;
    head.add(horn);
    const tip = blob(0.014, hornMat, [1, 1, 1], 8);
    tip.position.set(side * 0.105 * DRAGON_HEAD, 0.185 * DRAGON_HEAD, -0.02);
    head.add(tip);
  }

  const face = createBakedFace({
    fill: denDragonColour('dragon-head'),
    spreadX: 1.9,
    spreadY: 1.8,
    tilt: 0.14,
    size: 256,
    eyeY: 0.44,
    eyeGap: 0.44,
    eyeW: 0.12,
    eyeH: 0.15,
    iris: PALETTE.iris,
    mouth: 'smile',
    mouthW: 0.1,
    mouthDrop: 0.18,
    blush: ART.snakeCoral,
    blushStyle: 'soft',
    blushR: 0.07,
  });
  face.applyTo(skull);

  return {
    root,
    body,
    head,
    limbs,
    height: 0.48 + 0.16 * DRAGON_HEAD * 0.98 + 0.08,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(limbs, body, phase, speed, 0.5, 0.06),
  };
}
