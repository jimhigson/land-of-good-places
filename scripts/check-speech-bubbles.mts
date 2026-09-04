/**
 * **Every speech bubble that is drawn is drawn over the child it belongs to.**
 *
 * ```
 * pnpm run check:speech-bubbles                  # part of pnpm run check
 * pnpm run check:speech-bubbles:wide             # the same, at 1920x1080 for 420 s
 * pnpm run check:speech-bubbles -- --mutate      # prove it can go red
 * pnpm run check:speech-bubbles -- --mutate-anchor
 * pnpm run check:speech-bubbles -- --mutate-label
 * pnpm run check:speech-bubbles -- --mutate-latch
 * VIEW=1920x1080 SECONDS=420 ... -- --mutate-text-gate   # clause 4c; see below
 * ```
 *
 * **Both chain steps are the same file.** `VIEW` and `SECONDS` are the only
 * difference, and the second one exists because clause 4c below is unreachable
 * at the first one's viewport — a fact discovered only after this file had
 * spent three review rounds asserting the opposite. The wide run costs 34 s,
 * which is a real addition to a `check` chain already at 25 minutes against a
 * 30-minute cap; it is spent because the alternative was a printed 0 that
 * meant nothing.
 *
 * ## Why this exists
 *
 * Issue #415. Jim, 31 August 2026: *"the speech bubbles 'I'm going to x' often
 * appear floating next to no child at all, they should always be above a
 * player."*
 *
 * Reproduced in the running game inside three seconds: an "I'm going to The
 * Castle" bubble drawn at `(9.24, 3.92, 4.40)` whose owner was standing at
 * `(14.02, 0.41, -0.37)` — **6.8 m apart, with the child not on screen at
 * all**, so the bubble sat over an empty stretch of railway.
 *
 * It was neither a parenting fault nor a coordinate-frame one, which is worth
 * saying because three other bugs that week were: the crowd's bubbles are
 * re-anchored to their own child every frame, in the same frame of reference,
 * and always were. The displacement was put there **on purpose**, one line
 * later, by `IsoCamera.clampToFrustum` — the #280 fix that pulls a bubble back
 * inside the visible frustum so a narrow phone cannot clip it. It had no idea
 * whether the speaker was on screen, so asked to rescue a bubble belonging to
 * somebody standing well off the side of the view, it obliged.
 *
 * ## What is measured, off the running park
 *
 * The real `World` from `park-harness.mts`, stepped through `world.update` at
 * 1/60, with the **same `IsoCamera` the crowd was handed** — driven exactly as
 * `Game` drives it, **in `Game.tick`'s own order: player, then camera, then
 * world** (see the comment on that call below, and `Game.ts` 1597/1615). That
 * order is not cosmetic. Every bubble is gated and sized from inside
 * `world.update`, so stepping the world first and letting the camera follow
 * invents a one-frame camera lag the game does not have, and the assertions
 * below then interrogate a camera the frame was never drawn with. It is the
 * only thing this check has ever reported on `main` — 31 August 2026, one
 * breach in 986 sightings, quoted in full at the call site.
 *
 * The viewport defaults to a 390x844 portrait phone, which is the
 * narrowest framing the game supports and therefore the one the clamp works
 * hardest on — and is run **again at 1920x1080** by
 * `check:speech-bubbles:wide`, because two of the four assertions turn out to
 * be reachable only there. The player stands still for the first half of the run (a
 * stationary player is what invites a child over to chat) and walks a slow
 * circle for the second (a moving camera is what strands a bubble whose anchor
 * has been overwritten).
 *
 * Four assertions, on every frame:
 *
 * 1. **A drawn bubble's speaker is on screen.** The anchor — the point over
 *    that child's head — must be inside the frustum. This is Jim's sentence
 *    written down: a bubble with nobody in shot to own it is the bug.
 * 2. **A drawn bubble covers its speaker.** The anchor must lie inside the
 *    bubble's own on-screen rectangle, measured along the camera's screen axes
 *    and allowed {@link BUBBLE_EDGE_MARGIN_PX} of slack because that is exactly
 *    what the clamp is permitted. Not a tolerance picked to make it pass: with
 *    the anchor on screen, the clamp cannot move a bubble further than this, so
 *    any breach is something other than the clamp having moved it.
 * 3. **A bubble anchored once stays put.** A `SpeechBubble` positioned a single
 *    time and never re-anchored — which is exactly how `Hotel` dresses its
 *    receptionist — must still be over its anchor after the camera has moved.
 *    It was not: `updateScreenSize` wrote the clamped point back into
 *    `sprite.position`, which was where the anchor lived, so the first clamped
 *    frame ate it and she never got it back.
 *
 * 4. **A talking child wears no name pill — and is never left wearing
 *    nothing.** Issue #486, Jim: *"when children talk, the speech bubble
 *    overlaps the name over their head - instead, hide their name while they
 *    are talking."* The two are drawn in the same square of air over the same
 *    head, so while the bubble is visible the pill must not be. Three clauses,
 *    because there are two ways to satisfy that sentence and make the game
 *    worse, and each has to be closed separately:
 *
 *      - **4a, the overlap.** Never both drawn.
 *      - **4b, the latch.** Every child who has finished talking gets her name
 *        back. Hiding the pill forever satisfies 4a and is a worse bug than
 *        the one it fixed. Per child, not per crowd — see below.
 *      - **4c, the empty head.** A child mid-word, entitled to her pill, with
 *        **neither** pill nor bubble drawn. Hiding the pill for a bubble
 *        nobody can see is the same trade as 4b's, paid one sentence at a time
 *        instead of for good.
 *
 *    All three are counted and printed on every run, passing or failing.
 *
 *    **4a is asked of what is drawn** — two `sprite.visible` flags — rather
 *    than of `NpcSystem.speechTextOf`. Asking the shared source would be
 *    asking whether one value equals itself; asking the sprites is what still
 *    catches a later refactor handing the pill an opinion of its own.
 *
 *    **What 4a is still worth now that the shipping code reads the bubble's
 *    own flag**, since a fair reading is that it has become a restatement:
 *    it is the **frame order** it now guards. `updateLabels` gets *this*
 *    frame's flag only because `NpcSystem.update` calls `updateBubbles` first.
 *    Put them back the other way round and the pill is decided from last
 *    frame's bubble. **Measured, by swapping those two lines in the shipping
 *    code and running this file unmodified** (390x844, `SECONDS=120`, this
 *    head):
 *
 *    ```
 *    FAIL  name pill drawn under her own bubble, 6 occasion(s).
 *          First: Finn talking at (-2.78, -0.10, 51.88), frame 840
 *    FAIL  5 child(ren) went without their name while silent and in shot.
 *          Worst: Noor, 1 frame, 2.1 m from focus at rank 0
 *    exit 1
 *    ```
 *
 *    Six, not thousands: it is one frame at each end of each sentence — the
 *    pill lags on into the bubble's first frame (4a) and lags down past its
 *    last (4b). A single frame of overlap is invisible to a person and
 *    invisible to a screenshot, which is exactly why a check has to own it.
 *    So 4a is no longer a guard on the *rule* — the shipping code reads the
 *    same flag 4a asks about — it is a guard on the **ordering** that rule
 *    depends on, and it is armed.
 *
 *    **4b is per child, and it did not start out that way.** It
 *    was first written as `spoken.size > 0 && namesReturned.size === 0` — true
 *    only if *nobody at all* ever got her name back. A review patched the
 *    shipping code so the first child to speak never got hers again — a name
 *    hidden forever, precisely the bug the clause exists for — and this check
 *    printed `4 child(ren) seen talking, 3 got their name back` and **exited
 *    0**. A clause that averages over the crowd cannot see one child's loss,
 *    and the comment above it was meanwhile promising a per-child property.
 *    That is this repo's most-cited disease sitting inside the clause written
 *    to prevent an instance of it.
 *
 *    What makes the per-child form possible without a second copy of the
 *    rules: `NpcSystem.speechBubbles` hands over `labelRank`, `labelDistance`
 *    and `speaking` — the facts `updateLabels` worked out this frame — and
 *    `VISIBLE_LABEL_CAP` and `LABEL_MAX_DISTANCE` are imported from the modules
 *    that define them. So the check can tell a pill that is legitimately down
 *    (out of the cap, or too far) from one that is stuck down, by asking the
 *    owner rather than by sorting the crowd itself. Re-deriving the ranking
 *    here would have been a second definition of a rule `NpcSystem` owns, kept
 *    in step by hand, which is the fault this file is guarding.
 *
 *    `speaking` is used **only** to classify a frame — is she mid-word? — and
 *    never to ask whether the pill obeyed it. That question stays sprite
 *    against sprite.
 *
 *    **Clause 4c, and the claim that used to stand here.** Three earlier
 *    versions of this paragraph said the 4c condition *"reads 0 either way
 *    today, so no number printed on any previous run was wrong"*, and offered
 *    the number as a structural curiosity rather than an assertion. **That was
 *    false, and it was false in the way this repo names as its worst: a green
 *    line implying cover it did not give.** The 0 was a property of the
 *    viewport, not of the fix.
 *
 *    The pill was, at that point, hidden because there was *text*, while the
 *    overlap it is avoiding is caused by a bubble being *drawn*, and
 *    `SpeechBubble.updateScreenSize` declines to draw for two reasons:
 *
 *      - `BUBBLE_MAX_DISTANCE` (40 m) is shorter than `LABEL_MAX_DISTANCE`
 *        (46 m), so between them a talking child wears no name for a bubble
 *        too far away to draw; and
 *      - at **any** distance, a speaker whose anchor is off screen has her
 *        bubble gated by `isOnScreen` — the #415 fix — and gave up her pill
 *        for it just the same. This is much the larger set.
 *
 *    Measured across both viewports, same seed, `SECONDS=420`, with the pill
 *    still gated on text (`--mutate-text-gate`):
 *
 *    ```
 *    390x844     1079 frames, every one a child the frustum never contained
 *    1920x1080   1150 frames, of which  96 had the child's body ON screen
 *    ```
 *
 *    The portrait number is harmless: nobody renders those children, so it is
 *    a gap between two internal states. The 96 are not. They are one person,
 *    plainly in shot, wearing no name — first at frame 7274, `Wren` at
 *    `(-0.45, 3.91, 43.27)`, 8.8 m from the camera's focus at **rank 0**, her
 *    head-anchor just past the top edge of a wide frustum. A portrait frustum
 *    is tall enough that this essentially never happens, which is the whole
 *    reason one viewport reported 0 for three rounds.
 *
 *    **So it is fixed rather than documented.** `NpcSystem.updateLabels` now
 *    hides the pill for `bubble.sprite.visible` — a bubble that is *drawn* —
 *    with `updateBubbles` moved ahead of it so the flag is the same frame's.
 *    The pill's condition and the bubble's are then literally one expression,
 *    and 4c is 0 by construction rather than by nobody having stood there.
 *    4c's **on-screen half is asserted**; the frames nobody renders are
 *    reported, because a check that failed on those would be failing on a
 *    difference no player can see.
 *
 * And, because the first two are vacuously true of a park where nobody ever
 * speaks: **the run must actually have seen bubbles**, or it fails saying so.
 * Assertion 4 says so for itself, in as many words, on the stderr summary
 * line — "nobody spoke, so assertion 4 asserts nothing this run".
 *
 * ## Proving it red
 *
 * `--mutate` restores the pre-#415 behaviour in the smallest possible way — it
 * makes `IsoCamera.isOnScreen` answer `true` for everything, which is precisely
 * the code path before the gate was added. `--mutate-anchor` restores the other
 * half, reading the anchor back off `sprite.position` the way it used to.
 *
 * **Assertion 1 is reachable again, and the viewport is why — issue #494 can
 * be closed on this.** It had gone unprovable at 390x844: `--mutate` there
 * fails **assertion 3 only**, with **0** off-screen speakers, on this branch
 * and on `origin/main` alike, because every child who speaks on this park at
 * that framing stays in shot for the whole run. #494 was opened to build a
 * fixture that stranded a speaker off screen deliberately. It turns out no
 * fixture is needed — a **wider** camera sees further past its own edges, and
 * at 1920x1080 with `SECONDS=420`, `--mutate` fails assertion 1 on **363**
 * occasions, worst `Iris at (40.28, -0.32, 47.62)` with her bubble towed
 * **17.70 m** away onto empty ground. That is the pre-#415 bug reproduced
 * exactly as Jim reported it, and `check:speech-bubbles:wide` runs it.
 *
 * The old claim is left standing above rather than deleted, because the pair
 * is the lesson: the same command, the same seed, the same code, 0 breaches at
 * one viewport and 363 at another. A red-run transcript without its inputs is
 * not a measurement.
 *
 * **Assertions 1 and 3 must fail on the first; 3 on the second.** Not 1 and 2:
 * assertion 2 is structurally unreachable under `--mutate`, because an
 * off-screen speaker is recorded against assertion 1 and then `continue`s
 * before the coverage test is ever reached. That is deliberate — the two
 * describe one bubble in one of two ways, and reporting both would double-count
 * it — but it means `--mutate` proves assertion 1, not assertion 2. What holds
 * assertion 2 honest instead is that it passes at **zero** breaches on the
 * shipping code: with the anchor in shot the clamp never moved a bubble outside
 * its own rectangle, which is the bound this fix claims.
 *
 * `--mutate-label` restores the park as it was before #486 in the one line the
 * fix added: the pill sized and shown by distance alone, knowing nothing about
 * whether its owner is mid-sentence. Assertion 4 must fail on it.
 *
 * `--mutate-latch` hides one child's pill for good — the first child seen
 * speaking, and nobody else. That is the shape the crowd-average version of
 * clause 4b could not see, so it is here permanently rather than as a patch
 * somebody applied once during review.
 *
 * `--mutate-text-gate` restores the pill gated on **text existing** — this
 * branch's own first answer to #486 — which fixes 4a and opens 4c.
 *
 * **Re-measured on this branch after the rebase onto `origin/main`
 * `c95facf6` (post-#508, which changed how the seed resolves, so every number
 * measured before it is of a different park). Node 26.7.0. Both viewports,
 * because the whole finding above is that one of them cannot see clause 4c:**
 *
 * ```
 *                      390x844, SECONDS=120        1920x1080, SECONDS=420
 * (unmutated)          1881 sightings, 12 talked,  3551 sightings, 19 talked,
 *                      4c had 0 chances     ex 0   4c had 96 chances, 0 lost ex 0
 * --mutate             assertion 3 alone, 9068     assertions 1 (363, worst
 *                                          ex 1    17.70 m) and 3     ex 1
 * --mutate-anchor      assertion 3 alone, 7349     assertion 3 alone, 23274 ex 1
 * --mutate-label       4a: 1881 pills under their  4a: 3551 pills. Same first
 *                      own bubble. First: Finn at  line.              ex 1
 *                      (-2.78, -0.10, 51.88), f840
 * --mutate-latch       4b: Finn nameless 1867 f,   4b: Finn nameless 1831 f,
 *                      46.0 m, rank 7       ex 1   46.0 m, rank 7     ex 1
 * --mutate-text-gate   nothing to see: 4c had 0    4c: 96 frames. First: Wren
 *                      chances at this viewport    mid-word at (-0.45, 3.91,
 *                                           ex 0   43.27), f7274, on screen,
 *                                                  8.8 m, rank 0      ex 1
 * ```
 *
 * **Every mutation fails exactly one clause and leaves the others at 0**, in
 * both columns, which is what makes each a guard rather than a restatement of
 * its neighbour. Two rows deserve reading twice:
 *
 *   - `--mutate` and `--mutate-text-gate` are each **green in one column**.
 *     Neither is a broken mutation; each names a bug the other viewport cannot
 *     stage. This is why there are two chain steps and why every transcript
 *     here carries `VIEW` and `SECONDS`.
 *   - 4c's 96 appear in both the unmutated wide run and the mutated one, and
 *     mean opposite things: unmutated they are 96 *chances* the assertion had
 *     and nothing lost, mutated they are 96 frames a visible child spent with
 *     no name. The stderr line distinguishes the two, and the coverage note
 *     fires on the chances rather than the losses — a working fix drives the
 *     losses to 0 by construction, so keying "asserts nothing" there would
 *     have announced cover on every green run for ever.
 *
 * Twelve talkers at 120 s against the "10" an earlier draft of this comment
 * quoted, and 1881 sightings against 1984: those were measured pre-#508, on a
 * different park. Nineteen talk in the 420 s run.
 *
 * **Superseded, and kept only as the pair to the row above it.** Proved red on
 * `dd5a1b09` + the frame-order fix, default seed, 390x844, `SECONDS=120` — a
 * park two seed changes ago, so read none of these as current:
 *
 * ```
 * --mutate         1437 sightings; 452 off-screen speakers (worst 37.63 m),
 *                  9068 set-once drifts (worst 9.22 m)          exit 1
 * --mutate-anchor   985 sightings; 7349 set-once drifts (worst 9.22 m)  exit 1
 * (unmutated)       985 sightings; 0 breaches of any kind        exit 0
 * ```
 *
 * That is the same 390x844 `--mutate` that later found 0 off-screen speakers
 * and now finds 363 at 1920x1080: three different answers from one command,
 * every difference in the inputs rather than the code.
 *
 * With the frame order right, assertion 1 asks a narrower question than it
 * looks: the gate it calls is the same `isOnScreen`, against the same anchor
 * and the same camera, that `SpeechBubble.updateScreenSize` just called — so it
 * is a check that the shipping code **applied** the gate, not an independent
 * opinion about the frustum. That is by design (it is why the real method is
 * captured before `--mutate` blinds the prototype), and `--mutate` failing it
 * 363 times at 1920x1080 is what keeps it from being a check that cannot fail.
 * The independent geometry lives in assertions 2 and 3.
 */
