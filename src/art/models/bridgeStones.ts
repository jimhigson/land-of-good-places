import { Mesh, type BufferGeometry, type Material } from 'three';
import { BRIDGE_STONES_GLB_BASE64 } from '../assets/bridgeStonesGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { markShared } from '../style/materials';

/**
 * **The bridge's modelled stonework, and the single owner of its numbers.**
 *
 * Jim, 2026-08-29, on the humpback bridges over the railway: *"modelled
 * stoneworks (not just textures) around the tops of the walls, a genuine
 * arch-shaped tunnel with modelled archway masonry around its edge"*. The
 * coping was a two-triangle strip 6 cm over the parapet and the voussoir ring
 * was a canvas texture (`archStoneTexture`) painted on the soffit; neither
 * shows up in silhouette, which is the whole thing a six-year-old reads a
 * stone bridge by. `ART_DIRECTION.md`'s rule that a painted texture must still
 * read as *geometry* is the same point made from the other side.
 *
 * ## Why a kit of three stones, and not one bridge model
 *
 * A bridge here is not a fixed object. Its span, its two ramp lengths and its
 * crown height are solved per crossing (`bridgeFootprint.ts`), and the whole
 * thing follows the drawn path's own curve through `SpineFrame`. No single
 * rigid `.glb` can be that. So Blender authors the **repeating units** — one
 * coping block, one voussoir, one keystone — and `world/train/bridges.ts`
 * bakes many transformed copies of each authored geometry into one
 * `BufferGeometry` **per kind of stone** — so a bridge wearing sixty-odd stones
 * pays two draw calls (ring, coping) rather than sixty, keeps the authored
 * shape, and still follows the curve.
 *
 * Not *one* draw call per bridge: this header claimed that until peer review of
 * PR #360 counted five (`shell` ×2 material groups, `wallTop`, `archRing`,
 * `coping`), against three before. `bridges.ts`'s own note — "two draw calls
 * rather than sixty" — was the accurate one. A header that overstates its own
 * saving is how a budget gets believed instead of measured.
 *
 * Each stone is placed *individually* through the frame rather than as one
 * rigid ring, and each stands **proud** of the masonry face it decorates. Both
 * are deliberate: a rigid ring on a curving spine parts company with the swept
 * spandrel exactly the way the old `deckMesh` box did (Jim, 2026-08-24,
 * *"there's still a big hole in the mesh"*), and a stone that stands proud of
 * solid stone can be a few millimetres out without ever opening daylight.
 *
 * ## This module owns the numbers; Blender asks it
 *
 * `art/blend/bridge_stones_build.py` reads every constant below straight out
 * of this file with its `ts_const` regex — the same mechanism
 * `hotel_build.py` uses to read `kid.ts`. So there is one definition of "how
 * long is a coping block", not one here and one in the modelling script that
 * agree by comment (CLAUDE.md's "two definitions of one thing, kept in step by
 * hand"). Change a number here and re-run `npm run blend:bridge-stones`.
 *
 * Every value is metres, and the authored parts follow `ASSET_MANIFEST.md`'s
 * contract: 1 unit = 1 m, +Y up, +Z forward, `scale` 1, size baked in.
 */

/**
 * How long one coping block is along the wall it caps.
 *
 * Chunky on purpose. Jim, 2026-08-29: *"we are building a cartoonish game
 * here, not a real physics simulation"* — a real bridge's coping is laid in
 * stones half this size, and at the game's 45° camera they would vanish into a
 * texture, which is the thing being fixed.
 */
export const COPING_LENGTH = 0.86;

/** Gap left between two coping blocks, so the joint reads as a joint from
 * across the park rather than as one continuous kerb. Small enough that
 * nothing is ever seen *through* the run: the parapet stands solid behind it. */
export const COPING_JOINT = 0.05;

/**
 * How far the coping overhangs the parapet, each side. **Zero, and it is the
 * only value that can be.**
 *
 * An overhang is what makes a capped wall read as capped, and this shipped at
 * 0.11 m for exactly that reason. Peer review of PR #360 pointed out it broke
 * the rule this same branch cites for recessing the flank courses *inward* —
 * `halfAcross` is the width `bridgeFootprint.ts`'s search actually proved
 * clear, so nothing may stand outside it. The coping stood 0.11 m proud of it
 * along the bridge's whole length, over lawn where trees and lamps legitimately
 * stand, at 1.09–1.37 m up where a canopy is.
 *
 * The arithmetic leaves no room to negotiate. The coping must sit within the
 * band between the roadway and the cleared edge, which is exactly one
 * `BRIDGE_WALL_THICKNESS` wide:
 *
 * ```
 * inner edge >= roadHalf   and   outer edge <= halfAcross = roadHalf + 0.30
 *   => width <= 0.30 = BRIDGE_WALL_THICKNESS
 *   => overhang = 0
 * ```
 *
 * Any outward overhang leaves the cleared footprint; any inward one hangs over
 * the roadway at a walking child's shoulder height, which is the *other* half
 * of Jim's acceptance test (*"nothing clipping inside it"*). So the block is
 * exactly as wide as the wall it caps, and the capping read comes from
 * {@link COPING_TOP_INSET}'s weathering slope and the joints instead — which
 * is what the reviewer was already reading it by from the deck.
 *
 * The voussoir ring is deliberately **not** held to this, and stays proud —
 * see {@link VOUSSOIR_PROUD}.
 */
