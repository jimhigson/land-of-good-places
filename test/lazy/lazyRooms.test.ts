// The canvas shim every model-building check uses. First import, so it is in
// place before any art module paints a texture at load.
import '../../scripts/headless-canvas.mjs';
// The park's solver, as every test that builds park modules installs it.
import '../../procgen/install.ts';
import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { LazyPart } from '../../src/world/LazyPart';
import { REPTILE_HALL } from '../../src/world/interiors';
import { CollisionWorld } from '../../src/world/Collision';
import { WalkSurfaces } from '../../src/world/building/surfaces';
import { IsoCamera } from '../../src/core/IsoCamera';
import { Player } from '../../src/entities/Player';
import { ReptileHouse } from '../../src/world/reptileHouse/ReptileHouse';
import { REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z } from '../../src/world/reptileHouse/layout';
import type { InteriorControls } from '../../src/world/building/Building';
import type { FrameContext } from '../../src/core/types';

/**
 * **Lazy rooms (#749): the two ways a room loaded on demand could strand her.**
 *
 * 1. A fetch that **hangs** must become a failure, so the iris, the curtain or
 *    the held park all take the failure path they already have, rather than
 *    waiting for ever with nothing she can press (`LazyPart`'s timeout).
 * 2. A save that restores her **inside** the Reptile House hall when its floor
 *    has not loaded must never stand her in the hall while the floor is built
 *    round her — a prop's collider registered on top of her is a box she can
 *    never leave. She waits at the door and is taken in behind the iris, to the
 *    spot she saved at, once the floor is solid.
 *
 * Deliberately **without** `scripts/lib/eagerInteriors.mts`: this file is the
 * browser's case, where nothing is provided up front. Vitest isolates each
 * file, so the hall here is genuinely not loaded until something loads it.
 */
describe('a lazy part', () => {
  it('rejects, naming itself, when its fetch hangs', async () => {
    const hung = new LazyPart<number>('the hung room', () => new Promise<number>(() => {}), { timeoutMs: 40 });
    await expect(hung.load()).rejects.toThrow(/the hung room did not arrive within 40 ms/);
  });

  it('after a failure, waits before trying again, then fetches under a fresh URL', async () => {
    // The browser's own behaviour, modelled: once the plain import has failed,
    // it fails again at once and never fetches (QA on #749, Chromium and WebKit).
    const fetched: string[] = [];
    const plain = (): Promise<number> => {
      fetched.push('plain');
      return Promise.reject(new Error('Failed to fetch dynamically imported module'));
    };
    const part = new LazyPart<number>('the flaky room', plain, {
      timeoutMs: 1000,
      retryAfterMs: 50,
      refetch: (attempt) => {
        fetched.push(`fresh ${attempt}`);
        return Promise.resolve(7);
      },
    });
    await expect(part.load()).rejects.toThrow(/Failed to fetch/);
    // Asked again at once (the door asks every frame): the same failure, and no fetch at all.
    await expect(part.load()).rejects.toThrow(/Failed to fetch/);
    expect(fetched).toEqual(['plain']);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(part.load()).resolves.toBe(7);
    expect(fetched).toEqual(['plain', 'plain', 'fresh 1']);
    expect(part.loaded).toBe(7);
  });
});

