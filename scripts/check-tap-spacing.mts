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
for (const space of spaces) {
  for (const zone of space.zones) {
    for (const band of space.bands) {
      if (band.ownZoneId === zone.id) continue;
      if (!sameStorey(zone.y, band.y)) continue;
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
      if (!sameStorey(one.y, two.y)) continue;
      const separation = zoneSeparation(one, two);
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
for (const warning of warnings) console.log(`  ~ ${warning}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:tap-spacing FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:tap-spacing OK');
