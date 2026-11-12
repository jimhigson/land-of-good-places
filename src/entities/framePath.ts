import { DASH_MAX_STRIDES } from './tapDash';

/**
 * **The path she took this frame, as the strides she actually ran.**
 *
 * An ordinary frame is one step, and the straight line from
 * `Player.previousPosition` to `Player.position` *is* the path. A tapped dash
 * (`entities/tapDash.ts`) cuts a frame into up to {@link DASH_MAX_STRIDES}
 * strides that follow the route round its corners, and a straight chord from
 * the frame's start to its end — up to 7 m on a slow frame — could cut a corner
 * through a doorway she never entered (#745's review). So `FrameStrides` writes
 * each stride's end here, and `tapSpacing.ts`'s `bandWalkedThrough` asks a
 * doorway of the segments.
 *
 * `count` points live in `xz` as `x, z` pairs, the first being where the frame
 * started. `count` 0 means "no strides this frame": the chord is the path.
 */
export interface FramePath {
  count: number;
  readonly xz: Float64Array;
}

/** Room for the frame's start and one point per stride, allocated once. */
export const FRAME_PATH_POINTS = DASH_MAX_STRIDES + 1;

export function createFramePath(): FramePath {
  return { count: 0, xz: new Float64Array(FRAME_PATH_POINTS * 2) };
}

/** Appends a point, if there is room. A full path keeps its last point current. */
export function extendFramePath(path: FramePath, x: number, z: number): void {
  const index = Math.min(path.count, FRAME_PATH_POINTS - 1);
  path.xz[index * 2] = x;
  path.xz[index * 2 + 1] = z;
  path.count = index + 1;
}
