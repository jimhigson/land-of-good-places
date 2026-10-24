/**
 * **`check:labels` — every text label over the world is managed: one per
 * item, never overlapping, the more important one winning, and steady.**
 *
 * ```
 * pnpm run check:labels                       # part of pnpm run check
 * LABELS_MUTATE=overlap   pnpm run check:labels   # prove each assertion red
 * LABELS_MUTATE=item      pnpm run check:labels
 * LABELS_MUTATE=precedence pnpm run check:labels
 * LABELS_MUTATE=ties      pnpm run check:labels
 * VIEW=1280x720 pnpm run check:labels         # any viewport; 390x844 by default
 * ```
 *
 * Jim, 6 October 2026: *"each item needs to have at most one text label — the
 * call to action is sometimes still shown while the action is happening, and
 * covers up any labels that the action wants to show."* The fix is one owner,
 * `ui/LabelManager.ts`; the design is `docs/design/LABELS.md`. This is the
 * check that it holds, on the real park, frame by frame.
 *
 * ## What runs
 *
 * The real `World` (`park-harness.mts`), a real `Player` attached to it, the
 * real `Selection` and the real `ActionChips`, stepped at 1/60 in `Game.tick`'s
 * own order — player, the reading room's camera claim (the owl's glance at the
 * book she recommends, `bookGlance.ts`, applied as `Game` applies it), camera,
 * world, selection, chips, then `world.labels.resolve` — through four scenes:
 *
 *  1. **A busy plaza.** From the gate into the middle of the garden and back,
 *     through the crowd, chips coming and going as she passes things.
 *  2. **The Reptile House.** Every exhibit, stall and hidden baby: stand at
 *     it, press its chip, and watch the answer ("peep!", the blurb, "3 of 5
 *     babies found!") come up over the very thing the chip was over.
 *  3. **The castle shops.** Every shop counter on the ground floor, with the
 *     crowd that shops there.
 *  4. **The hotel lobby.** Reception: check in, and let the receptionist talk.
 *  5. **The Library** (#718). The owl at her desk: her card handed over, then
 *     a book recommended, her bubble over her own chip; a shelf book's
 *     "Read it!" chip; then story time, called with her at the owl's desk —
 *     the call said there, then the owl's silent flight over the stacks to
 *     the big chair (she calls first and flies when it is said: browser QA
 *     round 1 found the call's bubble hiding her whole flight) while the
 *     child goes to her story cushion and sits, the children walking to the
 *     rug, and the first pages read over the rug, the cushion's "Get up"
 *     chip up below them. Each visit is asked what it was
 *     for (the card held, a book recommended, her seated, the reading
 *     reached), not only whether a chip was up — and story time is asked what
 *     it showed: the frames the owl's bubble was drawn while she called from
 *     her desk, and, while she read, the frames her bubble, the Get up chip,
 *     and both together were drawn. None may be zero (the review of the join:
 *     with her bubble left over her desk, 17 m away, no word of the story was
 *     drawn over the rug, and the scene's other counts did not change). And
 *     the line that names the book she recommends ("Try “…” next!") must be
 *     drawn on **every** frame she says it: the owl's glance at the book
 *     (`bookGlance.ts`) once took the camera — and her bubble with it — as she
 *     began it, and on a phone the title was up for a tenth of a second
 *     (review and QA of #735).
 *
 * ## What is asserted, every frame
 *
 *  A. **No two drawn labels overlap** — by their laid-out screen rectangles,
 *     measured here by an instrument of this file's own (below), not read back
 *     from the manager.
 *  B. **At most one drawn label per item.**
 *  C. **Precedence.** Of an item's wanted labels, only the highest may be the
 *     one drawn; and a wanted label that is not drawn must be touching a drawn
 *     label at least as important, or have been within the last
 *     `LABEL_HOLD_SECONDS` (the hold) — never hidden for nothing, never hidden
 *     by something lesser.
 *  D. **No flicker.** A label that wanted to be drawn throughout never changes
 *     its drawn state twice within the hold.
 *  E. **Coverage**, so none of the above is vacuous: the run must have seen
 *     overlaps actually prevented, a call to action actually put away for its
 *     own action's answer, and many frames with several labels up at once —
 *     all printed on stderr on every run.
 *
 * ## The instrument, and its control
 *
 * Sprites (pills and bubbles) are measured from the drawn sprite itself —
 * world position, world scale, the painted content box — by the pinhole
 * relation at the sprite's own depth, which is a different calculation from
 * the manager's corner projection. Every frame the two must agree to a pixel; a
 * disagreement is a failure of its own, because a check measuring something
 * other than what the manager judged would be passing about the wrong thing.
 *
 * The chips are DOM, and Node has no layout. The row's size comes from a
 * **layout model** installed here (`chipRowModel`): each chip as wide as its
 * words at the TEXT RULE's minimum size plus its padding and key hint. It is a
 * model, said here and on stderr; the real layout is what the PR's browser
 * screenshot is of. Where the chips are put — the transform `ActionChips`
 * writes — is read off the element.
 *
 * ## Proving it red
 *
 * `LABELS_MUTATE` breaks exactly one of the manager's rules, by patching the
 * one small method that rule asks (see `LabelManager.itemOf`, `rank`,
 * `holdSeconds`, `precedes`), so the shipping code is otherwise what runs:
 *
 *  - `overlap` — nothing ever collides: assertion A fails.
 *  - `item` — every label is its own item: assertion B fails.
 *  - `precedence` — the table upside down: assertion C fails.
 *  - `ties` — ties broken at random each frame and no hold: assertion D fails.
 *
 * Transcripts, with the inputs they were measured on, are in
 * `docs/design/LABELS.md`.
 */
