import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../core/palette';
import { Rng } from '../core/mathUtils';
import { signTexture } from '../core/textures';
import { ART } from '../art/style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../art/style/materials';
import { blob, stub } from '../art/style/asset';
import { createFacePatch } from '../art/style/faces';
import {
  createFacePaintOverlay,
  FACE_PAINT_DESIGNS,
  type FacePaintDesign,
  type FacePaintOverlayHandle,
} from '../art/style/faces';
import { collectSignZones, markAsSign, type SignZone } from './signs';
import type { InteractZone } from './interact';
import { highlightObject } from './highlight';
import { terrainHeight } from './terrain';
import type { CollisionWorld } from './Collision';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { gameStore, type FacePaintId } from '../state';
import { playOpenChime, playSurpriseChime } from '../ui/chime';
import { FacePaintPanel } from '../ui/FacePaintPanel';
import { paintedNpcFaces, registerFacePaintStall } from '../entities/npc/wanderDriver';

/**
 * The face-painting stall — a striped booth in the garden where the player
 * (and, occasionally, a passing child) gets a cute design painted on.
 *
 * FILE OWNERSHIP (parallel PRs in flight — see the handoff note this PR
 * shipped with): this file, the additive face-paint section at the bottom of
 * `art/style/faces.ts`, `ui/FacePaintPanel.ts`, one wiring block in
 * `World.ts`, one additive block in `entities/npc/wanderDriver.ts`, and the
 * additive `PlayerState.facePaint` field. Nothing else.
 *
 * This is deliberately NOT a mini-game (contrast `minigames/stallProp.ts` +
 * `stalls.ts`, which this file borrows *placement conventions* from — facing
 * the counter down +Z, staying clear of anchor plots, a straight-line stand
 * point — but not one line of code, since importing from `minigames/` into
 * `world/` would be a backwards layering dependency). Walking up / tapping
 * opens a small HUD picker right here in the park; there is no separate
 * world to wipe to.
 *
 * See `paintOverlay` below for how a design ends up on the player's actual
 * face, and the additive block in `wanderDriver.ts` for how a background
 * child gets one too.
 */

// ---------------------------------------------------------------- placement

/**
 * On the lawn west of the fountain plaza, mirroring the rail racer stall's own
 * placement across the X axis (`minigames/stalls.ts`'s `STALLS[0].position`,
 * `[9.8, -4.8]`) — same distance from the plaza, opposite side, so the two
 * stalls read as a matched pair of fairground booths rather than one being an
 * afterthought. Checked against `world/anchors.ts` (nearest plot, `ballPit` at
 * `[-9, -15]`, is over 10 m away) and the hand-authored wall runs in
 * `Scenery.ts` (nearest, the `[-10, 2]`–`[-4, 1]` wood run, is ~6.8 m away).
 * Confirmed clear by eye in the running game (see PROGRESS-FACEPAINT.md).
 */
const STALL_X = -9.8;
const STALL_Z = -4.8;
/**
 * A shade east of +Z, same as the rail racer's own `+0.3` — counter faces the
 * default camera. The *position* mirrors the rail racer's across the X axis,
 * but the facing must not: the camera angle is one fixed absolute direction
 * everywhere on the map (GAME_DESIGN.md #16, ARCHITECTURE.md "One camera
 * angle, forever"), not something relative to which side of the plaza a stall
 * stands on. An earlier version of this constant mirrored the sign to `-0.3`
 * along with the position, which quietly turned the counter away from the
 * camera.
 */
const STALL_FACING = 0.3;

const STALL_WIDTH = 3.1;
const STALL_DEPTH = 2.1;
/** How far in front of the counter a child (or the player) stands to be served. */
const STAND_DISTANCE = 2.3;
/** How close counts as "at the stall" for the proximity/interact check. */
const REACH = 3.2;

// ------------------------------------------------------------- player paint

/**
 * Mirrors constants from `art/models/kid.ts` (`HEAD = 1.5`, `HEAD_TILT =
 * 0.17`, `skullR = 0.44 × HEAD`). Duplicated rather than imported: this PR's
 * file ownership excludes `kid.ts` (see the note at the top of this file),
 * and the kid model doesn't currently export them. If the head is ever
 * retuned, this needs a matching update — the same trade-off `poiGraph.ts`
 * already documents for its own duplicated ring-road coordinates.
 */
