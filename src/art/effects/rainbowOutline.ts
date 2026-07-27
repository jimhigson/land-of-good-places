import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
  type Object3D,
} from 'three';
import { ART } from '../style/artPalette';
import { hexToCss } from '../style/bridge';

/**
 * The rainbow interaction outline — the drawing half of GAME_DESIGN.md's
 * HIGHLIGHT RULE. See `world/highlight.ts` for the registry and
 * `world/Highlights.ts` for the system that drives it.
 *
 * It is the park's existing inverted-hull outline (ART_DIRECTION §2) wearing a
 * rainbow: the target's meshes are merged once into a single shell, every vertex
 * pushed along its own normal **in local metres**, and the result drawn
 * back-face-only. Where the object covers the shell the depth test hides it, so
 * what survives is an even rim around the silhouette — hand-painted, not a glow.
 *
 * Four decisions carry it:
 *
 *  - **Nothing is ever scaled.** The asset contract reserves `root.scale` for
 *    squash-and-stretch and `applyWalk` writes `body.scale` every frame, so a
 *    highlight built by scaling a copy would fight both. The push is baked into
 *    the shell's vertices, and the shell is a separate mesh holding a *copy* of
 *    the target's world matrix — it is never parented to the thing it outlines.
 *  - **One shell per target, built once and cached.** Merging happens the first
 *    time something is highlighted, not per frame, and only `castShadow` meshes
 *    are taken — which by the asset contract is exactly the solid silhouette,
 *    and neatly excludes decals, catchlights, strings and the ink outlines
 *    themselves (all `decal()`, i.e. `castShadow === false`).
 *  - **The sweep is a texture offset, not a shader.** ART_DIRECTION forbids
 *    per-effect shaders — one more thing to keep in step with the park's
 *    lighting. UVs are baked from position at build time, so animating the
 *    rainbow is `map.offset.x += …`: free, and identical for every shell,
 *    which is why they can all share one material.
 *  - **Pigment, not light.** Normal blending, `ART.rainbow` (already pulled
 *    towards cream), with a thin plum separator between bands. The separators
 *    are what let it read against the pale sand paths in daylight as well as
 *    against the dark lawn at night — a pure pastel rainbow disappears into a
 *    cream path, and a brighter one would look like a neon gamer glow, which is
 *    not what a park made of painted wooden toys wants.
 */

/** Metres of shell per metre of object radius, and the ends of the clamp. */
const THICKNESS_RATIO = 0.05;
const MIN_THICKNESS = 0.035;
const MAX_THICKNESS = 0.13;

/** Vertices one shell may merge before it stops taking more. Guards a silly target. */
const MAX_SHELL_VERTICES = 90_000;

/** Direction the rainbow bands run in, in the target's own space: up and a little sideways. */
const SWEEP_DIRECTION = new Vector3(0.45, 1, 0.25).normalize();

/** Rainbow repeats per metre of object. Around two visible bands on anything. */
const BANDS_PER_OBJECT = 2.2;

/** Texture offsets per second. Slow — "you can touch this", not "look at me". */
export const SWEEP_SPEED = 0.16;

let stripTexture: CanvasTexture | null = null;

/**
 * The rainbow strip: six `ART.rainbow` bands separated by thin plum lines.
 *
 * Drawn once and shared. The separators matter more than they look — see the
 * "pigment, not light" note above.
 */
export function rainbowStripTexture(): CanvasTexture {
  if (stripTexture) return stripTexture;

  const width = 384;
  const height = 4;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint the highlight rainbow.');

  const bands = ART.rainbow;
  // A soft gradient rather than hard steps: a stepped rainbow reads as a colour
  // chart, and this one is meant to look like it has been through a bit of sky.
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (let i = 0; i <= bands.length; i += 1) {
    gradient.addColorStop(i / bands.length, hexToCss(bands[i % bands.length] ?? 0xffffff));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = hexToCss(ART.ink);
  ctx.globalAlpha = 0.5;
  const separator = Math.max(2, Math.round(width / bands.length / 14));
  for (let i = 0; i < bands.length; i += 1) {
    ctx.fillRect(Math.round((i * width) / bands.length), 0, separator, height);
  }
  ctx.globalAlpha = 1;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  stripTexture = texture;
  return texture;
}

/**
 * The one material every rainbow shell shares.
 *
 * Shared on purpose: one material means one `map.offset` to animate, one set of
 * GPU state, and every highlight on screen sweeping in step — three of them
 * pulsing out of phase would look like a fault rather than a system.
 */
export function createRainbowOutlineMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: rainbowStripTexture(),
    side: BackSide,
    transparent: true,
    // Pigment, not light: normal blending. Additive blew out to a white halo
    // over the pale sand path when the hop ring tried it (ART_DIRECTION §5).
    depthWrite: false,
    opacity: 1,
  });
}

