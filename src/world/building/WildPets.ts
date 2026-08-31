import { Group, Vector3 } from 'three';
import { Rng } from '../../core/mathUtils';
import { PLAYER_MAX_SPEED } from '../../core/constants';
import { createPet, PET_KINDS, type PetKind } from '../../art/models/pets';
import { createRipika, WILD_RIPIKA_PALETTE } from '../../art/models/ripika';
import type { CreatureHandle } from '../../art/style/asset';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { PALETTE } from '../../core/palette';
import type { IsoCamera } from '../../core/IsoCamera';
import type { FrameContext } from '../../core/types';
import { pressZone, type InteractZone } from '../interact';
import { shopItem } from './shops/catalogue';
import { gameStore } from '../../state';
import { roofBurrows, roofMeadow, MEADOW_GRASS_HEIGHT, type Burrow } from './roofMeadow';

/**
 * **Wild pets in the roof garden's long grass** (issue #406).
 *
 * Jim, 30 August 2026: *"there should be wild animals of the same kinds as you
 * can have for pets roaming in the long grass. It should be possible to catch
 * them, which makes them your pet."*
 *
 * The roof has been reported sparse three times, and answered twice with more
 * scenery — after which QA's verdict was *"more objects is closer than a
 * garden"*, and #403's engineer, having halved the floor plate, still called it
 * *"a flat lilac plain with benches"*. Scenery is not the answer. **Something
 * alive that runs away from you** is a reason to cross the roof, and catching
 * one is a reason to come back.
 *
 * ## One definition, all the way through
 *
 * A wild bunny is `createPet('bunny')` — the identical factory the shop pen,
 * the parade and the hotel bed use. Catching one grants that species' own
 * catalogue entry, so **the pet she catches is the pet she owns**, not a
 * lookalike built from a second description. That rule is why `petBlob.ts`
 * exists to be deleted, and it is the most-cited bug class in this repo.
 *
 * The one creature with a wild *variant* is RiPika, and even she is not an
 * exception: she is the same `createRipika()` with a different
 * {@link WILD_RIPIKA_PALETTE} passed to it — one option on one function, not a
 * second body. Without that a caught wild RiPika would be a second identical
 * yellow mouse trailing the one every player already starts with, which reads
 * as a bug however legal it is.
 *
 * ## Burrows, and why the population never empties or fills
 *
 * A creature pops out of a burrow, roams for a while, then crosses to a
 * **different** burrow and is gone. New ones emerge behind it. The roof is
 * never empty on a second visit and never silts up with animals nobody caught
 * — the same self-cleaning shape `world/Flowers.ts` uses for the meadow, which
 * is the system this one is modelled on throughout.
 *
 * ## The chase, and why she cannot lose
 *
 * Jim: *"no failure except you have to catch it and they scamper away quite
 * quickly with speeds not being constant and also run away from the player at
 * something like 80% chance when choosing their next destination."*
 *
 * So the difficulty is the chase and there is no fail state. Three things make
 * that literally true rather than nominally:
 *
 * 1. **Its average speed is under half hers.** {@link BURST_SPEED} is 6.5 m/s
 *    against her {@link PLAYER_MAX_SPEED} of 7.4 — genuinely quick, and quicker
 *    than she is for a second at a time — but it bursts, cruises and *stops*,
 *    averaging around 3.4. She closes on it every time she gives chase, without
 *    ever having to sprint.
 * 2. **The 80% is spent at destination-choice time, not per frame.** It is a
 *    property of where it decides to go, not a force shoving it away from her,
 *    so it sometimes doubles back across her path — which is where a
 *    six-year-old gets her opening. A per-frame flee force would be an
 *    unwinnable wall.
 * 3. **It never begins a dive while she is within {@link SAFE_DIVE_RANGE}.**
 *    While she is chasing, it cannot leave. Closing distance is *always*
 *    progress, so the one way the chase could genuinely be lost — the thing
 *    vanishing down a hole just as she arrives — cannot happen.
 *
 * She catches it by tapping it and then tapping **"Catch it!"**, which is the
 * ordinary two-taps-if-distant flow every other interactable uses
 * (`world/Selection.ts`). No new input path, and no tank controls anywhere near
 * it — GAME_DESIGN's CONTROL rule. Each tap is one lunge: she walks to where it
 * was, it has moved, she taps again. That loop *is* the chase, and it falls out
 * of `Selection.commitZone` for free rather than being built here.
 */

