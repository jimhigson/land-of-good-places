import type { Object3D } from 'three';
import type { Expression } from '../../art/style/faces';
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
