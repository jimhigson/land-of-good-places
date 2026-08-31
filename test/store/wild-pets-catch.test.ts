// Building a pet paints its face on a canvas, which node does not have. Same
// shim every `scripts/check-*.mts` that builds a model uses. First import, so
// it is in place before anything reaches for `document`.
import '../../scripts/headless-canvas.mjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WildPets } from '../../src/world/building/WildPets';
import {
  TOP_DECK,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_X,
  TRAMPOLINE_Z,
} from '../../src/world/building/layout';
import {
  BURROW_COUNT,
  BURROW_MIN_SPACING,
  BURROW_RADIUS,
  roofBurrows,
  roofMeadow,
} from '../../src/world/building/roofMeadow';
import { SLIDE_PLAN } from '../../src/world/slide/plan';
import { keepOutsFor } from '../../src/world/building/dressing';
import { CASTLE_FLOOR_RADIUS, CASTLE_ROOF } from '../../src/world/building/floors';

/** `WildPets`' own catch radius, re-stated here rather than exported: this is a
 *  test about where a tap target sits, and 2.2 m is the distance at which
 *  "Catch it!" becomes pressable. */
const CATCH_RADIUS = 2.2;
import { PLAYER_RADIUS } from '../../src/core/constants';
import { gameStore } from '../../src/state';
import { shopItem } from '../../src/world/building/shops/catalogue';
import type { IsoCamera } from '../../src/core/IsoCamera';
import type { FrameContext } from '../../src/core/types';
import type { InputSystem } from '../../src/core/input';

/**
 * **Catching a wild one, and the two promises that make the chase fair.**
 *
 * Issue #406. These run against the real `WildPets` driving the real roof
 * meadow, because the interesting claims are all about behaviour over time and
 * none of them can be read off the source:
 *
 * - **The pet she catches is the pet she owns.** The whole feature rests on a
 *   caught animal resolving to a catalogue entry the parade, the Cute-o-dex and
 *   the hotel bed can all talk about. A wild creature whose id was not in the
 *   catalogue would be caught, vanish, and leave her with nothing — the exact
 *   ghost shape this repo keeps producing.
 * - **She cannot fail.** Jim ruled no failure state, and the rule that makes it
 *   literally true rather than nominally is that a creature *never begins a
 *   dive while she is within `SAFE_DIVE_RANGE`*. That is a claim about a state
 *   machine under a moving player, and the only honest way to check it is to
 *   run the thing with her stood next to a burrow and see that nothing leaves.
 *
 * The camera is a stub: `WildPets` only wants one to size a speech bubble on
 * screen, and none of this is about where that bubble lands.
 */

/** Enough `IsoCamera` for `SpeechBubble.updateScreenSize` and no more. */
const camera = {
  focusPoint: new Vector3(0, 0, 0),
  worldUnitsPerPixel: 0.01,
  clampToFrustum: (point: Readonly<Vector3>) => new Vector3(point.x, point.y, point.z),
  // Everything is in shot — this stub has no frustum, and none of these tests
  // is about where the bubble lands. `check:speech-bubbles` owns that question
  // against a real camera (#415).
  isOnScreen: () => true,
} as unknown as IsoCamera;

function frame(elapsed: number, dt: number, playerAt: Vector3): FrameContext {
  return {
    dt,
    elapsed,
    input: {} as unknown as InputSystem,
    playerPosition: playerAt,
    cameraForward: new Vector3(0, 0, 1),
    frame: Math.round(elapsed * 60),
  };
}

/** Runs the system for `seconds` at a steady 60 Hz with the player parked. */
function run(pets: WildPets, seconds: number, playerAt: Vector3): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) pets.update(frame(t, dt, playerAt));
}

/** Every zone `WildPets` is currently offering, by the creature behind it. */
function catchActions(pets: WildPets) {
  return pets
    .interactZones()
    .flatMap((zone) => (zone.actions?.() ?? []).map((action) => ({ zone, action })));
}

function petsOwned() {
  return gameStore.get().inventory.filter((item) => item.kind === 'pet');
}

