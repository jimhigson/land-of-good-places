import { placedEntry } from '../../src/world/parkLayout';
import { clearOfPlots } from '../../src/world/train/plan';
import { type FerrisExit } from '../../src/minigames/ferrisWheel/exit';
/**
 * **Where a ferris wheel rider steps off** — a fan search for clear ground
 * opposite the kiosk. Moved verbatim from `src/minigames/ferrisWheel/exit.ts`;
 * the game reads the chosen spot from the park file. Build-time only.
 */

export function planFerrisExit(): FerrisExit {
  const wheel = placedEntry('ferrisWheel');
  const ex = wheel.entranceX;
  const ez = wheel.entranceZ;
  // The park middle is close enough to the origin for "which side" purposes —
  // exactly the approximation `ferrisKiosk` makes, and the two must agree for
  // the exit to land opposite the kiosk rather than merely near it.
  const towardMiddleX = -ex;
  const towardMiddleZ = -ez;
  const length = Math.hypot(towardMiddleX, towardMiddleZ) || 1;
  const sideX = -towardMiddleZ / length;
  const sideZ = towardMiddleX / length;

  // One ray was never enough on a spread park (issue #241): seed 2's only
  // clear spots on the anti-kiosk ray were under a tree by the time the
  // scatter ran. Sweep a small fan — anti-kiosk side first so the exit
  // still prefers to land opposite the booth — and take the first spot
  // clear of plots AND the doormat's own approach.
  for (const swing of [0, -0.35, 0.35, -0.7, 0.7, Math.PI / 2, -Math.PI / 2]) {
    const cos = Math.cos(swing);
    const sin = Math.sin(swing);
    const dirX = -(sideX * cos - sideZ * sin);
    const dirZ = -(sideZ * cos + sideX * sin);
    for (let distance = 2.5; distance <= 12; distance += 0.5) {
      const x = ex + dirX * distance;
      const z = ez + dirZ * distance;
      // 2.6, from 1.2 — same reasoning as railRace/plan.ts's exit margin.
      if (clearOfPlots(x, z, 2.6)) return { x, z };
    }
  }
  return { x: ex - sideX * 2.5, z: ez - sideZ * 2.5 };
}
