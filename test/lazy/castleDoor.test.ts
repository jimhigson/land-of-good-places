import { describe, expect, it, vi } from 'vitest';
import type { Vector3 } from 'three';
import type { InteriorControls } from '../../src/world/building/Building';
import type { FrameContext } from '../../src/core/types';

/**
 * **The castle's front door, with nothing provided up front** (#759): the
 * browser's case, where the castle's interior is a lazy chunk
 * (`world/interiors.ts`'s `CASTLE_INTERIOR`) that nothing has loaded yet.
 *
 * Two things a child would meet, pinned on the real `Building`:
 *
 * 1. **Offline before the chunk was ever cached**, the door refuses: she is
 *    never stood in an interior that is not there, and the door does not fire
 *    again while she stands in it (`refuseDoor`, `doorRefused` — a door that
 *    re-fired every cooldown flashed the screen on a loop, QA on #749). Once
 *    she has stepped out of the doorway it will try again.
 * 2. **With the chunk prefetched on her way back**, the door builds the
 *    interior behind its shut iris and never in the frame that asked it to
 *    close (QA on #759: in Safari's engine that frame took 300 ms and the
 *    world was swapped with no iris over it at all). Only then is she stood on
 *    the mall, with the banquet and the dressing already solid round her.
 *
 * **Every park module is imported inside the test, after the checked-in park
 * is offered** — `test/procgen/parkFacts.ts`'s reason: `parkManifest.ts` asks
 * for the park file once, as it loads, and a static import would load it
 * before the offer and solve the park instead (measured: 178 s on an M4 Pro,
 * against a few seconds hydrated). A file of its own for the same reason:
 * `lazyRooms.test.ts` imports the park statically.
 *
 * Deliberately without `scripts/lib/eagerInteriors.mts`, like
 * `lazyRooms.test.ts`: nothing is provided up front.
 *
 * **Proved red** (13 Nov 2026, seed 5's checked-in park, `CASTLE_INTERIOR`
 * the real chunk) by putting back main's order in
 * `SpaceManager.changeToFurnished` — fetch and build at once,
 * `room.part.load().then(() => room.build())`:
 *
 *     FAIL  test/lazy/castleDoor.test.ts > the castle's front door, with nothing provided up front
 *     AssertionError: built in the frame that asked the iris to close — in front of it: expected true to be false
 *
 * and green again with the order restored (the build in the iris's midpoint),
 * registering 55 colliders behind the shut iris.
 */

/** The iris as the game runs it, held until the test says it is shut — see `lazyRooms.test.ts`. */
interface HeldWipe {
  readonly midpoint: () => void;
  readonly ready: Promise<unknown> | undefined;
}

