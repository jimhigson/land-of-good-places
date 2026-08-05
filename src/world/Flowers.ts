import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/palette';
import { Rng, TAU, clamp01, lerp, smoothstep } from '../core/mathUtils';
import { toonMaterial } from '../art/style/materials';
import { createFlowerPickEffect, type FlowerPickEffect } from '../art/effects/flowerSparkle';
import { terrainHeight } from './terrain';
import { isOnPath } from './paths';
import { ANCHORS } from './anchors';
import { pressZone, type InteractZone } from './interact';
import { highlightInstance } from './highlight';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { FLOWER_COLOURS, FLOWER_HEX, gameStore } from '../state';

/**
 * Living, pickable flowers.
 *
 * This replaces the old static flower scatter in `Scenery.ts` (decorative,
 * planted once and never touched again) with a small population that keeps
 * itself alive: every flower grows continuously from a seedling to a full
 * bloom, a bloom can be picked (it joins the inventory and can be worn in the
 * player's hair — see `entities/WornFlower.ts`), and picking one starts a
 * fresh seedling elsewhere after a short pause. The meadow never runs empty
 * and never grows past its cap.
 *
 * Three decisions carry the whole system, the same three the rest of the
 * park's foliage runs on (see ART_DIRECTION.md §7 "Instancing"):
 *
 *  - **One InstancedMesh per part** (stem, head), sized to the population cap
 *    and never resized. A "picked" flower is not removed from the buffer —
 *    it is scaled to nothing until it respawns, which is why the mesh count
 *    never has to change.
 *  - **No per-flower objects.** Every flower is a row across a handful of
 *    typed arrays (struct-of-arrays), not a `Group` or a `Mesh` — four hundred
 *    of those would be four hundred scene-graph nodes for something that only
 *    ever needs a position, a colour and a couple of numbers.
 *  - **Growth is read off one continuous number per flower** (`growth`,
 *    0 → 1 over `GROWTH_SECONDS`), and only flowers that are still changing
 *    — growing, or mid-wiggle — touch the instance buffers each frame. A
 *    fully bloomed, settled flower costs nothing until it is picked.
 *
 * ### Two sizes, and only one of them is pickable
 *
 * The meadow started out with every one of its four hundred flowers offering a
 * "Pick!" chip, which meant the chip was on screen almost permanently and had
 * stopped meaning anything — the family's report was that it "appears far too
 * often". So the population is split, deterministically per index:
 *
 *  - **90 % SMALL** — the original model, and now *pure decoration*. It
 *    registers no interact zone at all, so you walk straight through it and it
 *    can never be highlighted, selected or picked.
 *  - **10 % LARGE** — a proper stem with a five-petal bloom on top
 *    ({@link petalRingGeometry}), roughly 2–2.5× the presence of a small one.
 *    These are the flowers you can pick, and being both rarer and much easier
 *    to see is what makes finding one feel like finding something.
 *
 * See {@link SIZE_SEED} for why the split gets its own random stream.
 */

/** How many flowers are alive at once — the population cap. Roughly the old
 *  static scatter's count (430), rounded down for the extra per-frame cost
 *  of a living system. */
export const FLOWER_POPULATION = 400;

/**
 * Real seconds for one flower to grow from a just-planted seedling to a full
 * bloom. Long enough that growth is a background thing you notice over a
 * session, short enough that watching one for a minute or two visibly
 * changes it — Eleri's brief was "slowly but noticeably".
 *
 * For a time-lapse check in the browser, drop this to single digits, watch a
 * few flowers bloom, then put it back before committing — see PROGRESS-FLOWERS.md.
 */
const GROWTH_SECONDS = 165;

/** Real seconds a picked flower's slot waits before a new seedling appears. */
const RESPAWN_DELAY_MIN = 5;
const RESPAWN_DELAY_MAX = 16;

/** How close (metres, planar) the player must be to pick or prod a flower. */
const PICK_RADIUS = 1.3;

/** How long the "not yet!" bud wiggle lasts, in seconds. */
const WIGGLE_SECONDS = 0.4;

/** Scatter radius, matching the old decorative flowers' footprint. */
const SCATTER_RADIUS = 55;

