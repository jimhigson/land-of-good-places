import { CylinderGeometry, Group, Mesh, type Material } from 'three';
import { ART } from '../style/artPalette';
import { addOutline, disposeTree, inkTint, solid, toonMaterial } from '../style/materials';
import { TAU } from '../style/bridge';
import type { AssetHandle } from '../style/asset';
import { createRipika, type RipikaPalette } from './ripika';

/**
 * The grey-stone RiPika that stands in the middle of the wishing fountain.
 * Family request, 28 July 2026 (issue #121).
 *
 * ## Why this is not a second model
 *
 * It would have been easy to carve a statue of RiPika. It is better to render
 * RiPika *as* stone, and the difference is not stylistic — it is about which
 * version goes stale.
 *
 * A hand-authored statue is a second RiPika, and a second RiPika has to be kept
 * in step with the first by hand forever. Retune the head scale, change the
 * ears, repaint the face, and the statue silently becomes a statue of a mouse
 * the park no longer contains. This repo has written that post-mortem more than
 * once (the hood faces, the sky dome): a second thing positioned or shaped by a
 * formula that has to track the first is a place for a bug to hide.
 *
 * So the statue calls `createRipika` with a **stone colourway**. Every
 * proportion, every squash, every outline is the live mouse's, and a change to
 * her reaches her statue for free. ART_DIRECTION §7 asks for exactly this:
 * primitive composition is the preferred way to build a model, and the Blender
 * exemption is scoped to organic continuous forms like hair — which a statue of
 * an already-primitive-built mouse is not.
 *
 * ## What makes it read as stone rather than a grey mouse
 *
 * Not a single flat grey. `ART.statueStone*` is a five-step tonal ladder
 * ordered by the luminance of the colour each step replaces, so the cocoa ear
 * tips, the cream tummy and the amber tail tip survive the trip to stone as
 * tonal steps rather than disappearing. A statue that loses its markings reads
 * as a lump at play distance, which is precisely the failure the cream tummy
 * exists to prevent on the live mouse.
 *
 * The face is **repainted** in stone, not tinted and not removed — see
 * `ripika.ts`. Tinting leaves a grey statue with tomato cheeks; removing it
 * leaves a blank ball, because since the 31 July baked-face rework the face
 * lives in the skull's own texture and there is no separate mesh to hide.
 *
 * The outlines need no special handling at all, which is worth stating because
 * an earlier research note warned about re-materialling `addOutline`'s
 * inverted-hull shells and hitting their `BackSide` material. That danger only
 * exists if you build a yellow mouse and then walk the tree recolouring it.
 * Building in stone from the start means `addOutline` reads each mesh's own
 * stone colour as it goes and ink-tints it correctly — there is no second pass,
 * so there is nothing to get wrong.
 */

/** RiPika in carved stone. See `ART.statueStone*` for why it is a ladder. */
const STONE_PALETTE: RipikaPalette = {
  yellow: ART.statueStone,
  yellowDeep: ART.statueStoneMid,
  belly: ART.statueStoneLight,
  tip: ART.statueStoneDark,
  bolt: ART.statueStoneDeep,
  cheek: ART.statueStoneDeep,
};

