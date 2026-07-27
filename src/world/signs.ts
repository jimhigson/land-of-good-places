import { CanvasTexture, Euler, type Material, type Object3D, Quaternion, Vector3 } from 'three';
import { angleDelta, DEG } from '../core/mathUtils';

/**
 * The "Read a sign" registry.
 *
 * Signs are built deep inside nested, rotated groups — a shop unit inside a
 * deck inside the building inside an anchor plot — and re-deriving that chain
 * of transforms by hand at each call site is exactly the kind of thing that
 * drifts out of sync with the geometry. So rather than threading a registry
 * through every builder, a sign only has to call {@link markAsSign} on its own
 * mesh; {@link collectSignZones} then reads the *assembled* scene graph back,
 * which cannot disagree with what is actually on screen.
 *
 * Reading is proximity-based (see `ui/SignReader.ts`): stand close to a sign
 * and face it, and a "Read" button appears. There is no tap-to-inspect path —
 * that used to swoop the camera in, which fired by accident and read as a
 * jarring zoom (family complaint, 26 Jul 2026); a full-screen overlay with no
 * camera move replaced it.
 */
export interface SignZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing yaw in radians — 0 looks down +Z, same convention as every prop. */
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
  /** The sign's own painted face, straight off its mesh's texture — see {@link findSignCanvas}. */
  readonly canvas: HTMLCanvasElement;
}

/** Marks a mesh as an in-world, readable sign. Call once, right after building it. */
export function markAsSign(mesh: Object3D, width: number, height: number): void {
  mesh.userData.isSign = true;
  mesh.userData.signWidth = width;
  mesh.userData.signHeight = height;
}

/**
 * Walks a fully-built subtree collecting every {@link markAsSign}'d mesh into a
 * flat list of {@link SignZone}s, in world space. Cheap enough to call fresh
 * whenever it is needed; callers that poll every frame (the read-button gate)
 * should cache the result themselves — nothing here is expected to move once
 * the world has finished building.
 *
 * A marked mesh whose effective visibility is `false` (itself or any ancestor —
 * see {@link isEffectivelyVisible}) is skipped: several anchors and shop units
 * keep their "coming soon" placeholder, sign and all, parented in the scene
 * after the real thing moves in, just hidden (`setPlaceholderVisible`). Without
 * this check a retired sign nobody can see would still offer a Read button.
 */
export function collectSignZones(root: Object3D): SignZone[] {
  root.updateMatrixWorld(true);

  const zones: SignZone[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  let index = 0;

  root.traverse((child) => {
    if (!child.userData.isSign || !isEffectivelyVisible(child)) return;
    const canvas = findSignCanvas(child);
    // No painted face to show full-screen — nothing to offer a Read button for.
    if (!canvas) return;

    child.getWorldPosition(position);
    child.getWorldQuaternion(quaternion);
    euler.setFromQuaternion(quaternion, 'YXZ');

    const width = (child.userData.signWidth as number | undefined) ?? 2;
    const height = (child.userData.signHeight as number | undefined) ?? 1.2;

    zones.push({
      id: `sign-${index}`,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: euler.y,
      width,
      height,
      canvas,
    });
    index += 1;
  });

  return zones;
}

/** How close (in XZ metres) the player must stand to a sign to be offered a Read button. */
export const SIGN_READ_DISTANCE = 3;

/** How far off dead-on (in degrees) the player may be facing and still be offered one. */
export const SIGN_READ_ANGLE_DEGREES = 70;

const SIGN_READ_ANGLE = SIGN_READ_ANGLE_DEGREES * DEG;

/**
 * The nearest sign the player is both close enough to and facing — the gate
 * behind the "Read" button (see `ui/SignReader.ts`), or `null` if nothing
 * qualifies. Two checks, both in the same yaw convention as every prop:
 *
 * 1. **Close**: within {@link SIGN_READ_DISTANCE} metres in the XZ plane.
 * 2. **Facing**: the bearing from the player to the sign is within
 *    {@link SIGN_READ_ANGLE_DEGREES} of the player's own facing, AND the
 *    player is standing on the side the board's painted face looks towards
 *    (within a lenient 90°) — otherwise this would happily offer to read the
 *    blank back of the board.
 */
export function nearestReadableSign(
  zones: readonly SignZone[],
  playerX: number,
  playerZ: number,
  playerYaw: number,
): SignZone | null {
  let best: SignZone | null = null;
  let bestDistance = Infinity;

  for (const zone of zones) {
    const dx = zone.x - playerX;
    const dz = zone.z - playerZ;
    const distance = Math.hypot(dx, dz);
    if (distance > SIGN_READ_DISTANCE || distance >= bestDistance) continue;

    const bearingToSign = Math.atan2(dx, dz);
    if (Math.abs(angleDelta(playerYaw, bearingToSign)) > SIGN_READ_ANGLE) continue;

    const bearingFromSign = Math.atan2(-dx, -dz);
    if (Math.abs(angleDelta(zone.yaw, bearingFromSign)) > Math.PI / 2) continue;

    best = zone;
    bestDistance = distance;
  }

  return best;
}

/** `false` if this object or any ancestor has been hidden (see {@link collectSignZones}). */
function isEffectivelyVisible(object: Object3D): boolean {
  let node: Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * The canvas behind a marked mesh's painted face, wherever it actually lives.
 *
 * `cuteSign()` (the common case) puts the texture straight on the marked mesh.
 * The hand-built anchor-plot sign instead paints a separate child plane over a
 * plain wooden backing board — so a marked mesh with no map of its own gets one
 * more look, one level into its children, before giving up.
 */
function findSignCanvas(mesh: Object3D): HTMLCanvasElement | null {
  return canvasOf(mesh) ?? mesh.children.map(canvasOf).find((found) => found !== null) ?? null;
}

function canvasOf(object: Object3D): HTMLCanvasElement | null {
  const material = (object as { material?: Material | Material[] }).material;
  if (!material) return null;
  const single = Array.isArray(material) ? material[0] : material;
  const map = (single as { map?: unknown } | undefined)?.map;
  return map instanceof CanvasTexture ? (map.image as HTMLCanvasElement) : null;
}
