import { Group, Mesh } from 'three';
import { CASTLE_GLB_BASE64 } from '../assets/castleGlb';
import { PALETTE } from '../style/bridge';
import { ART } from '../style/artPalette';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import {
  addOutline,
  disposeTree,
  markShared,
  solid,
  toonMaterial,
  type ToonOptions,
} from '../style/materials';
import { visibleBounds } from '../style/measure';
import type { AssetHandle } from '../style/asset';

/**
 * **The castle's great hall, and everything that furnishes it** — batch 1 of
 * the authored interior geometry (issue #363, assets in PR #368).
 *
 * The **fifth** asset through the `.glb` pipeline, and the second authored by a
 * script: `art/blend/castle_build.py` writes `art/blend/castle.blend`,
 * `castle_export.py` writes the `.glb`, and `npm run blend:castle` runs the
 * pair and packs the result to `src/art/assets/castleGlb.ts`. The `.blend` is a
 * generated artefact — edit the Python, never the file.
 *
 * ## The split, and why the glb carries no colour
 *
 * Exactly `hotelAssets.ts`'s split, which is the worked precedent this file
 * follows rather than reinvents. The 3D Artist owns **shape** and nothing else.
 * Everything below — the {@link STYLES} table, the ink outlines, the shadow
 * flags, the measured constants the rest of the game reads — lives here. The
 * `.glb` carries **0 materials, 0 textures, 0 images, 0 animations**; that is
 * asserted on the asset side, not hoped for.
 *
 * ## This file is the second half of a contract, and the contract has teeth
 *
 * `HANDOFF-castle-interior-363.md` §4.4 lists the numbers the two sides must
 * agree on exactly, and its protocol is that **neither side copies the other's
 * figure by hand**: every one is either exported from here or measured off the
 * built mesh and asserted against the reported one. So:
 *
 * - {@link CASTLE_TABLE_TOP}, {@link CASTLE_BENCH_SEAT} and
 *   {@link CASTLE_SCONCE_CUP} are **measured off the loaded geometry** at
 *   module load. Nothing here types them. `check:castle` re-derives all three
 *   independently and fails if they have moved.
 * - {@link CASTLE_DAIS_HEIGHT} and {@link CASTLE_TAPESTRY_RAIL_Y} go the other
 *   way: they are mine, and `castle_build.py` **reads them out of this file**
 *   with `ts_const`. They were the last two hand-typed numbers in the whole
 *   castle contract — the Artist's own comment beside them says *"the moment
 *   `castleAssets.ts` exists this should be `ts_const`'d"* — and creating this
 *   file is what closes that out. Both must therefore stay plain
 *   `export const NAME = <number>;`, because that is the whole of the grammar
 *   `ts_const` reads. **Deriving either one is a silent break**: the Python
 *   falls back to a typed figure and prints that it has, which is the correct
 *   failure but is not a build failure.
 *
 * ## The furniture is cut to a six-year-old, and that is not a style choice
 *
 * Jim's ruling of 29 August, accepted on both sides. {@link CASTLE_BENCH_SEAT}
 * measures 0.360 m because that is `KID_HIP_HEIGHT` exactly — **the rig has no
 * knee**, so there is precisely one seat height at which her feet reach the
 * floor, and every other value is a choice between dangling feet and legs
 * through the floorboards. {@link CASTLE_TABLE_TOP} measures 0.675 m because
 * the 1.05 m it replaced stood one centimetre *above* `KID_REACH_HEIGHT` — a
 * table a child could not reach the top of.
 *
 * Nothing in this file retypes either landmark. `castle_build.py` reads them
 * from `kid.ts` with `ts_const` and cuts the geometry from them; this file
 * measures what came out. That is the point: a number typed in a second place
 * is the fault that left a render script claiming a 1.86 m child for weeks.
 */

const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(CASTLE_GLB_BASE64));

for (const part of parts.values()) markShared(part.geometry);

