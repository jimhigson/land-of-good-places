import { Group, Vector3, type BufferAttribute, type Mesh, type MeshToonMaterial, type Texture } from 'three';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../style/materials';
import { visibleBounds, visiblePoints, visibleReachXZ } from '../style/measure';
import type { AssetHandle, CreatureHandle } from '../style/asset';
import type { Expression } from '../style/faces';
import { LIBRARY_GLB_STYLES, libraryKitMesh } from './libraryAssets';
import { kitBounds, libraryPart } from './libraryKit';
import { catFaceTextures, dragonFaceTextures, owlFaceTextures, type CatFace, type DragonFace, type OwlFace } from './libraryFaces';

/**
 * **The Library's creatures, as assets** (#718, #719): the owl librarian, the
 * baby dragon and its nest of books, the library cat and her pile of books.
 *
 * Shape is the 3D Artist's (`library.glb`, decoded once by `libraryKit.ts`);
 * every colour and outline is `LIBRARY_GLB_STYLES`'s, through the one dresser
 * (`libraryKitMesh`); every face is `libraryFaces.ts`'s, painted into each
 * head's own UVs. This file only **assembles**: it hangs each node under the
 * group that moves it, at the pivot the Artist authored.
 *
 * ## Nothing typed
 *
 * - **Every pivot is read off the file** — a group stands at its node's
 *   translation (`libraryPart(name).position`, which is the node's pivot), and
 *   a part hung under it keeps its own translation less the group's. The file
 *   is flat — every node is a child of the scene — so the cat's ears are
 *   re-parented under her head here, by subtraction, and ride it when she lifts
 *   it; the owl's book rides her right wing the same way; the dragon's horns
 *   share its head's pivot, so they turn with it.
 * - **Every height is `visibleBounds(root).top`**, and `root.scale` is never
 *   touched (the asset contract keeps it for the caller's squash and stretch),
 *   so `check:assets` measures each of these against itself.
 * - **Every figure a placer needs is measured here**, off the built model:
 *   the nest's pad top and its reach, the pile's plan, the dragon's mouth.
 *
 * Every root's origin is at the feet, facing +Z (ASSET_MANIFEST's contract).
 * The life — breathing, blinking, a head that turns to look at her, the puff,
 * the purr — belongs to whoever places them (`LibraryOwl`, `LibraryDen`,
 * `LibraryCat`), which drive the groups and the `setFace` swaps below.
 */

/** A node's colour, from the one table. */
function colourOf(name: string): number {
  const style = LIBRARY_GLB_STYLES[name];
  if (!style) throw new Error(`libraryCreatures: '${name}' has no row in LIBRARY_GLB_STYLES`);
  return style.colour;
}

/** A group standing at a node's pivot — its translation in the file. */
function pivotGroup(name: string, node: string): Group {
  const group = new Group();
  group.name = name;
  group.position.copy(libraryPart(node).position);
  return group;
}

/** Hang a dressed node under `group`, keeping where it is: its translation less the group's. */
function hang(group: Group, mesh: Mesh): Mesh {
  mesh.position.sub(group.position);
  group.add(mesh);
  return mesh;
}

/** A head that owns its material, so swapping its face can never repaint another part of the same colour. */
function facedHead(name: string, map: Texture): { readonly mesh: Mesh; readonly material: MeshToonMaterial } {
  const material = toonMaterial(colourOf(name), { map });
  return { mesh: libraryKitMesh(name, material), material };
}

// ---------------------------------------------------------------------------
// The owl librarian
// ---------------------------------------------------------------------------

export interface OwlHandle extends AssetHandle {
  /** Everything above her feet' ground: the breathing target. Holds her feet, body, bib and buttons, and the groups below. */
  readonly body: Group;
  /** At `owl-head`'s pivot: her head (the face), her beak and her glasses. Turns to look at her. */
  readonly head: Group;
  /** Her free wing, at `owl-wingL`'s pivot: the shush. */
  readonly wingL: Group;
  /** At `owl-wingR`'s pivot, holding the wing and the book she carries, which rides it. */
  readonly wingR: Group;
  /** The head's own material: `map` is the face showing. */
  readonly headMaterial: MeshToonMaterial;
  /** The face showing now. */
  readonly face: OwlFace;
  setFace(face: OwlFace): void;
  /** The house expressions, onto hers: surprised is the shush; sad and frown are not hers. */
  setExpression(expression: Expression): void;
}

const OWL_FACE_FOR: Readonly<Record<Expression, OwlFace>> = {
  neutral: 'neutral',
  blink: 'blink',
  happy: 'happy',
  surprised: 'shush',
  sad: 'neutral',
  frown: 'neutral',
};

/**
 * **The owl librarian** — round, in a lilac cardigan and big glasses, a red
 * book under her right wing. 1.6 m to the top of her head; she never walks, so
 * she has no walk phase.
 */
