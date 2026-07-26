import { Euler, type Object3D, Quaternion, Vector3 } from 'three';

/**
 * The tap-to-read registry, for the "inspect" camera.
 *
 * Signs are built deep inside nested, rotated groups — a shop unit inside a
 * deck inside the building inside an anchor plot — and re-deriving that chain
 * of transforms by hand at each call site is exactly the kind of thing that
 * drifts out of sync with the geometry. So rather than threading a registry
 * through every builder, a sign only has to call {@link markAsSign} on its own
 * mesh; {@link collectSignZones} then reads the *assembled* scene graph back,
 * which cannot disagree with what is actually on screen.
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
  /** How close (in XZ metres) a tapped point must land to count as this sign. */
  readonly pickRadius: number;
}

/** Marks a mesh as an in-world, tap-to-read sign. Call once, right after building it. */
export function markAsSign(mesh: Object3D, width: number, height: number): void {
  mesh.userData.isSign = true;
  mesh.userData.signWidth = width;
  mesh.userData.signHeight = height;
}

/** A little clearance beyond the board itself, so a tap near its edge still counts. */
const PICK_MARGIN = 1.1;

/**
 * Walks a fully-built subtree collecting every {@link markAsSign}'d mesh into a
 * flat list of {@link SignZone}s, in world space. Cheap enough to call fresh
 * whenever it is needed (see `interact.ts` for the same call — rebuilt rather
 * than cached, because nothing here is expected to move).
 */
export function collectSignZones(root: Object3D): SignZone[] {
  root.updateMatrixWorld(true);

  const zones: SignZone[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const euler = new Euler();
  let index = 0;

  root.traverse((child) => {
    if (!child.userData.isSign) return;
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
      pickRadius: Math.max(width, height) * 0.85 + PICK_MARGIN,
    });
    index += 1;
  });

  return zones;
}

/**
 * The sign whose centre is nearest the tapped point, or `null` if the tap
 * landed too far from any of them. Nearest-centre rather than first-match, for
 * the same reason `pickInteractZone` is: two signs can plausibly overlap.
 */
export function pickSignZone(zones: readonly SignZone[], x: number, z: number): SignZone | null {
  let best: SignZone | null = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    const distance = Math.hypot(x - zone.x, z - zone.z);
    if (distance > zone.pickRadius || distance >= bestDistance) continue;
    best = zone;
    bestDistance = distance;
  }
  return best;
}
