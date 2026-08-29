// The park train. Reached only through a singleton that is `null` in a world
// without one, so a driver never has to be told whether this park has a
// railway.
import { trainService } from '../../../world/train/service';
import type { CharacterIntent, DriverContext } from '../driver';
import type { Activity, ActivityBudget, ActivityHold, ActivityHost } from './activity';
import { BudgetSlot } from './budget';
import { Backstop, Errand, NO_LIMIT } from './errand';

/**
 * Riding the park train.
 *
 * The shape of a trip: walk out to a station, wait on the platform, take a
 * seat when the train pulls in, ride a stop or two, get off, walk back into
 * the park. Only the riding part is unusual — while a child is aboard, the
 * train writes their x and z (see `ParkTrain.carryPassengers`) and this
 * activity simply asks for nothing, which is exactly what a passenger does.
 *
 * The long one. A trip owns a child for a minute or more, across four states,
 * and every one of those states can go wrong: the station can be unreachable,
 * the train can never come, the seat can stop existing under them. It is also
 * the activity that got the failure handling *right* first, which is why the
 * shared pieces in `errand.ts` are its stuck-sidestep and its timeouts rather
 * than anybody else's.
 *
 * It holds `'intent'` rather than `'steering'`: a child on a train is not
 * also blending a wave, so it writes its own expression and the core's social
 * tail is skipped. (One consequence, pre-dating this refactor and not fixed
 * here: a hop copied from the player just before boarding fires when the child
 * gets off. ARCHITECTURE-REVIEW review 2, C3.)
 */
export class TrainTrip implements Activity {
  readonly name = 'trainTrip';
  readonly hold: ActivityHold = 'intent';

  /** What this child is doing about the train. */
  private mode: 'none' | 'walking' | 'waiting' | 'riding' = 'none';
  /**
   * This child's hold on the whole-park cap of train riders.
   *
   * Added for issue #350. Every other activity in the park has one — the climb
   * (`MAX_CONCURRENT_CLIMBERS`), the chat (`MAX_CONCURRENT_CHATTERS`), the
   * paint stall (`MAX_CONCURRENT_PAINTED`) — and the train was the one that did
   * not, so every child rolled `TRAIN_CHANCE` independently every
   * `TRAIN_INTERVAL_MIN..MAX` seconds and nothing stopped them all saying yes.
   * Measured on the canonical seed: **twenty of the park's twenty-four children
   * were on the train or walking to a station at the same moment**, which is a
   * station platform with most of the park standing on it.
   *
   * That is a large part of what Jim reported — "all the NPCs gather in one
   * place quite soon" — and it is a different mechanism from the random walk
   * this issue's main fix replaces. Both had to go, or the crowd would have
   * kept pooling at the station having been given somewhere else to be.
   *
   * `'allow'` when absent, matching the climb: a caller who hands over no
   * budget gets the old unlimited behaviour rather than a silently disabled
   * railway.
   */
  private readonly slot: BudgetSlot;

  constructor(budget?: ActivityBudget) {
    this.slot = new BudgetSlot(budget, 'allow');
  }

  /** Seat number while aboard. Read by `ParkTrain` — see `TrainPassenger`. */
  private seat: number | null = null;

  /** Which stop is being walked to, waited at, or was boarded at. */
  private stop = 0;

  /** Seconds until this child next considers a trip. */
  private cooldown = 0;

  /**
   * The walk out to the platform.
   *
   * The stations are off the waypoint graph — they are out at the park edge,
   * where there is no paving to author waypoints along — so this is one of the
   * places a child steers rather than walks a validated edge. Hence `unstick`:
   * trees are sparse out there and collision resolution slides them round most
   * things, but a child who has not moved for a few seconds is wedged.
   */
  private readonly walk = new Errand({
    arriveRadius: PLATFORM_ARRIVE,
    timeout: WALK_TIMEOUT,
    abandonRadius: NO_LIMIT,
    unstick: true,
  });

  /** …and the wait, so nobody queues for ever. */
  private readonly wait = new Backstop(WAIT_TIMEOUT);

  private stopsRidden = 0;
  private stopsWanted = 1;
  private lastSeenStop: number | null = null;

  /** True from the moment a trip is decided on until the child is back in the park. */
  get busy(): boolean {
    return this.mode !== 'none';
  }

  /** The seat this child is in, if any. `ParkTrain` reads this every frame. */
  get trainSeat(): number | null {
    return this.seat;
  }