import './headless-dom.mjs';
import { setViewport } from './headless-dom.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { Player } from '../src/entities/Player.ts';
import { Selection } from '../src/world/Selection.ts';
import { ActionChips } from '../src/ui/ActionChips.ts';
import {
  LABEL_ENTRY_CUSHION_PX,
  LABEL_HOLD_SECONDS,
  LABEL_MARGIN_PX,
  LABEL_PRECEDENCE,
  LabelManager,
  SpriteLabel,
  rectsTouch,
  type ContentBox,
  type ManagedLabel,
  type ScreenRect,
} from '../src/ui/LabelManager.ts';
import { NameLabel } from '../src/ui/NameLabel.ts';
import { SpeechBubble } from '../src/ui/SpeechBubble.ts';
import { minTextPx } from '../src/core/uiScale.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { spaceAt, SPACE_GARDEN, SPACE_REPTILE_HOUSE, SPACE_HOTEL_LOBBY, SPACE_LIBRARY } from '../src/world/spaces.ts';
import { OWL_ZONE_ID } from '../src/world/library/LibraryOwl.ts';
import { BookGlance } from '../src/world/library/bookGlance.ts';
import { hasLibraryCard } from '../src/world/library/libraryCard.ts';
import { gameStore } from '../src/state/index.ts';
import { LIBRARY_LINES } from '../src/world/library/libraryLines.ts';
import { bookById } from '../src/world/library/books.ts';
import { lineSeconds } from '../src/ui/speechTiming.ts';
import { PRIMARY_ACTION, type InteractZone } from '../src/world/interact.ts';
import type { FrameContext } from '../src/core/types.ts';

// --- configuration ------------------------------------------------------------

const VIEW = process.env['VIEW'] ?? '390x844';
const viewMatch = /^(\d+)x(\d+)$/.exec(VIEW);
if (!viewMatch) {
  console.error(`VIEW must look like 390x844; got ${JSON.stringify(VIEW)}`);
  process.exit(2);
}
const WIDTH = Number(viewMatch[1]);
const HEIGHT = Number(viewMatch[2]);
const DT = 1 / 60;
/** Frames inside which a wanted label may not change twice — the hold, in frames. */
const HOLD_FRAMES = Math.ceil(LABEL_HOLD_SECONDS / DT);
/** Overlap below this many square pixels is rounding, not two labels on top of each other. */
const OVERLAP_AREA_PX = 0.5;

const MUTATE = process.env['LABELS_MUTATE'] ?? '';
const MUTATIONS = ['', 'overlap', 'item', 'precedence', 'ties'];
if (!MUTATIONS.includes(MUTATE)) {
  console.error(`LABELS_MUTATE must be one of ${MUTATIONS.filter(Boolean).join(', ')}; got ${MUTATE}`);
  process.exit(2);
}
{
  // Each mutation breaks one rule, in the one method that rule asks.
  type Innards = Record<string, unknown>;
  const proto = LabelManager.prototype as unknown as Innards;
  if (MUTATE === 'overlap') proto['collides'] = () => false;
  if (MUTATE === 'item') proto['itemOf'] = (entry: { label: ManagedLabel }) => entry.label.identity.id;
  if (MUTATE === 'precedence') {
    proto['rank'] = (entry: { label: ManagedLabel }) => -LABEL_PRECEDENCE[entry.label.identity.kind];
  }
  if (MUTATE === 'ties') {
    proto['holdSeconds'] = () => 0;
    const rank = (entry: { label: ManagedLabel }): number => LABEL_PRECEDENCE[entry.label.identity.kind];
    proto['precedes'] = (a: { label: ManagedLabel }, b: { label: ManagedLabel }) =>
      rank(a) !== rank(b) ? rank(a) > rank(b) : Math.random() < 0.5;
  }
}

// --- the park, the player, the chips --------------------------------------------

