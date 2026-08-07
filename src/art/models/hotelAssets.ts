import { Group, Mesh } from 'three';
import { HOTEL_GLB_BASE64 } from '../assets/hotelGlb';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import {
  addOutline,
  decal,
  disposeTree,
  markShared,
  solid,
  toonMaterial,
  type ToonOptions,
} from '../style/materials';
import { visibleBounds } from '../style/measure';
import type { AssetHandle } from '../style/asset';

/**
 * **The Land Hotel** — a crystal tower and the five things that furnish it.
 *
 * The **fourth** asset through the `.glb` pipeline (`ART-AGENT-NOTES.md` §6a,
 * after the kid, the cart and the duck bar), and the first authored by a
 * *script* rather than by hand: `art/blend/hotel_build.py` writes
 * `art/blend/hotel.blend`, `hotel_export.py` writes the `.glb`, and
 * `npm run blend:hotel` runs the pair and packs the result. The `.blend` is a
 * generated artefact — edit the Python, never the file.
 *
 * ## The split, and why the glb carries no colour
 *
 * The asset owns **shape** and nothing else: geometry, UVs on the two nodes
 * code paints words onto, and one named node per distinctly-coloured part.
 * Everything below — palette colours, the emissive lift that makes the window
 * rows read as lit at dusk, the ink outlines, the shadow flags — stays here,
 * exactly as it does for the kid's skin tone and the cart's lane colour. That
 * is what lets `src/art/style/glb.ts` stay the small, synchronous, no-materials
 * reader it is.
 *
 * ## Six assets, one file
 *
 * They share a `.glb` because they share a build script and are used together,
 * not because they are one object. Each factory returns its own `AssetHandle`
 * with its own origin at its own base, per ART_DIRECTION §7 — so a bed and a
 * tower both sit correctly on `root.position.y = groundHeight`, and inside the
 * file they all overlap at the origin, which is expected and harmless.
 *
 * ## Sparkle without glass
 *
 * The prisms are ordinary `toonMaterial`, not `softMaterial`/`glassMaterial`.
 * Two reasons: §2's material table puts *built things* on the toon ramp and
 * only real glass on the standard material, and `world/building/parts.ts`'s
 * `glassMaterial` is on the far side of the `style/bridge.ts` import boundary.
 * What sells "crystal" instead is pale ice-and-blush tones on faceted flat
 * shading, plus the four genuinely self-lit parts (windows, doorway glow,
 * star, disco ball). A translucent tower would also have hidden the one thing
 * the building must communicate from across the park: that it has fifty floors
 * of lit rooms.
 */

const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(HOTEL_GLB_BASE64));

for (const part of parts.values()) markShared(part.geometry);

/** How a part is dressed. Colour and shading only — never shape. */
interface PartStyle {
  /** From `PALETTE` or `ART`. Never an inline hex (ART_DIRECTION §5). */
  readonly colour: number;
  /**
   * Inverted-hull outline thickness in metres, omitted for parts that do not
   * define a silhouette. Props take 0.016–0.022 (§4); the breakfast bowls take
   * 0.012, the small-object figure, because 0.016 on a 25 cm bowl is a line
   * thicker than the rim it is drawing.
   */
  readonly outline?: number;
  /** Set for flat appliqué and self-lit parts: casts no shadow, catches none. */
  readonly flat?: true;
  /** Extra material options — the emissive lift, essentially. */
  readonly material?: ToonOptions;
}

/**
 * Every node in the file, dressed.
 *
 * One table rather than a line of code per part, so that "which colour is the
 * second spire" is answerable by reading rather than by tracing a builder.
 * `art/blend/hotel_render.py` mirrors these for its review renders and says so;
 * this file is the owner.
 *
 * The tower is **three** pastel tones, not four: ice (`glassTint`/`bubbleSkin`
 * are within a few points of each other and read as one), lilac and blush. A
 * fourth would have stopped the cluster reading as one mineral.
 */
