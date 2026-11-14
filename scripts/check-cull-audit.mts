/**
 * **`check:cull-audit` — nothing off the screen is drawn** (120 fps plan, step
 * 10; `docs/perf/FRAME-DROPS-2026-11.md` on #746, "Per-object frustum culling
 * that actually works").
 *
 * Jim, November 2026: *"we shouldn't draw anything off the screen, not just
 * crowds — generalise it."* three.js already skips a mesh whose bounding sphere
 * misses the camera's frustum, but only if (a) the mesh lets it
 * (`frustumCulled`) and (b) the sphere is small enough to miss anything. One
 * `InstancedMesh` holding every bush in the park has a sphere the size of the
 * park, so it is drawn whole — every instance, behind the camera or not —
 * whenever she can see one bush. Nothing goes red when that happens; it just
 * costs triangles a phone does not have.
 *
 * ## What it measures
 *
 * For each space (park, every castle deck, hotel, library, reptile house, the
 * rides), at one fixed moment (below), it walks the scene exactly as three's
 * `projectObject` does — `visible`, layers, `frustumCulled`, the object's own
 * bounding sphere — so it knows which meshes three **will draw** this frame.
 * Then, for each of those, it asks the honest question three cannot: is any of
 * it actually on the screen? A plain mesh is tested by its geometry's world
 * sphere; an `InstancedMesh` **instance by instance** (its geometry's sphere
 * through that instance's matrix). It reports:
 *
 * - **off-screen draws / triangles**: draws three submits for meshes wholly
 *   outside the frustum, and triangles for every wholly-off-screen mesh and
 *   every off-screen instance of a partly visible one. This is the budget.
 * - **offenders**, by name and cause: `frustumCulled = false`, a bound wider
 *   than {@link OVERSIZED_RADIUS_M} (one sphere for most of the park), or a
 *   **stale bound** — an instanced mesh whose live instances have moved
 *   outside the sphere three cached, which is the opposite fault (something
 *   on screen could be culled) and fails outright. three caches that sphere on
 *   the mesh's first cull and never looks again, so a bound that holds at one
 *   instant can be broken a second later: after the audit the world runs on
 *   for {@link SWEEP_SECONDS} of its own seconds and every instanced mesh is
 *   looked at ten times a second ({@link installStaleSweep}).
 *
 * ## Which frame — the same one on every machine
 *
 * A scene is not audited "twenty frames after she got there": a frame is a
 * different amount of the world's time on every machine (on a GPU twenty are
 * a third of a second; on CI's SwiftShader each is clamped at 1/12 s), and a
 * ride's camera moves. That was the whole of CI run 43439027681's red: the sky
 * cruiser audited a fraction of a second into its ride on a Mac and seconds
 * into it on the runner, 210,420 off-screen triangles against 386,120 —
 * reproduced exactly here with `SWIFTSHADER=1`.
 *
 * Each scene names its moment instead ({@link Scene.clock}) and opens with
 * `?clock=<seconds>` (`core/checkClock.ts`): the world is held from the first
 * frame, stepped in fixed 1/60 s steps while nothing runs on the wall clock (an
 * iris, a lazy room, the ball pit's budgeted warm-up), and held at the moment.
 * Measured, 13 November 2026: all eleven scenes identical — every offender,
 * every count — on an Apple M4 Pro twice and on SwiftShader twice
 * (`SWIFTSHADER=1`, the runner's renderer); only the on-screen control's lit
 * pixel count differs, by a few pixels between the two rasterisers. A red run
 * can be opened in a browser at its moment — `/sky-cruiser?seed=5&clock=2` —
 * and looked at.
 *
 * ## Why the instrument can be trusted (its controls)
 *
 * CLAUDE.md: two agents got decisive, wrong answers from instruments that
 * measured the wrong thing, and only a control caught it. This one runs two
 * controls on **every** scene, and a failed control fails the check:
 *
 * 1. **The model of "what three draws" is three's own count.** It renders the
 *    scene once more, shadow pass off, and compares `renderer.info`'s draws
 *    and triangles with what the walk predicted. They must match exactly —
 *    if they do not, the walk is not describing the frame.
 * 2. **"Off-screen" really is off-screen.** It renders *only* what it called
 *    off-screen (every other mesh moved to a spare layer, every on-screen
 *    instance scaled to nothing) into a cleared target and counts pixels: it
 *    must be **zero**. And it renders only what it called on-screen, which
 *    must be **non-zero** — the positive control that the pixel read can see
 *    anything at all.
 *
 * ## The budgets
 *
 * {@link BUDGETS}: measured off-screen draws and triangles per space plus
 * {@link HEADROOM}, ratcheted by hand like `check:render-budget`'s. Lower one
 * when a change removes waste; never raise one to make a PR pass without
 * saying what it buys.
 *
 * ## Proved red (13 November 2026, `fix/cull-audit-ci` 84cd3f44, seed 5, 1000×700 DPR 1)
 *
 * Each clause broken on purpose and watched fail, with the inputs it failed
 * on — a transcript goes stale when the geometry under it moves, so the
 * geometry is written down with it. Every one restored and green after.
 *
 * - **Budgets.** Every tile's bound 50× too wide (`refreshInstanceBounds`,
 *   `sphere.radius = (radius + margin) * 50`), so no tiled bush, tree, bulb
 *   or flower can be culled — against the budgets above (park 36 / 256,628,
 *   sky cruiser 12 / 173,584; the crowd's level of detail, #768, in):
 *   ```
 *   park: 178 draws a frame for meshes wholly off the screen, ceiling 40 (measured 36)
 *   park: 518168 triangles a frame off the screen, ceiling 282291 (measured 256628)
 *   sky cruiser: 87 draws a frame for meshes wholly off the screen, ceiling 14 (measured 12)
 *   sky cruiser: 301848 triangles a frame off the screen, ceiling 190943 (measured 173584)
 *   ```
 * - **Stale bounds, the motes** (CI's red): the lobby's glints, then its
 *   motes, left to three's cached bound again (`createDiscoSparkle` without
 *   that mesh's `boundingSphere`; three cached the motes' at centre (0.566,
 *   −2.893, 0.405) r 4.956 and the glints' at r 0.627, in their own space, on
 *   the first draw). Neither is out at the audited moment, 1 s — which is why
 *   the sweep exists:
 *   ```
 *   hotel: stale bound — …/hotel.disco.glints: up to 8 of 90 instances outside the bound three culls by, first at 1.100 s, by up to 0.036 m
 *   hotel: stale bound — …/hotel.disco.motes: up to 3 of 40 instances outside the bound three culls by, first at 1.500 s, by up to 0.586 m
 *   ```
 * - **Stale bounds, the snakes**: `SnakeSegmentPool.holdWithin` made a no-op,
 *   so every pool's bound is three's cache again — the six this check used to
 *   tolerate, and four the sweep finds beside them:
 *   ```
 *   reptile house: stale bound — …/reptile-adults:segments: 1 of 66 instances outside the bound three culls by, at 1.000 s   (and :outline)
 *   reptile house: stale bound — …/toy.noodlePlush/…/snake.mint:segments: 1 of 19 instances … at 1.000 s                     (and :outline)
 *   reptile house: stale bound — …/hat.snake/…/snake.mint:segments: 2 of 20 instances … at 1.000 s                           (and :outline)
 *   reptile house: stale bound — …/reptile-babies:segments: up to 1 of 148 instances …, first at 2.300 s, by up to 0.007 m  (and :outline)
 *   reptile house: stale bound — …/balloon.snake/…/snake.coral:segments: up to 1 of 9 instances …, first at 3.800 s, by up to 0.004 m (and :outline)
 *   ```
 * - **Stale bounds, the ball pit**: `BallPit` without its own bound, on the
 *   slide, whose rider lands in the pit:
 *   ```
 *   slide: stale bound — anchor-plots/anchor:ballPit/ball-pit/balls: up to 20 of 900 instances outside the bound three culls by, first at 10.500 s, by up to 0.402 m
 *   ```
 * - **A second boot.** The page reloaded straight after its moment
 *   (`page.reload()` after `settle`):
 *   ```
 *   hotel: the page loaded again after its moment (0.7 s …/hotel?seed=5&perf=1&clock=1; 4.6 s …/hotel?seed=5&perf=1&clock=1) — the audit or the sweep ran on another boot
 *   ```
 *   Seen for real too: vite reloads the first page to connect after a source
 *   edit. A reload *before* the moment is harmless — the last boot is whole,
 *   its clock run from nothing — and is only noted.
 *
 * ```
 * pnpm run check:served-cull-audit              # starts its own dev server
 * CHECK_CULL_AUDIT_URL=http://127.0.0.1:5947 pnpm run check:cull-audit
 * MEASURE=1 …    # print counts, assert only the controls
 * ONLY=park,hotel …
 * OUT=/path/to/audit.json …   # every scene's offenders, for reading
 * SWIFTSHADER=1 …               # CI's software rasteriser, on a machine with a GPU
 * ```
 *
 * Open any scene's moment in a browser to look at it: `/slide?seed=5&clock=2`.
 */