setViewport(WIDTH, HEIGHT);
(globalThis.window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = WIDTH;
(globalThis.window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = HEIGHT;

const park = quietly(() => buildHeadlessPark());
const { world, scene, camera } = park;
camera.resize(WIDTH, HEIGHT);

const spawn = new Vector3(ENTRANCE_PLAYER_X, terrainHeight(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
const player = quietly(() => new Player(world.collision, camera, spawn.clone()));
scene.add(player.group);
quietly(() => world.attachPlayer(player));
const input = new InputSystem();

/**
 * The owl's glance at the book she recommends (`bookGlance.ts`): `Game.tick` applies it after the player
 * and before the camera, its claim the camera's focus override — so here, so the labels of the library
 * scene are laid out on the camera the game draws while the owl names her book and the camera shows it.
 * And while it holds nothing is selected (`Game.selectionBlocked`), so here too. The frames it held are
 * counted ({@link glanceFrames}), and the frames a chip was drawn while it held ({@link glanceChipFrames}).
 */
const bookGlance = new BookGlance(world.library);
let glanceFrames = 0;
let glanceChipFrames = 0;
/** The frames the owl said the line naming the book she recommends, and the frames her bubble was drawn while she did. */
let namingFrames = 0;
let namingDrawnFrames = 0;
const canvas = document.createElement('div') as unknown as HTMLCanvasElement;
const selection = new Selection(player, camera, canvas, {
  zones: () => world.interactZones(),
  blocked: () => bookGlance.active,
  walkTo: () => {},
  walking: () => false,
  flash: () => {},
});
const uiRoot = document.createElement('div') as unknown as HTMLElement;
const chips = new ActionChips(uiRoot, selection, () => camera.camera, () => player.riding);
world.labels.add(chips);
const chipRoot = (uiRoot as unknown as { children: { dataset: Record<string, string>; style: Record<string, string> }[] })
  .children[0];
const chipRow = (uiRoot as unknown as { querySelector(s: string): { children: { innerHTML: string }[] } & Record<string, unknown> })
  .querySelector('.action-chip-row');
if (!chipRoot || !chipRow) throw new Error('check:labels: ActionChips built no row to measure');

/**
 * **The layout model for the chip row** — Node lays nothing out. Each chip is
 * its words at the TEXT RULE's minimum size (a bold sans averages about 0.6 em
 * a character), plus the padding and the `<kbd>` hint `style.css` gives it, and
 * the row's gap between chips. Generous rather than tight: a model that
 * under-sized the chips would let this check pass over overlaps a browser has.
 */
function chipRowModel(): { width: number; height: number } {
  const text = minTextPx();
  let width = 0;
  for (const button of chipRow!.children) {
    const words = button.innerHTML.replace(/<kbd>.*?<\/kbd>/g, '').replace(/<[^>]+>/g, '');
    const hasKey = /<kbd>/.test(button.innerHTML);
    width += [...words].length * text * 0.6 + text * 1.6 + (hasKey ? text * 1.6 : 0);
  }
  width += Math.max(0, chipRow!.children.length - 1) * 6;
  return { width, height: text * 2.4 };
}
chipRow['getBoundingClientRect'] = () => {
  const { width, height } = chipRowModel();
  return { left: 0, top: 0, width, height, right: width, bottom: height };
};

const view = { camera: camera.camera, width: WIDTH, height: HEIGHT };

// Every label that exists is registered: a label nobody added is never drawn,
// so this is the control that the population being audited is the whole one.
{
  const registered = new Set(world.labels.states.map((state) => state.label));
  const expected: [string, readonly ManagedLabel[]][] = [
    ['the crowd', world.npcs.screenLabels],
    ['the hotel', world.hotel.screenLabels],
    ['the reptile house', world.reptileHouse.screenLabels],
    ['the library', world.library.screenLabels],
    // Named apart from `screenLabels`, so a bubble dropped from that list is missed here rather than
    // agreed with: the owl's speech (#718), whose bubble scene 5 watches fly to the story chair.
    ['the library owl', [world.library.owl.bubble]],
    ['the castle', world.building.screenLabels],
    ['the player', [player.label]],
    ['the chips', [chips]],
  ];
  for (const [who, labels] of expected) {
    const missing = labels.filter((label) => !registered.has(label));
    if (labels.length === 0 || missing.length > 0) {
      console.error(`check:labels: ${who}'s labels are not all registered (${missing.length} of ${labels.length} missing)`);
      process.exit(1);
    }
  }
}

// --- the instrument ---------------------------------------------------------------

const centre = new Vector3();
const worldScale = new Vector3();
const eye = new Vector3();
const forward = new Vector3();

/**
 * The drawn sprite's painted rectangle, measured independently of the manager:
 * its centre projected, and its size from the pinhole relation at its own
 * depth — pixels per metre = viewport height / (2 · depth · tan(fov/2)) —
 * rather than by projecting four corners along the camera's axes as the
 * manager does. (Not `IsoCamera.worldUnitsPerPixel`: the rig is perspective,
 * and that figure is only true at the focus — the first version of this
 * instrument used it and disagreed with the manager by 3 px off-focus.)
 */
function spriteRect(label: NameLabel | SpeechBubble | SpriteLabel, out: ScreenRect): void {
  const sprite = label.sprite;
  const lens = camera.camera;
  sprite.updateWorldMatrix(true, false);
  sprite.getWorldPosition(centre);
  sprite.getWorldScale(worldScale);
  lens.getWorldPosition(eye);
  lens.getWorldDirection(forward);
  const depth = centre.clone().sub(eye).dot(forward);
  const pxPerMetre = HEIGHT / (2 * depth * Math.tan(((lens.fov / 2) * Math.PI) / 180));
  centre.project(lens);
  const cx = (centre.x * 0.5 + 0.5) * WIDTH;
  const cy = (1 - (centre.y * 0.5 + 0.5)) * HEIGHT;
  const w = worldScale.x * pxPerMetre;
  const h = worldScale.y * pxPerMetre;
  const box: ContentBox = label.contentBox;
  out.left = cx + (box.x0 - 0.5) * w;
  out.right = cx + (box.x1 - 0.5) * w;
  out.top = cy + (box.y0 - 0.5) * h;
  out.bottom = cy + (box.y1 - 0.5) * h;
}

/** The chip row's rectangle, from the transform `ActionChips` wrote and the layout model. */
function chipRect(out: ScreenRect): void {
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(chipRoot!.style['transform'] ?? '');
  const { width, height } = chipRowModel();
  const x = Number(match?.[1] ?? NaN);
  const y = Number(match?.[2] ?? NaN);
  out.left = x - width / 2;
  out.right = x + width / 2;
  out.top = y - height;
  out.bottom = y;
}

function ancestorsVisible(sprite: { parent: { visible: boolean; parent: unknown } | null }): boolean {
  for (let node = sprite.parent; node; node = node.parent as typeof node) if (!node.visible) return false;
  return true;
}

function isDrawn(label: ManagedLabel): boolean {
  if (label === chips) return chipRoot!.dataset['show'] === 'true';
  const sprite = (label as NameLabel).sprite;
  return sprite.visible && ancestorsVisible(sprite as never);
}

function measure(label: ManagedLabel, out: ScreenRect): void {
  if (label === chips) chipRect(out);
  else spriteRect(label as NameLabel, out);
}

const name = (label: ManagedLabel): string => `${label.identity.id} [${label.identity.kind} over ${label.identity.item || '—'}]`;
const fmtRect = (r: ScreenRect): string =>
  `(${r.left.toFixed(0)},${r.top.toFixed(0)})–(${r.right.toFixed(0)},${r.bottom.toFixed(0)})`;

// --- the audit -----------------------------------------------------------------------

interface Track {
  drawn: boolean;
  /** Frames on which the drawn state last changed, newest last. */
  changes: number[];
  /** Frames on which it last wanted to be drawn without interruption since. */
  wantedSince: number;
  /** The last frame a drawn label at least as important touched it. */
  lastBlocked: number;
}
const tracks = new Map<ManagedLabel, Track>();

const failures = new Map<string, { count: number; first: string }>();
function fail(kind: string, detail: string): void {
  const entry = failures.get(kind);
  if (entry) entry.count += 1;
  else failures.set(kind, { count: 1, first: detail });
}

const coverage = {
  frames: 0,
  framesWithSeveral: 0,
  mostAtOnce: 0,
  overlapsPrevented: 0,
  ctaPutAwayForItsAction: 0,
  feedbackShownOverItsItem: 0,
  instrumentChecks: 0,
  scenes: new Map<string, number>(),
};

let frame = 0;
let scene_ = '';
const rects = new Map<ManagedLabel, ScreenRect>();

function audit(): void {
  coverage.frames += 1;
  coverage.scenes.set(scene_, (coverage.scenes.get(scene_) ?? 0) + 1);
  const states = world.labels.states;
  const drawn: ManagedLabel[] = [];
  for (const state of states) {
    const label = state.label;
    let rect = rects.get(label);
    if (!rect) rects.set(label, (rect = { left: 0, top: 0, right: 0, bottom: 0 }));
    if (isDrawn(label)) {
      drawn.push(label);
      measure(label, rect);
      // The control: this instrument and the manager judged the same rectangle.
      const theirs = state.rect;
      const off = Math.max(
        Math.abs(theirs.left - rect.left),
        Math.abs(theirs.right - rect.right),
        Math.abs(theirs.top - rect.top),
        Math.abs(theirs.bottom - rect.bottom),
      );
      coverage.instrumentChecks += 1;
      if (!(off <= 1)) {
        fail('instrument', `${name(label)} measured ${fmtRect(rect)} here and ${fmtRect(theirs)} by the manager, frame ${frame} (${scene_})`);
      }
    } else if (state.wanted) {
      rect.left = state.rect.left;
      rect.right = state.rect.right;
      rect.top = state.rect.top;
      rect.bottom = state.rect.bottom;
    }
  }
  if (drawn.length > 1) coverage.framesWithSeveral += 1;
  coverage.mostAtOnce = Math.max(coverage.mostAtOnce, drawn.length);

  // A — no two drawn labels overlap.
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const a = rects.get(drawn[i]!)!;
      const b = rects.get(drawn[j]!)!;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0 && w * h > OVERLAP_AREA_PX) {
        fail(
          'A overlap',
          `${name(drawn[i]!)} at ${fmtRect(a)} and ${name(drawn[j]!)} at ${fmtRect(b)} overlap by ` +
            `${w.toFixed(0)}x${h.toFixed(0)} px, frame ${frame} (${scene_})`,
        );
      }
    }
  }

  // B — one per item.
  const perItem = new Map<string, ManagedLabel[]>();
  for (const label of drawn) {
    const list = perItem.get(label.identity.item) ?? [];
    list.push(label);
    perItem.set(label.identity.item, list);
  }
  for (const [item, list] of perItem) {
    if (list.length > 1) {
      fail('B one per item', `${list.length} labels drawn over ${item}: ${list.map(name).join(', ')}, frame ${frame} (${scene_})`);
    }
  }

  // C — precedence, within an item and across the screen.
  const wantedByItem = new Map<string, ManagedLabel[]>();
  for (const state of states) {
    if (!state.wanted) continue;
    const list = wantedByItem.get(state.label.identity.item) ?? [];
    list.push(state.label);
    wantedByItem.set(state.label.identity.item, list);
  }
  const prec = (label: ManagedLabel): number => LABEL_PRECEDENCE[label.identity.kind];
  for (const [item, wanted] of wantedByItem) {
    const top = Math.max(...wanted.map(prec));
    const shown = wanted.find((label) => isDrawn(label));
    if (shown && prec(shown) < top) {
      fail('C precedence', `${name(shown)} is drawn over ${item} while a more important label of the same item wants to be, frame ${frame} (${scene_})`);
    }
    // Coverage: a call to action put away because its own action is answering.
    const cta = wanted.find((label) => label.identity.kind === 'callToAction');
    const answer = wanted.find((label) => label.identity.kind === 'actionFeedback');
    if (cta && answer && isDrawn(answer) && !isDrawn(cta)) coverage.ctaPutAwayForItsAction += 1;
    if (answer && isDrawn(answer)) coverage.feedbackShownOverItsItem += 1;
    for (const label of wanted) {
      if (prec(label) !== top || isDrawn(label)) continue;
      // A wanted, top-of-its-item label that is not drawn: something at least
      // as important must be in its way, now or within the hold — at the
      // margin if it was up last frame, or within the room it needs to come
      // up if it was not (`LABEL_ENTRY_CUSHION_PX`: rule 3 on the way up).
      const track = tracks.get(label);
      const mine = rects.get(label)!;
      const room = track?.drawn ? LABEL_MARGIN_PX : LABEL_MARGIN_PX + LABEL_ENTRY_CUSHION_PX;
      const blocker = drawn.find((other) => prec(other) >= prec(label) && rectsTouch(mine, rects.get(other)!, room));
      if (blocker) {
        coverage.overlapsPrevented += 1;
        if (track) track.lastBlocked = frame;
        continue;
      }
      if (shown && shown !== label) continue; // an equal of the same item is up instead
      const since = track ? frame - track.lastBlocked : Infinity;
      if (since <= HOLD_FRAMES + 1) continue; // the hold
      const lesser = drawn.find((other) => rectsTouch(mine, rects.get(other)!, LABEL_MARGIN_PX));
      fail(
        'C precedence',
        lesser
          ? `${name(label)} at ${fmtRect(mine)} is hidden under ${name(lesser)}, which is less important, frame ${frame} (${scene_})`
          : `${name(label)} at ${fmtRect(mine)} wants to be drawn, nothing is in its way, and it is hidden, frame ${frame} (${scene_})`,
      );
    }
  }

  // D — no flicker.
  for (const state of states) {
    const label = state.label;
    let track = tracks.get(label);
    const now = isDrawn(label);
    if (!track) {
      track = { drawn: now, changes: [], wantedSince: state.wanted ? frame : Infinity, lastBlocked: -Infinity };
      tracks.set(label, track);
      continue;
    }
    if (!state.wanted) track.wantedSince = Infinity;
    else if (track.wantedSince === Infinity) track.wantedSince = frame;
    if (now !== track.drawn) {
      track.drawn = now;
      track.changes.push(frame);
      if (track.changes.length > 2) track.changes.shift();
      const [before, after] = track.changes;
      // A cause, for going down: its own item has something more important
      // to say, or something strictly more important has just arrived on top
      // of it. Coming back up never has one inside the hold — that is the hold.
      const mine = rects.get(label)!;
      const caused =
        !now &&
        (state.verdict === 'item' ||
          drawn.some((other) => prec(other) > prec(label) && rectsTouch(mine, rects.get(other)!, LABEL_MARGIN_PX)));
      if (
        before !== undefined &&
        after !== undefined &&
        after - before < HOLD_FRAMES &&
        track.wantedSince <= before - 1 &&
        !caused
      ) {
        fail(
          'D flicker',
          `${name(label)} went ${now ? 'down and back up' : 'up and back down'} ${after - before} frame(s) apart ` +
            `while wanting to be drawn throughout, frame ${frame} (${scene_})`,
        );
      }
    }
  }
}

// --- driving -----------------------------------------------------------------------------

const velocity = new Vector3();
function step(): void {
  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition: player.position,
    cameraForward: new Vector3(0, 0, 1),
    frame,
  };
  quietly(() => {
    player.update(context);
    const glanceClaim = bookGlance.apply(camera, player);
    if (glanceClaim) camera.setFocusOverride(glanceClaim);
    else camera.clearFocusOverride();
    if (bookGlance.active) glanceFrames += 1;
    camera.update(context, player.position, velocity);
    world.update(context);
    selection.update(context);
    chips.update(context);
  });
  world.labels.resolve(view, DT);
  audit();
  if (bookGlance.active && isDrawn(chips)) glanceChipFrames += 1;
  frame += 1;
}

