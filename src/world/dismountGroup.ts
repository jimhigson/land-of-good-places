import type { CollisionWorld } from './Collision';

/**
 * **Where a crowd steps off together** — the cosmetic riders beside her, never
 * her: she is put down by the one rule, `world/dismount.ts`'s `putDownSpot`,
 * inside `Player`.
 *
 * Its own file, with nothing but a type import, because the procgen invariant
 * suite imports it statically (`railRaceExitFitsTheParty`), and the put-down
 * rule reaches `NavGrid` and through it the park manifest: a static import of
 * that from `test/procgen/invariants.ts` would pin every seed to the default
 * park.
 */

/** A spot somebody is already standing on, in world metres. */
export interface OccupiedSpot {
  readonly x: number;
  readonly z: number;
  /** How much room that body needs around itself. */
  readonly radius: number;
}

/**
 * **Where a group of cosmetic riders steps off** — the Rail Race's crowd of
 * racers: several bodies stepping off together, none of them standing inside
 * the geometry and none of them standing inside each other.
 *
 * Not the player's rule: she is put down by `world/dismount.ts`'s
 * `putDownSpot` (through `Player.endRide`), first, and passed in here in
 * `occupied`, so nobody can ever appear standing on top of her. A single-point
 * search asked three times
 * hands back the same answer three times, which is precisely wrong for a crowd,
 * so a candidate here is only accepted if it is clear of the geometry *and* of
 * everybody already placed, the caller's own `occupied` list included.
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

    // Same contract as `putDownSpot`: say so loudly, hand back the best
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