import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_CULL_AUDIT_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_CULL_AUDIT_SEED ?? CANONICAL_PARK_SEED);
const MEASURE = process.env.MEASURE === '1';
const OUT = process.env.OUT;
/** Frames drawn with the world held at its moment before the audit — the frame audited is one three has drawn. */
const HELD_FRAMES = 3;
const BOOT_TIMEOUT_MS = 240_000;
/**
 * A bound this wide is one sphere over a large part of the park: it can only
 * miss the frustum when she is looking somewhere else entirely. Tiles from
 * `core/tiledInstances.ts` are well under it (a 24 m tile's sphere is ~20 m).
 */
const OVERSIZED_RADIUS_M = 40;
/**
 * Measured + 10 %, plus a small absolute floor so a space measured at zero can
 * still take a stray instance. **A ratchet margin, not a variance allowance**:
 * every scene is audited at a fixed moment of the world's own clock, and the
 * same commit measures the same numbers on a GPU and on SwiftShader (see
 * "Which frame" above). The margin is room for a change that adds a little,
 * so not every new prop has to touch this file; a change that adds a lot
 * says so here.
 */
const HEADROOM = 1.1;
const FLOOR_TRIS = 2_000;
const FLOOR_DRAWS = 2;

interface Scene {
  readonly path: string;
  /**
   * **The moment audited**: seconds of the world's own clock (`?clock=`,
   * `core/checkClock.ts`) after she got there — the clock is held while the
   * iris, a lazy room or a ride's sky show is on its way, so for a ride this
   * is seconds after boarding.
   */
  readonly clock: number;
  /** What the probe must report at that moment: a space id, or its prefix. */
  readonly space: string;
  readonly riding?: boolean;
  /** Measured off-screen draws and triangles on the commit that set them, before {@link HEADROOM}. */
  readonly offDraws: number;
  readonly offTris: number;
  /**
   * Instanced meshes whose bound three culls by is known to miss live
   * instances — at the audited moment or in the sweep after it. A ratchet like
   * the rest: the count may only fall, every one is named on stderr on every
   * run, and a space without this field tolerates none. None does today.
   */
  readonly knownStale?: number;
}

/**
 * **Measured, not guessed — and the same everywhere.** Each figure is the
 * off-screen count at its scene's moment, canonical seed 5, 1000×700 at DPR 1,
 * 13 November 2026, on `fix/cull-audit-ci`: identical, offender for offender,
 * on an Apple M4 Pro (Metal) twice and on SwiftShader — CI's renderer — twice.
 * Re-measure with `MEASURE=1` and lower these whenever a change removes more.
 *
 * Re-derived from the first figures (`perf-step10-instanced-tiles`, one run on
 * a GPU, each frozen ~0.4 s into its scene — on SwiftShader ~2.5 s in, which
 * is the whole of CI run 43439027681's red), and measured with the crowd's
 * level of detail (#768) merged, which took 41 k–224 k off-screen triangles
 * off the five scenes with children in view. **Every ceiling fell**; the old
 * ones also carried 5 draws and 25,000 triangles of slack for the moving ride
 * camera, which a fixed moment does not need. Old ceiling → new, triangles:
 * park 408,232 → 282,291; castle deck 1 423,209 → 123,993; sky cruiser
 * 256,463 → 190,943; ferris 439,472 → 333,173; slide 290,910 → 237,618. Castle
 * decks 0 and 2, the hotel, the library, the reptile house and the rail race
 * measure what they did before and lose only the slack.
 *
 * The reptile house's six tolerated stale bounds (snakes) are fixed, and so are
 * the four the sweep then found beside them, the hotel's motes and the ball
 * pit's balls: no scene tolerates one any more (`knownStale` was 6, now unset).
 */
