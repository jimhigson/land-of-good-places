/**
 * **A height is not a number, and it must not be comparable with a
 * coordinate.**
 *
 * `Geo` deleted half the category by naming its components `cx`/`cy`/`cz`, so
 * that `geo.y` does not compile. This deletes the other half. The remaining
 * mistake is not *reading* a `y` — it is treating the number that comes out of
 * an altitude as interchangeable with the number that comes out of a position:
 *
 * ```ts
 * if (altitude(player) < ground.cy) …   // meaningless, and it used to compile
 * const gap = altitude(a) - b.cy;       // 1.43x wrong at the park's reach
 * ```
 *
 * ## Why this is opaque and not a branded number, which was measured
 *
 * The obvious spelling is `type Altitude = number & { readonly brand: unique
 * symbol }`. **It does not work**, and it is worth writing down because it
 * looks like it does. Probed with this repo's own `tsc` before any of this was
 * designed:
 *
 * | expression | branded `number` | opaque |
 * |---|---|---|
 * | `alt < geo.cy` | **compiles** | `TS2365: Operator '<' cannot be applied` |
 * | `alt - geo.cy` | **compiles** | `TS2362` |
 * | `needsAltitude(plainNumber)` | `TS2345` | `TS2345` |
 *
 * A brand on a `number` is assignable *to* `number`, so every comparison and
 * every arithmetic operator stays open. It guards function boundaries and
 * nothing else — which is the half of the problem that was never the bug. The
 * bug is an operator between two things that do not belong in one expression,
 * and only a type that is **not a number** can refuse that.
 *
 * So an altitude is opaque, and the operations you are allowed to do to one are
 * written down below. There are six, they are all any call site in the
 * inventory needed, and each is a sentence a person would say out loud.
 *
 * ## Erasable, as this repo requires
 *
 * `declare const` is ambient and `type` is a type: both erase to nothing, so
 * this file survives Node's type-stripping with no transpile step, and
 * `erasableSyntaxOnly` is satisfied. There is no `enum`, no class, and no
 * runtime representation at all — an `Altitude` **is** the metre count at
 * runtime, so none of this costs an allocation or a property read.
 */

declare const ALTITUDE: unique symbol;

/**
 * Metres of clearance above the ground, measured radially from the planet's
 * centre — the quantity {@link altitudeOf} produces and the only thing that may
 * be compared with another altitude.
 *
 * Opaque on purpose: see the file docblock. At runtime it is the number.
 */
export type Altitude = { readonly [ALTITUDE]: true };

/**
 * **Read an altitude as plain metres — the one door out, named so it is
 * obvious in a diff.**
 *
 * Legitimate whenever the number leaves the domain: formatting a failure
 * message, feeding a tween, writing a save. Illegitimate as a way to get back
 * to comparing a height with a coordinate, which is the whole thing this type
 * exists to stop — and a reviewer can find every instance by searching for this
 * one name, which is not true of an implicit conversion.
 */
export function metresOf(a: Altitude): number {
  return a as unknown as number;
}

/**
 * **Make an altitude from a number you are certain is one.**
 *
 * For thresholds and constants — `const HEAD_ROOM = altitudeOfMetres(2.1)` — and
 * for the one owner that computes altitudes from geometry. If you are reaching
 * for this to launder a `y` coordinate into an altitude, you have found the
 * defect this type exists to catch: the `y` is not a height, and wrapping it
 * does not make it one.
 */
export function altitudeOfMetres(metres: number): Altitude {
  return metres as unknown as Altitude;
}

/** Ground level. `altitudeOfMetres(0)`, named, because it is compared against constantly. */
export const ON_THE_GROUND: Altitude = /* @__PURE__ */ altitudeOfMetres(0);

/** Is `a` higher than `b`? The comparison the operator used to do wrongly. */
export function isAbove(a: Altitude, b: Altitude): boolean {
  return metresOf(a) > metresOf(b);
}

/** Is `a` lower than `b`? */
export function isBelow(a: Altitude, b: Altitude): boolean {
  return metresOf(a) < metresOf(b);
}

/**
 * **The clearance between two altitudes, in metres.**
 *
 * Honest because both arguments are radial heights above the ground, so the
 * lean cancels exactly — which is precisely what `a.y - b.y` failed to do. At
 * 157 m the radial gradient is 1.02 m of world `y` per metre travelled
 * outward, so a `y` difference taken between two columns is mostly planet; a
 * difference of two altitudes is not, at any distance.
 *
 * Signed: positive when `a` is the higher.
 */
export function clearanceBetween(a: Altitude, b: Altitude): number {
  return metresOf(a) - metresOf(b);
}

/** Move an altitude up (or down, with a negative) by some metres. */
export function raisedBy(a: Altitude, metres: number): Altitude {
  return altitudeOfMetres(metresOf(a) + metres);
}

/** For logs and failure messages, which CLAUDE.md asks to carry real numbers. */
export function formatAltitude(a: Altitude): string {
  return `${metresOf(a).toFixed(3)} m above ground`;
}