describe('a lazy part that is slow rather than hung (#752)', () => {
  it('keeps a fetch that lands after its deadline, and the next load joins it rather than fetching again', async () => {
    let fetches = 0;
    let land: (value: number) => void = () => {};
    const part = new LazyPart<number>(
      'the slow room',
      () => {
        fetches += 1;
        return new Promise<number>((resolve) => {
          land = resolve;
        });
      },
      { timeoutMs: 30, retryAfterMs: 0 },
    );
    await expect(part.load()).rejects.toThrow(/did not arrive within 30 ms/);
    land(9);
    await Promise.resolve();
    await Promise.resolve();
    expect(part.loaded, 'the late arrival is kept').toBe(9);
    await expect(part.load()).resolves.toBe(9);
    expect(fetches, 'and nothing was fetched twice').toBe(1);
  });

  it('a retry while the slow fetch is still on its way joins it', async () => {
    let fetches = 0;
    let land: (value: number) => void = () => {};
    const part = new LazyPart<number>(
      'the slower room',
      () => {
        fetches += 1;
        return new Promise<number>((resolve) => {
          land = resolve;
        });
      },
      { timeoutMs: 30, retryAfterMs: 0, refetch: () => Promise.reject(new Error('should not refetch a fetch still on its way')) },
    );
    await expect(part.load()).rejects.toThrow(/did not arrive/);
    const again = part.load();
    land(4);
    await expect(again).resolves.toBe(4);
    expect(fetches).toBe(1);
  });

  it('has no deadline on the dev server, where a first load compiles its graph', async () => {
    // Vitest runs with `import.meta.env.DEV` true, as the dev server does.
    let land: (value: number) => void = () => {};
    const part = new LazyPart<number>('the compiling room', () => new Promise<number>((resolve) => { land = resolve; }));
    vi.useFakeTimers();
    try {
      const loading = part.load();
      let settled = 'pending';
      loading.then(() => (settled = 'resolved'), () => (settled = 'rejected'));
      // Well past the built game's 20 s guard: a cold dev server took 24 s.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled, 'still waiting for the compile, not given up on').toBe('pending');
      land(3);
      await expect(loading).resolves.toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a save restored inside the Reptile House hall before its floor is loaded', () => {
  it('waits at the door, and is taken in only once the floor is solid', async () => {
    expect(REPTILE_HALL.loaded, 'control: the hall must not be loaded at the start, or this measures nothing').toBeNull();

    // The iris as the game runs it: the midpoint waits for `ready`.
    const wipes: Promise<void>[] = [];
    const controls: InteriorControls = {
      cancelWalk: () => {},
      iris: (midpoint, ready) => {
        wipes.push((ready ?? Promise.resolve()).then(() => midpoint()));
      },
      flash: () => {},
      snapCamera: () => {},
      openShop: () => {},
    };
    const collision = new CollisionWorld();
    const camera = new IsoCamera();
    const house = new ReptileHouse(collision, controls, new WalkSurfaces(), { plot: null, anchorPlots: null, camera, nightFactor: () => 0 });
    expect(house.furnished).toBe(false);

    // Where the save put her: a spot on the hall floor, hall-local (6, 15.8).
    const saved = { x: 6, z: 15.8 };
    const player = new Player(collision, camera, new Vector3(REPTILE_HOUSE_ORIGIN_X + saved.x, 0, REPTILE_HOUSE_ORIGIN_Z + saved.z));
    house.attachPlayer(player);
    house.adoptRestoredPlayer();
    // What `Game` does next, after every adoption: puts her back on the spot
    // she saved at. A fix that moved her out during adoption alone was undone
    // by this and left her in the empty hall (QA's browser run).
    player.teleportTo(REPTILE_HOUSE_ORIGIN_X + saved.x, 0, REPTILE_HOUSE_ORIGIN_Z + saved.z, 0);
    expect(house.playerIsInside, 'not counted as inside a hall whose floor is not there').toBe(false);

    const inHall = (): boolean =>
      Math.hypot(player.position.x - REPTILE_HOUSE_ORIGIN_X, player.position.z - REPTILE_HOUSE_ORIGIN_Z) < 200;
    const frame = { dt: 1 / 60, elapsed: 0, frame: 1, playerPosition: player.position, input: { manualMoveActive: false, moveAmount: 0, justPressed: () => false } } as unknown as FrameContext;
    house.update(frame);
    expect(house.playerIsInside || inHall(), 'after the first frame she must not be in the hall while its floor is not there').toBe(false);
    expect(wipes.length, 'the first frame starts the walk in through the door').toBe(1);
    expect(house.playerIsInside, 'still outside while the floor is fetched').toBe(false);

    await Promise.all(wipes);
    expect(house.furnished, 'the floor is built before she is put in the hall').toBe(true);
    expect(house.playerIsInside).toBe(true);
    expect(player.position.x - REPTILE_HOUSE_ORIGIN_X).toBeCloseTo(saved.x, 5);
    expect(player.position.z - REPTILE_HOUSE_ORIGIN_Z).toBeCloseTo(saved.z, 5);
    expect(house.solids.length, 'and the hall she is in is solid').toBeGreaterThan(0);
  });
});
