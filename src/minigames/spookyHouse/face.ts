import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { Spring } from './spring';

/**
 * The big comic-scary face — the whole point of the Spooky House.
 *
 * Read literally: "a big painted face on canvas texture" is what a *character*
 * in this park would be (ART_DIRECTION.md §3), but a character's face patch is
 * built to blink and smile, not to have an eyeball spring off it on a stalk.
 * This is a different kind of object — closer to a funfair ghost-train prop —
 * so it gets its own bespoke construction: a big toon-shaded head bolted to the
 * wall, with real 3D eyeballs (not painted ones) that can physically leave the
 * socket, and a mouth that is a genuine cavity something can fly out of.
 *
 * Everything that moves is driven by a {@link Spring}, which is what turns
 * "the eye goes out and comes back" into a boing: a spring overshoots its
 * target and settles, a tween does not.
 */

const HEAD_COLOUR = 0x9b7fd6; // a friendly, cartoon-y purple — not a wall colour
const HEAD_SHADOW = 0x6a4f8a;
const TRIM_COLOUR = PALETTE.markerMint;
const SOCKET_COLOUR = PALETTE.ink;

/** How far a stalk reaches at full pop, in metres. Comically far, not subtle. */
const POP_LENGTH = 1.35;
/** The stalk is never fully flush — a hint of it always shows, like a toy. */
const REST_LENGTH = 0.16;
/** How long the eye stays popped before the spring is told to come home. */
const POP_HOLD_SECONDS = 0.4;

/**
 * The jump-scare lunge (#293, reworked after Jim's 18 August playtest note on
 * PR #294 — "the character should jump out from out-of-frame, not from very
 * slightly further away... it should be as in coming in from nowhere").
 *
 * `presence` (a {@link Spring}, 0..1) now drives *whether the face is there at
 * all*, not just how far it leans. At 0 the whole face is dropped straight
 * down through the room's floor and shrunk to a speck — genuinely out of the
 * camera's frame, the same way a jump-scare prop is offstage before its cue —
 * and it stays there through `waiting` and most of `retreating`. `boo()`
 * snaps `presence.target` to 1, and the spring (tuned hard and light — see
 * the `presence.update` call below) covers {@link PRESENCE_DROP} of vertical
 * travel in a few hundred milliseconds: it reads as leaping into frame, not
 * growing closer. `retreat()` sends the same spring back to 0 and the face
 * drops out of frame again just as fast.
 *
 * Deliberately **no timer lives here.** An earlier version had `boo()` take a
 * `holdSeconds` and count its own retreat down internally — which is exactly
 * the "two definitions of one thing kept in step by hand" shape CLAUDE.md
 * warns about: `JumpscareDirector` (`jumpscare.ts`) already owns exactly how
 * long a cycle's window stays open, including `extendHold`'s mouth-tap
 * extensions, and a second countdown in here could only ever *start* in sync
 * with it, never *stay* in sync once a tap extended one but not the other
 * (found live on PR #294 — the face retreated on the original schedule while
 * `extendHold` kept the director's own window open). So this face has no
 * opinion on duration at all: `SpookyHouse.ts` calls `boo()` the instant the
 * director's `jumpOut` event fires and `retreat()` the instant its `retreat`
 * event fires, whatever caused that timing — a fresh cycle or a stack of
 * mouth-tap extensions — and the face is out for exactly as long as
 * `windowOpen` says it is, because nothing here can disagree with that.
 *
 * The eye/mouth hotspots (`hotspots.ts`) need no code change for this: they
 * re-project their anchor's *world* position every frame, and those anchors
 * are children of `root`, so when `root` is parked {@link PRESENCE_DROP}
 * below the floor the hotspot elements project far outside the visible
 * viewport on their own — "only interactable once in-frame" falls out of the
 * transform, it isn't a separate rule to keep in sync with this one.
 */
