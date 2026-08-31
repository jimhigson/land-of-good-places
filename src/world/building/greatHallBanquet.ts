import type { Group } from 'three';
import { Rng } from '../../core/mathUtils';
import { applyRidePose } from '../../entities/ridePose';
import { KidCrowd, type KidAvatar, type KidColours } from '../../entities/npc/kidCrowd';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { CROWD_BACKPACK_KINDS, type BackpackKind } from '../../art/models/backpacks';
import { CROWD_SHOE_KINDS, type ShoeKind } from '../../art/models/shoes';
import { EYE_VARIANT_COUNT } from '../../entities/npc/kidCrowd';
import {
  BAG_COLOURS,
  HAIR_COLOURS,
  OUTFIT_COLOURS,
  SHOE_COLOURS,
} from '../../art/models/kidLooks';
import { KID_SKIN_TONES } from '../../art/models/kid';
import { greatHallSeats, type GreatHallSeat } from './castleFurniture';

/**
 * **Two dozen children eating at the banquet** — issue #413.
 *
 * Jim, 31 August 2026: *"ok let's do the banquet with the huge table, lots of
 * other children eating at the tables, and a large fireplace with a roaring
 * fire"*. The ticket's own bar is that the hall *"should look like a feast in
 * progress when she walks in, not a set waiting for one"*, and that is the
 * whole design brief: the difference between the two is entirely whether
 * anybody is sitting at the table.
 *
 * ## Shaped like `CastleFire`, on purpose
 *
 * `dress(deck, floor)` at construction, `update(elapsed)` once a frame, owned
 * by `Building` as a field. That is the pattern the hearth's fire already uses
 * for the same reason: the decoration has a per-frame life, so somebody has to
 * hold it, and `dressCastle`'s free-function shape cannot.
 *
 * ## Parented to the **floor group**, never to `interiorRoot`
 *
 * This is the trap #412 is open about and #377's split created. The castle's
 * three storeys are no longer stacked — they are 600 m apart on their own
 * plates — so a position that used to be "interior-local" now means one of
 * three completely different places depending on what it hangs off. The
 * grown-up who waits by the ginormous slide is still stranded on the mall's
 * plate, 589 m from the slide and 7.9 m in the air, for exactly this reason;
 * the hearth's fire spent a day 300 m from its own fireplace for it too.
 * Everything here goes into the group handed to {@link dress} and nothing here
 * knows a world coordinate.
 *
 * ## One crowd, and what it costs
 *
 * `KidCrowd` reads one throwaway prototype kid and draws every member as
 * instances of its parts, so twenty-four diners are **55 draw calls, not
 * 24 × 25**, and they inherit any retune of the kid model for free. Measured:
 * 49 ms to build the crowd, which is paid once at construction. The park's own
 * crowd is built exactly this way; this is a second instance of it, not a
 * second implementation.
 *
 * They draw only inside the castle — `Building` hides `interiorRoot` while the
 * player is outdoors, and per-space visibility since #377 means only the storey
 * she is on is drawn at all.
 *
 * ## Every diner is the same height, and that is a ruling rather than laziness
 *
 * The park's crowd varies each child's scale over 0.86–1.04, because at this
 * camera a 6% difference in height reads more strongly than a hat. **A diner
 * cannot have one.** Her model's origin is at her feet and her hip pivot is at
 * `KID_HIP_HEIGHT × scale`; the bench is a fixed 0.360 m, cut to
 * `KID_HIP_HEIGHT` precisely because the rig has no knee and that is the one
 * height at which a vertical leg lands a foot on the floor. Scale her to 0.86
 * and she is 5 cm *below* the plank she is sitting on; raise her root to fix it
 * and her feet leave the floor. There is no third option — the bench's height
 * and the child's height are one number, so a seat that fits one child fits
 * exactly one size of child.
 *
 * The variety comes from the nine hair styles, the colour rolls and each
 * diner's own eating phase instead, which is plenty at twenty-four.
 */

/**
 * The name the diners' group takes on the storey, so `check:castle` can find
 * what was built rather than being told what was intended.
 */
export function banquetGroupName(deck: number): string {
  return `great-hall-diners-${deck}`;
}

