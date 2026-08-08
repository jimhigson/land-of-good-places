import { CAMERA_PITCH_DEGREES } from '../core/constants';
import { DEG, lerp } from '../core/mathUtils';
import { KID_REST_GAZE_PITCH } from '../art/models/kid';

/**
 * **How a rider is posed — the one definition, for everything that carries one.**
 *
 * Lifted out of `Player.ts` on 7 August 2026, and the reason is the cat bus.
 *
 * `BusJourney` seats twelve children on the ride to the park, and it had grown
 * its own way of doing it: `seat.add(kid.root)` and nothing else, so twelve
 * children rode the whole way **standing bolt upright** with the seat cushions
 * passing through their shins. That is this repo's most expensive bug shape
 * (CLAUDE.md, *"Two definitions of one thing, kept in step by hand"*) — except
 * that here the second definition was not even a copy of the first, it was the
 * absence of one, which is worse, because there was nothing to notice had
 * drifted.
 *
 * The obvious fix — import `applyRidePose` from `Player.ts` — **cannot be
 * done**, and the reason is worth recording so nobody tries it again.
 * `Player.ts` imports `world/terrain`, which imports `PARK_BOUNDARY`. The whole
 * design of the ride is that it draws *before the park has been solved*
 * (`HANDOFF-cat-bus-stage-b.md`), so pulling the park's boundary into its module
 * graph would undo the loading screen it exists to be.
 *
 * Hence a leaf module. It reaches only `core/constants`, `core/mathUtils` and
 * `art/models/kid` — the same shelf `BusJourney` already lives on — and
 * `Player.ts` re-exports every name from here, so nothing that imported these
 * from `Player.ts` (`scripts/check-climb-wave.mts`, most of all) had to change.
 *
 * The seated and reclined postures live together here for the reason the
 * original extraction gives below: a ride names its posture, and this decides
 * what that means.
 */

/**
 * How a rider holds herself: sitting up in a seat, lying back on a slide, or
 * **on her own two feet, walking**, while something else decides where she goes.
 *
 * `'walking'` is not a ride in the ordinary sense — nothing is carrying her. It
 * is for a scripted sequence that moves her through the world under its own
 * choreography (the cat-bus arrival walks her off the bus and into the park)
 * while she keeps the ordinary walk cycle she would have if she were driving
 * herself. It borrows the *riding* machinery only for what riding already means
 * here: input, collision and gravity stop applying, so a script can put her
 * exactly where it wants her without fighting the movement code.
 */
export type RidePosture = 'seated' | 'reclined' | 'walking';

/**
 * How far back a reclining rider lies, in radians about her own left-right axis.
 *
 * Negative is backwards — **measured on the built rig rather than reasoned
 * about**, because this codebase reads both ways (the flower pick and the run
 * lean both treat negative `rotation.x` as *forward*). Building a kid and asking
 * where her head ends up settles it: at -1.35 the head sits 1.33 m behind the
 * feet and 0.30 m above them.
 *
 * Not the grown-up's flat `-PI/2`. That puts the head at floor level, which for
 * a child on a slide means riding the whole way looking at the sky with her face
 * in the trough. This leaves her propped just enough to see where she is going.
 */
const RIDE_RECLINE = -1.35;

/**
 * The waving arm, up a tree — see {@link Player.setClimbWave}.
 *
 * The same numbers the crowd waves with (`NpcCharacter.animate`), so one
 * gesture reads across the whole park. Exported because `check:climb-wave`
 * poses a real kid with them to measure how high the hand actually gets: that
 * is what decides whether the wave clears the leaves, and it is not something
 * this file can know on its own.
 */
export const CLIMB_WAVE_ARM_X = -2.45;
/**
 * The lateral swing, and the whole of what was wrong with the first attempt.
 *
 * The crowd waves with this **negative** (`NpcCharacter.animate`), which tucks
 * the hand *inward*, across the body. On the ground that is fine — you see the
 * whole child. Up a tree an inward hand lands squarely behind her own skull and
 * hair: QA measured the wave 0% visible on every climbable tree, blocked by her
 * own head, with zero foliage in the way.
 *
 * That was measured when only her head and waving arm were drawn up a tree.
 * **The whole child is drawn now** (Jim, 6 August: *"just include the whole
 * body"* — see `world/TreeClimbing.ts`), which gives the hand *more* to hide
 * behind rather than less, so the outward swing matters at least as much as it
 * did. `check:climb-wave` re-measures it on the real rig every build, so this
 * paragraph is history rather than a live claim about what is on screen.
 *
 * Swinging it **out** instead puts the hand clear of her silhouette. Swept
 * (`check:climb-wave --sweep`) rather than guessed: +1.25 is the peak across
 * every lift angle, and the ±{@link WAVE_WAGGLE} wag keeps it inside 0.83–1.67,
 * which stays visible throughout rather than flickering behind her head at one
 * end of the wag.
 *
 * The lift ({@link CLIMB_WAVE_ARM_X}) is unchanged and still the crowd's, so
 * the gesture remains recognisably the park's own wave — only its direction
 * changed.
 */
