/**
 * **Do the pets actually come down the slide behind her?** (issue #468)
 *
 * ```
 * pnpm run check:pet-slide
 * ```
 *
 * Jim: *"When going down the slide, the pet should slide down behind the
 * player."*
 *
 * ### Why a script, and why it drives every frame
 *
 * Every failure mode of this feature is **mid-ride**, and mid-ride is the one
 * place screenshots cannot reach: the QA browser renders this park at 0.2–0.5
 * fps on swiftshader and a backgrounded tab throttles `requestAnimationFrame`,
 * so a sequence of frames costs minutes and arrives stale. A pet that is fine
 * at the lip and fine in the ball pit and gone for the two seconds in between
 * would pass a pair of stills and fail a six-year-old, who watches for it the
 * whole way down.
 *
 * So this rides the real `Building.update` loop with a real `Player` and a real
 * `Parade` — the same harness `check:slide-rider` uses, and for the same
 * reason: the defect class here is per-frame, not geometric. It **observes**
 * the bodies the game would draw. Nothing below recomputes where a pet ought to
 * be from the chute and compares that with itself; every number is read off a
 * `root.position` after the frame that moved it.
 *
 * ### What it asserts, every frame of a real descent
 *
 * 1. **Every companion is drawn** — `root.visible`, and every ancestor up to
 *    the scene. "Vanishes at the lip and reappears at the bottom is worse than
 *    one that never left" is Jim's own bar, so absence is a failure and not
 *    merely a gap.
 * 2. **Every companion is on the chute**, within the built trough
 *    (`CHUTE_ENVELOPE`), from shortly after boarding to the mouth. The grace at
 *    the start is not slack: the line runs on backwards behind the lip so that
 *    eight animals do not stand inside one another for the first second and a
 *    half (see `slide/petRiders.ts`), and this asserts that each one is aboard
 *    within {@link BOARD_SECONDS} and never off it afterwards.
 * 3. **Behind her, and in order.** Each companion's nearest point on the chute
 *    is further **up** the slide than the child's, and each next one is further
 *    up still — so "behind her" and "no two on the same spot" are both measured
 *    on the built curve rather than trusted to the spacing constants.
 * 4. **In the shot.** The first companion is inside the live ride camera's
 *    frustum on essentially every chase frame. This is the clause that answers
 *    "behind her *and clearly so*" — judged off what is framed, not off a gap
 *    in metres, because an agent this week rendered 116 clouds of which zero
 *    were on screen by reasoning about extents instead of looking.
 * 5. **No jump, ever.** No companion moves more than {@link MAX_STEP} in one
 *    frame after the boarding teleport — which covers the two hand-offs a child
 *    would see as a stutter: onto the chute and off it.
 * 6. **Back to her at the bottom.** Some frames after the ride ends every
 *    companion is off the slide and back within following distance of her.
 *
 * ### The control, and why it is in the file
 *
 * A green instrument proves nothing until it has been shown to go red. Several
 * checks in this repo have been clean, decisive and measuring the wrong thing —
 * `WildPets` compared a world position against floor-local coordinates and
 * every distance in the file was 1341.6 m while nothing was red.
 *
 * So this runs the descent **twice**. The second time the ride is not told
 * about the parade at all (`building.petParade = null`), which is exactly the
 * game as it stood before #468: the pets keep following the trail on the
 * ground. That run **must fail** the same clauses, and the check fails if it
 * passes — a control that cannot go red is not a control. It is asserted
 * positively, printed, and it is the reason to believe the green run.
 */

import './headless-dom.mjs';
import { Vector3 } from 'three';