/** How many wild ones are out at once. */
const POPULATION = 4;

/**
 * Top speed of a bolt, in m/s, against the player's {@link PLAYER_MAX_SPEED}
 * of 7.4.
 *
 * Deliberately *just* under her walk. Faster than her and the chase is
 * unwinnable without sprinting; much slower and it is not a chase. At 6.5 it
 * outruns her for the length of a burst and then has to stop, which is what
 * "scamper away quite quickly" feels like from behind.
 */
const BURST_SPEED = 6.5;

/** Speed between bursts. A trot, not a stroll. */
const CRUISE_SPEED = 3;

/** Seconds a burst lasts, and how long it rests afterwards. The rest is what
 *  makes the average (~3.4 m/s) less than half her walk, and it is also the
 *  moment a child actually catches up. */
const BURST_SECONDS = [0.5, 1.1] as const;
const PAUSE_SECONDS = [0.45, 1.3] as const;

/** Chance that a newly chosen destination is one that takes it *away* from
 *  her. Jim's number, and spent here — once, when it decides — rather than
 *  every frame. */
const FLEE_CHANCE = 0.8;

/** How close she must get for "Catch it!" to be pressable. Generous on
 *  purpose: she taps imprecisely and changes her mind, and the difficulty is
 *  meant to be the chase rather than the final centimetre. */
const CATCH_RADIUS = 2.2;

/** It will not go down a hole while she is this close. See the class doc — this
 *  is what makes "she cannot fail" true rather than nearly true. */
const SAFE_DIVE_RANGE = 9;

/** Seconds it must be above ground before it may even think about leaving, so
 *  a creature can never surface and vanish before she has crossed the roof. */
const TIME_ABOVE_GROUND = [35, 60] as const;

/** Seconds between one leaving (or being caught) and the next surfacing. */
const RESPAWN_DELAY = [3, 6] as const;

/** Seconds to climb out of / drop into a burrow. */
const EMERGE_SECONDS = 0.55;
const DIVE_SECONDS = 0.45;

/** How long the "a wild X appears!" line stays up. */
const ANNOUNCE_SECONDS = 4;

/** How far it may be from its destination and count as arrived. */
const ARRIVE_RADIUS = 0.8;

/**
 * The kinds that roam, and which catalogue entry catching one grants.
 *
 * All of them — Jim ruled that Trilla and RiPika are in. The map is the only
 * place a wild creature is tied to an ownable thing, so there is exactly one
 * answer to "what do I get for catching this?".
 */
const CATALOGUE_FOR_KIND: Readonly<Record<PetKind, string>> = {
  bunny: 'pet.bunny',
  kitten: 'pet.kitten',
  mouse: 'pet.mouse',
  puff: 'pet.puff',
  // The wild one is a *different colourway of the same factory*, so it gets its
  // own catalogue entry — otherwise catching her would hand back the ordinary
  // yellow RiPika and the wild colour would be a lie the moment she joined the
  // parade.
  ripika: 'pet.ripikaWild',
};

type Phase = 'emerging' | 'roaming' | 'leaving' | 'diving';

