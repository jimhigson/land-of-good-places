import type { CharacterIntent, DriverContext } from '../driver';
import type { Activity, ActivityHold, ActivityHost } from './activity';

/**
 * **This child arrived on the cat bus, and is still busy arriving.**
 *
 * The eleven children who ride in with the player are *park NPCs from birth* —
 * Jim's ruling, 7 August 2026: *"These are the park NPCs, and should continue as
 * such when they are in the park, joining NPCs already there."* They are not
 * converted into NPCs when the cutscene ends, because a conversion step is a
 * second definition of who each child is, and the two definitions drift. They
 * are simply eleven of the park's own children who happen to spend their first
 * fifteen seconds sitting on a bus.
 *
 * That means the arrival needs a way to say *"leave this one alone"* to
 * machinery which is otherwise perfectly entitled to send them up a tree or
 * onto the park train. This activity is that. It holds the child (`hold:
 * 'child'`, so it is offered pre-emptively, ahead of every other activity), it
 * reports `busy` so nothing else even asks, and it zeroes the intent so the
 * wander core cannot steer a passenger.
 *
 * **It does not pose anybody.** Position is `ArrivalSequence`'s job via
 * `NpcCharacter.setScriptedPose`, exactly as `TreeClimb` leaves posing to
 * `world/TreeClimbing.ts`. This is the claim on the child; that is the puppetry.
 *
 * ## Why the rejoin is deferred rather than immediate
 *
 * `disembark()` is called from the arrival, which has no `DriverContext` — that
 * only exists inside `update`. So it raises a flag and the *next* `update`
 * performs `host.rejoinGraph(context, 'full')`.
 *
 * `'full'` and not `'legacy'`, deliberately: `WanderDriver`'s constructor calls
 * `chooseNext()` immediately, so a child who has been held motionless on a bus
 * for fifteen seconds is still carrying the target it picked at construction —
 * a point clear across the park, chosen before the park had a bus in it. Only
 * `'full'` re-anchors `target` as well as `current`/`previous`, cancels the
 * pending pause and resets the leg. Without it, eleven children step off a bus
 * and set off walking towards wherever they were each thinking about fifteen
 * seconds ago, which is the least natural thing they could possibly do.
 */
export class BusArrival implements Activity {
  readonly name = 'busArrival';

  /** Owns the child completely while they are aboard. */
  readonly hold: ActivityHold = 'child';

  private aboard: boolean;
  private rejoinPending = false;

  constructor(startsAboard: boolean) {
    this.aboard = startsAboard;
  }

  /**
   * Busy for as long as this child is on the bus.
   *
   * Read by every other activity through `host.othersBusy(this)`, which is how
   * `TrainTrip` learns not to offer a lift to somebody who is already sitting
   * in a different vehicle.
   */
  get busy(): boolean {
    return this.aboard;
  }

  /** True while the arrival owns this child. */
  get riding(): boolean {
    return this.aboard;
  }

  /**
   * "You are off the bus now." Called by `ArrivalSequence` the moment a child
   * steps down, not when the whole sequence ends — they finish their walk into
   * the park under their own steam, as ordinary children.
   */
  disembark(): void {
    if (!this.aboard) return;
    this.aboard = false;
    this.rejoinPending = true;
  }

  onArrive(): boolean {
    // Nothing to arrive at while aboard, but returning true keeps the wander
    // core from treating the seat as a destination it has reached and choosing
    // a new one.
    return this.aboard;
  }

  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean {
    if (this.rejoinPending) {
      this.rejoinPending = false;
      host.rejoinGraph(context, 'full');
    }
    if (!this.aboard) return false;

    // A passenger asks for nothing. `ArrivalSequence` is writing the pose; any
    // intent left set here would be movement the child had "earned" and would
    // show up as a lurch the frame the script lets go.
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.wave = 0;
    intent.expression = host.blinking ? 'blink' : 'happy';
    return true;
  }
}