const PLAYER_HEAD_TILT = 0.17;
const PLAYER_SKULL_RADIUS = 0.44 * 1.5;
/** Matches `face.mesh.scale` in `kid.ts`. */
const PLAYER_FACE_SQUASH: readonly [number, number, number] = [1, 0.95, 0.98];

// ---------------------------------------------------------------- npc paint

/**
 * How many background children may show a paint decal at once. Matches
 * `MAX_CONCURRENT_PAINTED` in `wanderDriver.ts`'s additive block — see the
 * comment there for why the two numbers have to agree.
 */
const NPC_DECAL_POOL = 4;
/** Generic skull radius for the decal's curvature — nobody stands close enough to notice it's approximate. */
const NPC_DECAL_RADIUS = 0.6;
/** Rough head height above the feet for an average-scaled background child. */
const NPC_HEAD_OFFSET = 1.3;

/** How long the world-side cutscene (painter leans in, sparkles) lasts. */
const PAINTING_DURATION = 1.6;
const SPARKLE_COUNT = 7;

export class FacePaintStall implements GameSystem {
  readonly name = 'facePaintStall';
  readonly group = new Group();

  private readonly standX: number;
  private readonly standZ: number;

  private panel: FacePaintPanel | null = null;
  private readonly sparkles: Mesh[] = [];
  private readonly sparkleBase: { angle: number; radius: number; rise: number }[] = [];
  private readonly sparkleRng = new Rng(0xface9a17);

  private readonly npcDecals: FacePaintOverlayHandle[] = [];

  private readonly painterUpper: Group;
  /**
   * `FrameContext.elapsed` as of the last frame. Kept because the DOM click
   * handlers (`pickDesign`) fire between frames and still need the clock.
   */
  private frameElapsed = 0;

  private player: Player | null = null;
  private playerOverlay: FacePaintOverlayHandle | null = null;

  /**
   * `frameElapsed` when the painting moment began, or `null` when nobody is
   * mid-paint.
   *
   * Deliberately an *absolute* stamp on `FrameContext.elapsed` rather than an
   * accumulator fed by `dt`. This cutscene is the one thing in the park that
   * runs **while the park is paused** — and it is paused by this very object
   * (`syncPaused`), which means `Game` has already zeroed `frameContext.dt`
   * by the time `update` is called. An accumulator therefore never advances,
   * the cutscene never ends, and the park stays paused forever with no way
   * out. (This was the shipped face-paint freeze.) `elapsed` keeps running at
   * real speed through a pause on purpose — see `Game.update` — so it is the
   * only clock here that works. `MiniGameHost` sidesteps the same trap by
   * taking the loop's raw delta; see the comment above its `update` call.
   */
  private paintingStartedAt: number | null = null;
  private wasPausedByUs = false;

  private hint: HTMLElement | null = null;

  constructor(collision: CollisionWorld) {
    this.group.name = 'facePaintStall';

    const ground = terrainHeight(STALL_X, STALL_Z);
    this.group.position.set(STALL_X, ground, STALL_Z);
    this.group.rotation.y = STALL_FACING;

    const forwardX = Math.sin(STALL_FACING);
    const forwardZ = Math.cos(STALL_FACING);
    this.standX = STALL_X + forwardX * STAND_DISTANCE;
    this.standZ = STALL_Z + forwardZ * STAND_DISTANCE;

    this.painterUpper = this.buildBooth();
    this.buildCollision(collision);
    addNpcDecalPoolInto(this.group, this.npcDecals);
    this.buildSparklePool();

    registerFacePaintStall(STALL_X, STALL_Z, this.standX, this.standZ);
  }