export function createLibraryOwl(): OwlHandle {
  const root = new Group();
  root.name = 'library.owl';
  const body = new Group();
  body.name = 'library.owl.body';
  root.add(body);
  for (const name of ['owl-feet', 'owl-body', 'owl-bib', 'owl-buttons']) body.add(libraryKitMesh(name));

  const faces = owlFaceTextures();
  const head = pivotGroup('library.owl.head', 'owl-head');
  body.add(head);
  const face = facedHead('owl-head', faces.neutral);
  hang(head, face.mesh);
  hang(head, libraryKitMesh('owl-beak'));
  hang(head, libraryKitMesh('owl-glasses'));

  const wingL = pivotGroup('library.owl.wingL', 'owl-wingL');
  body.add(wingL);
  hang(wingL, libraryKitMesh('owl-wingL'));
  const wingR = pivotGroup('library.owl.wingR', 'owl-wingR');
  body.add(wingR);
  hang(wingR, libraryKitMesh('owl-wingR'));
  hang(wingR, libraryKitMesh('owl-heldBook'));

  let showing: OwlFace = 'neutral';
  const setFace = (next: OwlFace): void => {
    if (next === showing) return;
    showing = next;
    face.material.map = faces[next];
  };
  return {
    root,
    height: visibleBounds(root).top,
    body,
    head,
    wingL,
    wingR,
    headMaterial: face.material,
    get face() {
      return showing;
    },
    setFace,
    setExpression: (expression) => setFace(OWL_FACE_FOR[expression]),
  };
}

// ---------------------------------------------------------------------------
// The baby dragon, and its nest of books
// ---------------------------------------------------------------------------

/**
 * How brightly the dragon's belly glows at rest, as a share of its warm
 * emissive — the one owner of the number: the puff (`LibraryDen`, #719) rises
 * from it and comes back to it.
 */
export const DRAGON_BELLY_REST_GLOW = 0.2;

export interface DragonHandle extends CreatureHandle {
  /** The `dragon-tail` mesh, at its pivot where it leaves the body: `rotation.y` flicks it. */
  readonly tail: Mesh;
  /** The belly's own material — warm-lit, `emissiveIntensity` {@link DRAGON_BELLY_REST_GLOW} at rest; the puff raises it. */
  readonly belly: MeshToonMaterial;
  /** The front-most point of its head, in the root's frame, at rest — where a puff comes from. */
  readonly mouth: Vector3;
  /** The same point in the head group's frame, so a puff follows the head when it turns. */
  readonly mouthInHead: Vector3;
  /** The head's own material: `map` is the face showing. */
  readonly headMaterial: MeshToonMaterial;
  readonly face: DragonFace;
  setFace(face: DragonFace): void;
}

const DRAGON_FACE_FOR: Readonly<Record<Expression, DragonFace>> = {
  neutral: 'neutral',
  blink: 'blink',
  happy: 'happy',
  surprised: 'puff',
  sad: 'neutral',
  frown: 'neutral',
};

/** The front-most vertex of a node, in the asset's frame (its node transform applied). */
function frontMost(name: string): Vector3 {
  const part = libraryPart(name);
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  const point = new Vector3();
  const best = new Vector3(0, 0, Number.NEGATIVE_INFINITY);
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).multiply(part.scale).applyQuaternion(part.quaternion).add(part.position);
    if (point.z > best.z) best.copy(point);
  }
  if (!Number.isFinite(best.z)) throw new Error(`libraryCreatures: '${name}' has no vertices`);
  return best;
}

/**
 * **The baby dragon** — mint, with a cream tummy that glows warm, two stubby
 * horns and little lilac wings: the same dragon as the storybook's, its
 * colours read from the same `LIBRARY_GLB_STYLES` rows. 0.9 m to its horns.
 * It never walks: `limbs` is null and `setWalkPhase` does nothing.
 */
export function createLibraryDragon(): DragonHandle {
  const root = new Group();
  root.name = 'library.dragon';
  const body = new Group();
  body.name = 'library.dragon.body';
  root.add(body);
  const belly = toonMaterial(colourOf('dragon-belly'), { emissive: PALETTE.fairyWarm, emissiveIntensity: DRAGON_BELLY_REST_GLOW });
  body.add(libraryKitMesh('dragon-body'));
  body.add(libraryKitMesh('dragon-belly', belly));
  body.add(libraryKitMesh('dragon-spines'));
  body.add(libraryKitMesh('dragon-wings'));
  // The tail's node translation is its pivot (where it leaves the body), so
  // the mesh itself turns about it.
  const tail = libraryKitMesh('dragon-tail');
  body.add(tail);

  const faces = dragonFaceTextures();
  const head = pivotGroup('library.dragon.head', 'dragon-head');
  body.add(head);
  const face = facedHead('dragon-head', faces.neutral);
  hang(head, face.mesh);
  hang(head, libraryKitMesh('dragon-horns'));

  const mouth = frontMost('dragon-head');
  const mouthInHead = mouth.clone().sub(head.position);

  let showing: DragonFace = 'neutral';
  const setFace = (next: DragonFace): void => {
    if (next === showing) return;
    showing = next;
    face.material.map = faces[next];
  };
  return {
    root,
    height: visibleBounds(root).top,
    body,
    head,
    limbs: null,
    tail,
    belly,
    mouth,
    mouthInHead,
    headMaterial: face.material,
    get face() {
      return showing;
    },
    setFace,
    setExpression: (expression) => setFace(DRAGON_FACE_FOR[expression]),
    setWalkPhase: () => {},
  };
}

