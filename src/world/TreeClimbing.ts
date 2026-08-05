import type { Object3D } from 'three';
import { clamp01, lerp, smoothstep } from '../core/mathUtils';
import { isTouchDevice } from '../core/device';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import type { NpcCharacter } from '../entities/npc/NpcCharacter';
import { WanderDriver, type ClimbPhase } from '../entities/npc/wanderDriver';
import type { KidAvatar } from '../entities/npc/kidCrowd';
import type { NpcSystem } from '../entities/npc';
import type { Hud } from '../ui/Hud';
import { pressZone, type InteractZone } from './interact';
import type { ClimbableTreeSeed } from './Scenery';
import { terrainHeight } from './terrain';

/**
 * Tree climbing (family design feedback: NPCs — and the player — climb trees,
 * peek out of the leaves, and climb back down).
 *
 * Both the player and every NPC go through the same three-phase scripted
 * moment — `up` (a quick scramble), `peek` (held, looking around), `down` (the
 * scramble in reverse) — computed by the pure {@link climbPose} function at
 * the bottom of this file. What differs is who drives it:
 *
 * - The **player**'s phase timer lives here, directly. It is started by the
 *   tree's own chip action and ended by `jump`, by moving, by a tap, or by the
 *   interact key arriving back through `world/InteractRouter.ts`'s
 *   `playerPeeking` claim — this class reads the interact key nowhere at all
 *   (issue #122). Positioning reuses `Player.beginRide/setRidePose/endRide` — the
 *   exact mechanism already used to hand the character to a slide — so
 *   normal movement, collision and tap-to-move all switch off for free while
 *   `player.riding` is true, and switch back on the moment `endRide` fires.
 * - Every **NPC**'s phase timer lives in its own `WanderDriver` (see the
 *   climbing block in `entities/npc/wanderDriver.ts`), which decides *when*
 *   and *which tree*; this class only reads that state and turns it into a
 *   pose, via the small `beginClimb/setClimbPose/endClimb` trio added to
 *   `NpcCharacter` for exactly this.
 *
 * **Body hidden, head out**: rather than trust the isometric camera to see a
 * body occluded by a canopy blob from every one of its four snap angles, the
 * body is simply hidden for the duration and the head positioned at the
 * canopy top. For the player that is a `Group.visible` toggle on everything
 * under `model.body` except `model.head` (three.js visibility only cascades
 * down through ancestors, so the head stays visible while its siblings don't
 * — no change needed to `CharacterModel`/`kid.ts`). For an NPC, drawn through
 * `InstancedCrowd`, a proxy's `.visible` is not what `commit()` reads —
 * only `CrowdMember.shown[partIndex]` is — so the equivalent is finding every
 * part whose prototype mesh is *not* a descendant of the head joint and
 * zeroing those indices for the duration (cached per avatar, since the rig
 * shape is identical for the whole crowd).
 *
 * **The tree's collider is untouched.** Nothing here adds or removes a
 * collision shape; the trunk stays exactly as solid as it always was for
 * everyone not currently climbing it, because climbing works by taking a
 * character *out* of the normal move/collide/gravity loop for a few seconds,
 * not by changing the world.
 */
export class TreeClimbing implements GameSystem {
  readonly name = 'treeClimbing';

  private readonly trees: readonly ClimbableTreeSeed[];

  // --- player state ----------------------------------------------------------
  private playerPhase: ClimbPhase | null = null;
  private playerTree: ClimbableTreeSeed | null = null;
  private playerTimer = 0;
  private playerStartX = 0;
  private playerStartZ = 0;
  /** Which way she faces while peeking — captured at the top of the scramble. */
  private playerPeekFacing = 0;
  private playerHiddenParts: Object3D[] = [];