import './headless-canvas.mjs';
import { Group, Vector2, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { SpeechBubble, BUBBLE_EDGE_MARGIN_PX } from '../src/ui/SpeechBubble.ts';
import { LABEL_MAX_DISTANCE } from '../src/ui/NameLabel.ts';
import { VISIBLE_LABEL_CAP } from '../src/entities/npc/NpcSystem.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutate = process.argv.includes('--mutate');
const mutateAnchor = process.argv.includes('--mutate-anchor');
const mutateLabel = process.argv.includes('--mutate-label');
const mutateLatch = process.argv.includes('--mutate-latch');
const mutateTextGate = process.argv.includes('--mutate-text-gate');
/** The one child `--mutate-latch` never gives her name back to. */
let latchVictim: string | null = null;
const verbose = process.argv.includes('--verbose');

/**
 * The viewport, `WIDTHxHEIGHT`, defaulting to a **390x844 portrait phone** —
 * the framing #280 was reported on, and the one the clamp has most work to do
 * on.
 *
 * **It is a parameter because one viewport was not enough**, and that was
 * found the expensive way. Clause 4c below counts a child left with neither
 * pill nor bubble; the file used to state it as "0 either way", which was true
 * of 390x844 and **not a property of the fix**. At 1920x1080 the same seed
 * finds it in seconds: a portrait frustum is tall, so a child whose head-anchor
 * clears the top edge while her feet are still in shot is a landscape shape
 * almost exclusively. `check:speech-bubbles:wide` is the chain step that runs
 * this at 1920x1080 for exactly that reason — see the transcripts in the
 * "Proving it red" section, which are given per viewport because a number
 * measured at one of them says nothing about the other.
 */
const VIEW = process.env['VIEW'] ?? '390x844';
const viewMatch = /^(\d+)x(\d+)$/.exec(VIEW);
if (!viewMatch) {
  console.error(`VIEW must look like 390x844; got ${JSON.stringify(VIEW)}`);
  process.exit(2);
}
const VIEW_WIDTH = Number(viewMatch[1]);
const VIEW_HEIGHT = Number(viewMatch[2]);

const DT = 1 / 60;
const RUN_SECONDS = Number(process.env['SECONDS'] ?? 120);
const FRAMES = Math.ceil(RUN_SECONDS / DT);
/** Frames after which the player stops standing about and walks a slow circle. */
const WALK_FROM = Math.floor(FRAMES / 2);
const WALK_RADIUS = 7;
const WALK_PERIOD_S = 20;

/** How many drawn-bubble sightings make the run worth believing. Twenty-two
 *  were seen in 48 s of the real game at this crowd size; the run here is
 *  longer, so this is a floor a working park clears easily and an empty one
 *  cannot. */
const MIN_SIGHTINGS = 20;

/**
 * The frustum test as the shipping camera answers it, captured **before**
 * `--mutate` blinds it.
 *
 * `--mutate` works by making `IsoCamera.isOnScreen` say yes to everything,
 * because that is exactly the code path before #415 added the gate. That
 * method is also this check's own instrument for assertion 1, and a check that
 * mutates its own measuring stick cannot see the thing it broke — the first
 * version of this file did precisely that, and assertion 1 reported zero
 * breaches on a park full of them while assertion 2 caught them all.
 */
const isOnScreen = IsoCamera.prototype.isOnScreen;

if (mutate) {
  // The park exactly as it was before #415: the clamp with no idea whether the
  // speaker is in shot. Patched on the prototype so the code under test stays
  // the shipping code and the mutation is visibly confined to this script.
  (IsoCamera.prototype as unknown as { isOnScreen: () => boolean }).isOnScreen = () => true;
}

if (mutateAnchor) {
  // The other half of the pre-#415 code, restored as the two edits that made
  // it: the anchor is written only into `sprite.position`, and
  // `updateScreenSize` reads it back from there — from a position it has
  // itself already overwritten with last frame's clamped point.
  type Innards = {
    sprite: { position: Vector3 };
    anchorLocal: Vector3;
    updateScreenSize: (camera: IsoCamera) => void;
  };
  const real = SpeechBubble.prototype.updateScreenSize;
  (SpeechBubble.prototype as unknown as { anchorAt: (x: number, y: number, z: number) => void })
    .anchorAt = function (this: Innards, x, y, z) {
      this.sprite.position.set(x, y, z);
    };
  SpeechBubble.prototype.updateScreenSize = function (this: Innards, camera: IsoCamera) {
    this.anchorLocal.copy(this.sprite.position);
    real.call(this as unknown as SpeechBubble, camera);
  } as typeof SpeechBubble.prototype.updateScreenSize;
}

const park = quietly(() => buildHeadlessPark());
const { world, scene, camera } = park;

camera.resize(VIEW_WIDTH, VIEW_HEIGHT);
const playerPosition = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z);
const playerVelocity = new Vector3();
const cameraForward = new Vector3(0, 0, 1);
camera.snapTo(playerPosition);