function stand(x: number, z: number, y?: number): void {
  if (y === undefined) player.teleport(x, z);
  else player.teleportTo(x, y, z);
  camera.snapTo(player.position);
}

function run(seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i += 1) step();
}

/** Stand at a zone, let the selection settle on it, and — if asked — press its chip. */
function visit(zone: InteractZone, press: boolean, seconds: number): boolean {
  stand(zone.standX, zone.standZ, player.position.y);
  player.teleport(zone.standX, zone.standZ);
  camera.snapTo(player.position);
  run(0.4);
  const chosen = selection.selected?.id === zone.id;
  if (press && chosen) {
    const action = selection.actions.find((a) => a.id === PRIMARY_ACTION) ?? selection.actions[0];
    if (action) quietly(() => selection.commit(action));
  }
  run(seconds);
  return chosen;
}

const started = performance.now();

// 1 — the plaza: in from the gate to the middle and back, through the crowd.
scene_ = 'plaza';
{
  const walkSeconds = 50;
  for (let i = 0; i < walkSeconds / DT; i += 1) {
    const t = (i * DT * 2 * Math.PI) / walkSeconds;
    const sweep = (1 - Math.cos(t)) / 2;
    const x = ENTRANCE_PLAYER_X * (1 - sweep) + Math.cos(t * 3) * 6;
    const z = ENTRANCE_PLAYER_Z * (1 - sweep) + Math.sin(t * 3) * 6;
    player.teleport(x, z);
    step();
  }
  // And a stop at each of the garden's things nearest the middle, chips up.
  const garden = world
    .interactZones()
    .filter((zone) => spaceAt(zone.x, zone.z) === SPACE_GARDEN && (zone.actions?.().length ?? 0) > 0)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    .slice(0, 6);
  for (const zone of garden) visit(zone, false, 3);
}

