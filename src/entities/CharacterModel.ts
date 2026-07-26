import type { Group } from 'three';
import { createKid, type KidHandle, type KidOptions } from '../art/models/kid';
import type { Expression } from '../art/style/faces';

/**
 * The player's character model.
 *
 * This is a thin adapter over {@link createKid} — the art system's toon kid —
 * that keeps the shape {@link Player} animates against. Proportions are
 * unchanged (1.86 m, head 47% of height, arm pivots at the shoulders, leg
 * pivots at the hips) because the camera, the collision radius and the name
 * label are all tuned to them. What changed underneath is the surface: toon
 * material, ink outlines, and a painted face patch.
 *
 * The one genuine behaviour change is that **there are no eye meshes any more**.
 * The face is a canvas texture on a curved patch, so blinking is
 * {@link setExpression}, not a scale on a sphere. See ART_DIRECTION.md §3.
 */
export interface CharacterColours {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly shoe: number;
}

export class CharacterModel {
  /** Root of the whole character. Position this at the feet. */
  readonly root: Group;
  /** Everything that bobs and squashes when walking. */
  readonly body: Group;
  readonly head: Group;
  readonly leftArm: Group;
  readonly rightArm: Group;
  readonly leftLeg: Group;
  readonly rightLeg: Group;

  /** Total height in metres — used to place the name label. */
  readonly height: number;

  /** Attachment points for hats, carried toys and backpack peekers. */
  readonly hatAnchor: Group;
  readonly holdAnchor: Group;
  readonly backpackAnchor: Group;

  private readonly kid: KidHandle;

  constructor(colours: CharacterColours, options: KidOptions = {}) {
    this.kid = createKid({ ...colours, ...options });
    this.root = this.kid.root;
    this.body = this.kid.body;
    this.head = this.kid.head;
    this.leftArm = this.kid.limbs.leftArm;
    this.rightArm = this.kid.limbs.rightArm;
    this.leftLeg = this.kid.limbs.leftLeg;
    this.rightLeg = this.kid.limbs.rightLeg;
    this.height = this.kid.height;
    this.hatAnchor = this.kid.hatAnchor;
    this.holdAnchor = this.kid.holdAnchor;
    this.backpackAnchor = this.kid.backpackAnchor;
  }

  /**
   * Blinks and moods. This swaps a texture and flips `needsUpdate`, so callers
   * must only call it on a **transition**, never every frame.
   */
  setExpression(name: Expression): void {
    this.kid.setExpression(name);
  }

  /** The shared house walk cycle, if a caller would rather not pose limbs. */
  setWalkPhase(phase01: number, speed01: number): void {
    this.kid.setWalkPhase(phase01, speed01);
  }

  setSkinColour(colour: number): void {
    this.kid.setSkinColour(colour);
  }

  /** Recolours the hair — used by the character creator. */
  setHairColour(colour: number): void {
    this.kid.setHairColour(colour);
  }

  /** Recolours the outfit — used by the character creator. */
  setOutfitColour(colour: number): void {
    this.kid.setOutfitColour(colour);
  }

  setShoeColour(colour: number): void {
    this.kid.setShoeColour(colour);
  }
}
