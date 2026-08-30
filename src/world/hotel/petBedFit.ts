import { Box3, Object3D, Vector3 } from 'three';
import { PARADE_MEMBER_RADIUS } from '../../core/constants';
import { createPetBed, PET_BED_CUSHION_RADIUS, PET_BED_CUSHION_TOP } from '../../art/models/hotelAssets';
import { ALL_CATALOGUE_ITEMS } from '../building/shops/catalogue';
import { walksInParade } from '../../state';

/**
 * **How big a pet bed has to be, and how far apart two of them stand —
 * measured off the real bed and the real animals, never written down.**
 *
 * Jim, live play, 23 Aug 2026, and again on the 24th: *"the beds are also
 * still too small."* He was right, and the reason nothing had caught it is
 * that every number involved was a literal:
 * `layout.ts`'s `PET_BED_PITCH` was 1.3 m, derived from the *bed's* own
 * footprint (`PET_BED_FOOTPRINT_RADIUS` × 2 = 1.24 m) and never once from the
 * animal that lies in it. Measured on the built park:
 *
 * | | plan span, lying in the sleeping pose |
 * |---|---|
 * | `pet.puff` | 1.30 m × **1.53 m** |
 * | `pet.mouse` | 1.06 m × 1.52 m |
 * | `pet.kitten` | 1.09 m × 1.50 m |
 * | `pet.ripika` | 1.12 m × 1.49 m |
 * | `pet.bunny` | 0.80 m × 1.47 m |
 * | the bed's own bolster rim | 1.37 m × **1.35 m** |
 *
 * So every companion in the game was longer than the bed it slept in, and two
 * in neighbouring rows overlapped each other by ~0.19 m at the ear and tail.
 *
 * ## The rule this file exists to keep
 *
 * **Ask the animal, not the furniture.** A pet bed is sized from the biggest
 * thing that can lie in it and spaced from the size it ends up, both taken
 * from geometry that was actually built — the same principle
 * `ParadeMember.measureSleepOffset` already uses for *where* a sleeping
 * companion sits, extended to *how much room* it needs. Nothing here is a
 * number somebody typed in and nothing downstream is allowed to keep its own
 * copy: `layout.ts`'s `petBedPitch()`/`petBedFootprintRadius()` and
 * `Hotel.placePetBed`'s scale, cushion height and run-up spot all read
 * {@link petBedFit}.
 *
 * ## And it covers toys, because toys get beds now
 *
 * Jim, 24 Aug 2026: *"if they follow the character they get a bed."* The range
 * measured below is therefore every catalogue entry {@link walksInParade}
 * accepts — RiPika and Biscuit alongside the four pets — not the four `'pet'`
 * species. They differ: the puff is the longest, RiPika is longer than the
 * bunny, and a bed sized for pets alone would have been too small for the one
 * companion every fresh save actually starts with.
 */

/**
 * The sleeping pose, as a rotation of the whole model: tipped a quarter turn
 * back about X — which swings the head, and so the pillow end, to −Z — and
 * rolled a quarter turn about its own Y so it lies **on its side** rather than
 * flat on its back.
 *
 * Both quarters matter, and both were measured on the real bed
 * (`art/models/hotelAssets.ts`, `createPetBed`) rather than picked:
 *
 * - Every pet stands 1.46 m tall, so tipped flat on its back its own *depth*
 *   becomes its height in the bed — 1.09 m for the kitten, 1.30 m for the
 *   puff — against a canopy whose fabric starts at 0.72 m and peaks at 1.27 m.
 *   Three of the four pets went through the roof of their own bed.
 * - Rolled onto its side it is the pet's *width* that stands up instead —
 *   0.67 m for the bunny, 0.84 m for the kitten, 0.90 m for the mouse — which
 *   clears the canopy, and it is what a sleeping animal actually looks like.
 * - Y is +π/2 rather than −π/2 so the pet's front (and its face) rolls toward
 *   +X, which is the side the fixed iso camera looks from.
 *
 * Three.js applies an `XYZ` Euler as `Rx·Ry·Rz`, so the roll happens in the
 * pet's own frame first and the tip afterwards, which is what keeps the head
 * on the pillow whichever way it is rolled.
 *
 * **Here rather than in `ParadeMember.ts`** because two things need it and
 * they must agree exactly: the member that poses itself, and the bed that has
 * to be big enough for the shape that pose makes.
 */