  // --- NPC state ---------------------------------------------------------
  /** Every part hidden while an avatar climbs — computed once, reused forever. */
  private readonly npcHideParts = new WeakMap<KidAvatar, readonly number[]>();
  /** What each part's `shown` flag was before climbing, so it restores exactly. */
  private readonly npcShownBackup = new Map<NpcCharacter, Uint8Array>();
  /**
   * The player-style `.visible` toggle's own bookkeeping, for a pinned kid
   * built as a one-off `CharacterModel` rather than an instanced `KidAvatar`
   * — see `hideNpcBody`'s doc comment for why it needs a different mechanism
   * from the crowd's `shown` array entirely. Mirrors {@link playerHiddenParts}.
   */
  private readonly npcHiddenVisibleParts = new Map<NpcCharacter, Object3D[]>();

  constructor(
    private readonly player: Player,
    private readonly npcs: NpcSystem,
    private readonly hud: Hud,
    trees: readonly ClimbableTreeSeed[],
  ) {
    this.trees = trees;
  }

  /** Trees big enough to climb, for `NpcSystem` to hand to every wander driver. */
  get climbableTrees(): readonly ClimbableTreeSeed[] {
    return this.trees;
  }

  /** True while the player is up a tree, in any phase — for `Game`'s tap routing. */
  get playerClimbing(): boolean {
    return this.playerPhase !== null;
  }

  /**
   * Every tap target this system owns: one zone per climbable tree (see
   * `world/interact.ts`). The *pick* point (what a tap has to land near) is
   * the trunk's true centre, generous enough to catch a tap anywhere on the
   * canopy overhead — but the *stand* point is offset just outside the
   * trunk's own collision circle. Standing dead-centre is not something a
   * character can ever do (the trunk collider pushes them out to its edge),
   * and `TapNavigator`'s arrival radius (0.55 m) is smaller than some of
   * these trunks — aim it at the centre and a walk to a tapped tree "gets
   * stuck" short of arriving, so the chip that sent her there fires nothing.
   */
  interactZones(): InteractZone[] {
    return this.trees.map((tree, index) => {
      const y = terrainHeight(tree.x, tree.z);
      // Offset radially outward from the park centre rather than a fixed
      // compass direction: trees near the plaza sit close to the decorative
      // fences ringing the fountain, and a fixed "south" offset can land the
      // stand point behind one of them. Outward, toward the open lawn beyond
      // the tree, is clear far more often.
      const outward = Math.hypot(tree.x, tree.z) || 1; // guard the one tree at the origin
      const standDistance = tree.trunkRadius + 0.9;
      const standX = tree.x + (tree.x / outward) * standDistance;
      const standZ = tree.z + (tree.z / outward) * standDistance;
      return pressZone(
        {
          id: `tree-${index}`,
          label: 'Climbable tree',
          x: tree.x,
          y,
          z: tree.z,
          pickRadius: tree.trunkRadius + 2.6,
          standX,
          standZ,
          // Measured from the trunk's surface rather than its centre, so a
          // child standing anywhere she could plausibly reach the bark from is
          // offered the chip. It is now the *only* distance in play: the E key
          // runs this zone's own action, so there is no second margin for it to
          // disagree with (issue #122).
          standRadius: tree.trunkRadius + INTERACT_MARGIN,
        },
        // This tree, and no other. `Selection` has already established that it
        // is the selected thing and that she is standing within `standRadius`
        // of it, so there is no `nearestClimbableTree` search here to come to a
        // different answer than the chip did (issue #122).
        () => this.requestClimb(tree),
        '🌳',
      );
    });
  }

  /**
   * "Climb this one" — the run body of a tree's own chip.
   *
   * Re-checks the gates rather than trusting them from when the chip was drawn:
   * a chip pressed from across the park walks her over first, and in those few
   * seconds she may have been put on a slide or already be up something else.
   */
  private requestClimb(tree: ClimbableTreeSeed): void {
    if (this.playerPhase !== null) return;
    if (this.player.riding) return;
    this.beginPlayerClimb(tree);
  }

