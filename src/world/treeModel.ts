import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  MeshToonMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { Rng, TAU } from '../core/mathUtils';
import { toonMaterial } from '../art/style/materials';

/**
 * **What a tree in this game is.** One owner, for every tree anybody plants.
 *
 * The park's lawn (`world/Scenery.ts`) and the lane the cat bus drives up
 * (`world/entrance/BusJourney.ts`) both build their trees from here, and that
 * is the whole point of the module existing.
 *
 * Jim, playing the deployed game, 9 August 2026: *"Use the actual tree models
 * same as the game uses by the side of the road but not on it."* The lane had
 * been growing its own — a cylinder and an `IcosahedronGeometry(1, 1)` blob,
 * scattered by its own loop — which is a lookalike, not the park's tree, and a
 * lookalike drifts. It already had: the park's trees are four kinds with
 * layered canopies and per-instance colour, and the lane's were one green ball
 * on a stick, so the last thing a child saw before arriving disagreed with the
 * first thing she saw after.
 *
 * **A tree kind added here appears on the lane for free**, and cannot be
 * forgotten there. `theLanesGreeneryIsThePark'sOwnTrees` in
 * `test/procgen/invariants.ts` holds that door shut by checking geometry
 * *identity*, not shape: a new lookalike built in the lane goes red even if it
 * is pixel-identical, because the guard asks whether it is the **same
 * `BufferGeometry` object** the park draws.
 *
 * This is `CLAUDE.md`'s "two definitions of one thing, kept in step by hand"
 * rule applied to the thing there are most of.
 */
export type TreeKind = 'lollipop' | 'stack' | 'pine' | 'blossom';

/**
 * One instance to be drawn — a position, a size, a spin about Y and a colour.
 *
 * Deliberately plain data rather than an `Object3D`: a park's worth of trees is
 * a few thousand of these, they are composed into `InstancedMesh` matrices by
 * {@link makeInstanced}, and nothing ever needs to address one as a node.
 */
export interface InstanceItem {
  readonly position: Vector3;
  readonly scale: Vector3;
  readonly rotationY: number;
  readonly colour: number;
  /** Optional per-instance brightness multiplier, 1 = unchanged. */
  readonly shade: number;
}

/**
 * The three unit shapes every tree is built from — a `1`-scaled cylinder,
 * icosahedron and cone, stretched per-instance by the matrices composed from
 * the {@link InstanceItem}s {@link rollTree} returns.
 *
 * Module scope, and shared by identity rather than by construction, for three
 * separate reasons that all want the same thing:
 *
 * - `world/FoliageFade.ts` builds a stand-in `Mesh` for a fading tree out of
 *   the exact same geometry the instanced original uses, which is what
 *   guarantees the stand-in is pixel-identical rather than a hand-tuned
 *   approximation.
 * - The lane draws the same trees as the lawn, so a child arriving does not
 *   watch the scenery change species at the cut.
 * - Sharing one `BufferGeometry` across many meshes is what makes the identity
 *   check in the invariant above meaningful. Rebuild it per caller and the
 *   guard has nothing left to compare.
 */
export const FOLIAGE_GEOMETRY = {
  trunk: new CylinderGeometry(0.19, 0.3, 1, 8),
  round: new IcosahedronGeometry(1, 2),
  cone: new ConeGeometry(1, 1, 10),
};

/** The greens a canopy (or a bush) may be, picked per part. */
export const CANOPY_GREENS = [
  PALETTE.leafMid,
  PALETTE.leafLight,
  PALETTE.leafDeep,
  PALETTE.leafBlue,
];

/**
 * One trunk, canopy blob or cone layer belonging to a tree — everything a
 * stand-in needs to look exactly like the instanced original it is briefly
 * replacing. See `world/FoliageFade.ts`.
 */
export interface TreePart extends InstanceItem {
  readonly kind: 'trunk' | 'round' | 'cone';
}

/**
 * How far each kind of tree can possibly reach sideways from its trunk.
 *
 * These are the **ceilings of the rolls in {@link rollTree}**, not tuned
 * spacing numbers, and they have to be read off those rolls whenever they
 * change:
 *
 * - `pine` — cone widths roll `rng.range(1.7, 2.3)`, narrowing with height, all
 *   centred on the trunk. Ceiling 2.3.
 * - `stack` — canopy radii roll `rng.range(1.6, 2.05)`, narrowing per layer,
 *   centred. Ceiling 2.05.
 * - `lollipop` / `blossom` — a main ball of up to 2.5, plus the optional small
 *   ball tucked beside it at `radius * 0.7` carrying its own `radius * 0.72`.
 *   Ceiling `2.5 * (0.7 + 0.72)` = 3.55, and it is the side ball that makes
 *   these the widest thing on the lawn.
 *
 * Reserved before a tree is rolled in detail, so a candidate is refused for
 * the space it *could* take rather than the space it happens to take. That
 * over-reserves a little; two canopies growing through each other is the thing
 * being prevented, and 53 pairs of them were doing exactly that.
 *
 * The lane uses the same table for a different question — not "may two trees
 * overlap" but "how far out from the kerb must this one stand" — and that is
 * the right reuse: both are asking how wide a tree of this kind can get.
 */