describe('wild pets in the roof garden', () => {
  let pets: WildPets;

  // The store is a module singleton with no reset, so — exactly as
  // `live-look.test.ts` does — everything here is measured as a **delta**
  // rather than an absolute count. A fresh `WildPets` per test is enough
  // isolation for the system itself, which owns all its own state.
  beforeEach(() => {
    pets = new WildPets(TOP_DECK, camera);
  });

  it('has somewhere to live at all — a meadow and burrows on the roof', () => {
    expect(pets.inhabited, 'the roof deck must have long grass and burrows').toBe(true);
  });

  it('surfaces creatures that then roam, rather than standing on their burrow', () => {
    const far = new Vector3(200, 0, 200);
    run(pets, 6, far);
    const first = pets.interactZones().map((z) => ({ id: z.id, x: z.standX, z: z.standZ }));
    expect(first.length, 'something should be out after six seconds').toBeGreaterThan(0);

    run(pets, 4, far);
    const later = pets.interactZones().map((z) => ({ id: z.id, x: z.standX, z: z.standZ }));
    const moved = later.some((l) => {
      const was = first.find((f) => f.id === l.id);
      return was && Math.hypot(l.x - was.x, l.z - was.z) > 1;
    });
    expect(moved, 'a creature that is out should have gone somewhere').toBe(true);
  });

  it('offers "Catch it!" on every creature that is out', () => {
    run(pets, 8, new Vector3(200, 0, 200));
    const actions = catchActions(pets);
    expect(actions.length).toBeGreaterThan(0);
    for (const { action } of actions) expect(action.label).toBe('Catch it!');
  });

  it('catching one makes it hers — a real catalogue pet, out and walking', () => {
    run(pets, 8, new Vector3(200, 0, 200));
    const before = petsOwned().length;

    const first = catchActions(pets)[0];
    expect(first, 'there must be something to catch').toBeDefined();
    first!.action.run();

    const after = petsOwned();
    expect(after.length).toBe(before + 1);
    const caught = after[after.length - 1]!;
    // The point of the whole feature: it resolves in the catalogue, so the
    // parade can build it rather than skipping it.
    expect(shopItem(caught.id), `${caught.id} must be a real catalogue entry`).not.toBeNull();
    expect(caught.paradeable).toBe(true);
    expect(caught.stowed, 'it should fall in behind her, not vanish into the backpack').toBe(false);
  });

  it('the caught creature leaves the roof, and another comes to replace it', () => {
    run(pets, 8, new Vector3(200, 0, 200));
    const before = pets.interactZones().length;
    const first = catchActions(pets)[0];
    first!.action.run();
    expect(pets.interactZones().length).toBe(before - 1);

    // A roof that emptied because she was good at catching would punish her.
    run(pets, 12, new Vector3(200, 0, 200));
    expect(pets.interactZones().length).toBeGreaterThanOrEqual(before);
  });

  it('lets her keep every one she catches — there is no cap', () => {
    const far = new Vector3(200, 0, 200);
    const before = petsOwned().length;
    let caught = 0;
    for (let i = 0; i < 8; i += 1) {
      run(pets, 8, far);
      const next = catchActions(pets)[0];
      if (!next) continue;
      next.action.run();
      caught += 1;
    }
    expect(caught, 'the test should actually have caught several').toBeGreaterThanOrEqual(5);
    expect(petsOwned().length - before).toBe(caught);
  });

  it('a wild RiPika is the mossy one, not a second identical yellow mouse', () => {
    // Whichever kinds surface, any RiPika among them must grant the wild entry.
    const far = new Vector3(200, 0, 200);
    for (let i = 0; i < 12; i += 1) {
      run(pets, 6, far);
      for (const { action } of catchActions(pets)) action.run();
    }
    const owned = petsOwned().map((item) => item.id);
    expect(owned.length).toBeGreaterThan(0);
    // The tame `pet.ripika` is the starter, granted by character creation —
    // never by the grass.
    expect(owned, 'the grass must never hand out the tame yellow RiPika').not.toContain('pet.ripika');
    if (owned.includes('pet.ripikaWild')) {
      expect(shopItem('pet.ripikaWild')?.displayName).toBe('RiPika');
    }
  });

  /**
   * The promise that makes "no failure state" real.
   *
   * **She has to actually be chasing.** The first version of this parked her
   * on a creature's position, ran eight seconds, and re-read where it had got
   * to — and it failed, correctly: in those eight seconds the creature ran
   * twenty metres off, which puts it well outside `SAFE_DIVE_RANGE`, and a
   * creature that has genuinely escaped is *allowed* to go home. Standing
   * still while it runs away is not chasing it, and the rule was never that a
   * creature must live forever because she once stood near it.
   *
   * So this keeps her on its heels **every frame**, which is what a child
   * tapping after it actually does. While she is that close it must never
   * leave, because "closing the distance is always progress" is the whole of
   * why she cannot lose.
   */
  it('never lets one dive while she is right behind it', () => {
    const far = new Vector3(200, 0, 200);
    run(pets, 10, far);
    const target = pets.interactZones()[0];
    expect(target, 'something must be out to chase').toBeDefined();

    const dt = 1 / 60;
    const chaser = new Vector3();
    let survived = true;
    // Well past `TIME_ABOVE_GROUND`'s 35–60 s ceiling, so it has had every
    // chance to get bored and go home.
    for (let t = 0; t < 120; t += dt) {
      const live = pets.interactZones().find((z) => z.id === target!.id);
      if (!live) {
        survived = false;
        break;
      }
      // Right behind it — two metres, inside SAFE_DIVE_RANGE by a mile.
      chaser.set(live.standX + 2, 0, live.standZ);
      pets.update(frame(t, dt, chaser));
    }
    expect(survived, 'a creature she is right behind must never vanish down a hole').toBe(true);
  });

  /**
   * The other half of the same promise, and the one that proves the gate is
   * doing something rather than nothing: left alone, a creature **does**
   * eventually go home, and another takes its place.
   *
   * Without this, a gate that simply froze every creature forever would pass
   * the test above — and that was very nearly what shipped. `burrowAwayFrom`
   * returned `null` for every creature, so nothing ever left, the population
   * hit its cap of four in the first fifteen seconds and stood there for the
   * rest of the session. Measured: 200 s with her far away gave 4 creatures
   * and **0 departures**. It is 16 and 13 now.
   */
  it('but does let one go home when she is nowhere near', () => {
    const far = new Vector3(200, 0, 200);
    const seen = new Set<string>();
    const gone = new Set<string>();
    const dt = 1 / 60;
    for (let t = 0; t < 200; t += dt) {
      pets.update(frame(t, dt, far));
      const live = new Set(pets.interactZones().map((z) => z.id));
      for (const id of live) seen.add(id);
      for (const id of seen) if (!live.has(id)) gone.add(id);
    }
    expect(gone.size, 'creatures must cycle, or the roof is the same four forever').toBeGreaterThan(3);
    expect(seen.size).toBeGreaterThan(gone.size - 1);
  });
});