// 2 — the castle shops (from the garden: the castle's own door sequence), ground floor, with their shoppers.
scene_ = 'castle shops';
let shopsVisited = 0;
{
  quietly(() => world.building.enterCastleSpawn(0));
  run(1);
  const shops = world.building.interactZones().filter((zone) => zone.id.startsWith('shop'));
  if (process.env['LABELS_DEBUG']) {
    process.stderr.write(`castle: player at ${player.position.x.toFixed(1)},${player.position.z.toFixed(1)} (${spaceAt(player.position.x, player.position.z)}); zones ${world.building.interactZones().map((z) => z.id).join(' ')}\n`);
  }
  for (const zone of shops) if (visit(zone, false, 2.5)) shopsVisited += 1;
}

// 3 — the hotel lobby: check in, and let her talk.
scene_ = 'hotel lobby';
let receptionTalked = false;
{
  quietly(() => world.hotel.requestEnterLobby());
  run(1);
  const desk = world.hotel.interactZones().find((zone) => zone.id === 'hotel-reception');
  if (desk && spaceAt(desk.x, desk.z) === SPACE_HOTEL_LOBBY) {
    visit(desk, true, 6);
    visit(desk, true, 4);
    receptionTalked = true;
  }
}

// 4 — the Reptile House: every chip pressed, every answer watched.
scene_ = 'reptile house';
let reptileVisited = 0;
{
  quietly(() => world.reptileHouse.requestEnter());
  run(1);
  const zones = world.reptileHouse
    .interactZones()
    .filter((zone) => spaceAt(zone.x, zone.z) === SPACE_REPTILE_HOUSE && zone.id.startsWith('reptile:'));
  for (const zone of zones) if (visit(zone, true, 3)) reptileVisited += 1;
  // Everything once more, quickly, now that the first-hello blurbs are spent —
  // the short reactions ("peep!") against chips that stay put.
  for (const zone of zones) visit(zone, true, 1.2);
}