export const BED_POSE_X = -Math.PI / 2;
export const BED_POSE_Y = Math.PI / 2;

/**
 * How much bed shows beyond the sleeper's nose and tail, on every side.
 *
 * The one number here that is a *look* rather than a measurement, and it is
 * the reason the bed is scaled past merely containing the animal: a bolster
 * exactly as long as the pet in it still reads as a pet spilling out of a
 * saucer, which is the complaint `createPetBed`'s own doc comment records
 * from the first sketch and the complaint Jim repeated on 23 Aug.
 */
const SLEEPER_RIM_MARGIN = 0.08;

/**
 * A companion's plan footprint while it is asleep, in world metres, and the
 * height it reaches.
 */
export interface SleepingSize {
  /** East-west span — the animal's own depth, once it is rolled onto its side. */
  readonly spanX: number;
  /** North-south span — nose to tail, the long one. */
  readonly spanZ: number;
  /** How far up it reaches from the cushion. */
  readonly height: number;
}

/**
 * Everything a pet bed's size and spacing is derived from, all measured.
 *
 * One object rather than four exports because they are one decision: the
 * scale sets the footprint, the footprint sets the pitch, and the pitch sets
 * the run-up spot a companion trots in from. Splitting them up is how they
 * would fall out of step.
 */
export interface PetBedFit {
  /** Uniform scale to build a pet bed at — 1 would be the raw asset. */
  readonly scale: number;
  /** Half the built bed's own base, in plan: what collision and placement use. */
  readonly footprintRadius: number;
  /** Centre-to-centre spacing between two neighbouring beds. */
  readonly pitch: number;
  /** Top of the scaled cushion — a sleeping companion's lowest point rests here. */
  readonly cushionTop: number;
  /** Radius of the scaled cushion's clear disc. */
  readonly cushionRadius: number;
  /** The biggest sleeper any of these beds has to hold. */
  readonly largestSleeper: SleepingSize;
  /** The scaled bolster rim's own plan span, x and z — what {@link pitch} clears. */
  readonly bolsterSpanX: number;
  readonly bolsterSpanZ: number;
}

/**
 * Poses `root` for sleep, takes its own world box, and puts it back exactly as
 * it was.
 *
 * The one place the game measures a sleeping companion. `ParadeMember` uses it
 * to find the offset that lands a body on its cushion; this file uses it to
 * find out how big a bed has to be. Two callers, one measurement, so a change
 * to {@link BED_POSE_X}/{@link BED_POSE_Y} cannot leave the bed sized for the
 * old pose.
 *
 * Takes the box at scale 1 about the origin, so the answer is the model's own
 * size and not wherever it happened to be standing.
 */
export function sleepingBox(root: Object3D): Box3 {
  const rotation = root.rotation.clone();
  const scale = root.scale.clone();
  const position = root.position.clone();
  root.rotation.set(BED_POSE_X, BED_POSE_Y, 0);
  root.scale.setScalar(1);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  root.rotation.copy(rotation);
  root.scale.copy(scale);
  root.position.copy(position);
  root.updateMatrixWorld(true);
  return box;
}

let fit: PetBedFit | null = null;

/**
 * The measured answer, worked out once on first use and kept.
 *
 * Lazy rather than a module-level `const` because working it out builds one of
 * every companion in the catalogue and one pet bed, and `layout.ts` — which
 * asks for it — is imported by half the park. Every model it builds is thrown
 * away again before this returns.
 */
