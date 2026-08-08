import { Group, type Object3D } from 'three';
import type { Expression } from '../../art/style/faces';
import type { CreatureHandle } from '../../art/style/asset';
import type { CharacterModel } from '../CharacterModel';
import type { CrowdMember } from './InstancedCrowd';

/** The joints a walk cycle needs, resolved once per child. */
export interface NpcRig {
  readonly root: Object3D;
  readonly body: Object3D;
  readonly head: Object3D;
  readonly leftArm: Object3D;
  readonly rightArm: Object3D;
  readonly leftLeg: Object3D;
  readonly rightLeg: Object3D;
}

/**
 * Whatever `NpcCharacter` needs in order to pose and move something.
 *
 * Two very different things satisfy this today: `KidCrowd.spawn()`'s
 * instanced `KidAvatar` (a dozen background children sharing a handful of
 * draw calls, posed by writing proxy-skeleton transforms `InstancedCrowd`
 * later reads), and a one-off `CharacterModel` — the same, fully-featured,
 * individually-rendered model the player wears, complete with a real
 * `hatAnchor` and simulated-ponytail physics — for the rare pinned NPC whose
 * look needs more than the crowd's shared instancing can offer (a hat, a
 * named pet, the floor-length simulated ponytail). See `NpcSystem.ts`'s
 * `buildIndividualAvatar`.
 */
export interface NpcAvatar {
  readonly rig: NpcRig;
  /** Resting head height, read off the model so a retune carries through. */
  readonly headBaseY: number;
  /** Total height in metres, after this child's own scale. */
  readonly height: number;
  setExpression(expression: Expression): void;
  /**
   * Extra per-frame work only an individually-rendered model needs — right
   * now, `CharacterModel.update`'s simulated ponytail. Absent (rather than a
   * no-op) for an instanced crowd member, which has no such secondary motion.
   * Called after this frame's pose is written, same contract as
   * `CharacterModel.update`.
   */
  tick?(dt: number): void;
  /**
   * Set only by the instanced crowd — `NpcSystem` reads this to know whether
   * a character needs `KidCrowd.crowd.commit()` each frame. A one-off
   * `CharacterModel`-backed avatar is a real scene-graph object with no
   * instance buffer to flush, so it has none.
   */
  readonly member?: CrowdMember;
}

/**
 * The player's own model, as an NPC body.
 *
 * The one adapter between {@link CharacterModel} — individually rendered, real
 * `hatAnchor`, simulated ponytail — and what `NpcCharacter` poses. There is
 * deliberately **one** of these rather than one per caller: `NpcSystem`'s
 * pinned cast (Eleri, Rumi) and the hotel's own residents are the same body
 * built by the same factory, and a second copy of this seven-line mapping is
 * exactly the "two definitions of one thing, kept in step by hand" CLAUDE.md
 * opens with — the copy would be found wrong by a child, as a guest whose head
 * did not turn.
 *
 * `tick` is wired to `CharacterModel.update`, so a resident wearing a swishy
 * ponytail simulates it without anybody here knowing that is what it does.
 */
export function characterModelAvatar(model: CharacterModel): NpcAvatar {
  return {
    rig: {
      root: model.root,
      body: model.body,
      head: model.head,
      leftArm: model.leftArm,
      rightArm: model.rightArm,
      leftLeg: model.leftLeg,
      rightLeg: model.rightLeg,
    },
    headBaseY: model.head.position.y,
    height: model.height,
    setExpression: (expression) => model.setExpression(expression),
    tick: (dt) => model.update(dt),
  };
}

/**
 * Any creature in the park's own asset language, as an NPC body.
 *
 * Every `CreatureHandle` (`art/style/asset.ts`) already carries the two joints
 * a walk cycle actually needs — a `body` that bobs and squashes and a `head`
 * that turns — so a pet is a perfectly good {@link NpcAvatar} and gets the
 * shared movement, collision, ground handling and push-apart for free. That is
 * the whole point of {@link NpcAvatar} being an interface rather than "a child
 * in the crowd": a bunny padding round the breakfast room is not a second
 * movement system, it is the same one with a smaller model on it.
 *
 * **Limbs are optional and usually absent.** `createPet` reports
 * `limbs: null` — a pet's legs are part of its body blob, and its own
 * `setWalkPhase` passes `null` straight to `applyWalk`. `NpcCharacter.animate`
 * writes arm and leg rotations unconditionally, so they are given four
 * throwaway `Group`s that are never parented to anything: writing a rotation
 * onto an object outside the scene graph costs one assignment and draws
 * nothing, which is cheaper *and* simpler than four `if`s in the frame path.
 */
export function creatureAvatar(handle: CreatureHandle): NpcAvatar {
  const limbs = handle.limbs ?? {
    leftArm: new Group(),
    rightArm: new Group(),
    leftLeg: new Group(),
    rightLeg: new Group(),
  };
  return {
    rig: {
      root: handle.root,
      body: handle.body,
      head: handle.head,
      leftArm: limbs.leftArm,
      rightArm: limbs.rightArm,
      leftLeg: limbs.leftLeg,
      rightLeg: limbs.rightLeg,
    },
    headBaseY: handle.head.position.y,
    height: handle.height,
    setExpression: (expression) => handle.setExpression(expression),
  };
}