export const CLIMB_WAVE_ARM_Z = 1.25;
/** How far the hand wags either side of {@link CLIMB_WAVE_ARM_Z}. */
export const WAVE_WAGGLE = 0.42;

/**
 * How far she rocks side to side while waving, in radians.
 *
 * **This is the part of the wave you can actually see**, and it is a rotation
 * for a measured reason. QA's third pass found the 0.3 m hoist contributes
 * *nothing* on screen and in fact nets negative: the follow camera tracks
 * `player.position` (`Game.ts` -> `IsoCamera.update`, `focus.y` damped) and
 * climbs with her, eating most of it, while turning to camera swings her
 * off-axis head under an isometric projection — measured, she ends some waves
 * ~3 px *lower* against the scenery than she started.
 *
 * A camera that follows position can cancel a translation. It cannot cancel a
 * rotation. Rocking `body` swings her head *and* her waving arm together —
 * and her head is ~25x the screen area of her hand, so this moves far more
 * pixels than the arm ever can.
 *
 * Amplitude chosen by measuring screen-space excursion at play scale
 * (`check:climb-wave --motion`), not from world-space geometry, because
 * world-space motion is exactly what turned out not to reach the screen.
 */
export const CLIMB_WAVE_LEAN = 0.16;

/** Rock rate, rad/s. Half the hand's wag, so the body sways under a faster wave. */
export const CLIMB_WAVE_LEAN_RATE = 5.5;

/**
 * How far {@link applyRidePose} pitches the body forward — "holding on".
 *
 * Named rather than written inline because {@link CLIMB_WAVE_HEAD_PITCH} has to
 * subtract it: the head hangs off the body, so where her face ends up pointing
 * is this plus whatever the neck does. Two numbers that must agree, in one
 * expression each.
 */
const RIDE_POSE_BODY_PITCH = 0.3;

/**
 * The neck angle that points her face **at the camera** while she waves.
 *
 * Jim, 5 August: *"the character should look slightly upwards too — straight
 * towards the camera."* She was not. Measured on a really-built kid, mid-wave,
 * her gaze left the face at **2.14° below** the horizon while the camera sat
 * **38° above** her — she was waving at a point some 40° under the viewer's
 * feet, which is exactly the "waving past you rather than at you" he saw.
 *
 * Solved, not tuned. Gaze is exactly linear in the two joints above the eyes
 * (`KID_REST_GAZE_PITCH − body.rotation.x − head.rotation.x`, verified to 4
 * decimal places by `check:climb-wave`), so the angle that lands the gaze on
 * the camera falls straight out of rearranging that for `head.rotation.x`.
 *
 * **Derived from the camera, deliberately.** `CAMERA_PITCH_DEGREES` is the only
 * thing that decides where the viewer is; pitch the park's camera tomorrow and
 * her face follows it. A hard-coded angle here would be right for exactly one
 * value of that constant and silently wrong for every other.
 *
 * The camera being **orthographic** is what makes one constant enough: every
 * ray is parallel, so "the direction to the camera" is the same everywhere in
 * the park and does not depend on which tree she climbed or how far away she is.
 *
 * It works out at **−40.1°**, and the reason that used to be free has since
 * been retired. It was: `hidePlayerBody` left only her head and waving arm
 * drawn, so the shoulders a neck angle would be read against were inside the
 * leaves and nothing on screen could see it as a joint. **The whole child is
 * drawn up a tree now** (Jim, 6 August), so those shoulders are on screen and
 * the 40° *is* now a visible neck.
 *
 * Left at 40.1° deliberately, not by oversight: it is the angle that actually
 * points her face at the camera, which is the thing Jim asked for and which
 * `check:climb-wave` measures at 0.00° off. He asked for the body with *"no
 * other change needed"*, and he has seen it in the game. If it ever reads as
 * craning, the honest lever is to give some of the pitch back to the torso —
 * `RIDE_POSE_BODY_PITCH` leans her forward 0.3 rad, and every radian taken out
 * of that is a radian the neck no longer has to find — **not** to detune the
 * aim, which would put her back to waving past the player.
 */