  /**
   * Builds the stall's HUD (the picker panel and the proximity hint) into the
   * overlay root.
   *
   * **Not done in the constructor**, and this is load-bearing: `Hud`'s own
   * constructor starts with `uiRoot.innerHTML = ''`, and `World` — and so this
   * stall — is built well before the HUD is (see `Game`'s constructor, which
   * spells the rule out: everything that puts DOM in the overlay has to come
   * after the HUD). Appending from here meant the panel and hint were wiped
   * out of the document a few lines later, so pressing interact at the stall
   * paused the park and then showed absolutely nothing. Called by
   * `World.mountUi`, from `Game`, at the right moment.
   *
   * Until it is called the stall is simply inert: it stands there and can be
   * walked around, but cannot be used.
   */
  mountUi(uiRoot: HTMLElement): void {
    if (this.panel) return;
    this.panel = new FacePaintPanel(uiRoot, {
      onPick: (design) => this.pickDesign(design),
      onWashOff: () => this.washOff(),
      onClose: () => this.closePanel(),
    });
    this.hint = buildHint(uiRoot);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True while the picker or the painting moment owns the screen. Mirrors `Shopping.uiOpen`. */
  get uiOpen(): boolean {
    return (this.panel?.isOpen ?? false) || this.paintingStartedAt !== null;
  }

  /** Gives the stall the player, and puts the overlay mesh on their actual head. */
  attachPlayer(player: Player): void {
    this.player = player;

    const tilt = new Group();
    tilt.name = 'facePaintTilt';
    tilt.rotation.x = -PLAYER_HEAD_TILT;
    player.model.head.add(tilt);

    const overlay = createFacePaintOverlay(PLAYER_SKULL_RADIUS, { size: 512 });
    overlay.mesh.scale.set(...PLAYER_FACE_SQUASH);
    tilt.add(overlay.mesh);
    this.playerOverlay = overlay;

    const saved = gameStore.get().player.facePaint;
    overlay.setDesign(isFacePaintDesign(saved) ? saved : null);
  }

  interactZones(): InteractZone[] {
    return [
      {
        id: 'stall:facePaint',
        label: 'Face Painting!',
        x: STALL_X,
        y: terrainHeight(STALL_X, STALL_Z),
        z: STALL_Z,
        pickRadius: REACH,
        standX: this.standX,
        standZ: this.standZ,
        pressInteract: true,
        // GAME_DESIGN.md's HIGHLIGHT RULE: the booth itself outlines in
        // rainbow when it is about to be used (see `world/highlight.ts`).
        highlight: highlightObject(this.group),
      },
    ];
  }

  signZones(): SignZone[] {
    return collectSignZones(this.group);
  }

  update(context: FrameContext): void {
    const { elapsed, input } = context;
    this.frameElapsed = elapsed;

    // A gentle idle sway on the painter, whether or not anyone is nearby —
    // the same "nothing is ever quite still" rule the stall sign/awning
    // follow everywhere else in the park.
    this.painterUpper.rotation.z = Math.sin(elapsed * 1.4) * 0.05;
    this.painterUpper.rotation.x = Math.sin(elapsed * 0.9) * 0.02;

    this.updateNpcDecals();
    this.updatePaintingCutscene(elapsed);
    this.syncPaused();

    const panel = this.panel;
    if (!this.player || !panel) return;

    const dx = context.playerPosition.x - this.standX;
    const dz = context.playerPosition.z - this.standZ;
    const inRange = Math.hypot(dx, dz) <= REACH;
    const busy = this.uiOpen;

    setHintVisible(this.hint, inRange && !busy);

    if (panel.isOpen) {
      if (input.justPressed('menu') || input.justPressed('cancel')) this.closePanel();
      return;
    }

    if (inRange && !busy && input.justPressed('interact') && !this.player.riding) {
      this.openPanel();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.panel?.dispose();
    this.hint?.remove();
    disposeGroup(this.group);
  }

  // -------------------------------------------------------------- internals

  /**
   * Keys for the open picker.
   *
   * A DOM listener rather than the `InputSystem`, for the same reason
   * `Shopping` uses one: the panel wants the *keys* (which design, which
   * direction), not the game's action vocabulary. It only ever acts while the
   * picker is open, so ordinary play is untouched. `FacePaintPanel.handleKey`
   * was written for this and had nothing calling it.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const panel = this.panel;
    if (!panel?.isOpen) return;
    if (panel.handleKey(event.code)) event.preventDefault();
  };

  private openPanel(): void {
    const current = gameStore.get().player.facePaint;
    this.panel?.openWith(isFacePaintDesign(current) ? current : null);
    playOpenChime();
  }

  private closePanel(): void {
    this.panel?.close();
  }

  private pickDesign(design: FacePaintDesign): void {
    const panel = this.panel;
    if (!panel) return;
    this.paintingStartedAt = this.frameElapsed;
    this.spawnSparkles();
    panel.showPaintingMoment(design, () => this.finishPainting(design));
  }

  private finishPainting(design: FacePaintDesign): void {
    gameStore.setFacePaint(design);
    this.playerOverlay?.setDesign(design);
    this.panel?.setWearing(design);
    playSurpriseChime();
  }

  private washOff(): void {
    gameStore.setFacePaint(null);
    this.playerOverlay?.setDesign(null);
    this.panel?.close();
    playOpenChime();
  }

  /**
   * Painter leans in over the counter and a few sparkles rise, in world space.
   *
   * Driven off the absolute `elapsed` clock (see `paintingStartedAt`), so it
   * still finishes while the park is paused — which it always is, because this
   * object pauses it.
   */
  private updatePaintingCutscene(elapsed: number): void {
    const startedAt = this.paintingStartedAt;
    if (startedAt === null) return;

    const t = Math.min(1, (elapsed - startedAt) / PAINTING_DURATION);
    // Ease in, hold, ease out: lean forward for the first half, back for the second.
    const lean = t < 0.5 ? t * 2 : (1 - t) * 2;
    this.painterUpper.rotation.x = Math.sin(elapsed * 0.9) * 0.02 + lean * 0.4;
    this.painterUpper.position.z = lean * 0.22;

    for (let i = 0; i < this.sparkles.length; i += 1) {
      const sparkle = this.sparkles[i];
      const base = this.sparkleBase[i];
      if (!sparkle || !base) continue;
      const phase = Math.min(1, t + i * 0.05);
      const rise = phase * base.rise;
      const fade = Math.sin(phase * Math.PI);
      sparkle.visible = fade > 0.02;
      sparkle.position.set(Math.cos(base.angle) * base.radius, 1.55 + rise, Math.sin(base.angle) * base.radius);
      sparkle.scale.setScalar(0.4 + fade * 0.9);
      sparkle.rotation.y = elapsed * 3 + base.angle;
      const material = sparkle.material as MeshBasicMaterial;
      material.opacity = fade;
    }

    if (t >= 1) {
      this.paintingStartedAt = null;
      this.painterUpper.position.z = 0;
      for (const sparkle of this.sparkles) sparkle.visible = false;
    }
  }

  /**
   * Positions the small pool of painted-NPC decals from `wanderDriver.ts`'s
   * registry.
   *
   * The decals hang off `this.group`, which is not just translated to the
   * booth but **turned** (`rotation.y = STALL_FACING`), so a painted child's
   * world position has to come back through that rotation as well as the
   * offset — `stallToLocal`. Subtracting the group's position alone left every
   * decal swung a few degrees around the booth: harmless next to the counter,
   * but metres adrift for a child painted earlier who has since wandered off
   * across the park, which is where they spend nearly all their time. The yaw
   * needs the same treatment, or the decal faces `STALL_FACING` away from the
   * child it belongs to.
   */
  private updateNpcDecals(): void {
    const faces = paintedNpcFaces();
    for (let i = 0; i < this.npcDecals.length; i += 1) {
      const slot = this.npcDecals[i];
      const face = faces[i];
      if (!slot) continue;
      if (!face) {
        slot.mesh.visible = false;
        continue;
      }
      const groundY = terrainHeight(face.x, face.z);
      const [localX, localZ] = stallToLocal(face.x, face.z);
      slot.mesh.position.set(localX, groundY + NPC_HEAD_OFFSET - this.group.position.y, localZ);
      slot.mesh.rotation.set(0, face.yaw - STALL_FACING, 0);
      slot.setDesign(face.design);
    }
  }

  /** Mirrors `Shopping.syncPaused` — re-derived from `uiOpen` every frame. */
  private syncPaused(): void {
    const { uiOpen } = this;
    if (uiOpen) {
      if (!gameStore.get().paused) {
        this.wasPausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.wasPausedByUs) {
      this.wasPausedByUs = false;
      gameStore.setPaused(false);
    }
  }

  private spawnSparkles(): void {
    for (let i = 0; i < this.sparkleBase.length; i += 1) {
      this.sparkleBase[i] = {
        angle: this.sparkleRng.range(0, Math.PI * 2),
        radius: this.sparkleRng.range(0.18, 0.42),
        rise: this.sparkleRng.range(0.35, 0.6),
      };
    }
  }

  private buildSparklePool(): void {
    const material = new MeshBasicMaterial({
      color: PALETTE.markerLemon,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (let i = 0; i < SPARKLE_COUNT; i += 1) {
      const sparkle = decal(new Mesh(new OctahedronGeometry(0.07, 0), material.clone()));
      sparkle.visible = false;
      sparkle.renderOrder = 5;
      // Parented to the booth's group but positioned in world space each
      // frame relative to the player — see `updatePaintingCutscene`. Cheaper
      // than re-parenting to the player for a two-second effect.
      this.group.add(sparkle);
      this.sparkles.push(sparkle);
      this.sparkleBase.push({ angle: 0, radius: 0.3, rise: 0.4 });
    }
  }

  /** Builds the booth prop. Returns the painter's upper body (for the sway/lean animation). */
  private buildBooth(): Group {
    const halfWidth = STALL_WIDTH / 2;

    const creamMaterial = toonMaterial(PALETTE.buildingWall);
    const woodMaterial = toonMaterial(PALETTE.wood);
    const stripeAMaterial = toonMaterial(PALETTE.markerPink);
    const stripeBMaterial = toonMaterial(ART.miniLilac);
    const boardMaterial = toonMaterial(PALETTE.woodLight);

    // --- back wall + counter -------------------------------------------------
    const back = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH, 1.9, 0.14, 3, 0.06), creamMaterial));
    back.position.set(0, 0.95, -0.85);
    this.group.add(back);
    addOutline(back, 0.016);

    const counter = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.3, 0.85, 0.55, 4, 0.08), woodMaterial));
    counter.position.set(0, 0.42, 0.75);
    this.group.add(counter);
    addOutline(counter, 0.016);

