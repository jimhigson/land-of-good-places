import { Group, Mesh, Vector3, type BufferAttribute, type Material, type MeshToonMaterial } from 'three';
import { PALETTE } from '../../../core/palette';
import { ART } from '../../../art/style/artPalette';
import { STORY_FACES, STORY_PROPS_GLB_BASE64, type StoryFaceFigures } from '../../../art/assets/storyPropsGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../../../art/style/glb';
import { addOutline, decal, markShared, solid, toonMaterial, type ToonOptions } from '../../../art/style/materials';
import { visibleBounds } from '../../../art/style/measure';
import type { AssetHandle, CreatureHandle } from '../../../art/style/asset';
import { createBakedFace, paintFaceOnFill, type Expression, type FacePaintOptions } from '../../../art/style/faces';
import type { PartStyle } from '../../../art/models/libraryAssets';

/**
 * **The story-props kit, loaded** — every model the six chapter books'
 * pictures need that the park had no model for, as factories a page's cast
 * can call (Jim, 22 Oct 2026: *"model in Blender as much as is needed, in
 * preference to coding geometric primitives"*).
 *
 * Shape is the 3D Artist's: `src/art/assets/storyProps.glb`
 * (`art/blend/story_props_build.py`, its `CONTRACT` asserted against the
 * emitted vertices on every build), decoded **once, on first use** — the
 * reader is the only caller, and nobody opens a book at boot. Everything
 * below — the {@link STORY_PROPS_STYLES} table, the ink outlines, the shadow
 * flags, the two painted faces — is this file's, exactly the library's split
 * (`libraryAssets.ts`): one decode, one table, one dresser.
 *
 * ## Nothing typed
 *
 * - **Every height is `visibleBounds(root).top`**, measured off the built
 *   model; `root.scale` is never touched (the asset contract keeps it for the
 *   caller's squash and stretch — a page's `size`). `check:assets` measures
 *   each of these against itself.
 * - **The faces' figures come from the art**: `STORY_FACES` (packed out of
 *   the glb's own node extras, asserted equal by `check:story-props-glb`)
 *   gives each faced node its eye row and eye gap as canvas fractions. The
 *   eye and mouth **sizes** are this file's: the painter's style, not the
 *   head's shape. Both faced nodes were built round (window ≈ square) so the
 *   painter's square canvas lands undistorted.
 * - **The rainbow has as many bands as `ART.rainbow` has colours**, inner
 *   band first — the park's one rainbow — and the build read the same length,
 *   so the loader throws if the file and the palette ever disagree.
 *
 * ## Faces: painted into the node's own UVs
 *
 * The Artist wrote `v` pre-inverted (`library_build.py`'s face windows), so
 * once the `.glb` is read `v` climbs with height and a **default**
 * `CanvasTexture` (flipY true — what `paintFace` makes) is the right
 * orientation; `glbCanvasTexture` would paint every mouth above its eyes.
 * `createBakedFace(...).applyTo(mesh, { uvsAuthored: true })` keeps the
 * authored UVs and gives Nimbus the house expression set — frown, sad,
 * surprised and happy are the four the story asks for. The duck's face never
 * changes, so it is one canvas through `paintFaceOnFill`.
 *
 * Every root's origin is at the base, facing +Z (ASSET_MANIFEST's contract),
 * and `root.name` is `story.<asset>`.
 */

// ---------------------------------------------------------------------------
// One decode, on first use
// ---------------------------------------------------------------------------

let decoded: Map<string, GlbPart> | null = null;

/** Every node of the kit, decoded on the first call and checked against the table. */
function parts(): Map<string, GlbPart> {
  if (decoded) return decoded;
  decoded = readGlbParts(base64ToArrayBuffer(STORY_PROPS_GLB_BASE64));
  const names = [...decoded.keys()];
  const undressed = names.filter((name) => !STORY_PROPS_STYLES[name]);
  const stale = Object.keys(STORY_PROPS_STYLES).filter((name) => !decoded?.has(name));
  if (undressed.length > 0 || stale.length > 0) {
    throw new Error(
      `storyProps: STORY_PROPS_STYLES and storyProps.glb disagree — undressed nodes: ${undressed.join(', ') || 'none'}; ` +
        `rows naming no node: ${stale.join(', ') || 'none'}`,
    );
  }
  for (const name of names) markShared(decoded.get(name)!.geometry);
  return decoded;
}

