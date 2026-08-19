import './style.css';
import { Vector3 } from 'three';
import { registerSW } from 'virtual:pwa-register';
// **`import type`, not `import`** — this is the whole reason the ride can cover
// the load. A static import of `Game` pulls in `World`, `paths.ts` and every
// ride's plan module, and each of those solves its route in a top-level
// `const`: four seconds of generation paid before `boot()` runs its first line,
// in front of a blank screen. A type import is erased, so the park's code is
// now fetched and evaluated by {@link loadGame} at a moment of our choosing —
// which is while a bus is on screen. See `boot/parkGeneration.ts`.
import type { Game, GameOptions } from './Game';
import { Engine } from './core/Engine';
import { Loop } from './core/Loop';
import { BusJourney } from './world/entrance/BusJourney';
// From `arrivalFlag`, not `ArrivalSequence`, for the same reason: importing the
// sequence drags in `terrain` and `boundary` and solves the park's outline.
import { arrivalIsDue } from './world/entrance/arrivalFlag';
import { JourneyDirector } from './world/entrance/journeyDirector';
import {
  GENERATION_BUDGET_MS,
  OVERRUN_GENERATION_BUDGET_MS,
  ParkGeneration,
} from './boot/parkGeneration';
import { OVERRUN_WARMUP_BUDGET_MS, ShaderWarmup, WARMUP_BUDGET_MS } from './boot/shaderWarmup';
import { JourneySkip } from './ui/JourneySkip';
import { JourneyTitle } from './ui/JourneyTitle';
import { JourneyWait } from './ui/JourneyWait';
import { UpdateGate } from './ui/UpdateGate';
import { CharacterCreation, ContinueOrRestart, DevBadge, defaultCharacterChoice } from './ui';
import { gameStore } from './state';
import { saveFlags } from './state/flags';
import { clearSave, loadSave, type SaveFile } from './state/save';
import { startVersionCheck } from './version-check';
import { askForOrientationOnFirstGesture } from './core/deviceOrientationLook';

/**
 * Entry point. Finds the canvas, offers to continue a saved park, shows the
 * character creator when there is nothing to continue, then builds the game
 * and hides the splash.
 *
 * The splash is dismissed on the first rendered frame rather than immediately,
 * so nobody ever sees an empty blue rectangle while the park is being built.
 *
 * **All of this runs before `Game` exists** — deliberately not `Game`-owned
 * overlays like `WhatsNew`. `Player`'s constructor reads
 * `gameStore.get().player` (name, hair colour and style, outfit colour) the
 * moment it builds the kid, so both the save and the character creator have to
 * have finished writing the store before that happens. It also guarantees both
 * finish before the cat-bus arrival sequence (`world/entrance/`) — nothing
 * downstream of `new Game(...)` can run before this does, so by the time the
 * bus is built she is already the character the child just made, and she rides
 * in as herself. (This comment said "whenever that gets wired up" from July
 * until 7 August 2026, which is exactly how long the arrival sat in the tree
 * as dead code — see `world/entrance/ArrivalSequence.ts`.) The HUD's "Look"
 * pill, which changes a look mid-session, does
 * not run through here at all any more — see `Game.applyLiveLook`, which
 * rebuilds `Player`'s own model in place instead of coming back through boot.
 *
 * The three ways a load can go:
 *
 * - **A readable save**: the welcome-back screen (`ui/ContinueOrRestart.ts`)
 *   offers *keep playing* or *start a new game*.
 * - **No save**: straight into the character creator, exactly as before.
 * - **An unreadable save** — corrupt, or a schema this build cannot migrate:
 *   `loadSave()` returns `null`, which is the same path as "no save". A
 *   fresh start is always offered rather than a crash or a half-loaded park;
 *   see `state/save.ts`.
 *
 * `RIDE_DEEP_LINKS` below is a fourth, developer-only path: a URL typed by
 * hand, not a button a child presses, so it also skips the welcome-back
 * prompt straight into {@link continueGame} — there being nobody to *ask*
 * "keep playing?" is the entire point of pasting the link in the first place.
 */