const STYLES: Record<string, PartStyle> = {
  // --- the tower ------------------------------------------------------------
  'tower-main': { colour: PALETTE.glassTint, outline: 0.022 },
  'tower-spire-a': { colour: PALETTE.flowerViolet, outline: 0.022 },
  'tower-spire-b': { colour: PALETTE.bubbleSkin, outline: 0.022 },
  'tower-spire-c': { colour: PALETTE.stonePink, outline: 0.022 },
  // No outline and no shadow on 640-odd flat quads sitting 3 cm off the wall:
  // an inverted hull round each would draw a box round every window, and
  // shadow-casting geometry that close to its own surface is what acne is.
  'tower-windows': {
    colour: PALETTE.buildingWindowWarm,
    flat: true,
    material: { emissive: PALETTE.buildingWindowWarm, emissiveIntensity: 0.55 },
  },
  'tower-door-jamb': { colour: PALETTE.buildingTrim, outline: 0.022 },
  'tower-door-glow': {
    colour: PALETTE.buildingWindowWarm,
    flat: true,
    material: { emissive: PALETTE.buildingWindowWarm, emissiveIntensity: 0.85 },
  },
  'tower-porch': { colour: PALETTE.buildingTrim, outline: 0.022 },
  'tower-signboard': { colour: PALETTE.signBoard, outline: 0.018 },
  'tower-crystals': { colour: PALETTE.markerLilac, outline: 0.02 },

  // --- the bed --------------------------------------------------------------
  'bed-frame': { colour: PALETTE.buildingTrim, outline: 0.018 },
  'bed-mattress': { colour: ART.cream, outline: 0.016 },
  'bed-pillow': { colour: PALETTE.blossomWhite, outline: 0.016 },
  'bed-blanket': { colour: PALETTE.markerMint, outline: 0.016 },

  // --- the disco ball -------------------------------------------------------
  'disco-ball': {
    colour: PALETTE.bubbleSkin,
    outline: 0.016,
    material: { emissive: PALETTE.glassTint, emissiveIntensity: 0.25 },
  },
  'disco-rod': { colour: PALETTE.liftFrame },

  // --- breakfast ------------------------------------------------------------
  'table-top': { colour: PALETTE.woodLight, outline: 0.018 },
  'table-leg': { colour: PALETTE.wood, outline: 0.018 },
  chair: { colour: PALETTE.markerSky, outline: 0.018 },
  'food-cheerios-bowl': { colour: PALETTE.blossomWhite, outline: 0.012 },
  'food-shreddies-bowl': { colour: PALETTE.blossomWhite, outline: 0.012 },
  'food-yoghurt-bowl': { colour: PALETTE.blossomWhite, outline: 0.012 },
  'food-cheerios': { colour: PALETTE.markerPink },
  'food-shreddies': { colour: ART.biscuitFur },
  'food-yoghurt': { colour: ART.cream },
  'food-yoghurt-honey': { colour: PALETTE.liftFrame },

  // --- reception ------------------------------------------------------------
  'desk-counter': { colour: PALETTE.glassTint, outline: 0.02 },
  'desk-front': { colour: PALETTE.flowerViolet, outline: 0.02 },
  'desk-key-board': { colour: PALETTE.signBoard, outline: 0.016 },
  'desk-keys': { colour: PALETTE.liftFrame },

  // --- the "yours" door -----------------------------------------------------
  'door-frame': { colour: PALETTE.glassTint, outline: 0.02 },
  'door-leaf': { colour: PALETTE.markerPink, outline: 0.018 },
  'door-knob': { colour: PALETTE.liftFrame },
  'door-plaque': { colour: PALETTE.signBoard, outline: 0.014 },
  'door-star': {
    colour: PALETTE.flowerYellow,
    outline: 0.018,
    material: { emissive: PALETTE.flowerYellow, emissiveIntensity: 0.3 },
  },
};

/** One authored part, by name. Throws rather than returning a hole. */
function hotelPart(name: string): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `hotelAssets: the asset has no part named '${name}'. Either a factory here has grown ` +
        `and \`npm run blend:hotel\` has not been re-run, or a node lost its name on the way ` +
        `through Blender.`,
    );
  }
  return part;
}

/** Every part name the asset actually contains — for checks, not for the game. */
export function hotelAssetPartNames(): readonly string[] {
  return [...parts.keys()];
}

/**
 * One dressed mesh.
 *
 * The transform comes off the asset alongside the shape, the way
 * `cartAssetMesh` does it — a part's shape and where that shape sits are one
 * decision made in one place. Today `hotel_build.py` bakes every placement into
 * vertices and leaves the nodes at identity, so these three lines copy an
 * identity transform; they are here so that stops being true safely.
 */