interface WildOne {
  readonly uid: string;
  readonly kind: PetKind;
  readonly handle: CreatureHandle;
  readonly displayName: string;
  phase: Phase;
  /** Seconds spent in the current phase. */
  phaseAge: number;
  /** Seconds above ground, for {@link TIME_ABOVE_GROUND}. */
  age: number;
  /** How long it is willing to stay out this time. */
  readonly patience: number;
  x: number;
  z: number;
  yaw: number;
  destX: number;
  destZ: number;
  /** The hole it is heading for, once it has decided to leave. */
  target: Burrow | null;
  /** Current speed, and how long the current burst/pause has left. */
  speed: number;
  spurt: number;
  walkPhase: number;
}

export class WildPets {
  readonly root = new Group();

  private readonly camera: IsoCamera;
  private readonly rng: Rng;
  private readonly burrows: readonly Burrow[];
  private readonly cells: readonly { x: number; z: number }[];
  private readonly live: WildOne[] = [];
  private readonly bubble = new SpeechBubble(PALETTE.markerLemon);

  /** Seconds until the next one surfaces. */
  private nextEmergence = 1.5;
  /** Which creature the announcement is currently over, and for how long. */
  private announcing: WildOne | null = null;
  private announceLeft = 0;
  private minted = 0;
  private readonly playerXZ = new Vector3();

  constructor(deck: number, camera: IsoCamera) {
    this.camera = camera;
    this.root.name = `wild-pets-${deck}`;
    this.rng = new Rng(0x1d0e + deck * 31);
    this.burrows = roofBurrows(deck);
    this.cells = roofMeadow(deck).cells;
    this.root.add(this.bubble.sprite);
  }

  /** True when there is anywhere for them to live at all. A roof with no
   *  meadow (a floor plate too small, every patch blocked) simply has no wild
   *  animals rather than throwing. */
  get inhabited(): boolean {
    return this.burrows.length > 0 && this.cells.length > 0;
  }

  update(context: FrameContext): void {
    if (!this.inhabited) return;
    const { dt } = context;
    this.playerXZ.set(context.playerPosition.x, 0, context.playerPosition.z);

    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const one = this.live[i];
      if (!one) continue;
      this.advance(one, dt, context.elapsed);
      if (one.phase === 'diving' && one.phaseAge >= DIVE_SECONDS) {
        this.remove(i);
      }
    }

    if (this.live.length < POPULATION) {
      this.nextEmergence -= dt;
      if (this.nextEmergence <= 0) this.emerge();
    }

