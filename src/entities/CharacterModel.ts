import type { Group } from 'three';
import { createKid, KID_HEAD_HEIGHT, type KidHandle, type KidOptions } from '../art/models/kid';
import type { FacePaintDesign } from '../art/style/faces';
import type { Expression } from '../art/style/faces';

/**
 * The player's character model.
 *
 * This is a thin adapter over {@link createKid} — the art system's toon kid —
 * that keeps the shape {@link Player} animates against: arm pivots at the
 * shoulders, leg pivots at the hips, and everything that bobs inside `body`.
 *
 * Sizes are **read from the model**, never restated here. After the cartoon
 * pass the kid is 2.12 m to the top of her hair with the head pivot at 1.36 m,
 * and an animator that hard-codes either of those breaks silently the next time
 * the art changes.
 *
 * The one genuine behaviour change is that **there are no eye meshes any more**.
 * The face is a canvas texture on a curved patch, so blinking is
 * {@link setExpression}, not a scale on a sphere. See ART_DIRECTION.md §3.
 */
export interface CharacterColours {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  /** The arms' own colour, for a two-tone shirt. See `KidOptions.outfitArms`. */
  readonly outfitArms: number;
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

  /**
   * Total height in metres, bare-headed — used to place the name label when
   * nothing is worn.
   *
   * Read live off the model rather than snapshotted, because since hair styles
   * landed it genuinely changes: Spiky is 0.24 m taller than a bob. See
   * `art/models/kid.ts`'s `height` getter.
   */
  get height(): number {
    return this.kid.height;
  }

  /**
   * Whether the worn hairstyle refuses to share the head with a hat —
   * Mohican, today (Spiky and a hat are allowed to overlap, clipping
   * included — Jim's ruling, 31 July 2026). `WornHat` checks this **before**
   * attaching a hat mesh at all: the hat is what disappears, never the hair.
   * See `art/models/kid.ts`'s `hairHidesHat` for the full reasoning.
   */
  get hairHidesHat(): boolean {
    return this.kid.hairHidesHat;
  }

  /** Resting height of the head pivot, in metres. The animator nudges around it. */
  readonly headHeight = KID_HEAD_HEIGHT;

  /**
   * Height of `hatAnchor` above the feet, in metres. Added to a worn hat's own
   * `height` (`art/models/hats.ts`) to find the true top of the character when
   * one is worn — see `Player`'s name label placement.
   */
  readonly hatAnchorHeight: number;

  /** Attachment points for hats, carried toys and backpack peekers. */
  readonly hatAnchor: Group;
  /** Where a single hair accessory (a picked flower) sits — see `WornFlower`. */
  readonly hairAnchor: Group;
  readonly holdAnchor: Group;
  readonly backpackAnchor: Group;
  /** Where a jet pack straps on — the middle of her back. See `WornJetpack`. */
  readonly jetpackAnchor: Group;
  /**
   * Where glasses sit — the bridge of the nose, at eye height. See
   * `art/models/glasses.ts` and `KidHandle.glassesAnchor`. Attached once, at
   * construction (`Player`'s constructor), not driven by a `Worn*` system the
   * way a hat is — glasses are chosen in the character creator and never sold,
   * so there is nothing to swap mid-game.
   */
  readonly glassesAnchor: Group;
  /** Where a worn keychain hangs — see `art/models/kid.ts`'s `keychainAnchor`. */
  readonly keychainAnchor: Group;

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
    this.hatAnchorHeight = this.kid.hatAnchorHeight;
    this.hatAnchor = this.kid.hatAnchor;
    this.hairAnchor = this.kid.hairAnchor;
    this.holdAnchor = this.kid.holdAnchor;
    this.backpackAnchor = this.kid.backpackAnchor;
    this.jetpackAnchor = this.kid.jetpackAnchor;
    this.glassesAnchor = this.kid.glassesAnchor;
    this.keychainAnchor = this.kid.keychainAnchor;
  }

  /**
   * Blinks and moods. This swaps a texture and flips `needsUpdate`, so callers
   * must only call it on a **transition**, never every frame.
   */
  setExpression(name: Expression): void {
    this.kid.setExpression(name);
  }

  /**
   * Face paint, from the painting stall. Repaints the skull's own texture — see
   * `art/models/kid.ts`'s `attachFacePaint`, which is what calls this.
   */
  setFacePaint(design: FacePaintDesign | null): void {
    this.kid.setFacePaint(design);
  }

  /**
   * Secondary motion the model owns rather than the animator: today that is
   * the simulated ponytail, and nothing else.
   *
   * Must be called **after** the frame's pose is set, not before — the tail is
   * pinned to the world position of an anchor that hangs off `head`, which
   * hangs off `body`, and both of those are written every frame by `Player`'s
   * `animate`. Called first it would follow the previous frame's head and lag
   * by a frame forever.
   *
   * `dt` is the game's already-time-scaled delta; the chain clamps it itself.
   * Free on every style but the swishy ponytail.
   */
  update(dt: number): void {
    this.kid.update(dt);
  }

  /**
   * Tells the model a hat's attachment just changed, so `height` re-measures.
   * No longer tucks any hair away — see `KidHandle.setHatWorn`'s doc comment
   * and {@link hairHidesHat}. Driven by `WornHat`.
   */
  setHatWorn(worn: boolean): void {
    this.kid.setHatWorn(worn);
  }

  /**
   * Tells the model a jet pack is on, so her chosen bag steps aside for it —
   * one back, one thing strapped to it. Driven by `WornJetpack`.
   */
  setJetpackWorn(worn: boolean): void {
    this.kid.setJetpackWorn(worn);
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

  /**
   * Recolours the outfit — used by the character creator. `armsColour`
   * defaults to `colour`, same as `KidHandle.setOutfitColour`.
   */
  setOutfitColour(colour: number, armsColour?: number): void {
    this.kid.setOutfitColour(colour, armsColour);
  }

  setShoeColour(colour: number): void {
    this.kid.setShoeColour(colour);
  }
}