export const CLIMB_WAVE_HEAD_PITCH =
  KID_REST_GAZE_PITCH - RIDE_POSE_BODY_PITCH - CAMERA_PITCH_DEGREES * DEG;

/** The limbs {@link applyRidePose} moves. `CharacterModel` satisfies this. */
export interface RidePoseTarget {
  /** Turned as a whole to lie her down; see {@link applyRidePose}'s recline. */
  readonly root: { rotation: { x: number } };
  readonly body: { rotation: { x: number; z: number } };
  readonly head: { rotation: { x: number } };
  readonly leftArm: { rotation: { x: number; z: number } };
  readonly rightArm: { rotation: { x: number; z: number } };
  readonly leftLeg: { rotation: { x: number } };
  readonly rightLeg: { rotation: { x: number } };
}

/**
 * The pose worn on any ride — "holding on, delighted" — with the tree-climb
 * wave blended over it, or **lying on her back** if that is what the ride asked
 * for.
 *
 * Extracted from `Player.update`'s riding branch so that
 * `scripts/check-climb-wave.mts` can pose a kid **exactly** as the game does.
 * It used to be inline, and a check that re-implements a pose is a check that
 * can pass a pose the game never renders — which is the precise way the first
 * version of this wave shipped invisible.
 *
 * **Both postures live here, in one function, for that same reason.** The
 * reclined pose arrived on the ginormous slide branch as a second private
 * method on `Player`, which would have left `check:climb-wave` posing a kid
 * through this function and `check:slide-rider` posing one through a different
 * one — two definitions of "how a rider is posed", and the seated one already
 * has a note above it about exactly that failure. A ride names its posture and
 * this decides what that means.
 *
 * **Called from the end of {@link Player.animate}, not after it.** Extracting it
 * left the *call* in `update`, one line after `animate` returned, and that made
 * it the last writer of `body.rotation.x` for every ride in the park — so the
 * Rail Race's pose, which is applied at the end of `animate` and which owns that
 * property, was computed correctly and then overwritten before it was ever
 * drawn. The pose that runs last wins; this one must not be it. See the call
 * site for the full account.
 */
export function applyRidePose(
  model: RidePoseTarget,
  climbWave: number,
  elapsed: number,
  posture: RidePosture = 'seated',
): void {
  // A scripted walk wears **no** ride pose. `Player.animate` has just written a
  // complete walk cycle from the gait, and the whole point of the posture is to
  // keep it: overlaying "holding on, delighted" here would throw her arms back
  // over her head while she strolls off a bus. Returning early rather than
  // falling through to the seated branch is what stops that — a posture this
  // function does not recognise would otherwise be silently posed as seated,
  // which is exactly the class of bug the note above is about.
  if (posture === 'walking') return;
  // `body.rotation.z` is zeroed on **both** paths, so read the note below once:
  // it flushes the roll `Player.animate` writes from the gait.
  if (posture === 'reclined') {
    applyReclinedRidePose(model);
    return;
  }
  // Upright again, in case the last ride laid her down. The recline turns
  // `root`, which nothing else in the seated pose touches, so without this she
  // would board the ferris wheel still flat on her back.
  model.root.rotation.x = 0;
  model.leftArm.rotation.x = -2.5;
  model.rightArm.rotation.x = -2.5;
  model.leftArm.rotation.z = 0.5;
  model.rightArm.rotation.z = -0.5;
  model.body.rotation.x = RIDE_POSE_BODY_PITCH;
  // Zeroed for *every* ride, not only a climb, and deliberately: this function
  // writes a complete pose rather than a patch, so nothing the walk cycle left
  // behind can leak into it. The walk cycle above this in `Player.animate` sets
  // `body.rotation.z` from the gait; a rider who boarded mid-stride would
  // otherwise keep a frozen sliver of that roll for as long as the ride lasted.
  // The climb's own rock is written back over this a few lines down.
  model.body.rotation.z = 0;
  model.leftLeg.rotation.x = -0.7;
  model.rightLeg.rotation.x = -0.55;
  // Same arm and the same waggle as the crowd's wave (`NpcCharacter.animate`),
  // so one gesture reads across the whole park.
  if (climbWave > 0) {
    const waggle = Math.sin(elapsed * 11) * WAVE_WAGGLE;
    model.rightArm.rotation.x = lerp(-2.5, CLIMB_WAVE_ARM_X, climbWave);
    model.rightArm.rotation.z = lerp(-0.5, CLIMB_WAVE_ARM_Z + waggle, climbWave);
    // The rock. See CLIMB_WAVE_LEAN — this, not the hoist, is the motion that
    // reaches the screen, because the follow camera cannot cancel a rotation.
    model.body.rotation.z = Math.sin(elapsed * CLIMB_WAVE_LEAN_RATE) * CLIMB_WAVE_LEAN * climbWave;
    // Chin up, at the camera. See CLIMB_WAVE_HEAD_PITCH — she was waving at the
    // ground in front of the viewer before this.
    //
    // Added to whatever `Player.animate` just wrote rather than assigned over
    // it, so her idle breathing still moves her head while she waves. That is
    // safe against accumulating frame on frame precisely because `animate`
    // *assigns* `head.rotation.x` afresh every single frame before this runs.
    model.head.rotation.x += CLIMB_WAVE_HEAD_PITCH * climbWave;
  }
}

