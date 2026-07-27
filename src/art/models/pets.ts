import {
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE, Rng } from '../style/bridge';
import { ART } from '../style/artPalette';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../style/materials';
import { sharedFacePatch } from '../style/sharedFace';
import { paintFace, type Expression, type FacePaintOptions } from '../style/faces';
import { applyWalk, blob, type CreatureHandle } from '../style/asset';
import { createPuffNotes, createSongScheduler, playPuffMelody } from '../effects/puffSong';

/**
 * The little pets in the sticker & pet shop's pen — and, once the parade exists
 * (build step 5), the ones that trot along behind you.
 *
 * They are deliberately blob-creatures rather than full rigs: two squashed
 * spheres, a pair of ears and a tail. At 0.5 m tall on a shop counter that is
 * all the detail the camera can resolve, and it keeps a pen of three pets down
 * to the draw calls of a single hero character.
 *
 * They implement {@link CreatureHandle} in full, so the parade can drive them
 * with the same code it drives RiPika with. There is no follow or AI logic in
 * here — assets never contain it (ART_DIRECTION.md §7).
 */
export type PetKind = 'bunny' | 'kitten' | 'mouse' | 'puff';

export const PET_KINDS: readonly PetKind[] = ['bunny', 'kitten', 'mouse', 'puff'];

/** The recipe-driven kinds — the singing puff is different enough in body plan
 *  (one ball, no ears, no tail) that it gets its own builder below instead of
 *  a fifth column in this table. */
type RecipeKind = Exclude<PetKind, 'puff'>;

interface PetRecipe {
  readonly fur: number;
  readonly belly: number;
  readonly ear: number;
  /** Ear size and lean: a bunny's tower up, a kitten's are little triangles. */
  readonly earScale: readonly [number, number, number];
  readonly earLift: number;
  readonly earTilt: number;
  readonly tail: 'puff' | 'long';
  readonly displayName: string;
}

const RECIPES: Readonly<Record<RecipeKind, PetRecipe>> = {
  bunny: {
    fur: PALETTE.blossomWhite,
    belly: ART.cream,
    ear: PALETTE.blossomPink,
    earScale: [0.42, 1.45, 0.5],
    earLift: 0.22,
    earTilt: 0.16,
    tail: 'puff',
    displayName: 'Bunny',
  },
  kitten: {
    fur: ART.corgiTan,
    belly: ART.cream,
    ear: PALETTE.cheek,
    earScale: [0.6, 0.75, 0.4],
    earLift: 0.13,
    earTilt: 0.3,
    tail: 'long',
    displayName: 'Kitten',
  },
  mouse: {
    fur: PALETTE.markerLilac,
    belly: ART.cream,
    ear: PALETTE.blossomPink,
    earScale: [0.85, 0.85, 0.28],
    earLift: 0.14,
    earTilt: 0.42,
    tail: 'long',
    displayName: 'Mouse',
  },
};

export interface PetHandle extends CreatureHandle {
  readonly kind: PetKind;
  readonly displayName: string;
}

/** The name the family sees today — theirs to rename later. */
export const PUFF_DISPLAY_NAME = 'Trilla';

