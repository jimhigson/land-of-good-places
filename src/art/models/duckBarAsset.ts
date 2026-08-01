import type { BufferGeometry } from 'three';
import { DUCKBAR_GLB_BASE64 } from '../assets/duckbarGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { markShared } from '../style/materials';
import type { DuckBarPart } from '../../world/railRace/track';

/**
 * The Rail Race duck bar's authored geometry, read once at module load.
 *
 * The **third** asset through the `.glb` pipeline (`ART-AGENT-NOTES.md` §6a,
 * proven on the kid, then the cart — see `HANDOFF-duck-bar-blender-asset.md`
 * for why this one needed it: "sizing is a Blender asset issue not a game
 * engine issue", Jim, 1 August 2026, after a numbers-only fix to the bar's
 * height still wasn't right).
 *
 * **Geometry only, unlike `cartAsset.ts`.** The cart's parts are each placed
 * once, by the asset's own node transform. The duck bar's two parts
 * (`post`, `bar`) are drawn through `InstancedMesh` — up to a hundred posts
 * and dozens of bars, one draw call each, at positions `track.ts` computes
 * fresh for every hazard on every build (now snapped onto a real trestle
 * support — see `hazards.ts`'s `snapToTrestleGrid`). A part's *shape* is all
 * this asset has to own; where each instance goes was never the asset's
 * question to answer, so there is no `duckBarAssetMesh` returning a
 * positioned `Mesh` the way `cartAssetMesh` does — only the geometry.
 *
 * Shared, same reasoning as `kidAsset.ts`/`cartAsset.ts`: one geometry per
 * part for the whole game, `markShared` so nothing frees it out from under
 * an `InstancedMesh` still pointing at it.
 */
const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(DUCKBAR_GLB_BASE64));

for (const part of parts.values()) markShared(part.geometry);

/** One authored part, by name. Throws rather than returning a hole. */
function duckBarAssetPart(name: DuckBarPart): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `duckBarAsset: the asset has no part named '${name}'. Either \`DUCKBAR_PARTS\` has ` +
        `grown and \`npm run blend:duckbar\` has not been re-run, or a node lost its name ` +
        `on the way through Blender.`,
    );
  }
  return part;
}

/** Every part name the asset actually contains — for checks, not for the game. */
export function duckBarAssetPartNames(): readonly string[] {
  return [...parts.keys()];
}

/** The authored geometry for one part. Shared: never mutate it. */
export function duckBarAssetGeometry(name: DuckBarPart): BufferGeometry {
  return duckBarAssetPart(name).geometry;
}