    this.updateAnnouncement(dt);
    this.sizeAnnouncement();
  }

  /**
   * One tap target per creature that is actually out.
   *
   * Built fresh on request, exactly as `Flowers.interactZones` is, and for a
   * stronger reason: these **move**. A cached zone would send her walking to
   * where a bunny was ten seconds ago, and `Selection.advancePending` re-reads
   * the zone by id on arrival precisely so that a thing that has moved is a
   * thing she has to tap again.
   *
   * One emerging or diving is deliberately left out — half in the ground is not
   * something to offer a chip over.
   */
  interactZones(): InteractZone[] {
    const zones: InteractZone[] = [];
    for (const one of this.live) {
      if (one.phase === 'emerging' || one.phase === 'diving') continue;
      zones.push(
        pressZone(
          {
            id: `wildPet:${one.uid}`,
            label: one.displayName,
            x: one.x,
            y: 0,
            z: one.z,
            // Comfortably bigger than the creature, because it is moving and a
            // finger is not precise. Tapping *near* a bunny should select the
            // bunny.
            pickRadius: 1.5,
            standX: one.x,
            standZ: one.z,
            // The chip may only show where the press would actually work — the
            // same rule the flowers follow, and the reason `standRadius` exists.
            standRadius: CATCH_RADIUS,
            highlight: { object: one.handle.root },
          },
          () => this.catchOne(one),
          '🫳',
          'Catch it!',
        ),
      );
    }
    return zones;
  }

  /**
   * Sizes the announcement on screen, in world units that come out the same
   * number of pixels at any camera distance — the TEXT/UI-SCALE rule, and the
   * whole reason {@link SpeechBubble} wants a camera rather than a scale.
   *
   * Called from `update` rather than exposed for `Game` to remember, the same
   * way `Hotel` drives its receptionist's bubble. One frame of camera lag on a
   * line of text nobody is reading mid-turn is not worth a second wiring point
   * that a future system can forget to call.
   */
  private sizeAnnouncement(): void {
    const one = this.announcing;
    if (!one || this.announceLeft <= 0) return;
    this.bubble.sprite.position.set(one.x, PET_TOP + 0.5, one.z);
    this.bubble.updateScreenSize(this.camera);
  }

  dispose(): void {
    for (const one of this.live) {
      one.handle.dispose?.();
      one.handle.root.removeFromParent();
    }
    this.live.length = 0;
    this.bubble.dispose?.();
  }

  // ------------------------------------------------------------- internals

  private advance(one: WildOne, dt: number, elapsed: number): void {
    one.phaseAge += dt;
    one.handle.update?.(dt, elapsed);

    if (one.phase === 'emerging') {
      const t = Math.min(1, one.phaseAge / EMERGE_SECONDS);
      // Rises out of the hole rather than fading in: a creature that pops up is
      // a creature that came from somewhere.
      one.handle.root.position.y = (t - 1) * PET_TOP;
      if (t >= 1) {
        one.handle.root.position.y = 0;
        this.beginRoaming(one);
      }
      return;
    }

    if (one.phase === 'diving') {
      const t = Math.min(1, one.phaseAge / DIVE_SECONDS);
      one.handle.root.position.y = -t * PET_TOP;
      return;
    }

    one.age += dt;
    this.step(one, dt);

    if (one.phase === 'roaming') {
      // Only *then* may it think about going home — and only from far enough
      // away that she is not mid-chase. See SAFE_DIVE_RANGE.
      if (one.age > one.patience && this.playerDistance(one) > SAFE_DIVE_RANGE) {
        const home = this.burrowAwayFrom(one);
        if (home) {
          one.phase = 'leaving';
          one.phaseAge = 0;
          one.target = home;
          one.destX = home.x;
          one.destZ = home.z;
        }
      }
      return;
    }

    // Leaving: heading for a hole, but it may still be turned back.
    const target = one.target;
    if (!target) {
      this.beginRoaming(one);
      return;
    }
    if (this.playerDistance(one) <= SAFE_DIVE_RANGE) {
      // She caught up while it was on its way home. It loses its nerve and
      // bolts back into the grass — which is the abort that makes the promise
      // in the class doc real, not just the dive itself being gated.
      this.beginRoaming(one);
      return;
    }
    if (Math.hypot(one.x - target.x, one.z - target.z) <= ARRIVE_RADIUS) {
      one.phase = 'diving';
      one.phaseAge = 0;
    }
  }

  /** Moves it toward its destination, in bursts, and turns it to face the way
   *  it is going. */
  private step(one: WildOne, dt: number): void {
    one.spurt -= dt;
    if (one.spurt <= 0) {
      // Alternates: a burst, then a rest. The rest is not a stop-and-think —
      // it still trots — but it is what puts the average under half her walk.
      const bursting = one.speed < BURST_SPEED;
      one.speed = bursting ? BURST_SPEED : CRUISE_SPEED;
      const range = bursting ? BURST_SECONDS : PAUSE_SECONDS;
      one.spurt = this.rng.range(range[0], range[1]);
    }

    const dx = one.destX - one.x;
    const dz = one.destZ - one.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ARRIVE_RADIUS) {
      if (one.phase === 'roaming') this.chooseDestination(one);
      return;
    }

    const move = Math.min(distance, one.speed * dt);
    one.x += (dx / distance) * move;
    one.z += (dz / distance) * move;
    one.yaw = Math.atan2(dx, dz);

    one.walkPhase = (one.walkPhase + (one.speed / 2) * dt) % 1;
    one.handle.setWalkPhase(one.walkPhase, Math.min(1, one.speed / BURST_SPEED));
    one.handle.root.position.set(one.x, one.handle.root.position.y, one.z);
    one.handle.root.rotation.y = one.yaw;
  }

  /**
   * Picks somewhere to go — and this is where the 80% is spent.
   *
   * Candidates are real meadow cells, so a creature can never decide to stand
   * on the paving, in a shaft, or through a bench: the meadow is the one
   * definition of where the grass is and this asks it rather than re-deriving
   * it (`roofMeadow.ts`).
   *
   * Sampling a handful and picking the best by the rule, rather than filtering
   * the whole meadow, keeps this O(1) per decision on a list of a few hundred.
   */
  private chooseDestination(one: WildOne): void {
    const away = this.rng.range(0, 1) < FLEE_CHANCE;
    const here = this.playerDistance(one);

    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 6; i += 1) {
      const cell = this.rng.pick(this.cells);
      if (!cell) continue;
      const toPlayer = Math.hypot(cell.x - this.playerXZ.x, cell.z - this.playerXZ.z);
      // Away: prefer the candidate that puts the most distance between them.
      // Otherwise take the first thing sampled, so its wandering is genuinely
      // aimless one time in five and it sometimes crosses her path.
      const score = away ? toPlayer : 0;
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
      if (!away) break;
    }
    if (!best) return;
    // Nowhere better than where it already is — don't freeze, just re-roll next
    // frame by aiming somewhere at random.
    if (away && bestScore < here) best = this.rng.pick(this.cells) ?? best;
    one.destX = best.x;
    one.destZ = best.z;
  }

  private beginRoaming(one: WildOne): void {
    one.phase = 'roaming';
    one.phaseAge = 0;
    one.target = null;
    this.chooseDestination(one);
  }

  private playerDistance(one: WildOne): number {
    return Math.hypot(one.x - this.playerXZ.x, one.z - this.playerXZ.z);
  }

  /**
   * The nearest burrow that is **not** the one it is standing on, so "dives
   * into a different one" is true by construction.
   *
   * The first version of this never returned anything at all:
   *
   * ```ts
   * let bestDistance = -1;
   * …
   * if (distance > bestDistance) continue;   // every distance > -1
   * ```
   *
   * — so it `continue`d on every burrow and handed back `null` forever. The
   * creature could therefore never enter `leaving`, never dive, and never make
   * room for the next one: with a population cap of {@link POPULATION}, the
   * roof filled up with four animals within the first fifteen seconds and then
   * stayed **completely static for the rest of the session**. Half of the
   * feature — "dives into a different one and is removed, new ones emerge" —
   * simply did not run.
   *
   * Nothing on screen said so: four wild pets roaming a meadow is exactly what
   * it is supposed to look like, and it takes a minute of standing still to
   * notice that they are the same four. It was found by deliberately deleting
   * the dive gate and watching the test that guards it **stay green** — the
   * mutation could not fail a test whose subject was already dead code. The
   * measurement that settled it: 200 simulated seconds with the player 200 m
   * away produced 4 creatures and **0 departures**.
   */
  private burrowAwayFrom(one: WildOne): Burrow | null {
    let best: Burrow | null = null;
    let bestDistance = Infinity;
    for (const burrow of this.burrows) {
      const distance = Math.hypot(one.x - burrow.x, one.z - burrow.z);
      // Anything it is practically standing on is "the one it came out of".
      // Burrows are at least `BURROW_MIN_SPACING` (4 m) apart even where the
      // meadow had to crowd them, so this can only ever exclude the hole
      // underfoot and never the one it is being sent to.
      if (distance < 2) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = burrow;
      }
    }
    return best;
  }

  private emerge(): void {
    const burrow = this.rng.pick(this.burrows);
    if (!burrow) return;
    const kind = this.rng.pick(PET_KINDS);
    if (!kind) return;

    const handle = kind === 'ripika' ? createRipika({ palette: WILD_RIPIKA_PALETTE }) : createPet(kind);
    const displayName = kind === 'ripika' ? 'RiPika' : (createPetName(kind) ?? kind);

    this.minted += 1;
    const one: WildOne = {
      uid: `${kind}#${this.minted}`,
      kind,
      handle,
      displayName,
      phase: 'emerging',
      phaseAge: 0,
      age: 0,
      patience: this.rng.range(TIME_ABOVE_GROUND[0], TIME_ABOVE_GROUND[1]),
      x: burrow.x,
      z: burrow.z,
      yaw: this.rng.range(0, Math.PI * 2),
      destX: burrow.x,
      destZ: burrow.z,
      target: null,
      speed: CRUISE_SPEED,
      spurt: 0,
      walkPhase: 0,
    };
    handle.root.position.set(one.x, -PET_TOP, one.z);
    handle.root.rotation.y = one.yaw;
    this.root.add(handle.root);
    this.live.push(one);

    this.announce(one);
    this.nextEmergence = this.rng.range(RESPAWN_DELAY[0], RESPAWN_DELAY[1]);
  }

  /**
   * *"a wild x appears!"* — Jim's wording, casing and exclamation mark.
   *
   * **One line, replacing the last.** Several can surface within a few seconds
   * of each other, and three bubbles a child has to read is three she reads
   * none of. One shared bubble that hops to whichever animal most recently
   * appeared says the same thing and always points at something on screen.
   *
   * The name comes from the creature's own `displayName`, so Trilla is Trilla
   * and there is no second table of names to drift.
   */
  private announce(one: WildOne): void {
    this.announcing = one;
    this.announceLeft = ANNOUNCE_SECONDS;
    this.bubble.setText(`a wild ${one.displayName} appears!`);
  }

  private updateAnnouncement(dt: number): void {
    if (this.announceLeft <= 0) return;
    this.announceLeft -= dt;
    const one = this.announcing;
    // It can be caught or dive while its own announcement is still up.
    if (this.announceLeft <= 0 || !one || !this.live.includes(one)) {
      this.announceLeft = 0;
      this.announcing = null;
      this.bubble.setText(null);
    }
  }

  /**
   * She caught it. It becomes hers, and the roof starts growing another.
   *
   * `grantFree` rather than `buy`: this cost nothing and came out of the grass,
   * which is exactly what `collectFlower` already does for a picked flower.
   * It arrives **unstowed**, so it falls straight in behind her and she can see
   * what she just did — the whole reward is the animal now following her.
   */
  private catchOne(one: WildOne): void {
    const spec = shopItem(CATALOGUE_FOR_KIND[one.kind]);
    if (spec) gameStore.catchWildPet(spec);

    const index = this.live.indexOf(one);
    if (index >= 0) this.remove(index);
    // Another one is a few seconds away, always. A roof that empties because
    // she was good at catching would punish her for it.
    this.nextEmergence = Math.min(
      this.nextEmergence,
      this.rng.range(RESPAWN_DELAY[0], RESPAWN_DELAY[1]),
    );
  }

  private remove(index: number): void {
    const one = this.live[index];
    if (!one) return;
    one.handle.root.removeFromParent();
    one.handle.dispose?.();
    this.live.splice(index, 1);
  }
}

/** Where the top of a pet is, for the announcement anchor and for how far a
 *  creature sinks when it dives. Taller than the grass on purpose — a diving
 *  animal must disappear, and `MEADOW_GRASS_HEIGHT` alone would leave its ears
 *  standing in the hole. */
const PET_TOP = Math.max(1.46, MEADOW_GRASS_HEIGHT + 0.8);

/** The display name a species answers to, from the one place that knows. */
function createPetName(kind: PetKind): string | null {
  const spec = shopItem(CATALOGUE_FOR_KIND[kind]);
  return spec?.displayName ?? null;
}