  /**
   * Returns true when the train has this child's attention, in which case the
   * intent has been filled in and the wander behaviour must not run.
   */
  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean {
    const { dt } = context;
    const service = trainService();

    if (!service) {
      // No train in this world (or it has gone away mid-ride).
      this.seat = null;
      // Every exit gives the slot back. Unreachable today — a world without a
      // train never lets a child claim one in the first place — but this is
      // precisely the shape `budget.ts` warns about in its header: "a slot
      // claimed on the way in and released on only one of the three ways out
      // leaks, and a leaked slot is indistinguishable from the feature being
      // switched off". `release()` is idempotent so that every exit can simply
      // call it and stop thinking about it; this one was not.
      this.slot.release();
      this.mode = 'none';
      return false;
    }

    switch (this.mode) {
      case 'none': {
        this.cooldown -= dt;
        if (this.cooldown > 0) return false;
        this.cooldown = host.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
        // Never poach a child already committed to something else. Activities
        // are offered the frame in the order `[climb, chat, train, paint]`, so
        // being *last* is what protects the first three: a busy one takes the
        // frame and the loop stops before reaching the rest. The paint stall is
        // behind the train, and so had nothing protecting it — a child on their
        // way to have their face painted got marched off to a station instead,
        // holding a paint slot for the whole trip and resuming the walk a minute
        // later from wherever the train dropped them. Asked here rather than
        // enforced in the runner because skipping an activity's `update`
        // entirely also stops its idle bookkeeping, and the climb deliberately
        // ticks its cooldown through everything else a child does.
        if (host.othersBusy(this)) return false;
        // Asked before the dice, so a full train does not burn this child's
        // roll: they simply wonder again after the next interval.
        if (this.slot.full) return false;
        if (!host.rng.chance(TRAIN_CHANCE)) return false;

        const stop = service.nearestStop(context.position.x, context.position.z);
        if (!stop) return false;

        this.stop = stop.index;
        // Claimed at the moment of commitment — walking to a station is part of
        // the trip, and a child strolling to a platform is as much "at the
        // railway" as one sitting in a carriage.
        this.slot.claim();
        this.mode = 'walking';
        this.walk.begin(context);
        return false;
      }

      case 'walking': {
        const stop = service.stops[this.stop];
        if (!stop) return this.abandon(host);

        const step = this.walk.step(host, context, intent, stop.x, stop.z);
        if (step === 'givenUp') return this.abandon(host);
        if (step === 'arrived') {
          this.mode = 'waiting';
          this.wait.restart();
          return true;
        }
        intent.expression = host.blinking ? 'blink' : 'neutral';
        return true;
      }

      case 'waiting': {
        if (this.wait.expired(dt)) return this.abandon(host);

        // Look out along the track, the way anybody waits for a train.
        intent.lookAt = Math.atan2(-context.position.x, -context.position.z) + Math.PI;
        intent.expression = host.blinking ? 'blink' : 'happy';

        const seat = service.claimSeat(this.stop);
        if (seat !== null) {
          this.seat = seat;
          this.mode = 'riding';
          this.stopsRidden = 0;
          this.stopsWanted = host.rng.int(1, 2);
          this.lastSeenStop = this.stop;
        }
        return true;
      }

      case 'riding': {
        const seat = this.seat;
        if (seat === null || !service.seatValid(seat)) {
          this.seat = null;
          return this.abandon(host);
        }

        // Ask for nothing: the train is doing the moving.
        intent.expression = host.blinking ? 'blink' : 'happy';
        intent.wave = 0;

        const stopped = service.stoppedAt();
        if (stopped !== null && stopped !== this.lastSeenStop) {
          this.lastSeenStop = stopped;
          this.stopsRidden += 1;

          if (this.stopsRidden >= this.stopsWanted) {
            service.leaveSeat(seat);
            this.seat = null;
            // Straight back into the park: rejoin the waypoint graph at
            // whatever is nearest, which from a platform is the ring road.
            host.rejoinGraph(context, 'full');
            this.slot.release();
            this.mode = 'none';
            this.cooldown = host.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
            return false;
          }
        }
        return true;
      }
    }
  }

  /** Gives up on the train and goes back to wandering. Always returns false. */
  private abandon(host: ActivityHost): boolean {
    this.mode = 'none';
    this.slot.release();
    this.seat = null;
    this.walk.clearSidestep();
    this.cooldown = host.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
    return false;
  }
}

/** Seconds between one child wondering about the train and the next time. */
const TRAIN_INTERVAL_MIN = 22;
const TRAIN_INTERVAL_MAX = 70;

/** …and the chance they actually go, when they do wonder. */
const TRAIN_CHANCE = 0.55;

/** Close enough to the middle of the platform to count as waiting on it. */
const PLATFORM_ARRIVE = 1.6;

/** Longest a child spends walking to a station, or standing on one. */
const WALK_TIMEOUT = 60;
const WAIT_TIMEOUT = 45;
