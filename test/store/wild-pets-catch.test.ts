// Building a pet paints its face on a canvas, which node does not have. Same
// shim every `scripts/check-*.mts` that builds a model uses. First import, so
// it is in place before anything reaches for `document`.
import '../../scripts/headless-canvas.mjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WildPets } from '../../src/world/building/WildPets';
import { TOP_DECK } from '../../src/world/building/layout';
import { gameStore } from '../../src/state';
import { shopItem } from '../../src/world/building/shops/catalogue';
import type { IsoCamera } from '../../src/core/IsoCamera';
import type { FrameContext } from '../../src/core/types';
import type { InputSystem } from '../../src/core/InputSystem';

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
