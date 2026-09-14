import { Vector3 } from 'three';
import { Geo } from '../../world/geo';
import { upFor } from '../../world/up';

/**
 * **How a mover leaves the ground, and how she comes back to it — one owner,
 * for the player, every NPC, and `scripts/playerSim.mts`.**
 *
 * There were three copies of this arithmetic. `Player.update`,
 * `NpcCharacter.update` and `SimPlayer.step` each integrated their own gravity,
 * and `playerSim.mts`'s docblock says outright that it is a copy — which is
 * this repo's commonest bug wearing a label. Three copies means three chances
 * to get the sphere wrong, and `playerSim.mts` is the one three chain checks
 * measure, so the copy that drifts is the one nothing is watching.
 *
 * ## The two things a sphere changes about a jump
 *
 * On a flat park a hop is `position.y += verticalVelocity * dt`, and both of the
 * quantities in it mean what they say. On a ball neither does.
 *
 * 1. **Her height above the ground is not a `y` difference.** At the park's
 *    reach the ground leans 45.5 degrees, so a metre of world `+Y` between her
 *    feet and the grass is `cos θ` = 0.70 m of the height a child would feel.
 *    Run the jump in `y` and the apex shrinks with every metre she walks
 *    outward: measured, **1.2267 m at the origin and 0.8616 m at the rim**,
 *    30 % of her hop quietly spent on being far from the middle of the park.
 *    {@link altitudeAbove} is the honest quantity and it is a difference of two
 *    radii from the planet's centre, so the sphere's own fall cancels exactly.
 *
 * 2. **A jump is not vertical. It is radial, and the two are the same thing
 *    only at the park's origin.** She pushes off along the ground's own up,
 *    which out in the park leans outwards — so the hop carries her `apex ·
 *    sin θ` **across** the ground and brings her back, up to **0.875 m at the
 *    rim**. Move her in `y` alone and she has instead lurched that far towards
 *    the middle of the park in her own frame, every single hop.
 *    {@link liftAlongUp} is that displacement, as a real 3-vector.
 *
 * ## Why this is an impulse integrated into a position, and never a position
 * ## re-derived from an altitude
 *
 * The obvious way to make a hop radial is `position = foot + up * altitude`,
 * recomputed each frame. **It was tried, on `eng/radial-collide`, and it is a
 * runaway.** It makes lateral position a function of altitude, so the instant a
 * surface drops away under her the altitude jumps, which teleports her
 * sideways, which takes her further off the surface, which raises the altitude
 * again. `check:deck-fallthrough` went from green to **401 of 1280 runs losing
 * the surface at gradient 0.1**, with gaps reaching 50 m.
 *
 * So the lift here is a **displacement added to a position**, exactly as the
 * walk is. Altitude is only ever *read* — for fall detection, for the jet
 * pack's ceiling, for the clearance handed to `CollisionWorld` — and never
 * written back as a position. That makes the runaway structurally impossible
 * rather than merely absent: there is no path from altitude to `x` or `z`.
 *
 * It also lands exactly, which the re-derivation never could. A displacement
 * along the local up leaves her *bearing* from the planet's centre unchanged,
 * so the ground beneath her is the same ground the whole way up and down, and
 * the integral of a symmetric velocity brings her back to the column she left.
 * `check:radial-hop`'s drift clause is what holds that.
 *
 * ## Indoors
 *
 * Interiors are not a mode, they are real coordinates hundreds of metres from
 * the park's origin, where `upAt` leans 56 degrees — applied blind, the first
 * thing a child sees walking into the hotel is the lobby on its side. Both
 * functions here go through {@link upFor}, which asks `spaceAt` and hands back
 * plain `+Y` in any room. Indoors both collapse to exactly the flat arithmetic
 * they replace, to the last decimal, which is why converting an interior call
 * site can never change an answer.
 */

const _up = /* @__PURE__ */ new Vector3();
const _geo = /* @__PURE__ */ new Geo();

/**
 * **How high she is above the surface under her**, in the metres a child would
 * feel — never a `y` difference.
 *
 * Outdoors this is the difference of two radii from the planet's centre: her
 * own, and that of the ground in her column. Both are measured from the same
 * point, so the planet cancels exactly and what is left is clearance. Indoors
 * it is `y - groundY`, because indoors that *is* the clearance.
 *
 * `groundY` is the world height of the surface she is standing on or falling
 * towards — whatever her own sampler said, terrain or deck or castle floor —
 * taken in her own column, which is where every sampler in this codebase
 * answers.
 *
 * At the park's origin the two forms agree to the last decimal. That is not a
 * coincidence to be grateful for, it is the control: `check:radial-hop` reads
 * every number it asserts against the origin's, and if the origin ever
 * disagrees with the flat answer the instrument is broken rather than the game.
 */
export function altitudeAbove(x: number, y: number, z: number, groundY: number): number {
  // The space-aware branch, decided once. `upFor` is the only thing in the
  // codebase that owns indoor-versus-outdoor up, and asking it here rather than
  // testing `spaceAt` again is what stops this becoming a second definition.
  upFor(x, y, z, _up);
  // Indoors `up` is exactly `+Y` and the radius form would be nonsense — a room
  // 600 m from the origin has a radius of 600 m and a ceiling 3 m above a floor
  // differs from it by nothing like 3.
  if (_up.x === 0 && _up.z === 0) return y - groundY;
  const r = _geo.setFromWorld(x, y, z).radius();
  const groundRadius = _geo.setFromWorld(x, groundY, z).radius();
  return r - groundRadius;
}