/**
 * How tall the carved figure is, ear tips included — plinth not counted.
 *
 * **6.80 m: four times the 1.70 m this was first built at.** Jim looked at the
 * first version in the park on 5 August 2026 and said "far too small, make it
 * 4x this size, otherwise is ok" — everything else about it passed, only the
 * scale was wrong, and the issue title had asked for a *large* statue all
 * along.
 *
 * The earlier note here claimed 1.70 m was a ceiling because anything taller
 * would occlude the plaza ring. That was too cautious — the ring road's nearest
 * approach is 13.90 m from the fountain axis and the statue's occluded ground
 * wedge reaches 13.32 m, so the road stays visible. **By 0.58 m.** That is a
 * coincidence, not a margin: roughly 5% more height and the ring road goes
 * behind the statue.
 *
 * ## The cost, measured — do not raise this number without re-measuring
 *
 * When this was resized I justified it here by arguing that "the camera follows
 * the player, so the statue only ever hides the far side of a plaza the player
 * is already standing in". **That reasoning is wrong and the comment has been
 * corrected rather than quietly deleted, because it is a tempting mistake.**
 *
 * The camera is **orthographic** (`CAMERA_IS_ORTHOGRAPHIC`). An orthographic
 * projection has no parallax, so the occluded wedge is **fixed in world space**:
 * moving the camera changes whether that patch is on screen, not *what* is
 * hidden behind the statue. The player can therefore stand in it, and does.
 *
 * Surveyed on the built park at this height: a 2.12 m player is fully hidden
 * anywhere within **10.60 m** of the fountain centre — past the 9.4 m plaza
 * kerb — which is **32.8 m² of walkable ground**. At 1.70 m it was 2.70 m,
 * i.e. inside the basin, i.e. never. Two pickable flowers (at (-1.2, -0.7) and
 * (-2.5, -1.0)) are now permanently behind it.
 *
 * `FoliageFade` is the system that exists for exactly this ("no more rotating
 * round a tree that's in the way", design feedback #16) and it only accepts
 * trees, so the statue does not fade. If this height stays, that is the gap to
 * close — not a smaller statue.
 */
const FIGURE_HEIGHT = 6.8;

/**
 * Plinth height — also 4x, so the statue as a whole is the 4x that was asked
 * for and the plinth keeps its proportion to the figure (~21%).
 *
 * The plinth could not simply be scaled 4x in *every* dimension; see
 * {@link PLINTH_BASE_RADIUS}.
 */
const PLINTH_HEIGHT = 1.44;

/**
 * The plinth's widest radius, at the bottom of its footing.
 *
 * **This is the one dimension that could not go up 4x, and the constraint is
 * hard.** The plinth stands on the fountain's upper bowl of water, which is a
 * 1.2 m-radius disc (`world/Fountain.ts`). Four times the original 0.82 m would
 * be 3.28 m — it would overhang the bowl entirely and hang in mid-air over the
 * basin, nearly reaching the 4.2 m rim.
 *
 * So the plinth grows 4x in height and only ~1.4x in radius, and 1.15 m is what
 * that leaves: as wide as the bowl can host, with 5 cm of margin.
 *
 * The happy accident is that this is almost exactly the width the figure needs
 * anyway. At 4x, RiPika's feet span about 2.14 m across and her torso about
 * 2.28 m, against this plinth's 2.30 m — so she stands squarely on it and the
 * drum reads as the same width as the body above it. A plinth that had scaled
 * 4x in radius would have been far too wide for the figure standing on it; the
 * constraint pushed the proportion somewhere better than the naive scaling
 * would have.
 */
const PLINTH_BASE_RADIUS = 1.15;

/**
 * Seconds for one full revolution about the vertical axis.
 *
 * **Jim's number, 5 August 2026: "can we also make the pikachu statue slowly
 * rotate? A rate of about once every 5 seconds should do."** It ships as asked.
 * What follows is the measurement that says it is fast, recorded here rather
 * than argued in a pull request nobody re-reads, so that whoever retunes it
 * next has the comparison to hand.
 *
 * 5 s is **1.257 rad/s**, and the park already has an opinion about how fast a
 * big thing turns. The Ferris wheel — the only other large rotating object here
 * — runs at `TURN_SECONDS = 44` (`minigames/ferrisWheel/wheelProp.ts`) under a
 * comment reading "Slow: this is scenery, not a ride". That is 0.143 rad/s, and
 * a 7 m rim moving at **1.0 m/s**: below NPC walking pace, the slowest moving
 * thing in the park bar the escalator.
 *
 * Sorting every `rotation.y = elapsed * K` in the repo puts them in three
 * bands: celestial and background 0.01–0.25, tabletop props 0.6–3.4, sparkles
 * 3–9. At 1.257 this statue lands in the **tabletop-prop** band, between the
 * candy-floss fluff (1.4 rad/s on a 0.20 m spinner) and the tap marker's idle
 * ring (1.1 rad/s on a 0.62 m ring). Those are objects you could pick up. This
 * one is 8.24 m tall and reaches 3.13 m at the raised paw — so that paw sweeps
 * at **3.93 m/s**, four times the Ferris wheel's rim, faster than an NPC walks
 * (2.55) and a shade over parade top speed (4.2). Jim's own word for what he
 * wanted was "slowly", and 72°/s is not that: the face turns from facing you to
 * facing away in 2.5 seconds.
 *
 * **If it is ever retuned, ~15 s is the number to try.** That is 0.419 rad/s and
 * puts the raised paw at 1.31 m/s — the Ferris wheel's rim speed, which is this
 * park's established pace for "something large, moving gently". Slow enough to
 * read as a monument, still fast enough that a six-year-old sees it turning
 * within a couple of seconds of looking at it rather than having to stand and
 * wait, which is why the suggestion is not the wheel's own 44 s.
 *
 * Exported because `scripts/check-statue-occlusion.mts` sweeps exactly one
 * revolution and must keep doing so whatever this number becomes.
 */