function hotelMesh(name: string): Mesh {
  const style = STYLES[name];
  if (!style) throw new Error(`hotelAssets: no style for part '${name}'.`);
  const part = hotelPart(name);
  const mesh = new Mesh(part.geometry, toonMaterial(style.colour, style.material ?? {}));
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  if (style.flat) decal(mesh);
  else solid(mesh);
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/** A named group of dressed parts, keyed so a caller can pull one out. */
function assemble(key: string, names: readonly string[]): { root: Group; meshes: Map<string, Mesh> } {
  const root = new Group();
  root.name = key;
  const meshes = new Map<string, Mesh>();
  for (const name of names) {
    const mesh = hotelMesh(name);
    meshes.set(name, mesh);
    root.add(mesh);
  }
  return { root, meshes };
}

/** Non-null lookup, so a factory's typed fields cannot be `undefined`. */
function required(meshes: Map<string, Mesh>, name: string): Mesh {
  const mesh = meshes.get(name);
  if (!mesh) throw new Error(`hotelAssets: '${name}' was not assembled into this group.`);
  return mesh;
}

/**
 * The top of the built group, measured rather than written down.
 *
 * `check:assets`'s founding lesson: a height an author types is a claim and a
 * height read off the object is a fact, and every one of the three bugs that
 * script exists to catch came from the claim.
 */
function measuredHeight(root: Group): number {
  return visibleBounds(root).top;
}

export interface HotelTowerHandle extends AssetHandle {
  /** The blank slab above the door. Code paints the hotel's name onto its UVs. */
  readonly signboard: Mesh;
  /** Every lit window in one mesh — retune its emissive for day and night. */
  readonly windows: Mesh;
  /** The warm panel at the back of the doorway recess. */
  readonly doorGlow: Mesh;
}

const TOWER_PARTS = [
  'tower-main',
  'tower-spire-a',
  'tower-spire-b',
  'tower-spire-c',
  'tower-windows',
  'tower-door-jamb',
  'tower-door-glow',
  'tower-porch',
  'tower-signboard',
  'tower-crystals',
] as const;

/**
 * The hotel's facade: four faceted crystal prisms, 28 m to the tallest point,
 * inside a 14.7 m footprint (the plot allows 16 m).
 *
 * The doorway, its porch shard and the signboard are all on **+Z**, so
 * `root.rotation.y` alone yaws the entrance toward wherever the park's solver
 * puts the doormat.
 *
 * **The measured base sits ~0.30 m below the origin, and that is deliberate.**
 * Three of the four prisms lean, and a prism leaned about its own foot dips one
 * edge of that foot under the ground — which is exactly right for a crystal
 * that grew out of the earth rather than one balanced on it. The buried part is
 * under the terrain and never drawn. `height` is still measured to the true
 * top, so a name label lands where it should.
 */
export function createHotelTower(): HotelTowerHandle {
  const { root, meshes } = assemble('hotel.tower', TOWER_PARTS);
  return {
    root,
    height: measuredHeight(root),
    signboard: required(meshes, 'tower-signboard'),
    windows: required(meshes, 'tower-windows'),
    doorGlow: required(meshes, 'tower-door-glow'),
    dispose: () => disposeTree(root),
  };
}

/** The mattress top, in metres above the bed's origin. */
export const BED_MATTRESS_TOP = 0.55;

export interface HotelBedHandle extends AssetHandle {
  /**
   * Height of the flat standing surface, in metres — {@link BED_MATTRESS_TOP}.
   *
   * On the handle as well as as a constant because the suite's beds are
   * jump-between platforms: the code that hangs a `MovingPlatform` at the top
   * of a bed should ask the bed how high it is, not carry its own copy of the
   * number (CLAUDE.md, "two definitions of one thing, kept in step by hand").
   */
  readonly mattressTop: number;
}

/**
 * A chunky hotel bed, 1.4 × 2.0 m, pillow at the −Z end.
 *
 * The mattress top is a genuinely **flat** 1.28 × 1.88 m plateau at exactly
 * 0.55 m: children stand and bounce on it, and a rounded box's domed top would
 * slide them off a platform the game says is level. `hotel_build.py`'s
 * `flat_top_box` exists for this one requirement.
 */
export function createHotelBed(): HotelBedHandle {
  const { root } = assemble('hotel.bed', ['bed-frame', 'bed-mattress', 'bed-pillow', 'bed-blanket']);
  return {
    root,
    height: measuredHeight(root),
    mattressTop: BED_MATTRESS_TOP,
    dispose: () => disposeTree(root),
  };
}

/**
 * A faceted mirror ball on a short rod. 0.9 m across, 1.24 m from hook to base.
 *
 * **Origin at the top of the rod**, not at a base — the balloon exception in
 * ART_DIRECTION §7, for the same reason: this thing hangs, so its origin is
 * its hang point and `ceilingAnchor.add(ball.root)` needs no offset maths.
 * Every vertex is therefore *below* y = 0, and `height` reports the drop from
 * the hook to the bottom of the ball rather than a height above ground.
 *
 * Eighty flat facets, from an icosphere subdivided twice. Under the toon ramp
 * each facet takes its own band, which is what reads as mirror tiles; a smooth
 * sphere with a shiny material would read as a balloon, and there is no
 * specular in this park to do it with anyway (§2: metalness is never above 0).
 */
export function createDiscoBall(): AssetHandle {
  const { root } = assemble('hotel.discoBall', ['disco-rod', 'disco-ball']);
  const { top, bottom } = visibleBounds(root);
  return { root, height: top - bottom, dispose: () => disposeTree(root) };
}

/** A round breakfast table, 1.2 m across, flat top at 0.74 m. */
export function createBreakfastTable(): AssetHandle {
  const { root } = assemble('hotel.breakfastTable', ['table-leg', 'table-top']);
  return { root, height: measuredHeight(root), dispose: () => disposeTree(root) };
}

/**
 * One chunky chair, seat at 0.42 m, sitter facing +Z.
 *
 * Authored once and cloned per place setting by the caller — four chairs round
 * a table are four `createBreakfastChair()` calls, each yawed by `root.rotation.y`.
 * The geometry behind them is shared, so the copies cost a draw call, not a
 * tessellation.
 */
export function createBreakfastChair(): AssetHandle {
  const { root } = assemble('hotel.breakfastChair', ['chair']);
  return { root, height: measuredHeight(root), dispose: () => disposeTree(root) };
}

/** The three things on the breakfast menu. Eleri picked the first, Ethan the second. */
export type BreakfastKind = 'cheerios' | 'shreddies' | 'yoghurt';

const BREAKFAST_PARTS: Record<BreakfastKind, readonly string[]> = {
  cheerios: ['food-cheerios-bowl', 'food-cheerios'],
  shreddies: ['food-shreddies-bowl', 'food-shreddies'],
  yoghurt: ['food-yoghurt-bowl', 'food-yoghurt', 'food-yoghurt-honey'],
};

/**
 * One bowl of breakfast, 0.25 m across, origin at the bottom of the bowl.
 *
 * Origin at the base like everything else, so the caller sets it on the table
 * with `bowl.root.position.set(x, TABLE_TOP, z)` and no fudge factor: hearts
 * for the cheerios, little rounded squares for the shreddies, a honey spiral
 * for the yoghurt.
 */
export function createBreakfastBowl(kind: BreakfastKind): AssetHandle {
  const { root } = assemble(`hotel.breakfast.${kind}`, BREAKFAST_PARTS[kind]);
  return { root, height: measuredHeight(root), dispose: () => disposeTree(root) };
}

/** The reception counter's flat top, in metres — the same height as the shop kiosks'. */
export const RECEPTION_COUNTER_TOP = 1.02;

export interface ReceptionDeskHandle extends AssetHandle {
  /** Height of the flat counter surface — {@link RECEPTION_COUNTER_TOP}. */
  readonly counterTop: number;
}

/**
 * The reception desk: a gently bowed, faceted crystal counter 2.67 m wide with
 * a key board standing behind it.
 *
 * The counter bows **toward** the customer, who stands at +Z; the receptionist
 * stands in the hollow at −Z with the key board at their back. Its top is flat
 * at 1.02 m — the same figure the shop kiosks use, so a child who has learnt to
 * reach one counter can reach them all.
 */
export function createReceptionDesk(): ReceptionDeskHandle {
  const { root } = assemble('hotel.receptionDesk', [
    'desk-front',
    'desk-counter',
    'desk-key-board',
    'desk-keys',
  ]);
  return {
    root,
    height: measuredHeight(root),
    counterTop: RECEPTION_COUNTER_TOP,
    dispose: () => disposeTree(root),
  };
}

export interface YoursDoorHandle extends AssetHandle {
  /** The rounded panel at child height. Code paints "yours" onto its UVs. */
  readonly plaque: Mesh;
  /** The chunky star over the arch — brighten its emissive when the suite unlocks. */
  readonly star: Mesh;
}

/**
 * The suite door: an arched 1.1 × 2.3 m leaf in its frame, a blank plaque, and
 * a five-point star above the arch. 3.0 m to the star's tip.
 *
 * Origin at the floor, centred on the frame; the leaf faces +Z.
 *
 * **The plaque is left blank on purpose, and it is a real UV rather than a
 * decal mesh.** ART_DIRECTION §7 and CLAUDE.md are both emphatic after the
 * hood-face fortnight: a painted word goes into the surface's own UV map, not
 * onto a second mesh floated in front of it that has to independently agree
 * with the first's position and winding. `door-plaque` carries a UV map that
 * spans its own front panel, authored off the same vertices as the shape, so
 * the caller only has to hand `plaque.material.map` a canvas.
 */
export function createYoursDoor(): YoursDoorHandle {
  const { root, meshes } = assemble('hotel.yoursDoor', [
    'door-frame',
    'door-leaf',
    'door-knob',
    'door-plaque',
    'door-star',
  ]);
  return {
    root,
    height: measuredHeight(root),
    plaque: required(meshes, 'door-plaque'),
    star: required(meshes, 'door-star'),
    dispose: () => disposeTree(root),
  };
}
