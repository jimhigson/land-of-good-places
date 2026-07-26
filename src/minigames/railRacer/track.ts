import { Rng } from '../../core/mathUtils';

/**
 * The rail, as maths.
 *
 * The whole mini-game is one dimensional: everything — the riders, the hazards,
 * the camera, the finish line — is a distance along the rail, and this file is
 * the only place that knows what shape the rail is. Geometry, gameplay and the
 * camera all read `railHeight`, so the rider can never float above the track or
 * sink into it.
 */

/** Metres from the start banner to the finish arch. */
export const TRACK_LENGTH = 640;

/** Rail height where the ground is flat, in metres. Keeps the dips above zero. */
const RAIL_BASE = 4.6;

/** The gentle rollercoaster: three sines, nothing steeper than about 11°. */
export function railHeight(x: number): number {
  return (
    RAIL_BASE +
    Math.sin(x * 0.055) * 1.5 +
    Math.sin(x * 0.021 + 1.3) * 2.2 +
    Math.sin(x * 0.115 + 0.7) * 0.5
  );
}

/** dy/dx along the rail. Positive is uphill. */
export function railSlope(x: number): number {
  return (
    Math.cos(x * 0.055) * 1.5 * 0.055 +
    Math.cos(x * 0.021 + 1.3) * 2.2 * 0.021 +
    Math.cos(x * 0.115 + 0.7) * 0.5 * 0.115
  );
}

/** Pitch of the rail in radians — what a rider's body is rotated by. */
export function railPitch(x: number): number {
  return Math.atan(railSlope(x));
}

// ------------------------------------------------------------------ hazards

export type HazardKind = 'gate' | 'branch';

export interface Hazard {
  readonly x: number;
  readonly kind: HazardKind;
  /** Go under it faster than this and you get a bonk. */
  readonly safeSpeed: number;
}

/**
 * The one rule of the game: **let go before the sparky bits.**
 *
 * Hazards are spaced far enough apart that there is always time to build speed
 * up again — roughly four seconds of holding between them at racing pace — and
 * the first one is a long way in, so the first thing a child does is enjoy
 * going fast.
 */
export const SAFE_SPEED = 9;

/**
 * How much speed a bonk costs. Never a crash: you wobble and carry on.
 *
 * Tuned against a simulation of the whole course, because the number has one
 * job — a bonk must cost *more* than the coasting it saved, or holding the
 * button down for a minute would be the winning strategy and the game would
 * have nothing to teach. At 0.35, plus the second of wobble in which the thrust
 * does nothing, a child who never lets go finishes in about 63 seconds against
 * about 54 for one who does, which is the difference between fourth and first.
 */
export const BONK_SPEED_FACTOR = 0.35;

/** Height of the bar above the rail. Ducking is what gets you under it. */
export const HAZARD_CLEARANCE = 1.15;

/**
 * How far ahead a hazard starts warning you, in metres.
 *
 * Deliberately further than the camera can see, so a hazard is already glowing
 * amber as it slides into frame and is never a surprise. That is about two and
 * a half seconds at racing speed, against the one second it takes to coast down
 * to a safe pace — enough slack for a six-year-old to notice, decide and act.
 */
export const ALERT_RANGE = 34;

/**
 * Where the hazards are.
 *
 * Built once from a fixed seed, so every race is the same course — a child
 * learns where the sparky gate before the big dip is, and that learning is most
 * of the fun. Spacing wobbles a little so it never feels like a metronome.
 */
export const HAZARDS: readonly Hazard[] = buildHazards();

function buildHazards(): Hazard[] {
  const rng = new Rng(0x9a11ce);
  const hazards: Hazard[] = [];
  let x = 74;
  while (x < TRACK_LENGTH - 46) {
    hazards.push({
      x,
      kind: rng.chance(0.55) ? 'gate' : 'branch',
      safeSpeed: SAFE_SPEED,
    });
    x += rng.range(36, 52);
  }
  return hazards;
}

/** The next hazard at or beyond `x`, or null past the last one. */
export function nextHazard(x: number): Hazard | null {
  for (const hazard of HAZARDS) {
    if (hazard.x >= x) return hazard;
  }
  return null;
}
