/**
 * **Can every tap land on the thing it aimed at?**
 *
 * ```
 * npm run check:tap-spacing
 * ```
 *
 * Jim, live play on a phone, 8 August 2026: *"It isn't possible to leave the
 * hotel room on mobile, because trying to just brings up the window/painting
 * small menu on tapping near the door. New rule: tappable items can't be so
 * close together — verify against this for all spaces, internal and external,
 * and set up tests so we don't break it again."*
 *
 * The rule itself — thresholds and both measurements — is
 * `src/world/tapSpacing.ts`, one owner; this script applies it to **every
 * interact zone the built game offers**, space by space: the park (stalls,
 * flowers, trees, train, both facades), the castle interior, and each hotel
 * room, plus every walk-through portal band those spaces declare
 * (`hotelDoorBands`, `Hotel.towerDoorBand`, `castleEntranceBand`/`ExitBand`).
 *
 *  1. **A zone's pick area must keep a finger's clearance from every portal
 *     band** it is not itself the handle of — otherwise the zone eats taps
 *     aimed at the door, and the door cannot be used by touch at all (the
 *     suite bug above: `Selection.handleTap` wins before the walk happens).
 *  2. **Zones with different actions must sit more than a finger's miss
 *     apart.** Same-action pairs (two chairs at one table, two flowers in one
 *     bed) are ambiguity without harm and are reported as warnings only.
 *
 * Proven red before trusted green, on the pre-fix build — nine failures,
 * among them the exact bug reported:
 *   x hotel.suite: 'hotel-window-hotel.suite-west' (Look out) covers the
 *     suite's door back to the corridor by 1.75 m
 *   x hotel.breakfast: 'hotel-window-hotel.breakfast-west' covers Floor 1's
 *     lift alcove by 1.90 m
 * See the commit message for the full run.
 */

import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import {
  differentActions,
  sameStorey,
  TAP_FINGER_METRES,
  zoneBandClearance,
  zoneSeparation,
  type PortalBand,
} from '../src/world/tapSpacing.ts';
import { zoneVerb, type InteractZone } from '../src/world/interact.ts';
import { hotelDoorBands, ROOMS } from '../src/world/hotel/layout.ts';
import { spaceAt, type SpaceId } from '../src/world/spaces.ts';
import { heightAboveFloor } from '../src/world/up.ts';
import { distanceToBand } from '../src/world/tapSpacing.ts';

/**
 * **Which storey a tappable thing is on, in the frame that applies where it
 * stands** — the park's `y` is not a storey any more.
 *
 * `sameStorey` compares two world `y` values against a 2.2 m tolerance, which
 * was exactly right on a flat park and is a hole on a sphere. The loops below
 * pair a zone with a *portal band* and with *another zone*, neither of which
 * need be close in plan, and on the 220 m sphere the ground falls fast: at
 * 100 m out a 3 m step towards the origin moves `y` by about 1.5 m, and near
 * the garden's edge 2.9 m of plan separation exceeds the whole tolerance. So
 * crowded stall clusters far from the park's centre were being `continue`d as
 * "a different storey" and never measured at all — `bandsChecked` and
 * `pairsChecked` simply fell, and nothing went red.
 *
 * Two things make a storey here, and they are different questions:
 *
 *  - **the space**. The castle's floors and the hotel's rooms are disjoint
 *    coordinate regions hundreds of metres apart; two things in different
 *    spaces are never on one storey however their heights compare. That was
 *    already true before the sphere and the `y` test got it right only by
 *    accident of where those spaces happen to sit.
 *  - **the height above that space's own floor**, which is `heightAboveFloor`
 *    — `altitudeAt` outdoors, a floor-relative `y` indoors.
 *
 * The **tolerance stays in `tapSpacing.ts`**: this converts the frame and then
 * asks `sameStorey`, so there is still one owner of how far apart two storeys
 * are.
 */
interface Storey {
  readonly space: SpaceId;
  readonly height: number;
}

function storeyAt(x: number, y: number, z: number): Storey {
  return { space: spaceAt(x, z), height: heightAboveFloor(x, y, z) };
}

function onSameStorey(a: Storey, b: Storey): boolean {
  return a.space === b.space && sameStorey(a.height, b.height);
}

const problems: string[] = [];
const warnings: string[] = [];
const { world } = quietly(() => buildHeadlessPark());
const { hotel } = world;

/** One space's worth of zones and the portals that share its floor. */
interface SpaceUnderTest {
  readonly name: string;
  readonly zones: readonly InteractZone[];
  readonly bands: readonly PortalBand[];
}

const spaces: SpaceUnderTest[] = [];

// The park and the castle interior. `World.interactZones` returns both at
// once (they cannot collide — the interior is hundreds of metres away in its
// own space, and every comparison below is distance-gated anyway), with the
// hotel's rooms contributing nothing while the player is outside.
const outsidePlayer = {
  position: new Vector3(0, 0, 0),
  riding: false,
  model: { setExpression: () => {} },
  teleportTo(x: number, y: number, z: number) {
    outsidePlayer.position.set(x, y, z);
  },
};
hotel.attachPlayer(outsidePlayer as never);
hotel.adoptRestoredPlayer();
spaces.push({
  name: 'the park and castle',
  zones: world.interactZones(),
  bands: [hotel.towerDoorBand(), ...world.building.doorBands()],
});

