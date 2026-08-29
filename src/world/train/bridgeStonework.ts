import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3 } from 'three';
import type { SpineFrame } from './bridgeSpine';
import {
  COPING_HEIGHT,
  COPING_JOINT,
  COPING_LENGTH,
  COPING_SINK,
  KEYSTONE_PITCH,
  VOUSSOIR_PITCH,
  bridgeStoneGeometry,
} from '../../art/models/bridgeStones';

/**
 * **The bridge's arch curve, and the modelled stone it is dressed in.**
 *
 * Jim, 2026-08-29: *"a genuine arch-shaped tunnel with modelled archway
 * masonry around its edge"*, and *"modelled stoneworks (not just textures)
 * around the tops of the walls"*.
 *
 * Two things live here, together, on purpose:
 *
 * - {@link archCurve} — the **one owner** of the tunnel's shape. `bridges.ts`
 *   asks it where the soffit is; this module asks it where each voussoir goes.
 *   A ring laid on a curve that is not the curve the tunnel was cut to is the
 *   most obvious way this could go wrong, and one function answering both
 *   questions is what makes that impossible rather than merely unlikely
 *   (CLAUDE.md's "two definitions of one thing, kept in step by hand").
 * - {@link buildVoussoirRing} / {@link buildCopingRun} — the placement of the
 *   authored stones from `art/models/bridgeStones.ts`, baked into one
 *   `BufferGeometry` each so a bridge with 60-odd stones on it still costs one
 *   draw call.
 *
 * ## The arch is three-centred, and why
 *
 * The old soffit was a **flat crown** over the train's swept width with a
 * quarter-round haunch either side. That has a tangent break at the join and
 * reads flat from the mouth, which is the half of Jim's complaint a texture
 * could never have fixed.
 *
 * A genuine arch dips at the edge of the clear span, and the crown has to rise
 * by that dip, because the old crown sat *exactly* on `TRAIN_CLEARANCE_Y` with
 * nothing spare. Three shapes were costed against that (the dip measured at
 * `ARCH_CLEAR_HALF`):
 *
 * | shape | rise/span | extra crown |
 * | --- | --- | --- |
 * | semicircle | 0.50 | +0.554 m |
 * | three-centred, dip 0.35 | 0.38 | **+0.35 m** |
 * | three-centred, dip 0.10 | 0.26 | +0.10 m |
 *
 * The middle one. It is continuously curved — no flat segment, no tangent
 * break — visibly arched, and cheap enough that a 40%-shorter bridge still
 * comes in under `MAX_RAMP_GRADIENT` with room to spare. The semicircle is the
 * storybook ideal and would have spent the whole of that margin for 0.2 m more
 * curvature.
 *
 * The derivation is two tangent-continuous circular arcs: a big crown radius
 * `R1` chosen to give exactly {@link ARCH_CROWN_DIP} at the clear span, and a
 * tight haunch radius `R2` chosen so the curve reaches vertical exactly at the
 * springing. Both fall out of the two spans and the dip; nothing here is
 * hand-tuned.
 */

/**
 * How far the soffit dips, at the edge of the train's clear span, below the
 * crown — the one number that decides how arched the arch is, and the one
 * thing it costs the bridge. See this file's header for what the alternatives
 * were and what each was worth.
 */
export const ARCH_CROWN_DIP = 0.35;

/** The tunnel's shape at one bridge, in the frame's own (along, height) plane. */
export interface ArchCurve {
  /** Height of the soffit `alongAbs` metres from the crown. */
  soffitAt(alongAbs: number): number;
  /** Height of the springing, where the intrados turns vertical. */
  readonly springY: number;
  /** Arc length of the intrados from the crown to one springing. */
  readonly arcHalf: number;
  /** The intrados point at signed arc length `s`, and the outward (away from
   * the tunnel) unit normal there, as `(along, y, normalAlong, normalY)`. */
  at(s: number): { along: number; y: number; normalAlong: number; normalY: number };
}