// 5 — the Library (#718): the owl hands over her card and recommends a book, a shelf book's chip is up,
// and story time is called with her sat on her story cushion — the owl calls from her desk, flies over the
// stacks silent, and reads from the big chair over the rug, while the cushion's 'Get up' chip is up below it.
scene_ = 'library';
let owlSelected = 0;
let cardGiven = false;
let recommended = false;
let libraryRead = false;
let seatedForStory = false;
let storyFrames = 0;
let readingFrames = 0;
/** While the owl reads: the frames her bubble was drawn, the cushion's Get up chip was, and both at once. */
let readingBubbleFrames = 0;
let readingChipFrames = 0;
let readingBothFrames = 0;
/** The call, said from her desk before she flies: the frames she spoke it, and the frames her bubble was drawn. */
let callSpeakingFrames = 0;
let callBubbleFrames = 0;
/** The frames she spoke on the wing — none: her flights are silent (`storyTime.ts`). */
let wingSpeakingFrames = 0;
{
  // The Reptile House's last press may have left her on its tortoise: off it first, as a tap would.
  if (player.riding) quietly(() => player.rideHolder?.letGo());
  run(0.5);
  const entered = quietly(() => world.library.requestEnter());
  run(1);
  if (!entered || !world.library.playerIsInside) fail('E coverage', `the library scene could not enter the reading room (requestEnter ${entered}, riding ${player.riding}, in '${spaceAt(player.position.x, player.position.z)}')`);
  const zones = world.library.interactZones().filter((zone) => spaceAt(zone.x, zone.z) === SPACE_LIBRARY);
  const owl = zones.find((zone) => zone.id === OWL_ZONE_ID);
  const firstRead = zones.find((zone) => zone.id.startsWith('library-book:'));
  const cushion = zones.find((zone) => zone.id.startsWith('library-sit:'));
  if (owl) {
    // Each visit is asked what it was for, not only whether her chip was up: a press mid-script does
    // nothing, so the card's visit lasts as long as her four card lines take to say (`lineSeconds`, the
    // one owner of a line's hold) — at 10 s the next press landed mid-ceremony and recommended nothing.
    const cardScript = LIBRARY_LINES.owl.card.reduce((sum, line) => sum + lineSeconds(line), 0);
    if (visit(owl, true, cardScript + 0.5)) owlSelected += 1; // her card
    cardGiven = hasLibraryCard(gameStore.get());
    // The recommendation, to its last line and the camera home after it: while the owl names her book and
    // says it is glowing, the camera draws back to show it (`bookGlance.ts`), so the whole glance is laid out.
    if (visit(owl, true, 0.5)) owlSelected += 1; // a book recommended
    const pick = world.library.owl.recommendedBookId;
    const naming = pick === null ? null : LIBRARY_LINES.owl.recommend(bookById(pick)?.title ?? '');
    for (let i = 0; i < Math.round(20 / DT) && world.library.owl.speaking; i += 1) {
      step();
      if (naming !== null && world.library.owl.speaking && world.library.owl.lastSaid === naming) {
        namingFrames += 1;
        if (isDrawn(world.library.owl.bubble)) namingDrawnFrames += 1;
      }
    }
    run(2);
    recommended = world.library.owl.recommendedBookId !== null;
  }
  if (firstRead) libraryRead = visit(firstRead, false, 3);
  // Story time, called with her at the owl's desk — the owl says the call there, before she flies, so it
  // is in shot — and then, while the owl flies over the stacks, on to her cushion to sit through the
  // gathering and the first of the reading.
  const owlNow = world.library.owl;
  /** One frame of story time, counted: what this scene is for, measured, not assumed. */
  const storyFrame = (): void => {
    step();
    if (world.library.storyPhase !== 'idle') storyFrames += 1;
    const bubbleUp = isDrawn(owlNow.bubble);
    if (world.library.storyPhase === 'reading') {
      readingFrames += 1;
      const chipUp = cushion !== undefined && isDrawn(chips) && selection.selected?.id === cushion.id;
      if (bubbleUp) readingBubbleFrames += 1;
      if (chipUp) readingChipFrames += 1;
      if (bubbleUp && chipUp) readingBothFrames += 1;
    }
    if (world.library.storyPhase === 'gathering' && owlNow.atDesk && owlNow.speaking) {
      callSpeakingFrames += 1;
      if (bubbleUp) callBubbleFrames += 1;
    }
    if (owlNow.flying && owlNow.speaking) wingSpeakingFrames += 1;
  };
  if (owl) visit(owl, false, 0.2);
  quietly(() => world.library.requestStoryTime());
  // At the desk until she takes off (whatever she was saying is finished first, then the call).
  for (let i = 0; i < Math.round(20 / DT) && !owlNow.flying; i += 1) storyFrame();
  if (cushion) {
    visit(cushion, true, 0.5);
    seatedForStory = world.library.playerIsSeated;
  }
  for (let i = 0; i < Math.round(30 / DT); i += 1) storyFrame();
  quietly(() => world.library.standUp());
  run(0.5);
}