/**
 * Share of the meadow that grows up into a large, pickable flower. The other
 * nine in ten stay small and are decoration only.
 *
 * Ten per cent of four hundred is forty pickable flowers across a 55 m radius —
 * sparse enough that a "Pick!" chip is an event rather than the default state
 * of the screen, dense enough that a child crossing the park will still walk
 * past several.
 */
const LARGE_SHARE = 0.1;

/**
 * The size split's **own** random stream, seeded separately from
 * {@link Flowers.rng}.
 *
 * Two reasons, and both matter. It has to be deterministic per flower index —
 * a slot that is large must be large in every session, on every device, and
 * must stay large when it respawns, or the park would reshuffle itself under a
 * returning player. And drawing from a separate stream means the main `rng`'s
 * sequence is untouched, so every flower's position, colour and growth stagger
 * are exactly what they were before the split existed.
 */
const SIZE_SEED = 0x1a3e07;

/**
 * Size multipliers for a large flower, over the small model's targets.
 *
 * The stem grows rather more than the bloom does (2.9× against 2×), which is
 * what turns the small flower's ground-hugging blob into something that reads
 * as *a stem with a flower on top* rather than just a bigger blob.
 */
const LARGE_STEM_SCALE = 2.9;
const LARGE_HEAD_SCALE = 2.0;
/** How much wider a large flower's stalk is. A tall stem on a hair needs it. */
const LARGE_STALK_WIDTH = 2.1;

/**
 * The bloom's centre, on large flowers only.
 *
 * Warm amber, deliberately the one colour that is not in {@link FLOWER_HEX}:
 * every flower colour in this park is a pastel, so a single warm centre reads
 * cleanly against all six petals rather than needing a per-colour table.
 */
const BLOOM_CENTRE = 0xf2a83c;

/** Fraction of the petal ring's radius the centre disc takes up. */
const CENTRE_RATIO = 0.44;

const STAGE_GROWING = 0;
const STAGE_BLOOMED = 1;
const STAGE_PICKED = 2;

export class Flowers implements GameSystem {
  readonly name = 'flowers';
  readonly group = new Group();

  private readonly count = FLOWER_POPULATION;
  private readonly rng = new Rng(0xf7010e);

  private readonly posX = new Float32Array(this.count);
  private readonly posZ = new Float32Array(this.count);
  private readonly groundY = new Float32Array(this.count);
  private readonly rotY = new Float32Array(this.count);
  private readonly colourIndex = new Uint8Array(this.count);
  private readonly widthTarget = new Float32Array(this.count);
  private readonly stemHeightTarget = new Float32Array(this.count);
  private readonly growth = new Float32Array(this.count);
  private readonly stage = new Uint8Array(this.count);
  private readonly respawnTimer = new Float32Array(this.count);
  private readonly wiggle = new Float32Array(this.count);

  /**
   * 1 for a large (pickable) flower, 0 for a small decorative one. Decided
   * once, in the constructor, and never written again — see {@link SIZE_SEED}.
   */
  private readonly large = new Uint8Array(this.count);
  /**
   * Row in the {@link petals} buffer for flower `i`, or −1 for a small flower.
   *
   * The petal ring is the one part only a tenth of the meadow ever uses, so its
   * mesh is sized to the large flowers alone rather than to the population:
   * three hundred and sixty permanently zero-scaled instances of a five-lobed
   * geometry is real vertex work every frame in exchange for nothing at all.
   */
  private readonly petalSlot = new Int16Array(this.count);
  private readonly largeCount: number;

  private readonly stems: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly petals: InstancedMesh;
  private readonly pickEffect: FlowerPickEffect;

  /**
   * Who does the bending and the smelling — see {@link attachPlayer}. Null
   * until `World.attachPlayer` hands her over, and treated as optional
   * throughout: the meadow works perfectly well without a character in it, and
   * a missing flourish must never be able to stop a flower being picked.
   */
  private player: Player | null = null;

  // Scratch objects, reused every frame — nothing here allocates in the loop.
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchQuaternion = new Quaternion();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchColour = new Color();