/**
 * The three-centred arch for one bridge — see the header.
 *
 * `clearHalf` is the half-span that must clear the train at full height,
 * `spanHalf` the half-span of the whole opening, and `crownY` the soffit's own
 * height at the crown (already raised by {@link ARCH_CROWN_DIP} by the caller,
 * so that `crownY - ARCH_CROWN_DIP` is the height the train actually gets).
 */
export function archCurve(clearHalf: number, spanHalf: number, crownY: number): ArchCurve {
  const d = ARCH_CROWN_DIP;
  const r1 = (clearHalf * clearHalf + d * d) / (2 * d);
  const phi1 = Math.asin(clearHalf / r1);
  const r2 = (spanHalf - clearHalf) / (1 - Math.sin(phi1));
  const centre2Along = clearHalf - r2 * Math.sin(phi1);
  const springY = crownY - d - r2 * Math.cos(phi1);
  const arcCrown = r1 * phi1;
  const arcHalf = arcCrown + r2 * (Math.PI / 2 - phi1);

  return {
    springY,
    arcHalf,
    soffitAt: (alongAbs: number): number => {
      if (alongAbs <= 0) return crownY;
      if (alongAbs >= spanHalf) return springY;
      if (alongAbs <= clearHalf) {
        return crownY - (r1 - Math.sqrt(Math.max(0, r1 * r1 - alongAbs * alongAbs)));
      }
      const dx = alongAbs - centre2Along;
      return springY + Math.sqrt(Math.max(0, r2 * r2 - dx * dx));
    },
    at: (s: number) => {
      const sign = s >= 0 ? 1 : -1;
      const t = Math.abs(s);
      let theta: number;
      let along: number;
      let y: number;
      if (t <= arcCrown) {
        theta = t / r1;
        along = r1 * Math.sin(theta);
        y = crownY - r1 * (1 - Math.cos(theta));
      } else {
        theta = phi1 + (t - arcCrown) / r2;
        along = centre2Along + r2 * Math.sin(theta);
        y = springY + r2 * Math.cos(theta);
      }
      return {
        along: sign * along,
        y,
        normalAlong: sign * Math.sin(theta),
        normalY: Math.cos(theta),
      };
    },
  };
}

/**
 * The haunch radius the arch above works out to, for the span the park
 * actually uses — the figure `bridgeStones.ts`'s `VOUSSOIR_TAPER_RADIUS` cuts
 * the authored stone for. Exported so `bridges.ts` can assert the two agree
 * rather than leave a comment promising it.
 */
export function haunchRadius(clearHalf: number, spanHalf: number): number {
  const d = ARCH_CROWN_DIP;
  const r1 = (clearHalf * clearHalf + d * d) / (2 * d);
  return (spanHalf - clearHalf) / (1 - Math.sin(Math.asin(clearHalf / r1)));
}

/**
 * Concatenates transformed copies of one authored geometry into a single
 * indexed `BufferGeometry`.
 *
 * A bridge carries about twenty coping blocks a side and twenty-one voussoirs
 * a mouth. As `Mesh`es that is eighty-odd draw calls per bridge; baked, it is
 * one. The authored geometry is shared and is never mutated — every copy is
 * written into fresh arrays.
 */
