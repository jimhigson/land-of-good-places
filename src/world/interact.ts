/**
 * The tap-target registry.
 *
 * Interaction in this game is proximity-based: you walk up to the lift and it
 * comes, you stand on the slide pad and you are off, you press E next to the
 * grown-up and they come down with you. That is a lovely model for a keyboard
 * and a hopeless one for a finger, which points at a *thing* rather than at a
 * place.
 *
 * Rather than rewriting any of it, each interactive thing declares a small zone
 * here: where it is (so a tap can land on it), where a child should stand (so
 * tap-to-move has somewhere to walk), and whether arriving should also fire the
 * interact action. The keyboard path is untouched — a tap just arranges for the
 * same conditions the keyboard player would have created by walking over.
 *
 * Zones are rebuilt on demand rather than cached, because two of them move: the
 * lift doors follow the car, and the bubble is wherever the bubble is.
 */
export interface InteractZone {
  readonly id: string;
  /** For the HUD / debugging. Not shown anywhere yet. */
  readonly label: string;

  /** World position of the thing itself — what the tap has to land near. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How close (in XZ metres) a tapped point must land to count as this thing. */
  readonly pickRadius: number;

  /** Where the character should end up. Often, but not always, the thing itself. */
  readonly standX: number;
  readonly standZ: number;

  /**
   * Fire `interact` on arrival — the E key equivalent. False for anything that
   * triggers simply by being stood on (slides, the trampoline, the bubble).
   */
  readonly pressInteract: boolean;
}

/** How far above or below a zone a tapped point may land and still count. */
export const ZONE_HEIGHT_TOLERANCE = 2.2;

/**
 * The zone whose centre is nearest the tapped point, or `null` if the tap landed
 * on plain ground.
 *
 * Nearest-centre rather than first-match: the lift doors and the lift car
 * overlap, and a child aiming at the middle of a thing should get that thing.
 */
export function pickInteractZone(
  zones: readonly InteractZone[],
  x: number,
  y: number,
  z: number,
): InteractZone | null {
  let best: InteractZone | null = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    if (Math.abs(y - zone.y) > ZONE_HEIGHT_TOLERANCE) continue;
    const dx = x - zone.x;
    const dz = z - zone.z;
    const distance = Math.hypot(dx, dz);
    if (distance > zone.pickRadius || distance >= bestDistance) continue;
    best = zone;
    bestDistance = distance;
  }
  return best;
}