const input = new InputSystem();

// --- the set-once bubbles, assertion 3 -------------------------------------
//
// Built the way `Hotel.dressLobby` builds the receptionist's: parented to a
// group of their own, anchored a single time, and never touched again. Three of
// them, ringed round the player at the distances a bubble is legible from, so
// at least one is near the frustum's edge — where the clamp bites — throughout
// the walk.
const probeGroup = new Group();
scene.add(probeGroup);
const probes = [3, 8, 14].map((radius, i) => {
  const bubble = new SpeechBubble();
  probeGroup.add(bubble.sprite);
  const angle = (i * 2 * Math.PI) / 3;
  const anchor = new Vector3(
    ENTRANCE_PLAYER_X + Math.cos(angle) * radius,
    1.9,
    ENTRANCE_PLAYER_Z + Math.sin(angle) * radius,
  );
  bubble.setText('I stand perfectly still');
  bubble.anchorAt(anchor.x, anchor.y, anchor.z);
  return { bubble, anchor, radius };
});

// --- measuring --------------------------------------------------------------

interface Breach {
  readonly frame: number;
  readonly who: string;
  readonly what: string;
  readonly detail: string;
}
const breaches: Breach[] = [];
const record = (breach: Breach): void => {
  if (breaches.length < 2000) breaches.push(breach);
};

