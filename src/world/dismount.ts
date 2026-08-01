import type { CollisionWorld } from './Collision';

/**
 * The universal safety net for a ride's dismount point (GAME_DESIGN.md's EXIT
 * rule, 28 July 2026).
 *
 * Every ride now has a planned exit — a point beside its station, clear of
 * every plot blocker at plan time (`coaster/plan.ts`, `ferrisWheel/exit.ts`).
 * But a plan is solved against the *layout*, not the finished collision world,
 * and this is the one place that checks the claim against the fact before a
 * rider is actually put there: verify the preferred point is really clear
 * right now, and if it is not — geometry the plan could not see, a future
 * regression, anything — spiral outward in rings until a clear spot is found.
 *
 * This is what makes "no ride can ever strand a rider inside geometry" true
 * regardless of what else goes wrong upstream, rather than merely true of the
 * one bug this file was written to fix.
 */
export function resolveDismount(
  collision: CollisionWorld,
  preferredX: number,
  preferredZ: number,
  radius: number,
): { x: number; z: number } {
  if (collision.isClearCircle(preferredX, preferredZ, radius)) {
    return { x: preferredX, z: preferredZ };
  }

  const ringStep = 0.6;
  const maxRing = 6;
  for (let ring = ringStep; ring <= maxRing; ring += ringStep) {
    const samples = Math.max(8, Math.round((ring * Math.PI * 2) / ringStep));
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const x = preferredX + Math.cos(angle) * ring;
      const z = preferredZ + Math.sin(angle) * ring;
      if (collision.isClearCircle(x, z, radius)) return { x, z };
    }
  }

  // Nothing clear within range. A console warning that says so loudly beats
  // a silent teleport nobody can find in QA — see CLAUDE.md's claim-vs-fact
  // tradition. The preferred point is still handed back: it is the best guess
  // there is, and the caller has nowhere else to put a rider.
  console.warn(
    `dismount: no clear spot within ${maxRing} m of (${preferredX.toFixed(1)}, ${preferredZ.toFixed(1)})`,
  );
  return { x: preferredX, z: preferredZ };
}

/** A spot somebody is already standing on, in world metres. */
export interface OccupiedSpot {
  readonly x: number;
  readonly z: number;
  /** How much room that body needs around itself. */
  readonly radius: number;
}

/**
 * The same question for a *group*: several bodies stepping off together, none
 * of them standing inside the geometry and none of them standing inside each
 * other.
 *
 * {@link resolveDismount} is stateless and single-point — ask it three times
 * and it hands back the same answer three times, which is precisely wrong for
 * a crowd. This wraps it with the one extra rule a crowd needs: a candidate is
 * only accepted if it also clears everybody already placed, the caller's own
 * `occupied` list included. That list is how the player keeps her personal
 * space; she is put down first and passed in here, so nobody can ever appear
 * standing on top of her.
 *
 * Bodies are placed in the order asked for, each one starting its own search
 * from a point fanned around `preferredX/Z`, so the result reads as a little
 * group gathered round a spot rather than a queue marching away from it.
 */
export function resolveDismountGroup(
  collision: CollisionWorld,
  preferredX: number,
  preferredZ: number,
  radius: number,
  count: number,
  occupied: readonly OccupiedSpot[] = [],
): { x: number; z: number }[] {
  const placed: OccupiedSpot[] = [...occupied];
  const out: { x: number; z: number }[] = [];

  // Fan the *starting guesses* around the exit rather than all searching from
  // its centre: three bodies spiralling out of one point find three spots in a
  // line, because they all walk the same ring in the same order.
  const spread = radius * 2.4;
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + 0.5) / count) * Math.PI * 2;
    const seedX = preferredX + Math.cos(angle) * spread;
    const seedZ = preferredZ + Math.sin(angle) * spread;

    const clear = (x: number, z: number): boolean =>
      collision.isClearCircle(x, z, radius) &&
      placed.every((o) => Math.hypot(x - o.x, z - o.z) >= radius + o.radius);

    let spot: { x: number; z: number } | null = clear(seedX, seedZ)
      ? { x: seedX, z: seedZ }
      : null;

    if (!spot) {
      const ringStep = 0.6;
      const maxRing = 6;
      search: for (let ring = ringStep; ring <= maxRing; ring += ringStep) {
        const samples = Math.max(8, Math.round((ring * Math.PI * 2) / ringStep));
        for (let s = 0; s < samples; s += 1) {
          // Start each body's sweep at its own bearing, so two bodies that
          // fall back to the same ring do not both take the first sample.
          const a = angle + (s / samples) * Math.PI * 2;
          const x = seedX + Math.cos(a) * ring;
          const z = seedZ + Math.sin(a) * ring;
          if (clear(x, z)) {
            spot = { x, z };
            break search;
          }
        }
      }
    }

    // Same contract as `resolveDismount`: say so loudly, hand back the best
    // guess, never drop a body on the floor. These are cosmetic characters, so
    // the worst case is two of them overlapping for a few seconds — never a
    // player stuck in anything.
    if (!spot) {
      console.warn(
        `dismount: no clear group spot ${i + 1}/${count} near ` +
          `(${preferredX.toFixed(1)}, ${preferredZ.toFixed(1)})`,
      );
      spot = { x: seedX, z: seedZ };
    }

    placed.push({ x: spot.x, z: spot.z, radius });
    out.push(spot);
  }

  return out;
}