export const TREE_REACH: Record<TreeKind, number> = {
  pine: 2.3,
  stack: 2.05,
  lollipop: 3.55,
  blossom: 3.55,
};

/**
 * How high each kind of tree can reach above its own ground, in metres.
 *
 * {@link TREE_REACH}'s vertical twin, reserved the same way and for the same
 * reason: a candidate is refused for the height it *could* take rather than the
 * height it happens to roll, because `clearOfCruiser` is asked before the
 * tree is rolled in detail. Ceilings, from the same literals {@link rollTree}
 * draws from — trunk `rng.range(2.3, 3.7)`, so 3.7 of trunk in every case,
 * plus:
 *
 * - `pine` — the top cone sits at most `1.5 * 2/3 - 0.6` above the trunk and is
 *   at most `2.2` tall on a `ConeGeometry(1, 1)`, so half of it clears the
 *   centre. Ceiling 3.7 + 1.36, rounded to 5.2.
 * - `stack` — the third blob rides `2 * radius * 0.92` up and adds its own
 *   radius on an `IcosahedronGeometry(1, …)`, which spans ±1. Ceiling 6.6.
 * - `lollipop` / `blossom` — a ball of up to 2.5 centred `radius * 0.42` above
 *   the trunk and standing `radius * 1.0` above that: `2.5 * 1.42` = 3.55, so
 *   7.25. These are the tallest thing on the lawn as well as the widest, and
 *   they are the reason this is a table rather than one number.
 *
 * The measured tallest canopy in the canonical park is 6.68 m, which sits
 * between the `stack` and `lollipop` ceilings exactly as it should.
 */
export const TREE_TOP: Record<TreeKind, number> = {
  pine: 5.2,
  stack: 6.6,
  lollipop: 7.25,
  blossom: 7.25,
};

/** The mix of kinds on the lawn — lollipops commonest, pines rarest. */
export function pickTreeKind(rng: Rng): TreeKind {
  const roll = rng.unit();
  if (roll < 0.44) return 'lollipop';
  if (roll < 0.68) return 'stack';
  if (roll < 0.86) return 'blossom';
  return 'pine';
}

/** A tree, rolled: its parts, and the facts a caller needs about the result. */
export interface RolledTree {
  /**
   * Every part, in build order — trunk first, then canopy. Order matters: the
   * caller files these into per-geometry instance arrays and remembers the
   * index of each, and `world/FoliageFade.ts` reads them back by that index.
   */
  readonly parts: readonly TreePart[];
  /** The widest blob's radius, for a cheap bounding sphere. */
  readonly wideRadius: number;
  /** …and that blob's centre height. */
  readonly wideCentreY: number;
  /** World-space top of the highest *ball* on this tree, or `-Infinity`. */
  readonly topBallTopY: number;
  /** …and that ball's radius, which is what decides whether it is climbable. */
  readonly topBallRadius: number;
  /** The trunk's horizontal scale, which its collider is taken from. */
  readonly lean: number;
  /** Bare trunk height, below the canopy. */
  readonly height: number;
}

/**
 * Rolls one tree of `kind`, standing on the ground at `(x, y, z)`.
 *
 * **The RNG draw order here is load-bearing.** The park's scatter gives every
 * candidate its own stream (`candidateRng`) and the parks it produces are
 * checked byte-for-byte, so reordering, adding or removing a single draw
 * re-rolls the tree — and a park that changes shape is not a refactor. This
 * function was lifted out of `Scenery.buildFoliage` draw-for-draw, including
 * the order the object literals below evaluate their properties in, which is
 * the order those `rng` calls happen in.
 */