/**
 * **The roof has to actually get its five holes.**
 *
 * These exist because of a silent failure, not a hypothetical one. The castle's
 * floor split (#377/#380) shrank the roof plate under this feature, and the
 * meadow absorbed it exactly as its derivation promised — it scored the new
 * clearance and moved. `BURROW_SPACING` did not move: it was a hard 6 m gate
 * chosen against the *old* plate, so the farthest-point pass ran out of room
 * after three burrows and returned three. Every check stayed green, `tsc`
 * stayed green, and the roof simply had fewer holes in it.
 *
 * That is the whole lesson of derived placement done half way. Deriving the
 * positions does not help if a threshold beside them is still a number typed
 * against a floor that no longer exists — and this class of fault fails by
 * producing *less*, which no assertion about what was produced can notice
 * unless it is told how much to expect.
 *
 * So: assert the count, and assert the property the spacing was protecting,
 * separately. Relaxing the spacing to reach the count is only sound while the
 * second of these still holds.
 */
describe('the roof garden gets the burrows it asks for', () => {
  const burrows = roofBurrows(TOP_DECK);

  it('digs the full count, however tight the plate gets', () => {
    expect(
      burrows.length,
      'five holes against a population of four, so there is always one to run to that is not the one it came out of',
    ).toBe(BURROW_COUNT);
  });

  it('never puts two so close that one cannot be run to', () => {
    let closest = Infinity;
    for (let i = 0; i < burrows.length; i += 1) {
      for (let j = i + 1; j < burrows.length; j += 1) {
        const a = burrows[i]!;
        const b = burrows[j]!;
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    // `WildPets.burrowAwayFrom` discards any burrow within 2 m of the creature
    // as "the one it came out of". Two holes closer than that would make the
    // second unreachable as a destination, which is how a creature that can
    // never go home gets built by accident for the second time.
    expect(closest, 'two burrows must never read as one, nor shadow each other').toBeGreaterThan(2);
    expect(closest).toBeGreaterThanOrEqual(BURROW_MIN_SPACING);
  });

  it('keeps every burrow inside the long grass and clear of the roof furniture', () => {
    const meadow = roofMeadow(TOP_DECK);
    for (const burrow of burrows) {
      expect(meadow.contains(burrow.x, burrow.z), `burrow at ${burrow.x},${burrow.z} must be in the grass`).toBe(true);
    }
  });

  /**
   * The mound measured against **the castle's own keep-out list**, at the
   * threshold `check:castle` uses — `keep-out radius + PLAYER_RADIUS` against
   * the prop's whole footprint — rather than against the generator's own
   * selection rule.
   *
   * Deliberately not `meadow.clearanceAt >= BURROW_RADIUS + PLAYER_RADIUS`,
   * which is what this used to say. That reads a number back out of the rule
   * that produced the burrows, so it could only ever agree with itself; and it
   * was also simply wrong once `KEEP_OUT_MARGIN` became derived, because the
   * meadow's clearance is already measured against a grass tuft's reach, which
   * is larger than a mound's. It cost a burrow before it was noticed.
   */
  it('leaves a child room to walk round every mound', () => {
    for (const burrow of burrows) {
      for (const keepOut of keepOutsFor(TOP_DECK)) {
        expect(
          Math.hypot(burrow.x - keepOut.x, burrow.z - keepOut.z),
          `a mound at ${burrow.x.toFixed(1)},${burrow.z.toFixed(1)} against the keep-out at ${keepOut.x.toFixed(1)},${keepOut.z.toFixed(1)}`,
        ).toBeGreaterThanOrEqual(keepOut.radius + PLAYER_RADIUS + BURROW_RADIUS);
      }
    }
  });

  /**
   * The ginormous slide launches from this floor, and its roof entry is the
   * fragile thing up here: the split already caught its start height putting
   * the chute 3.76 m inside solid battlements on every seed. Long grass she
   * cannot see her feet through, or a hole to trip in, right where she boards
   * it is the same fault in a cheaper form.
   */
  it('leaves the ginormous slide its boarding pad', () => {
    const meadow = roofMeadow(TOP_DECK);
    expect(meadow.contains(SLIDE_PLAN.entryX, SLIDE_PLAN.entryZ)).toBe(false);
    for (const burrow of burrows) {
      expect(
        Math.hypot(burrow.x - SLIDE_PLAN.entryX, burrow.z - SLIDE_PLAN.entryZ),
        'no burrow within reach of where she boards the slide',
      ).toBeGreaterThan(BURROW_RADIUS + PLAYER_RADIUS);
    }
  });

  /**
   * The trampoline survived the split as a toy on the roof — a new neighbour
   * the meadow did not have when it was written, and one that is not in
   * `keepOutsFor`. Grass growing up through a pad a child bounces on is the
   * kind of thing only a person looking at it would ever report.
   */
  it('leaves the trampoline pad clear', () => {
    const meadow = roofMeadow(TOP_DECK);
    expect(meadow.contains(TRAMPOLINE_X, TRAMPOLINE_Z)).toBe(false);
    for (const cell of meadow.cells) {
      expect(
        Math.hypot(cell.x - TRAMPOLINE_X, cell.z - TRAMPOLINE_Z),
        'no long grass on the trampoline',
      ).toBeGreaterThan(TRAMPOLINE_RADIUS);
    }
  });
});

/**
 * **A tap target has to be in the same coordinate system as the player.**
 *
 * This is the test for the bug that made the whole feature inoperable, and it
 * is written against the *frame* rather than against a distance because a
 * distance test cannot see the fault: the class compared the player's world
 * position against floor-local creature coordinates, so both sides of every
 * comparison were self-consistent and only the answer was wrong.
 *
 * Since #377/#380 the roof garden's plate stands 600 m along +X from the mall.
 * Standing a real player exactly on top of a real bunny, the running game
 * measured the gap between them at **1341.6 m**. `SAFE_DIVE_RANGE` was
 * therefore never satisfied and the dive gate never engaged; nothing ever
 * fled; and "Catch it!" could not appear at any distance, so no creature could
 * ever be caught. Nothing was red — `tsc` sees two numbers, the check chain has
 * no opinion, and the behavioural tests above drove the class in local metres
 * from *both* sides, so they agreed with each other and with nothing else.
 *
 * The fix is one subtraction on the way in and one addition on the way out.
 * The test is that the way out lands where `World.interactZones` will look.
 */
describe('the wild pets are where the player is', () => {
  it('offers its tap targets in world metres, on the roof floor plate', () => {
    const pets = new WildPets(TOP_DECK, camera);
    // Far enough away in *world* metres to leave them roaming undisturbed.
    run(pets, 10, new Vector3(CASTLE_ROOF.originX + 200, 0, CASTLE_ROOF.originZ + 200));
    const zones = pets.interactZones();
    expect(zones.length, 'something must be out').toBeGreaterThan(0);

    for (const zone of zones) {
      // The plate's half-extents plus generous slack. A floor-local coordinate
      // would land near the origin and fail this by ~1200 m, which is exactly
      // the failure that shipped.
      expect(Math.hypot(zone.x - CASTLE_ROOF.originX, zone.z - CASTLE_ROOF.originZ)).toBeLessThan(
        CASTLE_FLOOR_RADIUS,
      );
      expect(Math.hypot(zone.standX - CASTLE_ROOF.originX, zone.standZ - CASTLE_ROOF.originZ)).toBeLessThan(
        CASTLE_FLOOR_RADIUS,
      );
    }
  });

  /**
   * The same contract from the other end: **the tap target and the creature a
   * child can see must be the same animal.**
   *
   * `pets.root` is parented to the roof's own floor group, so what is drawn is
   * positioned in floor-local metres and comes out in the right place on
   * screen *whatever* the zone says — which is precisely why the bug was
   * invisible. The animals looked perfect. Only the thing you tap was
   * somewhere else. So this measures the zone against the mesh rather than
   * against another number the same code produced.
   */
  it('puts the tap target on the creature that is drawn', () => {
    const pets = new WildPets(TOP_DECK, camera);
    run(pets, 10, new Vector3(CASTLE_ROOF.originX + 200, 0, CASTLE_ROOF.originZ + 200));
    const zones = pets.interactZones();
    expect(zones.length, 'something must be out').toBeGreaterThan(0);

    // Where the meshes actually are, in the floor-local frame they are drawn in.
    const drawn = pets.root.children
      .filter((child) => child.type === 'Group')
      .map((child) => ({ x: child.position.x, z: child.position.z }));
    expect(drawn.length, 'the creatures must be in the scene graph').toBeGreaterThan(0);

    for (const zone of zones) {
      const localX = zone.x - CASTLE_ROOF.originX;
      const localZ = zone.z - CASTLE_ROOF.originZ;
      const nearest = Math.min(
        ...drawn.map((d) => Math.hypot(d.x - localX, d.z - localZ)),
      );
      expect(
        nearest,
        'every "Catch it!" must sit on an animal she can see, not on empty roof',
      ).toBeLessThan(CATCH_RADIUS);
    }
  });
});
