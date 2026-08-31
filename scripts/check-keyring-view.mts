/**
 * **Can a child see all six keyrings, and tap the one she means — on her phone?**
 *
 * ```
 * pnpm run check:keyring-view
 * ```
 *
 * Jim, on an iPhone in portrait, 31 August 2026 (#418): *"the keyring stand when
 * zoomed in doesn't show all the keyrings. Adjust the camera to be at a distance
 * where all fit in. Also, the keyrings at the front overlap those at the back,
 * bring them forward to the front edge of the table so it is easier to click one
 * or the other."*
 *
 * Two faults, one subject: a six-year-old being asked to choose. She cannot pick
 * what is off the edge of the screen, and she cannot pick the one she means when
 * two of them are a fingertip apart. So this asks both questions of the **built**
 * rack, through a **real `IsoCamera`**, at the real viewports the game is played
 * on — starting with the narrowest one it supports.
 *
 * ## Why the old code passed everything and was still wrong
 *
 * Nothing here was unchecked by accident; it was checked in the wrong space.
 *
 * - The zoom was `KEYCHAIN_VIEW_ZOOM = 4.25`, tuned by eye against a screenshot
 *   of a **desktop** window — its own doc comment said so. `IsoCamera` frames
 *   height-led with a minimum width, so a 390 × 844 phone gets **1.294 m** of
 *   half-width where 16:9 gets 3.137 m. Two keyrings sat outside it. No check
 *   existed that had ever been shown a portrait viewport.
 * - `check:tap-spacing` did look at the six keyrings, and reported them as
 *   *warnings* — its rule is "different actions must sit a finger apart", and
 *   all six say "choose a keyring", so their overlaps were logged as harmless
 *   ambiguity. That rule is right for two flowers in a bed, where either answer
 *   is the one she asked for. It is wrong here, where the whole point is picking
 *   a particular one. It also measures **world** distance, and the camera is
 *   pitched 38°, so a 0.75 m gap across a table reads as 0.462 m on screen.
 *
 * This script therefore measures **screen space, at the zoom the view actually
 * settles to, on each viewport**, and treats a same-action overlap as a failure
 * rather than a warning. It does not replace `check:tap-spacing`; it asks the
 * question that one deliberately does not.
 *
 * ## What it drives
 *
 * `KeychainShop.viewZoom(camera)` — the real decision the game makes, not a
 * copy of it. A check that re-implemented the framing would only prove the check
 * agrees with itself, which is this project's dominant defect.
 *
 * ## Proved red before trusted green
 *
 * See the commit message for both mutation transcripts: restoring the old
 * `KEYCHAIN_VIEW_ZOOM = 4.25` puts `strawberry` and `rumi` outside the portrait
 * frame, and pulling the front row back to the old `RACK_ROW_GAP = 0.75`
 * position drops three pairs under a fingertip.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from '../src/core/constants.ts';
import { DEG } from '../src/core/mathUtils.ts';
import { screenBasis3D, screenRightOf, screenUpOf } from '../src/core/screenBasis.ts';
import { screenDistance } from '../src/core/contentFrame.ts';
import { PHONE_VIEWPORT, TAP_FINGER_METRES, TAP_FINGER_PIXELS } from '../src/world/tapSpacing.ts';

const problems: string[] = [];
const notes: string[] = [];

/**
 * The viewports this view is held to.
 *
 * **Portrait is the one that matters** and it is deliberately first: it is the
 * narrowest frame the game supports, so what fits there fits everywhere, and it
 * is the frame #418 was reported on. The other two are here because a fix tuned
 * on a phone would break the desktop exactly as the desktop-tuned constant broke
 * the phone — that symmetry is the whole reason the framing is derived rather
 * than typed, and it is worth a check rather than a comment.
 */