function boot(): void {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  const splash = document.getElementById('boot-splash');

  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error('Land of Good Places: expected #game-canvas and #ui-root in the document.');
  }

  const save = loadSave();
  const rideDeepLink = RIDE_DEEP_LINKS[location.pathname];
  const debugView = parseDebugView(location.pathname, location.search) ?? undefined;

  // A save from before the character creator existed, or one where "start
  // again" was pressed and the tab was closed mid-creation, has everything
  // except a character. There is nothing to offer to continue, so don't ask.
  if (save && save.flags.createdCharacter) {
    // Both branches supply their own full-screen backdrop immediately, so the
    // generic "building the garden…" splash card would only be a flash behind
    // them — hide it now rather than waiting for a first game frame that is
    // still a button press away.
    splash?.classList.add('hidden');
    if (rideDeepLink) {
      continueGame(canvas, uiRoot, splash, save, rideDeepLink);
      return;
    }
    if (debugView) {
      continueGame(canvas, uiRoot, splash, save, undefined, debugView);
      return;
    }
    new ContinueOrRestart(uiRoot, save, {
      onContinue: () => continueGame(canvas, uiRoot, splash, save),
      onStartAgain: () => startFresh(canvas, uiRoot, splash, rideDeepLink),
    });
    return;
  }

  // No save to skip past, but a deep link still boards the ride the instant
  // the brand-new character exists.
  splash?.classList.add('hidden');
  startFresh(canvas, uiRoot, splash, rideDeepLink, debugView);
}

/**
 * `/rail-race` and friends: a URL a developer types to reach a ride under
 * test without walking there.
 *
 * Every entry maps straight to a **stall id**, and that is deliberately the
 * only thing it knows about the ride. Two quite different things can sit
 * behind one: a world ride that `MiniGameHost.boardRide` boards in the park
 * (the Rail Race, the Sky Cruiser — see `Game.ts`'s own wiring of it), or a
 * stall with a curtain mini-game behind it (the Space Ferris Wheel, until it
 * becomes a world ride too). {@link launchGame} tries the ride first and falls
 * back to opening the stall, so adding one here is one line either way — and a
 * ride that later changes from one kind to the other needs no change at all.
 */
const RIDE_DEEP_LINKS: Readonly<Record<string, string>> = {
  '/rail-race': 'railRacer',
  '/sky-cruiser': 'skyCruiser',
  '/ferris': 'spaceFerrisWheel',
  // The ginormous slide, whose entrance is on the castle roof — the one ride
  // you otherwise have to climb a building to reach. The second link brings the
  // grown-up along, so the "in front, lying down" half of it can be seen
  // without walking up to invite them first.
  '/slide': 'ginormousSlide',
  '/slide-with-grownup': 'ginormousSlideWithGrownUp',
  // The Land Hotel's lobby (#236) — not a ride at all, but exactly the same
  // QA problem the slide had: reaching it means a walk across the park on a
  // layout that is different on every seed. Drops her just inside the front
  // door, key not yet given, so the whole check-in flow is testable.
  '/hotel': 'hotelLobby',
  // A guest-floor bathroom (#281, every floor gets one) — same QA problem
  // again, and worse: reaching one on foot means the lobby, the stairs *and*
  // the corridor first. Drops her at the floor's own "Use" stand spot,
  // facing the pan, so the fixtures and the privacy roof are on screen
  // immediately. `/hotel-bathroom` alone keeps its original Floor 1 target;
  // the own-room rewrite (each bathroom is now a real room, not a nook that
  // always looked the same) adds one link per remaining floor so each can
  // be reached — and QA'd — on its own.
  '/hotel-bathroom': 'hotelBathroom',
  '/hotel-bathroom-lobby': 'hotelBathroomLobby',
  '/hotel-bathroom-garden': 'hotelBathroomGarden',
  '/hotel-bathroom-ocean': 'hotelBathroomOcean',
  // The hotel's breakfast room (#276) — the clipped `.action-chip-row` this
  // was added for lives here and nowhere else. Drops her already seated at a
  // free chair, so the chip row is on screen the instant the park exists
  // rather than after a walk across the hotel and a tap to sit down.
  '/hotel-breakfast': 'hotelBreakfast',
  // The guest suite, fifty storeys up (#273/#278's doorway-clearance fix and
  // #279's bigger bedrooms and pet beds) — same problem again, and worse: the
  // normal way in is a walk across the park *and* the lift *and* reception
  // handing over the key first. Drops her just inside the suite's own
  // corridor door, key check skipped, facing down the hall so the bedroom
  // doors and the lounge doorway are both in view — see `Hotel.enterSuite`.
  '/hotel-suite': 'hotelSuite',
  // The Spooky House's jump-scare cycle (#293) — same QA problem as every
  // other deep link, and the stall QA had no way to reach without walking a
  // seed-different park first. `spookyHouse` is a curtain mini-game, not a
  // world ride, so this falls to `MiniGameHost.open` the same way `/ferris`
  // does.
  '/spooky-house': 'spookyHouse',
};

