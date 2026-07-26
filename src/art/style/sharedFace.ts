import { Mesh, type BufferGeometry, type CanvasTexture } from 'three';
import { decal, toonMaterial } from './materials';
import {
  facePatchGeometry,
  paintExpressions,
  type Expression,
  type FacePatch,
  type FacePatchOptions,
} from './faces';

/**
 * A face patch whose canvas textures are painted once and shared by every copy.
 *
 * {@link createFacePatch} paints a fresh set of five expressions per call, which
 * is exactly right for a hero character and exactly wrong for a shop full of
 * identical shopkeepers: seven of them would be thirty-five 256² canvases on
 * their own, and the whole game is budgeted at forty
 * (ASSET_MANIFEST.md, "texture budget").
 *
 * Anything that appears more than once or twice with the same face should paint
 * through here and pass a stable `key`. Materials are still one per instance —
 * only the textures and the patch geometry are shared — so the floor fader can
 * go on claiming and cloning materials per storey without one shopkeeper's fade
 * bleeding into another's.
 */
interface CachedFace {
  readonly expressions: Record<Expression, CanvasTexture>;
  readonly geometry: BufferGeometry;
}

const cache = new Map<string, CachedFace>();

export function sharedFacePatch(key: string, options: FacePatchOptions): FacePatch {
  const { radius, spreadX = 1.7, spreadY = 1.7, tilt = 0.1, ...paint } = options;

  let entry = cache.get(key);
  if (!entry) {
    entry = {
      expressions: paintExpressions(paint),
      geometry: facePatchGeometry(radius * 1.012, spreadX, spreadY, tilt),
    };
    cache.set(key, entry);
  }

  const expressions = entry.expressions;
  const material = toonMaterial(0xffffff, { map: expressions.neutral, transparent: true });
  material.alphaTest = 0.02;
  const mesh = decal(new Mesh(entry.geometry, material));
  mesh.name = 'facePatch';
  mesh.renderOrder = 2;

  return {
    mesh,
    expressions,
    setExpression(name: Expression) {
      material.map = expressions[name];
      material.needsUpdate = true;
    },
  };
}

/** Frees every shared face. Only needed when tearing the whole game down. */
export function disposeSharedFaces(): void {
  for (const entry of cache.values()) {
    entry.geometry.dispose();
    for (const texture of Object.values(entry.expressions)) texture.dispose();
  }
  cache.clear();
}