const offset = new Vector2();
const drawn = new Vector3();

let sightings = 0;
let offScreenSpeakers = 0;
let worstOffScreenGap = 0;
let worstOffScreenLine = '';
let uncoveredSpeakers = 0;
let worstOvershoot = 0;
let worstOvershootLine = '';
let probeBreaches = 0;
let worstProbeDrift = 0;
let worstProbeLine = '';

// --- assertion 4, issue #486 ------------------------------------------------
//
// A bubble and a name pill are drawn in the same square of air over the same
// head, so while one is up the other must be down. Two counters, because the
// bug has two halves and only asserting the first would trade #486 for a worse
// one: a name hidden **forever** by a chat that ended.
let pillsUnderBubbles = 0;
let worstPillLine = '';
/** Everyone seen mid-sentence at least once. */
const spoken = new Set<string>();
/**
 * Per child: how many frames she has been silent, near enough and high enough
 * up the ranking to be wearing her name, and is not — and the worst such run
 * she has had. **Per child, not a total.** The first version of this counted
 * `spoken.size > 0 && returned.size === 0`, which passes as long as *somebody*
 * gets her name back: a review patched the shipping code so that the first
 * child ever to speak never got hers again, and this clause — the one written
 * to catch exactly a forever-hidden name — printed "4 talked, 3 got their name
 * back" and exited 0. One child's name lost forever is the bug; three other
 * children being fine is not a defence.
 */