    const counterTop = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.1, 0.1, 0.7, 3, 0.05), boardMaterial));
    counterTop.position.set(0, 0.86, 0.75);
    this.group.add(counterTop);

    // --- corner posts, candy-striped ------------------------------------------
    const postHeight = 2.35;
    for (const side of [-1, 1] as const) {
      const post = solid(new Mesh(new CylinderGeometry(0.09, 0.1, postHeight, 10), creamMaterial));
      post.position.set(side * (halfWidth - 0.1), postHeight / 2, 0.9);
      this.group.add(post);
      addOutline(post, 0.012);

      for (let i = 0; i < 4; i += 1) {
        const ring = decal(
          new Mesh(new TorusGeometry(0.105, 0.032, 6, 12), i % 2 === 0 ? stripeAMaterial : stripeBMaterial),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(side * (halfWidth - 0.1), 0.3 + i * 0.5, 0.9);
        this.group.add(ring);
      }

      const knob = solid(new Mesh(new SphereGeometry(0.12, 12, 9), stripeAMaterial));
      knob.position.set(side * (halfWidth - 0.1), postHeight + 0.06, 0.9);
      this.group.add(knob);
    }

    // --- striped awning --------------------------------------------------------
    const awning = new Group();
    awning.position.set(0, 2.28, -0.05);
    awning.rotation.x = -0.2;
    this.group.add(awning);

    const stripes = 7;
    const stripeWidth = STALL_WIDTH / stripes;
    const awningDepth = STALL_DEPTH * 0.8;
    for (let i = 0; i < stripes; i += 1) {
      const x = -halfWidth + (i + 0.5) * stripeWidth;
      const material = i % 2 === 0 ? stripeAMaterial : stripeBMaterial;
      const cloth = solid(new Mesh(new RoundedBoxGeometry(stripeWidth, 0.09, awningDepth, 2, 0.03), material));
      cloth.position.set(x, 0, 0);
      awning.add(cloth);

      const scallop = solid(
        new Mesh(new CylinderGeometry(0.16, 0.16, stripeWidth * 0.96, 10, 1, false, 0, Math.PI), material),
      );
      scallop.rotation.z = Math.PI / 2;
      scallop.position.set(x, -0.08, awningDepth / 2);
      awning.add(scallop);
    }

    // --- sign --------------------------------------------------------------
    const sign = new Group();
    sign.position.set(0, 2.9, -0.65);
    this.group.add(sign);
    const board = solid(new Mesh(new RoundedBoxGeometry(2.2, 1.25, 0.12, 3, 0.07), boardMaterial));
    sign.add(board);
    addOutline(board, 0.016);
    const face = decal(
      new Mesh(
        new PlaneGeometry(2.05, 1.15),
        new MeshBasicMaterial({
          map: signTexture({
            title: 'Face Painting!',
            subtitle: 'free — and it washes off',
            glyph: '🎨',
            accent: PALETTE.markerPink,
          }),
          toneMapped: false,
        }),
      ),
    );
    face.position.z = 0.07;
    board.add(face);
    markAsSign(board, 2.2, 1.25);

    // --- mirror on the back wall ---------------------------------------------
    const mirrorFrame = solid(new Mesh(new TorusGeometry(0.36, 0.06, 10, 26), toonMaterial(ART.miniLilac)));
    mirrorFrame.position.set(halfWidth - 0.75, 1.55, -0.77);
    this.group.add(mirrorFrame);
    const mirrorGlass = decal(
      new Mesh(new CylinderGeometry(0.34, 0.34, 0.02, 26), toonMaterial(PALETTE.buildingWindow, { emissive: PALETTE.buildingWindow, emissiveIntensity: 0.15 })),
    );
    mirrorGlass.rotation.x = Math.PI / 2;
    mirrorGlass.position.set(halfWidth - 0.75, 1.55, -0.75);
    this.group.add(mirrorGlass);
    const mirrorShine = decal(
      new Mesh(new RingGeometry(0.05, 0.12, 16, 1, 0, Math.PI * 0.6), toonMaterial(0xffffff, { transparent: true, opacity: 0.55, depthWrite: false })),
    );
    mirrorShine.rotation.x = Math.PI / 2;
    mirrorShine.rotation.z = 0.6;
    mirrorShine.position.set(halfWidth - 0.62, 1.68, -0.745);
    this.group.add(mirrorShine);

    // --- paint pots on the counter ---------------------------------------------
    const potColours = [PALETTE.markerPink, PALETTE.markerLemon, PALETTE.markerMint, PALETTE.markerLilac];
    potColours.forEach((colour, index) => {
      const pot = solid(new Mesh(new CylinderGeometry(0.1, 0.09, 0.16, 12), toonMaterial(PALETTE.buildingWall)));
      const px = -halfWidth + 0.4 + index * ((STALL_WIDTH - 0.8) / (potColours.length - 1));
      pot.position.set(px, 0.99, 0.62);
      this.group.add(pot);
      addOutline(pot, 0.01);

      const dab = solid(new Mesh(new SphereGeometry(0.075, 10, 8), toonMaterial(colour)));
      dab.scale.set(1, 0.6, 1);
      dab.position.set(px, 1.07, 0.62);
      this.group.add(dab);
    });

    // A paintbrush, resting in the last pot.
    const lastPotX = -halfWidth + 0.4 + (potColours.length - 1) * ((STALL_WIDTH - 0.8) / (potColours.length - 1));
    const brushHandle = solid(new Mesh(new CylinderGeometry(0.018, 0.018, 0.42, 6), toonMaterial(PALETTE.wood)));
    brushHandle.position.set(lastPotX + 0.06, 1.28, 0.6);
    brushHandle.rotation.z = 0.5;
    this.group.add(brushHandle);
    const brushTip = solid(new Mesh(new SphereGeometry(0.035, 8, 6), toonMaterial(PALETTE.markerPink)));
    brushTip.scale.set(1, 1.6, 1);
    brushTip.position.set(lastPotX - 0.14, 1.08, 0.6);
    brushTip.rotation.z = 0.5;
    this.group.add(brushTip);

    return this.buildPainter();
  }

  /** A cute little painter standing behind the counter. Returns the sway/lean group. */
  private buildPainter(): Group {
    const skinMat = toonMaterial(ART.corgiTan);
    const smockMat = toonMaterial(PALETTE.markerMint);
    const beretMat = toonMaterial(ART.jumperRed);

    const upper = new Group();
    upper.position.set(-0.55, 1.02, -0.35);
    this.group.add(upper);

    const torso = blob(0.24, smockMat, [1, 1.15, 0.9], 20);
    torso.position.y = 0.1;
    upper.add(torso);
    addOutline(torso, 0.014);

    const head = blob(0.19, skinMat, [1, 0.98, 0.96], 22);
    head.position.y = 0.52;
    upper.add(head);
    addOutline(head, 0.014);

    const face = createFacePatch({
      radius: 0.19,
      spreadX: 1.7,
      spreadY: 1.7,
      tilt: 0.08,
      size: 256,
      eyeStyle: 'open',
      mouth: 'smile',
      blush: ART.blush,
    });
    face.mesh.position.y = 0.52;
    upper.add(face.mesh);

    const beret = solid(new Mesh(new SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), beretMat));
    beret.position.set(0.02, 0.66, -0.02);
    beret.scale.set(1.15, 0.7, 1.15);
    beret.rotation.z = 0.15;
    upper.add(beret);
    const beretBobble = solid(new Mesh(new SphereGeometry(0.03, 8, 6), beretMat));
    beretBobble.position.set(0.06, 0.74, -0.05);
    upper.add(beretBobble);

    for (const side of [-1, 1] as const) {
      const arm = stub(0.07, 0.22, skinMat);
      arm.position.set(side * 0.26, 0.18, 0.12);
      arm.rotation.z = side * 0.5;
      arm.rotation.x = -0.3;
      upper.add(arm);
    }

    return upper;
  }

  private buildCollision(collision: CollisionWorld): void {
    const halfWidth = STALL_WIDTH / 2 + 0.1;
    const front = 1.0;
    const back = -1.0;
    const sin = Math.sin(STALL_FACING);
    const cos = Math.cos(STALL_FACING);
    const toWorld = (lx: number, lz: number): [number, number] => [
      STALL_X + lx * cos + lz * sin,
      STALL_Z - lx * sin + lz * cos,
    ];

    const frontLeft = toWorld(-halfWidth, front);
    const frontRight = toWorld(halfWidth, front);
    const backLeft = toWorld(-halfWidth, back);
    const backRight = toWorld(halfWidth, back);

    collision.addWall(frontLeft[0], frontLeft[1], frontRight[0], frontRight[1], 0.25);
    collision.addWall(backLeft[0], backLeft[1], backRight[0], backRight[1], 0.25);
    collision.addWall(frontLeft[0], frontLeft[1], backLeft[0], backLeft[1], 0.25);
    collision.addWall(frontRight[0], frontRight[1], backRight[0], backRight[1], 0.25);
  }
}