// --- the verdict ---------------------------------------------------------------------------

const seconds = ((performance.now() - started) / 1000).toFixed(1);
process.stderr.write(
  `check:labels — ${coverage.frames} frames at ${WIDTH}x${HEIGHT} in ${seconds} s` +
    `${MUTATE ? ` (LABELS_MUTATE=${MUTATE})` : ''}: ` +
    [...coverage.scenes].map(([s, n]) => `${s} ${n}`).join(', ') +
    `.\n  ${world.labels.states.length} labels registered; up to ${coverage.mostAtOnce} drawn at once; ` +
    `${coverage.framesWithSeveral} frames with two or more up.\n` +
    `  ${coverage.overlapsPrevented} label-frames held back by a more important neighbour; ` +
    `${coverage.ctaPutAwayForItsAction} frames a call to action was put away for its own action's answer; ` +
    `${coverage.feedbackShownOverItsItem} frames an answer was up over its item.\n` +
    `  Reptile House: ${reptileVisited} chips pressed; castle: ${shopsVisited} shop counters; ` +
    `hotel: receptionist ${receptionTalked ? 'talked' : 'NOT reached'}; ` +
    `library: the owl selected ${owlSelected} of 2 visits (her card ${cardGiven ? 'handed over' : 'NOT handed over'}, a book ${recommended ? 'recommended' : 'NOT recommended'}), ` +
    `a shelf book's chip ${libraryRead ? 'up' : 'NOT up'}, story time on ${storyFrames} frames (${readingFrames} reading) with her ${seatedForStory ? 'sat on her cushion' : 'NOT seated'}: ` +
    `while the owl read, her bubble drawn on ${readingBubbleFrames}, the cushion's Get up chip on ${readingChipFrames}, both on ${readingBothFrames}; ` +
    `her call drawn on ${callBubbleFrames} of the ${callSpeakingFrames} frames she said it at her desk; she spoke on ${wingSpeakingFrames} frames on the wing; ` +
    `the owl's glance at her book held the camera on ${glanceFrames} frames, a chip drawn on ${glanceChipFrames} of them; ` +
    `the line naming her book drawn on ${namingDrawnFrames} of the ${namingFrames} frames she said it. ` +
    `${coverage.instrumentChecks} drawn rectangles measured twice.\n` +
    `  The chip row's size is a layout model (Node has no layout) — see chipRowModel.\n`,
);