const BUDGETS: Readonly<Record<string, Scene>> = {
  park: { path: '/spawn', clock: 1, space: 'garden', offDraws: 36, offTris: 256_628 },
  'castle deck 0': { path: '/castle?deck=0', clock: 1, space: 'castle.', offDraws: 18, offTris: 55_366 },
  'castle deck 1': { path: '/castle?deck=1', clock: 1, space: 'castle.', offDraws: 18, offTris: 112_720 },
  'castle deck 2': { path: '/castle?deck=2', clock: 1, space: 'castle.', offDraws: 17, offTris: 120_438 },
  hotel: { path: '/hotel', clock: 1, space: 'hotel.', offDraws: 17, offTris: 52_288 },
  library: { path: '/library', clock: 1, space: 'library', offDraws: 18, offTris: 211_256 },
  'reptile house': { path: '/reptile-house', clock: 1, space: 'reptileHouse', offDraws: 18, offTris: 297_312 },
  'rail race': { path: '/rail-race', clock: 2, space: '', riding: true, offDraws: 5, offTris: 40_132 },
  'sky cruiser': { path: '/sky-cruiser', clock: 2, space: '', riding: true, offDraws: 12, offTris: 173_584 },
  ferris: { path: '/ferris', clock: 2, space: '', riding: true, offDraws: 24, offTris: 302_884 },
  slide: { path: '/slide', clock: 2, space: '', riding: true, offDraws: 22, offTris: 216_016 },
};

const at = (scene: Scene): string =>
  `${BASE}${scene.path}${scene.path.includes('?') ? '&' : '?'}seed=${SEED}&perf=1&clock=${scene.clock}`;

/** One mesh three will draw this frame that is, wholly or in part, off the screen. */
interface Offender {
  readonly name: string;
  readonly type: string;
  /** Why it is drawn although off-screen. */
  readonly cause: 'frustumCulled=false' | 'oversized bound' | 'bound misses its contents' | 'partly visible';
  readonly offTris: number;
  readonly offDraws: number;
  readonly instances: number;
  readonly offInstances: number;
  readonly boundRadius: number;
}

interface Audit {
  readonly pass: string;
  readonly drawn: { readonly meshes: number; readonly draws: number; readonly tris: number };
  readonly off: { readonly draws: number; readonly tris: number };
  readonly control: {
    readonly infoDraws: number;
    readonly infoTris: number;
    readonly offPixels: number;
    readonly onPixels: number;
    /** Objects three drew that the walk did not predict, and the reverse — both empty when the control holds. */
    readonly walkMissed: readonly string[];
    readonly walkInvented: readonly string[];
  };
  readonly offenders: readonly Offender[];
  /** Instanced meshes whose cached bound no longer contains their live instances, at the audited moment. */
  readonly stale: readonly { readonly name: string; readonly out: number; readonly of: number }[];
  /** Drawn meshes with `frustumCulled = false`, by name, whether or not they are off-screen. */
  readonly unculled: readonly string[];
  /** Drawn meshes whose bound is wider than {@link OVERSIZED_RADIUS_M}. */
  readonly oversized: readonly string[];
}

/**
 * The world's seconds the stale-bound sweep runs on for after the audited
 * moment, and how often (in `?clock=` steps) it looks. Ten seconds is most of
 * a mote's fall (7–15 s) and several of a snake's waves; every sixth step is
 * ten looks a world second, far finer than anything here moves past a bound.
 */
const SWEEP_SECONDS = 10;
const SWEEP_EVERY = 6;

/** An instanced mesh whose live instances left the bound three culls it by, during the sweep. */
interface StaleFinding {
  readonly name: string;
  /** World seconds (`?clock=`) at which it was first seen out. */
  readonly firstAt: number;
  /** The most instances out at one look, and of how many. */
  readonly worst: number;
  readonly of: number;
  /** The furthest an instance's sphere reached past the bound, metres in the mesh's own space. */
  readonly overshoot: number;
}

/**
 * Runs **in the page**: looks at every instanced mesh's bound against its live
 * instances on every `every`th step of the world's clock from now, until the
 * clock stops again. Self-contained for the same reason {@link auditInPage}
 * is; its containment test is that function's, so the two cannot disagree
 * about what "outside the bound" means.
 */
function installStaleSweep(every: number): void {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = window as unknown as { game: Any; __checkClock: Any; __staleSweep?: Any };
  const game = w.game;
  const clock = w.__checkClock;
  const scene = game.miniGames.hidesPark && game.miniGames.game ? game.miniGames.game.scene : game.engine.scene;
  const meshes: Any[] = [];
  scene.traverse((o: Any) => {
    if (o.isInstancedMesh) meshes.push(o);
  });
  const nameOf = (o: Any): string => {
    const parts: string[] = [];
    for (let n = o; n && n !== scene; n = n.parent) parts.push((n.name || n.type) + (n.userData?.tile ? `@${n.userData.tile}` : ''));
    return parts.reverse().join('/');
  };
  const drawable = (o: Any): boolean => {
    for (let n = o; n; n = n.parent) {
      if (!n.visible) return false;
      if (n === scene) return true;
    }
    return false;
  };
  const findings = new Map<Any, { name: string; firstAt: number; worst: number; of: number; overshoot: number }>();
  let steps = 0;
  let instanceMatrix: Any = null;
  let local: Any = null;
  clock.afterStep = () => {
    steps += 1;
    if (steps % every !== 0) return;
    const seconds = clock.state().seconds;
    for (const mesh of meshes) {
      // Only a bound three would cull by: a culled mesh, drawn, whose bound exists.
      if (!mesh.frustumCulled || !mesh.boundingSphere || !drawable(mesh)) continue;
      const geometry = mesh.geometry;
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      if (!instanceMatrix) {
        instanceMatrix = mesh.matrixWorld.clone();
        local = geometry.boundingSphere.clone();
      }
      const cached = mesh.boundingSphere;
      let out = 0;
      let overshoot = 0;
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, instanceMatrix);
        const e = instanceMatrix.elements;
        if (e[0] === 0 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 0) continue;
        local.copy(geometry.boundingSphere).applyMatrix4(instanceMatrix);
        const d = local.center.distanceTo(cached.center) + local.radius;
        if (d > cached.radius * (1 + 1e-4) + 1e-4) {
          out += 1;
          overshoot = Math.max(overshoot, d - cached.radius);
        }
      }
      if (out === 0) continue;
      const seen = findings.get(mesh);
      if (!seen) findings.set(mesh, { name: nameOf(mesh), firstAt: seconds, worst: out, of: mesh.count, overshoot });
      else {
        seen.worst = Math.max(seen.worst, out);
        seen.overshoot = Math.max(seen.overshoot, overshoot);
      }
    }
  };
  w.__staleSweep = { findings: () => [...findings.values()], looks: () => Math.floor(steps / every) };
}