const PRESENCE_DROP = 14;
/** Scale at `presence.value === 0` — not literally zero so nothing divides by it. */
const HIDDEN_SCALE = 0.08;
/** Scale at `presence.value === 1` — bigger than the old 1.14 nudge; this is the whole lunge now, not a hint of one. */
const LUNGE_SCALE_GAIN = 1.05;
/** How far the face pushes toward the camera at full presence, in metres. */
const LUNGE_FORWARD = 0.85;

export interface EyeStalk {
  /** Fixed anchor at the socket — what the on-screen tap target tracks. */
  readonly anchor: Object3D;
  readonly popped: boolean;
  popOut(): void;
  update(dt: number): void;
}

function createEyeStalk(side: -1 | 1): { group: Group; stalk: EyeStalk } {
  const pivot = new Group();
  pivot.name = side < 0 ? 'spookyHouse:eye.left' : 'spookyHouse:eye.right';
  // Rotating the pivot 90° about X turns "local +Y" into "straight out of the
  // face" — everything hung off this pivot is authored along its own Y axis,
  // which reads simply as "how far out" regardless of which eye it is.
  pivot.rotation.x = Math.PI / 2;

  const anchor = new Object3D();
  anchor.position.set(0, 0, 0);
  pivot.add(anchor);

  const stalkMaterial = toonMaterial(HEAD_SHADOW);
  const stalk = solid(new Mesh(new CylinderGeometry(0.075, 0.09, 1, 10), stalkMaterial));
  pivot.add(stalk);

  const eyeball = new Group();
  eyeball.name = `${pivot.name}.ball`;
  pivot.add(eyeball);

  const sclera = solid(new Mesh(new SphereGeometry(0.36, 20, 16), toonMaterial(ART.cream)));
  eyeball.add(sclera);
  addOutline(sclera, 0.02, HEAD_SHADOW);

  const pupilGroup = new Group();
  eyeball.add(pupilGroup);
  const pupil = solid(new Mesh(new SphereGeometry(0.19, 14, 12), toonMaterial(SOCKET_COLOUR)));
  pupil.position.y = 0.3;
  pupilGroup.add(pupil);
  const catchlight = decal(new Mesh(new SphereGeometry(0.055, 8, 6), toonMaterial(ART.shine)));
  catchlight.position.set(0.07, 0.42, 0.06);
  pupilGroup.add(catchlight);

  let extension = new Spring(REST_LENGTH / POP_LENGTH);
  extension.target = extension.value;
  let holdTimer = 0;
  let idlePhase = Math.random() * Math.PI * 2;

  function applyLength(t: number): void {
    const length = t * POP_LENGTH;
    stalk.scale.y = Math.max(0.001, length);
    stalk.position.y = length / 2;
    eyeball.position.y = length;
  }
  applyLength(extension.value);

  const handle: EyeStalk = {
    anchor,
    get popped(): boolean {
      return extension.target > 0.5;
    },
    popOut(): void {
      extension.target = 1;
      holdTimer = POP_HOLD_SECONDS;
    },
    update(dt: number): void {
      if (extension.target > 0.5) {
        holdTimer -= dt;
        if (holdTimer <= 0) extension.target = REST_LENGTH / POP_LENGTH;
      }
      // A springy pop wants a light stiffness and low damping (lots of
      // overshoot on the way out); coming home is the same spring, it just
      // looks calmer because the target is so much closer.
      extension.update(dt, 46, 6.5);
      applyLength(Math.max(0, extension.value));

      // A lazy wander while resting — "looks around" — settled out the moment
      // a pop starts, so the eye doesn't appear to wobble mid-boing.
      idlePhase += dt * 0.6;
      const settled = Math.abs(extension.target - REST_LENGTH / POP_LENGTH) < 0.001;
      const wander = settled ? 0.05 : 0;
      pupilGroup.rotation.x = Math.sin(idlePhase * 0.7 + side) * wander;
      pupilGroup.rotation.z = Math.cos(idlePhase * 0.5) * wander;
    },
  };

  return { group: pivot, stalk: handle };
}

