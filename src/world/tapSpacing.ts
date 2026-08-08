/**
 * THE TAP-SPACING RULE — one owner.
 *
 * Jim, live play on a phone, 8 August 2026: *"It isn't possible to leave the
 * hotel room on mobile, because trying to just brings up the window/painting
 * small menu on tapping near the door. New rule: tappable items can't be so
 * close together."*
 *
 * The mechanics that make this a rule and not a taste: a tap is routed to
 * `Selection.handleTap` **first**, and a tap that lands inside any zone's pick
 * area selects it and *does not walk* (`Game.ts` — selecting is free, walking
 * is what a missed tap does). A doorway, though, is not a zone: it is a
 * walk-through trigger band (`Hotel.checkDoorways`), reachable only by
 * walking. So any zone whose pick area covers a doorway's approach eats every
 * tap aimed at the door, and the door becomes unusable by touch — which is
 * exactly what the suite's west window did.
 *
 * Hence two assertions, both owned here and measured by
 * `scripts/check-tap-spacing.mts` on the built park:
 *
 *  1. **No zone's pick area may come within a finger of a portal band** it is
 *     not itself the handle for (a door's own sign zone *is* the door — a tap
 *     on it opens the way through — so it alone may cover its band).
 *  2. **Two zones offering different actions must sit more than a finger's
 *     miss apart**: a tap aimed at one thing must never fire the pick area of
 *     a thing that does something else. Zones with the *same* verb (two
 *     breakfast chairs, two flowers) are ambiguity without harm — either
 *     answer is what the child asked for — and are reported as warnings, not
 *     failures.
 *
 * ## Where the finger number comes from
 *
 * Not invented: it is the game's own UI floor pushed through the game's own
 * camera. GAME_DESIGN.md's TEXT/UI-SCALE rule floors the UI unit at
 * `FALLBACK_UNIT_PX` (20 CSS px), and a minimum touch target is two units —
 * 40 px, the standard finger pad. The narrowest viewport this game is QA'd on
 * is a 390 × 844 portrait phone, where `IsoCamera.applyFrustum`'s own formula
 * (height-led framing with a minimum width) sets the world-per-pixel scale at
 * default zoom. Two UI units through that scale ≈ 1.13 m: the world-space
 * radius a well-aimed tap can still miss by. Change the camera framing or the
 * UI floor and this number follows automatically.
 */
import { CAMERA_MIN_VIEW_WIDTH, CAMERA_VIEW_HEIGHT } from '../core/constants';
import { FALLBACK_UNIT_PX } from '../core/uiScale';
import { ZONE_HEIGHT_TOLERANCE, zoneVerb, type InteractZone } from './interact';

/** The QA phone viewport (CSS px) — the narrowest screen the game is held to. */
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * World metres per CSS pixel at default zoom on {@link PHONE_VIEWPORT} —
 * `IsoCamera.applyFrustum`'s formula, evaluated once here. The camera is
 * orthographic, so this is exact, not a near-plane approximation.
 */
const PHONE_ASPECT = PHONE_VIEWPORT.width / PHONE_VIEWPORT.height;
const PHONE_VIEW_HALF_HEIGHT = Math.max(
  CAMERA_VIEW_HEIGHT / 2,
  CAMERA_MIN_VIEW_WIDTH / 2 / PHONE_ASPECT,
);
const PHONE_METRES_PER_PX = (PHONE_VIEW_HALF_HEIGHT * 2) / PHONE_VIEWPORT.height;

/** How far a finger's tap can miss what it aimed at, in world metres. */
export const TAP_FINGER_METRES = 2 * FALLBACK_UNIT_PX * PHONE_METRES_PER_PX;

/**
 * A walk-through portal's trigger region — a rectangle in its own frame,
 * yawed `yaw` radians about its centre (0 for the hotel's axis-aligned room
 * doorways; the tower and castle doors inherit their facade's yaw).
 */
export interface PortalBand {
  /** For failure messages: "the suite door", "the lift alcove". */
  readonly what: string;
  readonly centreX: number;
  readonly centreZ: number;
  readonly halfAlong: number;
  readonly halfAcross: number;
  readonly yaw: number;
  /** Height of the floor the band sits on, for the same-storey test. */
  readonly y: number;
  /** The zone that *is* this portal's handle, allowed (expected) to cover it. */
  readonly ownZoneId?: string;
}

/** XZ distance from a point to the band's rectangle (0 inside it). */
export function distanceToBand(band: PortalBand, x: number, z: number): number {
  const dx = x - band.centreX;
  const dz = z - band.centreZ;
  const sin = Math.sin(band.yaw);
  const cos = Math.cos(band.yaw);
  const along = dx * sin + dz * cos;
  const across = dx * cos - dz * sin;
  const outAlong = Math.max(Math.abs(along) - band.halfAlong, 0);
  const outAcross = Math.max(Math.abs(across) - band.halfAcross, 0);
  return Math.hypot(outAlong, outAcross);
}

/** True when a walker at (x, z) is inside the band — the trigger test itself. */
export function bandContains(band: PortalBand, x: number, z: number): boolean {
  return distanceToBand(band, x, z) === 0;
}

/**
 * Rule 1's measurement: how much clear air lies between a zone's pick area
 * and a portal band. Negative means the pick area overlaps the band itself.
 */
export function zoneBandClearance(zone: InteractZone, band: PortalBand): number {
  return distanceToBand(band, zone.x, zone.z) - zone.pickRadius;
}

/**
 * Rule 2's measurement: how much further apart two zones' centres are than
 * the larger pick radius. When this is under {@link TAP_FINGER_METRES}, a tap
 * aimed at one zone's centre can land inside the other's pick area.
 */
export function zoneSeparation(a: InteractZone, b: InteractZone): number {
  return Math.hypot(a.x - b.x, a.z - b.z) - Math.max(a.pickRadius, b.pickRadius);
}

/** Zones on the same storey, as the pick itself judges storeys. */
export function sameStorey(aY: number, bY: number): boolean {
  return Math.abs(aY - bY) <= ZONE_HEIGHT_TOLERANCE;
}

/** Whether two zones do different things — the pairs rule 2 is hard about. */
export function differentActions(a: InteractZone, b: InteractZone): boolean {
  return zoneVerb(a) !== zoneVerb(b);
}