/**
 * **On her back, feet first — the way a child actually goes down a slide.**
 *
 * Jim, having ridden the chase camera: *"the caracter just kind of stands up —
 * I think they should lie on their back instead"*. She had been bolt upright
 * the whole way down since the ride existed; first person hid it, and the chase
 * camera is what finally showed it.
 *
 * A **pose, not a deformation**. The kid is fourteen flat rigid parts and there
 * is no skinning anywhere in this pipeline — no `SkinnedMesh`, no `Bone`, and
 * all three Blender exporters pass `export_skins=False` — so lying her down is a
 * matter of turning groups that already exist, and needs no Blender work at all.
 *
 * The recline goes on `root` rather than on `body`, because there is **no knee
 * in the rig** and the hips hang off `body`: bending at the waist would fold her
 * in half and leave her legs standing up. Turning the whole model about its own
 * origin — which is at her feet — swings her back and down while her feet stay
 * put on the chute, which is exactly what lying on a slide looks like. It is the
 * same thing `GROWN_UP_RECLINE` does to the grown-up riding in front of her.
 *
 * The sign was **measured on the real rig**, not reasoned about, because the
 * codebase reads both ways: the flower pick and the run lean both take
 * *negative* `rotation.x` as forward, while the grown-up's recline is negative
 * too. Building a kid and asking where her head ended up settles it — at `-1.35`
 * her head sits 1.33 m behind her feet and 0.30 m off the floor.
 *
 * **No climb wave here.** You cannot wave from up a tree while lying in a chute;
 * the two states cannot co-occur, so blending one over the other would be
 * writing a case that no game state can reach and no check can exercise.
 */
function applyReclinedRidePose(model: RidePoseTarget): void {
  model.root.rotation.x = RIDE_RECLINE;
  // Arms up. She is on her back going down a slide; this is the whole point of
  // the shot. Less thrown back than the seated pose, which at -2.5 would put
  // them straight out behind her head once the torso is down.
  model.leftArm.rotation.x = -1.95;
  model.rightArm.rotation.x = -1.9;
  model.leftArm.rotation.z = 0.55;
  model.rightArm.rotation.z = -0.48;
  // A little curl, so she is not a plank: chest lifted off the trough.
  model.body.rotation.x = -0.12;
  // Zeroed for the same reason the seated pose zeroes it — `Player.animate`
  // runs immediately before this and writes the gait's roll into it, so a rider
  // who boarded mid-stride would otherwise keep a frozen sliver of that lean for
  // the whole descent. This line came from merging #215, whose extraction of the
  // seated pose is what made the omission visible.
  model.body.rotation.z = 0;
  // Nearly straight, and not quite matching — ART_DIRECTION.md's "nothing is
  // plumb". A seated -0.7 here would stick her knees in the air.
  model.leftLeg.rotation.x = -0.16;
  model.rightLeg.rotation.x = -0.1;
  // Chin towards her chest, which from flat on her back means looking **down the
  // slide at her own feet** — the direction she is travelling. Without it she
  // rides the whole way staring at the sky.
  model.head.rotation.x = -0.45;
}
