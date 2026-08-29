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
 * nothing spare: the train's headroom is measured where the arch is *lowest*
 * over the track, not at its crown.
 *
 * **And the crown rising is not free** — it is deck height, and deck height on
 * a bridge 40% shorter is ramp slope. The Engineer's dimensional contract
 * (`HANDOFF-bridge-clipping-349.md`, #349) measures a 40%-shorter bridge's
 * peak slope at 0.693, which costs 0.428 m of climb in one clamped frame
 * against `BUILDING_STEP_UP`'s 0.620 m ceiling — 69% of it, where 79% is a
 * figure real-browser QA has watched a running child fall through. So every
 * centimetre this shape asks for is spent out of a budget that is already
 * short, and it was costed rather than chosen:
 *
 * | shape | arch rise/span | deck rise | peak slope | % of the fall-through ceiling |
 * | --- | --- | --- | --- | --- |
 * | flat crown (what it was) | — | 4.060 | 0.693 | 69% |
 * | three-centred, dip 0.10 | 0.26 | 4.160 | 0.710 | 71% |
 * | **three-centred, dip 0.18** | **0.30** | **4.240** | **0.723** | **72%** |
 * | three-centred, dip 0.25 | 0.33 | 4.310 | 0.735 | 73% |
 * | three-centred, dip 0.35 | 0.38 | 4.410 | 0.752 | 75% |
 * | semicircle | 0.50 | 4.614 | 0.787 | 78% |
 *
 * **Dip 0.18.** A rise/span of 0.30 is a textbook segmental arch — nobody will
 * look at it and see a flat lintel — and it buys that for three points of a
 * ten-point margin. The semicircle is the storybook ideal and would have spent
 * the entire margin, landing on the number QA has already seen break.
 *
 * This is deliberately **one tunable**, so the trade stays visible: if the
 * Engineer's fix for the fall-through buys slope margin back, raise it and the
 * arch gets rounder for free; if it does not, drop it to 0.10 and the arch is
 * still an arch. Re-run `npm run blend:bridge-stones` after either — the
 * authored voussoir is cut for the haunch radius this number decides, and
 * `bridges.ts` throws at load if the two stop agreeing.
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
export const ARCH_CROWN_DIP = 0.18;

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

  // --- the imposts ---------------------------------------------------------
  // A projecting block at each springing, the course an arch is built off. Two
  // per mouth, four per bridge.
  //
  // Without them the arch springs straight out of a plain wall, and the eye
  // reads the piers either side as part of the same flat face rather than as
  // what is holding the arch up — noted on the first render pass. A real
  // bridge always has this band, and it is the cheapest possible way to make
  // the arch look supported: one more copy of a stone already in the kit.
  const imposts: Matrix4[] = [];
  for (const side of [1, -1] as const) {
    for (const end of [1, -1] as const) {
      const { along, y } = curve.at(end * curve.arcHalf);
      const point = frame.pointAt(along);
      const world = frame.worldAt(along, side * halfAcross, shift);
      // Lying along the frame, level, with its top at the springing — the arch
      // starts exactly where this stone stops.
      const up = new Vector3(0, 1, 0);
      const forward = new Vector3(point.dirX, 0, point.dirZ);
      imposts.push(basisAt(up, forward, new Vector3(world.x, y - COPING_HEIGHT, world.z)));
    }
  }

  const geometries = [
    bakeInstances(bridgeStoneGeometry('voussoir'), voussoirs),
    bakeInstances(bridgeStoneGeometry('keystone'), keystones),
    bakeInstances(bridgeStoneGeometry('coping'), imposts),
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
  parapetLine: readonly {
    readonly along: number;
    readonly top: readonly [number, number];
    readonly surface: number;
  }[],
): BufferGeometry {
  if (parapetLine.length < 2) return new BufferGeometry();

  // **One block per shell segment**, rather than a run at the authored
  // `COPING_LENGTH`. The drawn parapet top is a polyline, and a rigid block
  // laid across one of its kinks cannot sit flush on both halves — measured at
  // up to 9.4 cm of daylight near a ramp foot, where the taper kinks hardest.
  // A block that spans exactly one straight segment has no kink inside it to
  // lift off, so it is flush by construction rather than by tolerance.
  //
  // `COPING_LENGTH` therefore stops being the pitch and becomes what it always
  // really was: the proportion the stone is modelled at. Each block is scaled
  // along its own length to the segment it caps.
  const matrices: Matrix4[] = [];

  for (const side of [0, 1] as const) {
    const sign = side === 0 ? 1 : -1;
    for (let i = 0; i + 1 < parapetLine.length; i += 1) {
      const a = parapetLine[i] as (typeof parapetLine)[number];
      const b = parapetLine[i + 1] as (typeof parapetLine)[number];
      // **Guarded at the joint, not at zero.** The scale below is
      // `(length - COPING_JOINT) / (COPING_LENGTH - COPING_JOINT)`, so it does
      // not degenerate at 0 — it goes through zero and turns **negative** at
      // `COPING_JOINT`, which flips the stone inside out and leaves its base no
      // longer following the wall. A `1e-6` guard lets every segment between
      // those two bounds through. `buildShellGeometry` no longer emits a
      // segment that short (it divides the span evenly rather than leaving a
      // remainder), but the two are separate modules and only this one knows
      // where its own arithmetic breaks down.
      const span = b.along - a.along;
      if (span <= COPING_JOINT) continue;

      // Nothing to cap where the parapet has tapered to less than the coping's
      // own thickness — at *either* end, so a block is never laid straddling
      // the spot where the wall runs out.
      const parapetA = (a.top[side] as number) - a.surface;
      const parapetB = (b.top[side] as number) - b.surface;
      if (Math.min(parapetA, parapetB) < COPING_HEIGHT) continue;

      // Placed on the **chord between the two ring points**, not on the
      // tangent at the segment's midpoint. The drawn wall quad *is* that
      // chord; on a curving spine a block laid along the midpoint tangent cuts
      // across it and its ends lift off (found on seeds 2 and 5 — up to
      // 0.173 m, and three blocks projecting off the quad strip entirely).
      // Laying the stone on the same two points the quad is built from makes
      // it coincide with the wall by construction rather than by proximity.
      const wallA = frame.worldAt(a.along, wallLine * sign, shift);
      const wallB = frame.worldAt(b.along, wallLine * sign, shift);
      const topA = a.top[side] as number;
      const topB = b.top[side] as number;

      const forward = new Vector3(wallB.x - wallA.x, topB - topA, wallB.z - wallA.z);
      const length = forward.length();
      if (length < 1e-6) continue;
      // "Up" is perpendicular to the chord, in the vertical plane containing
      // it — so the block's own base plane is the chord.
      const flat = Math.hypot(forward.x, forward.z) || 1;
      const slope = forward.y / flat;
      const up = new Vector3((-forward.x / flat) * slope, 1, (-forward.z / flat) * slope);

      const matrix = basisAt(
        up,
        forward,
        new Vector3(
          (wallA.x + wallB.x) / 2,
          (topA + topB) / 2 - COPING_SINK,
          (wallA.z + wallB.z) / 2,
        ),
      );
      // The block is shortened by the joint, then scaled to this segment. The
      // joint is taken in the block's own local length so it stays the same
      // visible gap whatever the segment measures.
      matrix.scale(new Vector3(1, 1, (length - COPING_JOINT) / (COPING_LENGTH - COPING_JOINT)));
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