/** What `/view` needs to drop a debug camera into the built park. See {@link parseDebugView}. */
interface DebugViewParams {
  readonly position: Vector3;
  readonly lookAt: Vector3;
  readonly timeOfDay?: number;
  /** 0..1 towards space — see `DayNight.setSpaceFactor`. */
  readonly space?: number;
}

/**
 * `/view?camPos=x,y,z&camDir=x,y,z&timeOfDay=HH:MM` — a debug-only way to look
 * at any point in the built park, from any angle, at any time of day, without
 * boarding a ride or walking there. A URL a developer types, never a button a
 * child presses — same spirit as {@link RIDE_DEEP_LINKS}, and it reuses the
 * same "skip the welcome-back prompt" wiring below.
 *
 * `camPos` defaults to a wide establishing view rather than the origin, which
 * sits inside the ball pit; `camDir` defaults to looking back at the origin
 * from wherever `camPos` is, so leaving it off (as in the family's own example
 * URL) still points the camera at the park rather than off into empty sky.
 * `timeOfDay` is genuinely optional — omit it and the clock runs normally.
 */
function parseDebugView(pathname: string, search: string): DebugViewParams | null {
  if (pathname !== '/view') return null;
  const params = new URLSearchParams(search);
  const position = parseVector3(params.get('camPos')) ?? new Vector3(40, 30, 40);
  const direction = parseVector3(params.get('camDir'));
  const lookAt =
    direction && direction.lengthSq() > 0
      ? position.clone().add(direction.normalize())
      : new Vector3(0, 0, 0);
  const timeOfDay = parseClockFraction(params.get('timeOfDay'));
  const space = parseUnitFraction(params.get('space'));
  // Assigned rather than spread, so an absent param stays *absent* — under
  // `exactOptionalPropertyTypes` an optional property may be missing but never
  // explicitly `undefined`.
  const view: {
    position: Vector3;
    lookAt: Vector3;
    timeOfDay?: number;
    space?: number;
  } = { position, lookAt };
  if (timeOfDay !== undefined) view.timeOfDay = timeOfDay;
  if (space !== undefined) view.space = space;
  return view;
}

/**
 * Makes sure a ride deep link has somebody to ride with.
 *
 * `/ferris` boards on the first frame, and the gondola seats whatever is
 * paradeable and not stowed at the instant it is built — so a continued
 * profile whose pets are all in the backpack arrives in an empty car, and
 * "your parade rides with you" is the half of that ride a developer typing the
 * URL most often wants to see. Does nothing at all if anything is already out,
 * so it can never overrule a child who put her pets away on purpose.
 */
function grantRideCompanion(): void {
  const pet = defaultCharacterChoice().pet;
  if (pet) gameStore.ensureSomethingToParade(pet);
}

/** "0.6" -> 0.6, clamped to 0..1. Anything else is treated as absent. */
function parseUnitFraction(text: string | null): number | undefined {
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** "x,y,z" -> a Vector3, or null if missing/malformed — never throws on a hand-typed URL. */
function parseVector3(text: string | null): Vector3 | null {
  if (!text) return null;
  const parts = text.split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Vector3(parts[0], parts[1], parts[2]);
}

/** "HH:MM" -> a [0,1) fraction of a day, the same clock {@link DayNight} keeps. */
function parseClockFraction(text: string | null): number | undefined {
  if (!text) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return (hours * 60 + minutes) / (24 * 60);
}

/**
 * Loads the park back exactly as it was left.
 *
 * `boardStallId` — set only by a {@link RIDE_DEEP_LINKS} match — boards that
 * ride the moment the park exists, ahead of wherever `save.place` would
 * otherwise have put her.
 */
function continueGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  save: SaveFile,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  gameStore.hydrate(save);
  saveFlags.hydrate(save.flags);
  if (boardStallId) grantRideCompanion();
  // Omitted rather than passed as undefined — `exactOptionalPropertyTypes`.
  const options: GameOptions = save.place ? { startPlace: save.place } : {};
  launchGame(canvas, uiRoot, splash, options, boardStallId, debugView);
}