export function petBedFit(): PetBedFit {
  if (fit) return fit;

  const largestSleeper = measureLargestSleeper();
  const bed = measureBed();

  // Big enough that the longest companion lies inside the bolster rim with
  // SLEEPER_RIM_MARGIN of bed showing all round it — and never smaller than
  // the asset was authored, whatever the animals turn out to measure.
  const scale = Math.max(
    1,
    (largestSleeper.spanX + SLEEPER_RIM_MARGIN * 2) / bed.bolsterSpanX,
    (largestSleeper.spanZ + SLEEPER_RIM_MARGIN * 2) / bed.bolsterSpanZ,
  );

  const footprintRadius = (Math.max(bed.baseSpanX, bed.baseSpanZ) / 2) * scale;
  const bolsterSpanX = bed.bolsterSpanX * scale;
  const bolsterSpanZ = bed.bolsterSpanZ * scale;
  // Whichever part of a bed is widest has to clear its neighbour, and a
  // companion has to be able to walk down the row between two of them to
  // reach its own — which is exactly where its bed's run-up spot is
  // (`Hotel.PET_BEDTIME_RUN_UP`, half of this). `PARADE_MEMBER_RADIUS` is the
  // radius the parade itself shoves that companion about with.
  const pitch =
    Math.max(footprintRadius * 2, bolsterSpanX, bolsterSpanZ) + PARADE_MEMBER_RADIUS * 2;

  fit = {
    scale,
    footprintRadius,
    pitch,
    cushionTop: PET_BED_CUSHION_TOP * scale,
    cushionRadius: PET_BED_CUSHION_RADIUS * scale,
    largestSleeper,
    bolsterSpanX,
    bolsterSpanZ,
  };
  return fit;
}

// ------------------------------------------------------------------ internals

/**
 * The biggest plan footprint any companion that can get a bed lies in.
 *
 * Every catalogue entry, on a shelf or out of a surprise egg, that
 * {@link walksInParade} accepts — so a species the shop gains tomorrow is
 * measured the day it is added, with no list here to keep in step. Each model
 * is built, measured and disposed of.
 */
function measureLargestSleeper(): SleepingSize {
  let spanX = 0;
  let spanZ = 0;
  let height = 0;
  const size = new Vector3();
  for (const item of ALL_CATALOGUE_ITEMS) {
    if (!walksInParade(item.kind)) continue;
    const handle = item.model();
    sleepingBox(handle.root).getSize(size);
    spanX = Math.max(spanX, size.x);
    spanZ = Math.max(spanZ, size.z);
    height = Math.max(height, size.y);
    handle.dispose?.();
  }
  return { spanX, spanZ, height };
}

/** The raw pet bed asset's own spans, measured off one built copy. */
function measureBed(): {
  readonly bolsterSpanX: number;
  readonly bolsterSpanZ: number;
  readonly baseSpanX: number;
  readonly baseSpanZ: number;
} {
  const bed = createPetBed();
  bed.root.updateMatrixWorld(true);
  const bolster = spanOf(bed.root, 'petbed-bolster');
  const base = spanOf(bed.root, 'petbed-base');
  bed.dispose?.();
  return {
    bolsterSpanX: bolster.x,
    bolsterSpanZ: bolster.z,
    baseSpanX: base.x,
    baseSpanZ: base.z,
  };
}

/**
 * One named part of a built model, as a plan span.
 *
 * Throws rather than defaulting: a renamed mesh would otherwise silently size
 * every pet bed in the hotel off a zero, which is precisely the "a check can
 * pass without checking anything" failure CLAUDE.md is about — except here it
 * would be the game itself passing without building anything.
 */
function spanOf(root: Object3D, name: string): Vector3 {
  let box: Box3 | null = null;
  root.traverse((part: Object3D) => {
    if (part.name !== name) return;
    box = new Box3().setFromObject(part);
  });
  if (!box) {
    throw new Error(`Land of Good Places: the pet bed has no "${name}" to measure.`);
  }
  return (box as Box3).getSize(new Vector3());
}