/**
 * Runs **in the page**. Serialised by playwright, so it imports nothing: every
 * three.js type it touches arrives on the objects themselves (`isMesh`,
 * `Sphere.applyMatrix4`, `Matrix4.multiplyMatrices`), and the frustum planes
 * are extracted by hand exactly as `Frustum.setFromProjectionMatrix` does.
 */
function auditInPage(oversizedRadius: number): Audit[] {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const game = (window as unknown as { game: Any }).game;
  const renderer = game.engine.renderer;
  const passes: { name: string; scene: Any; camera: Any }[] = [];
  if (!game.miniGames.hidesPark) {
    passes.push({ name: 'park scene', scene: game.engine.scene, camera: game.cameraOverride ?? game.camera.camera });
  } else if (game.miniGames.game) {
    passes.push({ name: 'mini-game scene', scene: game.miniGames.game.scene, camera: game.miniGames.game.camera });
  }

  const results: Audit[] = [];
  for (const pass of passes) {
    const { scene, camera } = pass;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const pv = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements as number[];
    const me = pv;
    const raw = [
      [me[3]! - me[0]!, me[7]! - me[4]!, me[11]! - me[8]!, me[15]! - me[12]!],
      [me[3]! + me[0]!, me[7]! + me[4]!, me[11]! + me[8]!, me[15]! + me[12]!],
      [me[3]! + me[1]!, me[7]! + me[5]!, me[11]! + me[9]!, me[15]! + me[13]!],
      [me[3]! - me[1]!, me[7]! - me[5]!, me[11]! - me[9]!, me[15]! - me[13]!],
      [me[3]! - me[2]!, me[7]! - me[6]!, me[11]! - me[10]!, me[15]! - me[14]!],
      [me[3]! + me[2]!, me[7]! + me[6]!, me[11]! + me[10]!, me[15]! + me[14]!],
    ];
    const planes = raw.map(([a, b, c, d]) => {
      const l = Math.hypot(a!, b!, c!);
      return [a! / l, b! / l, c! / l, d! / l] as const;
    });
    const sphereIn = (cx: number, cy: number, cz: number, r: number): boolean => {
      for (const [a, b, c, d] of planes) if (a * cx + b * cy + c * cz + d < -r) return false;
      return true;
    };
    const SphereCtor = (() => {
      // Borrow three's Sphere class from any geometry; there is always one.
      let ctor: Any = null;
      scene.traverse((o: Any) => {
        if (ctor || !o.geometry) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        ctor = o.geometry.boundingSphere.constructor;
      });
      return ctor;
    })();
    const Matrix4Ctor = camera.matrixWorld.constructor;
    const scratch = new SphereCtor();
    const instanceMatrix = new Matrix4Ctor();
    const world = new Matrix4Ctor();

    const nameOf = (o: Any): string => {
      const parts: string[] = [];
      // A tile of `core/tiledInstances.ts` keeps its mesh's original name; its key tells tiles apart.
      for (let n = o; n && n !== scene; n = n.parent) parts.push((n.name || n.type) + (n.userData?.tile ? `@${n.userData.tile}` : ''));
      return parts.reverse().join('/');
    };

    /**
     * Triangles three counts for one draw of `group` (or the whole geometry), as
     * `renderBufferDirect` does; -1 when it issues no draw at all.
     */
    const drawTris = (object: Any, group: Any): number => {
      const geometry = object.geometry;
      const index = geometry.index;
      const position = geometry.attributes.position;
      if (!position) return 0;
      const dataCount = index ? index.count : position.count;
      const rangeStart = geometry.drawRange.start;
      const rangeCount = geometry.drawRange.count;
      const groupStart = group ? group.start : 0;
      const groupCount = group ? group.count : Infinity;
      const drawStart = Math.max(rangeStart, groupStart);
      const drawEnd = Math.min(dataCount, rangeStart + rangeCount, groupStart + groupCount) - 1;
      const drawCount = Math.max(0, drawEnd - drawStart + 1);
      if (drawCount === 0) return -1;
      const instances = object.isInstancedMesh ? object.count : 1;
      if (object.isInstancedMesh && instances === 0) return -1;
      if (object.isSprite) return drawCount / 3; // a sprite is a quad: three counts its two triangles
      if (!object.isMesh) return 0; // lines and points are counted as draws, not triangles
      return (drawCount / 3) * instances;
    };
    /**
     * How many times three draws one item: a transparent, double-sided material
     * is drawn twice — back faces, then front (`WebGLRenderer.renderObject`,
     * unless `forceSinglePass`). `2` is three's `DoubleSide`.
     */
    const passes = (m: Any): number => (m.transparent === true && m.side === 2 && m.forceSinglePass === false ? 2 : 1);
    /** Draw items three pushes for one object: one per visible material group, or one. */
    const drawItems = (object: Any): { draws: number; tris: number; trisPerInstanceSet: number } => {
      const material = object.material;
      if (Array.isArray(material)) {
        let draws = 0;
        let tris = 0;
        for (const group of object.geometry.groups) {
          const m = material[group.materialIndex];
          if (m && m.visible) {
            const t = drawTris(object, group);
            if (t >= 0) {
              draws += passes(m);
              tris += t * passes(m);
            }
          }
        }
        return { draws, tris, trisPerInstanceSet: tris };
      }
      if (!material || !material.visible) return { draws: 0, tris: 0, trisPerInstanceSet: 0 };
      const t = drawTris(object, null);
      if (t < 0) return { draws: 0, tris: 0, trisPerInstanceSet: 0 };
      return { draws: passes(material), tris: t * passes(material), trisPerInstanceSet: t * passes(material) };
    };
    /** The sphere three culls this object by, in world space — `Frustum.intersectsObject`. */
    const cullSphere = (object: Any): Any => {
      if (object.boundingSphere !== undefined) {
        if (object.boundingSphere === null) object.computeBoundingSphere();
        return scratch.copy(object.boundingSphere).applyMatrix4(object.matrixWorld);
      }
      if (object.geometry.boundingSphere === null) object.geometry.computeBoundingSphere();
      return scratch.copy(object.geometry.boundingSphere).applyMatrix4(object.matrixWorld);
    };

    const drawnMeshes: Any[] = [];
    let drawnDraws = 0;
    let drawnTris = 0;
    const project = (object: Any): void => {
      if (object.visible === false) return;
      if (object.layers.test(camera.layers)) {
        if (object.isSprite) {
          // `Frustum.intersectsSprite`: a unit quad's half-diagonal, wider by how far its centre is offset.
          let drawn = !object.frustumCulled;
          if (!drawn) {
            const offset = Math.hypot((object.center?.x ?? 0.5) - 0.5, (object.center?.y ?? 0.5) - 0.5);
            scratch.center.set(0, 0, 0);
            scratch.radius = 0.7071067811865476 + offset;
            scratch.applyMatrix4(object.matrixWorld);
            drawn = sphereIn(scratch.center.x, scratch.center.y, scratch.center.z, scratch.radius);
          }
          const items = drawn ? drawItems(object) : { draws: 0, tris: 0 };
          if (items.draws > 0) {
            drawnMeshes.push(object);
            drawnDraws += items.draws;
            drawnTris += items.tris;
          }
        } else if (object.isMesh || object.isLine || object.isPoints) {
          if (object.isBatchedMesh) throw new Error(`BatchedMesh ${nameOf(object)} — the audit does not model it yet`);
          let drawn = !object.frustumCulled;
          if (!drawn) {
            const s = cullSphere(object);
            drawn = sphereIn(s.center.x, s.center.y, s.center.z, s.radius);
          }
          if (drawn) {
            const items = drawItems(object);
            if (items.draws > 0) {
              drawnMeshes.push(object);
              drawnDraws += items.draws;
              drawnTris += items.tris;
            }
          }
        }
      }
      for (const child of object.children) project(child);
    };
    project(scene);

    // ------------------------------------------------ what is really on screen
    const offenders: Offender[] = [];
    const stale: { name: string; out: number; of: number }[] = [];
    const unculled: string[] = [];
    const oversized: string[] = [];
    let offDraws = 0;
    let offTris = 0;
    /** Per object: on-screen instance flags (instanced) or whole-object flag. */
    const onScreen = new Map<Any, boolean | Uint8Array>();
    for (const object of drawnMeshes) {
      const name = nameOf(object);
      const items = drawItems(object);
      const boundRadius = object.frustumCulled ? cullSphere(object).radius : Infinity;
      if (!object.frustumCulled) unculled.push(name);
      else if (boundRadius > oversizedRadius) oversized.push(`${name} (${boundRadius.toFixed(0)} m)`);
      if (object.isInstancedMesh) {
        const geometry = object.geometry;
        if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
        const n = object.count;
        const flags = new Uint8Array(n);
        let off = 0;
        let escaped = 0;
        const cached = object.frustumCulled && object.boundingSphere ? scratch.clone().copy(object.boundingSphere) : null;
        for (let i = 0; i < n; i += 1) {
          object.getMatrixAt(i, instanceMatrix);
          const e = instanceMatrix.elements;
          const zero = e[0] === 0 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 0;
          if (zero) {
            off += 1;
            continue;
          }
          const local = scratch.copy(geometry.boundingSphere).applyMatrix4(instanceMatrix);
          if (cached) {
            const d = local.center.distanceTo(cached.center) + local.radius;
            if (d > cached.radius * (1 + 1e-4) + 1e-4) escaped += 1;
          }
          world.copy(object.matrixWorld).multiply(instanceMatrix);
          const s = scratch.copy(geometry.boundingSphere).applyMatrix4(world);
          if (sphereIn(s.center.x, s.center.y, s.center.z, s.radius)) flags[i] = 1;
          else off += 1;
        }
        if (escaped > 0) stale.push({ name, out: escaped, of: n });
        onScreen.set(object, flags);
        if (off > 0) {
          const perInstance = n > 0 ? items.tris / n : 0;
          const whole = off === n;
          const t = Math.round(perInstance * off);
          offTris += t;
          if (whole) offDraws += items.draws;
          offenders.push({
            name,
            type: object.type,
            cause: !object.frustumCulled
              ? 'frustumCulled=false'
              : escaped > 0
                ? 'bound misses its contents'
                : boundRadius > oversizedRadius
                  ? 'oversized bound'
                  : 'partly visible',
            offTris: t,
            offDraws: whole ? items.draws : 0,
            instances: n,
            offInstances: off,
            boundRadius,
          });
        }
      } else {
        let visible: boolean;
        if (object.isSprite) {
          visible = true;
        } else {
          const geometry = object.geometry;
          const sphere =
            object.boundingSphere !== undefined && object.boundingSphere !== null
              ? scratch.copy(object.boundingSphere).applyMatrix4(object.matrixWorld)
              : (geometry.boundingSphere === null && geometry.computeBoundingSphere(),
                scratch.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld));
          visible = sphereIn(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
        }
        onScreen.set(object, visible);
        if (!visible) {
          offDraws += items.draws;
          offTris += items.tris;
          offenders.push({
            name,
            type: object.type,
            cause: !object.frustumCulled ? 'frustumCulled=false' : boundRadius > oversizedRadius ? 'oversized bound' : 'bound misses its contents',
            offTris: items.tris,
            offDraws: items.draws,
            instances: 1,
            offInstances: 1,
            boundRadius,
          });
        }
      }
    }

    // ------------------------------------------------ control 1: three's own count
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeds = renderer.shadowMap.needsUpdate;
    const autoReset = renderer.info.autoReset;
    const target0 = renderer.getRenderTarget();
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.info.autoReset = true;
    const W = 400;
    const H = Math.max(1, Math.round(W / (camera.aspect ?? 1)));
    const RT = renderer.getRenderTarget()?.constructor;
    // The target class: borrow it from the renderer's shadow maps if none is bound.
    let TargetCtor: Any = RT ?? null;
    if (!TargetCtor) {
      game.engine.scene.traverse((o: Any) => {
        if (!TargetCtor && o.isLight && o.shadow && o.shadow.map) TargetCtor = o.shadow.map.constructor;
      });
    }
    // Record what three really hands to the GPU, so a failed control names the
    // objects the walk got wrong instead of two numbers that differ.
    const reallyDrawn = new Set<Any>();
    const renderBufferDirect = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (this: Any, ...args: Any[]): Any {
      reallyDrawn.add(args[4]);
      return renderBufferDirect.apply(this, args);
    };
    try {
      renderer.render(scene, camera);
    } finally {
      renderer.renderBufferDirect = renderBufferDirect;
    }
    const infoDraws = renderer.info.render.calls;
    const infoTris = renderer.info.render.triangles;
    const predicted = new Set<Any>(drawnMeshes);
    const describe = (o: Any): string => `${nameOf(o) || o.type}${o.parent ? '' : ' (not in the scene graph)'}`;
    const walkMissed = [...reallyDrawn].filter((o) => !predicted.has(o) && !(o.isInstancedMesh && o.count === 0)).map(describe);
    const walkInvented = drawnMeshes.filter((o: Any) => !reallyDrawn.has(o)).map(describe);

    // ------------------------------------------------ control 2: off-screen draws nothing
    let offPixels = -1;
    let onPixels = -1;
    if (TargetCtor) {
      const target = new TargetCtor(W, H);
      const pixels = new Uint8Array(W * H * 4);
      const SPARE = 31;
      const savedCameraLayers = camera.layers.mask;
      const savedBackground = scene.background;
      const savedFog = scene.fog;
      const restoreMatrices: (() => void)[] = [];
      const renderOnly = (wantOn: boolean): number => {
        const enabled: Any[] = [];
        for (const [object, flags] of onScreen) {
          if (flags instanceof Uint8Array) {
            const want = Array.from(flags).some((f) => (f === 1) === wantOn);
            if (!want) continue;
            // Keep the array, then scale every instance of the wrong kind to nothing.
            const saved = object.instanceMatrix.array.slice();
            restoreMatrices.push(() => {
              object.instanceMatrix.array.set(saved);
              object.instanceMatrix.needsUpdate = true;
            });
            const arr = object.instanceMatrix.array;
            for (let i = 0; i < flags.length; i += 1) {
              if ((flags[i] === 1) !== wantOn) for (let k = 0; k < 16; k += 1) arr[i * 16 + k] = 0;
            }
            object.instanceMatrix.needsUpdate = true;
          } else if (flags !== wantOn) continue;
          enabled.push(object);
          object.layers.enable(SPARE);
        }
        camera.layers.set(SPARE);
        scene.background = null;
        scene.fog = null;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        // Frustum culling off for the control: it must not hide what we are asking about.
        const culled: [Any, boolean][] = [];
        for (const object of enabled) {
          culled.push([object, object.frustumCulled]);
          object.frustumCulled = false;
        }
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
        for (const [object, was] of culled) object.frustumCulled = was;
        for (const object of enabled) object.layers.disable(SPARE);
        for (const restore of restoreMatrices.splice(0)) restore();
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! | pixels[i + 1]! | pixels[i + 2]! | pixels[i + 3]!) lit += 1;
        }
        return lit;
      };
      const ColorCtor = game.engine.scene.fog.color.constructor;
      const clearColor = renderer.getClearColor(new ColorCtor());
      const clearAlpha = renderer.getClearAlpha();
      try {
        offPixels = renderOnly(false);
        onPixels = renderOnly(true);
      } finally {
        camera.layers.mask = savedCameraLayers;
        scene.background = savedBackground;
        scene.fog = savedFog;
        renderer.setClearColor(clearColor, clearAlpha);
        target.dispose();
      }
    }
    renderer.setRenderTarget(target0);
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = shadowNeeds;
    renderer.info.autoReset = autoReset;

    offenders.sort((a, b) => b.offTris - a.offTris || b.offDraws - a.offDraws);
    results.push({
      pass: pass.name,
      drawn: { meshes: drawnMeshes.length, draws: drawnDraws, tris: drawnTris },
      off: { draws: offDraws, tris: offTris },
      control: { infoDraws, infoTris, offPixels, onPixels, walkMissed, walkInvented },
      offenders,
      stale,
      unculled,
      oversized,
    });
  }
  return results;
}