/**
 * Throws away whatever was saved and makes a brand-new character.
 *
 * The save is cleared *first*, before the creator opens, so that closing the
 * tab halfway through making a new character cannot leave the old park behind
 * to be offered again — the child already said goodbye to it, and being asked
 * a second time would be worse than either answer.
 *
 * `boardStallId` set means a ride deep link brought us here with nobody to
 * ask — "goes straight into the ride" has to be true even from a completely
 * empty profile, not only a returning one, so this skips the form itself and
 * hands `defaultCharacterChoice()` (`ui/CharacterCreation.ts` — the exact
 * defaults the form would otherwise have started on) straight to
 * `completeCharacterCreation`, same as the form's own "Let's go!" would.
 */
function startFresh(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  clearSave();
  if (boardStallId || debugView) {
    // `defaultCharacterChoice` includes the default pet and
    // `completeCharacterCreation` grants it unstowed, so a brand-new profile
    // already has something to ride with. The belt-and-braces call is for the
    // *continued* profile above, which may have none.
    gameStore.completeCharacterCreation(defaultCharacterChoice());
    saveFlags.markCharacterCreated();
    launchGame(canvas, uiRoot, splash, {}, boardStallId, debugView);
    return;
  }
  new CharacterCreation(uiRoot, {
    onComplete: (choice) => {
      gameStore.completeCharacterCreation(choice);
      saveFlags.markCharacterCreated();
      launchGame(canvas, uiRoot, splash, {}, boardStallId, debugView);
    },
  });
}

/**
 * Fetches and evaluates the park's own code, and hands back its constructor.
 *
 * **One place, so both boot paths load the same module the same way.** Awaiting
 * this is what runs every module-scope `const` that has not been run already —
 * so when the ride has pre-warmed them (`boot/parkGeneration.ts`) this settles
 * in a frame, and when nothing has (a continued save, a ride deep link, `/view`)
 * it pays the full cost here exactly as the old static import did.
 *
 * The module cache makes it idempotent, so calling it twice is free.
 */
async function loadGame(): Promise<typeof import('./Game').Game> {
  return (await import('./Game')).Game;
}

function launchGame(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  options: GameOptions,
  boardStallId?: string,
  debugView?: DebugViewParams,
): void {
  // A ride deep link and `/view` are the only two things that skip the cat-bus
  // arrival, and both for the same reason: the entire point of typing either
  // URL is to be looking at the thing it names on the first frame, not sitting
  // through an arrival first. Everything else leaves the decision to the save
  // flag, so the arrival is what happens unless something says otherwise —
  // forgetting to wire an opt-out shows up as a bus that should not be there,
  // which somebody notices, rather than as no bus at all, which nobody did for
  // twelve days. See `world/entrance/ArrivalSequence.ts`.
  const gameOptions: GameOptions =
    boardStallId !== undefined || debugView !== undefined
      ? { ...options, arriveByBus: false }
      : options;
  const engine = new Engine(canvas);

  // **The ride comes first, and the park is built while it plays.**
  //
  // Only for a genuine arrival: a ride deep link or `/view` has already said
  // `arriveByBus: false`, and a continued save has already arrived, so both go
  // straight to the park exactly as before. `arrivalIsDue()` is the same one
  // question `Entrance` asks — asked here too rather than answered a second
  // way, so a journey without an arrival behind it is not expressible.
  if (gameOptions.arriveByBus !== false && arrivalIsDue()) {
    rideInThenPlay(engine, uiRoot, splash, gameOptions, () => {
      void finishLaunch(engine, uiRoot, splash, gameOptions, boardStallId, debugView);
    });
    return;
  }
  void finishLaunch(engine, uiRoot, splash, gameOptions, boardStallId, debugView);
}

