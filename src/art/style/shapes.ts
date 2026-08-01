import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three';

/**
 * Shared silhouettes. Anything that needs a real outline rather than a lump of
 * spheres lives here — and everything gets a bevel, because a hard extruded
 * edge is the fastest way to make a cute thing look like a cheap icon.
 */

/**
 * A plump heart, `size` metres across, centred on its own origin, facing +Z.
 * Used on Biscuit's jumper and by the heart particle burst.
 */
export function heartGeometry(size = 0.2, depth = 0.035): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, -1);
  shape.bezierCurveTo(-1.25, 0.15, -0.72, 1.05, 0, 0.42);
  shape.bezierCurveTo(0.72, 1.05, 1.25, 0.15, 0, -1);

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.9,
    bevelSize: 0.09,
    bevelSegments: 4,
    curveSegments: 26,
  });
  geometry.scale(size * 0.5, size * 0.5, 1);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A five-point star, for stickers, sparkles and the Cute-o-dex.
 *
 * `pointRadius` and `rotation` both default to `0`, so every existing caller
 * (the crown's jewel, the balloon badge, sparkles, the rainbow-outline ring,
 * the shop star, the shoe star) is completely unaffected by either — sharp
 * points, one point down, exactly as before. Both were added for the star
 * glasses lens (`glasses.ts`), which is the only caller that passes non-zero
 * values for either; see that file for why.
 *
 * @param pointRadius How far back from each outer (spike) tip to round it
 *   off, in the same pre-`size`-scale units as `outer`/`inner` below (so
 *   `0.16` rounds a visible chunk of a ~0.68-unit-long spike edge without
 *   turning it into a blob). `0` (the default) leaves every tip a sharp
 *   corner, the original look. Only the outer, convex tips round — the inner
 *   concave notches between them are untouched, so the shape still reads
 *   unambiguously as a star, just a friendlier one, per ART_DIRECTION.md's
 *   general "soft, cel-shaded, nothing sharp" house style.
 * @param rotation Extra angle, in radians, added to every vertex — `0` (the
 *   default) keeps the original "one point straight down" layout. `Math.PI`
 *   flips it to the conventional "one point straight up" a five-point star
 *   is normally drawn at.
 */
export function starGeometry(
  size = 0.2,
  depth = 0.03,
  points = 5,
  pointRadius = 0,
  rotation = 0,
): BufferGeometry {
  const shape = new Shape();
  const outer = 1;
  const inner = 0.46;
  const vertexCount = points * 2;
  const vertices = Array.from({ length: vertexCount }, (_, i) => {
    const angle = (i / vertexCount) * Math.PI * 2 - Math.PI / 2 + rotation;
    const r = i % 2 === 0 ? outer : inner;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, isTip: i % 2 === 0 };
  });

  for (let i = 0; i < vertexCount; i += 1) {
    const point = vertices[i]!;
    if (pointRadius > 0 && point.isTip) {
      // Round this tip by stopping short of it on the way in and curving
      // back out to the next vertex, using the sharp corner itself as the
      // quadratic's control point — the standard "fillet a polygon corner"
      // trick. Only tips (the outer, convex vertices) take this path; the
      // concave notches between them are left as sharp `lineTo`s.
      const prev = vertices[(i - 1 + vertexCount) % vertexCount]!;
      const next = vertices[(i + 1) % vertexCount]!;
      const towardPrev = normalizeTo(point, prev, pointRadius);
      const towardNext = normalizeTo(point, next, pointRadius);
      if (i === 0) shape.moveTo(towardPrev.x, towardPrev.y);
      else shape.lineTo(towardPrev.x, towardPrev.y);
      shape.quadraticCurveTo(point.x, point.y, towardNext.x, towardNext.y);
    } else if (i === 0) {
      shape.moveTo(point.x, point.y);
    } else {
      shape.lineTo(point.x, point.y);
    }
  }
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.8,
    bevelSize: 0.12,
    bevelSegments: 3,
    // The rounded-tip curves need more subdivision than a plain straight-
    // edged star to look smooth rather than faceted; unrounded stars (every
    // existing caller) keep the original, cheaper 4.
    curveSegments: pointRadius > 0 ? 10 : 4,
  });
  geometry.scale(size * 0.5, size * 0.5, 1);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/** A point `distance` from `from`, along the straight line toward `to`. */
function normalizeTo(
  from: { x: number; y: number },
  to: { x: number; y: number },
  distance: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}