export function rollTree(rng: Rng, kind: TreeKind, x: number, y: number, z: number): RolledTree {
  const height = rng.range(2.3, 3.7);
  const rotationY = rng.range(0, TAU);
  const lean = rng.range(0.92, 1.1);

  const parts: TreePart[] = [];
  let wideRadius = 0;
  let wideCentreY = y + height;
  // The highest *ball* on this tree, and how big it is — what decides whether
  // a child can climb it. Tracked across all three canopy branches, rather
  // than asked inside one of them: see `climbableTrees` in `Scenery.ts`.
  let topBallTopY = -Infinity;
  let topBallRadius = 0;
  const noteBall = (centreY: number, radius: number, halfHeight: number): void => {
    const top = centreY + halfHeight;
    if (top > topBallTopY) {
      topBallTopY = top;
      topBallRadius = radius;
    }
  };

  const trunkColour = rng.chance(0.4) ? PALETTE.barkDark : PALETTE.bark;
  const trunkShade = rng.range(0.92, 1.08);
  parts.push({
    kind: 'trunk',
    position: new Vector3(x, y + height / 2, z),
    scale: new Vector3(lean, height, lean),
    rotationY,
    colour: trunkColour,
    shade: trunkShade,
  });

  const canopyBase = y + height;
  if (kind === 'pine') {
    const layers = rng.int(2, 3);
    for (let i = 0; i < layers; i += 1) {
      const t = i / layers;
      const width = rng.range(1.7, 2.3) * (1 - t * 0.42);
      const coneItem: TreePart = {
        kind: 'cone',
        position: new Vector3(x, canopyBase - 0.6 + t * 1.5, z),
        scale: new Vector3(width, rng.range(1.6, 2.2) * (1 - t * 0.2), width),
        rotationY,
        colour: rng.chance(0.5) ? PALETTE.leafDeep : PALETTE.leafMid,
        shade: rng.range(0.94, 1.06),
      };
      if (width > wideRadius) {
        wideRadius = width;
        wideCentreY = coneItem.position.y;
      }
      parts.push(coneItem);
    }
  } else if (kind === 'stack') {
    const layers = 3;
    for (let i = 0; i < layers; i += 1) {
      const radius = rng.range(1.6, 2.05) * (1 - i * 0.22);
      const canopyItem: TreePart = {
        kind: 'round',
        position: new Vector3(x, canopyBase - 0.3 + i * radius * 0.92, z),
        scale: new Vector3(radius, radius * rng.range(0.8, 0.95), radius),
        rotationY: rotationY + i,
        colour: rng.pick(CANOPY_GREENS),
        shade: rng.range(0.95, 1.08),
      };
      if (radius > wideRadius) {
        wideRadius = radius;
        wideCentreY = canopyItem.position.y;
      }
      noteBall(canopyItem.position.y, radius, canopyItem.scale.y);
      parts.push(canopyItem);
    }
  } else {
    // Lollipop and blossom: one big friendly ball, sometimes with a smaller
    // one tucked beside it so the silhouette isn't a perfect circle.
    const radius = rng.range(1.75, 2.5);
    const colour = kind === 'blossom' ? PALETTE.blossomPink : rng.pick(CANOPY_GREENS);
    const canopyVScale = rng.range(0.82, 1.0);
    const canopyCentreY = canopyBase + radius * 0.42;
    const canopyItem: TreePart = {
      kind: 'round',
      position: new Vector3(x, canopyCentreY, z),
      scale: new Vector3(radius, radius * canopyVScale, radius),
      rotationY,
      colour,
      shade: rng.range(0.95, 1.06),
    };
    wideRadius = radius;
    wideCentreY = canopyCentreY;
    noteBall(canopyCentreY, radius, canopyItem.scale.y);
    parts.push(canopyItem);
    if (rng.chance(0.55)) {
      const small = radius * rng.range(0.5, 0.72);
      const offset = rng.range(0, TAU);
      const smallItem: TreePart = {
        kind: 'round',
        position: new Vector3(
          x + Math.cos(offset) * radius * 0.7,
          canopyBase + radius * rng.range(0.1, 0.5),
          z + Math.sin(offset) * radius * 0.7,
        ),
        scale: new Vector3(small, small * 0.9, small),
        rotationY: rotationY + 1.3,
        colour: kind === 'blossom' ? PALETTE.blossomWhite : colour,
        shade: rng.range(0.92, 1.04),
      };
      noteBall(smallItem.position.y, small, smallItem.scale.y);
      parts.push(smallItem);
    }
  }

  return { parts, wideRadius, wideCentreY, topBallTopY, topBallRadius, lean, height };
}

/**
 * Files a rolled tree's parts into the three per-geometry instance arrays that
 * {@link FOLIAGE_GEOMETRY} needs, and reports where each one landed.
 *
 * The returned refs are what lets a caller find an individual part again in the
 * finished `InstancedMesh` — `world/FoliageFade.ts` swaps single instances out
 * for translucent stand-ins and needs the index to do it.
 */
export function fileTreeParts(
  parts: readonly TreePart[],
  into: { trunk: InstanceItem[]; round: InstanceItem[]; cone: InstanceItem[] },
): { kind: 'trunk' | 'round' | 'cone'; index: number }[] {
  return parts.map((part) => {
    const bucket = into[part.kind];
    const index = bucket.length;
    bucket.push(part);
    return { kind: part.kind, index };
  });
}

/**
 * Foliage is toon-shaded like every other toy object in the park.
 *
 * `roughness` is retained in the signature for call-site compatibility and is
 * deliberately ignored — under toon shading it is the ramp, not a roughness
 * value, that decides how leaves shade. (Dead parameter; delete it once nothing
 * passes one.)
 */
export function foliageMaterial(_roughness: number): MeshToonMaterial {
  return toonMaterial(0xffffff);
}

const UP = new Vector3(0, 1, 0);

/** Composes a list of {@link InstanceItem}s into one `InstancedMesh`. */
export function makeInstanced(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  items: readonly InstanceItem[],
  shadows: boolean,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.count = items.length;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const colour = new Color();

  items.forEach((item, index) => {
    quaternion.setFromAxisAngle(UP, item.rotationY);
    matrix.compose(item.position, quaternion, item.scale);
    mesh.setMatrixAt(index, matrix);
    colour.setHex(item.colour).multiplyScalar(item.shade);
    mesh.setColorAt(index, colour);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