/**
 * Plays the cat bus's journey, **generating the park during it**, then hands
 * over.
 *
 * > *"this is the time when the procgen should actually run, amortised over
 * > many small tasks over many frames, so it acts as a kind of loading screen
 * > for the park generation"* — Jim, 7 August 2026
 *
 * Which is now what happens, and the ordering below is the whole feature:
 *
 * 1. **Draw the bus.** Nothing else may happen on frame one.
 * 2. **Generate, eight milliseconds at a time** (`ParkGeneration`), from frame
 *    two onwards. This is the ~4 s of module-scope solving that used to sit in
 *    front of the first pixel — five ride plans one per frame, then the
 *    ginormous slide's 3.46 s search sliced at every joint.
 * 3. **Build the `World`** once, and only once generation says it is finished.
 * 4. **Offer the skip**, and only once there is a park to skip to.
 *
 * **The skip is gated on `game` existing**, which is the generator's own
 * completion signal and not a timer that hopes to match it. There is no way to
 * offer the skip early here without also having somewhere to skip *to*, which
 * is the property Jim asked for: *"make it skippable only once the park has
 * generated"*.
 *
 * The one thing still unamortised is `new Game(...)` itself — 442 ms of `World`
 * construction in a single synchronous constructor. It was always hidden by the
 * ride, it is 10% of what the boot costs, and slicing a constructor is a much
 * larger job than slicing a search; `JourneyDirector.overrunning` covers the
 * case where even that does not fit.
 */