  constructor() {
    this.group.name = 'flowers';

    // Which slots are large is settled before anything is planted, because the
    // size class decides how big a flower's targets are and which mesh rows it
    // owns. Its own stream, drawn strictly in index order — see SIZE_SEED.
    const sizeRng = new Rng(SIZE_SEED);
    let largeCount = 0;
    for (let i = 0; i < this.count; i += 1) {
      const isLarge = sizeRng.chance(LARGE_SHARE);
      this.large[i] = isLarge ? 1 : 0;
      this.petalSlot[i] = isLarge ? largeCount : -1;
      if (isLarge) largeCount += 1;
    }
    this.largeCount = largeCount;

    const stemGeometry = new CylinderGeometry(0.02, 0.028, 1, 4);
    const headGeometry = new SphereGeometry(1, 7, 5);

    this.stems = new InstancedMesh(stemGeometry, toonMaterial(0xffffff), this.count);
    this.stems.name = 'living-flower-stems';
    this.stems.castShadow = false;
    this.stems.receiveShadow = false;

    this.heads = new InstancedMesh(headGeometry, toonMaterial(0xffffff), this.count);
    this.heads.name = 'living-flower-heads';
    this.heads.castShadow = false;
    this.heads.receiveShadow = false;

    // `Math.max(1, …)` only so a hypothetical share of zero cannot ask three.js
    // for a zero-length instance buffer.
    this.petals = new InstancedMesh(
      petalRingGeometry(),
      toonMaterial(0xffffff),
      Math.max(1, this.largeCount),
    );
    this.petals.name = 'living-flower-petals';
    this.petals.castShadow = false;
    this.petals.receiveShadow = false;

    this.group.add(this.stems, this.heads, this.petals);

    this.pickEffect = createFlowerPickEffect();
    this.group.add(this.pickEffect.root);

    // Every petal row starts at zero scale. `writeMatrix` fills in the real
    // ones a few lines below, so this only actually matters for the padding
    // row a share of zero would leave — but an unwritten InstancedMesh row is
    // an identity matrix, i.e. a metre-wide white bloom sitting on the plaza,
    // and that is not a bug worth ever risking for four lines.
    this.scratchQuaternion.identity();
    this.scratchScale.set(0, 0, 0);
    this.scratchPosition.set(0, 0, 0);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    for (let row = 0; row < this.petals.count; row += 1) {
      this.petals.setMatrixAt(row, this.scratchMatrix);
    }

    for (let i = 0; i < this.count; i += 1) {
      this.spawnAt(i, true);
      this.writeMatrix(i);
    }
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.petals.instanceMatrix.needsUpdate = true;
    if (this.stems.instanceColor) this.stems.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;
  }

  update({ dt }: FrameContext): void {
    let matrixDirty = false;

    for (let i = 0; i < this.count; i += 1) {
      let changed = false;

      if (this.stage[i] === STAGE_PICKED) {
        const timer = (this.respawnTimer[i] ?? 0) - dt;
        this.respawnTimer[i] = timer;
        if (timer <= 0) {
          this.spawnAt(i, false);
          changed = true;
        }
      }

      if (this.stage[i] === STAGE_GROWING) {
        const next = (this.growth[i] ?? 0) + dt / GROWTH_SECONDS;
        const clamped = next >= 1 ? 1 : next;
        this.growth[i] = clamped;
        changed = true;
        if (clamped >= 1) {
          this.stage[i] = STAGE_BLOOMED;
          this.paintColour(i, true);
        }
      }

      if ((this.wiggle[i] ?? 0) > 0) {
        const next = (this.wiggle[i] ?? 0) - dt / WIGGLE_SECONDS;
        this.wiggle[i] = next <= 0 ? 0 : next;
        changed = true;
      }

      if (changed) {
        this.writeMatrix(i);
        matrixDirty = true;
      }
    }

    if (matrixDirty) {
      this.stems.instanceMatrix.needsUpdate = true;
      this.heads.instanceMatrix.needsUpdate = true;
      this.petals.instanceMatrix.needsUpdate = true;
    }

    this.pickEffect.update(dt);

    // No interact handling here any more, and that is the point of issue #122.
    // This used to read the press itself and pick the nearest flower within
    // {@link PICK_RADIUS} — which is how a flower growing beside a platform
    // stole a press from the station's own "Get on" chip. Picking is now
    // reached only through this flower's own zone action below, so a press can
    // only ever pick the flower the child is actually being shown.
  }

