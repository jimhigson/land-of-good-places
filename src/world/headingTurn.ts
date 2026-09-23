import { Euler, type Quaternion } from 'three';

/**
 * **How a heading becomes a turn — yaw, then pitch in the yawed frame. The one
 * owner of that composition, for everything in the game that is pointed by a
 * yaw and a pitch.**
 *
 * `Quaternion.setFromEuler` reads the order off the euler it is handed and
 * ignores the object's own `rotation.order` entirely — the object's order only
 * governs reading a quaternion back out. So whichever euler builds the turn
 * decides the composition, and for a year there were two of them and they
 * disagreed:
 *
 * - `world/up.ts`'s `faceOnGround` (every rider posed by `Player.setRidePose`)
 *   used a default `XYZ` euler: pitch about **world** X, outermost. On a heading
 *   of 90° that pitch is a *roll*. `Building.ts` set `rotation.order = 'YXZ'`
 *   on the slide's rider at boarding, with a docblock explaining why it was
 *   load-bearing, and that line could never take effect through this path.
 * - `rail/sweptRail.ts`'s `rideFrame` (the Rail Race cart, the coaster cart,
 *   the train cars) used another default `XYZ` euler.
 *
 * #680 moved the first to `YXZ` and not the second, and the Rail Race — the one
 * ride that poses its rider through one and her tub through the other — came
 * apart: rider against cart up p50 2.55°, max 10.68° round the 593 m ring,
 * where they had agreed to 1.50°. The fix is not to pick the same letters twice
 * but to have one euler, here, that both ask.
 *
 * With `pitch` 0 the two orders are identical — one turn about Y — which is why
 * the parade, the NPCs, the pets, the bus and the train never showed it.
 * `check:rail-race` measures rider against cart and cart against the drawn
 * rails round the whole ring, so a second composition cannot come back quietly.
 */
export const HEADING_ORDER = 'YXZ';

const _heading = /* @__PURE__ */ new Euler(0, 0, 0, HEADING_ORDER);

/**
 * Write the turn for `yaw` (about up, `0` looking along `+Z`) and then `pitch`
 * (about the yawed `+X`, positive tipping the nose down) into `out`, from
 * scratch — nothing already in `out` is read, so it is safe every frame.
 */
export function headingTurn(yaw: number, pitch: number, out: Quaternion): Quaternion {
  return out.setFromEuler(_heading.set(pitch, yaw, 0));
}
