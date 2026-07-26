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

/** A five-point star, for stickers, sparkles and the Cute-o-dex. */
export function starGeometry(size = 0.2, depth = 0.03, points = 5): BufferGeometry {
  const shape = new Shape();
  const outer = 1;
  const inner = 0.46;
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.8,
    bevelSize: 0.12,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.scale(size * 0.5, size * 0.5, 1);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}
