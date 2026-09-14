import { Vector3 } from 'three';
import { terrainHeight } from '../terrain';
import { Geo, PLANET_RADIUS } from './Geo';

const _dir = /* @__PURE__ */ new Vector3();

/**
 * **How far the ground is from the planet's centre, on this bearing.**
 *
 * The `Geo` form of `terrain.ts`'s `groundRadiusAt(x, z)`, and it differs from
 * it in one way that matters: it asks *"what ground is this direction pointing
 * at"* rather than *"what ground is directly below in world Y"*. On a flat park
 * those were the same question. They are not any more — step 6 m towards the
 * park's centre at the boundary and the terrain climbs nearly 6 m, so a column
 * lookup from a point 10 m up answers about ground it is nowhere near. That is
 * the arrival-camera bug in one sentence, and this signature makes it
 * unaskable: there is no column to look up, only a direction.
 *
 * **Exactly consistent with the drawn ground**, by construction rather than by
 * a comment promising it. It solves against `terrainHeight` itself rather than
 * re-deriving the wave field in a second frame, so it cannot drift from the
 * mesh a child stands on — which is this repo's commonest bug.
 *
 * ## The iteration, and the one that did not work
 *
 * The fixed point is *"the radius of the ground point in the column this
 * direction reaches at that radius"*, and it is **exact** at convergence: if
 * `r` is the radius of the ground point in column `(dx·r, dz·r)`, then that
 * point's own direction is necessarily this one, because `|d| = 1` forces
 * `h + R = r·dy` once the radii agree. So this is a solve, not an
 * approximation, and the only question is how fast it converges.
 *
 * It converges at about 0.07 per step, because between steps only the *wave*
 * field moves — the cap contributes exactly `R` in every direction, which is
 * what being a sphere means. Three steps take a 0.6 m starting error to a fifth
 * of a millimetre, and the control test measures that rather than trusting it.
 *
 * **The obvious iteration diverges, and it is worth writing down why**, because
 * it was written first and it was wrong by 0.16 m at the park's reach. Solving
 * `r = (terrainHeight + R) / dy` moves the *cap* between steps as well as the
 * waves, and the cap's own gradient is `tan θ` while the radius step scales by
 * `sin θ / cos θ` — so the contraction factor is `tan² θ`, which is exactly 1
 * at 45° of lean. The park reaches 45.5°. An iteration that is contractive
 * everywhere a test happens to sample and neutral exactly where the park ends
 * is the shape of a bug that ships.
 */
export function groundRadiusToward(direction: Readonly<Vector3>): number {
  let r = PLANET_RADIUS;
  for (let step = 0; step < 3; step += 1) {
    const x = direction.x * r;
    const z = direction.z * r;
    const h = terrainHeight(x, z) + PLANET_RADIUS;
    r = Math.hypot(x, h, z);
  }
  return r;
}

/** The same, from a position: the ground under (strictly, radially inward of) it. */
export function groundRadiusUnder(g: Readonly<Geo>): number {
  return groundRadiusToward(g.up(_dir));
}

/**
 * **How high this position is above the ground, measured from the planet's
 * centre.**
 *
 * Jim, 14 September 2026: *"EVERYWHERE that uses altitude now needs to use it
 * relative from the centre of the planet, not absolute, including cameras."*
 * This is that quantity in the `Geo` domain, and it is the one owner of it.
 *
 * Both terms are radii from the same centre, so the lean cancels exactly and
 * the answer is the clearance a child feels under her feet. At the park's
 * origin it is identical to the old `y - terrainHeight(x, z)` to the last
 * decimal, which is why converting a call site can never make a centre-of-park
 * measurement worse.
 */
export function altitude(g: Readonly<Geo>): number {
  return g.radius() - groundRadiusUnder(g);
}

/**
 * Put a position on the ground, keeping its bearing. The `Geo` form of
 * "stand this on the grass".
 */
export function dropToGround(g: Geo): Geo {
  return g.setRadius(groundRadiusUnder(g));
}

/**
 * Set a position's altitude above the ground, keeping its bearing — the inverse
 * of {@link altitude}, exact both ways because both are radii on one bearing.
 */
export function setAltitude(g: Geo, metres: number): Geo {
  return g.setRadius(groundRadiusUnder(g) + metres);
}

/**
 * The ground position on a given bearing. `direction` must be a unit vector;
 * it is a direction, so it is the same in world and planet-centred space.
 */
export function groundAt(direction: Readonly<Vector3>, target: Geo): Geo {
  const r = groundRadiusToward(direction);
  return target.set(direction.x * r, direction.y * r, direction.z * r);
}