/** How a part is dressed. Colour and shading only — never shape. */
interface PartStyle {
  /** From `PALETTE` or `ART`. Never an inline hex (ART_DIRECTION §5). */
  readonly colour: number;
  /**
   * Inverted-hull outline thickness in metres, omitted for parts that do not
   * define a silhouette. Props take 0.016–0.022 (ART_DIRECTION §4); the feast
   * props take 0.012, the small-object figure, because 0.016 round a 30 cm
   * goblet is a line thicker than the stem it is drawing.
   *
   * The iron parts take a thin outline or none: `ART.castleIron` is already
   * close to `PALETTE.ink`, and ink-tinting an outline round something that
   * dark draws a black line, which §4 bans.
   */
  readonly outline?: number;
  /** Set for flat appliqué and self-lit parts: casts no shadow, catches none. */
  readonly flat?: true;
  /** Extra material options. */
  readonly material?: ToonOptions;
}

/**
 * Every node in `castle.glb`, dressed. **All 23 of them** — a node with no
 * entry here throws at load rather than arriving in the park untextured, which
 * is why the Artist publishes the node list when it publishes the bytes.
 *
 * One table rather than a line of code per part, so "what colour is the
 * throne's gilding" is answerable by reading rather than by tracing a builder.
 * `art/blend/castle_render.py` reads these keys back out of this file for its
 * review renders and copies no hex; this file is the owner.
 *
 * ## The wood is three tones and the metal is two
 *
 * A great hall is mostly timber, and one wood colour across a throne, a table,
 * benches, a chest and six tapestry rails would flatten all of it into one
 * object. So the furniture reads light-to-dark by *weight*: the table top and
 * bench planks are the light wood a child's hands land on, the legs and frames
 * the dark wood underneath. The two metals are the Artist's own distinction —
 * `castleSteel` is polished plate, `castleIron` is wrought strapwork — and
 * keeping them apart is what stops a suit of armour reading as a grey blob.
 */
const STYLES: Record<string, PartStyle> = {
  // --- the suit of armour ---------------------------------------------------
  'armour-plate': { colour: ART.castleSteel, outline: 0.02 },
  'armour-trim': { colour: ART.castleIron, outline: 0.014 },
  // The visor's slit is a hole, and a hole is drawn dark. `PALETTE.ink` is the
  // outline colour rather than a fill colour anywhere else in the park, and it
  // is used deliberately here: no outline round it, because an ink hull round
  // an ink slit is the black line §4 bans.
  'armour-visor': { colour: PALETTE.ink },
  // A knight a six-year-old likes has a bright plume. This is the one part of
  // the armour that is not metal, and it is what makes the silhouette read as a
  // character rather than as a cupboard.
  'armour-plume': { colour: PALETTE.markerPink, outline: 0.016 },
  'plinth-block': { colour: PALETTE.stonePinkDark, outline: 0.02 },

  // --- the feast ------------------------------------------------------------
  'table-top': { colour: PALETTE.woodLight, outline: 0.018 },
  'table-legs': { colour: PALETTE.woodDark, outline: 0.018 },
  'bench-plank': { colour: PALETTE.wood, outline: 0.018 },
  'feast-goblet': { colour: PALETTE.liftFrame, outline: 0.012 },
  'feast-roast': { colour: ART.biscuitFurDark, outline: 0.012 },
  'feast-loaf': { colour: ART.creamDark, outline: 0.012 },
  'feast-pie': { colour: ART.cream, outline: 0.012 },

  // --- the throne -----------------------------------------------------------
  'throne-frame': { colour: PALETTE.woodDark, outline: 0.022 },
  'throne-gold': { colour: PALETTE.liftFrame, outline: 0.018 },
  'throne-cushion': { colour: ART.castleTapestry, outline: 0.016 },

  // --- cloth on the walls ---------------------------------------------------
  'tapestry-cloth': { colour: ART.castleTapestry, outline: 0.016 },
  'tapestry-fringe': { colour: PALETTE.liftFrame, outline: 0.012 },
  'tapestryrail-pole': { colour: PALETTE.woodDark, outline: 0.014 },

  // --- the wall sconce ------------------------------------------------------
  // No outline on either: both are `castleIron`, and see {@link PartStyle}.
  'sconce-bracket': { colour: ART.castleIron },
  'sconce-cup': { colour: ART.castleIron },

  // --- the treasure chest ---------------------------------------------------
  'chest-body': { colour: PALETTE.woodDark, outline: 0.02 },
  'chest-lid': { colour: PALETTE.woodDark, outline: 0.02 },
  'chest-bands': { colour: PALETTE.liftFrame, outline: 0.014 },
};