/** One small blob pet. Origin at the paws, facing +Z. */
export function createPet(kind: PetKind): PetHandle {
  if (kind === 'puff') {
    const puff = createPuffCreature({ variant: 'pet' });
    return { ...puff, kind: 'puff', displayName: PUFF_DISPLAY_NAME };
  }

  const recipe = RECIPES[kind];
  const root = new Group();
  root.name = `pet.${kind}`;
  const body = new Group();
  root.add(body);

  const furMat = toonMaterial(recipe.fur);

  const torso = blob(0.16, furMat, [1, 0.86, 1.02], 20);
  torso.position.y = 0.15;
  body.add(torso);
  addOutline(torso, 0.011);

  const tummy = decal(blob(0.1, toonMaterial(recipe.belly), [1, 0.86, 0.5], 12));
  tummy.position.set(0, 0.14, 0.115);
  body.add(tummy);

  const head = new Group();
  head.position.y = 0.3;
  body.add(head);

  const skullR = 0.155;
  const skull = blob(skullR, furMat, [1, 0.94, 0.96], 22);
  head.add(skull);
  addOutline(skull, 0.012);

  // Both ears in one instanced mesh: identical geometry, mirrored placement.
  const ears = new InstancedMesh(new SphereGeometry(0.09, 12, 9), toonMaterial(recipe.ear), 2);
  ears.castShadow = false;
  ears.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 0, 1);
  const scale = new Vector3(recipe.earScale[0], recipe.earScale[1], recipe.earScale[2]);
  const position = new Vector3();
  [-1, 1].forEach((side, index) => {
    rotation.setFromAxisAngle(axis, -side * recipe.earTilt);
    position.set(side * 0.09, 0.1 + recipe.earLift, -0.01);
    matrix.compose(position, rotation, scale);
    ears.setMatrixAt(index, matrix);
  });
  ears.instanceMatrix.needsUpdate = true;
  head.add(ears);

  const tail =
    recipe.tail === 'puff'
      ? blob(0.062, toonMaterial(recipe.belly), [1, 0.9, 0.9], 12)
      : blob(0.038, furMat, [0.7, 0.7, 2.4], 12);
  tail.position.set(0, recipe.tail === 'puff' ? 0.14 : 0.17, -0.18);
  body.add(tail);

  // One shared 256² face across every pet of every kind — see `sharedFace.ts`.
  const face = sharedFacePatch('pet', {
    radius: skullR,
    size: 256,
    spreadX: 1.8,
    spreadY: 1.8,
    tilt: 0.06,
    eyeY: 0.47,
    eyeGap: 0.42,
    eyeW: 0.125,
    eyeH: 0.16,
    mouth: 'cat',
    mouthW: 0.06,
    mouthDrop: 0.19,
    blush: ART.blush,
    blushStyle: 'soft',
    blushR: 0.085,
  });
  head.add(face.mesh);

  const feet = solid(new Mesh(new SphereGeometry(0.055, 10, 8), furMat));
  feet.position.set(0, 0.045, 0.09);
  feet.scale.set(2.1, 0.7, 1.2);
  body.add(feet);

  return {
    root,
    body,
    head,
    kind,
    displayName: recipe.displayName,
    limbs: null,
    height: 0.52,
    setExpression: (name: Expression) => face.setExpression(name),
    setWalkPhase: (phase: number, speed: number) => applyWalk(null, body, phase, speed, 0.85, 0.075),
  };
}

// ------------------------------------------------------- the singing puff

/**
 * The singing puff: a jiggly pastel-pink ball with a curl on top, sold as a
 * pet (sticker & pet shop) and — sized down a touch — as a hat (hat shop,
 * see `hats.ts`). One builder, shared by both, per ART_DIRECTION.md §7's
 * "builder-made assets must be interchangeable" and the file-ownership note
 * to reuse the creature code rather than duplicate it.
 *
 * Two things this creature does that its bunny/kitten/mouse siblings don't:
 *
 * - **Jiggle.** A continuous soft squash-and-stretch idle, not just the
 *   walk-bob. The task brief for this asset says `root.scale` is "reserved
 *   exactly for" that jiggle — but the *actual* contract (this file's own
 *   header comment table plus `ParadeMember.updatePop`) reserves
 *   `root.scale` for **gameplay** squash-and-stretch: the parade already
 *   drives it, for the pop-in/pop-out when a toy joins or leaves the line.
 *   Writing the jiggle there too would fight that animation every frame (the
 *   pop would never finish playing out). So the jiggle is layered onto
 *   `body.scale` instead — the documented "bob and squash target" — and the
 *   walk-bob is reimplemented inline (rather than delegating to the shared
 *   `applyWalk()`) so the two compose instead of one stomping the other.
 * - **Sings.** Every so often it bursts into a soft 3–6 note melody while its
 *   mouth switches to a little "o" and musical notes float up from it. There
 *   is no live player-distance signal available here — an asset factory gets
 *   no scene or player reference (ART_DIRECTION.md §7) — so "sings more when
 *   the player is close" is approximated with the `near` flag: the pet form
 *   assumes it is always fairly close (it either trails right behind its
 *   owner in the parade, or is the one a child is currently standing at the
 *   shop pen to look at), the hat form assumes it is not, on top of which the
 *   hat's whole interval is not sped up — both effects the caller picks by
 *   passing `variant`, so it stays consistent even though it can't sense a
 *   literal metre count.
 */

