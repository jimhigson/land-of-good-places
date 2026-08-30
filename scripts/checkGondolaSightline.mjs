#!/usr/bin/env node
/**
 * Numeric proof for the family's ferris-wheel note (27 July 2026): *"the pet
 * should sit on a chair that is lower than the player's so it is easier to see
 * above their head"*.
 *
 * Every cute thing that can ride, sat in its low chair, must have the top of
 * its head **below the player's eye line** — and must fit inside the car
 * without poking through the glass. Both are pure arithmetic on numbers that
 * live in two files, which is exactly the kind of thing that silently drifts
 * apart, so it is checked here rather than by squinting at the ride.
 *
 * Mirrors the constants in `src/minigames/ferrisWheel/gondola.ts` rather than
 * importing them, exactly as `checkShopSpacing.mjs` does, so this stays a
 * plain Node script with no build step. If the source constants drift from the
 * numbers copied in here, that is what this script is for catching — re-copy
 * them and re-run.
 *
 * The passenger sizes are **measured**, not declared: each was read off a
 * `Box3` around the built model in a headless three.js scene. That matters —
 * the same exercise is what turned up `sizeToStandard` ignoring pets' ears and
 * rendering a 2.12 m bunny.
 *
 * Run with: node scripts/checkGondolaSightline.mjs
 */

// ---- copied from src/minigames/ferrisWheel/gondola.ts ---------------------
const CAR_WIDTH = 3.6;
const CAR_DEPTH = 2.8;
const CAR_HEIGHT = 2.6;
const PET_CHAIR_SEAT_Y = 0.16;
const PET_CHAIR_X = 1.05;
const PET_CHAIR_Z = -0.64;
const PLAYER_SEAT_Y = 0.8;
const EYE = { y: 1.8, z: 0.78 };
const WINDOW_TOP = 2.46;

/** Half-width the outer chairs must leave for a passenger, and the same at the front. */
const HALF_WIDTH = CAR_WIDTH / 2;
const HALF_DEPTH = CAR_DEPTH / 2;

// ---- measured from the built models (headless three.js Box3) --------------
// `top` is metres above the model's own origin, which the asset contract puts
// at the base. Outline hulls included, so these are the true silhouettes.
const RIDERS = [
  { id: 'pet.bunny', top: 1.46, width: 0.658, depth: 0.79 },
  { id: 'pet.kitten', top: 1.46, width: 0.814, depth: 1.061 },
  { id: 'pet.mouse', top: 1.46, width: 0.866, depth: 1.01 },
  { id: 'pet.puff', top: 1.46, width: 1.201, depth: 1.264 },
  { id: 'pet.ripika', top: 1.48, width: 1.206, depth: 0.86 },
  { id: 'toy.biscuit', top: 1.16, width: 0.984, depth: 0.892 },
  { id: 'toy.star', top: 0.37, width: 0.378, depth: 0.312 },
  // A balloon's origin is the bottom of its string, so it is tied to the
  // chair's feet rather than sat on the cushion — see `gondola.ts`.
  { id: 'balloon.corgi', top: 1.735, width: 0.892, depth: 0.659, tied: true },
];

let failures = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

console.log(
  `Car ${CAR_WIDTH} x ${CAR_DEPTH} x ${CAR_HEIGHT} m. `
    + `Player's cushion ${PLAYER_SEAT_Y}, eye ${EYE.y}. Pets' cushion ${PET_CHAIR_SEAT_Y}.\n`,
);

// 1. The whole point: nobody's head reaches the eye line.
console.log('Head clearance under the player\'s eye:');
for (const rider of RIDERS) {
  const seatY = rider.tied ? 0 : PET_CHAIR_SEAT_Y;
  const headTop = seatY + rider.top;
  const clearance = EYE.y - headTop;
  const grazeDegrees = (Math.atan2(clearance, EYE.z - PET_CHAIR_Z) * 180) / Math.PI;
  console.log(
    `  ${rider.id.padEnd(14)} head ${headTop.toFixed(3)} m  clearance ${clearance.toFixed(3)} m`
      + `  (view clear above ${grazeDegrees.toFixed(1)}° below the horizon)`,
  );
  if (clearance <= 0) fail(`${rider.id}'s head (${headTop.toFixed(3)}) reaches the eye line (${EYE.y})`);
}

// 2. The chair is lower than the player's, which is what was actually asked for.
if (PET_CHAIR_SEAT_Y >= PLAYER_SEAT_Y) {
  fail(`the pets' cushion (${PET_CHAIR_SEAT_Y}) is not below the player's (${PLAYER_SEAT_Y})`);
} else {
  console.log(`\nPets' cushion sits ${(PLAYER_SEAT_Y - PET_CHAIR_SEAT_Y).toFixed(2)} m below the player's.`);
}

// 3. Nobody in an outer chair pokes out through the side glass, and nobody in
//    any chair pokes out through the front.
console.log('\nFit inside the glass:');
for (const rider of RIDERS) {
  const sideReach = PET_CHAIR_X + rider.width / 2;
  const frontReach = -PET_CHAIR_Z + rider.depth / 2;
  console.log(
    `  ${rider.id.padEnd(14)} side reach ${sideReach.toFixed(3)} / ${HALF_WIDTH}`
      + `   front reach ${frontReach.toFixed(3)} / ${HALF_DEPTH}`,
  );
  if (sideReach > HALF_WIDTH) fail(`${rider.id} in an outer chair reaches ${sideReach.toFixed(3)}, past the side glass at ${HALF_WIDTH}`);
  if (frontReach > HALF_DEPTH) fail(`${rider.id} reaches ${frontReach.toFixed(3)}, past the front glass at ${HALF_DEPTH}`);
}

// 4. Raising the eye must not have cost the child the sky. The limit looking
//    up through the front window is the scalloped valance hanging below the
//    top rail (radius 0.11, hung 0.02 below `windowTop`).
const valanceBottom = WINDOW_TOP - 0.02 - 0.11;
const upDegrees = (Math.atan2(valanceBottom - EYE.y, HALF_DEPTH + EYE.z) * 180) / Math.PI;
console.log(`\nLooking up through the front glass: clear to ${upDegrees.toFixed(1)}° above the horizon.`);
// The highest thing in the space show is the alien's saucer, which tops out at
// y = 6.2 m at a range of 21 m — about 12° up (see `SpaceFerrisWheel.ts`).
if (upDegrees < 12.5) fail(`only ${upDegrees.toFixed(1)}° of sky through the front window; the saucer sits at ~12°`);

// 5. The player's head has somewhere to be.
const headroom = CAR_HEIGHT - EYE.y;
console.log(`Headroom above the player's eye: ${headroom.toFixed(2)} m.`);
if (headroom < 0.5) fail(`only ${headroom.toFixed(2)} m of headroom above the eye`);

console.log(
  failures === 0
    ? '\nPASS: every rider sits below the eye line and inside the glass.'
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