  /**
   * One tap target per live **large** flower — hidden (picked, awaiting
   * respawn) ones are left out so a tap cannot land on thin air, and small
   * ones are left out because they are decoration and nothing else.
   *
   * That second filter is the whole of the "Pick! is always on screen" fix.
   * A small flower with no zone is invisible to the interact system end to
   * end: no chip, no rainbow outline, nothing to select, nothing to stand in
   * front of. It is scenery you walk through, which is what it always looked
   * like it was.
   *
   * Built fresh on request rather than cached, same as the stalls: this is
   * only ever read when the player actually taps the world, not once a frame.
   */
  interactZones(): InteractZone[] {
    const zones: InteractZone[] = [];
    for (let i = 0; i < this.count; i += 1) {
      if (this.large[i] !== 1) continue;
      if (this.stage[i] === STAGE_PICKED) continue;
      const petalRow = this.petalSlot[i] ?? -1;
      zones.push(
        pressZone(
          {
            id: `flower:${i}`,
            label: 'flower',
            x: this.posX[i] ?? 0,
            y: this.groundY[i] ?? 0,
            z: this.posZ[i] ?? 0,
            pickRadius: 0.9,
            standX: this.posX[i] ?? 0,
            standZ: this.posZ[i] ?? 0,
            // Tighter than the default three metres, and it has to be: picking
            // is gated on {@link PICK_RADIUS} below, so a "Pick!" chip offered
            // from further off would be a button that does nothing.
            standRadius: PICK_RADIUS,
            // Below everything you can properly *do* something with — the same
            // rank signs sit at, and for the same reason. Flowers are scattered
            // over the whole park by the hundred, and one growing beside a
            // station platform or a shop counter must not be what a child is
            // offered when she walks up to the train or the till. Tapping a
            // flower still selects it outright; this is only about which of two
            // things she is standing between wins by itself.
            selectRank: -1,
            // The HIGHLIGHT RULE's interesting case: there is no flower object
            // to point at, only a row of an instance buffer. The highlight
            // system shares one shell across every instance of the mesh and
            // reads the instance's own matrix each frame, so the rainbow grows
            // with the flower and vanishes with it when it is picked.
            //
            // The petal ring, not the head: on a large flower the head is only
            // the little amber centre, and outlining that would put a rainbow
            // in the middle of the bloom instead of around it.
            highlight:
              petalRow >= 0 ? highlightInstance(this.petals, petalRow) : highlightInstance(this.heads, i),
          },
          // This flower, by row, and no other. `Selection` has already checked
          // that she is standing within `standRadius` (= PICK_RADIUS) of it
          // before this runs, so there is no second proximity test to disagree
          // with the chip — see `world/InteractRouter.ts`.
          () => this.pickByIndex(i),
          '🌼',
        ),
      );
    }
    return zones;
  }