  /**
   * True while she is up a tree and looking around — the one moment when a
   * press means "come down".
   *
   * Read by `world/InteractRouter.ts` as a claim. It is exclusive by
   * construction: `player.riding` is true throughout, so no zone is selectable
   * and there is no chip for a press to disagree with.
   */
  get playerPeeking(): boolean {
    return this.playerPhase === 'peek';
  }

  /** A tap landed anywhere while the player is up a tree: that means "come down". */
  requestDescend(): void {
    if (this.playerPhase !== 'peek') return;
    this.beginPlayerDescend();
  }

  update(context: FrameContext): void {
    this.updateNpcClimbs(context);

    if (this.playerPhase !== null) {
      this.updatePlayerClimb(context);
    }

    // Climbing is *started* by the tree's own chip action and nothing else —
    // see `interactZones` above. This used to search for the nearest climbable
    // tree and read `justPressed('interact')` itself, which is exactly the
    // pattern issue #122 removed: a second proximity test, with its own margin,
    // racing every other system's second proximity test for the same key.
    //
    // It is also the end of the double-fire hazard noted on #103. Climb and
    // un-climb were two independent readers of one global edge, kept apart only
    // by the order the systems happen to run in and by `Selection` refusing to
    // act in reach. Climb is a zone action now, un-climb is a router claim, and
    // the key itself has exactly one reader.
  }

  // ============================================================== player

  private beginPlayerClimb(tree: ClimbableTreeSeed): void {
    this.playerTree = tree;
    this.playerStartX = this.player.position.x;
    this.playerStartZ = this.player.position.z;
    this.playerPhase = 'up';
    this.playerTimer = 0;
    this.player.beginRide();
  }

  private beginPlayerDescend(): void {
    this.playerPhase = 'down';
    this.playerTimer = 0;
    this.showPlayerBody();
  }

  private updatePlayerClimb(context: FrameContext): void {
    const tree = this.playerTree;
    if (!tree) {
      this.playerPhase = null;
      return;
    }
    const { dt, input } = context;
    this.playerTimer += dt;
    const headOffset = this.player.model.headHeight;

    if (this.playerPhase === 'up') {
      const t = clamp01(this.playerTimer / PLAYER_SCRAMBLE_UP_SECONDS);
      const pose = climbPose(tree, this.playerStartX, this.playerStartZ, headOffset, 'up', t, 0);
      this.player.setRidePose(pose.x, pose.y, pose.z, pose.facing);
      this.hud.setPrompt(null);
      if (t >= 1) {
        this.playerPhase = 'peek';
        this.playerTimer = 0;
        this.playerPeekFacing = pose.facing;
        this.hidePlayerBody();
        this.player.model.setExpression('happy');
      }
      return;
    }

    if (this.playerPhase === 'peek') {
      // The peek holds the facing it arrived with, and the stick does not
      // touch it.
      //
      // It used to: holding left or right turned the head where she stood.
      // That is a rotation control, in a third-person view, which the CONTROL
      // RULE (GAME_DESIGN.md; see `core/screenBasis.ts`) does not allow
      // anywhere outside first person — and it was barely reachable in any
      // case, because a deflection of more than a fifth already means "down
      // and off that way" a few lines below. Pressing a direction up a tree
      // now means exactly what it means everywhere else: go there. The
      // scramble down happens first, and then she walks.
      const pose = climbPose(
        tree,
        this.playerStartX,
        this.playerStartZ,
        headOffset,
        'peek',
        0,
        this.playerPeekFacing,
      );
      this.player.setRidePose(pose.x, pose.y, pose.z, pose.facing);
      // Reasserted every frame rather than only on the transition: Player's
      // own blink cycle (`Player.animate`) calls `setExpression('neutral')`
      // whenever a blink ends, which would otherwise quietly erase the happy
      // face a few seconds into the peek. One texture-swap call a frame for
      // a single character is not worth engineering around.
      this.player.model.setExpression('happy');
      this.hud.setPrompt(descendPrompt());

      // The interact key is *not* read here — `world/InteractRouter.ts` holds
      // the only reader in the game and routes it back through
      // {@link requestDescend} via the `playerPeeking` claim. Hopping and
      // walking off still work from here, because `jump` and the stick mean the
      // same thing wherever she is standing and so can never be aimed at the
      // wrong thing.
      const wantsDown = input.justPressed('jump') || input.moveAmount > 0.22;
      if (wantsDown) this.beginPlayerDescend();
      return;
    }

    // 'down'
    const t = clamp01(this.playerTimer / PLAYER_SCRAMBLE_DOWN_SECONDS);
    const pose = climbPose(tree, this.playerStartX, this.playerStartZ, headOffset, 'down', t, 0);
    this.player.setRidePose(pose.x, pose.y, pose.z, pose.facing);
    this.hud.setPrompt(null);
    if (t >= 1) {
      this.player.endRide(0, 0, 0);
      this.playerPhase = null;
      this.playerTree = null;
    }
  }