export interface PuffOptions {
  readonly variant: 'pet' | 'hat';
  /** A second puff (or a third) staggers its jiggle/song phase from the rest. */
  readonly seed?: number;
  /**
   * Extra Y shift applied to `root` after construction, folded into the
   * returned `height` too. A pet's origin is the ground, so this is left at
   * 0; a hat's origin is the crown anchor it sits on, so `hats.ts` passes how
   * far below that anchor this same body needs to sink — computed there,
   * since only `hats.ts` knows its own `SIT` constant.
   */
  readonly mountShift?: number;
}

const PUFF_FUR = PALETTE.blossomPink;
const PUFF_BELLY = PALETTE.stonePinkLight;
const PUFF_CURL = ART.heartPink;

/** Exported so `hats.ts` can work out where to sink the same body onto a head
 *  without duplicating the shape here — see `createPuffCreature`'s doc comment. */
export const PUFF_BALL_RADIUS = 0.2;
/** Where the ball's centre sits above the ground/anchor. */
export const PUFF_CENTRE_Y = 0.225;

/** Only `sharedFacePatch` (which builds the curved shell) wants these — plain
 *  `paintFace` calls (the extra singing texture) don't take a shape at all. */
const PUFF_FACE_SHAPE = { spreadX: 1.9, spreadY: 1.9, tilt: 0.05 } as const;

const PUFF_FACE_PAINT: FacePaintOptions = {
  size: 256,
  eyeY: 0.46,
  eyeGap: 0.4,
  // Bigger than the other pets' shared face — a singing sweetheart earns it.
  eyeW: 0.14,
  eyeH: 0.185,
  mouth: 'cat',
  mouthW: 0.062,
  mouthDrop: 0.205,
  blush: ART.blush,
  blushStyle: 'soft',
  blushR: 0.09,
};

/** Painted once and shared by every puff, pet or hat — see `paintFace` budget
 *  note in ART_DIRECTION.md §7 (under 40 canvas textures game-wide). */
let puffSingingTexture: ReturnType<typeof paintFace> | null = null;

function puffSingingFace() {
  if (!puffSingingTexture) {
    puffSingingTexture = paintFace({
      ...PUFF_FACE_PAINT,
      eyeStyle: 'archHappy',
      mouth: 'oh',
      mouthW: PUFF_FACE_PAINT.mouthW! * 1.25,
    });
  }
  return puffSingingTexture;
}

let puffInstanceCount = 0;