interface Latch {
  current: number;
  worst: number;
  worstLine: string;
}
const latches = new Map<string, Latch>();
/**
 * **Clause 4c.** Frames where a child was mid-word, entitled to her name pill
 * by the owner's own two facts (inside {@link VISIBLE_LABEL_CAP} and inside
 * {@link LABEL_MAX_DISTANCE}), and yet **nothing at all** was drawn over her —
 * neither pill nor bubble. She has given up her name for a bubble nobody can
 * see, which is strictly worse than the overlap #486 started as.
 *
 * `SpeechBubble.updateScreenSize` declines to draw for two reasons, and both
 * land here:
 *
 *   - past `BUBBLE_MAX_DISTANCE` (40 m) but inside `LABEL_MAX_DISTANCE`
 *     (46 m): the band between the two constants, and
 *   - **at any distance**, a speaker whose anchor is off screen and whose
 *     bubble is therefore gated by `isOnScreen` (the #415 fix). This is much
 *     the larger set.
 *
 * **Two counters, because only one of them is a bug a player can see.** A
 * child the frustum never contained is a gap between two internal states that
 * nobody renders; a child whose *body* is on screen while her head-anchor has
 * slipped past an edge is a visible person with no name over her. Only the
 * second is asserted, and it is asked with the real
 * {@link isOnScreen} — the one captured before `--mutate` blinds it — against
 * her body position, which is the same question a player's eye is asking.
 *
 * **This clause used to be a printed number rather than an assertion, and the
 * number was route- and viewport-specific.** It read 0 at 390x844 and the file
 * said "0 either way", which invited the reading "this does not happen". At
 * 1920x1080 on the same seed the on-screen half is **not** 0 unless the pill
 * is gated on a bubble being drawn — see the transcripts up top. That is a
 * check reporting success about something it was not describing, which is this
 * repo's named disease, so it is now an assertion with a viewport that
 * exercises it.
 */
let spokeWithNothingDrawn = 0;
/** The player-visible half of {@link spokeWithNothingDrawn}: her body is in
 *  shot, so a person is standing there wearing no name at all. Asserted. */
