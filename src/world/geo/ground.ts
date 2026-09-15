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
 * **The world `y` at a plan column that stands `metres` above the ground** —
 * the inverse of {@link altitude} taken in a *column* rather than on a bearing.
 *
 * This is deliberately the one function in this file that speaks the old
 * orthographic `(x, z)` chart, and it is here rather than hidden in a
 * subsystem because it is the translation every unconverted consumer needs and
 * it must have exactly one owner. Everything that asks a walk surface, a
 * collider top or a mesh vertex "how high?" still asks in a world column, so a
 * subsystem that has learned to think in altitudes has to hand its answer back
 * in that form. Writing that conversion privately is how a park ends up with
 * six of them.
 *
 * **It is not the same as `terrainHeight(x, z) + metres`, and the difference is
 * the whole subject.** Stepping up the world `y` axis by `δ` at a point leaning
 * `θ` from vertical gains only `δ·cos θ` of altitude, so a deck built by adding
 * metres to `terrainHeight` stands lower than it meant to — by 47 % at the
 * park's own reach — and, worse, its height above the ground then varies with
 * the lean rather than staying what it was asked for.
 *
 * ## The solve
 *
 * The fixed point is *"the `y` in this column whose radius is `metres` past the
 * ground radius on its own bearing"*, and like {@link groundRadiusToward} it is
 * exact at convergence rather than an approximation: `x` and `z` are held, so
 * once the bearing stops moving the radius pins `y` outright. It inherits that
 * function's ~0.07 contraction, and it is seeded with the flat-park answer,
 * which is exact at the park's origin — so a centre-of-park call is right on
 * the first iteration and can never be made worse by converting to this.
 *
 * Returns the seed unchanged for a column that no sphere of that radius
 * reaches (`|x, z|` past the planet). That is not reachable ground; it must not
 * be a `NaN` propagating into a vertex buffer.
 */
export function worldYAtAltitude(x: number, z: number, metres: number): number {
  let y = terrainHeight(x, z) + metres;
  for (let step = 0; step < 3; step += 1) {
    const cy = y + PLANET_RADIUS;
    const len = Math.hypot(x, cy, z);
    if (len === 0) return y;
    _dir.set(x / len, cy / len, z / len);
    const wanted = groundRadiusToward(_dir) + metres;
    const above = wanted * wanted - x * x - z * z;
    if (above <= 0) return terrainHeight(x, z) + metres;
    y = Math.sqrt(above) - PLANET_RADIUS;
  }
  return y;
}

/**
 * The ground position on a given bearing. `direction` must be a unit vector;
 * it is a direction, so it is the same in world and planet-centred space.
 */
export function groundAt(direction: Readonly<Vector3>, target: Geo): Geo {
  const r = groundRadiusToward(direction);
  return target.set(direction.x * r, direction.y * r, direction.z * r);
}