/** One node of the kit, or a throw naming every node the file has. */
export function storyPropPart(name: string): GlbPart {
  const part = parts().get(name);
  if (!part) {
    throw new Error(`storyProps: '${name}' is not a node in storyProps.glb. The file has: ${[...parts().keys()].sort().join(', ')}.`);
  }
  return part;
}

/** Every node name in the file. */
export function storyPropPartNames(): readonly string[] {
  return [...parts().keys()];
}

// ---------------------------------------------------------------------------
// Dressing — the one place a story prop's colour is chosen
// ---------------------------------------------------------------------------

/**
 * **Every node in `storyProps.glb`, dressed.** From `PALETTE` and `ART` only
 * (ART_DIRECTION §5). A node with no row here throws at the first decode, and a
 * row naming no node throws too. Where a page passes its own colour (a book's
 * cover, a flower's petals, Nimbus grey or white, a red feather) the row is
 * the default.
 *
 * **Keyed by node name with literal `PALETTE.`/`ART.` keys**, because
 * `art/blend/story_props_render.py` reads each row's colour key out of this
 * file's text with a regex, so the Artist's review renders show the game's
 * own colours (the rainbow bands are the one exception: their colours are
 * `ART.rainbow`'s array, which the render reads from the palette module).
 */
export const STORY_PROPS_STYLES: Readonly<Record<string, PartStyle>> = {
  // --- Nimbus, and the cloud that is not Nimbus ---------------------------------
  'storm-cloud-face': { colour: PALETTE.stoneGreyMid, outline: 0.016 },
  'storm-cloud-puffs': { colour: PALETTE.stoneGreyMid, outline: 0.016 },
  'fluffy-cloud': { colour: ART.wingWhite, outline: 0.016 },

  // --- the Rail Race ------------------------------------------------------------
  ...Object.fromEntries(ART.rainbow.map((colour, index) => [`rainbow-arch-band${index + 1}`, { colour, outline: 0.02 }])),
  'queue-posts-posts': { colour: PALETTE.liftFrame, outline: 0.012 },
  'queue-posts-rope': { colour: ART.jumperRed, outline: 0.01 },
  'rubber-duck-body': { colour: PALETTE.flowerYellow, outline: 0.012 },
  'rubber-duck-head': { colour: PALETTE.flowerYellow, outline: 0.012 },
  'rubber-duck-beak': { colour: ART.chickenBeak, outline: 0.008 },

  // --- Detective Biscuit's park ---------------------------------------------------
  'park-bench-seat': { colour: PALETTE.woodLight, outline: 0.016 },
  'park-bench-legs': { colour: PALETTE.woodDark, outline: 0.014 },
  'magnifying-glass-frame': { colour: PALETTE.liftFrame, outline: 0.01 },
  'magnifying-glass-lens': { colour: PALETTE.glassTint },
  'pancake-footprint': { colour: PALETTE.pathSandDark },
  'giant-footprint': { colour: PALETTE.pathSandDark },
  'spoon': { colour: PALETTE.stoneGreyLight, outline: 0.008 },
  'flat-stone': { colour: PALETTE.stoneGreyLight, outline: 0.012 },
  'stick': { colour: PALETTE.bark, outline: 0.01 },

  // --- books --------------------------------------------------------------------
  'open-book-cover': { colour: PALETTE.markerSky, outline: 0.012 },
  'open-book-pages': { colour: PALETTE.signBoard },
  'loose-page': { colour: PALETTE.signBoard, outline: 0.006 },
  'closed-book-cover': { colour: PALETTE.markerPink, outline: 0.012 },
  'closed-book-pages': { colour: PALETTE.signBoard },

  // --- the flowerbed --------------------------------------------------------------
  'flower-stem': { colour: PALETTE.leafMid, outline: 0.01 },
  'flower-petals': { colour: PALETTE.blossomPink, outline: 0.01 },
  'flower-centre': { colour: PALETTE.flowerYellow, outline: 0.008 },
  'petal': { colour: PALETTE.flowerYellow, outline: 0.006 },

  // --- the Grand Fountain Picnic -----------------------------------------------------
  'picnic-blanket-cloth': { colour: ART.jumperRed, outline: 0.012 },
  'picnic-blanket-checks': { colour: ART.cream },
  'sandwich-bread': { colour: ART.cream, outline: 0.01 },
  'sandwich-filling': { colour: PALETTE.leafLight },
  'sandwich-tower-bread': { colour: ART.cream, outline: 0.01 },
  'sandwich-tower-filling': { colour: PALETTE.leafLight },
  'sandwich-heap-bread': { colour: ART.cream, outline: 0.01 },
  'sandwich-heap-filling': { colour: PALETTE.leafLight },
  'jam-tart-pastry': { colour: ART.biscuitFur, outline: 0.01 },
  'jam-tart-jam': { colour: ART.jumperRedDark },
  'cake-sponge': { colour: ART.creamDark, outline: 0.014 },
  'cake-icing': { colour: PALETTE.blossomPink, outline: 0.012 },
  'cake-cherry': { colour: ART.jumperRed, outline: 0.008 },

  // --- the storm --------------------------------------------------------------------
  'puddle': { colour: PALETTE.waterTop },
  'window-frame': { colour: PALETTE.wood, outline: 0.014 },
  'umbrella-inside-out-canopy': { colour: ART.jumperRed, outline: 0.014 },
  'umbrella-inside-out-handle': { colour: PALETTE.woodDark, outline: 0.01 },
  'battlement': { colour: PALETTE.buildingWall, outline: 0.02 },

  // --- Catch That Chicken! ------------------------------------------------------------
  'story-wheel-rim': { colour: PALETTE.markerPink, outline: 0.016 },
  'story-wheel-spokes': { colour: PALETTE.liftFrame, outline: 0.012 },
  'story-wheel-cars': { colour: PALETTE.markerSky, outline: 0.014 },
  'story-wheel-legs': { colour: PALETTE.buildingTrimDeep, outline: 0.014 },
  'story-wheel-bracket': { colour: PALETTE.liftFrame, outline: 0.008 },
  'story-wheel-lights': { colour: PALETTE.flowerYellow, glow: true },
  'feather': { colour: ART.chickenWhite, outline: 0.008 },
  'twig-nest-bowl': { colour: PALETTE.barkDark, outline: 0.016 },
  'twig-nest-twigs': { colour: PALETTE.bark, outline: 0.01 },
  'biscuit-treat-body': { colour: ART.biscuitFur, outline: 0.012 },
  'biscuit-treat-chips': { colour: ART.biscuitNose },
};