function rideInThenPlay(
  engine: Engine,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  options: GameOptions,
  handOver: () => void,
): void {
  const player = gameStore.get().player;
  const journey = new BusJourney({
    skin: player.skinColour,
    hair: player.hairColour,
    outfit: player.outfitColour,
    hairStyle: player.hairStyle,
  });

  const director = new JourneyDirector();
  const generation = new ParkGeneration();
  const skip = new JourneySkip();
  // The opening credit, over the whole ride. Mounted on `document.body` for the
  // same reason the skip button is — `Hud` empties `#ui-root` from `new Game()`,
  // which happens mid-ride — and disposed everywhere the ride tears down, of
  // which there are two: `finish()` and the generation-failure path below.
  const title = new JourneyTitle();
  // The loading caption, shown only while the bus is parked at the gate waiting
  // for a slow device to finish the park (`director.overrunning`). Idle and
  // invisible for the whole of an on-time ride. Mounted and torn down alongside
  // the title, for the same `#ui-root`-is-emptied reason.
  const wait = new JourneyWait();
  // Same spirit as `window.game` below: something to poke from a console, and
  // the only practical way to drive a capture. Headless WebGL runs the park at
  // one or two frames a second and `Loop` clamps `dt` to `MAX_FRAME_DELTA`, so
  // ride time and wall-clock time are an order of magnitude apart — a capture
  // script that sleeps is measuring the wrong clock.
  if (import.meta.env.DEV) {
    (
      window as unknown as {
        journey: {
          ride: BusJourney;
          skipOffered: () => boolean;
          // The generation's own view of itself, for a capture to watch the
          // loading screen actually loading. Read-only questions; nothing here
          // can drive the boot.
          stage: () => string;
          generationReady: () => boolean;
          framesWorked: () => number;
          parkReady: () => boolean;
          /** Which shot the ride's own director is cutting to — see `BusJourney`. */
          view: () => string;
          // The shader warm-up's own view of itself, same spirit as the
          // generation's above: a capture has to be able to see whether the
          // programs really were compiled before hand-over, rather than infer
          // it from how smooth the park felt afterwards.
          warmReady: () => boolean;
          warmRemaining: () => number;
          warmSpentMs: () => number;
          warmWorstMs: () => number;
          warmFrames: () => number;
        };
      }
    ).journey = {
      ride: journey,
      view: () => journey.view,
      skipOffered: () => director.skipOffered,
      stage: () => generation.stage,
      generationReady: () => generation.ready,
      framesWorked: () => generation.framesWorked,
      parkReady: () => director.parkReady,
      warmReady: () => director.warmupReady,
      warmRemaining: () => warmup?.progress.remaining ?? -1,
      warmSpentMs: () => warmup?.spentMs ?? 0,
      warmWorstMs: () => warmup?.worstMs ?? 0,
      warmFrames: () => warmup?.framesWorked ?? 0,
    };
  }
  let done = false;
  // Built the moment the park is, because it needs that park's scene and
  // camera. Null until then, which is also `shouldWarmShaders`'s answer.
  let warmup: ShaderWarmup | null = null;

  const finish = (): void => {
    if (done) return;
    done = true;
    loop.stop();
    skip.dispose();
    title.dispose();
    wait.dispose();
    journey.dispose();
    handOver();
  };

  skip.onPress(() => {
    // Only ever reachable once the skip is offered — `JourneySkip` is not shown
    // before then — but asked rather than assumed, because "the button is
    // hidden" and "the button does nothing" are two different guarantees and
    // only one of them survives a stray tap on a touchscreen.
    if (!director.skipOffered) return;
    finish();
  });

  const loop = new Loop((tick) => {
    director.advance(tick.dt);
    // **The bus keeps driving rather than parking.** The drive is an infinitely
    // repeating world; it only stops looping and cuts to the park once the
    // director says the park is ready *and* the minimum ride has been seen
    // (`readyToArrive`). Until then a slow device simply loops for longer — the
    // bus is always moving, so there is never a parked wait.
    journey.update(tick.dt, director.readyToArrive);
    // **`animationTime`, not `elapsed`.** `elapsed` is a distance down the lane
    // dressed as a clock: it clamps at twenty seconds and stops dead while the
    // bus waits. Feeding it to the title froze the letters mid-jump for the
    // whole of an overrun — which QA measured at one title layout in 51 samples
    // over 6.4 s, against 262 during the ride, and read as a crash rather than
    // as a wait. Anything drawn that must keep moving reads the clock that
    // never stops. See `ui/JourneyTitle.ts` and `BusJourney.animationTime`.
    title.update(journey.animationTime);
    // **The loading caption.** Shown only while the drive is looping past its
    // nominal length waiting for a slow device to finish the park (`overrunning`),
    // and told which part is being built so the wait reads as progress. The bus is
    // moving throughout now, so this reassures rather than rescues; idle and
    // invisible for the whole of an on-time ride.
    wait.update(director.overrunning, generation.stage);
    const renderer = engine.renderer;
    renderer.clear(true, true, true);
    journey.render(renderer, engine.width, engine.height);

    // **The park's generation, a slice at a time, behind a moving bus.**
    //
    // From frame two onwards, and never more than a few milliseconds of it, so
    // the orbit does not stutter. `ParkGeneration` owns what runs in what order;
    // all that is decided here is *when* it may have the CPU, which is: after
    // the bus has been drawn, and before anything downstream of it.
    if (director.shouldAdvanceGeneration()) {
      // Eight milliseconds while the bus is rolling and the orbit must not
      // stutter; most of the frame once it has parked at the gate and the only
      // thing left to do is finish. `JourneyDirector` owns which it is — see
      // `overrunAwareBudgetMs`, and the measured minutes-long wait it removes.
      generation.advance(
        director.overrunAwareBudgetMs(GENERATION_BUDGET_MS, OVERRUN_GENERATION_BUDGET_MS),
      );
      if (generation.ready) director.noteGenerationReady();
      // A park that cannot be generated is not something to keep driving a bus
      // in front of. Without this the ride idles at the kerb for ever waiting
      // for a `ready` that will never come — see `showBootFailure`.
      const problem = generation.failed;
      if (problem) {
        loop.stop();
        skip.dispose();
        title.dispose();
        wait.dispose();
        journey.dispose();
        showBootFailure(problem);
        return;
      }
    }

    // The `World`, once — and only once every route it reads has been solved.
    // `Game`'s constructor is synchronous, so this is one hitch in a
    // twenty-second ride rather than a wait in front of a blank screen.
    if (director.shouldBuildPark()) {
      director.noteParkBuildStarted();
      // The park's HUD belongs to the park. `Game`'s constructor mounts the
      // whole of it, and without this the pills, the buttons and the backpack
      // would appear over a bus in a lane a mile from anywhere the controls
      // mean anything. Put back at hand-over, below.
      uiRoot.style.visibility = 'hidden';
      // Already fetched and evaluated by the generation above, so this settles
      // on the next frame rather than going to the network.
      void loadGame()
        .then((GameClass) => {
          handOverGame = new GameClass(engine, uiRoot, options);
          // **The completion signal, and there is only one.** A park object in
          // hand — not a timer that hopes to match how long one takes to build.
          director.noteParkReady();
          warmup = new ShaderWarmup(engine.renderer, handOverGame.engine.scene, handOverGame.camera.camera);
          skip.show();
        })
        // **Without this the ride has no bottom.** The generation-failure path
        // above covers a park that cannot be *solved*; this covers the chunk
        // failing to load and the constructor throwing, and neither of those
        // sets `generation.failed`. Every escape route is downstream of
        // `noteParkReady()`: the skip is only shown here, `skipOffered` reads
        // `parkReady`, and `shouldBuildPark()` will not fire twice because
        // `parkStartedOnFrame` is already set. So a rejection here left the bus
        // idling at the gate for ever with no skip, no error and no retry —
        // the one way a first-run player could genuinely be stuck, and the
        // exact shape of the thing Jim reported seeing.
        .catch((error: unknown) => {
          loop.stop();
          skip.dispose();
          title.dispose();
          wait.dispose();
          journey.dispose();
          showBootFailure(error);
        });
    }

    // **The park's shader programs, a few milliseconds at a time.**
    //
    // Same loop, same budget, same reason as the generation slicing above: the
    // work has to happen somewhere, and behind a moving bus is the one place it
    // costs a child nothing. Without this, 64 of the park's 116 programs
    // compiled while she was walking about, one of them freezing a frame for
    // 1.29 s. See `boot/shaderWarmup.ts`.
    if (warmup && director.shouldWarmShaders()) {
      warmup.advance(director.overrunAwareBudgetMs(WARMUP_BUDGET_MS, OVERRUN_WARMUP_BUDGET_MS));
      if (warmup.ready) director.noteWarmupReady();
    }

    if (director.readyToHandOver) finish();
  });
  // The splash goes the moment the ride is on screen, not when the park is.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => splash?.classList.add('hidden'));
  });
  loop.start();
}

