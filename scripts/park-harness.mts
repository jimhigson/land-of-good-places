/**
 * **The real park, built in Node.**
 *
 * `scripts/check-park.mts` measures the park; this is what hands it a park to
 * measure. Kept separate because building the world headlessly is the fiddly,
 * fragile half — a `Scene` with no renderer, an `InteriorControls` nobody will
 * ever call, a canvas that paints nothing — and because the *next* script that
 * wants a park in Node should not have to rediscover any of it.
 *
 * The point is that this is the **real** `World`, with the real build order:
 * `Garden`, `Scenery`, `Fountain`, the anchor plots, the building, the stalls
 * and the train, each registering its own colliders with the one shared
 * `CollisionWorld`, and the train solving its loop against the finished result
 * exactly as it does in a browser. Nothing here models the park. The precedent
 * is `scripts/measure-hop-clearance.mts`, which drives the real
 * `CollisionWorld` rather than a description of one, for the same reason: a
 * check against a model only ever proves the model.
 *
 * `scripts/headless-canvas.mjs` must be imported first — half the art code
 * paints a texture at construction time and reaches for `document` to do it.
 */
import './headless-canvas.mjs';
import { Scene } from 'three';
import { World } from '../src/world/World.ts';
import { Sky } from '../src/world/Sky.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import type { InteriorControls } from '../src/world/building/Building.ts';

/**
 * An `InteriorControls` that does nothing.
 *
 * Every method on it is something the building asks the *game* to do — walk the
 * player, close the iris, run the clock fast. None of them happens while the
 * world is merely being built; if one is ever called during construction it
 * will be loudly obvious, because it throws rather than shrugs. Once the build
 * has returned, the same calls become silent no-ops instead: a checker
 * stepping `update()` frames (check:hotel walks a fallen player back into a
 * room, which snaps the camera) is deliberately doing what the game would do,
 * and headless there is simply no camera to snap.
 */
let worldUnderConstruction = true;

function inertInteriorControls(): InteriorControls {
  const refuse = (what: string) => (): void => {
    if (!worldUnderConstruction) return;
    throw new Error(
      `park-harness: the building called InteriorControls.${what}() while the ` +
        'world was being built. Nothing in a headless build should drive the ' +
        'player or the camera — see scripts/park-harness.mts.',
    );
  };
  return {
    walkTo: refuse('walkTo'),
    cancelWalk: refuse('cancelWalk'),
    setTimeScale: refuse('setTimeScale'),
    setWhoosh: refuse('setWhoosh'),
    iris: refuse('iris'),
    flash: refuse('flash'),
    snapCamera: refuse('snapCamera'),
    openStairMenu: refuse('openStairMenu'),
    openShop: refuse('openShop'),
    closeStairMenu: refuse('closeStairMenu'),
  };
}

/**
 * Noise that only exists because there is no browser here.
 *
 * `three` serialises a material's textures when it clones one (`KidCrowd` does,
 * once per outfit), and our stubbed canvas has no image for it to serialise, so
 * it warns — dozens of times, about nothing. Everything else a builder says
 * during construction is kept and handed back to the caller.
 */
const HEADLESS_NOISE = /Unable to serialize Texture/;

/**
 * Runs `body` with `console.warn` and `console.error` collected rather than
 * printed.
 *
 * Building the park says things — `poiGraph` names every waypoint it dropped,
 * `Collision` names every hoppable wall it demoted — and a checker that lets
 * them scroll past has buried its own findings in the world's. They are
 * returned instead, so a caller can re-derive them properly and print the
 * version a person can act on.
 */
function collectingWarnings<T>(body: () => T): { value: T; said: string[] } {
  const said: string[] = [];
  const warn = console.warn;
  const error = console.error;
  const capture = (...parts: unknown[]): void => {
    const line = parts.map((part) => String(part)).join(' ');
    if (!HEADLESS_NOISE.test(line)) said.push(line);
  };
  console.warn = capture;
  console.error = capture;
  try {
    return { value: body(), said };
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

export interface HeadlessPark {
  readonly scene: Scene;
  readonly world: World;
  /** Everything the builders said while the park was going up. */
  readonly said: readonly string[];
  /**
   * The ground under a point, as the player's own sampler answers it — the
   * building's `WalkSurfaces`, which is what `Game` installs. Decks, platforms
   * and the ball pit lip are all in here; the fountain's wading dip is not,
   * because `World.attachPlayer` adds that on top of a real `Player` and
   * there is no player in a headless build.
   */
  readonly sample: (x: number, z: number, y: number) => number;
  /** Milliseconds the world took to construct. */
  readonly buildMs: number;
}

/** Builds the park. A couple of hundred milliseconds; call it once. */
export function buildHeadlessPark(): HeadlessPark {
  const started = performance.now();
  const scene = new Scene();
  const { value: world, said } = collectingWarnings(() => {
    const sky = new Sky();
    const camera = new IsoCamera();
    return new World(scene, sky, inertInteriorControls(), camera);
  });
  worldUnderConstruction = false;
  const buildMs = performance.now() - started;

  return {
    scene,
    world,
    said,
    sample: (x, z, y) => world.building.surfaces.sample(x, z, y),
    buildMs,
  };
}

/**
 * Runs `body` with the world's own console chatter collected, for a caller that
 * builds something else off the finished park — a second `PoiGraph`, say, whose
 * "waypoints nobody can walk to" warning the caller is about to report properly
 * and in full.
 */
export function quietly<T>(body: () => T): T {
  return collectingWarnings(body).value;
}