function bakeInstances(source: BufferGeometry, matrices: readonly Matrix4[]): BufferGeometry {
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const index = source.getIndex();
  if (!position || !index) {
    throw new Error('bridgeStonework: an authored stone is missing positions or its index.');
  }

  const vertexCount = position.count;
  const positions = new Float32Array(vertexCount * 3 * matrices.length);
  const normals = normal ? new Float32Array(vertexCount * 3 * matrices.length) : null;
  const indices = new Uint32Array(index.count * matrices.length);

  const point = new Vector3();
  const direction = new Vector3();
  const normalMatrix = new Matrix3();

  matrices.forEach((matrix, copy) => {
    const vertexBase = copy * vertexCount;
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < vertexCount; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(matrix);
      const at = (vertexBase + i) * 3;
      positions[at] = point.x;
      positions[at + 1] = point.y;
      positions[at + 2] = point.z;
      if (normals && normal) {
        direction.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        normals[at] = direction.x;
        normals[at + 1] = direction.y;
        normals[at + 2] = direction.z;
      }
    }
    for (let i = 0; i < index.count; i += 1) {
      indices[copy * index.count + i] = vertexBase + index.getX(i);
    }
  });

  const baked = new BufferGeometry();
  baked.setAttribute('position', new BufferAttribute(positions, 3));
  if (normals) baked.setAttribute('normal', new BufferAttribute(normals, 3));
  baked.setIndex(new BufferAttribute(indices, 1));
  if (!normals) baked.computeVertexNormals();
  return baked;
}

/**
 * Builds the basis matrix for one authored stone.
 *
 * The kit's parts are authored with **+Y up and +Z forward**
 * (`ASSET_MANIFEST.md`'s contract), so placing one is a matter of saying what
 * "up" and "forward" mean at that spot — for a voussoir, radially out of the
 * arch and out of the tunnel mouth; for a coping block, perpendicular to the
 * road and along the parapet.
 */
function basisAt(up: Vector3, forward: Vector3, at: Vector3): Matrix4 {
  const y = up.clone().normalize();
  const z = forward.clone().normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  // Re-square `y` against the pair actually used, so a caller handing in a
  // "forward" that is not quite perpendicular gets an orthonormal basis rather
  // than a sheared stone.
  const trueY = new Vector3().crossVectors(z, x).normalize();
  return new Matrix4().makeBasis(x, trueY, z).setPosition(at);
}

/**
 * The modelled voussoir ring around one tunnel mouth.
 *
 * A keystone on the crown and voussoirs filling the rest at a pitch nudged so
 * a whole number of them lands exactly on the springing — a ring that closes
 * on the springing by construction cannot leave the half-stone gap a fixed
 * pitch would.
 *
 * Every stone is placed through the frame at its own `along`, never as one
 * rigid ring transformed as a piece: on a curving spine a rigid ring parts
 * company with the swept spandrel exactly the way the old `deckMesh` box did
 * (Jim, 2026-08-24, *"there's still a big hole in the mesh"*).
 */
export function buildVoussoirRing(
  frame: SpineFrame,
  shift: number,
  halfAcross: number,
  curve: ArchCurve,
): BufferGeometry {
  const available = curve.arcHalf - KEYSTONE_PITCH / 2;
  const count = Math.max(1, Math.round(available / VOUSSOIR_PITCH));
  const pitch = available / count;

  const stones: { s: number; keystone: boolean }[] = [{ s: 0, keystone: true }];
  for (let k = 0; k < count; k += 1) {
    const s = KEYSTONE_PITCH / 2 + pitch * (k + 0.5);
    stones.push({ s, keystone: false });
    stones.push({ s: -s, keystone: false });
  }

  const voussoirs: Matrix4[] = [];
  const keystones: Matrix4[] = [];
  for (const side of [1, -1] as const) {
    for (const stone of stones) {
      const { along, y, normalAlong, normalY } = curve.at(stone.s);
      const point = frame.pointAt(along);
      const world = frame.worldAt(along, side * halfAcross, shift);
      // "Up" is radially out of the arch, in the frame's own vertical plane;
      // "forward" is straight out of this mouth.
      const up = new Vector3(point.dirX * normalAlong, normalY, point.dirZ * normalAlong);
      const forward = new Vector3(point.acrossX * side, 0, point.acrossZ * side);
      const matrix = basisAt(up, forward, new Vector3(world.x, y, world.z));
      (stone.keystone ? keystones : voussoirs).push(matrix);
    }
  }

  const geometries = [
    bakeInstances(bridgeStoneGeometry('voussoir'), voussoirs),
    bakeInstances(bridgeStoneGeometry('keystone'), keystones),
  ];
  return mergeBaked(geometries);
}