/** One material per paint, shared by every part painted with it. */
const materials = new Map<string, Material>();
function paint(style: PartStyle): Material {
  const key = `${style.colour}:${style.glow ? 'glow' : 'toon'}`;
  let material = materials.get(key);
  if (!material) {
    const options: ToonOptions = style.glow ? { emissive: style.colour, emissiveIntensity: 0.9 } : {};
    material = markShared(toonMaterial(style.colour, options));
    materials.set(key, material);
  }
  return material;
}

/** A node's row in {@link STORY_PROPS_STYLES}, or a throw naming it. */
function styleOf(name: string): PartStyle {
  const style = STORY_PROPS_STYLES[name];
  if (!style) throw new Error(`storyProps: no style for node '${name}'`);
  return style;
}

/** A mesh, painted, shadowed and outlined by its style. */
function dress(mesh: Mesh, style: PartStyle): Mesh {
  if (style.glow) decal(mesh);
  else solid(mesh);
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/**
 * **One node of the kit, dressed** — its paint (or `colour`, a page's own),
 * its ink outline, its shadow flags and its node transform. `material`
 * replaces the shared paint for a part that has to own its material (a face).
 */
export function storyPropMesh(name: string, colour?: number, material?: Material): Mesh {
  const part = storyPropPart(name);
  const style = colour === undefined ? styleOf(name) : { ...styleOf(name), colour };
  const mesh = new Mesh(part.geometry, material ?? paint(style));
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  return dress(mesh, style);
}

/** A named root holding the dressed nodes, with its measured height. */
function assemble(asset: string, names: readonly string[], colours: Readonly<Record<string, number>> = {}): AssetHandle {
  const root = new Group();
  root.name = `story.${asset}`;
  for (const name of names) root.add(storyPropMesh(name, colours[name]));
  return { root, height: visibleBounds(root).top };
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/**
 * The art's eye row and eye gap, in the painter's own canvas fractions. The
 * painter draws its pair level and centred, so the art's two eyes must be too;
 * a head whose eyes were not would get its face painted somewhere else, so it
 * throws instead.
 */
function eyesOf(node: keyof typeof STORY_FACES): { readonly eyeY: number; readonly eyeGap: number } {
  const figures: StoryFaceFigures = STORY_FACES[node];
  const [uL, vL, uR, vR] = figures.face_eyes_uv;
  if (Math.abs(vL - vR) > 1e-3 || Math.abs(uL + uR - 1) > 1e-3) {
    throw new Error(`storyProps: ${node}'s eyes (${uL}, ${vL}) / (${uR}, ${vR}) are not level and centred on its canvas`);
  }
  // The canvas is square and the window all but square (the build makes a
  // faced node round), so a fraction of the window's width is a fraction of
  // the canvas; the residue is corrected here so a round eye paints round.
  const [width, height] = figures.face_window_m;
  return { eyeY: vL, eyeGap: (Math.abs(uL - uR) * width) / height };
}

// ---------------------------------------------------------------------------
// Nimbus, the storm cloud
// ---------------------------------------------------------------------------

export interface StoryCloudHandle extends CreatureHandle {
  /** The face puff's own material: `map` is the face showing. */
  readonly headMaterial: MeshToonMaterial;
}

export interface StoryCloudOptions {
  /** Grey while cross and hungry (the default), cloud white once fed: the page's choice. */
  readonly colour?: number;
}

const CLOUD_EYES = eyesOf('storm-cloud-face');
const CLOUD_FACE: FacePaintOptions = {
  size: 512,
  eyeY: CLOUD_EYES.eyeY,
  eyeGap: CLOUD_EYES.eyeGap,
  eyeW: 0.105,
  eyeH: 0.135,
  mouth: 'smile',
  mouthW: 0.085,
  mouthDrop: 0.2,
  blush: ART.blush,
  blushStyle: 'soft',
  blushR: 0.07,
};

/**
 * **Nimbus** — the storm cloud of *Biscuit and the Storm*: one big round face
 * puff in front of a ring of squashed puffs. The house expression set is
 * hers: `frown` scowling over the picnic, `sad` and hungry, `surprised` for
 * the burp, `happy` once fed. 1.2 m tall at its base; a page lifts it into
 * the sky with `at`. It never walks: `limbs` is null.
 */
export function createStoryCloud(options: StoryCloudOptions = {}): StoryCloudHandle {
  const colour = options.colour ?? styleOf('storm-cloud-face').colour;
  const root = new Group();
  root.name = 'story.storm-cloud';
  const body = new Group();
  body.name = 'story.storm-cloud.body';
  root.add(body);
  body.add(storyPropMesh('storm-cloud-puffs', colour));
  const head = new Group();
  head.name = 'story.storm-cloud.head';
  body.add(head);
  const face = createBakedFace({ ...CLOUD_FACE, fill: colour });
  const faceMesh = storyPropMesh('storm-cloud-face', colour, face.material);
  face.applyTo(faceMesh, { uvsAuthored: true });
  head.add(faceMesh);
  face.setExpression('frown');
  return {
    root,
    body,
    head,
    limbs: null,
    height: visibleBounds(root).top,
    headMaterial: face.material,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: () => {},
  };
}

/** The cloud Chicken-looter hides in: long, low, faceless — not Nimbus. */
export function createFluffyCloud(): AssetHandle {
  return assemble('fluffy-cloud', ['fluffy-cloud']);
}

// ---------------------------------------------------------------------------
// The Rail Race
// ---------------------------------------------------------------------------

/**
 * **The finish rainbow**, as a prop: one node per band, coloured from
 * `ART.rainbow` inner band first exactly as `railRace/track.ts` colours the
 * ride's. The build read the palette's length for its band count, so a
 * mismatch here is a stale file, and it throws.
 */
export function createRainbowArch(): AssetHandle {
  const bands = storyPropPartNames().filter((name) => name.startsWith('rainbow-arch-band')).sort();
  if (bands.length !== ART.rainbow.length) {
    throw new Error(`storyProps: storyProps.glb has ${bands.length} rainbow bands and ART.rainbow has ${ART.rainbow.length} colours`);
  }
  const colours = Object.fromEntries(bands.map((name, index) => [name, ART.rainbow[index] as number]));
  return assemble('rainbow-arch', bands, colours);
}

/** Two gold posts with a red rope swagged between them: the Rail Race queue. */
export function createQueuePosts(): AssetHandle {
  return assemble('queue-posts', ['queue-posts-posts', 'queue-posts-rope']);
}

const DUCK_EYES = eyesOf('rubber-duck-head');

/**
 * **The yellow rubber duck** Sir Hopsalot says sorry with — a toy's toy, so
 * its happy face is one canvas: it never blinks. Its beak is its mouth.
 */
export function createRubberDuck(): AssetHandle {
  const root = new Group();
  root.name = 'story.rubber-duck';
  root.add(storyPropMesh('rubber-duck-body'));
  root.add(storyPropMesh('rubber-duck-beak'));
  const map = paintFaceOnFill(styleOf('rubber-duck-head').colour, {
    size: 256,
    eyeY: DUCK_EYES.eyeY,
    eyeGap: DUCK_EYES.eyeGap,
    eyeW: 0.1,
    eyeH: 0.13,
    eyeStyle: 'open',
    mouth: 'none',
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.06,
  });
  root.add(storyPropMesh('rubber-duck-head', undefined, toonMaterial(0xffffff, { map })));
  return { root, height: visibleBounds(root).top };
}

// ---------------------------------------------------------------------------
// Detective Biscuit's park
// ---------------------------------------------------------------------------

/** A plank seat on two end boards, open underneath (Biscuit hides there). Seat at `KID_HIP_HEIGHT`. */
export function createParkBench(): AssetHandle {
  return assemble('park-bench', ['park-bench-seat', 'park-bench-legs']);
}

/** Standing on its handle like a lollipop; a page turns it up to an eye. */
export function createMagnifyingGlass(): AssetHandle {
  return assemble('magnifying-glass', ['magnifying-glass-frame', 'magnifying-glass-lens']);
}

/** The mini's foot: flat and wide like a pancake, three toes forward. A page scatters eight. */
export function createPancakeFootprint(): AssetHandle {
  return assemble('pancake-footprint', ['pancake-footprint']);
}

/** Grandpa Tock's: a dinner-plate print with four stubby toes. */
export function createGiantFootprint(): AssetHandle {
  return assemble('giant-footprint', ['giant-footprint']);
}

export function createSpoon(): AssetHandle {
  return assemble('spoon', ['spoon']);
}

export function createFlatStone(): AssetHandle {
  return assemble('flat-stone', ['flat-stone']);
}

/** A stake planted in the grass — the balloon's string is tied to it. */
export function createStick(): AssetHandle {
  return assemble('stick', ['stick']);
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/** Lying open, pages curving up from the gutter. `colour` is the cover's. */
export function createOpenBook(colour?: number): AssetHandle {
  return assemble('open-book', ['open-book-cover', 'open-book-pages'], colour === undefined ? {} : { 'open-book-cover': colour });
}

/** One page fluttering free, curled along its width. */
export function createLoosePage(): AssetHandle {
  return assemble('loose-page', ['loose-page']);
}

/**
 * **The closed storybook** lying flat, spine to the front — the one picture
 * book primitive the chapter books reuse (Mrs Crumpet's pile, the dropped
 * book, the cloud book). `createStoryBook` (readerAssets.ts) is to delegate
 * here so there is one closed book, and its size is this glb's.
 */
export function createStoryClosedBook(colour?: number): AssetHandle {
  return assemble('closed-book', ['closed-book-cover', 'closed-book-pages'], colour === undefined ? {} : { 'closed-book-cover': colour });
}

// ---------------------------------------------------------------------------
// The flowerbed
// ---------------------------------------------------------------------------

export interface StoryFlowerOptions {
  /** The petals' colour; the centre stays yellow. */
  readonly colour?: number;
  /** Nibbled down to a bare stalk — every yellow flower on The Giant Footprints' page 3. */
  readonly nibbled?: boolean;
}

/** A storybook flower: a fat stem with two leaves, six plump petals round a yellow centre, tilted up to the reader. */
export function createStoryFlower(options: StoryFlowerOptions = {}): AssetHandle {
  const names = options.nibbled ? ['flower-stem'] : ['flower-stem', 'flower-petals', 'flower-centre'];
  return assemble('flower', names, options.colour === undefined ? {} : { 'flower-petals': options.colour });
}

/** One petal — the yellow one on Grandpa Tock's nose. */
export function createPetal(colour?: number): AssetHandle {
  return assemble('petal', ['petal'], colour === undefined ? {} : { petal: colour });
}

// ---------------------------------------------------------------------------
// The Grand Fountain Picnic
// ---------------------------------------------------------------------------

/** A red gingham blanket, its checks a second node in cream. */
export function createPicnicBlanket(): AssetHandle {
  return assemble('picnic-blanket', ['picnic-blanket-cloth', 'picnic-blanket-checks']);
}

/** One sandwich wedge, the filling peeping past the bread. */
export function createSandwich(): AssetHandle {
  return assemble('sandwich', ['sandwich-bread', 'sandwich-filling']);
}

/** Sixteen sandwiches in a teetering tower taller than Biscuit. */
export function createSandwichTower(): AssetHandle {
  return assemble('sandwich-tower', ['sandwich-tower-bread', 'sandwich-tower-filling']);
}

/** Nimbus's forty-one sandwiches, as a mountain. */
export function createSandwichHeap(): AssetHandle {
  return assemble('sandwich-heap', ['sandwich-heap-bread', 'sandwich-heap-filling']);
}

export function createJamTart(): AssetHandle {
  return assemble('jam-tart', ['jam-tart-pastry', 'jam-tart-jam']);
}

/** Two tiers, pink icing dripping off each, a cherry on top. */
export function createCake(): AssetHandle {
  return assemble('cake', ['cake-sponge', 'cake-icing', 'cake-cherry']);
}

// ---------------------------------------------------------------------------
// The storm
// ---------------------------------------------------------------------------

export function createPuddle(): AssetHandle {
  return assemble('puddle', ['puddle']);
}

/** A rounded frame with a cross of glazing bars, upright — the storm is seen through it. */
export function createWindowFrame(): AssetHandle {
  return assemble('window-frame', ['window-frame']);
}

/** Biscuit's umbrella, blown inside out: a scalloped bowl pointing up on a stick. */
export function createInsideOutUmbrella(): AssetHandle {
  return assemble('umbrella-inside-out', ['umbrella-inside-out-canopy', 'umbrella-inside-out-handle']);
}

/** A run of the castle roof's wall, three merlons at the castle's own `CASTLE_MERLON_HEIGHT`. */
export function createBattlement(): AssetHandle {
  return assemble('battlement', ['battlement']);
}

// ---------------------------------------------------------------------------
// Catch That Chicken!
// ---------------------------------------------------------------------------

export interface StoryWheelHandle extends AssetHandle {
  /** The ring of lights round the rim: hidden until the star is back (page 1), blazing on page 9. */
  readonly lights: Mesh;
  /** The middle of the empty star bracket on the hub's face, in the root's frame — where the `star` goes on page 9. */
  readonly bracketCentre: Vector3;
}

export interface StoryWheelOptions {
  /** Whether the lights are on. Default off: the star is missing. */
  readonly lit?: boolean;
}

/** The middle of a node's vertices, in the asset's frame. */
function centreOf(name: string): Vector3 {
  const part = storyPropPart(name);
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i).multiply(part.scale).applyQuaternion(part.quaternion).add(part.position);
    min.min(p);
    max.max(p);
  }
  return min.add(max).multiplyScalar(0.5);
}

/**
 * **The Space Ferris Wheel as a toy** — not the ride (`createFerrisWheelProp`
 * is a world ride that wants an anchor and a collision world): a rim, eight
 * spokes on a fat hub, eight cars, an A-frame each side, an **empty** star
 * bracket on the hub's face, and a ring of lights.
 */
export function createStoryWheel(options: StoryWheelOptions = {}): StoryWheelHandle {
  const root = new Group();
  root.name = 'story.story-wheel';
  for (const name of ['story-wheel-rim', 'story-wheel-spokes', 'story-wheel-cars', 'story-wheel-legs', 'story-wheel-bracket']) {
    root.add(storyPropMesh(name));
  }
  const lights = storyPropMesh('story-wheel-lights');
  lights.visible = options.lit === true;
  root.add(lights);
  return { root, height: visibleBounds(root).top, lights, bracketCentre: centreOf('story-wheel-bracket') };
}

/** A feather lying on the grass. White by default; Chicken-looter's red one is `ART.chickenComb`. */
export function createFeather(colour?: number): AssetHandle {
  return assemble('feather', ['feather'], colour === undefined ? {} : { feather: colour });
}

/** Chicken-looter's nest on the hotel roof: a fat woven bowl, ten twigs poking out. */
export function createTwigNest(): AssetHandle {
  return assemble('twig-nest', ['twig-nest-bowl', 'twig-nest-twigs']);
}

/** A biscuit to eat, not Biscuit the bear: a fat round with six chocolate chips. */
export function createBiscuitTreat(): AssetHandle {
  return assemble('biscuit-treat', ['biscuit-treat-body', 'biscuit-treat-chips']);
}