export const COPING_OVERHANG = 0;

/** Total height of a coping block. */
export const COPING_HEIGHT = 0.28;

/**
 * How far a coping block's base sits *below* the parapet top the shell
 * sweeps, so the whole run gains only `COPING_HEIGHT − COPING_SINK` over the
 * flat strip it replaces rather than a full block's worth. The parapet's own
 * collision top (`bridges.ts`'s `PARAPET_HEIGHT`) is unchanged, so nothing
 * about what a child can climb or fall over moves with this.
 */
export const COPING_SINK = 0.08;

/** How far the top face of a coping block is inset from its base, all round —
 * the weathering slope that sheds rain on a real coping, and the highlight
 * catch that makes it read as a solid block under a toon ramp here. */
export const COPING_TOP_INSET = 0.05;

/** Radial depth of one voussoir: inner (intrados) face to outer face. */
export const VOUSSOIR_DEPTH = 0.45;

/**
 * How far a voussoir stands proud of the spandrel face it rings.
 *
 * **This one is allowed outside `halfAcross`, and {@link COPING_OVERHANG} is
 * not, for a reason that is about the ground underneath rather than about the
 * stone.** A coping runs the bridge's whole length, most of it over open lawn
 * where the footprint search's clearance is the only thing keeping a tree or a
 * lamp out of it. The ring exists only at the two tunnel mouths, inside
 * `ARCH_SPAN_HALF` — and that span is chosen (see `bridges.ts`) so that *"the
 * masonry only ever stands on ground the fence already forbids to feet"*. The
 * 0.20 m it oversails is over the fenced rail corridor, where nothing is
 * planted and nobody walks.
 *
 * It also has to stand proud to be a ring at all: flush with the spandrel it
 * would be a painted stripe again, which is the thing being fixed.
 */
export const VOUSSOIR_PROUD = 0.2;

/** How far a voussoir is sunk into that face — never zero, so the ring can
 * never be seen to float off the wall on a curving spine. */
export const VOUSSOIR_SUNK = 0.15;

/**
 * Arc length of one voussoir along the intrados, joint included.
 *
 * The ring is laid at this pitch along the arch's *arc*, and the authored
 * stone is tapered for the tightest radius on the curve (the haunch), so on
 * the flatter crown arc adjacent stones overlap by ~1 cm at their outer edge
 * instead of gapping. Overlaps hide; gaps show — that asymmetry is why the
 * taper is biased rather than averaged.
 */
export const VOUSSOIR_PITCH = 0.42;

/** Gap between two voussoirs at the intrados. */
export const VOUSSOIR_JOINT = 0.05;

/** Arc length of the keystone at the crown — wider than a voussoir, because a
 * keystone is the one stone in an arch a child can name. */
export const KEYSTONE_PITCH = 0.8;

/** The keystone's radial depth. It stands proud of the ring's outer face by
 * `KEYSTONE_DEPTH − VOUSSOIR_DEPTH`, which is what makes it read as the
 * keystone rather than as a slightly wide voussoir. */
export const KEYSTONE_DEPTH = 0.95;

/** How far the keystone stands proud of the spandrel face. */
export const KEYSTONE_PROUD = 0.34;

/**
 * The taper radius the authored voussoir is cut for — see
 * {@link VOUSSOIR_PITCH}. This is the arch's haunch radius, the tightest part
 * of the three-centred curve `bridges.ts` builds; that module derives its own
 * `R2` from the arch's dimensions and this must be built to the same figure,
 * so `bridges.ts` asserts they agree at build time rather than leaving a
 * comment promising it.
 */
export const VOUSSOIR_TAPER_RADIUS = 1.746;

/** Every part name the authored kit contains. */
export type BridgeStonePart = 'coping' | 'voussoir' | 'keystone';

const parts: Map<string, GlbPart> = readGlbParts(
  base64ToArrayBuffer(BRIDGE_STONES_GLB_BASE64),
);

for (const part of parts.values()) markShared(part.geometry);

/** One authored stone, by name. Throws rather than returning a hole. */
export function bridgeStonePart(name: BridgeStonePart): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `bridgeStones: the asset has no part named '${name}'. Either the kit has grown ` +
        `and \`npm run blend:bridge-stones\` has not been re-run, or a node lost its ` +
        `name on the way through Blender.`,
    );
  }
  return part;
}

/** The authored geometry for one stone. Shared: never mutate it. */
export function bridgeStoneGeometry(name: BridgeStonePart): BufferGeometry {
  return bridgeStonePart(name).geometry;
}

/** Every part name the asset actually contains — for checks, not for the game. */
export function bridgeStonePartNames(): readonly string[] {
  return [...parts.keys()];
}

/** A mesh of one authored stone, at the asset's own local transform. Used by
 * the render/inspection scripts; the park itself bakes copies instead. */
export function bridgeStoneMesh(name: BridgeStonePart, material: Material): Mesh {
  const part = bridgeStonePart(name);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  return mesh;
}