  /**
   * Lets the meadow ask the character to bend, pick and smell.
   *
   * `World.attachPlayer`'s pattern, and here for the same reason it is used
   * for the fountain and the crowd: `World` is built before `Player` exists
   * (see `Game`'s constructor), so this cannot be a constructor argument.
   */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  dispose(): void {
    this.stems.geometry.dispose();
    this.heads.geometry.dispose();
    this.petals.geometry.dispose();
    (this.stems.material as { dispose(): void }).dispose();
    (this.heads.material as { dispose(): void }).dispose();
    (this.petals.material as { dispose(): void }).dispose();
    this.pickEffect.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Pick (or prod) flower `index` — the run body of its own chip.
   *
   * The player is where the picked bloom flies to, so a flowerbed with nobody
   * attached simply does nothing; `attachPlayer` is what turns the park on.
   */
  private pickByIndex(index: number): void {
    const player = this.player;
    if (!player) return;
    this.tryInteract(index, player.position);
  }

  /** Bloomed → picked. Growing → a wiggle of resistance. Nothing else reacts. */
  private tryInteract(index: number, playerPosition: Vector3): void {
    // Belt and braces with `nearestWithin`'s own filter: nothing anywhere in
    // the game may ever pick a small flower, so the guard sits on the one
    // function that does the picking rather than only on the ways in.
    if (this.large[index] !== 1) return;
    if (this.stage[index] === STAGE_BLOOMED) {
      this.pick(index, playerPosition);
    } else if (this.stage[index] === STAGE_GROWING) {
      this.wiggle[index] = 1;
    }
  }

  private pick(index: number, playerPosition: Vector3): void {
    const colour = FLOWER_COLOURS[this.colourIndex[index] ?? 0] ?? 'yellow';
    const x = this.posX[index] ?? 0;
    const z = this.posZ[index] ?? 0;
    // At the bloom, not at the roots. It never mattered when every flower was
    // a blob two handspans off the ground; a large one holds its head most of
    // a metre up, and a sparkle bursting from the soil under it reads as
    // coming from the wrong thing.
    const y = (this.groundY[index] ?? 0) + (this.stemHeightTarget[index] ?? 0.2);
    const hex = FLOWER_HEX[colour];

    // The flower is hers *first*, and worn a moment later — the flourish that
    // follows is decoration and nothing waits on it. That is what makes
    // walking off mid-bend cost nothing: there is no half-picked flower to
    // finish picking, only a pose that stops being applied.
    gameStore.collectFlower(colour);

    // Bend, pick, smell (family design feedback). Never blocks: she can walk
    // out of it on the next frame — see `Player.pickFlower`.
    this.player?.pickFlower();

    // The flight target is read live every frame of the flourish, so it keeps
    // heading for the player even if they walk off immediately after picking.
    this.pickEffect.burst(x, y, z, hex, () => playerPosition);

    this.stage[index] = STAGE_PICKED;
    this.respawnTimer[index] = this.rng.range(RESPAWN_DELAY_MIN, RESPAWN_DELAY_MAX);
    this.wiggle[index] = 0;
    this.writeMatrix(index); // scales it to nothing until it respawns
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.petals.instanceMatrix.needsUpdate = true;
  }

  /**
   * Plants (or replants) slot `index` somewhere new: a fresh seedling, a
   * random colour, a random target size, always clear of paths and anchor
   * plots — the same placement rules the old decorative scatter used.
   *
   * The slot's **size class is not touched here**. A large flower's slot stays
   * large forever: it is what the interact zone that has already been handed
   * out was built from, and a slot that could change class on respawn would
   * make a returning player's park quietly different from the one she left.
   */
  private spawnAt(index: number, initial: boolean): void {
    const point = this.pickSpawnPoint();
    this.posX[index] = point.x;
    this.posZ[index] = point.z;
    this.groundY[index] = terrainHeight(point.x, point.z);
    this.rotY[index] = this.rng.range(0, TAU);
    this.colourIndex[index] = this.rng.int(0, FLOWER_COLOURS.length - 1);
    // Drawn at the small flower's scale and then multiplied up, rather than
    // from a second pair of ranges: two flowers of the same size class stay in
    // the same proportion to each other whichever class it is, and the main
    // rng consumes exactly the same two numbers per flower it always has.
    const big = this.large[index] === 1;
    this.widthTarget[index] = this.rng.range(0.17, 0.27) * (big ? LARGE_HEAD_SCALE : 1);
    this.stemHeightTarget[index] = this.rng.range(0.18, 0.32) * (big ? LARGE_STEM_SCALE : 1);
    this.wiggle[index] = 0;
    this.respawnTimer[index] = 0;

    // At boot, stagger growth so the meadow starts full of variety rather than
    // every flower being a seedling on the same clock. A respawn always starts
    // fresh — that is the whole point of "a new seedling sprouts elsewhere".
    const seedGrowth = initial
      ? this.rng.chance(0.6)
        ? this.rng.range(0.82, 1.05)
        : this.rng.range(0, 0.82)
      : 0;
    this.growth[index] = clamp01(seedGrowth);
    this.stage[index] = this.growth[index] >= 1 ? STAGE_BLOOMED : STAGE_GROWING;
    this.paintColour(index, this.stage[index] === STAGE_BLOOMED);
  }

  /** Somewhere clear of paths and every reserved anchor plot. */
  private pickSpawnPoint(): { x: number; z: number } {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = this.rng.range(0, TAU);
      const distance = Math.sqrt(this.rng.unit()) * SCATTER_RADIUS;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (isOnPath(x, z, 0.5)) continue;
      if (this.insideAnyAnchor(x, z, 0.5)) continue;
      return { x, z };
    }
    // Fell through every attempt (shouldn't happen with this much open lawn) —
    // the plaza edge is always clear of both paths and plots.
    return { x: 0, z: 12 };
  }