/** The park, once there is one — built by {@link rideInThenPlay} or here. */
let handOverGame: Game | null = null;

async function finishLaunch(
  engine: Engine,
  uiRoot: HTMLElement,
  splash: HTMLElement | null,
  gameOptions: GameOptions,
  boardStallId?: string,
  debugView?: DebugViewParams,
): Promise<void> {
  // Free when the ride has already loaded it; the full four seconds of
  // module-scope solving when nothing has — a continued save, a ride deep link
  // or `/view`, none of which play an arrival. Those are exactly the paths that
  // paid it before this change too, so none of them got slower.
  const GameClass = await loadGame();
  const game = handOverGame ?? new GameClass(engine, uiRoot, gameOptions);
  handOverGame = null;
  // Whether or not a ride hid it (see `rideInThenPlay`), the park's HUD is the
  // park's, and the park is what is about to be on screen.
  uiRoot.style.visibility = '';

  // **Nothing stands in front of the arrival.** `WhatsNew` opens itself from
  // `Game`'s constructor when there is unseen content, and it pauses the park
  // behind it — so the twenty-second ride handed over to a modal, with the bus
  // frozen mid-roll behind it, which is what a capture of the first end-to-end
  // run showed. It is doubly wrong for this player in particular: she made her
  // character sixty seconds ago, so there is nothing that is *new* to her.
  //
  // A continued save has no arrival and still gets the panel, which is the case
  // it was written for.
  if (game.world.entrance.arrival) game.whatsNew.close();

  game.start();

  if (boardStallId) {
    // Both wired synchronously inside `Game`'s own constructor, which has
    // already returned by this point — nothing here waits a frame.
    game.whatsNew.close();
    // A world ride boards through `boardRide`; a stall with a curtain
    // mini-game behind it opens through `open()`. Trying the ride first and
    // falling back is what lets one deep-link table serve both kinds — and
    // what means a stall that graduates from mini-game to world ride is
    // already wired the day it does. `boardRide` returns false for an id it
    // does not know, which is exactly the signal needed here.
    if (!game.miniGames.boardRide?.(boardStallId)) game.miniGames.open(boardStallId);
  }
  if (debugView) {
    game.whatsNew.close();
    game.enterDebugView(
      debugView.position,
      debugView.lookAt,
      debugView.timeOfDay,
      debugView.space,
    );
  }

  // Unmissable red "DEV" watermark — never present in a production build.
  DevBadge.mountIfDev(uiRoot);

  // Give the first frame a moment to land before revealing the park.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => splash?.classList.add('hidden'));
  });

  // Handy for poking at the world from the browser console during development.
  if (import.meta.env.DEV) {
    (window as unknown as { game: Game }).game = game;
  }
}