const VIEWPORTS = [
  { what: 'iPhone portrait', width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
  { what: 'iPhone landscape', width: PHONE_VIEWPORT.height, height: PHONE_VIEWPORT.width },
  { what: 'desktop 16:9', width: 1920, height: 1080 },
] as const;

const { world } = quietly(() => buildHeadlessPark());
const shop = world.keychainShop;
shop.openView();

// ---------------------------------------------------------------------------
// The analytic screen basis must be the one three.js actually renders with.
// `screenBasis3D` is written out by hand so headless code can project without a
// camera; if it ever drifts from `IsoCamera`'s own matrix columns, every
// measurement below is quietly about a camera angle that does not exist.
// ---------------------------------------------------------------------------
{
  const camera = new IsoCamera();
  camera.resize(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
  camera.snapTo(new Vector3(shop.viewFocus.x, shop.viewFocus.y, shop.viewFocus.z));
  const analytic = screenBasis3D(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG);
  const drift = Math.max(
    Math.abs(analytic.rightX - camera.screenRightAxis.x),
    Math.abs(analytic.rightY - camera.screenRightAxis.y),
    Math.abs(analytic.rightZ - camera.screenRightAxis.z),
    Math.abs(analytic.upX - camera.screenUpAxis.x),
    Math.abs(analytic.upY - camera.screenUpAxis.y),
    Math.abs(analytic.upZ - camera.screenUpAxis.z),
  );
  if (drift > 1e-9) {
    problems.push(
      `screenBasis3D disagrees with IsoCamera's own axes by ${drift.toExponential(2)} — ` +
        `every framing measurement below is about a camera angle the game does not use. ` +
        `Re-derive screenBasis3D in src/core/screenBasis.ts.`,
    );
  }
  notes.push(`screen basis: analytic and rendered agree to ${drift.toExponential(1)}`);
}

// The finger rule's own tie-back: at zoom 1 on the QA phone, the pixel form and
// the metre form must be the same number, or the two rules have drifted apart.
{
  const camera = new IsoCamera();
  camera.resize(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
  const atDefaultZoom = TAP_FINGER_PIXELS * camera.worldUnitsPerPixel;
  if (Math.abs(atDefaultZoom - TAP_FINGER_METRES) > 1e-9) {
    problems.push(
      `the finger in pixels (${TAP_FINGER_PIXELS}) through the QA phone's own camera is ` +
        `${atDefaultZoom.toFixed(4)} m, but TAP_FINGER_METRES says ${TAP_FINGER_METRES.toFixed(4)} m — ` +
        `src/world/tapSpacing.ts's two forms of one rule have drifted apart.`,
    );
  }
}

const basis = screenBasis3D(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG);
const focus = shop.viewFocus;
const focusRight = screenRightOf(basis, focus.x, focus.y, focus.z);
const focusUp = screenUpOf(basis, focus.x, focus.y, focus.z);
const keyrings = shop.viewRequiredSubjects;
// The tap targets as the tap system itself sees them: `interactZones()` in the
// opened state IS the six keyring zones `Selection.handleTap` routes to, with
// the pick radii it uses. Measuring anything else here would be measuring a
// model of the game rather than the game.
const zones = shop.interactZones();
if (zones.length !== keyrings.length) {
  throw new Error(
    `the opened rack offered ${zones.length} zones for ${keyrings.length} keyrings; ` +
      `this check assumed one zone each.`,
  );
}

console.log(
  `check:keyring-view — ${keyrings.length} keyrings, ${VIEWPORTS.length} viewports, ` +
    `finger = ${TAP_FINGER_PIXELS} CSS px.`,
);

for (const viewport of VIEWPORTS) {
  const camera = new IsoCamera();
  camera.resize(viewport.width, viewport.height);
  // A fresh camera is at zoom 1, so its frustum right now IS the zoom-1 base —
  // which is how the settled frame is computed below without having to run the
  // zoom damping out. Assert it rather than assume it.
  if (camera.zoom !== 1) {
    throw new Error(`IsoCamera no longer starts at zoom 1 (got ${camera.zoom}); this check assumed it did.`);
  }
  const base = camera.viewHalfHeight;
  const aspect = viewport.width / viewport.height;

  // The real decision, from the game's own code.
  const ideal = shop.viewZoom(camera);
  const zoom = Math.min(Math.max(ideal, CAMERA_ZOOM_MIN), CAMERA_ZOOM_MAX);
  const halfHeight = base / zoom;
  const halfWidth = halfHeight * aspect;
  const fingerMetres = TAP_FINGER_PIXELS * ((2 * halfHeight) / viewport.height);

  const label = `${viewport.what} ${viewport.width}x${viewport.height}`;
  console.log(
    `\n  ${label}: zoom ${zoom.toFixed(3)}` +
      (Math.abs(ideal - zoom) > 1e-6 ? ` (wanted ${ideal.toFixed(3)}, clamped)` : '') +
      `, frame ±${halfWidth.toFixed(3)} x ±${halfHeight.toFixed(3)} m, ` +
      `finger ${fingerMetres.toFixed(3)} m`,
  );

  // ---- 1. every keyring inside the frame, with the margin the view asks for
  const margin = shop.viewMargin;
  let worstFit = Infinity;
  let worstName = '';
  for (const keyring of keyrings) {
    let outRight = -Infinity;
    let outUp = -Infinity;
    for (const point of keyring.points) {
      outRight = Math.max(outRight, Math.abs(screenRightOf(basis, point.x, point.y, point.z) - focusRight));
      outUp = Math.max(outUp, Math.abs(screenUpOf(basis, point.x, point.y, point.z) - focusUp));
    }
    // Positive = clear air between this keyring and the edge, over and above the
    // margin the view asked for.
    const slack = Math.min(halfWidth / (1 + margin) - outRight, halfHeight / (1 + margin) - outUp);
    if (slack < worstFit) {
      worstFit = slack;
      worstName = keyring.what;
    }
    if (outRight > halfWidth || outUp > halfHeight) {
      const overRight = outRight - halfWidth;
      const overUp = outUp - halfHeight;
      problems.push(
        `${label}: the '${keyring.what}' keyring is OUTSIDE the frame — ` +
          (overRight > 0 ? `${overRight.toFixed(3)} m past the left/right edge` : '') +
          (overRight > 0 && overUp > 0 ? ' and ' : '') +
          (overUp > 0 ? `${overUp.toFixed(3)} m past the top/bottom edge` : '') +
          `. A child cannot choose a keyring she cannot see (#418).`,
      );
    } else if (slack < 0) {
      problems.push(
        `${label}: the '${keyring.what}' keyring is inside the frame but ` +
          `${(-slack).toFixed(3)} m into the ${(margin * 100).toFixed(0)}% margin — ` +
          `it touches the edge of the screen. Widen the framing in KeychainShop.viewZoom.`,
      );
    }
  }
  console.log(`    every keyring in frame; tightest is '${worstName}' with ${worstFit.toFixed(3)} m of margin to spare`);

  // ---- 2. no two keyrings within a finger of each other, on screen
  let closest = Infinity;
  let closestPair = '';
  for (let a = 0; a < zones.length; a += 1) {
    for (let b = a + 1; b < zones.length; b += 1) {
      const one = zones[a]!;
      const two = zones[b]!;
      // Same shape as `tapSpacing.ts`'s own `zoneSeparation` — centres apart,
      // less the larger pick radius — but asked in screen space, which is where
      // the finger is working. See this file's header.
      const gap = screenDistance(basis, one, two) - Math.max(one.pickRadius, two.pickRadius);
      if (gap < closest) {
        closest = gap;
        closestPair = `'${one.id}' and '${two.id}'`;
      }
      if (gap < fingerMetres) {
        problems.push(
          `${label}: '${one.id}' and '${two.id}' are ${Math.max(0, gap).toFixed(3)} m apart on ` +
            `screen once their pick areas are allowed for, inside the ${fingerMetres.toFixed(3)} m a ` +
            `fingertip covers at this zoom — a tap aimed at one can select the other (#418). ` +
            `Move them further apart on the counter, or frame closer in KeychainShop.viewZoom.`,
        );
      }
    }
  }
  console.log(
    `    closest pair ${closestPair}: ${closest.toFixed(3)} m apart on screen ` +
      `vs a ${fingerMetres.toFixed(3)} m finger ` +
      `(${closest >= fingerMetres ? `${(closest - fingerMetres).toFixed(3)} m to spare` : 'TOO CLOSE'})`,
  );
}

shop.closeView();

for (const note of notes) console.log(`  ${note}`);
if (problems.length > 0) {
  console.error('');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:keyring-view FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\ncheck:keyring-view OK — every keyring visible and separately tappable on every viewport. ✓');