  private insideAnyAnchor(x: number, z: number, margin: number): boolean {
    for (const anchor of ANCHORS) {
      const dx = x - anchor.position[0];
      const dz = z - anchor.position[1];
      if (Math.hypot(dx, dz) < anchor.boundingRadius + margin) return true;
    }
    return false;
  }

  /**
   * Composes both instances' matrices from a flower's current state.
   *
   * Growth drives two things at once, which is what makes it read as a plant
   * opening rather than just getting bigger: the stem rises first
   * (`smoothstep(0, 0.55, t)`), then the head fills out and flattens from a
   * round, closed bud into the same flat bloom shape the old decorative
   * flowers used (`smoothstep(0.55, 1, t)`).
   *
   * A large flower runs the same two curves and adds a third: its petal ring
   * stays folded away inside the bud until {@link PETAL_OPEN_START}, then
   * flares out while the round bud tightens down into the bloom's centre. The
   * flare is deliberately late — a bud you cannot pick yet should not look
   * like an open flower, and finishing the opening at the same moment the
   * centre turns amber means the two changes cover for each other.
   */
  private writeMatrix(index: number): void {
    const t = this.growth[index] ?? 0;
    const picked = this.stage[index] === STAGE_PICKED;
    const petalRow = this.petalSlot[index] ?? -1;
    const x = this.posX[index] ?? 0;
    const z = this.posZ[index] ?? 0;
    const groundY = this.groundY[index] ?? 0;
    const rotY = this.rotY[index] ?? 0;

    if (picked) {
      this.scratchQuaternion.identity();
      this.scratchScale.set(0, 0, 0);
      this.scratchPosition.set(x, groundY, z);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      this.stems.setMatrixAt(index, this.scratchMatrix);
      this.heads.setMatrixAt(index, this.scratchMatrix);
      if (petalRow >= 0) this.petals.setMatrixAt(petalRow, this.scratchMatrix);
      return;
    }

    const stemT = smoothstep(0, 0.55, t);
    const openT = smoothstep(0.55, 1, t);
    const overall = lerp(0.1, 1, smoothstep(0.04, 0.8, t));
    const flatten = lerp(0.92, 0.5, openT);
    const stemHeight = Math.max(0.015, (this.stemHeightTarget[index] ?? 0.2) * Math.max(stemT, 0.08));
    const width = (this.widthTarget[index] ?? 0.2) * overall;
    const stalkWidth = this.large[index] === 1 ? LARGE_STALK_WIDTH : 1;
    // A wiggle jitters the head's yaw and gives it a brief extra flare — the
    // "no, not yet!" of a bud that got prodded before it was ready.
    const wig = this.wiggle[index] ?? 0;
    const wiggleYaw = Math.sin(wig * TAU * 2.5) * wig * 0.6;
    const wiggleFlare = 1 + wig * 0.18;

    this.scratchQuaternion.setFromAxisAngle(UP, rotY);
    this.scratchPosition.set(x, groundY + stemHeight / 2, z);
    this.scratchScale.set(stalkWidth, stemHeight, stalkWidth);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    this.stems.setMatrixAt(index, this.scratchMatrix);

    if (petalRow < 0) {
      // Small: one flattening blob on a short stalk, exactly as it always was.
      this.scratchQuaternion.setFromAxisAngle(UP, rotY + wiggleYaw);
      this.scratchPosition.set(x, groundY + stemHeight, z);
      this.scratchScale.set(width * wiggleFlare, width * flatten * wiggleFlare, width * wiggleFlare);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
      this.heads.setMatrixAt(index, this.scratchMatrix);
      return;
    }

    const petalOpen = smoothstep(PETAL_OPEN_START, 1, t);
    this.scratchQuaternion.setFromAxisAngle(UP, rotY + wiggleYaw);

    const petalRadius = width * petalOpen * wiggleFlare;
    this.scratchPosition.set(x, groundY + stemHeight, z);
    this.scratchScale.set(petalRadius, petalRadius, petalRadius);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    this.petals.setMatrixAt(petalRow, this.scratchMatrix);

    // The same head sphere the small flower uses, doing double duty: a fat
    // round bud on its own while the flower grows, and the bloom's centre once
    // the petals are out from around it.
    const centre = width * lerp(1, CENTRE_RATIO, petalOpen) * wiggleFlare;
    this.scratchPosition.set(x, groundY + stemHeight, z);
    this.scratchScale.set(centre, centre * flatten, centre);
    this.scratchMatrix.compose(this.scratchPosition, this.scratchQuaternion, this.scratchScale);
    this.heads.setMatrixAt(index, this.scratchMatrix);
  }

