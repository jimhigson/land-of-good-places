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
import { visibleBounds, visiblePoints } from '../style/measure';
import type { AssetHandle } from '../style/asset';

/**
 * **The Land Hotel** — a crystal tower and everything that furnishes it.
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
 * ## Sixteen factories, one file
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
 * Which way a flight turns **as you climb it** — never which side of a room it
 * is on. `'right'` is the flight that shipped on 7 August; `'left'` is its
 * mirror image. See {@link createGrandStaircase} for the full convention.
 */
export type StairHandedness = 'right' | 'left';

export const STAIR_HANDEDNESS: readonly StairHandedness[] = ['right', 'left'];

/** The five nodes a flight is made of, in `hotel_build.py`'s own order. */
const STAIR_PART_SUFFIXES = ['tread', 'stringer', 'rail', 'baluster', 'newel'] as const;

/**
 * The three flights the lobby's composition is made of, as they are named in
 * the `.glb`: two mirrored curves and the wide straight one they gather into.
 *
 * One list rather than three, so a flight cannot be added to the asset and
 * quietly go undressed — {@link stairStyles} walks it.
 */
const STAIR_FLIGHTS = ['right', 'left', 'straight'] as const;

/**
 * How a flight is dressed, by part suffix — **one table for both hands**.
 *
 * The treads take the lobby's *floor* colour and the strings its *trim*, which
 * is the same pairing the gallery they lead to already uses, so the stair reads
 * as part of that piece of architecture rather than as furniture parked against
 * it. One colour for all ten treads, deliberately: the old code-built stack
 * alternated floor and trim per tread, and alternating stripes are most of what
 * made ten boxes read as ten boxes.
 */
const STAIR_PART_STYLES: Record<(typeof STAIR_PART_SUFFIXES)[number], PartStyle> = {
  tread: { colour: PALETTE.glassTint, outline: 0.02 },
  stringer: { colour: PALETTE.markerLilac, outline: 0.022 },
  rail: { colour: PALETTE.liftFrame, outline: 0.016 },
  baluster: { colour: PALETTE.blossomWhite, outline: 0.014 },
  newel: { colour: PALETTE.flowerViolet, outline: 0.018 },
};