/** A shell that has been built for a target, plus what the renderer needs to place it. */
export interface HighlightShell {
  readonly geometry: BufferGeometry;
  /** Radius of the merged shell in the target's own space — used to size the outline. */
  readonly radius: number;
}

/**
 * Merges every solid mesh under `object` into one inverted-hull shell.
 *
 * Returns `null` when there is nothing solid to outline (an empty group, or a
 * target made entirely of decals) — the caller falls back to the ground ring.
 *
 * `thicknessScale` divides the pushed distance, for targets that will be drawn
 * through a scaling matrix (an `InstancedMesh` instance): the push happens in
 * geometry space, so a shell that will be scaled by 0.09 has to be pushed 1/0.09
 * further to come out the same width in metres on screen.
 */
export function buildHighlightShell(object: Object3D, thicknessScale = 1): HighlightShell | null {
  object.updateWorldMatrix(true, true);
  const toLocal = object.matrixWorld.clone().invert();

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const local = new Matrix4();
  const normalMatrix = new Matrix3();
  const vertex = new Vector3();
  const normal = new Vector3();

  const take = (mesh: Mesh): void => {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const meshNormal = geometry.getAttribute('normal');
    if (!position || !meshNormal) return;
    if (positions.length / 3 + position.count > MAX_SHELL_VERTICES) return;

    local.multiplyMatrices(toLocal, mesh.matrixWorld);
    normalMatrix.getNormalMatrix(local);
    const offset = positions.length / 3;

    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(local);
      normal.fromBufferAttribute(meshNormal, i).applyMatrix3(normalMatrix).normalize();
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
    }

    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(offset + index.getX(i));
    } else {
      for (let i = 0; i < position.count; i += 1) indices.push(offset + i);
    }
  };

  if (isInstanced(object)) {
    // One instance is being outlined, but the geometry is shared by all of them,
    // so the shell is built in geometry space and shared too.
    take(object as unknown as Mesh);
  } else {
    object.traverse((child) => {
      if (!isMesh(child) || !child.visible) return;
      // `castShadow` is the asset contract's own marker for "solid part of the
      // silhouette" (`solid()` vs `decal()`), which is exactly the filter this
      // wants — and it drops the ink outline meshes, which are back-side copies
      // that would otherwise double every line.
      if (!child.castShadow) return;
      take(child);
    });
  }

  if (positions.length === 0) return null;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const radius = geometry.boundingSphere?.radius ?? 1;
  const worldRadius = radius * thicknessScale;
  const thickness =
    Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, worldRadius * THICKNESS_RATIO)) /
    thicknessScale;

  const shellPosition = geometry.getAttribute('position') as BufferAttribute;
  const shellNormal = geometry.getAttribute('normal') as BufferAttribute;
  const period = Math.max(0.9, (worldRadius * 2) / BANDS_PER_OBJECT) / thicknessScale;
  const uv = new Float32Array(shellPosition.count * 2);

  for (let i = 0; i < shellPosition.count; i += 1) {
    const x = shellPosition.getX(i) + shellNormal.getX(i) * thickness;
    const y = shellPosition.getY(i) + shellNormal.getY(i) * thickness;
    const z = shellPosition.getZ(i) + shellNormal.getZ(i) * thickness;
    shellPosition.setXYZ(i, x, y, z);
    // Bands run along one fixed direction in the target's own space, spaced so
    // that roughly two of them cross it — sized here rather than by repeating
    // the texture, so every shell can share one material and one offset.
    uv[i * 2] = (x * SWEEP_DIRECTION.x + y * SWEEP_DIRECTION.y + z * SWEEP_DIRECTION.z) / period;
    uv[i * 2 + 1] = 0.5;
  }

  shellPosition.needsUpdate = true;
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.computeBoundingSphere();
  geometry.deleteAttribute('normal');

  return { geometry, radius };
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/** True for an `InstancedMesh`, without importing the class for a `instanceof`. */
export function isInstanced(object: Object3D): object is InstancedMesh {
  return (object as Partial<InstancedMesh>).isInstancedMesh === true;
}

/** Frees the shared strip. Only needed when tearing everything down. */
export function disposeRainbowStrip(): void {
  stripTexture?.dispose();
  stripTexture = null;
}