export interface DragonNestHandle extends AssetHandle {
  /** The soft pad's top, where the dragon sits — measured off `dragonNest-pad`. */
  readonly padTop: number;
  /** How far the drawn nest reaches from its centre in plan, outlines included (`visibleReachXZ`). */
  readonly radius: number;
}

/** **The dragon's nest**: a soft pink pad ringed by three rows of fat books, cream page edges out. */
export function createLibraryDragonNest(): DragonNestHandle {
  const root = new Group();
  root.name = 'library.dragonNest';
  for (const name of ['dragonNest-pad', 'dragonNest-coversA', 'dragonNest-coversB', 'dragonNest-coversC', 'dragonNest-pages']) {
    root.add(libraryKitMesh(name));
  }
  return { root, height: visibleBounds(root).top, padTop: kitBounds(['dragonNest-pad']).maxY, radius: visibleReachXZ(root) };
}

// ---------------------------------------------------------------------------
// The library cat, and her pile of books
// ---------------------------------------------------------------------------

export interface CatHandle extends AssetHandle {
  /** Everything above the pile: the breathing target. */
  readonly body: Group;
  /** At `cat-head`'s pivot, carrying both ears: lifts when she is petted. */
  readonly head: Group;
  /** The ears, under the head at their own pivots: `rotation.z` twitches them. */
  readonly earL: Mesh;
  readonly earR: Mesh;
  /** The tail, at its pivot where it leaves her body. */
  readonly tail: Mesh;
  /** The head's own material: `map` is the face showing. */
  readonly headMaterial: MeshToonMaterial;
  readonly face: CatFace;
  setFace(face: CatFace): void;
  /** The house expressions, onto hers: she is asleep unless something makes her happy. */
  setExpression(expression: Expression): void;
}

const CAT_FACE_FOR: Readonly<Record<Expression, CatFace>> = {
  neutral: 'asleep',
  blink: 'asleep',
  happy: 'happy',
  surprised: 'happy',
  sad: 'asleep',
  frown: 'asleep',
};

/** **The library cat** — ginger, curled up asleep. 0.35 m to the tips of her ears. */
export function createLibraryCat(): CatHandle {
  const root = new Group();
  root.name = 'library.cat';
  const body = new Group();
  body.name = 'library.cat.body';
  root.add(body);
  body.add(libraryKitMesh('cat-body'));
  const tail = libraryKitMesh('cat-tail');
  body.add(tail);

  const faces = catFaceTextures();
  const head = pivotGroup('library.cat.head', 'cat-head');
  body.add(head);
  const face = facedHead('cat-head', faces.asleep);
  hang(head, face.mesh);
  const earL = hang(head, libraryKitMesh('cat-earL'));
  const earR = hang(head, libraryKitMesh('cat-earR'));

  let showing: CatFace = 'asleep';
  const setFace = (next: CatFace): void => {
    if (next === showing) return;
    showing = next;
    face.material.map = faces[next];
  };
  return {
    root,
    height: visibleBounds(root).top,
    body,
    head,
    earL,
    earR,
    tail,
    headMaterial: face.material,
    get face() {
      return showing;
    },
    setFace,
    setExpression: (expression) => setFace(CAT_FACE_FOR[expression]),
  };
}

export interface BookPileHandle extends AssetHandle {
  /** The drawn pile's plan about its origin, outlines included — what a collider has to cover. */
  readonly plan: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
}

/** **The cat's pile of books**: five fat books, each a little askew, 0.9 m high. */
export function createLibraryBookPile(): BookPileHandle {
  const root = new Group();
  root.name = 'library.bookPile';
  for (const name of ['bookPile-cover1', 'bookPile-cover2', 'bookPile-cover3', 'bookPile-cover4', 'bookPile-cover5', 'bookPile-pages']) {
    root.add(libraryKitMesh(name));
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  visiblePoints(root, (point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });
  return { root, height: visibleBounds(root).top, plan: { minX, maxX, minZ, maxZ } };
}