/**
 * The modelled coping run along one bridge's two parapets.
 *
 * Blocks are laid at a pitch nudged to fit the parapet's own length exactly,
 * and each is tilted onto the local grade so the run flows over the hump
 * instead of stepping up it. Where the parapet has tapered away at a ramp foot
 * (`bridges.ts`'s `parapetHeightFor` — it does that so a wing wall does not
 * sever the path junction the foot lands in) there is no wall to cap, so no
 * block is laid: the coping follows the wall rather than asserting one.
 */
export function buildCopingRun(
  frame: SpineFrame,
  shift: number,
  wallLine: number,
  lengthNeg: number,
  lengthPos: number,
  parapetTopAt: (along: number, side: 1 | -1) => number | null,
): BufferGeometry {
  const matrices: Matrix4[] = [];
  const total = lengthNeg + lengthPos;
  const pitch = COPING_LENGTH;
  const count = Math.max(1, Math.round(total / pitch));
  const step = total / count;
  // The joint is the authored gap; the block itself is shorter than its pitch
  // by exactly that, so a run laid at `step` shows an even joint throughout
  // even after `step` has been nudged off `COPING_LENGTH` to fit the parapet.
  const scaleAlong = (step - COPING_JOINT) / (COPING_LENGTH - COPING_JOINT);

  for (const side of [1, -1] as const) {
    for (let i = 0; i < count; i += 1) {
      const along = -lengthNeg + step * (i + 0.5);
      const top = parapetTopAt(along, side);
      if (top === null) continue;

      const point = frame.pointAt(along);
      const world = frame.worldAt(along, wallLine * side, shift);
      // The local grade, measured off the parapet top itself rather than
      // re-derived from the hump profile — one owner for "how steep is it
      // here", and it stays right wherever the parapet is tapering.
      const behind = parapetTopAt(along - step / 2, side);
      const ahead = parapetTopAt(along + step / 2, side);
      const slope = behind !== null && ahead !== null ? (ahead - behind) / step : 0;

      const forward = new Vector3(point.dirX, slope, point.dirZ);
      const up = new Vector3(-point.dirX * slope, 1, -point.dirZ * slope);
      const matrix = basisAt(up, forward, new Vector3(world.x, top - COPING_SINK, world.z));
      matrix.scale(new Vector3(1, 1, scaleAlong));
      matrices.push(matrix);
    }
  }

  if (matrices.length === 0) return new BufferGeometry();
  return bakeInstances(bridgeStoneGeometry('coping'), matrices);
}

/** How far the modelled coping stands above the parapet top the shell sweeps —
 * what a caller has to leave clear above the wall. */
export const COPING_STAND = COPING_HEIGHT - COPING_SINK;

/** Concatenates already-baked geometries into one. */
function mergeBaked(parts: readonly BufferGeometry[]): BufferGeometry {
  const used = parts.filter((part) => part.getIndex() !== null);
  if (used.length === 1) return used[0] as BufferGeometry;

  let vertexTotal = 0;
  let indexTotal = 0;
  for (const part of used) {
    vertexTotal += (part.getAttribute('position') as BufferAttribute).count;
    indexTotal += (part.getIndex() as BufferAttribute).count;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(indexTotal);
  let vertexAt = 0;
  let indexAt = 0;
  for (const part of used) {
    const position = part.getAttribute('position') as BufferAttribute;
    const normal = part.getAttribute('normal') as BufferAttribute;
    const index = part.getIndex() as BufferAttribute;
    positions.set(position.array as Float32Array, vertexAt * 3);
    normals.set(normal.array as Float32Array, vertexAt * 3);
    for (let i = 0; i < index.count; i += 1) indices[indexAt + i] = index.getX(i) + vertexAt;
    vertexAt += position.count;
    indexAt += index.count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setAttribute('normal', new BufferAttribute(normals, 3));
  merged.setIndex(new BufferAttribute(indices, 1));
  return merged;
}