/** Builds one puff. Shared by `createPet('puff')` and `createHat('puff')`. */
export function createPuffCreature(options: PuffOptions): CreatureHandle {
  const { variant } = options;
  // A stable-but-varied seed per instance: deterministic (never
  // `Math.random()`, per ART_DIRECTION.md §7) so a reload looks the same,
  // but different puffs don't all breathe and sing in lockstep.
  const seed = options.seed ?? 0x50ff1e + puffInstanceCount * 7919;
  puffInstanceCount += 1;
  const rng = new Rng(seed);

  const root = new Group();
  root.name = variant === 'pet' ? 'pet.puff' : 'hat.puff';
  const body = new Group();
  root.add(body);

  const head = new Group();
  body.add(head);

  const furMat = toonMaterial(PUFF_FUR);

  const ball = blob(PUFF_BALL_RADIUS, furMat, [1, 0.92, 1.04], 24);
  head.add(ball);
  addOutline(ball, 0.012);

  // The tummy patch: lighter pastel pink, protruding past the ball's own
  // surface (ART_DIRECTION.md §5 — a marking that sits flush reads as a
  // starburst intersection, not a patch).
  const tummy = decal(
    blob(PUFF_BALL_RADIUS * 0.62, toonMaterial(PUFF_BELLY), [1, 0.85, 0.45], 14),
  );
  tummy.position.set(0, -PUFF_BALL_RADIUS * 0.15, PUFF_BALL_RADIUS * 0.86);
  head.add(tummy);

  // The one asymmetric feature every head needs (ART_DIRECTION.md §4): a
  // little curl of hair, off-centre and leaning, so the silhouette isn't a
  // perfect circle.
  const curl = blob(PUFF_BALL_RADIUS * 0.24, toonMaterial(PUFF_CURL), [0.65, 1.35, 0.65], 12);
  curl.position.set(PUFF_BALL_RADIUS * 0.22, PUFF_BALL_RADIUS * 0.98, -PUFF_BALL_RADIUS * 0.12);
  curl.rotation.z = -0.5;
  curl.rotation.x = 0.25;
  head.add(curl);
  addOutline(curl, 0.011);

  const face = sharedFacePatch('pet.puff', {
    radius: PUFF_BALL_RADIUS,
    ...PUFF_FACE_SHAPE,
    ...PUFF_FACE_PAINT,
  });
  head.add(face.mesh);
  const faceMaterial = face.mesh.material as MeshToonMaterial;

  if (variant === 'pet') {
    const feet = solid(new Mesh(new SphereGeometry(0.06, 10, 8), furMat));
    feet.position.set(0, PUFF_CENTRE_Y - PUFF_BALL_RADIUS * 0.98, PUFF_BALL_RADIUS * 0.4);
    feet.scale.set(2.2, 0.65, 1.15);
    body.add(feet);
  }

  head.position.y = PUFF_CENTRE_Y;

  // A pet's origin is the ground, so this is 0; a hat's is the crown anchor,
  // so `hats.ts` passes how far this body needs to sink below it.
  const mountShift = options.mountShift ?? 0;
  root.position.y = mountShift;
  const topLocal = PUFF_CENTRE_Y + PUFF_BALL_RADIUS * 0.92 + PUFF_BALL_RADIUS * 0.35;
  const height = variant === 'pet' ? 0.5 : topLocal + mountShift;

  // ------------------------------------------------------------- singing

  const notes = createPuffNotes(seed + 1);
  head.add(notes.root);
  const mouthLocalY = -PUFF_BALL_RADIUS * 0.1;
  const mouthLocalZ = PUFF_BALL_RADIUS * 0.95;

  const scheduler = createSongScheduler(rng, {
    min: 12,
    max: 22,
    // Hats don't get the speed-up at all (see class comment): a rarer song
    // full stop, not just a slower "near" one.
    nearSpeedup: variant === 'pet' ? 2.6 : 1,
  });
  const near = variant === 'pet';
  const melodyVolume = variant === 'pet' ? 1 : 0.8;

  let currentExpr: Expression = 'neutral';
  let singing = false;
  let singRemaining = 0;
  const breathePhase = rng.range(0, Math.PI * 2);

  // Re-implements the walk-bob from `applyWalk()` rather than calling it, so
  // it can be layered under the jiggle on `body.scale` every frame — see the
  // class comment on why this can't just call the shared helper twice.
  let walkPhase = 0;
  let walkSpeed = 0;

  return {
    root,
    body,
    head,
    limbs: null,
    height,

    setExpression(name: Expression) {
      currentExpr = name;
      if (!singing) {
        faceMaterial.map = face.expressions[name];
        faceMaterial.needsUpdate = true;
      }
    },

    setWalkPhase(phase: number, speed: number) {
      walkPhase = phase;
      walkSpeed = speed;
    },

    update(dt: number, elapsed: number) {
      if (scheduler.update(dt, near) && !singing) {
        const song = playPuffMelody(rng, melodyVolume);
        singing = true;
        singRemaining = song.duration;
        faceMaterial.map = puffSingingFace();
        faceMaterial.needsUpdate = true;
        notes.burst(0, mouthLocalY, mouthLocalZ, song.noteCount);
      }

      if (singing) {
        singRemaining -= dt;
        if (singRemaining <= 0) {
          singing = false;
          faceMaterial.map = face.expressions[currentExpr];
          faceMaterial.needsUpdate = true;
        }
      }
      notes.update(dt);

      // Walk-bob (from `applyWalk`, reimplemented — see class comment).
      const a = walkPhase * Math.PI * 2;
      const lift = Math.abs(Math.sin(a)) * 0.09 * walkSpeed;
      body.position.y = lift;
      const walkY = 1 - lift * 0.5;
      const walkXZ = 1 + lift * 0.28;

      // The jiggle: a gentle continuous breathing squash, a little livelier
      // while singing along to its own tune.
      const jiggleAmount = singing ? 0.055 : 0.03;
      const breathe = Math.sin(elapsed * 1.7 + breathePhase) * jiggleAmount;
      body.scale.set(walkXZ * (1 + breathe * 0.6), walkY * (1 - breathe), walkXZ * (1 + breathe * 0.6));
    },

    dispose() {
      notes.root.removeFromParent();
      notes.dispose();
      disposeTree(body);
    },
  };
}