export interface SpookyFace {
  readonly root: Group;
  readonly leftEye: EyeStalk;
  readonly rightEye: EyeStalk;
  /** World-space spawn point for the squirt and the candy shower. */
  readonly mouthAnchor: Object3D;
  /** Opens the mouth wide for a beat — used by both the squirt and the candy. */
  openMouth(): void;
  /**
   * The whole face leaps into frame from nowhere — the jump-scare lunge
   * (#293). Call this the instant `JumpscareDirector`'s `jumpOut` event
   * fires; call {@link retreat} the instant its `retreat` event fires. This
   * face holds no duration of its own — see the file-level comment above for
   * why — so it stays visible for exactly as long as the caller keeps it
   * that way. See {@link PRESENCE_DROP} above for what "in frame" now means.
   */
  boo(): void;
  /**
   * Sends the face back out of frame — the other half of {@link boo}. Call
   * this the instant `JumpscareDirector`'s `retreat` event fires, whether
   * that is on the cycle's original schedule or after mouth-tap extensions
   * (`extendHold`) pushed it out; the director is the only clock that
   * matters here.
   */
  retreat(): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createSpookyFace(): SpookyFace {
  const root = new Group();
  root.name = 'spookyHouse:face';

  const headMaterial = toonMaterial(HEAD_COLOUR);

  const head = solid(new Mesh(new SphereGeometry(2.5, 32, 24), headMaterial));
  head.scale.set(1.18, 1.0, 0.62);
  root.add(head);
  addOutline(head, 0.03, HEAD_SHADOW);

  // Two ears/tufts so the silhouette isn't a perfect circle (ART_DIRECTION §4).
  for (const side of [-1, 1] as const) {
    const tuft = solid(new Mesh(new ConeGeometry(0.32, 0.75, 8), headMaterial));
    tuft.position.set(side * 1.55, 2.15, -0.1);
    tuft.rotation.z = side * -0.32;
    root.add(tuft);
    addOutline(tuft, 0.018, HEAD_SHADOW);
  }

  // --- eye sockets + stalks ----------------------------------------------------
  const EYE_Y = 0.55;
  const EYE_X = 0.95;
  const EYE_Z = 1.42;

  const leftBuilt = createEyeStalk(-1);
  leftBuilt.group.position.set(-EYE_X, EYE_Y, EYE_Z);
  root.add(leftBuilt.group);
  const rightBuilt = createEyeStalk(1);
  rightBuilt.group.position.set(EYE_X, EYE_Y, EYE_Z);
  root.add(rightBuilt.group);

  for (const eyeX of [-EYE_X, EYE_X]) {
    const socket = decal(new Mesh(new TorusGeometry(0.42, 0.09, 8, 20), toonMaterial(SOCKET_COLOUR)));
    socket.position.set(eyeX, EYE_Y, EYE_Z - 0.02);
    root.add(socket);
  }

  // --- eyebrows: chunky, waggling, mint accent ---------------------------------
  const browPivots: Group[] = [];
  for (const side of [-1, 1] as const) {
    const pivot = new Group();
    pivot.position.set(side * EYE_X, EYE_Y + 0.68, EYE_Z + 0.1);
    root.add(pivot);
    browPivots.push(pivot);

    const brow = solid(new Mesh(new CapsuleGeometry(0.11, 0.62, 6, 10), toonMaterial(TRIM_COLOUR)));
    brow.rotation.z = Math.PI / 2;
    brow.position.x = 0;
    pivot.add(brow);
    addOutline(brow, 0.012, HEAD_SHADOW);
  }

  // --- mouth: a real cavity, plus a lower lip and two friendly teeth -----------
  const mouthPivot = new Group();
  mouthPivot.position.set(0, -1.0, 1.5);
  root.add(mouthPivot);

  const cavity = solid(new Mesh(new SphereGeometry(0.85, 20, 14), toonMaterial(SOCKET_COLOUR)));
  cavity.scale.set(1.15, 0.5, 0.36);
  mouthPivot.add(cavity);

  const lowerLip = solid(
    new Mesh(new TorusGeometry(0.82, 0.22, 10, 20, Math.PI), toonMaterial(TRIM_COLOUR)),
  );
  lowerLip.rotation.x = Math.PI;
  lowerLip.position.y = -0.42;
  mouthPivot.add(lowerLip);
  addOutline(lowerLip, 0.016, HEAD_SHADOW);

  for (const side of [-1, 1] as const) {
    const tooth = solid(new Mesh(new SphereGeometry(0.16, 10, 8), toonMaterial(ART.cream)));
    tooth.scale.set(1, 1.2, 0.7);
    tooth.position.set(side * 0.42, 0.28, 0.28);
    mouthPivot.add(tooth);
  }

  const mouthAnchor = new Object3D();
  mouthAnchor.position.set(0, -1.0, 2.5);
  root.add(mouthAnchor);

  // --- state -------------------------------------------------------------------
  const mouthOpen = new Spring(0);
  let mouthHoldTimer = 0;
  // Starts at 0 — off-frame, below the floor — not at the old "resting on the
  // wall" pose. See the {@link PRESENCE_DROP} comment above. No hold timer
  // lives alongside it any more — see the file-level comment for why: the
  // caller (`SpookyHouse.ts`, driven by `JumpscareDirector`) decides when it
  // comes back in and goes back out, by calling `boo()`/`retreat()` directly.
  const presence = new Spring(0);
  const browWaggle = new Spring(0);
  let elapsedTime = 0;
  // Captured from whatever `root.position` is set to once (`SpookyHouse.ts`
  // copies in `FACE_POSITION` right after `createSpookyFace()` returns, before
  // the first `update()`), then treated as the "fully in frame" anchor that
  // every frame's position is computed relative to.
  let basePosition: Vector3 | null = null;

  return {
    root,
    leftEye: leftBuilt.stalk,
    rightEye: rightBuilt.stalk,
    mouthAnchor,

    openMouth(): void {
      mouthOpen.target = 1;
      mouthHoldTimer = 0.32;
    },

    boo(): void {
      presence.target = 1;
      browWaggle.target = 1;
    },

    retreat(): void {
      presence.target = 0;
      browWaggle.target = 0;
    },

    update(dt: number, elapsed: number): void {
      elapsedTime = elapsed;
      // First frame only: remember wherever `SpookyHouse.ts` parked the root —
      // that becomes "fully in frame" for every future `presence` calculation.
      basePosition ??= root.position.clone();

      leftBuilt.stalk.update(dt);
      rightBuilt.stalk.update(dt);

      if (mouthHoldTimer > 0) {
        mouthHoldTimer -= dt;
        if (mouthHoldTimer <= 0) mouthOpen.target = 0;
      }
      mouthOpen.update(dt, 60, 9);
      const openAmount = Math.max(0, mouthOpen.value);
      cavity.scale.y = 0.5 + openAmount * 1.05;
      lowerLip.position.y = -0.42 - openAmount * 0.32;

      // Hard and light on purpose — this has to read as a snap-into-frame
      // lunge inside a well-under-a-second reflex window, not a creep. The
      // spring's own overshoot (see `spring.ts`) gives the "boing" past full
      // size for free on both the way in and the way back out.
      presence.update(dt, 160, 14);
      browWaggle.update(dt, 30, 6);
      const t = Math.max(0, presence.value);
      root.position.set(
        basePosition.x,
        basePosition.y - PRESENCE_DROP * (1 - t),
        basePosition.z + LUNGE_FORWARD * t,
      );
      const looming = HIDDEN_SCALE + t * LUNGE_SCALE_GAIN;
      root.scale.set(looming, looming, 1);

      // A gentle continuous waggle, plus a big lift during "boo".
      const idleWaggle = Math.sin(elapsedTime * 1.7) * 0.09;
      const browLift = browWaggle.value * 0.5;
      browPivots[0]!.rotation.z = idleWaggle + browLift;
      browPivots[1]!.rotation.z = -idleWaggle + browLift;
      browPivots[0]!.position.y = EYE_Y + 0.68 + browWaggle.value * 0.22;
      browPivots[1]!.position.y = EYE_Y + 0.68 + browWaggle.value * 0.22;

      // The head itself sways very slowly, as if glancing around the room.
      root.rotation.y = Math.sin(elapsedTime * 0.35) * 0.05;
    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}