  /** Hides every part of the model except the head — see the class doc. */
  private hidePlayerBody(): void {
    const model = this.player.model;
    this.playerHiddenParts = [];
    for (const child of model.body.children) {
      if (child === model.head) continue;
      if (!child.visible) continue;
      child.visible = false;
      this.playerHiddenParts.push(child);
    }
  }

  private showPlayerBody(): void {
    for (const child of this.playerHiddenParts) child.visible = true;
    this.playerHiddenParts = [];
  }

  // ================================================================= NPCs

  private updateNpcClimbs(context: FrameContext): void {
    for (const character of this.npcs.all) {
      const driver = character.driver;
      if (!(driver instanceof WanderDriver)) continue;

      const shouldClimb = driver.climbing;
      const isClimbing = character.climbing;

      if (shouldClimb && !isClimbing) {
        character.beginClimb();
        this.hideNpcBody(character);
      } else if (!shouldClimb && isClimbing) {
        character.endClimb();
        this.showNpcBody(character);
        continue;
      }

      if (!shouldClimb) continue;

      const tree = driver.climbTree;
      if (!tree) continue;
      const spot = driver.climbGroundSpot;
      // A little automatic sway stands in for the player's stick-driven free
      // look — enough that a peeking child reads as "looking around" rather
      // than a statue. The seed keeps several simultaneous climbers from all
      // swaying in lockstep.
      const seed = tree.x * 12.9 + tree.z * 7.3;
      const peekFacing =
        Math.atan2(spot.x - tree.x, spot.z - tree.z) +
        Math.PI +
        Math.sin(context.elapsed * 0.7 + seed) * 0.55;

      const pose = climbPose(
        tree,
        spot.x,
        spot.z,
        character.avatar.headBaseY,
        driver.climbPhase ?? 'peek',
        driver.climbProgress,
        peekFacing,
      );
      character.setClimbPose(pose.x, pose.y, pose.z, pose.facing);
    }
  }

  /**
   * Hides everything but the head, whichever of the two shapes `avatar` is —
   * see the class doc's "Body hidden, head out" section. An instanced
   * `KidAvatar` (has `member`) goes through `member.shown`, same as always;
   * a pinned kid's one-off `CharacterModel`-backed avatar (no `member`,
   * real scene-graph meshes) gets exactly the player's own `.visible`
   * toggle, because it *is* the player's own kind of model.
   */
  private hideNpcBody(character: NpcCharacter): void {
    const { avatar } = character;
    const member = avatar.member;
    if (member) {
      const parts = this.hidePartsFor(avatar as KidAvatar);
      this.npcShownBackup.set(character, Uint8Array.from(member.shown));
      for (const index of parts) member.shown[index] = 0;
      return;
    }

    const hidden: Object3D[] = [];
    for (const child of avatar.rig.body.children) {
      if (child === avatar.rig.head) continue;
      if (!child.visible) continue;
      child.visible = false;
      hidden.push(child);
    }
    this.npcHiddenVisibleParts.set(character, hidden);
  }