/** A child at the table: her rig, her seat, and her own place in the meal. */
export interface Diner {
  readonly avatar: KidAvatar;
  readonly seat: GreatHallSeat;
  /**
   * Her own offset into the eating cycle, so twenty-four children are not one
   * child rendered twenty-four times. The same device `CastleFire` uses to stop
   * five storeys of flame pulsing in lockstep.
   */
  readonly phase: number;
}

/**
 * Seeded, so the hall is the same hall on every reload — a banquet whose
 * children changed hair colour each time you took the lift would read as a
 * different room rather than as the same one.
 */
const BANQUET_SEED = 0x413;

export class GreatHallBanquet {
  private crowd: KidCrowd | null = null;
  private readonly diners: Diner[] = [];

  /**
   * Seats the banquet on `deck`, if `deck` is the great hall.
   *
   * Does nothing at all on any other storey, and nothing on a hall whose
   * furniture did not lay out — {@link greatHallSeats} returns an empty list
   * rather than a guess, so there is no case here where children are seated at
   * benches that were never built.
   */
  dress(deck: number, floor: Group): void {
    const seats = greatHallSeats(deck);
    if (seats.length === 0) return;

    const crowd = new KidCrowd(seats.length);
    crowd.crowd.group.name = banquetGroupName(deck);
    this.crowd = crowd;

    const rng = new Rng(BANQUET_SEED);
    seats.forEach((seat, index) => {
      const colours: KidColours = {
        skin: rng.pick(KID_SKIN_TONES).colour,
        hair: rng.pick(HAIR_COLOURS),
        outfit: rng.pick(OUTFIT_COLOURS),
        shoe: rng.pick(SHOE_COLOURS),
        bag: rng.pick(BAG_COLOURS),
      };
      const hairStyle: HairStyle = CROWD_HAIR_STYLES[
        rng.int(0, CROWD_HAIR_STYLES.length - 1)
      ] ?? 'bunches';
      const backpack: BackpackKind = CROWD_BACKPACK_KINDS[
        rng.int(0, CROWD_BACKPACK_KINDS.length - 1)
      ] ?? 'satchel';
      const shoe: ShoeKind = CROWD_SHOE_KINDS[rng.int(0, CROWD_SHOE_KINDS.length - 1)] ?? 'plain';

      // **Scale 1, deliberately and non-negotiably.** See this file's header:
      // the bench's height and the child's height are one number.
      const avatar = crowd.spawn(colours, hairStyle, 1, rng.int(0, EYE_VARIANT_COUNT - 1), backpack, shoe);
      // A feast is a happy thing, and the expression is a texture swap that
      // only ever happens on a transition — so it is set once, here, and never
      // costs anything again.
      avatar.setExpression('happy');

      // Her feet on the floor of the storey: y = 0 in the floor group's own
      // frame, which is what makes the whole seat fit work. Nothing is added to
      // it and nothing subtracted.
      avatar.rig.root.position.set(seat.x, 0, seat.z);
      avatar.rig.root.rotation.y = seat.yaw;

      this.diners.push({ avatar, seat, phase: rng.range(0, Math.PI * 2) + index * 0.37 });
    });

    floor.add(crowd.crowd.group);
    // Posed and committed once here as well as every frame, so a scene built by
    // a check — which never calls `update` — measures children who are sitting
    // down rather than children frozen in the prototype's T-pose.
    this.update(0);
  }

  /**
   * One frame of dinner.
   *
   * Twenty-four skeletons posed and committed, then one flush. The pose itself
   * is `ridePose.ts`'s `'dining'` posture rather than anything written here —
   * see `applyDiningPose` for why a second private definition of "sitting down"
   * is the one thing this file must not contain.
   */
  update(elapsed: number): void {
    const crowd = this.crowd;
    if (!crowd) return;
    for (const diner of this.diners) {
      applyRidePose(diner.avatar.rig, 0, elapsed + diner.phase, 'dining');
      crowd.crowd.commit(diner.avatar.member);
    }
    crowd.crowd.flush();
  }

  /** Every child at the table, for anything that wants to measure one. */
  get seated(): readonly Diner[] {
    return this.diners;
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
    this.diners.length = 0;
  }
}
