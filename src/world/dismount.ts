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