function castlePart(name: string): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `castleAssets: '${name}' is not a node in castle.glb. The file has: ` +
        `${[...parts.keys()].sort().join(', ')}.`,
    );
  }
  return part;
}

/**
 * One dressed part, with its node transform carried across alongside its shape.
 *
 * The transform comes off the asset with the geometry, the way `hotelAssets.ts`
 * does it — a part's shape and where that shape sits are one decision made in
 * one place. `castle_export.py` permits a node to carry a **translation and
 * nothing else**, and exactly one node uses it: `chest-lid`, whose origin *is*
 * its hinge axis so that opening the chest is not a second formula tracking the
 * first one's geometry.
 */
function castleMesh(name: string): Mesh {
  const style = STYLES[name];
  if (!style) throw new Error(`castleAssets: no style for part '${name}'.`);
  const part = castlePart(name);
  const mesh = new Mesh(part.geometry, toonMaterial(style.colour, style.material ?? {}));
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  solid(mesh);
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/** A named group of dressed parts, keyed so a caller can pull one out. */
function assemble(key: string, names: readonly string[]): { root: Group; meshes: Map<string, Mesh> } {
  const root = new Group();
  root.name = key;
  const meshes = new Map<string, Mesh>();
  for (const name of names) {
    const mesh = castleMesh(name);
    meshes.set(name, mesh);
    root.add(mesh);
  }
  return { root, meshes };
}

/** Non-null lookup, so a factory's typed fields cannot be `undefined`. */
function required(meshes: Map<string, Mesh>, name: string): Mesh {
  const mesh = meshes.get(name);
  if (!mesh) throw new Error(`castleAssets: '${name}' was not assembled into this group.`);
  return mesh;
}

/**
 * The top of a built group, **outline included** — what a name label has to
 * clear, and what {@link AssetHandle.height} means everywhere else in the park.
 *
 * `check:assets`'s founding lesson, and §4.4's protocol in one function: a
 * height an author types is a claim, and a height read off the object is a
 * fact. But *which* fact matters — see {@link surfaceTop}.
 */
function measuredTop(root: Group): number {
  return visibleBounds(root).top;
}

/**
 * The top of a part's **bare geometry**, before it is dressed — the surface a
 * goblet actually stands on.
 *
 * ## Why this is not `measuredTop`, and how that was nearly a bug
 *
 * `addOutline` builds an inverted hull scaled outward by the outline's
 * thickness, and it is a real `Mesh` with real vertices, so {@link
 * visibleBounds} counts it. The table's top therefore measures **0.693 m**
 * dressed against **0.675 m** of actual table: the 18 mm is `table-top`'s own
 * outline, drawn *behind* the table and invisible from in front.
 *
 * Written the obvious way — `measuredTop` for everything — this file would have
 * published a `CASTLE_TABLE_TOP` of 0.693, stood fourteen feast props 18 mm in
 * the air, and disagreed with the Artist's published 0.675 by exactly the
 * amount that makes `check:castle` assertion 3 fail for a reason having nothing
 * to do with the table. It would have looked like a measurement. It *was* a
 * measurement — of the wrong quantity, which is this repo's most-repeated bug
 * wearing a lab coat.
 *
 * So the contract figures are measured off the geometry the Artist emitted, and
 * `AssetHandle.height` keeps the dressed figure, because a name label really
 * does have to clear the outline. Two questions, two numbers, neither pretending
 * to be the other.
 */
function surfaceTop(names: readonly string[]): number {
  let top = Number.NEGATIVE_INFINITY;
  for (const name of names) {
    const part = castlePart(name);
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    if (!box) throw new Error(`castleAssets: '${name}' has no geometry to measure.`);
    // The node's own translation, which `castle_export.py` permits and only
    // `chest-lid` uses. Carried so this cannot silently ignore a part that
    // grows one later.
    top = Math.max(top, box.max.y + part.position.y);
  }
  if (top === Number.NEGATIVE_INFINITY) {
    throw new Error('castleAssets: surfaceTop was asked to measure nothing.');
  }
  return top;
}

// ---------------------------------------------------------------------------
// The figures this side of the contract publishes, measured at load.
// ---------------------------------------------------------------------------

/**
 * **The banqueting table's top, in metres — measured, never typed.**
 *
 * 0.675 m. `HANDOFF-castle-interior-363.md` §4.4 makes this the Artist's number
 * "reported back", and the feast props stand on it, so it is the one figure
 * where a 3 cm disagreement leaves fourteen goblets floating.
 *
 * It is 0.675 rather than the 1.05 first built because 1.05 is one centimetre
 * *above* `KID_REACH_HEIGHT`: a banqueting table a child cannot reach the top
 * of. See this file's header.
 */
export const CASTLE_TABLE_TOP = surfaceTop(['table-top']);

/**
 * **The bench seat, in metres — measured, never typed.**
 *
 * 0.360 m, which is `KID_HIP_HEIGHT` exactly. The rig has no knee, so this is
 * the single seat height at which a sitting child's feet reach the floor; it is
 * exact rather than chosen, and anything else in this castle built to be sat on
 * inherits it rather than picking its own.
 */
export const CASTLE_BENCH_SEAT = surfaceTop(['bench-plank']);

/**
 * **Where a sconce's cup mouth sits, relative to the back plate on the wall** —
 * `out` away from the wall along the bracket's own +Z, `up` from the mount.
 *
 * Measured off the loaded geometry here, and **checked against
 * `castleLighting.ts`'s `CASTLE_TORCH_CUP`**, which is the owner. The direction
 * of that contract was deliberately reversed by #376: the Artist used to report
 * this figure for the Engineer to type "provisionally", it went stale within a
 * day, and the reconciliation log had to say out loud that the typed copy must
 * not be used. The flame is built in `castleLighting.ts`, so where the fire
 * sits is decided there and the sconce is authored to land on it.
 *
 * This constant therefore exists to be **compared**, not to be read as a source
 * of truth — `check:castle` asserts the two agree. If they ever disagree the
 * sconce has moved out from under its own flame.
 */
export const CASTLE_SCONCE_CUP: { readonly out: number; readonly up: number } = (() => {
  const cup = castlePart('sconce-cup');
  cup.geometry.computeBoundingBox();
  const box = cup.geometry.boundingBox;
  if (!box) throw new Error('castleAssets: sconce-cup has no geometry to measure.');
  // The mouth is the top of the cup, centred on its own Z span — the same two
  // quantities `castle_build.py` publishes, re-derived here off the emitted
  // vertices rather than copied from the handoff.
  return { out: (box.min.z + box.max.z) / 2, up: box.max.y };
})();

/**
 * **How high the throne's dais stands, in metres.**
 *
 * Mine, not the Artist's — they build a throne, I build the step it stands on —
 * and `art/blend/castle_build.py` reads this constant out of this file with
 * `ts_const`. It was one of exactly two numbers in the whole castle contract
 * that were hand-typed on the far side, with a comment saying so and asking for
 * this file to exist. It now does.
 *
 * **Must stay a plain `export const NAME = <number>;`** — see this file's
 * header. Deriving it silently returns the Python to a typed fallback.
 *
 * 0.30 m raises the throne without breaching the ceiling: the throne is 2.75 m,
 * so 3.05 m in total against `CASTLE_CEILING_CLEAR` 3.30 m. The Artist took the
 * round 2.75 rather than a 2.78 that would have left 2 mm, on the grounds that
 * "a 2 mm margin is a rounding error waiting for somebody to add a felt pad to
 * the dais" — which is this constant they were talking about.
 *
 * It is also a step a child climbs, so it obeys the same rule the seat does:
 * one dais height, below her hip, so getting onto the throne is a step up and
 * not a scramble.
 */
export const CASTLE_DAIS_HEIGHT = 0.3;

/**
 * **How high a tapestry's rail hangs, in metres.**
 *
 * The second of the two numbers described on {@link CASTLE_DAIS_HEIGHT}, and
 * read by `castle_build.py` the same way. I own it because I build the wall and
 * nothing on the asset side can measure it.
 *
 * **Must stay a plain `export const NAME = <number>;`.**
 *
 * 2.90 m is the Artist's hang point and the rail's centre — §4.4 requires them
 * to be the *same* number, since a cloth authored to hang from 2.90 on a rail
 * fixed at 2.85 leaves a five-centimetre gap of daylight along the top of every
 * tapestry in the castle. The cloth drops 2.40 m from here, so its hem ends at
 * 0.50 m, and the rail's own 0.07 m radius puts its top at 2.97 m — under
 * `BEAM_UNDERSIDE` (3.08 m), which is the ceiling that applies against a wall.
 */
export const CASTLE_TAPESTRY_RAIL_Y = 2.9;

/**
 * **How much floor a suit of armour is given**, as a radius about its own
 * origin.
 *
 * Measured about the **origin**, not about the footprint's centre, because a
 * placer's keep-out disc is centred on the origin and the armour is lopsided —
 * it rests a hand on a grounded sword. The half-diagonal of the footprint box
 * understates the origin-centred radius precisely when a shape is asymmetric,
 * which is the one freedom the asset's own origin check was relaxed to allow.
 */
export const CASTLE_ARMOUR_KEEP_OUT: number = (() => {
  let worst = 0;
  for (const name of ['armour-plate', 'armour-trim', 'armour-visor', 'armour-plume']) {
    const geometry = castlePart(name).geometry;
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      worst = Math.max(worst, Math.hypot(position.getX(i), position.getZ(i)));
    }
  }
  return worst;
})();