/**
 * **One frame's travel along the local up, as a real displacement** — the whole
 * of the hop, not just its vertical shadow.
 *
 * `metres` is signed: her speed along the up times `dt`, positive rising. The
 * result's `y` is what the flat code used to add to `position.y` directly, and
 * its `x`/`z` are the half that was missing — the sideways excursion a jump on
 * a ball genuinely makes.
 *
 * **Those `x`/`z` are chart metres already and must not be scaled by anything.**
 * The chart in this game is the orthographic projection: a point's chart
 * coordinates *are* its world `x` and `z`. So the chart delta of any
 * displacement is simply that displacement's `x` and `z` components. The
 * `cos θ` factor that walking needs comes from motion being constrained to the
 * *surface*, where a real distance is an arc and the chart flattens it; a hop
 * is not on the surface and has no arc. Dividing this by `cos θ` would
 * over-throw her by 41 % at the rim and she would not land where she took off.
 *
 * Hand the `x`/`z` to `CollisionWorld.resolveMovement` alongside the walk step
 * rather than writing them onto the position directly. At `MAX_FRAME_DELTA` the
 * lift is under 0.07 m, far inside the anti-tunnelling budget, so it costs no
 * extra sub-steps — but going through `resolveMovement` is what keeps the
 * sub-step guarantee true of *everything* that moves her, and it is also what
 * keeps the ground sample riding the move (#358).
 */
export function liftAlongUp(
  x: number,
  y: number,
  z: number,
  metres: number,
  target: Vector3,
): Vector3 {
  upFor(x, y, z, target);
  return target.multiplyScalar(metres);
}

/**
 * **The sideways half of putting her back on the ground she just overshot.**
 *
 * The last part-frame of a fall always carries a mover a little under the
 * surface, and every integrator in this game answers that by clamping her
 * height to the ground. On a flat park that clamp is a change of `y` and
 * nothing else. On a ball it is not: she overshot *along the local up*, which
 * leans, so the overshoot had `x` and `z` in it — and a clamp that changes only
 * `y` keeps that sideways part instead of giving it back.
 *
 * It is small, and it is one-way, which is the bad combination. Measured on the
 * canonical park with the hop's lift in and this correction out: **0.0319 m of
 * outward drift per hop at the rim**, growing linearly with radius, on a hop
 * that used to land exactly where it took off. Thirty hops on the spot and a
 * child has slid a metre towards the boundary.
 *
 * ## The quantity, and how the wrong one was caught
 *
 * The overshoot is `-altitude`: the perpendicular distance from her to the
 * surface, which is what {@link altitudeAbove} already measures. So the
 * sideways half is `up.xz · -altitude`, and passing the altitude in rather than
 * re-deriving it from `groundY - y` is the point — the two are the *same*
 * quantity and this file is not going to hold two definitions of it.
 *
 * The first version of this function did re-derive it, as
 * `up.xz · (groundY - y) / up.y`, and that is **2.04x too large at the rim**:
 * `(groundY - y)` is a `y` difference, and turning it into a distance along the
 * up is a *multiply* by `cos θ`, not a divide. Swept empirically over the
 * exponent rather than argued, because that is the mistake this whole branch
 * exists to stop making, and the settled drift at 0, 40, 80, 120 and 157 m read:
 *
 * ```
 * up.xz · dy / up.y   0.0000  0.0003  0.0025  0.0100  0.0335   <- shipped first
 * up.xz · dy          0.0000  0.0002  0.0012  0.0044  0.0139
 * up.xz · dy · up.y   0.0000  0.0000  0.0000 -0.0003  0.0002   <- this one
 * up.xz · dy · up.y^2 0.0000 -0.0001 -0.0011 -0.0042 -0.0094
 * ```
 *
 * The middle column bracketing zero from both sides is what makes that a
 * measurement rather than a coincidence.
 *
 * ## Why it is returned rather than applied
 *
 * The caller still writes `position.y = groundY` itself, because that is the
 * height it wants and it is exact. This hands back only the `x`/`z`, for the
 * caller to fold into the **next** frame's collision step. Writing it straight
 * onto the position would be the one thing `CollisionWorld.resolveMovement`
 * exists to prevent: a lateral move that skips the sub-step decomposition.
 *
 * `y` is 0 in the result, always: the vertical half is the caller's clamp, and
 * returning it here as well would double it.
 *
 * At the park's origin — and anywhere indoors — `up` is exactly `+Y`, this
 * returns a zero vector, and the landing is the flat clamp it has always been.
 * That is the control, and `check:radial-hop` reads every number against it.
 */
export function landingCorrection(
  x: number,
  y: number,
  z: number,
  altitude: number,
  target: Vector3,
): Vector3 {
  upFor(x, y, z, _up);
  return target.set(-_up.x * altitude, 0, -_up.z * altitude);
}