/** Everything the door's own frame runs before the browser draws it: every microtask, and a macrotask. */
async function afterTheDoorFrame(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the castle's front door, with nothing provided up front", () => {
  it('stays shut while its interior cannot be fetched, and once fetched builds it behind the shut iris', async () => {
    // The checked-in park, offered before anything of the park loads. Through
    // a variable, so the test project's typecheck does not follow it into
    // Node-only code (`test/node-env.d.ts`).
    const BUILT_PARKS = '../../scripts/lib/builtParks.mts';
    const { builtParkFileOf } = (await import(/* @vite-ignore */ BUILT_PARKS)) as {
      builtParkFileOf: (root: string, seed: number, env: Readonly<Record<string, string | undefined>>) => unknown;
    };
    (globalThis as { __LGP_RESOLVE_PARK_FILE__?: (seed: number) => unknown }).__LGP_RESOLVE_PARK_FILE__ = (asked) =>
      builtParkFileOf(new URL('../..', import.meta.url).pathname.replace(/\/$/, ''), asked, process.env);
    // The canvas shim every model-building check uses, before any art module paints.
    const HEADLESS_CANVAS = '../../scripts/headless-canvas.mjs';
    await import(/* @vite-ignore */ HEADLESS_CANVAS);
    await import('../../procgen/install.ts');
    const { Vector3: Vector3Class } = await import('three');
    const { CASTLE_INTERIOR } = await import('../../src/world/interiors');
    const { CollisionWorld } = await import('../../src/world/Collision');
    const { AnchorPlots } = await import('../../src/world/AnchorPlots');
    const { IsoCamera } = await import('../../src/core/IsoCamera');
    const { Player } = await import('../../src/entities/Player');
    const { Building, castleEntranceBand } = await import('../../src/world/building/Building');
    const { CASTLE_MALL, castleFloorAt } = await import('../../src/world/building/floors');

    expect(CASTLE_INTERIOR.loaded, 'control: the interior must not be loaded at the start, or this measures nothing').toBeNull();

    const wipes: HeldWipe[] = [];
    const controls: InteriorControls = {
      cancelWalk: () => {},
      iris: (midpoint, ready) => {
        wipes.push({ midpoint, ready });
      },
      flash: () => {},
      snapCamera: () => {},
      openShop: () => {},
    };
    const collision = new CollisionWorld();
    const camera = new IsoCamera();
    const building = collision.ownedBy('castle', () => new Building(collision, new AnchorPlots(collision), controls, camera));
    expect(building.furnished, 'a castle whose chunk is not here builds no interior at construction').toBe(false);

    const band = castleEntranceBand();
    const at: Vector3 = new Vector3Class(band.centreX, band.y, band.centreZ);
    const player = new Player(collision, camera, at);
    building.attachPlayer(player);
    let elapsed = 0;
    const frame = (dt: number): void => {
      elapsed += dt;
      building.update({
        dt,
        elapsed,
        frame: 1,
        playerPosition: player.position,
        input: { manualMoveActive: false, moveAmount: 0, justPressed: () => false },
      } as unknown as FrameContext);
    };
    const standAt = (x: number, z: number): void => player.teleportTo(x, band.y, z, Math.PI);

    // 1. Offline before the chunk was ever cached: every fetch fails.
    const offline = vi.spyOn(CASTLE_INTERIOR, 'load').mockRejectedValue(new Error('Failed to fetch dynamically imported module'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      frame(0.1);
      expect(wipes.length, 'standing in the doorway starts the walk in').toBe(1);
      await wipes[0]?.ready;
      wipes[0]?.midpoint();
      expect(building.furnished).toBe(false);
      expect(building.playerIsInside, 'she is never stood in an interior that is not there').toBe(false);
      frame(1);
      frame(1);
      expect(wipes.length, 'a refused door does not fire again while she stands in it').toBe(1);
    } finally {
      offline.mockRestore();
      error.mockRestore();
    }

    // 2. She steps out of the doorway, and the chunk arrives on her way back (the prefetch).
    standAt(band.centreX, band.centreZ + 4);
    frame(1);
    await CASTLE_INTERIOR.load();
    expect(building.furnished, 'fetched is not built: the door builds').toBe(false);

    // 3. Back into the doorway: the iris is asked to close, and nothing is built in front of it.
    standAt(band.centreX, band.centreZ);
    const collidersBefore = collision.colliderCount;
    frame(0.1);
    expect(wipes.length, 'the door fires again once she has stepped out and back').toBe(2);
    await afterTheDoorFrame();
    expect(building.furnished, 'built in the frame that asked the iris to close — in front of it').toBe(false);
    expect(collision.colliderCount).toBe(collidersBefore);
    expect(wipes[1]?.ready, 'the chunk is here: the iris waits for nothing').toBeUndefined();

    // 4. The iris is shut: built, solid, and only then is she stood on the mall.
    wipes[1]?.midpoint();
    expect(building.furnished).toBe(true);
    expect(building.playerIsInside).toBe(true);
    expect(castleFloorAt(player.position.x, player.position.z)?.index, 'on the mall, the storey the door opens on').toBe(CASTLE_MALL.index);
    const added = collision.colliderCount - collidersBefore;
    process.stderr.write(`castle door: the interior registered ${added} colliders behind the shut iris\n`);
    expect(added, 'the banquet and the dressing are solid the moment she can stand among them').toBeGreaterThan(40);
  });
});