await import('./headless-canvas.mjs');
const { Scene } = await import('three');
const { World } = await import('../src/world/World.ts');
const { Sky } = await import('../src/world/Sky.ts');
const { Player } = await import('../src/entities/Player.ts');
const { Parade } = await import('../src/entities/parade/Parade.ts');
const { CHUTE_ENVELOPE } = await import('../src/world/building/SlideRide.ts');
const { CHASE_EYE_BACK } = await import('../src/world/slide/petRiders.ts');
const { Raycaster } = await import('three');
const { PARADE_MEMBER_RADIUS } = await import('../src/core/constants.ts');
const { IsoCamera } = await import('../src/core/IsoCamera.ts');
const { gameStore } = await import('../src/state/index.ts');
const { shopItem } = await import('../src/world/building/shops/catalogue.ts');
type InteriorControls = import('../src/world/building/Building.ts').InteriorControls;

// Live controls, as `check:slide-rider` uses: boarding the slide is a change of
// space, and the ride does not start until the iris midpoint fires.
const liveControls: InteriorControls = {
  cancelWalk: () => {},
  iris: (midpoint) => midpoint(),
  flash: () => {},
  snapCamera: () => {},
};

/**
 * The companions she takes down with her.
 *
 * Three, and three different species: one would not prove they do not pile up,
 * and two of a kind would not prove the spacing works for models of different
 * heights. Granted the way the park grants them — `catchWildPet`, the roof
 * garden's own route into the parade — rather than by building `ParadeMember`s
 * here, so what rides the slide is what a child who caught three animals has.
 */
const PET_IDS = ['pet.kitten', 'pet.bunny', 'pet.mouse'] as const;

/** How long after boarding every companion must be on the chute, in seconds. */
const BOARD_SECONDS = 2;

/**
 * The furthest a companion may move in one frame, in metres, after the boarding
 * teleport.
 *
 * The chute is travelled at `GIANT_SLIDE_SPEED` (6.5 m/s), so a frame at 60 fps
 * covers 0.108 m and nothing on this ride has any business going faster. 0.35 m
 * is three times that: comfortably clear of the honest motion, and two orders
 * of magnitude under the sort of hand-off failure it is here to catch — a pet
 * left at the top and snapped down, or dropped to the ground under the chute.
 */
const MAX_STEP = 0.35;

/** How close a companion must be to her a moment after the ride, in metres. */
const REGROUP_RADIUS = 14;
/** How long it is given to get there. */
const REGROUP_SECONDS = 3;

/**
 * How much of the frame's width and height the first companion must be inside
 * of, in normalised device coordinates.
 *
 * 1.0 is the very edge of the picture. 0.95 asks for it to be *in* the shot
 * rather than clipped by its border, which is the difference between a child
 * seeing her cat behind her and seeing a paw at the edge of the screen.
 */
const IN_SHOT_NDC = 0.95;

/** The fraction of chase frames the first companion must be framed on. */
const IN_SHOT_FLOOR = 0.98;

/**
 * The raster the chase shot is measured on. Landscape, and the same shape
 * `check:slide-rider` measures the same camera with, so the two files' pixel
 * numbers are comparable.
 */
const RASTER_W = 120;
const RASTER_H = 68;

/**
 * The most of the chase frame any one companion may fill.
 *
 * **Read off the failure, not chosen in the abstract.** With the seats laid out
 * plainly the third companion rode 0.45 m in front of the lens and filled
 * essentially the whole frame with the child nowhere in it — seen on a paused
 * mid-descent screenshot, then measured here. A pet that is genuinely following
 * her, at 1.5–2.7 m, comes out at a few percent. 25% sits far above the honest
 * case and far below the wall-of-fur one, so it cannot be satisfied by
 * accident and cannot fail correct behaviour.
 */
const PET_FRAME_CEILING = 0.25;

interface Complaint {
  readonly clause: string;
  readonly detail: string;
}

interface RunResult {
  readonly ridingFrames: number;
  readonly complaints: readonly Complaint[];
  readonly framedFraction: number;
  readonly worstOffChute: number;
  readonly worstStep: number;
  readonly closestPair: number;
  readonly worstRegroup: number;
}

/**
 * One whole descent, measured.
 *
 * `wired` is the control switch: with it false the ride is never introduced to
 * the parade, which is the game exactly as it was before #468.
 */