let spokeWithNothingDrawnOnScreen = 0;
let worstNothingDrawnLine = '';
/**
 * **The coverage counter for clause 4c, and it is not the same number.**
 * Frames where a child was mid-word and entitled to her pill and her bubble
 * was **withheld** — the situation 4c is about, whether or not it went wrong.
 * The shipping code's job is to have her pill up on every one of them, so
 * under a working fix {@link spokeWithNothingDrawn} is 0 *by construction* and
 * says nothing about whether the run reached the case at all.
 *
 * Keying the "asserts nothing" note on the failure count would therefore be a
 * green line implying cover it does not give — exactly what CLAUDE.md asks a
 * check to announce rather than imply. This is the number that can honestly
 * say whether 4c had anything to bite on, so this is the one on the summary.
 */
let bubbleWithheldOnScreen = 0;

/**
 * Assertion 2, shared by the crowd and the probes: is `anchor` inside the
 * rectangle the bubble is actually drawing, grown by the slack the clamp is
 * allowed? Returns how far outside it is, in world metres, or 0.
 */
function overshootOf(anchor: Vector3, bubble: SpeechBubble): number {
  bubble.sprite.getWorldPosition(drawn);
  camera.screenOffset(drawn, anchor, offset);
  const slack = camera.worldUnitsPerPixel * BUBBLE_EDGE_MARGIN_PX;
  const overRight = Math.abs(offset.x) - (bubble.sprite.scale.x / 2 + slack);
  const overUp = Math.abs(offset.y) - (bubble.sprite.scale.y / 2 + slack);
  return Math.max(0, overRight, overUp);
}