function stairStyles(): Record<string, PartStyle> {
  const out: Record<string, PartStyle> = {};
  for (const flight of STAIR_FLIGHTS) {
    for (const part of STAIR_PART_SUFFIXES) out[`stair-${flight}-${part}`] = STAIR_PART_STYLES[part];
  }
  return out;
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

  // --- the pet's four-poster bed --------------------------------------------
  'petbed-base': { colour: PALETTE.markerLilac, outline: 0.018 },
  'petbed-cushion': { colour: ART.cream, outline: 0.016 },
  'petbed-bolster': { colour: PALETTE.blossomPink, outline: 0.018 },
  'petbed-posts': { colour: PALETTE.woodLight, outline: 0.014 },
  'petbed-canopy': { colour: PALETTE.markerSky, outline: 0.016 },
  'petbed-pillow': { colour: PALETTE.blossomWhite, outline: 0.014 },
  'petbed-blanket': { colour: PALETTE.markerMint, outline: 0.014 },
  'petbed-toy': { colour: PALETTE.slideChute, outline: 0.014 },
  'petbed-toy-eye': { colour: PALETTE.eyeDark },
  'petbowl-bowl': { colour: PALETTE.markerSky, outline: 0.012 },
  'petbowl-food': { colour: ART.biscuitFur },

  // --- the lift -------------------------------------------------------------
  'lift-door-left': { colour: PALETTE.glassTint, outline: 0.02 },
  'lift-door-right': { colour: PALETTE.glassTint, outline: 0.02 },
  'lift-frame': { colour: PALETTE.flowerViolet, outline: 0.02 },
  'lift-frame-sill': { colour: PALETTE.liftFrame, outline: 0.014 },
  'lift-car': { colour: PALETTE.woodLight, outline: 0.02 },
  'lift-car-floor': { colour: PALETTE.wood, outline: 0.016 },
  'lift-car-rail': { colour: PALETTE.liftFrame },
  'lift-dial': { colour: PALETTE.liftFrame, outline: 0.016 },
  // No outline: the face is a disc *inside* a brass bezel, and an inverted
  // hull round it would push a dark ring straight out through the bezel it is
  // recessed into. §4 — silhouette parts only.
  'lift-dial-face': { colour: PALETTE.signBoard },
  'lift-dial-ticks': { colour: PALETTE.ink },
  'lift-dial-needle': { colour: PALETTE.flowerRed, outline: 0.008 },

  // --- the tower's sliding front doors --------------------------------------
  'entrance-door-left': { colour: PALETTE.glassTint, outline: 0.022 },
  'entrance-door-right': { colour: PALETTE.glassTint, outline: 0.022 },

  // --- the suite's television, and the Game Boy on the table ----------------
  'tv-body': { colour: PALETTE.wood, outline: 0.02 },
  'tv-screen': {
    colour: PALETTE.buildingWindow,
    flat: true,
    material: { emissive: PALETTE.buildingWindow, emissiveIntensity: 0.45 },
  },
  'tv-knobs': { colour: PALETTE.liftFrame },
  'tv-stand': { colour: PALETTE.woodDark, outline: 0.016 },
  'tv-aerial': { colour: PALETTE.liftFrame, outline: 0.012 },
  'gameboy-body': { colour: ART.statueStone, outline: 0.01 },
  'gameboy-screen': {
    colour: PALETTE.markerMint,
    flat: true,
    material: { emissive: PALETTE.markerMint, emissiveIntensity: 0.35 },
  },
  'gameboy-buttons': { colour: PALETTE.markerPink },

  // --- the lobby's grand staircase: two curves and the straight flight ------
  // Spread from `STAIR_PART_STYLES` below rather than typed three times. Three
  // flights a child walks in one go, dressed by three hand-written tables,
  // would be one edit away from a staircase in three colour schemes — which is
  // CLAUDE.md's "two definitions of one thing" applied to a colour.
  ...stairStyles(),

  // --- the mezzanine bridge's balustrade ------------------------------------
  // White and gold, which is the reference photograph's whole palette for a
  // balustrade, with the hotel's own violet on the newel so the bridge belongs
  // to the same building as the stair it continues from.
  'bridge-rail-plinth': { colour: PALETTE.signBoard, outline: 0.02 },
  'bridge-rail-baluster': { colour: PALETTE.blossomWhite, outline: 0.014 },
  'bridge-rail-hand': { colour: PALETTE.liftFrame, outline: 0.016 },
  'bridge-newel': { colour: PALETTE.flowerViolet, outline: 0.018 },

  // --- the moulding that finishes the edge of the landing -------------------
  // The stringers' colour, because that is what it is: the flights' own masonry
  // carried round the edge of the floor they land on. Dressed as the balustrade
  // instead (cream, gold) it would read as a second rail rather than as the
  // floor stopping.
  'landing-nose': { colour: PALETTE.markerLilac, outline: 0.016 },

  // --- the pendant-cluster chandelier ---------------------------------------
  // The drops carry a gentle emissive here so they read as lit at the moment
  // they are added and never as twelve grey eggs. It is deliberately *low*:
  // lighting the lobby is `hotel/lighting.ts`'s job and a fitting bright enough
  // to be a light source blows the park's pastels straight to white (the disco
  // ball's lesson). Raise it, or hang a `PointLight` in the cluster, from there.
  // No outline on the frame, like `disco-rod` and for a sharper reason: a cord
  // is 60 mm across, and an inverted hull at the props' 0.014 would put 28 mm
  // of ink on it and render it half as thick again. ART_DIRECTION §4 — outlines
  // go on silhouette parts, and here the drops are the silhouette. It also
  // keeps every drawn pixel of this asset **below** its own hang point, which
  // an outline standing 14 mm proud of the rose's top face did not.
  'chandelier-frame': { colour: PALETTE.liftFrame },
  'chandelier-drop': {
    colour: PALETTE.signBoard,
    outline: 0.012,
    material: { emissive: PALETTE.buildingWindowWarm, emissiveIntensity: 0.45 },
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

// ===========================================================================
// The second batch, 7 August 2026 — the pet's bed, the lift, the tower's own
// sliding front doors, and the television in the suite.
// ===========================================================================

/** Height of the pet bed's flat cushion, in metres above its floor. */
export const PET_BED_CUSHION_TOP = 0.3;

/**
 * Radius of the **clear** part of that cushion: 0.84 m across, nothing in it.
 *
 * Whoever poses a pet lying in this bed should ask for these two numbers
 * rather than measure the mesh or copy them — CLAUDE.md's "two definitions of
 * one thing". They are the same two literals `hotel_build.py` builds from.
 */
export const PET_BED_CUSHION_RADIUS = 0.42;

export interface PetBedHandle extends AssetHandle {
  /** {@link PET_BED_CUSHION_TOP} — where a lying pet's lowest point goes. */
  readonly cushionTop: number;
  /** {@link PET_BED_CUSHION_RADIUS} — how much room it has, about the origin. */
  readonly cushionRadius: number;
  /** The plush goldfish. Its own mesh so it can be hidden, or made bouncy. */
  readonly toy: Mesh;
}

/**
 * **The pet's four-poster.** Eleri's brief, word for word: *"half-human
 * half-cat bed, in a circular shape with four poster type design. With a
 * pillow and a blanket and even a toy for them to play with."*
 *
 * 1.34 m across the bolster, 1.15 m to the post finials, plus a plush goldfish
 * on the floor beside it. Origin at the floor, centred; the pillow is at −Z
 * (the far side), so a pet lying with its head on it faces the camera.
 *
 * **The bed is bigger than the "about 1.1 m" first sketched, on purpose.**
 * Every pet renders at `PET_RENDER_HEIGHT` (1.46 m standing, `pets.ts`), and a
 * bed sized to that first number read as a saucer with a rabbit spilling out
 * of it. For the same reason the pillow is propped on the bolster rim rather
 * than laid on the cushion: it leaves the whole {@link PET_BED_CUSHION_RADIUS}
 * disc clear, so the poser gets a circle to work with instead of a crescent.
 */
export function createPetBed(): PetBedHandle {
  const { root, meshes } = assemble('hotel.petBed', [
    'petbed-base',
    'petbed-cushion',
    'petbed-bolster',
    'petbed-posts',
    'petbed-canopy',
    'petbed-pillow',
    'petbed-blanket',
    'petbed-toy',
    'petbed-toy-eye',
  ]);
  return {
    root,
    height: measuredHeight(root),
    cushionTop: PET_BED_CUSHION_TOP,
    cushionRadius: PET_BED_CUSHION_RADIUS,
    toy: required(meshes, 'petbed-toy'),
    dispose: () => disposeTree(root),
  };
}

/**
 * The pet's own breakfast bowl — 0.26 m across, origin at the bottom.
 *
 * Deliberately *not* one of the {@link createBreakfastBowl} bowls with a
 * different colour: those are 25 cm cereal bowls with a foot and a tall wall,
 * and one of them beside a child's chair reads as a second person's breakfast
 * rather than as the pet's. This one is wide, low and shallow, which is what
 * makes it read as a pet bowl from above at ten metres.
 */
export function createPetBowl(): AssetHandle {
  const { root } = assemble('hotel.petBowl', ['petbowl-bowl', 'petbowl-food']);
  return { root, height: measuredHeight(root), dispose: () => disposeTree(root) };
}

export interface SlidingDoorsHandle extends AssetHandle {
  readonly left: Mesh;
  readonly right: Mesh;
  /** How far each leaf travels, in metres, from shut to wide open. */
  readonly travel: number;
  /** Clear width of the doorway once they are wide open. */
  readonly openWidth: number;
  /**
   * Slides the pair: 0 shut, 1 wide open. Clamped, so an eased value that
   * overshoots cannot pull a leaf out of its own wall.
   */
  setOpen(open01: number): void;
}

function slidingDoors(
  key: string,
  prefix: string,
  travel: number,
  openWidth: number,
): SlidingDoorsHandle {
  const { root, meshes } = assemble(key, [`${prefix}-door-left`, `${prefix}-door-right`]);
  const left = required(meshes, `${prefix}-door-left`);
  const right = required(meshes, `${prefix}-door-right`);
  return {
    root,
    height: measuredHeight(root),
    left,
    right,
    travel,
    openWidth,
    setOpen(open01: number) {
      const t = Math.min(1, Math.max(0, open01)) * travel;
      left.position.x = -t;
      right.position.x = t;
    },
    dispose: () => disposeTree(root),
  };
}

/** Each lift leaf is 0.90 m wide, so that is exactly how far it has to slide. */
export const LIFT_DOOR_TRAVEL = 0.9;
/** The clear doorway {@link createLiftFrame} leaves for them. */
export const LIFT_DOOR_OPEN_WIDTH = 1.84;
/** Leaf height. The player kid is 2.12 m (ART_DIRECTION §4). */
export const LIFT_DOOR_HEIGHT = 2.44;

/**
 * The lift's two sliding leaves, authored **shut**, side by side, with a 1 cm
 * seam you can see between them.
 *
 * Each leaf is its own node with its own vertices, so opening them is two
 * `position.x` writes and nothing else — no pivot, no hinge, no second formula
 * that can fall out of step with the first. `setOpen(1)` tucks each leaf
 * behind its own jamb panel and, past that, into the room's west wall.
 *
 * The leaf front is three crystal facets rather than a flat slab, which is what
 * makes it belong to the tower: a plain box read as a kitchen cupboard.
 * Origin at the floor between the two leaves; they face **+Z**, so a caller
 * yaws `root.rotation.y` to point them out of the alcove.
 */
export function createLiftDoors(): SlidingDoorsHandle {
  return slidingDoors('hotel.liftDoors', 'lift', LIFT_DOOR_TRAVEL, LIFT_DOOR_OPEN_WIDTH);
}

export interface LiftFrameHandle extends AssetHandle {
  readonly openingWidth: number;
  readonly openingHeight: number;
  /** The brass threshold. Its own mesh so a floor's theme can retint it. */
  readonly sill: Mesh;
}

/**
 * The architrave round the lift, and the brass step you cross to get in.
 *
 * **3.28 m wide, which is not a round number by accident**: `layout.ts` cuts a
 * 3.2 m gap in each room's west wall for the lift (`gaps.west = [-1.6, 1.6]`),
 * and this plugs it with 4 cm of overlap onto the wall either side — so there
 * is no seam, and a leaf slid wide open passes behind solid wall rather than
 * appearing beyond the frame. 2.96 m tall, which is flush under the 3.0 m
 * walls of the breakfast room and corridor; the lobby's walls are 3.4 m and
 * leave a 0.44 m strip above, which reads as a transom and is the only place a
 * caller may want to fill something in.
 *
 * A faceted crystal pilaster stands either side of the opening — the same
 * six-sided gem the tower is grown from, at door scale.
 */
export function createLiftFrame(): LiftFrameHandle {
  const { root, meshes } = assemble('hotel.liftFrame', ['lift-frame', 'lift-frame-sill']);
  return {
    root,
    height: measuredHeight(root),
    openingWidth: LIFT_DOOR_OPEN_WIDTH,
    openingHeight: 2.5,
    sill: required(meshes, 'lift-frame-sill'),
    dispose: () => disposeTree(root),
  };
}

/**
 * The car the player stands in: 2.2 × 2.2 m inside, 2.5 m to the ceiling, open
 * at the front (+Z), panelled, with a brass handrail round three sides.
 *
 * Sized to drop into the alcove `Hotel.buildRoomShell` already walls off
 * (3.0 m clear × 3.4 m deep) with room to spare, and to answer Jim's *"no
 * doors, no floor and also no lift to speak of"* with all three at once.
 *
 * **`lift-car-floor`'s top is at exactly y = 0 and its 5 cm of thickness is
 * below the origin**, so the plate lies flush *under* the walkable surface the
 * hotel already registers at the alcove's floor rather than standing on it as
 * a step a child would trip up. `visibleBounds().bottom` therefore reads about
 * −0.06 (the plate plus its outline), which is deliberate — the same kind of
 * documented exception as the tower's leaning feet.
 */
export function createLiftCar(): AssetHandle {
  const { root } = assemble('hotel.liftCar', ['lift-car-floor', 'lift-car', 'lift-car-rail']);
  return { root, height: measuredHeight(root), dispose: () => disposeTree(root) };
}

export interface LiftDialHandle extends AssetHandle {
  /** Rotate this and nothing else. See {@link LiftDialHandle.setSweep}. */
  readonly needle: Mesh;
  /** The blank cream face. Code paints the floor numbers onto its UVs. */
  readonly face: Mesh;
  /**
   * Points the needle: 0 at the left-hand end of the arc, 1 at the right.
   *
   * A lift dial reads left-to-right as bottom-to-top, so pass
   * `storey / topStorey`. Intermediate values are the whole point — the needle
   * should *sweep* between floors, not snap, which is the thing that makes a
   * pointer display better than a number.
   */
  setSweep(t01: number): void;
}

/**
 * **A classic pointer floor indicator** — Jim: *"a classic style lift pointer
 * style display"*. A brass plaque with a 0.90 m semicircular dial, eleven
 * protruding tick marks, and a red needle on a hub.
 *
 * ## Its origin is the needle's pivot, not its base
 *
 * The documented exception, for the same reason the disco ball's origin is its
 * hook: the one point a caller must line up is the point code rotates about.
 * `lift-dial-needle`'s vertices radiate from (0, 0, 0), so `setSweep` is a
 * single `rotation.z` write with no compensating offset — and there is no
 * second copy of the pivot position anywhere to drift from this one. Geometry
 * therefore sits both above and below y = 0; `height` is the full extent.
 *
 * ## The face is blank on purpose
 *
 * `lift-dial-face` carries a UV map spanning its own front, authored off the
 * same vertices as the shape (ART_DIRECTION §7, CLAUDE.md's hood-face rule).
 * Hand it a canvas with the floor numbers on it; do **not** float a second
 * mesh in front of the dial to carry them.
 */
export function createLiftDial(): LiftDialHandle {
  const { root, meshes } = assemble('hotel.liftDial', [
    'lift-dial',
    'lift-dial-face',
    'lift-dial-ticks',
    'lift-dial-needle',
  ]);
  const { top, bottom } = visibleBounds(root);
  const needle = required(meshes, 'lift-dial-needle');
  return {
    root,
    height: top - bottom,
    needle,
    face: required(meshes, 'lift-dial-face'),
    setSweep(t01: number) {
      // Authored pointing straight up; +Z is out of the face toward the
      // player, so a positive angle swings the tip to her left.
      needle.rotation.z = (0.5 - Math.min(1, Math.max(0, t01))) * Math.PI;
    },
    dispose: () => disposeTree(root),
  };
}

/** Each entrance leaf is 1.09 m wide — half of the tower's `DOOR_W`, less a seam. */
export const ENTRANCE_DOOR_TRAVEL = 1.09;
/** The clear doorway once they are open: the tower's `DOOR_W` less the seam. */
export const ENTRANCE_DOOR_OPEN_WIDTH = 2.18;
/** Leaf height: the tower's `DOOR_H` less 2 cm of clearance. */
export const ENTRANCE_DOOR_HEIGHT = 2.58;

/**
 * The hotel's front doors, so the tower *"slides open as you approach"*.
 *
 * The same construction as {@link createLiftDoors} and taller: two leaves
 * 1.09 × 2.58 m, which is `DOOR_W` × `DOOR_H` of the doorway `hotel_build.py`
 * already cuts into the tower's face, less a centimetre of clearance all
 * round. **`hotel_build.py` asserts that**, rather than trusting these numbers
 * to stay in step by hand, because a door that no longer fits its own hole is
 * exactly the kind of thing nobody notices until a child walks into it.
 *
 * Wide open, each leaf slides its full width and is swallowed by the crystal
 * mass of the prism the doorway is cut into — there is no pocket to build
 * because the tower is solid.
 */
export function createEntranceDoors(): SlidingDoorsHandle {
  return slidingDoors(
    'hotel.entranceDoors',
    'entrance',
    ENTRANCE_DOOR_TRAVEL,
    ENTRANCE_DOOR_OPEN_WIDTH,
  );
}

export interface ScreenedHandle extends AssetHandle {
  /** The blank screen panel. Code paints a picture onto its own UVs. */
  readonly screen: Mesh;
}

/**
 * **The suite's television**: a big chunky wooden set on splayed legs, with two
 * brass knobs, a speaker grille and a pair of rabbit ears. 1.62 m wide, 2.06 m
 * to the top of the taller aerial. Origin on the floor, facing +Z.
 *
 * A flat panel was the obvious reading of *"a large TV"* and the wrong one: a
 * dark rectangle on a stick has no silhouette and no roundness, and there is no
 * black in this game to draw it with anyway (§1). A set made of the same
 * painted wood as the breakfast table reads instantly from the iso camera, and
 * the aerials are the asymmetric feature that keeps it out of placeholder
 * territory (§4 — nothing is plumb; the two ears differ in both length and
 * angle, and each ball is placed at its own ear's computed tip).
 *
 * `tv-screen` is an inset panel of the cabinet's **own** front with its own UV
 * map — not a decal floated in front of it. Hand `screen.material.map` a
 * canvas.
 */
export function createHotelTv(): ScreenedHandle {
  const { root, meshes } = assemble('hotel.tv', [
    'tv-stand',
    'tv-body',
    'tv-screen',
    'tv-knobs',
    'tv-aerial',
  ]);
  return {
    root,
    height: measuredHeight(root),
    screen: required(meshes, 'tv-screen'),
    dispose: () => disposeTree(root),
  };
}

/**
 * The Game Boy on the lounge table: 0.22 × 0.34 m, **lying flat, face up**,
 * origin at the surface it rests on.
 *
 * Three times life size, and it has to be. A 90 × 148 mm handheld on a 0.45 m
 * table, seen from a camera 38° up and several metres back, is four pixels of
 * speckle. Everything in this park is already scaled to be read rather than
 * measured (§4 — the kid's skull is 59% of her height), and a console a child
 * can recognise as *her* Game Boy beats one that is correct and invisible.
 *
 * Its screen lies flat, so its UV comes off X and Z of the panel rather than
 * X and Y — same rule, same authored-off-the-same-vertices guarantee.
 */
export function createGameBoy(): ScreenedHandle {
  const { root, meshes } = assemble('hotel.gameBoy', [
    'gameboy-body',
    'gameboy-screen',
    'gameboy-buttons',
  ]);
  return {
    root,
    height: measuredHeight(root),
    screen: required(meshes, 'gameboy-screen'),
    dispose: () => disposeTree(root),
  };
}

// ===========================================================================
// The grand staircase, 7 August 2026 — Jim, playing: *"the staircase is also
// poorly modelled, looking like a random stack of boxes more than anything…
// Model the staircase properly in blender, with a rail and a nice consistent
// sweep all the way up and a hand rail."*
// ===========================================================================

/**
 * The stair's arc, and **this file is not its owner** —
 * `src/world/hotel/layout.ts`'s `LOBBY.mezzanine` is.
 *
 * They are re-exported here because the asset had to be *built* to them and
 * the game has to *place* it on them, and a number that two files must agree
 * about is the single most reliable bug in this repo (CLAUDE.md, "two
 * definitions of one thing"). So: `layout.ts` decides, `hotel_build.py` builds
 * to it, and everything that places, walks or collides with the staircase asks
 * these constants rather than re-typing the literals. If `layout.ts` ever
 * moves the arc, `hotel_build.py` asserts its way to a loud failure instead of
 * shipping a staircase whose treads are not where a child's feet go.
 */
export const STAIR_INNER_RADIUS = 2.4;
/** @see STAIR_INNER_RADIUS */
export const STAIR_OUTER_RADIUS = 4.2;
/**
 * An eighth of a turn — 45°, **halved on 8 August 2026** along with the rise.
 *
 * A curve now climbs only as far as the landing, which is five treads rather
 * than ten, and five treads spread over the old quarter turn would be 1.04 m
 * deep at mid radius: a 17° pitch, which is a ramp with occasional steps. The
 * tread depth is the invariant and the arc is what gave way, so the going comes
 * out at exactly the 0.518 m it has always been and the flight is the same
 * staircase, half as long. @see STAIR_INNER_RADIUS
 */
export const STAIR_SWEEP = Math.PI / 4;
/**
 * Floor to the **true level** — `layout.ts`'s `LOBBY_MEZZANINE_Y`, the gallery
 * deck. No single flight climbs all of it any more: the two curves reach
 * {@link LANDING_HEIGHT} and {@link createStraightStaircase} finishes the job.
 */
export const STAIR_RISE = 3.2;
/**
 * 0.32 m — half the game's `BUILDING_STEP_UP`, so every tread is walkable, and
 * the **owner** of both flights' tread counts rather than a number derived from
 * them. It is the constraint; the heights give way to it.
 */
export const STAIR_RISER = 0.32;
/**
 * The intermediate floor the two curves reach and the wide straight flight
 * leaves — Jim, 8 August 2026: *"Make the curved stairs reach an intermediate
 * floor that then turns into a single, wide straight staircase up to the true
 * level."*
 *
 * Half of {@link STAIR_RISE}, so the composition splits evenly into five treads
 * of curve and five of straight, and the landing reads as a proper mid-level
 * rather than as a wide step near one end.
 */
export const LANDING_HEIGHT = 1.6;
/**
 * What the straight flight has left to climb.
 *
 * **Derived, and that is the point.** "The curves reach the landing and the
 * straight flight finishes the job" is *one* relationship; writing it as one
 * subtraction is the only way it cannot come apart. `hotel_build.py`'s
 * `assert_flights_meet` then measures the same relationship off the two emitted
 * meshes, because a derivation proves the arithmetic and only a measurement
 * proves the geometry.
 */
export const STRAIGHT_RISE = STAIR_RISE - LANDING_HEIGHT;
/**
 * Treads in **a curved flight** — five, derived from the riser and the landing
 * rather than typed, so it cannot disagree with either. @see STAIR_INNER_RADIUS
 */
export const STAIR_TREADS = Math.round(LANDING_HEIGHT / STAIR_RISER);
/**
 * Handrail centre-line above the tread it stands over, in metres.
 *
 * The same 0.86 m `Hotel.dressMezzanine` puts the gallery's own rail at, and
 * not by coincidence: over its last tread the stair's handrail eases level at
 * `STAIR_RISE + STAIR_RAIL_HEIGHT` (4.06 m), which is exactly where a rail
 * standing on the deck meets it. The two are meant to be one continuous line.
 */
export const STAIR_RAIL_HEIGHT = 0.86;

export interface GrandStaircaseHandle extends AssetHandle {
  /** Which way it turns as you climb it. @see createGrandStaircase */
  readonly handedness: StairHandedness;
  readonly innerRadius: number;
  readonly outerRadius: number;
  /**
   * The quarter turn, **signed in the game's yaw** — `+STAIR_SWEEP` for a
   * right-hand flight and `−STAIR_SWEEP` for a left-hand one.
   *
   * Signed rather than absolute because the sign *is* the difference between
   * the two, and a caller that reads `Math.PI / 2` for both places one of them
   * back to front. It is the direction a climber travels; for an angular range
   * that is safe to hand to a collider, use {@link treadArc}.
   */
  readonly sweep: number;
  /**
   * **This flight's own rise — the landing, not the true level.**
   *
   * Since 8 August a curve climbs to {@link LANDING_HEIGHT} and stops there;
   * {@link createStraightStaircase} carries the remaining
   * {@link STRAIGHT_RISE} up to {@link STAIR_RISE}. Code that used to read
   * `rise` as "the height of the gallery" is reading the height of the landing
   * now, and wants `STAIR_RISE`.
   */
  readonly rise: number;
  readonly treads: number;
  readonly riser: number;
  readonly railHeight: number;
  /**
   * The walking height of tread `index` (0-based), in metres above the origin.
   *
   * `treadTop(treads - 1) === rise` exactly. Ask this rather than recomputing
   * `rise * (i + 1) / treads`: the walk surface the game registers and the
   * geometry a child sees are then the same arithmetic, done once.
   */
  treadTop(index: number): number;
  /**
   * Tread `index`'s angular span in the game's yaw, relative to the flight's own
   * start — **always ascending**, `from < to`, whichever hand this flight is.
   *
   * Index 0 is the bottom tread for both hands, so `treadArc(i)` and
   * `treadTop(i)` describe the same step.
   *
   * This exists because `ArcTread.covers` tests `angle >= from && angle < to`
   * and a left-hand flight climbs through **decreasing** angles: subdividing
   * `fromAngle → fromAngle + sweep` by hand produces ranges in descending order
   * for it, `covers` then returns false everywhere, and what a child meets is a
   * staircase she walks straight through. Nothing about that failure is
   * visible in a render — which is exactly why the ordering lives here, once,
   * instead of in every caller.
   */
  treadArc(index: number): { readonly from: number; readonly to: number };
}

function staircaseParts(handedness: StairHandedness): readonly string[] {
  return STAIR_PART_SUFFIXES.map((part) => `stair-${handedness}-${part}`);
}

/**
 * **One curved flight of the lobby's grand staircase**: a 45° sweep of five
 * treads from the floor to the intermediate landing, between two closed crystal
 * strings, with a balustrade carrying a continuous swept handrail, a newel at
 * each end, and a matching moulded coping along the inner string.
 *
 * ## It is one of three flights now
 *
 * Jim, 8 August 2026, on the twin-sweep renders: *"Make the curved stairs reach
 * an intermediate floor that then turns into a single, wide straight staircase
 * up to the true level."* So: two of these, mirrored, from the floor to
 * {@link LANDING_HEIGHT}, and one {@link createStraightStaircase} from the
 * landing to {@link STAIR_RISE}. An imperial composition, and the reason this
 * factory's `rise` is 1.6 m rather than the 3.2 m it used to be.
 *
 * ## Its origin is the arc's centre, not the foot of the flight
 *
 * The documented exception, like the disco ball's hang point and the lift
 * dial's needle pivot, and for the same reason: **the one point a caller has
 * to line up is the point the shape is defined about.** Every tread, both
 * strings and the handrail are swept about the centre of curvature, so that is
 * where the origin goes — on the floor (`y = 0`), at the centre, with no
 * geometry anywhere near it. `layout.ts` already names that point
 * (`stair.centreX`, `stair.centreZ`), so placing this is:
 *
 * ```ts
 * stair.root.position.set(
 *   room.originX + plan.stair.centreX,
 *   floorY,
 *   room.originZ + plan.stair.centreZ,
 * );
 * ```
 *
 * and nothing else — no half-width offset to get wrong, and no second formula
 * that has to track the arc when the arc moves.
 *
 * ## Which way it sweeps, and what `handedness` means
 *
 * Handedness is named for **the climber**, never for a side of a room:
 *
 * | `handedness` | climbing, you turn | bottom tread | top tread | game yaw |
 * | --- | --- | --- | --- | --- |
 * | `'right'` | right | `+Z` from the origin | swings toward `−X` | 0 → `+π/4` |
 * | `'left'` | left | `+Z` from the origin (**the same place**) | toward `+X` | 0 → `−π/4` |
 *
 * Both are authored at **`fromAngle = 0`** in the yaw the rest of the game
 * measures (`Mezzanine`: 0 is +Z, turning toward −X). A room that wants a
 * different start angle sets `root.rotation.y = -fromAngle` — negative, because
 * three.js yaws +Z toward +X and this game's stair angle turns it toward −X.
 *
 * ## Placing the imperial composition
 *
 * Put the two origins at `(±C, Zc)`, **`'right'` on the `+X` side** and
 * `'left'` on `−X`, and give each flight `fromAngle = ±(π/2 − STAIR_SWEEP)` —
 * `+π/4` for the right hand, `−π/4` for the left, i.e.
 * `root.rotation.y = ∓π/4`. That quarter-turn's worth of rotation is what lands
 * both flights' **top treads square to the landing**, running along X with the
 * climber heading `−Z`: the tread that meets the landing is the one join in the
 * composition that must not arrive at an angle, and with a 45° sweep you can
 * have the foot square or the top square, not both. A floor takes a stair at
 * any angle; a landing does not.
 *
 * With that rotation:
 *
 * - each top tread spans `x` from `±(C − STAIR_OUTER_RADIUS)` to
 *   `±(C − STAIR_INNER_RADIUS)` at `z = Zc`, so the two tops face each other
 *   across a clear `2·(C − STAIR_OUTER_RADIUS)`;
 * - the feet stand side by side toward the entrance at
 *   `z = Zc + r·cos(π/4)`, `x = ±(C − r·sin(π/4))` — closer together than the
 *   old quarter-turn put them, and angled inward;
 * - the landing spans that middle gap **and** both top treads: `x` from
 *   `−(C − STAIR_INNER_RADIUS)` to `+(C − STAIR_INNER_RADIUS)`, at
 *   {@link LANDING_HEIGHT}.
 *
 * Pick `C` so the middle gap is a whole number of {@link BRIDGE_RAIL_TILE}s —
 * `C = STAIR_OUTER_RADIUS + n·BRIDGE_RAIL_TILE/2` — because that gap is the
 * landing's front balustrade and a part-tile is the one thing the tile cannot
 * do. At `C = 7.26` it is 6.12 m, six tiles, and the composition is 9.72 m
 * across; at `C = 6.75`, 5.10 m and five.
 *
 * ## The mirror is authored, not scaled
 *
 * There is no `scale.x = -1` anywhere near this and there must not be. A
 * negative scale flips the winding of every triangle under the node, and this
 * park's `MeshToonMaterial` is `FrontSide`: the whole flight would be *culled* —
 * invisible in the running game while the mesh, the code and every render of
 * the original looked correct. That is the fortnight the critter hood faces cost
 * us (CLAUDE.md). `hotel_build.py` sweeps the arc the other way round instead,
 * and asserts the two meshes are exact mirror images vertex for vertex
 * (`assert_stairs_mirror`) so the claim is measured rather than believed.
 *
 * ## What it was built to
 *
 * `LANDING_HEIGHT` = 1.6 m. Five treads of a 0.32 m riser, inner radius 2.4 m,
 * outer 4.2 m, a 45° sweep — **identical for both hands**, so anything derived
 * from the constants (walk slices, flank colliders, guest keep-outs) is derived
 * the same way for either. The measured top is ~2.75 m — the top newel's
 * finial, standing on the landing, not a walkable height; the *walkable* top is
 * `rise`, and the true level is another `STRAIGHT_RISE` above it.
 *
 * ## What the strings mean for collision
 *
 * Both strings are solid masonry **from the floor to the tread**, which is what
 * `Hotel.buildMezzanine`'s flank colliders already claim. That is why they are
 * not the prettier open flight: a floating string would show a metre of
 * daylight under the middle of the stair with an invisible wall standing in it.
 * The treads themselves are walk surfaces and never colliders — see
 * `buildMezzanine`'s header for why a solid tread is a wall to the child on the
 * step below it.
 */
export function createGrandStaircase(
  handedness: StairHandedness = 'right',
): GrandStaircaseHandle {
  const { root } = assemble(`hotel.grandStaircase.${handedness}`, staircaseParts(handedness));
  const sign = handedness === 'right' ? 1 : -1;
  return {
    root,
    handedness,
    height: measuredHeight(root),
    innerRadius: STAIR_INNER_RADIUS,
    outerRadius: STAIR_OUTER_RADIUS,
    sweep: STAIR_SWEEP * sign,
    rise: LANDING_HEIGHT,
    treads: STAIR_TREADS,
    riser: STAIR_RISER,
    railHeight: STAIR_RAIL_HEIGHT,
    treadTop: (index: number) => STAIR_RISER * (index + 1),
    treadArc: (index: number) => {
      const a = (STAIR_SWEEP * sign * index) / STAIR_TREADS;
      const b = (STAIR_SWEEP * sign * (index + 1)) / STAIR_TREADS;
      return { from: Math.min(a, b), to: Math.max(a, b) };
    },
    dispose: () => disposeTree(root),
  };
}

/**
 * Tread depth, metres — **the curved flight's own going, at its mid radius**.
 *
 * Derived rather than chosen: one pitch through the whole composition means a
 * child's stride does not change at the landing, and it means the straight
 * flight's rake, its soffit, its string easing and its handrail all come out at
 * the 32° the curve was tuned to.
 */
export const STRAIGHT_GOING =
  (((STAIR_INNER_RADIUS + STAIR_OUTER_RADIUS) / 2) * STAIR_SWEEP) / STAIR_TREADS;

/** Treads in the straight flight — five, derived like the curve's. */
export const STRAIGHT_TREADS = Math.round(STRAIGHT_RISE / STAIR_RISER);

/**
 * How far the straight flight travels in plan, metres.
 *
 * What the room has to find for it between the landing's back edge and the
 * gallery it lands on.
 */
export const STRAIGHT_RUN = STRAIGHT_GOING * STRAIGHT_TREADS;

/**
 * The walking width between its two strings, metres — **both curved flights
 * gathered into one**, which is what makes it the grand one. Two 1.8 m flights
 * arrive at the landing and 3.6 m leaves it.
 */
export const STRAIGHT_WALK_WIDTH = 2 * (STAIR_OUTER_RADIUS - STAIR_INNER_RADIUS);

export interface StraightStaircaseHandle extends AssetHandle {
  /** @see STRAIGHT_WALK_WIDTH */
  readonly walkWidth: number;
  /**
   * Overall width across the two closed strings, metres — **measured off the
   * built asset**, outline and facet crests included, because that is the
   * number a room needs to clear and a claimed one is only a claim.
   */
  readonly width: number;
  /** @see STRAIGHT_RUN */
  readonly run: number;
  /** @see STRAIGHT_GOING */
  readonly going: number;
  /** {@link STRAIGHT_RISE} — landing to the true level. */
  readonly rise: number;
  /** @see STRAIGHT_TREADS */
  readonly treads: number;
  /** @see STAIR_RISER */
  readonly riser: number;
  /** @see STAIR_RAIL_HEIGHT */
  readonly railHeight: number;
  /**
   * The walking height of tread `index` (0-based) **above the landing**, in
   * metres. `treadTop(treads - 1) === rise` exactly; add the landing's own
   * height for a world figure.
   */
  treadTop(index: number): number;
  /**
   * How far along the run tread `index`'s **leading edge** sits, in metres from
   * the origin. `treadFront(0)` is 0 — the bottom riser, which the origin is
   * on — and `treadFront(treads)` is {@link STRAIGHT_RUN}. Ask this rather than
   * multiplying by the going, so the walk surfaces and the geometry are the
   * same arithmetic done once.
   */
  treadFront(index: number): number;
}

const STRAIGHT_PARTS = STAIR_PART_SUFFIXES.map((part) => `stair-straight-${part}`);

/**
 * **The wide straight flight** that finishes the lobby's staircase: five treads
 * from the intermediate landing up to the true level, as wide as both curved
 * flights together, between two closed strings, with a handrail and a row of
 * balusters down **each** side and a newel at all four corners.
 *
 * Jim, 8 August 2026: *"Make the curved stairs reach an intermediate floor that
 * then turns into a single, wide straight staircase up to the true level."*
 *
 * ## Its origin is the centre of its bottom riser, at landing height
 *
 * `x = 0` across the flight, `y = 0` on the landing it stands on, `z = 0` at
 * the face of the first riser. That is the one point a caller has to line up —
 * the same argument as the curve's centre of curvature — so placing it is
 *
 * ```ts
 * flight.root.position.set(room.originX + centreX, floorY + LANDING_HEIGHT, room.originZ + frontZ);
 * ```
 *
 * with no half-width and no half-run arithmetic to get wrong. It climbs toward
 * **−Z** (the asset's front, +Z, is the bottom riser you walk at), so an
 * unrotated flight climbs away from the entrance and toward the gallery, which
 * is the composition. The bottom newels reach {@link BRIDGE_NEWEL_RADIUS}
 * behind `y = 0`: a post stands *on* the end of a run, not beyond it.
 *
 * ## It stands on the landing, and the landing has to be under all of it
 *
 * Its strings stop at `z = 0` — this flight is not solid to the lobby floor the
 * way the curves are, because what is under it is the landing, not the floor.
 * The room therefore has to carry the platform back under the whole
 * {@link STRAIGHT_RUN}, or give the flight a podium of its own. That is the one
 * thing about it a placing agent can get wrong and not see: the flight would
 * float, correctly lit, over nothing.
 *
 * ## It is the curve's own joinery, run flat
 *
 * Same riser, same going, same string section and easing, same handrail
 * profile, same {@link BRIDGE_RAIL_TILE}-matching baluster pitch. A hand runs
 * off the landing's balustrade and up this without meeting a join, and a stride
 * that worked on the curve works here. `hotel_build.py` asserts the flight is an
 * exact mirror image **of itself** about its own centre line
 * (`assert_straight_symmetric`), which is what catches a rail built down one
 * side only — the defect that matters most here and the one a render from any
 * single angle hides best.
 */
export function createStraightStaircase(): StraightStaircaseHandle {
  const { root } = assemble('hotel.straightStaircase', STRAIGHT_PARTS);
  let half = 0;
  visiblePoints(root, (point) => {
    if (Math.abs(point.x) > half) half = Math.abs(point.x);
  });
  return {
    root,
    height: measuredHeight(root),
    walkWidth: STRAIGHT_WALK_WIDTH,
    width: half * 2,
    run: STRAIGHT_RUN,
    going: STRAIGHT_GOING,
    rise: STRAIGHT_RISE,
    treads: STRAIGHT_TREADS,
    riser: STAIR_RISER,
    railHeight: STAIR_RAIL_HEIGHT,
    treadTop: (index: number) => STAIR_RISER * (index + 1),
    treadFront: (index: number) => STRAIGHT_GOING * index,
    dispose: () => disposeTree(root),
  };
}

// ===========================================================================
// The mezzanine bridge's balustrade, and the chandelier over the archway —
// 8 August 2026, from Jim's reference photograph of a grand resort lobby: two
// mirrored stairs rising to a bridge across the room, an archway at ground
// level you can see straight through, ornate white-and-gold balustrades, and a
// cluster of pendant lights in the double-height space.
// ===========================================================================

/**
 * Length of one balustrade segment, metres. **Tile at exactly this pitch.**
 *
 * Two balusters at 0.51 m centres, which is the staircase's own spacing
 * measured along its outer radius — a bridge a sweeping stair lands on is that
 * balustrade continuing, and a rail that changes rhythm at the join is two
 * railings. Segments butt end to end: place tile `i` at
 * `x0 + (i + 0.5) * BRIDGE_RAIL_TILE` and the balusters stay evenly spaced
 * straight across every join, with no seam (see {@link createBridgeRailing}).
 */
export const BRIDGE_RAIL_TILE = 1.02;

/**
 * Handrail centre-line above the deck, metres.
 *
 * **`STAIR_RAIL_HEIGHT` is the owner** and this is an alias, not a second
 * number: over its last tread the stair's handrail eases level at
 * `STAIR_RISE + STAIR_RAIL_HEIGHT`, which is exactly where this one sits when
 * the balustrade stands on the deck. They are meant to be one continuous line,
 * and a copied literal is how they would stop being one.
 */
export const BRIDGE_RAIL_HEIGHT = STAIR_RAIL_HEIGHT;

/**
 * How thick the balustrade is across its run, metres — the plinth's own width.
 *
 * What a caller needs to inset the run from the edge it guards, and what a
 * collider along it should be. Measured off the built asset, not asserted here.
 */
export const BRIDGE_RAIL_DEPTH = 0.23;

/**
 * Circumradius of a newel post, metres. Half its width across corners.
 *
 * A newel is centred **on the end of a run**, not beyond it: the handrail dies
 * into the post, which is what joinery does and what hides the end caps of both
 * the rail and the plinth.
 */
export const BRIDGE_NEWEL_RADIUS = 0.134;

export interface BridgeRailingHandle extends AssetHandle {
  /** @see BRIDGE_RAIL_TILE */
  readonly tile: number;
  /** @see BRIDGE_RAIL_HEIGHT */
  readonly railHeight: number;
  /** @see BRIDGE_RAIL_DEPTH */
  readonly depth: number;
}

const BRIDGE_RAIL_PARTS = [
  'bridge-rail-plinth',
  'bridge-rail-baluster',
  'bridge-rail-hand',
] as const;

/**
 * **One repeatable segment of the mezzanine bridge's balustrade** — a moulded
 * plinth, two turned balusters and a length of handrail, 1.02 m long.
 *
 * ## It is a tile, and that is the whole design
 *
 * A bridge is however wide the room is, and a room is not an asset's to know.
 * One long bespoke railing per span would be a mesh that has to be rebuilt in
 * Blender every time a wall moves — the coupling `layout.ts` owning the stair's
 * arc was introduced to avoid. So: repeat this along the run at
 * {@link BRIDGE_RAIL_TILE}, and cap each end (or turn each corner) with
 * {@link createBridgeNewel}.
 *
 * Origin at the **centre** of the segment, on the deck (`y = 0`), running along
 * **X** with the face you look over toward `+Z`. A run along Z is the same tile
 * at `root.rotation.y = Math.PI / 2`.
 *
 * ## Why the joins do not show
 *
 * The handrail and the plinth span the tile *exactly*, so two tiles meet face
 * to face. Their inverted-hull outlines push along ±X only — a 90° end cap is
 * over `hotel_build.py`'s split-normal threshold, so the cap carries its own
 * normals rather than ones averaged with the sides — which means each outline
 * pushes *into* the neighbour's solid and is hidden by it. `hotel_build.py`
 * asserts both ends of both sweeps land exactly on ±`BRIDGE_RAIL_TILE / 2`;
 * that check was written measuring `max(abs(x))`, which is one number for two
 * ends and passed a rail deliberately shortened at one of them, so it now
 * measures the two ends separately.
 *
 * ## It is the stair's own joinery
 *
 * Not "matching" — the same. The handrail is the stair's handrail section swept
 * straight, the plinth is the stair's coping section swept straight, and the
 * balusters are the stair's spindle. One profile, one place it is written down.
 */
export function createBridgeRailing(): BridgeRailingHandle {
  const { root } = assemble('hotel.bridgeRailing', BRIDGE_RAIL_PARTS);
  return {
    root,
    height: measuredHeight(root),
    tile: BRIDGE_RAIL_TILE,
    railHeight: BRIDGE_RAIL_HEIGHT,
    depth: BRIDGE_RAIL_DEPTH,
    dispose: () => disposeTree(root),
  };
}

export interface BridgeNewelHandle extends AssetHandle {
  /** @see BRIDGE_NEWEL_RADIUS */
  readonly radius: number;
}

/**
 * **The post that ends a run of balustrade — and turns a corner.**
 *
 * One piece serves both, because a newel is what a balustrade does wherever it
 * stops being straight: at the end of the bridge, at the head of a flight, at
 * the corner where a gallery turns. It is the *same* post the staircase already
 * starts and finishes with, standing on the deck instead of on a string, so a
 * bridge that meets a stair meets it post to post.
 *
 * Origin at its base, centred. Centre it **on** the end of the run
 * ({@link BRIDGE_NEWEL_RADIUS} is how far it reaches past that point) and let
 * the handrail run into it.
 */
export function createBridgeNewel(): BridgeNewelHandle {
  const { root } = assemble('hotel.bridgeNewel', ['bridge-newel']);
  return {
    root,
    height: measuredHeight(root),
    radius: BRIDGE_NEWEL_RADIUS,
    dispose: () => disposeTree(root),
  };
}

/**
 * How far the nosing laps back over the floor it finishes, metres.
 *
 * Place it with its origin **on the edge**: at the line where the platform's
 * top face meets its front face. It laps this far inboard and hangs over the
 * face in front.
 */
export const LANDING_NOSE_BITE = 0.06;

/**
 * How far the nosing's top stands above the floor's own top face, metres.
 *
 * 8 mm, and it is not a mistake. A moulding whose top is *coplanar* with the
 * slab it caps gives the depth buffer two faces in one plane over the whole
 * lapped band, which is what z-fighting is; standing it proud buries the slab's
 * own top face inside solid geometry instead. It is the stair string's
 * bite-and-upstand trick at a tenth of the size — invisible from the game's
 * camera, unmistakable to a depth test — and the walk surface is registered by
 * code, so nothing steps on it.
 */
export const LANDING_NOSE_PROUD = 0.008;

/** How far it overhangs the face below, metres — the shadow line. */
export const LANDING_NOSE_REACH = 0.062;

/**
 * How far down the face it hangs, metres.
 *
 * Deliberately shallower than any platform this park builds: the moulding
 * finishes the *edge* and the face below it stays the room's own colour, so
 * nothing here has to agree with a slab thickness chosen in `Hotel.ts`.
 */
export const LANDING_NOSE_DROP = 0.15;

export interface LandingNosingHandle extends AssetHandle {
  /** Tile at exactly this pitch — {@link BRIDGE_RAIL_TILE}. */
  readonly tile: number;
  /** @see LANDING_NOSE_BITE */
  readonly bite: number;
  /** @see LANDING_NOSE_REACH */
  readonly reach: number;
}

/**
 * **The moulding that finishes the edge of a raised floor** — the intermediate
 * landing, and the gallery deck if it wants one. One tile, 1.02 m long, laid
 * along the edge at the balustrade's own pitch.
 *
 * ## Why it exists
 *
 * A landing is a *slab*, and a slab is what the room builds. From the lobby
 * floor a child looks straight at its front face, and nine metres of flat
 * colour with a balustrade standing on top of it is the one thing in this
 * composition that would still read as programmer-art. This is the thin
 * bullnose lip that says where a floor stops: it is deliberately **not** a
 * second plinth, because the balustrade already brings a moulded kerb and two
 * mouldings side by side is a wedding cake.
 *
 * ## Placing it
 *
 * Origin **on the edge line** — where the platform's top face meets its front
 * face — centred along its length, with the overhang toward `+Z` (the face you
 * look over, the same convention {@link createBridgeRailing} uses; a run along
 * Z is the same tile at `root.rotation.y = Math.PI / 2`). Tile it exactly like
 * the balustrade: `x0 + (i + 0.5) * BRIDGE_RAIL_TILE`, which also means one
 * loop can lay the nosing and the rail together and they can never fall out of
 * step with each other.
 *
 * The balustrade then stands on the floor **behind** it — the two do not
 * interlock, and the nosing does not move where the plinth goes.
 */
export function createLandingNosing(): LandingNosingHandle {
  const { root } = assemble('hotel.landingNosing', ['landing-nose']);
  return {
    root,
    height: measuredHeight(root),
    tile: BRIDGE_RAIL_TILE,
    bite: LANDING_NOSE_BITE,
    reach: LANDING_NOSE_REACH,
    dispose: () => disposeTree(root),
  };
}

/** How many pendant drops hang in one chandelier. */
export const CHANDELIER_LAMPS = 12;

export interface ChandelierHandle extends AssetHandle {
  /**
   * All twelve glass drops, in **one** mesh.
   *
   * The node to light from: raise its `emissive`/`emissiveIntensity` for a
   * brighter fitting, or hang a `PointLight` in the middle of the cluster. It is
   * one mesh rather than twelve on purpose — the park's whole lighting budget is
   * fourteen point lights, so twelve drops were never going to be twelve lamps,
   * and twelve nodes would have cost ~8 KB of glTF JSON to say so.
   */
  readonly drops: Mesh;
  /** Radius of the cluster at its widest, metres. Measured. */
  readonly spread: number;
  /** @see CHANDELIER_LAMPS */
  readonly lamps: number;
}

/**
 * **A cluster of twelve pendant drops** hanging in the lobby's double-height
 * space, over the archway the two staircases frame.
 *
 * ## Origin at the hang point
 *
 * The disco ball's exception (ART_DIRECTION §7's balloon rule) for the same
 * reason: this thing hangs, so its origin is the point it hangs *from* and
 * `ceilingAnchor.add(chandelier.root)` needs no offset arithmetic. Every vertex
 * is below `y = 0`, and `height` reports the **drop** — how far the lowest globe
 * reaches below the hook — rather than a height above a floor. It is the fourth
 * documented case in this asset, after the disco ball, the lift dial's needle
 * pivot and the staircase's centre of curvature.
 *
 * ## Why it has a small rose and fanning cords
 *
 * The first version hung twelve plumb cords from a 2.9 m saucer spanning the
 * whole cluster, which is what a real ceiling fitting has and exactly the wrong
 * shape here: the park's camera looks *down* at 38° and hotel rooms are
 * open-topped, so a plate as wide as the cluster is a lid over the only part of
 * the asset anybody was meant to see. That is the pet bed's canopy again, and it
 * took one render to say so a second time. What ships is a 0.60 m rose with the
 * cords fanning out and down from it, 19°–29° off plumb — a cascade, and the
 * form that leaves every drop in full view from above.
 *
 * ## Placing it
 *
 * ~3.0 m of drop and ~2.5 m across. In the 6.4 m lobby, hung from the top of the
 * tall walls, the lowest globe sits ~3.4 m up — above the 3.2 m mezzanine deck
 * and well clear of a 2.12 m child underneath it.
 */
export function createChandelier(): ChandelierHandle {
  const { root, meshes } = assemble('hotel.chandelier', ['chandelier-frame', 'chandelier-drop']);
  const { top, bottom } = visibleBounds(root);
  const drops = required(meshes, 'chandelier-drop');
  drops.geometry.computeBoundingBox();
  const box = drops.geometry.boundingBox;
  return {
    root,
    height: top - bottom,
    drops,
    spread: box ? Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) : 0,
    lamps: CHANDELIER_LAMPS,
    dispose: () => disposeTree(root),
  };
}