async function ride(wired: boolean): Promise<RunResult> {
  const scene = new Scene();
  const world = new World(scene, new Sky(), liveControls, new IsoCamera());
  const building = world.building;
  const slide = building.ginormousSlide;
  slide.group.updateMatrixWorld(true);

  const camera = new IsoCamera();
  const player = new Player(world.collision, camera, new Vector3(0, 0, 0));
  scene.add(player.group);
  building.attachPlayer(player);

  const parade = new Parade(player, world.collision, camera);
  scene.add(parade.group);
  if (wired) building.petParade = parade;

  let ridingNow = false;
  building.onRideChange = (riding) => {
    ridingNow = riding;
    player.group.visible = !riding || building.playerStaysVisible;
  };

  // The chute as **drawn**, sampled once, so "where is this on the slide" is a
  // question about the built curve rather than about the plan it came from.
  const chute: Vector3[] = [];
  {
    const probe = new Vector3();
    const steps = Math.max(400, Math.round(slide.length / 0.2));
    for (let i = 0; i <= steps; i += 1) {
      slide.pointAt(i / steps, probe);
      chute.push(slide.group.localToWorld(probe.clone()));
    }
  }
  /** Nearest chute sample to a world point: how far off, and how far along. */
  function onChute(point: Vector3): { off: number; along: number } {
    let off = Infinity;
    let along = 0;
    for (let i = 0; i < chute.length; i += 1) {
      const d = point.distanceTo(chute[i]!);
      if (d < off) {
        off = d;
        along = i / (chute.length - 1);
      }
    }
    return { off, along };
  }

  /** Is `node` `part`, or somewhere underneath it? */
  function isDescendantOf(node: unknown, part: unknown): boolean {
    let walk = node as { parent: unknown } | null;
    while (walk) {
      if (walk === part) return true;
      walk = walk.parent as typeof walk;
    }
    return false;
  }

  function drawn(object: { visible: boolean; parent: unknown } | null): boolean {
    let node = object;
    while (node) {
      if (!node.visible) return false;
      node = node.parent as typeof node;
    }
    return true;
  }

  const SHOT_W = 240;
  const SHOT_H = 135;
  building.resizeRideCameras(SHOT_W, SHOT_H);

  if (!building.requestBoardSlide(false)) {
    throw new Error('check:pet-slide — could not board the ginormous slide at all');
  }

  const dt = 1 / 60;
  let elapsed = 0;
  let frames = 0;
  let ridingFrames = 0;
  let afterFrames = 0;
  let rideEnded = false;

  const complaints: Complaint[] = [];
  const say = (clause: string, detail: string): void => {
    if (complaints.some((c) => c.clause === clause)) return;
    complaints.push({ clause, detail });
  };

  /**
   * **What the chase camera actually shows**, by shooting a grid of rays
   * through the live camera and counting what each one lands on — the same
   * instrument `check:slide-rider` and `check:climb-wave` measure legibility
   * with, and for the same reason: *in frustum* and *in shot* are different
   * questions, and only an area measurement can tell them apart.
   */
  function raster(
    camera: unknown,
    childRoot: unknown,
    pets: readonly { readonly displayName: string; readonly root: unknown }[],
  ): { child: number; pets: [string, number][]; total: number } {
    const caster = new Raycaster();
    const targets = [slide.group, building.gardenRoot, childRoot, parade.group];
    let child = 0;
    const counts = pets.map((pet): [string, number] => [pet.displayName, 0]);
    for (let iy = 0; iy < RASTER_H; iy += 1) {
      const ndcY = 1 - (2 * (iy + 0.5)) / RASTER_H;
      for (let ix = 0; ix < RASTER_W; ix += 1) {
        const ndcX = (2 * (ix + 0.5)) / RASTER_W - 1;
        caster.setFromCamera({ x: ndcX, y: ndcY } as never, camera as never);
        const hit = caster.intersectObjects(targets as never[], true)[0];
        if (!hit) continue;
        if (isDescendantOf(hit.object, childRoot)) {
          child += 1;
          continue;
        }
        for (let i = 0; i < pets.length; i += 1) {
          if (isDescendantOf(hit.object, pets[i]!.root)) {
            counts[i]![1] += 1;
            break;
          }
        }
      }
    }
    return { child, pets: counts, total: RASTER_W * RASTER_H };
  }

  const previous = new Map<string, Vector3>();
  let rasters = 0;
  let childHiddenSamples = 0;
  let worstChild = Infinity;
  let biggestPet = 0;
  let biggestPetName = '—';
  let worstOffChute = 0;
  let worstStep = 0;
  let closestPair = Infinity;
  let worstRegroup = 0;
  let chaseFrames = 0;
  let framedFrames = 0;
  let missingFrames = 0;
  let offChuteFrames = 0;
  let aheadFrames = 0;

  const MAX_FRAMES = 25 * 60;
  // Her own width is what can stick out of the trough sideways; a companion's
  // is `PARADE_MEMBER_RADIUS`. From the game, never from the generator's own
  // wider `CORRIDOR_RADIUS` — see `check:slide-rider`.
  const ON_CHUTE =
    Math.hypot(CHUTE_ENVELOPE.halfWidth, CHUTE_ENVELOPE.above) + PARADE_MEMBER_RADIUS;
  const at = new Vector3();

  while (frames < MAX_FRAMES) {
    const context = {
      dt,
      elapsed,
      input: { justPressed: () => false, isDown: () => false } as never,
      playerPosition: player.position,
      cameraForward: new Vector3(0, 0, 1),
      frame: frames,
    } as never;
    building.update(context);
    player.update(context);
    parade.update(context);
    elapsed += dt;
    frames += 1;

    if (!ridingNow) {
      if (ridingFrames === 0) continue;
      rideEnded = true;
      afterFrames += 1;
      if (afterFrames < REGROUP_SECONDS * 60) continue;
      break;
    }
    ridingFrames += 1;

    // The bodies the game would draw, in line order, asked of the system that
    // owns them.
    const bodies = PET_IDS.map((_, slot) => parade.companionAt(slot)).filter(
      (member): member is NonNullable<typeof member> => member !== null,
    );
    if (bodies.length !== PET_IDS.length) {
      say(
        'line',
        `only ${bodies.length} of ${PET_IDS.length} companions were in the line on ridden ` +
          `frame ${ridingFrames} — one of them left it during the descent`,
      );
    }

    const rider = onChute(player.position);
    let lastAlong = rider.along;

    for (let slot = 0; slot < bodies.length; slot += 1) {
      const member = bodies[slot]!;
      member.root.getWorldPosition(at);

      if (!drawn(member.root as never)) {
        missingFrames += 1;
        say(
          'drawn',
          `${member.displayName} was not drawn on ridden frame ${ridingFrames} of the ` +
            'descent — a pet that vanishes mid-ride is worse than one that never left',
        );
      }

      const where = onChute(at);
      // Behind the lip for the first stride or two — deliberately, so eight
      // animals do not stand in one another at the entry. After that it must be
      // in the trough and stay there.
      const settled = ridingFrames > BOARD_SECONDS * 60;
      if (settled) {
        if (where.off > worstOffChute) worstOffChute = where.off;
        if (where.off > ON_CHUTE) {
          offChuteFrames += 1;
          say(
            'on the chute',
            `${member.displayName} was ${where.off.toFixed(2)} m off the chute on ridden frame ` +
              `${ridingFrames} (trough allows ${ON_CHUTE.toFixed(2)} m) — it is beside the ` +
              'slide, or on the ground under it, not on it',
          );
        }
      }

      // **Behind her, and behind the one in front.** Measured as a position on
      // the built curve, so it holds through every bend rather than only where
      // the chute happens to run straight.
      if (where.along > lastAlong + 1e-6) {
        aheadFrames += 1;
        say(
          'behind her',
          `${member.displayName} was ${(where.along * slide.length).toFixed(1)} m down the ` +
            `chute against ${(lastAlong * slide.length).toFixed(1)} m for the one in front of ` +
            `it, on ridden frame ${ridingFrames} — it has overtaken`,
        );
      }
      lastAlong = where.along;

      // **No two on the same spot.**
      if (slot > 0) {
        const ahead = bodies[slot - 1]!.root.getWorldPosition(new Vector3());
        const gap = ahead.distanceTo(at);
        if (gap < closestPair) closestPair = gap;
      }

      const was = previous.get(member.uid);
      // The first ridden frame is the boarding teleport — the whole park
      // changes space behind a closed iris there, exactly as it does for the
      // child, so a step is expected and is not a stutter anybody sees.
      if (was && ridingFrames > 1) {
        const step = was.distanceTo(at);
        if (step > worstStep) worstStep = step;
        if (step > MAX_STEP) {
          say(
            'no jump',
            `${member.displayName} moved ${step.toFixed(2)} m in one frame on ridden frame ` +
              `${ridingFrames}, against ${MAX_STEP} m allowed — that is a jump, not a slide`,
          );
        }
      }
      previous.set(member.uid, at.clone());
    }

    // **Is the nearest companion actually in the picture?** Through the live
    // ride camera — the real object the game renders with, from
    // `Building.rideCameraNow` — not a reconstruction of it.
    const liveShot = building.slideShots.liveShot;
    const liveCamera = building.rideCameraNow;
    const first = bodies[0];
    if (liveShot?.kind === 'chase' && liveCamera && first) {
      chaseFrames += 1;
      scene.updateMatrixWorld(true);
      (liveCamera as { updateMatrixWorld(force: boolean): void }).updateMatrixWorld(true);
      // Its middle, not its feet: the origin of a model is on the floor of the
      // chute, and a pet whose feet are a pixel below the bottom of the frame
      // is still a pet a child can see.
      first.root.getWorldPosition(at);
      at.y += first.height * 0.5;
      const ndc = at.clone().project(liveCamera as never);
      const framed =
        Math.abs(ndc.x) <= IN_SHOT_NDC && Math.abs(ndc.y) <= IN_SHOT_NDC && ndc.z < 1;
      if (framed) framedFrames += 1;

      // **And what does the shot actually look like?** In frustum is not the
      // same as in shot: see `RASTER` — the version of this feature that only
      // asked the frustum question scored 100% while a bunny 0.45 m from the
      // lens filled the frame and hid the child completely.
      if (chaseFrames % 45 === 1) {
        const shot = raster(liveCamera, player.model.root, bodies);
        rasters += 1;
        if (shot.child === 0) {
          childHiddenSamples += 1;
          say(
            'the child is in her own shot',
            `on ridden frame ${ridingFrames} the chase camera shows 0 px of the child — her ` +
              'companions are between her and the lens and have covered her up entirely',
          );
        }
        if (shot.child < worstChild) worstChild = shot.child;
        for (const [name, pixels] of shot.pets) {
          const share = pixels / shot.total;
          if (share > biggestPet) {
            biggestPet = share;
            biggestPetName = name;
          }
          if (share > PET_FRAME_CEILING) {
            say(
              'nothing in the lens',
              `${name} fills ${(share * 100).toFixed(0)}% of the chase frame on ridden frame ` +
                `${ridingFrames}, against ${(PET_FRAME_CEILING * 100).toFixed(0)}% allowed — it ` +
                'is not following her down the slide, it is pressed against the camera',
            );
          }
        }
      }
    }
  }

  // **And back to her at the bottom**, with nobody still riding.
  const settled = PET_IDS.map((_, slot) => parade.companionAt(slot)).filter(
    (member): member is NonNullable<typeof member> => member !== null,
  );
  for (const member of settled) {
    if (member.onSlide) {
      say('off at the bottom', `${member.displayName} was still on the chute after the ride`);
    }
    member.root.getWorldPosition(at);
    const gap = at.distanceTo(player.position);
    if (gap > worstRegroup) worstRegroup = gap;
    if (gap > REGROUP_RADIUS) {
      say(
        'regroup',
        `${member.displayName} was ${gap.toFixed(1)} m from her ${REGROUP_SECONDS} s after the ` +
          `ride, against ${REGROUP_RADIUS} m — it did not come back to her`,
      );
    }
  }

  if (!rideEnded) say('coverage', 'the ride never finished, so nothing after it was measured');
  if (ridingFrames < 60) {
    say('coverage', `the ride only ran for ${ridingFrames} frames — nothing was exercised`);
  }
  const framedFraction = chaseFrames > 0 ? framedFrames / chaseFrames : 0;
  if (chaseFrames === 0) {
    say('in shot', 'no frame was ever on the chase camera, so framing was never tested');
  } else if (framedFraction < IN_SHOT_FLOOR) {
    say(
      'in shot',
      `the nearest companion was in the chase camera's frame on only ` +
        `${(framedFraction * 100).toFixed(0)}% of ${chaseFrames} chase frames, against ` +
        `${(IN_SHOT_FLOOR * 100).toFixed(0)}% required — it is behind her, but not in the shot`,
    );
  }

  parade.dispose();

  console.log(
    `  ${wired ? 'wired  ' : 'control'}: ${ridingFrames} ridden frames, ` +
      `worst ${worstOffChute.toFixed(2)} m off the chute, ` +
      `closest pair ${closestPair === Infinity ? 'n/a' : `${closestPair.toFixed(2)} m`}, ` +
      `biggest single-frame step ${worstStep.toFixed(3)} m, ` +
      `framed on ${(framedFraction * 100).toFixed(0)}% of ${chaseFrames} chase frames, ` +
      `furthest from her afterwards ${worstRegroup.toFixed(1)} m ` +
      `(${missingFrames} undrawn, ${offChuteFrames} off-chute, ${aheadFrames} overtaking ` +
      'pet-frames)',
  );

  return {
    ridingFrames,
    complaints,
    framedFraction,
    worstOffChute,
    worstStep,
    closestPair,
    worstRegroup,
  };
}