// ------------------------------------------------------------------ helpers

function isFacePaintDesign(value: FacePaintId): value is FacePaintDesign {
  return value !== null && (FACE_PAINT_DESIGNS as readonly string[]).includes(value);
}

/**
 * A world position in the stall group's own space — the exact inverse of the
 * `toWorld` helper inside `buildCollision`, which is the one place the booth's
 * position-and-facing convention is spelled out.
 */
function stallToLocal(worldX: number, worldZ: number): [number, number] {
  const sin = Math.sin(STALL_FACING);
  const cos = Math.cos(STALL_FACING);
  const dx = worldX - STALL_X;
  const dz = worldZ - STALL_Z;
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

function addNpcDecalPoolInto(group: Group, out: FacePaintOverlayHandle[]): void {
  for (let i = 0; i < NPC_DECAL_POOL; i += 1) {
    const overlay = createFacePaintOverlay(NPC_DECAL_RADIUS, { size: 256, spreadX: 1.6, spreadY: 1.6 });
    group.add(overlay.mesh);
    out.push(overlay);
  }
}

function buildHint(uiRoot: HTMLElement): HTMLElement {
  const hint = document.createElement('div');
  hint.className = 'pill facepaint-hint';
  hint.dataset.show = 'false';
  hint.innerHTML = '<span class="emoji">🎨</span><span>Tap for face painting!</span>';
  uiRoot.append(hint);
  return hint;
}

function setHintVisible(hint: HTMLElement | null, visible: boolean): void {
  if (!hint) return;
  hint.dataset.show = visible ? 'true' : 'false';
}

function disposeGroup(root: Group): void {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
  });
}