for (let frame = 0; frame < FRAMES; frame += 1) {
  if (frame >= WALK_FROM) {
    const t = ((frame - WALK_FROM) * DT * 2 * Math.PI) / WALK_PERIOD_S;
    const next = new Vector3(
      ENTRANCE_PLAYER_X + Math.cos(t) * WALK_RADIUS,
      0,
      ENTRANCE_PLAYER_Z + Math.sin(t) * WALK_RADIUS,
    );
    playerVelocity.copy(next).sub(playerPosition).divideScalar(DT);
    playerPosition.copy(next);
  }

  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  // Exactly `Game.tick`'s order, and it is load-bearing: the player has
  // already moved (above), then **the camera follows, and only then is the
  // world stepped** — see `Game.ts`'s class doc and lines 1597/1615. Every
  // bubble in the game is sized and gated from inside `world.update`
  // (`NpcSystem.updateBubbles`, `Hotel`, `WildPets`), so in the running game
  // the camera a bubble is gated against **is** the camera that then renders
  // it, on the very same frame.
  //
  // This file used to step the world first and let the camera follow
  // afterwards, which is the reverse, and it fabricated a one-frame camera lag
  // that the game does not have. On 31 August that lag produced this check's
  // only failure on `main`: Wren's anchor sat 2 mm inside the right edge of the
  // frustum when `updateScreenSize` gated it (screen-right −5.498 against a
  // half-width of 5.500), the camera then panned 35 mm further, and the
  // assertion below re-asked the question of a camera that had moved on —
  // −5.533, off screen by 33 mm. Nothing was ever drawn wrong; the measurement
  // was taken from somewhere the game never stands.
  camera.update(context, playerPosition, playerVelocity);
  quietly(() => world.update(context));

  if (mutateLabel) {
    // The park exactly as it was before #486, restored as the one clause the
    // fix added to `updateLabels`: the pill sized and shown by distance alone,
    // with no idea that its owner is mid-sentence. `NameLabel.updateScreenSize`
    // is the shipping call `updateLabels` makes, so only the *speech* half of
    // the skip is undone — `VISIBLE_LABEL_CAP` still holds, which is why the
    // rank is consulted here. An earlier draft of this mutation dropped the cap
    // as well while its comment claimed otherwise: it went red for two reasons
    // at once and could not have told you which.
    for (const { label, labelRank, labelDistance } of world.npcs.speechBubbles) {
      if (label.sprite.visible) continue;
      if (labelRank < 0 || labelRank >= VISIBLE_LABEL_CAP) continue;
      label.updateScreenSize(camera.worldUnitsPerPixel, labelDistance);
    }
  }

  if (mutateLatch) {
    // One child's name, hidden forever by a sentence that finished — the bug
    // the second half of assertion 4 exists for, and the one the crowd-average
    // version of it passed straight over. The victim is the first child seen
    // speaking, so the mutation is a single name and everybody else is fine:
    // that is exactly the shape a total counter cannot see.
    for (const pair of world.npcs.speechBubbles) {
      if (latchVictim === null && pair.speaking) latchVictim = pair.character.name;
      if (pair.character.name === latchVictim) pair.label.sprite.visible = false;
    }
  }

  if (mutateTextGate) {
    // The pill gated on **text existing** rather than on a bubble being
    // **drawn** — this branch's own first answer to #486, restored as the one
    // line it was: `if (rank >= CAP || this.speechTextOf(i) !== null)`.
    //
    // It fixes the overlap (4a stays at 0) and opens a different hole: a child
    // whose bubble `SpeechBubble.updateScreenSize` declines to draw loses her
    // name with nothing in its place. That is clause 4c, and it is the reason
    // the shipping code reads `bubble.sprite.visible` instead.
    //
    // **This mutation cannot be proved red at 390x844.** Portrait finds only
    // children the frustum never contained; the visible case needs the top
    // edge a landscape viewport puts a head-anchor past. Run it with
    // `VIEW=1920x1080` — that is what `check:speech-bubbles:wide` is for, and
    // why the viewport is a parameter at all.
    for (const pair of world.npcs.speechBubbles) {
      if (pair.speaking) pair.label.sprite.visible = false;
    }
  }

  // --- 4: a talking child wears no name pill (#486) -------------------------
  //
  // Asked of what is *drawn*, not of the driver state both sides read, so the
  // check can still see the two disagreeing if a later refactor gives them
  // separate opinions again.
  for (const pair of world.npcs.speechBubbles) {
    const { character, bubble, label, labelRank, labelDistance, speaking } = pair;

    // 4a — never both drawn. Asked of the two sprites, never of `speaking`:
    // that is the value the shipping code decides from, and putting the
    // question to it would be asking whether it equals itself.
    if (bubble.sprite.visible && label.sprite.visible) {
      pillsUnderBubbles += 1;
      if (worstPillLine === '') {
        worstPillLine =
          `${character.name} is talking at (${fmt(character.position)}) with her bubble ` +
          `and her name pill both drawn, on frame ${frame}`;
      }
      record({
        frame,
        who: character.name,
        what: 'name pill drawn under her own speech bubble',
        detail: 'both visible on the same frame',
      });
    }

    // 4c — and she is never left with *nothing*. Entitlement comes from the
    // owner's own two facts, so a pill that is legitimately down (out of the
    // cap, or too far to draw) is not counted as a loss.
    const entitledToPill =
      labelRank >= 0 && labelRank < VISIBLE_LABEL_CAP && labelDistance <= LABEL_MAX_DISTANCE;
    if (speaking) {
      spoken.add(character.name);
      if (entitledToPill && !bubble.sprite.visible) {
        // The real frustum test, captured before `--mutate` blinds it, asked
        // of where she is *standing* — a head-anchor that has slipped past an
        // edge does not make the child invisible, and that is exactly the case
        // this clause exists for.
        const bodyOnScreen = isOnScreen.call(camera, character.position);
        if (bodyOnScreen) bubbleWithheldOnScreen += 1;
        if (!label.sprite.visible) {
          spokeWithNothingDrawn += 1;
          if (bodyOnScreen) {
            spokeWithNothingDrawnOnScreen += 1;
            if (worstNothingDrawnLine === '') {
              worstNothingDrawnLine =
                `${character.name} is mid-word at (${fmt(character.position)}) on frame ${frame}, ` +
                `on screen and ${labelDistance.toFixed(1)} m from the camera's focus at rank ` +
                `${labelRank} — but her bubble is not drawn and neither is her name`;
            }
            record({
              frame,
              who: character.name,
              what: 'mid-word, on screen, with neither pill nor bubble drawn',
              detail: `${labelDistance.toFixed(1)} m from focus at rank ${labelRank}`,
            });
          }
        }
      }
    }

    // 4b — and, per child, the name comes back. She is owed her pill on any
    // frame where she is silent and the owner's own two facts say it would
    // otherwise be up. Anything else is a name hidden by a sentence that has
    // finished, which is the worse bug this fix could have introduced.
    let latch = latches.get(character.name);
    if (!latch) {
      latch = { current: 0, worst: 0, worstLine: '' };
      latches.set(character.name, latch);
    }
    const owedHerName = spoken.has(character.name) && !speaking && entitledToPill;
    if (owedHerName && !label.sprite.visible) {
      latch.current += 1;
      if (latch.current > latch.worst) {
        latch.worst = latch.current;
        latch.worstLine =
          `${character.name} has finished talking and has gone ${latch.current} frame(s) ` +
          `without her name, ${labelDistance.toFixed(1)} m from the camera's focus at rank ` +
          `${labelRank} — inside the cap and inside ${LABEL_MAX_DISTANCE} m, so it should be up`;
      }
      record({
        frame,
        who: character.name,
        what: 'silent, in shot, and still wearing no name',
        detail: `${latch.current} frame(s) so far`,
      });
    } else {
      latch.current = 0;
    }
  }

  // --- 1 and 2: the crowd ---------------------------------------------------
  for (const { character, bubble } of world.npcs.speechBubbles) {
    if (!bubble.sprite.visible) continue;
    sightings += 1;
    const anchor = bubble.worldAnchor();

    if (!isOnScreen.call(camera, anchor)) {
      offScreenSpeakers += 1;
      bubble.sprite.getWorldPosition(drawn);
      const gap = drawn.distanceTo(character.position);
      if (gap > worstOffScreenGap) {
        worstOffScreenGap = gap;
        worstOffScreenLine =
          `${character.name} at (${fmt(character.position)}) is not on screen, ` +
          `but her bubble is drawn at (${fmt(drawn)}) — ${gap.toFixed(2)} m away`;
      }
      record({
        frame,
        who: character.name,
        what: 'speaker off screen',
        detail: `${gap.toFixed(2)} m from her bubble`,
      });
      continue;
    }

    const overshoot = overshootOf(anchor, bubble);
    if (overshoot > 0) {
      uncoveredSpeakers += 1;
      if (overshoot > worstOvershoot) {
        worstOvershoot = overshoot;
        bubble.sprite.getWorldPosition(drawn);
        worstOvershootLine =
          `${character.name}'s bubble is drawn at (${fmt(drawn)}), ` +
          `${overshoot.toFixed(2)} m clear of the rectangle over her head at (${fmt(anchor)})`;
      }
      record({
        frame,
        who: character.name,
        what: 'bubble does not cover its speaker',
        detail: `${overshoot.toFixed(2)} m outside its own rectangle`,
      });
    }
  }

  // --- 3: the set-once bubbles ---------------------------------------------
  for (const probe of probes) {
    probe.bubble.updateScreenSize(camera);
    if (!probe.bubble.sprite.visible) continue;
    const overshoot = overshootOf(probe.anchor, probe.bubble);
    if (overshoot <= 0) continue;
    probeBreaches += 1;
    if (overshoot > worstProbeDrift) {
      worstProbeDrift = overshoot;
      probe.bubble.sprite.getWorldPosition(drawn);
      worstProbeLine =
        `the ${probe.radius} m set-once bubble was anchored at (${fmt(probe.anchor)}) ` +
        `and is drawn at (${fmt(drawn)}) — ${overshoot.toFixed(2)} m adrift`;
    }
    record({
      frame,
      who: `set-once bubble at ${probe.radius} m`,
      what: 'anchored once, drawn elsewhere',
      detail: `${overshoot.toFixed(2)} m outside its own rectangle`,
    });
  }
}