// Granted once, before either run: the store is the game's, there is one of it,
// and both descents must be taken by the same three animals or the control is
// not a control.
for (const id of PET_IDS) {
  const spec = shopItem(id);
  if (!spec) throw new Error(`check:pet-slide — no catalogue entry for ${id}`);
  gameStore.catchWildPet(spec);
}

console.log('  riding the ginormous slide with three companions:');
const wired = await ride(true);
console.log('  and again with the ride never told about the parade — the control:');
const control = await ride(false);

const failures: string[] = [];
for (const complaint of wired.complaints) failures.push(`${complaint.clause}: ${complaint.detail}`);

// **The control must fail.** If riding with the parade unwired passes every
// clause above, then every clause above is satisfied by a pet standing in the
// long grass and this file proves nothing. Which clauses go red is not pinned —
// that would be a second description of the old behaviour — only that some do.
if (control.complaints.length === 0) {
  failures.push(
    'the control passed: a descent where the ride was never told about the parade at all ' +
      'satisfied every clause above, so the clauses are not measuring whether the pets ride ' +
      'the slide. Nothing green in this file can be believed until this goes red again',
  );
}

if (failures.length > 0) {
  console.error('check:pet-slide FAILED');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `check:pet-slide ok — three companions rode all ${wired.ridingFrames} frames of the descent ` +
    `behind her and in order, never more than ${wired.worstOffChute.toFixed(2)} m off the chute, ` +
    `never closer to each other than ${wired.closestPair.toFixed(2)} m, never moving more than ` +
    `${wired.worstStep.toFixed(3)} m in a frame, in the chase camera's shot on ` +
    `${(wired.framedFraction * 100).toFixed(0)}% of its frames, and back within ` +
    `${wired.worstRegroup.toFixed(1)} m of her ${REGROUP_SECONDS} s later.\n` +
    `  The control (ride not wired to the parade) failed ` +
    `${control.complaints.length} of the same clauses — ` +
    `${control.complaints.map((c) => c.clause).join(', ')} — so they measure the ride and not ` +
    'the park.',
);