// The keychain rack's own zoomed picker (#331): six keyrings crowd one small
// cart and only become their own tappable zones once the cart's single
// entry zone has opened the camera view (`world.interactZones()` above is
// the *closed* state — the one entry zone, checked against every other
// zone in the park exactly as any other stall's would be). The two shapes
// never coexist in one snapshot (see `world/KeychainShop.ts`'s own header:
// the six would sit within a finger of a parent zone offering a different
// action), so the open state is checked as its own space here, the same way
// each hotel room below gets its own.
world.keychainShop.openView();
spaces.push({
  name: 'the keychain rack, opened',
  zones: world.keychainShop.interactZones(),
  bands: [],
});
world.keychainShop.closeView();

// Each hotel room, as the game offers it: the hotel's zones are gated on the
// player's own room, so stand the probe player in each in turn.
for (const room of ROOMS) {
  outsidePlayer.position.set(room.originX, 0, room.originZ);
  hotel.adoptRestoredPlayer();
  spaces.push({
    name: room.space,
    zones: hotel.interactZones(),
    bands: hotelDoorBands(room),
  });
}

let pairsChecked = 0;
let bandsChecked = 0;
/** Pairs dropped as different storeys that were within a finger in plan. */
let bandsSkippedWhileClose = 0;
let pairsSkippedWhileClose = 0;
for (const space of spaces) {
  for (const zone of space.zones) {
    const zoneStorey = storeyAt(zone.x, zone.y, zone.z);
    for (const band of space.bands) {
      if (band.ownZoneId === zone.id) continue;
      const bandStorey = storeyAt(band.centreX, band.y, band.centreZ);
      if (!onSameStorey(zoneStorey, bandStorey)) {
        // Announce the ones that matter: a pair this close in plan is exactly
        // what rule 1 exists for, so dropping it is worth seeing on every run.
        if (distanceToBand(band, zone.x, zone.z) - zone.pickRadius < TAP_FINGER_METRES) {
          bandsSkippedWhileClose += 1;
        }
        continue;
      }
      bandsChecked += 1;
      const clearance = zoneBandClearance(zone, band);
      if (clearance < TAP_FINGER_METRES) {
        problems.push(
          `${space.name}: '${zone.id}' (${zoneVerb(zone)}, pick ${zone.pickRadius} m) ` +
            (clearance < 0
              ? `covers ${band.what} by ${(-clearance).toFixed(2)} m`
              : `sits ${clearance.toFixed(2)} m from ${band.what}`) +
            ` — a tap aimed at the door selects it instead ` +
            `(rule: ${TAP_FINGER_METRES.toFixed(2)} m clear)`,
        );
      }
    }
  }

  for (let a = 0; a < space.zones.length; a += 1) {
    for (let b = a + 1; b < space.zones.length; b += 1) {
      const one = space.zones[a]!;
      const two = space.zones[b]!;
      const separation = zoneSeparation(one, two);
      if (!onSameStorey(storeyAt(one.x, one.y, one.z), storeyAt(two.x, two.y, two.z))) {
        if (separation < TAP_FINGER_METRES) pairsSkippedWhileClose += 1;
        continue;
      }
      if (separation >= TAP_FINGER_METRES) continue;
      pairsChecked += 1;
      if (differentActions(one, two)) {
        problems.push(
          `${space.name}: '${one.id}' (${zoneVerb(one)}) and '${two.id}' (${zoneVerb(two)}) ` +
            `sit ${Math.max(0, separation).toFixed(2)} m apart beyond the bigger pick radius — ` +
            `a tap aimed at one does the other (rule: ${TAP_FINGER_METRES.toFixed(2)} m)`,
        );
      } else {
        warnings.push(
          `${space.name}: '${one.id}' and '${two.id}' overlap but both say ` +
            `'${zoneVerb(one)}' — harmless ambiguity, left alone`,
        );
      }
    }
  }
}

console.log(
  `check:tap-spacing — ${spaces.length} spaces, ` +
    `${spaces.reduce((n, s) => n + s.zones.length, 0)} zones, ` +
    `${spaces.reduce((n, s) => n + s.bands.length, 0)} portal bands; ` +
    `finger = ${TAP_FINGER_METRES.toFixed(2)} m; ${bandsChecked} zone-band and ` +
    `${pairsChecked} close zone-zone pairs measured; ${warnings.length} same-action ` +
    `overlaps (warnings).`,
);
// A dropped pair is cover this run did NOT give, so it is announced whether or
// not anything failed — and on stderr, because a passing run is exactly the
// case the note exists for.
process.stderr.write(
  `check:tap-spacing — storeys judged by space + height above that space's own floor ` +
    `(altitudeAt outdoors), not by world y. ${bandsSkippedWhileClose} zone-band and ` +
    `${pairsSkippedWhileClose} zone-zone pair(s) were within a finger in plan but on ` +
    `different storeys, so ASSERT NOTHING this run` +
    `${bandsSkippedWhileClose + pairsSkippedWhileClose === 0 ? ' (none)' : ''}.\n`,
);
for (const warning of warnings) console.log(`  ~ ${warning}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:tap-spacing FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:tap-spacing OK');