export const STATUE_TURN_SECONDS = 5;

export interface RipikaStatueHandle extends AssetHandle {
  /** The plinth alone, for anything that wants to light or decorate it. */
  readonly plinth: Group;
  /**
   * Turns the statue on its plinth. **Required here, not optional as on
   * `AssetHandle`** — the caller (`world/Fountain.ts`) must drive it, and a
   * handle that silently forgot to spin would be a bug nothing type-checks.
   *
   * Driven off `elapsed`, so `dt` is ignored — see the call site.
   */
  update(dt: number, elapsed: number): void;
  /**
   * Turns the whole statue translucent so it stops hiding the player —
   * `world/FoliageFade.ts` drives this. 1 is solid.
   *
   * Every material in the tree, outlines included. Leaving the inverted-hull
   * outlines opaque while the body faded would leave a solid grey cartoon
   * outline of a mouse hanging in the air, which is a worse artefact than the
   * occlusion it is fixing.
   */
  setFade(alpha: number): void;
  /** Half the statue's height — the occluder capsule's, in local metres. */
  readonly halfHeight: number;
  /** The occluder capsule's horizontal radius, in metres. */
  readonly occluderRadius: number;
}

/**
 * The occluder capsule's radius.
 *
 * A capsule is one radius, so this has to be the width of the **mass that
 * actually hides a child**. Erring wide fades the statue whenever anyone walks
 * near the fountain; erring narrow leaves the child hidden, which is the bug.
 *
 * **2.5 m — raised from 1.8 on 5 August 2026, when the statue started turning.**
 * That change is not cosmetic and the old number was genuinely unsafe once it
 * shipped, so the reasoning behind both values is kept.
 *
 * ## Why a rotating statue needs a wider capsule than a still one
 *
 * At a fixed pose, the outflung arm and the tail could be written off as thin
 * decoration: they reach 3.13 m at the raised paw (y 6–7), but only in *one*
 * direction, and that direction happened not to matter. Spin the statue and
 * that stops being true — the paw sweeps a 3.13 m circle, so every bearing now
 * sees the full reach at some point in the turn. The capsule is a body of
 * revolution and cannot describe a pose, so it has to describe the **swept**
 * shape.
 *
 * That gives a prediction before any measurement: `FoliageFade` tests against
 * `radius + SIGHTLINE_MARGIN`, and `SIGHTLINE_MARGIN` is `PLAYER_RADIUS + 0.35`
 * = 0.97 m, so covering a 3.13 m sweep wants `3.13 − 0.97 = 2.16 m`.
 *
 * ## What was measured
 *
 * `scripts/check-statue-occlusion.mts` grid-sweeps 985 m² of standable plaza at
 * 0.25 m, raycasting a 2.12 m player's head, chest and waist along the camera
 * axis, at poses spanning one full revolution. Ground where the child is hidden
 * *and the statue does not fade*, with `SWEEP_R`:
 *
 * ```
 *   still (one pose)   r=1.2 → 0.4 m²   r=1.4 → 0        r=1.8 → 0
 *   turning            r=1.8 → 0.9 m²   r=2.05 → 0.1 m²  r=2.10 → 0
 * ```
 *
 * So **rotation moved the true threshold from 1.4 m to 2.10 m**, and at the
 * shipped 1.8 the turning statue hid a child over 0.9 m² of plaza, about 7 m
 * out, at 9 of 24 poses. The measured 2.10 lands just under the 2.16 the
 * geometry predicts — the paw is thin and high, so it clips the child's outline
 * a little before it covers it — which is the reassuring kind of agreement.
 *
 * That threshold is solid: re-measured at 24, 48, 96 and 180 poses (down to 2°
 * steps) it is 2.10 every time, so it is not an artefact of how finely the turn
 * is sampled.
 *
 * ## Why 2.5 and not 2.10 or 2.7
 *
 * 2.5 is ~19% over the threshold and clears the 2.16 the swept geometry asks
 * for outright. Headroom is not free — it is monotone in ghosting, with the
 * ground where the statue fades but the child was not really hidden going
 * 54.5 m² at 2.10 → **68.6 m² at 2.5** → 76.1 m² at 2.7 — and the fade is a
 * binary target (`MIN_ALPHA` 0.26), not a gentle ramp, so that area is really
 * see-through rather than slightly hazy.
 *
 * The old 1.8 carried ~29% over its threshold, and matching that ratio would
 * mean 2.7. Less is taken here deliberately, because the measurement behind 2.10
 * is a much tighter one than the measurement behind 1.4: that was a single pose
 * in 0.2 m radius steps, and the fragility of measuring one pose is exactly what
 * produced this bug. This is 180 poses in 0.05 m steps.
 *
 * **The rotation does not make the fade flicker**, which is worth writing down
 * because it is the first thing to suspect. The fade decision is taken against
 * this capsule alone, and a capsule about the vertical axis is the same shape at
 * every angle — so turning the statue cannot change the decision. The fade still
 * only reacts to the player moving, exactly as before.
 *
 * Re-run `npm run check:statue-occlusion` (with `SWEEP_R`, and `SWEEP_POSES` if
 * you doubt the sampling) if the statue's proportions or its rate ever change.
 */