/**
 * Registers the service worker ourselves (rather than the PWA plugin's own
 * injected script — see `vite.config.ts`'s `injectRegister: false`) purely to
 * get at `onNeedRefresh`: the one hook that fires when a new deploy has
 * finished downloading in the background and is sat waiting. That is the gate's
 * entire trigger — this function itself polls or schedules nothing.
 *
 * `startVersionCheck` (`version-check.ts`), in production only, is what
 * actually schedules anything: a browser only checks a service worker for
 * updates on navigation, and the family leaves the game open on a phone for
 * hours mid-session, so a deploy could otherwise sit undetected the whole
 * time it is open. It polls a plain `version.txt` every two minutes and, the
 * moment that disagrees with this bundle's own version, calls the service
 * worker's own `update()` — which is what makes `onNeedRefresh` below fire,
 * same as it always has. One trigger path, just two ways to reach it.
 *
 * Kept out of `Game` entirely, and called below independently of `boot()`'s
 * own try/catch: a new version of the *code*, not of the park, so it must
 * keep working even on the day `Game`'s constructor throws and the splash
 * turns into an apology — that is exactly the day the family most needs to be
 * able to refresh their way to a fix. `UpdateGate` touches nothing but the
 * DOM for the same reason.
 */
function setupUpdateGate(uiRoot: HTMLElement): void {
  const gate = new UpdateGate(uiRoot);
  const updateSW = registerSW({
    onNeedRefresh: () => {
      gate.show(() => updateSW(true));
    },
    onRegisterError: (error: unknown) => {
      console.error('Land of Good Places: service worker registration failed.', error);
    },
  });
  // Exposed for the same reason `window.game` is: this is how the "new version
  // ready" gate gets exercised from the console without waiting for a real
  // deploy. Note that pressing its button really does reload the page.
  if (import.meta.env.DEV) {
    (window as unknown as { __triggerUpdateGate: () => void }).__triggerUpdateGate = () =>
      gate.show(() => updateSW(true));
  }
  // `version.txt` only exists in a real build (`vite.config.ts`'s
  // `versionFilePlugin`), so polling for it in dev would just be a 404 every
  // two minutes for nothing — dev already gets instant feedback from HMR.
  if (import.meta.env.PROD) startVersionCheck();
}

// The phone-tilt look, for every first-person ride. Armed at boot and fired on
// the first thing the child touches — see the function's own note for why "at
// startup" is not a thing iOS will accept, and why asking per-ride was worse
// than asking late.
askForOrientationOnFirstGesture();

/**
 * The apology card, for when the park cannot be opened at all.
 *
 * Its own function because there are now **two** ways to get here and they are
 * not both a `throw` past `boot()`. Generation that fails during the cat-bus
 * ride is caught inside `ParkGeneration` — a rejected promise, several frames
 * deep in a `requestAnimationFrame` loop, a long way from any `try` — and
 * before this existed that case simply hung: the bus would idle at the kerb
 * forever, waiting for a park that was never going to arrive. A loading screen
 * that lies is worse than one that waits, and one that waits for ever is worse
 * than either.
 */
function showBootFailure(error: unknown): void {
  console.error(error);
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.classList.remove('hidden');
    splash.innerHTML =
      '<div class="boot-card"><h1>Oh no!</h1>' +
      '<p class="boot-sub">The park could not open.</p>' +
      '<p class="boot-hint">Check the browser console for details.</p></div>';
  }
}

try {
  boot();
} catch (error) {
  showBootFailure(error);
}

// Outside `boot()`'s own try/catch on purpose — see `setupUpdateGate`'s doc
// comment. `#ui-root` is the one element both the game and the gate need;
// if even that is missing the page is broken beyond a panel's help anyway.
const uiRoot = document.getElementById('ui-root');
if (uiRoot) setupUpdateGate(uiRoot);