const coverageGaps: string[] = [];
if (coverage.framesWithSeveral < 600) coverageGaps.push(`only ${coverage.framesWithSeveral} frames had two or more labels up`);
if (coverage.overlapsPrevented < 50) coverageGaps.push(`only ${coverage.overlapsPrevented} label-frames were held back by a neighbour`);
if (coverage.ctaPutAwayForItsAction < 60) {
  coverageGaps.push(`a call to action was put away for its own action's answer on only ${coverage.ctaPutAwayForItsAction} frames`);
}
if (reptileVisited < 10) coverageGaps.push(`only ${reptileVisited} Reptile House chips were pressed`);
if (shopsVisited < 3) coverageGaps.push(`only ${shopsVisited} castle shop counters were stood at`);
if (!receptionTalked) coverageGaps.push('the hotel reception was never reached');
if (owlSelected < 2) coverageGaps.push(`the library owl was selected on only ${owlSelected} of her 2 visits`);
if (!cardGiven) coverageGaps.push('the library owl never handed over her card');
if (!recommended) coverageGaps.push('the library owl never recommended a book');
if (glanceFrames === 0) coverageGaps.push("the owl's glance at the book she recommended never took the camera, so no label was laid out under it");
if (namingFrames === 0) coverageGaps.push('the owl never said the line naming the book she recommended, so whether it can be read was never asked');
if (namingDrawnFrames < namingFrames) {
  fail(
    'F the owl\'s words',
    `the line naming the book she recommends was drawn on only ${namingDrawnFrames} of the ${namingFrames} frames she said it — every one wanted: ` +
      'a child who cannot read the title never learns which book the owl meant (the glance must not take her bubble while she names it)',
  );
}
if (glanceChipFrames > 0) {
  fail(
    'C precedence',
    `a chip was drawn on ${glanceChipFrames} of the ${glanceFrames} frames the owl's glance held the camera — the owl is mid-script and nothing may be selected then ` +
      `(Game.selectionBlocked), and her "Say hello!" would be a press that does nothing`,
  );
}
if (!libraryRead) coverageGaps.push("no library shelf book's chip was ever up");
if (!seatedForStory) coverageGaps.push('she never sat on a story cushion for story time');
if (storyFrames === 0) coverageGaps.push('library story time never ran');
if (readingFrames === 0) coverageGaps.push('library story time never reached its reading');
if (readingBubbleFrames === 0) coverageGaps.push("the library owl's bubble was never drawn while she read the story");
if (readingChipFrames === 0) coverageGaps.push("the story cushion's Get up chip was never drawn while the owl read");
if (readingBothFrames === 0) coverageGaps.push("the owl's bubble and the cushion's Get up chip were never drawn together while she read");
if (callBubbleFrames === 0) coverageGaps.push(`the owl's bubble was never drawn while she called story time from her desk (${callSpeakingFrames} frames she said it)`);
for (const gap of coverageGaps) fail('E coverage', `${gap} — the assertions above would be vacuous`);

if (failures.size > 0) {
  console.error('\nEvery label over the world must be the only one over its item, clear of every other, and steady.\n');
  for (const [kind, { count, first }] of failures) console.error(`  FAIL  ${kind}: ${count} occasion(s). First: ${first}`);
  console.error('');
  process.exit(1);
}
console.log(
  `No two of the ${coverage.mostAtOnce}-at-most labels on screen overlapped in ${coverage.frames} frames, ` +
    'each item showed one label at most, the more important always won, and nothing flickered.',
);