/** `window.__perf.context().clock` — `CheckClockState` in `core/checkClock.ts`. */
interface ClockState {
  readonly seconds: number;
  readonly stopAt: number;
  readonly stopped: boolean;
  readonly heldFrames: number;
  readonly heldBy: Readonly<Record<string, number>>;
}

/**
 * Waits for the world's clock to stop at the scene's moment, then for
 * {@link HELD_FRAMES} more frames drawn with it held, and checks she is where
 * the scene says she is at that moment. Nothing here is timed: the moment is
 * the page's own (`?clock=`), so how fast this machine draws changes how long
 * the wait is and nothing else.
 */
async function settle(page: Page, scene: Scene, loads: readonly string[]): Promise<{ clock: ClockState; loadsAtStop: number }> {
  type Perf = { frameCount: number; context(): Record<string, unknown> };
  const stoppedAt = await page.waitForFunction(
    () => {
      const perf = (window as unknown as { __perf?: Perf }).__perf;
      if (!perf) return false;
      const clock = perf.context()['clock'] as ClockState | null | undefined;
      // A game without `?clock=` would never stop; say so rather than time out.
      if (clock === undefined || clock === null) return { missing: true, frame: 0 };
      return clock.stopped ? { missing: false, frame: perf.frameCount } : false;
    },
    undefined,
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  const { missing, frame } = (await stoppedAt.jsonValue()) as { missing: boolean; frame: number };
  // A boot that reloaded before its clock stopped is harmless — the page
  // audited is the last, whole one, its clock run from nothing — but one that
  // reloads after this is not: see `runScene`.
  const loadsAtStop = loads.length;
  if (missing) {
    throw new Error('the page reports no `clock` — this game has no `?clock=` (core/checkClock.ts), so no moment can be pinned');
  }
  await page.waitForFunction(
    (until) => ((window as unknown as { __perf?: Perf }).__perf?.frameCount ?? 0) >= until,
    frame + HELD_FRAMES,
    { timeout: BOOT_TIMEOUT_MS, polling: 100 },
  );
  const context = await page.evaluate(() => (window as unknown as { __perf: Perf }).__perf.context());
  const clock = context['clock'] as ClockState;
  if (!clock.stopped || Math.abs(clock.seconds - scene.clock) > 1e-6) {
    throw new Error(`the world's clock reads ${clock.seconds.toFixed(3)} s (${clock.stopped ? 'stopped' : 'running'}), not stopped at ${scene.clock} s — not the moment asked for`);
  }
  const where = String(context['space']);
  if (!where.startsWith(scene.space)) {
    throw new Error(`at ${clock.seconds.toFixed(3)} s on the world's clock she is in '${where}', not '${scene.space}…' — the moment audited is not in this space`);
  }
  if (scene.riding && context['riding'] !== true) {
    throw new Error(`at ${clock.seconds.toFixed(3)} s on the world's clock she is not riding — the moment audited is not on the ride`);
  }
  return { clock, loadsAtStop };
}

/**
 * **Stale bounds over time, not at one instant.** A cached bound goes stale as
 * the instances move, so one frame can miss it: on CI the hotel's motes were
 * outside theirs about two seconds in, and inside it at one. After the audit
 * the world runs on for {@link SWEEP_SECONDS} of its own seconds and is looked
 * at every {@link SWEEP_EVERY} steps ({@link installStaleSweep}).
 */
async function sweepStale(page: Page): Promise<{ findings: StaleFinding[]; looks: number; from: number; to: number }> {
  type Clock = { state(): ClockState; extend(seconds: number): void };
  await page.evaluate(installStaleSweep, SWEEP_EVERY);
  const from = await page.evaluate((seconds) => {
    const clock = (window as unknown as { __checkClock: Clock }).__checkClock;
    clock.extend(seconds);
    return clock.state().seconds;
  }, SWEEP_SECONDS);
  await page.waitForFunction(() => (window as unknown as { __checkClock: Clock }).__checkClock.state().stopped, undefined, {
    timeout: BOOT_TIMEOUT_MS,
    polling: 200,
  });
  const swept = await page.evaluate(() => {
    const w = window as unknown as { __checkClock: Clock; __staleSweep: { findings(): StaleFinding[]; looks(): number } };
    return { findings: w.__staleSweep.findings(), looks: w.__staleSweep.looks(), to: w.__checkClock.state().seconds };
  });
  return { ...swept, from };
}

async function runScene(
  name: string,
  scene: Scene,
): Promise<{
  result?: Audit[];
  space?: string;
  clock?: ClockState;
  gpu?: string;
  sweep?: { findings: StaleFinding[]; looks: number; from: number; to: number };
  /** Loads before the moment, when there was more than one: the last is the boot audited. */
  reloadedBefore?: readonly string[];
  error?: string;
}> {
  const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  const errors: string[] = [];
  const seeds: number[] = [];
  const loads: string[] = [];
  const opened = Date.now();
  /** Loads seen when the clock stopped at the moment; any after it are another boot. */
  let loadsAtStop = Number.POSITIVE_INFINITY;
  const reloadedAfter = (): string | null =>
    loads.length > loadsAtStop ? `the page loaded again after its moment (${loads.join('; ')}) — the audit or the sweep ran on another boot` : null;
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String((e as Error)?.message ?? e)));
    page.on('console', (message) => {
      const said = /park seed (\d+)/.exec(message.text());
      if (said) seeds.push(Number(said[1]));
    });
    // Every load of the page, so a reload cannot pass unseen: a dev server's
    // full reload (vite sends one to the first page after a source edit), an
    // update gate. One after the moment would mean the audit or the sweep ran
    // on a boot that was not at it.
    page.on('load', () => loads.push(`${((Date.now() - opened) / 1000).toFixed(1)} s ${page.url()}`));
    await page.goto(at(scene), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const settled = await settle(page, scene, loads);
    const clock = settled.clock;
    loadsAtStop = settled.loadsAtStop;
    const result = await page.evaluate(auditInPage, OVERSIZED_RADIUS_M);
    const facts = await page.evaluate(() => {
      const context = (window as unknown as { __perf: { context(): Record<string, unknown> } }).__perf.context();
      return { space: String(context['space']), gpu: String(context['gpu']) };
    });
    // After the audit, which it must not disturb: it runs the world on.
    const sweep = await sweepStale(page);
    const wrong = seeds.filter((s) => s !== SEED);
    if (seeds.length === 0) return { error: `${name}: the page never reported its park seed, so the pin to ${SEED} is unproven` };
    if (wrong.length > 0) return { error: `${name}: asked for park seed ${SEED}, the page built ${wrong.join(', ')}` };
    if (errors.length > 0) return { error: `${name}: page errors: ${errors.slice(0, 3).join(' | ')}` };
    const reloaded = reloadedAfter();
    if (reloaded) return { error: `${name}: ${reloaded}` };
    return { result, space: facts.space, gpu: facts.gpu, clock, sweep, ...(loads.length > 1 ? { reloadedBefore: [...loads] } : {}) };
  } catch (error) {
    // A reload under the audit usually surfaces as a page that has lost its
    // game half way through an evaluate; say which, not just the symptom.
    const reloaded = reloadedAfter();
    if (reloaded) return { error: `${name}: ${reloaded} (it surfaced as: ${String((error as Error)?.message ?? error).split('\n')[0]})` };
    return { error: `${name} (${scene.path}): ${String((error as Error)?.message ?? error).split('\n')[0]}${errors.length ? ` — page errors: ${errors.slice(0, 3).join(' | ')}` : ''}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const say = (line: string): void => {
  process.stderr.write(`[cull-audit] ${line}\n`);
};

try {
  const response = await fetch(`${BASE}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `check:cull-audit: nothing is serving ${BASE} (${String(error)}). ` +
      'Run `pnpm run check:served-cull-audit`, or point CHECK_CULL_AUDIT_URL at your own dev server.',
  );
}

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const failures: string[] = [];
const dump: Record<string, unknown> = {};
let measured = 0;
for (const [name, scene] of Object.entries(BUDGETS)) {
  if (only && !only.has(name)) continue;
  const started = Date.now();
  const { result, space, clock, gpu, sweep, reloadedBefore, error } = await runScene(name, scene);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (error || !result || !clock || !sweep) {
    failures.push(error ?? `${name}: no result`);
    say(`${name}: FAILED to measure (${secs} s) — ${error}`);
    continue;
  }
  if (result.length === 0) {
    failures.push(`${name}: no scene was being drawn, so nothing was audited`);
    continue;
  }
  measured += 1;
  dump[name] = { space, clock, gpu, passes: result, sweep };
  const held = Object.entries(clock.heldBy).map(([on, frames]) => `${on} for ${frames} frames`).join(', ') || 'nothing';
  say(`${name.padEnd(14)} the moment: ${clock.seconds.toFixed(3)} s on the world's clock (asked ${scene.clock} s; it waited on ${held}) — ${gpu}`);
  if (reloadedBefore) say(`  the page loaded ${reloadedBefore.length} times before its moment (${reloadedBefore.join('; ')}); audited the last, whole boot`);
  let offDraws = 0;
  let offTris = 0;
  for (const audit of result) {
    offDraws += audit.off.draws;
    offTris += audit.off.tris;
    const c = audit.control;
    say(
      `${name.padEnd(14)} ${String(space).padEnd(14)} ${audit.pass}: drawn ${audit.drawn.meshes} meshes, ${audit.drawn.draws} draws, ${audit.drawn.tris} tris` +
        ` | OFF-SCREEN ${audit.off.draws} draws, ${audit.off.tris} tris | ${secs} s`,
    );
    say(`  control: three counted ${c.infoDraws} draws, ${c.infoTris} tris; pixels from off-screen set ${c.offPixels}, from on-screen set ${c.onPixels}`);
    for (const o of audit.offenders.slice(0, 8)) {
      say(
        `    ${o.offTris.toString().padStart(9)} tris ${o.offDraws.toString().padStart(3)} draws  ${o.cause.padEnd(26)} ` +
          `${o.offInstances}/${o.instances} inst, r ${Number.isFinite(o.boundRadius) ? o.boundRadius.toFixed(0) : '∞'} m  ${o.name}`,
      );
    }
    if (audit.offenders.length > 8) say(`    … ${audit.offenders.length - 8} more offenders`);
    if (audit.unculled.length) say(`  frustumCulled=false and drawn: ${audit.unculled.length} (${audit.unculled.slice(0, 6).join(', ')}${audit.unculled.length > 6 ? ', …' : ''})`);
    if (audit.oversized.length) say(`  bound wider than ${OVERSIZED_RADIUS_M} m: ${audit.oversized.join(', ')}`);
    // Controls fail the check whatever MEASURE says: an instrument that fails its control measured nothing.
    if (c.infoDraws !== audit.drawn.draws || c.infoTris !== audit.drawn.tris) {
      failures.push(
        `${name}: CONTROL — the walk predicted ${audit.drawn.draws} draws / ${audit.drawn.tris} tris, three drew ${c.infoDraws} / ${c.infoTris}; the audit is not describing the frame` +
          ` (three drew but the walk missed: ${c.walkMissed.slice(0, 5).join(', ') || 'nothing'}; the walk predicted but three skipped: ${c.walkInvented.slice(0, 5).join(', ') || 'nothing'})`,
      );
    }
    if (c.offPixels !== 0) failures.push(`${name}: CONTROL — what the audit called off-screen lit ${c.offPixels} pixels; its "off-screen" is wrong`);
    if (!(c.onPixels > 0)) failures.push(`${name}: CONTROL — what the audit called on-screen lit ${c.onPixels} pixels; the pixel read cannot see anything`);
  }
  // **Stale bounds**: at the audited moment, and over the sweep after it. One
  // line per mesh, however often it was seen out.
  const stale = new Map<string, string>();
  for (const audit of result) {
    for (const s of audit.stale) stale.set(s.name, `${s.out} of ${s.of} instances outside the bound three culls by, at ${clock.seconds.toFixed(3)} s`);
  }
  for (const f of sweep.findings) {
    if (!stale.has(f.name)) {
      stale.set(f.name, `up to ${f.worst} of ${f.of} instances outside the bound three culls by, first at ${f.firstAt.toFixed(3)} s, by up to ${f.overshoot.toFixed(3)} m`);
    }
  }
  say(
    `  stale bounds: swept ${sweep.from.toFixed(3)}–${sweep.to.toFixed(3)} s of the world's clock, ${sweep.looks} looks — ` +
      (stale.size === 0 ? 'none' : `${stale.size} mesh(es)`),
  );
  const knownStale = scene.knownStale ?? 0;
  if (stale.size > knownStale) {
    for (const [mesh, how] of stale) failures.push(`${name}: stale bound — ${mesh}: ${how} (three may cull it while on screen); ${stale.size} found, ${knownStale} tolerated`);
  } else if (stale.size > 0) {
    say(`  NOT COVERED: ${stale.size} stale bound(s) tolerated here (ceiling ${knownStale}) — three may cull these while on screen; fix them and lower the ceiling:`);
    for (const [mesh, how] of stale) say(`    ${mesh}: ${how}`);
  }
  if (MEASURE) continue;
  const drawCeiling = Math.max(FLOOR_DRAWS, Math.ceil(scene.offDraws * HEADROOM));
  const triCeiling = Math.max(FLOOR_TRIS, Math.ceil(scene.offTris * HEADROOM));
  say(`  budget: off-screen draws ${offDraws} / ceiling ${drawCeiling}, off-screen tris ${offTris} / ceiling ${triCeiling}`);
  if (offDraws > drawCeiling) failures.push(`${name}: ${offDraws} draws a frame for meshes wholly off the screen, ceiling ${drawCeiling} (measured ${scene.offDraws})`);
  if (offTris > triCeiling) failures.push(`${name}: ${offTris} triangles a frame off the screen, ceiling ${triCeiling} (measured ${scene.offTris})`);
}

if (OUT) writeFileSync(OUT, JSON.stringify(dump, null, 2));
say(`audited ${measured} of ${Object.keys(BUDGETS).length} spaces on park seed ${SEED}; the game camera's frustum only (the shadow pass culls against the light's)`);
if (failures.length > 0) {
  console.error(`\ncheck:cull-audit FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exitCode = 1;
} else if (MEASURE) {
  say('MEASURE=1: counts printed, budgets not asserted (controls were)');
} else {
  console.log('check:cull-audit: every space is within its off-screen budget, and both controls held.');
}