  /**
   * Paints flower `index` for its current stage.
   *
   * Small flowers work as they always did: a green bud that becomes its own
   * colour the moment it blooms. On a large one the two halves split up — the
   * petals carry the flower's colour from the moment it is planted (they are
   * folded away inside the bud until the very end of its growth, so there is
   * never a green petal to see) and the head is what changes, from a green bud
   * to the bloom's warm centre.
   */
  private paintColour(index: number, bloomed: boolean): void {
    const colour = FLOWER_COLOURS[this.colourIndex[index] ?? 0] ?? 'yellow';
    const hex = FLOWER_HEX[colour];
    const petalRow = this.petalSlot[index] ?? -1;

    if (petalRow >= 0) {
      this.scratchColour.setHex(hex);
      this.petals.setColorAt(petalRow, this.scratchColour);
      if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;
      this.scratchColour.setHex(bloomed ? BLOOM_CENTRE : PALETTE.leafDeep);
    } else {
      this.scratchColour.setHex(bloomed ? hex : PALETTE.leafDeep);
    }
    this.heads.setColorAt(index, this.scratchColour);
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;

    // Stems stay leaf-green throughout — only the head announces the colour.
    this.scratchColour.setHex(PALETTE.leafDeep);
    this.stems.setColorAt(index, this.scratchColour);
    if (this.stems.instanceColor) this.stems.instanceColor.needsUpdate = true;
  }
}

const UP = new Vector3(0, 1, 0);

/** Growth fraction at which a large flower's petals start to unfold. */
const PETAL_OPEN_START = 0.72;

/**
 * The large flower's bloom: five plump petals in a ring, merged into one
 * geometry so the whole thing is a single instance.
 *
 * Built here rather than in `art/models/` because it exists only to be an
 * instance in this file's buffer — it is never a `Mesh` anybody holds. Toon
 * style throughout (ART_DIRECTION §2): rounded lobes, low segment counts, no
 * detail smaller than the ink line would be.
 *
 * Normalised so the ring's outer edge sits at radius 1, which lets the instance
 * scale be the bloom's radius in metres and read the same way as the small
 * flower's head sphere.
 */
function petalRingGeometry(): BufferGeometry {
  const PETAL_COUNT = 5;
  /** Distance from the stem to a petal's own centre, before normalising. */
  const REACH = 0.66;
  /** Half-length of a petal along the direction it points, before normalising. */
  const PETAL_LENGTH = 0.5;

  const parts: BufferGeometry[] = [];
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const petal = new SphereGeometry(1, 6, 4);
    petal.scale(PETAL_LENGTH, 0.22, 0.34);
    petal.translate(REACH, 0, 0);
    petal.rotateY((i / PETAL_COUNT) * TAU);
    parts.push(petal);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();

  // `mergeGeometries` only returns null for mismatched attributes, which five
  // identical spheres cannot have — the fallback is here so a future edit that
  // mixes in a different primitive fails visibly rather than crashing.
  const geometry = merged ?? new SphereGeometry(1, 6, 4);
  const normalise = 1 / (REACH + PETAL_LENGTH);
  geometry.scale(normalise, normalise, normalise);
  geometry.computeVertexNormals();
  return geometry;
}
