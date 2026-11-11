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
 *  3. **Standing on a zone's own stand selects it, whatever she held before.**
 *     Rule 2's warnings are about a finger: a tap aimed at one thing landing in
 *     its neighbour's pick area. This is about her feet. For every pair of
 *     zones of equal rank on one storey, the real `Selection` is stood on one
 *     zone's stand (which it then holds) and then on the other's: it must have
 *     let go of the first. The Library's big readers' shelf failed exactly
 *     this (QA, PR #734). Six books 0.6 m apart met a fixed 0.6 m hysteresis
 *     band, so every stand she walked to kept the book she had come from, and
 *     every warning rule 2 printed for those books passed it as "harmless".
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
import { standRadiusOf, zoneVerb, type InteractZone } from '../src/world/interact.ts';
import { Selection } from '../src/world/Selection.ts';
import type { FrameContext } from '../src/core/types.ts';
import { hotelDoorBands, ROOMS } from '../src/world/hotel/layout.ts';
import { SPACE_LIBRARY, SPACE_REPTILE_HOUSE } from '../src/world/spaces.ts';
import { LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z } from '../src/world/library/layout.ts';
import {
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
} from '../src/world/reptileHouse/layout.ts';

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
// The Reptile House's exterior is a park building now: its entrance and tail
// zones are in the park's list, and its front door band shares the park floor.
const [reptileEntryBand] = world.reptileHouse.doorBands();
// …and the Library's (#716): its entrance zone and its front door's band.
const [libraryEntryBand] = world.library.doorBands();
const parkZones = world.interactZones();
if (!parkZones.some((zone) => zone.id === 'library-entrance')) throw new Error("check:tap-spacing: the park offers no Library 'library-entrance' zone");
{
  const ids = parkZones.map((zone) => zone.id);
  for (const wanted of ['reptile-entrance', 'reptile-tail']) {
    if (!ids.includes(wanted)) throw new Error(`check:tap-spacing: the park offers no Reptile House '${wanted}' zone`);
  }
  if (ids.some((id) => id.startsWith('reptile:'))) {
    throw new Error(`check:tap-spacing: the park offers the Reptile House hall's zones: ${ids.filter((id) => id.startsWith('reptile:')).join(', ')}`);
  }
}
spaces.push({
  name: 'the park and castle',
  zones: parkZones,
  bands: [
    hotel.towerDoorBand(),
    ...world.building.doorBands(),
    ...(reptileEntryBand ? [reptileEntryBand] : []),
    ...(libraryEntryBand ? [libraryEntryBand] : []),
  ],
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

// The Reptile House's hall, the same way: its zones are gated on where the
// player is, and it has one door band, the exit.
{
  const { reptileHouse } = world;
  reptileHouse.attachPlayer(outsidePlayer as never);
  const [, exit] = reptileHouse.doorBands();
  outsidePlayer.position.set(REPTILE_HOUSE_ORIGIN_X, 0, REPTILE_HOUSE_ORIGIN_Z);
  reptileHouse.adoptRestoredPlayer();
  spaces.push({ name: SPACE_REPTILE_HOUSE, zones: reptileHouse.interactZones(), bands: exit ? [exit] : [] });
}

// The Library's reading room (#716): gated on where the player is, one door
// band, the way out.
{
  const { library } = world;
  library.attachPlayer(outsidePlayer as never);
  const [, exit] = library.doorBands();
  outsidePlayer.position.set(LIBRARY_ORIGIN_X, 0, LIBRARY_ORIGIN_Z);
  library.adoptRestoredPlayer();
  spaces.push({ name: SPACE_LIBRARY, zones: library.interactZones(), bands: exit ? [exit] : [] });
}

let pairsChecked = 0;
let bandsChecked = 0;
/** What was measured in each space, so a space's own counts can be quoted (written to stderr below). */
const perSpace: { name: string; zones: number; bands: number; zoneBand: number; close: number }[] = [];
for (const space of spaces) {
  const measured = { name: space.name, zones: space.zones.length, bands: space.bands.length, zoneBand: 0, close: 0 };
  perSpace.push(measured);
  for (const zone of space.zones) {
    for (const band of space.bands) {
      if (band.ownZoneId === zone.id) continue;
      if (!sameStorey(zone.y, band.y)) continue;
      bandsChecked += 1;
      measured.zoneBand += 1;
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
      measured.close += 1;
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

// 3. Standing on a zone's own stand selects it: the real `Selection`, stood on
// one zone's stand and then ON its neighbour's, must let go of the first.
/**
 * **"On a stand", as a child stands on it: within 5 cm, from any side.** QA
 * stopped on each of the shelf's stands by the F3 readout, which reads to
 * 0.1 m. Standing *exactly* on a stand is not something a child does. It was
 * also, under the old fixed band, a floating-point coin toss: 2 of the shelf's
 * 10 neighbouring pairs held on the stand itself, and every one of them held
 * a few centimetres off it.
 */
const ON_STAND = 0.05;
const ON_STAND_PROBES = [
  [0, 0],
  ...Array.from({ length: 8 }, (_, i) => [ON_STAND * Math.cos((i * Math.PI) / 4), ON_STAND * Math.sin((i * Math.PI) / 4)] as const),
] as const;
const heldOnAnother: string[] = [];
const sharedStands: string[] = [];
let standPairs = 0;
let standPairsSkipped = 0;
let standProbes = 0;
/** Per space, for stderr: what rule 3 had to work with, and what it stood on. */
const rule3BySpace = new Map<string, { selectable: number; pairs: number; nearest: number }>();
for (const space of spaces) {
  const selectable = space.zones.filter((zone) => (zone.actions?.().length ?? 0) > 0);
  const tally = { selectable: selectable.length, pairs: 0, nearest: Infinity };
  rule3BySpace.set(space.name, tally);
  for (const held of selectable) {
    for (const next of selectable) {
      if (held === next || held.id === next.id) continue;
      if (!sameStorey(held.y, next.y)) continue;
      if ((held.selectRank ?? 0) !== (next.selectRank ?? 0)) continue;
      const gap = Math.hypot(held.standX - next.standX, held.standZ - next.standZ);
      if (gap > 0) tally.nearest = Math.min(tally.nearest, gap);
      // Out of the held zone's reach on the other's stand: nothing is left to hold there.
      if (gap > standRadiusOf(held)) continue;
      if (gap === 0) {
        if (held.id < next.id) sharedStands.push(`${space.name}: '${held.id}' and '${next.id}'`);
        continue;
      }
      /** What may answer on `next`'s stand: `next`, or a zone of its rank on that very stand (proximity cannot tell those apart; counted above). */
      const allowed = new Set(
        selectable
          .filter((zone) => zone.id === next.id || ((zone.selectRank ?? 0) === (next.selectRank ?? 0) && zone.standX === next.standX && zone.standZ === next.standZ))
          .map((zone) => zone.id),
      );
      let skipped = false;
      const missed: string[] = [];
      for (const [dx, dz] of ON_STAND_PROBES) {
        // A fresh selection each time, its probe standing where she would stand.
        const probe = { position: new Vector3(held.standX, held.y, held.standZ), riding: false };
        const selection = new Selection(probe as never, {} as never, { dataset: {} } as unknown as HTMLCanvasElement, {
          zones: () => space.zones,
          blocked: () => false,
          walkTo: () => {},
          walking: () => false,
          flash: () => {},
        });
        const context = { dt: 1 / 60, elapsed: 0, playerPosition: probe.position, frame: 0 } as unknown as FrameContext;
        selection.update(context);
        if (selection.selected?.id !== held.id) {
          // On its own stand something else wins (a zone sharing that stand, or
          // one that outranks it), so this pair has nothing to hold.
          skipped = true;
          break;
        }
        probe.position.set(next.standX + dx, next.y, next.standZ + dz);
        selection.update(context);
        standProbes += 1;
        const got = selection.selected?.id ?? null;
        if (got === null || !allowed.has(got)) {
          missed.push(`(${dx.toFixed(3)}, ${dz.toFixed(3)}) off it: ${got === null ? 'nothing' : got === held.id ? `still '${got}'` : `'${got}'`}`);
        }
      }
      if (skipped) {
        standPairsSkipped += 1;
        continue;
      }
      standPairs += 1;
      tally.pairs += 1;
      if (missed.length > 0) {
        heldOnAnother.push(
          `${space.name}: on '${next.id}''s own stand, come from '${held.id}' (whose stand is ${gap.toFixed(3)} m away), ` +
            `the selection is not '${next.id}'${allowed.size > 1 ? ' (nor a zone sharing its stand)' : ''} at ${missed.length} of ${ON_STAND_PROBES.length} points within ${ON_STAND} m of the stand — ` +
            `${missed.slice(0, 3).join('; ')}${missed.length > 3 ? '; …' : ''} — walk from one to the other and she gets the wrong one ` +
            `(rule: on a zone's own stand, that zone is selected)`,
        );
      }
    }
  }
}
for (const line of heldOnAnother) problems.push(line);

console.log(
  `check:tap-spacing — ${spaces.length} spaces, ` +
    `${spaces.reduce((n, s) => n + s.zones.length, 0)} zones, ` +
    `${spaces.reduce((n, s) => n + s.bands.length, 0)} portal bands; ` +
    `finger = ${TAP_FINGER_METRES.toFixed(2)} m; ${bandsChecked} zone-band and ` +
    `${pairsChecked} close zone-zone pairs measured; ${warnings.length} same-action ` +
    `overlaps (warnings); ${standPairs} pairs stood on, one stand then the other ` +
    `(${standProbes} probes within ${ON_STAND} m of it), ${heldOnAnother.length} not letting go.`,
);
for (const warning of warnings) console.log(`  ~ ${warning}`);
for (const space of perSpace) {
  process.stderr.write(
    `  ${space.name}: ${space.zones} zones, ${space.bands} portal band(s); ${space.zoneBand} zone-band and ${space.close} close zone-zone pairs measured; ` +
      `rule 3: ${rule3BySpace.get(space.name)?.selectable ?? 0} selectable, the nearest two stands of equal rank ` +
      `${Number.isFinite(rule3BySpace.get(space.name)?.nearest ?? Infinity) ? `${rule3BySpace.get(space.name)!.nearest.toFixed(2)} m apart` : 'none'}, ` +
      `${rule3BySpace.get(space.name)?.pairs ?? 0} pairs within reach of each other stood on\n`,
  );
}
process.stderr.write(
  `  rule 3: ${standPairs} ordered pairs of equal-rank zones within reach of each other stood on, one stand then the other, ` +
    `${standProbes} probes; ${standPairsSkipped} skipped (on its own stand something else wins); ` +
    `${sharedStands.length} pair(s) share one stand, which proximity cannot tell apart${sharedStands.length ? ` — ${sharedStands.join('; ')}` : ''}\n`,
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:tap-spacing FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:tap-spacing OK');