const OCCLUDER_RADIUS = 2.5;

/**
 * Builds the statue. Origin at the **base of the plinth**, centred on X and Z,
 * facing +Z — the standard asset contract, so a caller seats it by setting
 * `root.position.y` to whatever it stands on and needs no fudge factor.
 */
export function createRipikaStatue(): RipikaStatueHandle {
  const root = new Group();
  root.name = 'prop.ripikaStatue';

  // --- the turntable --------------------------------------------------------
  // One group between the root and everything else, and it is the ONLY node
  // this asset animates. Two decisions are baked in here, both of them the same
  // decision the `figure` wrapper below already makes about scale.
  //
  // **Why not spin `root`.** The asset contract reserves the root's yaw for the
  // *caller's* placement facing ("Forward is +Z ... rotate the root only"). An
  // asset that stamps `root.rotation.y` every frame silently overwrites whatever
  // angle its placer chose, and the placer has no way to notice. Spinning an
  // inner group composes with the caller's yaw instead of fighting it.
  //
  // **Why the plinth is inside it too**, rather than a figure revolving on a
  // stationary base. Visually it is a free choice — the plinth is three
  // 28-segment cylinders, a body of revolution, so you cannot see which way
  // round it is. What it buys is that there is exactly one moving node in the
  // asset, so "does everything rotate together?" stops being something to verify
  // and becomes something that cannot be otherwise. Two things that would
  // otherwise need checking come along for free: `addOutline` parents its
  // inverted hull to the mesh it outlines (`mesh.add(outline)`), so every
  // outline is a descendant and moves with its own geometry; and since the
  // 31 July rework RiPika's face is baked into the skull's own UV texture rather
  // than a separate patch mesh, so there is no second surface that could lag
  // behind. Nothing here is positioned by a formula tracking another node.
  const turntable = new Group();
  turntable.name = 'statueTurntable';
  root.add(turntable);

  // --- plinth ---------------------------------------------------------------
  // Three dressed courses rather than one drum: a footing, the drum itself, and
  // a cap that flares back out into an overhanging lip for the feet to stand
  // on. Flat colour, no stone map — a tiling cobble texture on something this
  // small reads as busy noise at play distance, and ART_DIRECTION §7 is explicit
  // that flat colours are material colours rather than maps. Two tones is all
  // it takes to read as dressed stone with a shadow line under the lip.
  const plinth = new Group();
  plinth.name = 'statuePlinth';
  turntable.add(plinth);

  // The plinth takes two steps from the figure's own ladder rather than a
  // dedicated pair of greys. Same rock, cut into blocks instead of a mouse —
  // which is both what a real plinth is and one fewer place for the park to
  // acquire a second, slightly different stone.
  const plinthStone = toonMaterial(ART.statueStoneMid);
  const plinthStoneDark = toonMaterial(ART.statueStoneDeep);
  const plinthInk = inkTint(ART.statueStoneDeep);

  const course = (
    topR: number,
    bottomR: number,
    height: number,
    centreY: number,
    material: typeof plinthStone,
  ): Mesh => {
    const mesh = solid(new Mesh(new CylinderGeometry(topR, bottomR, height, 28), material));
    mesh.position.y = centreY;
    plinth.add(mesh);
    return mesh;
  };

  // The three courses are written as FRACTIONS of the plinth's overall height
  // and base radius rather than as absolute metres, because those two grew by
  // different factors when the statue was resized (4x tall, 1.4x wide — see
  // PLINTH_BASE_RADIUS). Absolute numbers would have had to be re-derived by
  // hand for each course, twice, and a single fat-fingered digit would have gone
  // unnoticed. This way the plinth's shape is one thing and its size is another.
  const r = (fraction: number): number => fraction * PLINTH_BASE_RADIUS;
  const h = (fraction: number): number => fraction * PLINTH_HEIGHT;

  const footing = course(r(0.902), r(1), h(0.25), h(0.125), plinthStoneDark);
  const drum = course(r(0.756), r(0.902), h(0.583), h(0.542), plinthStone);
  course(r(0.854), r(0.756), h(0.167), h(0.917), plinthStoneDark);

  // --- the figure -----------------------------------------------------------
  // Scaled on a wrapper group rather than on RiPika's own root, because the
  // asset contract reserves `root.scale` for gameplay squash-and-stretch and a
  // scaled root would quietly break that promise for anything that later picks
  // this handle up. The wrapper scales the outlines along with the geometry,
  // which is what ART_DIRECTION §2 wants — an outline scales with its object.
  const figure = new Group();
  figure.name = 'statueFigure';
  figure.position.y = PLINTH_HEIGHT;
  turntable.add(figure);

  const ripika = createRipika({ palette: STONE_PALETTE, expressions: false });
  // Derived from the handle rather than written down, so if RiPika's height is
  // ever retuned the statue stays exactly FIGURE_HEIGHT tall instead of drifting
  // and pushing its own `height` — and the name label above it — out of true.
  const figureScale = FIGURE_HEIGHT / ripika.height;
  figure.scale.setScalar(figureScale);
  figure.add(ripika.root);

  // Outlines on the two courses that define the silhouette, not all three: the
  // cap sits inside the footing's line from every angle the iso camera reaches,
  // and outlining it too draws a stray line across the plinth's middle.
  //
  // Weight is taken from the FIGURE's, not from ART_DIRECTION §2's raw
  // 0.016–0.022 band, and the difference matters at this size. RiPika's own
  // parts are outlined at 0.014 in her local metres, and the wrapper group
  // multiplies that by `figureScale` — so at 4x the figure's lines come out
  // near 6.5 cm. A plinth still wearing a literal 0.02 would have looked like a
  // pencil sketch bolted to the bottom of a woodcut. Matching the figure's is
  // what makes the plinth and the mouse read as one carved object, and it stays
  // matched automatically if the statue is ever resized again.
  const plinthOutline = 0.014 * figureScale;
  addOutline(footing, plinthOutline, plinthInk);
  addOutline(drum, plinthOutline, plinthInk);

  // Pose. Deliberately NOT `setWalkPhase(0, 0)`: a freshly built RiPika is
  // already in the neutral stance (identity limbs, identity body), and
  // `setWalkPhase` would additionally flatten the tail's authored 1.05 rad cant
  // to zero — the cant that keeps the lightning flash fanned across the screen
  // instead of hidden behind the body.
  //
  // One raised arm, mid-wave. It gives the statue an asymmetric silhouette that
  // reads from across the plaza, which is the thing that actually decides
  // whether a six-year-old recognises it — and ART_DIRECTION §4 asks for
  // exactly this ("nothing is plumb"). A statue standing perfectly straight and
  // symmetrical looks like a placeholder.
  if (ripika.limbs) {
    ripika.limbs.rightArm.rotation.z = 1.3;
    ripika.limbs.rightArm.rotation.x = -0.15;
  }
  // A little life in the head to match the wave: tipped towards the raised arm
  // and turned a few degrees off dead-ahead. Rotating `head` does not move the
  // body — that is the contract on `CreatureHandle.head`.
  ripika.head.rotation.z = 0.07;
  ripika.head.rotation.y = -0.12;

  // Collected once, at build time, rather than by traversing on every fade
  // step. `setFade` is called every frame while the player is behind the
  // statue, and walking 40 meshes each time to rediscover the same 40
  // materials would be the one genuinely hot thing this file does.
  //
  // Every material here is this statue's own — `toonMaterial` returns a fresh
  // one per call and the stone palette is not shared with the live mouse — so
  // mutating them cannot reach anything else in the park.
  const materials: Material[] = [];
  root.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    const material = mesh.material;
    if (!material || Array.isArray(material)) return;
    materials.push(material);
  });

  return {
    root,
    plinth,
    height: PLINTH_HEIGHT + FIGURE_HEIGHT,
    halfHeight: (PLINTH_HEIGHT + FIGURE_HEIGHT) / 2,
    occluderRadius: OCCLUDER_RADIUS,
    // Absolute phase from `elapsed`, not an angle accumulated from `dt`, and the
    // reasons run in that order of importance:
    //
    //  - `FrameContext.elapsed` is documented as the thing to "use for
    //    continuous animation phases", and a constant-rate spin is exactly one.
    //    `models/jetpack.ts` takes the same shape, `(_dt, elapsed)`.
    //  - It is stateless. `x = f(t)` cannot drift, cannot double-step if the
    //    hook is ever called twice in a frame, and needs no field to reset.
    //  - The fountain this stands in already drives its ripples off `elapsed`,
    //    so the statue and the water it stands on share one clock. That matters
    //    at the pause screen: `Game.ts` zeroes `dt` when paused but keeps
    //    `elapsed` running at real time on purpose, so "idle animations keep
    //    breathing". Water rippling round a statue frozen mid-turn would read as
    //    a bug in the one prop where both are visible at once.
    //
    // Not wrapped into [0, TAU): `elapsed` is seconds since load, so the angle
    // stays far inside the range where a float's precision is irrelevant to a
    // rotation, and three.js normalises it into the matrix anyway.
    update: (_dt: number, elapsed: number) => {
      turntable.rotation.y = (elapsed / STATUE_TURN_SECONDS) * TAU;
    },
    setFade: (alpha: number) => {
      const wantsTransparent = alpha < 1;
      for (const material of materials) {
        material.opacity = alpha;
        if (material.transparent !== wantsTransparent) {
          material.transparent = wantsTransparent;
          // `depthWrite` goes with it. A translucent statue still writing depth
          // occludes whatever is drawn after it — including the player it is
          // getting out of the way for, which would defeat the entire point.
          material.depthWrite = !wantsTransparent;
          // Switching `transparent` changes the shader's defines, so three.js
          // needs telling. Only on the edge, never per frame.
          material.needsUpdate = true;
        }
      }
      // `castShadow` is deliberately NOT touched. Two reasons, both learned by
      // writing the wrong version first: the outline hulls are authored
      // `castShadow = false` by `addOutline`, so a blanket restore would switch
      // shadows ON for meshes that must never cast one; and a 19 m shadow
      // blinking out as a child steps behind the statue is a worse artefact
      // than the shadow. Shadow behaviour is a separate question from occlusion.
    },
    dispose: () => disposeTree(root),
  };
}