// ---------------------------------------------------------------------------
// The factories.
// ---------------------------------------------------------------------------

/**
 * A suit of armour: helm with a plume, breastplate, pauldrons, gauntlets,
 * greaves, one hand resting on a grounded sword. Faces +Z, visor forward.
 *
 * 2.60 m — half a metre over an ordinary child (2.12 m) and *shorter* than one
 * in a tall hat (2.97 m). Worth knowing, because it was called "towering" for a
 * fortnight while being judged against a reference post typed at 1.86 m.
 */
export function createCastleArmour(): AssetHandle {
  const { root } = assemble('castle.armour', [
    'armour-plate',
    'armour-trim',
    'armour-visor',
    'armour-plume',
  ]);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/** The chamfered stone block a suit of armour stands on. 0.25 m. */
export function createCastleArmourPlinth(): AssetHandle {
  const { root } = assemble('castle.plinth', ['plinth-block']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/**
 * The throne: a step broad at the shoulders with a spire above the sitter's
 * head. The sitter faces +Z.
 *
 * The seat is at `KID_HIP_HEIGHT`, like the benches — a throne a child cannot
 * climb onto is not the destination the brief asked for. The dais
 * ({@link CASTLE_DAIS_HEIGHT}) does the raising instead, and is itself a step
 * rather than a wall.
 */
export function createCastleThrone(): AssetHandle {
  const { root } = assemble('castle.throne', ['throne-frame', 'throne-cushion', 'throne-gold']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/**
 * Six metres of trestle table, top at {@link CASTLE_TABLE_TOP}. Long axis runs
 * along **+Z**, so `root.rotation.y` alone turns it down a hall.
 */
export function createCastleFeastTable(): AssetHandle {
  const { root } = assemble('castle.feastTable', ['table-legs', 'table-top']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/**
 * A plain heavy bench, 2.80 m long, seat at {@link CASTLE_BENCH_SEAT}. Long
 * axis along +Z, matching the table it flanks.
 */
export function createCastleBench(): AssetHandle {
  const { root } = assemble('castle.bench', ['bench-plank']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/** What is on the table. One node each, sized like buckets. */
export type FeastProp = 'goblet' | 'roast' | 'loaf' | 'pie';

export const FEAST_PROPS: readonly FeastProp[] = ['goblet', 'roast', 'loaf', 'pie'];

/**
 * One thing off the feast: a goblet, a roast, a round loaf, a pie.
 *
 * Origin at the base, so a caller stands one on the table with
 * `position.y = CASTLE_TABLE_TOP` and no fudge factor.
 */
export function createCastleFeastProp(kind: FeastProp): AssetHandle {
  const { root } = assemble(`castle.feast.${kind}`, [`feast-${kind}`]);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

export interface CastleChestHandle extends AssetHandle {
  /**
   * The lid, whose **own node origin is the hinge axis**. Opening the chest is
   * `lid.rotation.x` and nothing else — there is no offset formula tracking the
   * body's geometry, so there is nothing to fall out of step when either shape
   * changes.
   */
  readonly lid: Mesh;
}

/** A treasure chest: domed lid, iron bands, a big lock. Opens toward +Z. */
export function createCastleChest(): CastleChestHandle {
  const { root, meshes } = assemble('castle.chest', ['chest-body', 'chest-bands', 'chest-lid']);
  return {
    root,
    lid: required(meshes, 'chest-lid'),
    height: measuredTop(root),
    dispose: () => disposeTree(root),
  };
}

/**
 * A hanging tapestry: cloth with sag across the top, a wavy hem and a fringe.
 *
 * **Origin at the hang point**, with every vertex below y = 0 — the documented
 * balloon/disco-ball exception to origin-at-the-base (ART_DIRECTION §7). So a
 * caller sets `position.y = CASTLE_TAPESTRY_RAIL_Y` and the cloth hangs from
 * exactly the height the rail is fixed at, rather than from a height computed
 * out of the cloth's own drop.
 *
 * Its front face is on **+Z**, and it carries a UV map spanning that face,
 * authored off the same vertices as the shape. The heraldry is painted into
 * *that* UV rather than onto a second mesh in front of it — CLAUDE.md's
 * hood-face rule, which is in this repo because a floating appliqué that has to
 * be positioned by a formula is a second place for the formula to go wrong.
 */
export function createCastleTapestry(): AssetHandle {
  const { root } = assemble('castle.tapestry', ['tapestry-cloth', 'tapestry-fringe']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/**
 * The turned pole a tapestry hangs from, with finials — 3.60 m, deliberately
 * wider than the 3.20 m cloth. Origin on the pole's own axis, so it and the
 * cloth take the same `position.y`.
 */
export function createCastleTapestryRail(): AssetHandle {
  const { root } = assemble('castle.tapestryRail', ['tapestryrail-pole']);
  return { root, height: measuredTop(root), dispose: () => disposeTree(root) };
}

/**
 * The two nodes a wall sconce is made of, undressed — for a caller that wants
 * to merge them into one instanced mesh rather than take a `Group` per torch.
 *
 * There are ~40 sconces per storey. `castleLighting.ts` places them as a single
 * `InstancedMesh`, which is why this returns geometry rather than an
 * {@link AssetHandle}: forty `Group`s of two `Mesh`es each is eighty draw calls
 * for something a child reads as a row of little fires.
 *
 * The back plate is at z = 0 and the bracket projects to +Z, so an instance
 * matrix built from a wall anchor's yaw needs no offset of its own.
 */
export function castleSconceParts(): readonly GlbPart[] {
  return [castlePart('sconce-bracket'), castlePart('sconce-cup')];
}

/** The colour every part of a sconce takes. See {@link STYLES}. */
export const CASTLE_SCONCE_COLOUR = ART.castleIron;