  private showNpcBody(character: NpcCharacter): void {
    const member = character.avatar.member;
    if (member) {
      const backup = this.npcShownBackup.get(character);
      if (!backup) return;
      member.shown.set(backup);
      this.npcShownBackup.delete(character);
      return;
    }

    const hidden = this.npcHiddenVisibleParts.get(character);
    if (!hidden) return;
    for (const child of hidden) child.visible = true;
    this.npcHiddenVisibleParts.delete(character);
  }

  /** Every part index that is not the head or one of its own parts. Cached. */
  private hidePartsFor(avatar: KidAvatar): readonly number[] {
    const cached = this.npcHideParts.get(avatar);
    if (cached) return cached;

    const head = avatar.rig.head;
    const indices: number[] = [];
    avatar.member.proxies.forEach((proxy, index) => {
      if (proxy !== head && !isDescendantOf(proxy, head)) indices.push(index);
    });

    this.npcHideParts.set(avatar, indices);
    return indices;
  }
}

// -------------------------------------------------------------------- pose

/** How long the up/down scramble takes. Quick and cute, not a climbing sim. */
const PLAYER_SCRAMBLE_UP_SECONDS = 0.45;
const PLAYER_SCRAMBLE_DOWN_SECONDS = 0.4;

/** How close (trunk edge to feet) counts as "near enough to climb". */
const INTERACT_MARGIN = 2.4;

interface ClimbPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
}

/**
 * The one piece of maths both the player and every NPC climb through.
 *
 * `startX/startZ` is wherever the climber was standing when the climb began —
 * the scramble visibly closes the gap between that and the tree, rather than
 * assuming anyone arrived exactly on the trunk. The climbing spot itself is
 * not the trunk's centre but a point just outside it, in the direction the
 * climber approached from (`edgeX/edgeZ` below) — `BackpackPeek` uses the
 * same trick for the same reason: dead centre reads as floating, leaning out
 * to one side reads as *climbing*, and it conveniently also means "climb back
 * down" never has to divide by a distance of zero.
 *
 * `peekFacing` is only used for the `peek` phase (the caller works out
 * whatever "look around" means for a player or an NPC); `up`/`down` always
 * face the trunk, because a body sliding up or down a tree looking anywhere
 * else would look broken.
 */
function climbPose(
  tree: ClimbableTreeSeed,
  startX: number,
  startZ: number,
  headOffsetY: number,
  phase: ClimbPhase,
  progress: number,
  peekFacing: number,
): ClimbPose {
  const approachAngle = Math.atan2(startX - tree.x, startZ - tree.z);
  const edgeDistance = tree.trunkRadius + 0.35;
  const edgeX = tree.x + Math.sin(approachAngle) * edgeDistance;
  const edgeZ = tree.z + Math.cos(approachAngle) * edgeDistance;
  const topY = tree.canopyTopY - headOffsetY;

  if (phase === 'peek') return { x: edgeX, y: topY, z: edgeZ, facing: peekFacing };

  const t = clamp01(progress);
  const eased = smoothstep(0, 1, t);
  // A little wiggle on the way up and down — fades out as the scramble
  // completes so it never disturbs the held peek.
  const wiggle = Math.sin(t * Math.PI * 6) * 0.14 * (1 - t);
  const climbingUp = phase === 'up';
  const groundY = terrainHeight(startX, startZ);

  return {
    x: lerp(climbingUp ? startX : edgeX, climbingUp ? edgeX : startX, eased) + wiggle,
    z: lerp(climbingUp ? startZ : edgeZ, climbingUp ? edgeZ : startZ, eased) + wiggle * 0.6,
    y: lerp(climbingUp ? groundY : topY, climbingUp ? topY : groundY, eased),
    facing: approachAngle + Math.PI,
  };
}

function isDescendantOf(node: Object3D, ancestor: Object3D): boolean {
  let current: Object3D | null = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function descendPrompt(): string {
  return isTouchDevice() ? 'Tap anywhere — Climb down' : 'Press E or hop — Climb down';
}