function fmt(v: Vector3): string {
  return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
}

// --- the verdict ------------------------------------------------------------

const failures: string[] = [];

if (offScreenSpeakers > 0) {
  failures.push(
    `A bubble was drawn for a child who was not on screen, on ${offScreenSpeakers} ` +
      `occasion(s). Worst: ${worstOffScreenLine}`,
  );
}
if (uncoveredSpeakers > 0) {
  failures.push(
    `A bubble was drawn clear of the child it belongs to, on ${uncoveredSpeakers} ` +
      `occasion(s). Worst: ${worstOvershootLine}`,
  );
}
if (probeBreaches > 0) {
  failures.push(
    `A bubble anchored once drifted off its anchor, on ${probeBreaches} ` +
      `occasion(s). Worst: ${worstProbeLine}`,
  );
}
if (pillsUnderBubbles > 0) {
  failures.push(
    `A child's name pill was drawn under her own speech bubble, on ${pillsUnderBubbles} ` +
      `occasion(s) — the overlap of #486. First: ${worstPillLine}`,
  );
}
const latched = [...latches.values()].filter((l) => l.worst > 0);
if (latched.length > 0) {
  const worst = latched.reduce((a, b) => (b.worst > a.worst ? b : a));
  failures.push(
    `${latched.length} child(ren) went without their name while silent and in shot. ` +
      `Hiding the pill while she speaks must not outlive the sentence, and it must be ` +
      `true of every child, not of the crowd on average. Worst: ${worst.worstLine}`,
  );
}
if (spokeWithNothingDrawnOnScreen > 0) {
  failures.push(
    `A child on screen was left mid-word with neither her name pill nor a speech bubble ` +
      `drawn over her, on ${spokeWithNothingDrawnOnScreen} occasion(s). Hiding the pill must ` +
      `be paid for by a bubble that is actually drawn, never by text that merely exists — ` +
      `see NpcSystem.updateLabels. First: ${worstNothingDrawnLine}`,
  );
}
if (sightings < MIN_SIGHTINGS) {
  failures.push(
    `Only ${sightings} bubble(s) were drawn in ${RUN_SECONDS}s, below the ${MIN_SIGHTINGS} ` +
      'this check needs before it is measuring anything. Assertions 1 and 2 are ' +
      'vacuous on a silent park — this is not a pass.',
  );
}

process.stderr.write(
  `check:speech-bubbles — ${FRAMES} frames at ${VIEW_WIDTH}x${VIEW_HEIGHT}, ` +
    `${sightings} crowd-bubble sightings, ${probes.length} set-once probes.\n`,
);
const worstLatch = [...latches.values()].reduce((a, l) => Math.max(a, l.worst), 0);
process.stderr.write(
  spoken.size === 0
    ? '  #486: nobody spoke, so assertion 4 asserts nothing this run.\n'
    : `  #486: ${spoken.size} child(ren) seen talking; longest run without a name while ` +
      `silent and in shot, over all of them: ${worstLatch} frame(s). ` +
      `Clause 4c: ${bubbleWithheldOnScreen} frame(s) where a child on screen was mid-word ` +
      `with her bubble withheld and her pill therefore owed, of which ` +
      `${spokeWithNothingDrawnOnScreen} left her wearing nothing ` +
      `(${spokeWithNothingDrawn} counting the children the frustum never contained, which ` +
      `nobody renders and which are not asserted).\n`,
);
if (spoken.size > 0 && bubbleWithheldOnScreen === 0) {
  // Coverage, audible on a green run: no frame this run ever put a visible
  // child mid-word with her bubble withheld, so 4c ruled nothing out. Keyed on
  // the opportunity, not on the failure — the failure is 0 whenever the fix
  // works, so keying it there would announce cover on every green run forever.
  process.stderr.write(
    `  #486: clause 4c found no such frame at ${VIEW_WIDTH}x${VIEW_HEIGHT} in ` +
      `${RUN_SECONDS}s, so it asserts nothing this run. The viewport and run length that ` +
      'do exercise it are check:speech-bubbles:wide — 1920x1080 — and a portrait frustum ' +
      'is not expected to.\n',
  );
}

if (verbose) {
  for (const breach of breaches.slice(0, 40)) {
    process.stderr.write(`  frame ${breach.frame}: ${breach.who} — ${breach.what}, ${breach.detail}\n`);
  }
}

if (failures.length > 0) {
  console.error(
    '\nA speech bubble must always be above the child it belongs to (#415), and never ' +
      'over her own name (#486).\n',
  );
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Every one of ${sightings} drawn speech bubbles was over its own child and over no ` +
    `child's own name, and ${probes.length} set-once bubbles stayed on their anchors.`,
);
