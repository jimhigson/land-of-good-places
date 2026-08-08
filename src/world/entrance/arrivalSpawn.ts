/**
 * **Who decides where the player starts: the save, the spawn point, or the bus?**
 *
 * One line of logic, in its own file, for one reason: `Game.ts` cannot be
 * constructed in a test — it builds a real `WebGLRenderer` — so anything
 * decided inline in its constructor is decided somewhere no check can reach.
 * That is not a hypothetical. The bug this exists to prevent was *in* that
 * constructor, and the first guard written for it lived in `check:cat-bus`,
 * which drives `World` directly and never runs `Game` at all: it passed
 * cheerfully with the bug reinstated, which makes it worse than no guard.
 *
 * ## The bug
 *
 * `Game`'s constructor ran, in this order:
 *
 * 1. `resolveSpawn()` — the park edge by the gate.
 * 2. `world.attachPlayer(player)`, which reaches `ArrivalSequence.attachPlayer`
 *    and **seats her in the cat bus**, seventeen metres away at the kerb.
 * 3. `player.teleportTo(spawn…)` — unconditional, dragging her straight back.
 * 4. `camera.snapTo(player.position)` — so the camera opened on the **park**.
 * 5. Frame one put her back in her seat, and the camera slid across the park
 *    to catch up.
 *
 * Jim, 7 August 2026: *"the camera starts in the middle of the park and then
 * scrolls to the bus"*. Note that step 4 was correct code doing exactly what it
 * says: `snapTo` skips the follow smoothing outright. It was told the truth
 * about a position that was wrong, which is why shortening the ease — the
 * obvious fix — could not have worked.
 */

/**
 * Should the arrival keep hold of where the player is, rather than `Game`
 * putting her at the spawn point?
 *
 * @param hasArrival    the cat bus is bringing her in (`Entrance.arrival`).
 * @param hasStartPlace a continued game restoring a saved position.
 */
export function arrivalOwnsTheSpawn(hasArrival: boolean, hasStartPlace: boolean): boolean {
  // A restored save always wins: she was somewhere specific when she quit, and
  // `arrivedByBus` would be true on that save anyway, so the two never actually
  // disagree — this is belt and braces in the safe direction.
  if (hasStartPlace) return false;
  return hasArrival;
}
