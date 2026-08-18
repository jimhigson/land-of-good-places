import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { toonMaterial } from '../../art/style/materials';

/**
 * "Tap the mouth TWICE quickly → CANDY pours out" — a shower of real,
 * toy-catalogue-styled sweets and candy canes that bounce on the floor and
 * then join a growing pile, rather than the flat colour-swap squares this
 * used to be.
 *
 * PR #294 review comment (18 August 2026, Jim): "the candy should be more
 * realistic (not just squares, actually wrapped sweets of various sizes and
 * candy canes) and pile up at the bottom of the screen." Two changes from the
 * original billboard shower, each its own section below:
 *
 * ## Real shapes, not flat squares
 *
 * The catalogue's actual `candy.spookyHouse` collectible
 * (`candyModel.ts`'s `createSpookyCandy`) is a wrapped sweet built from a
 * squashed-sphere body plus two cone "twist" ends — that shape is *reused*
 * here rather than reinvented, because that is what "the candy" already
 * looks like everywhere else in the game (backpack peek, Cute-o-dex). It
 * cannot be used directly, though: that factory returns a `Group` of several
 * `Mesh`es built for one held or shelved item, and a shower needs a couple of
 * dozen of these bouncing at once — a `Group` per piece would be a
 * `Group`-and-several-`Mesh`es-per-piece, i.e. real scene-graph and draw-call
 * cost for something that only ever needs a position, a colour and a spin
 * (`Flowers.ts`'s "no per-flower objects" reasoning applies here too). So the
 * same body-plus-twists shape is rebuilt as one **merged** `BufferGeometry`
 * (`buildSweetGeometry`, same technique as `Flowers.ts`'s `petalRingGeometry`)
 * and drawn as an `InstancedMesh` — one draw call for every sweet on screen,
 * whatever its wrapper colour or size. A second merged geometry
 * (`buildCaneGeometry`) is a bent, striped candy cane, in its own
 * `InstancedMesh` — a torus "hook" merged onto a cylinder "shaft" cannot share
 * one instance buffer with the sweet's shape (different geometry, different
 * vertex count), so it is a second draw call, not a second kind of instance
 * in the first mesh.
 *
 * Both shapes carry their own baked-in **vertex colours** (the sweet's foil
 * twists a shade duller than its body; the cane's red/cream stripes) so that
 * `InstancedMesh.setColorAt`'s per-instance tint (the sweet's wrapper colour;
 * left untouched on the cane, whose stripes are already coloured) multiplies
 * against real per-part shading instead of flattening the whole piece to one
 * flat colour the way the old plane billboard did.
 *
 * "Various sizes" is a continuous per-instance scale
 * ({@link SWEET_SIZE_RANGE}/{@link CANE_SIZE_RANGE}) baked into each
 * instance's own matrix, not a set of discrete extra geometries — cheaper,
 * and it reads exactly the same to a six-year-old as a shelf of pre-sized
 * sweets would.
 *
 * ## Piling, not popping
 *
 * The old shower shrank each landed piece to nothing and removed it
 * (`onCollect()` firing at that instant, ART_DIRECTION's "pop into the
 * backpack" moment) — the design comment called this "how the collection
 * reads as a sequence, not one burst". That is why a short `settledFor`
 * pause between landing and finishing still exists below: it is the same
 * pacing device, kept. What changed is what happens at the *end* of that
 * pause: the piece is marked `piled` and stays exactly where it landed,
 * frozen, forever (or until the visit ends and the whole shower is
 * disposed) — `onCollect()` still fires at that exact instant, so the
 * backpack/candy-count/sound side of "collecting" a sweet is completely
 * unchanged; only the *visual* piece no longer vanishes. With the isometric,
 * fixed camera this room already uses (`SpookyHouse.ts`'s `CAMERA_POS`/
 * `CAMERA_TARGET`), sweets landing near the mouth and staying put reads as
 * exactly the "pile at the bottom of the screen" that was asked for, without
 * needing any screen-space UI layer — see the room's own camera framing.
 *
 * A pile that never shrinks needs a cap, or `InstancedMesh`'s fixed capacity
 * (`SWEET_CAPACITY`/`CANE_CAPACITY`, raised from the old flat 60 total to 80
 * — see the constants below for why) would eventually be exceeded by a child
 * who keeps double-tapping the mouth all visit. `pour()` handles that by
 * **evicting the oldest already-piled piece of the same kind** to make room
 * for a freshly poured one the moment a kind's cap would be exceeded — the
 * pile keeps growing in front of you, and only ever loses its oldest,
 * furthest-back piece to do it, never a piece still mid-air.
 */

const HALF_TAU_ISH = Math.PI; // half circle, for the cane's hook — named for readability at the call site below.

/** How many sweets can be on screen (falling or piled) at once. */
const SWEET_CAPACITY = 64;
/**
 * How many candy canes can be on screen at once. Deliberately smaller than
 * {@link SWEET_CAPACITY} — canes are the rarer treat (see {@link CANE_SHARE}),
 * so they need a smaller share of the buffer, not an equal one.
 *
 * {@link SWEET_CAPACITY} + this used to just be `CAPACITY = 60` when every
 * piece was an identical square that vanished within about a second of
 * landing, so 60-in-flight-at-once was already generous headroom. Now that a
 * landed piece stays forever (this file's whole "piling, not popping"
 * change), the buffer has to hold a whole *visit's* worth of pile, not just
 * whatever is mid-air at any instant — raised to a total of 80 as a modest,
 * still-cheap increase (two draw calls, not sixty individual ones), with
 * `pour()`'s oldest-piece eviction as the backstop for anyone who empties the
 * mouth more than that in one visit.
 */
const CANE_CAPACITY = 16;

/** Share of each poured piece that is a candy cane rather than a wrapped sweet. */
const CANE_SHARE = 0.22;

const SWEET_SIZE_RANGE: readonly [number, number] = [0.65, 1.35];
const CANE_SIZE_RANGE: readonly [number, number] = [0.78, 1.18];

/** Seconds a landed piece pauses before it finishes settling into the pile — see the "piling, not popping" note above. */
const SETTLE_PAUSE_RANGE: readonly [number, number] = [0.15, 0.55];

/** How long the little landing "plop" squash lasts, once a piece joins the pile. */
const LAND_FLOURISH_SECONDS = 0.28;

/** Wrapper colours for the sweet — deliberately just visual variety, not different collectibles (see the catalogue note on `candy.spookyHouse`). */
const WRAPPER_COLOURS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerLilac,
  PALETTE.markerSky,
];

/** Floor of the little room, in world Y. Matches `room.ts`'s floor top. */
const FLOOR_Y = 0.02;

type CandyKind = 'sweet' | 'cane';

interface Candy {
  kind: CandyKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  angle: number;
  bounces: number;
  settledFor: number;
  /** Uniform scale for this one instance — "various sizes" is per-piece, not per-geometry. */
  size: number;
  /** Wrapper tint for a sweet; ignored (the cane's stripes are already coloured) for a cane. */
  wrapperColour: number;
  /** Once true this piece is done moving and permanently part of the pile — see the file doc's "piling, not popping" section. */
  piled: boolean;
  /** 1 right when a piece joins the pile, decaying to 0 — a tiny landing squash, purely cosmetic. */
  landFlourish: number;
  /** Insertion order, so `pour()` can evict the single OLDEST piled piece of a kind when its capacity is full, never an arbitrary one. */
  order: number;
}

export interface CandyShower {
  readonly root: Group;
  /** Pours `count` sweets out from `origin`. */
  pour(origin: Vector3, count: number): void;
  /** Called once per piece the instant it joins the pile — still the game's "this sweet is collected" moment. */
  update(dt: number, onCollect: () => void): void;
  dispose(): void;
}

/**
 * The catalogue's wrapped-sweet shape (`candyModel.ts`'s `createSpookyCandy`),
 * rebuilt as one merged, instance-ready `BufferGeometry`: a squashed-sphere
 * body plus two cone "twist" ends, proportioned exactly the same way. The
 * body is painted plain white so the per-instance wrapper colour
 * (`InstancedMesh.setColorAt`) shows through true; the twists are painted a
 * touch duller so they read as a slightly different material (foil) even
 * though both are tinted by the same per-instance colour.
 *
 * Dropped so its own lowest point sits at local Y = 0 — the same "origin at
 * the base" contract `candyModel.ts` uses — so placing an instance's matrix
 * at the pile's contact height rests it on the floor with nothing clipping
 * through it.
 */
function buildSweetGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.075, 12, 8);
  body.scale(1, 0.62, 0.62);
  body.rotateZ(Math.PI / 2);
  paintSolidVertexColour(body, 1, 1, 1);

  const parts: BufferGeometry[] = [body];
  for (const side of [-1, 1] as const) {
    const twist = new ConeGeometry(0.052, 0.075, 8);
    twist.scale(1, 1, 0.55);
    twist.rotateZ(side * (Math.PI / 2 - 0.5));
    twist.translate(side * 0.095, 0, 0);
    paintSolidVertexColour(twist, 0.82, 0.79, 0.76);
    parts.push(twist);
  }

  const merged = mergeGeometries(parts, false) ?? body;
  for (const part of parts) if (part !== merged) part.dispose();
  dropToLocalFloor(merged);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * A candy cane: a thin striped shaft with a half-loop "hook" curled over the
 * top, built from a `CylinderGeometry` shaft and a half `TorusGeometry` hook
 * merged into one instance-ready geometry — no existing prop to reuse here
 * (unlike the sweet above), so this is new geometry, kept as toy-simple as
 * the rest of the catalogue: low segment counts, no part thinner than the
 * outline width used elsewhere would allow.
 *
 * The hook is positioned so its start is tangent to the shaft's own top —
 * `TorusGeometry`'s arc begins at `(radius, 0, 0)` with a vertical tangent,
 * so translating it by `(-radius, shaftLength, 0)` lands that start exactly
 * on top of the shaft with no seam, then the arc curls up and back down into
 * the familiar hook shape.
 *
 * Stripes are baked as vertex colours banded by each vertex's own final Y —
 * continuous red/cream bands up the shaft and round the hook, the same way a
 * real cane's spiral reads from a distance.
 */
function buildCaneGeometry(): BufferGeometry {
  const SHAFT_LEN = 0.15;
  const HOOK_RADIUS = 0.035;
  const TUBE_RADIUS = 0.012;
  const STRIPE_PERIOD = 0.045;

  const shaft = new CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, SHAFT_LEN, 8, 6);
  shaft.translate(0, SHAFT_LEN / 2, 0);
  paintStripedVertexColour(shaft, STRIPE_PERIOD);

  const hook = new TorusGeometry(HOOK_RADIUS, TUBE_RADIUS, 6, 12, HALF_TAU_ISH);
  hook.translate(-HOOK_RADIUS, SHAFT_LEN, 0);
  paintStripedVertexColour(hook, STRIPE_PERIOD);

  const parts = [shaft, hook];
  const merged = mergeGeometries(parts, false) ?? shaft;
  for (const part of parts) if (part !== merged) part.dispose();
  dropToLocalFloor(merged);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** Paints every vertex of `geometry` the same flat colour — used for the sweet's body/twist tint pass, before the per-instance wrapper colour multiplies over it. */
function paintSolidVertexColour(geometry: BufferGeometry, r: number, g: number, b: number): void {
  const count = geometry.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
}

/** Bands `geometry`'s vertices red/cream by their own final Y — the cane's stripes. */
function paintStripedVertexColour(geometry: BufferGeometry, period: number): void {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const band = Math.floor(position.getY(i) / period);
    const isRed = (((band % 2) + 2) % 2) === 0;
    if (isRed) {
      colours[i * 3] = 0.82;
      colours[i * 3 + 1] = 0.14;
      colours[i * 3 + 2] = 0.2;
    } else {
      colours[i * 3] = 0.97;
      colours[i * 3 + 1] = 0.94;
      colours[i * 3 + 2] = 0.88;
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
}

/** Translates `geometry` so its own lowest vertex sits at local Y = 0 — "origin at the base", matching every other prop in the catalogue. */
function dropToLocalFloor(geometry: BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  geometry.translate(0, -box.min.y, 0);
}

export function createCandyShower(): CandyShower {
  const root = new Group();
  root.name = 'spookyHouse:candyShower';

  const sweetMaterial = toonMaterial(0xffffff);
  sweetMaterial.vertexColors = true;
  const sweetMesh = new InstancedMesh(buildSweetGeometry(), sweetMaterial, SWEET_CAPACITY);
  sweetMesh.frustumCulled = false;
  sweetMesh.count = 0;
  sweetMesh.name = 'spookyHouse:candySweets';

  const caneMaterial = toonMaterial(0xffffff);
  caneMaterial.vertexColors = true;
  const caneMesh = new InstancedMesh(buildCaneGeometry(), caneMaterial, CANE_CAPACITY);
  caneMesh.frustumCulled = false;
  caneMesh.count = 0;
  caneMesh.name = 'spookyHouse:candyCanes';

  root.add(sweetMesh, caneMesh);

  const candies: Candy[] = [];
  let spawnCounter = 0;
  const rng = new Rng(0xca4d1e);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3(0.4, 0.7, 0.2).normalize();
  const colour = new Color();

  /** Frees up one slot of `kind` by dropping the single oldest already-piled piece of that kind. Returns whether a slot was freed. */
  function evictOldestPiled(kind: CandyKind): boolean {
    let oldestIndex = -1;
    let oldestOrder = Infinity;
    for (let i = 0; i < candies.length; i += 1) {
      const c = candies[i];
      if (c && c.piled && c.kind === kind && c.order < oldestOrder) {
        oldestOrder = c.order;
        oldestIndex = i;
      }
    }
    if (oldestIndex === -1) return false;
    const last = candies[candies.length - 1];
    if (last) candies[oldestIndex] = last;
    candies.pop();
    return true;
  }

  function countOfKind(kind: CandyKind): number {
    let n = 0;
    for (const c of candies) if (c.kind === kind) n += 1;
    return n;
  }

  return {
    root,

    pour(origin: Vector3, count: number): void {
      for (let i = 0; i < count; i += 1) {
        const kind: CandyKind = rng.chance(CANE_SHARE) ? 'cane' : 'sweet';
        const capacity = kind === 'cane' ? CANE_CAPACITY : SWEET_CAPACITY;

        if (countOfKind(kind) >= capacity) {
          // Make room by clearing the oldest already-settled piece of the
          // same kind first — see the file doc's eviction note. If every
          // piece of this kind is still mid-air (nothing piled yet to
          // evict), this pour's piece is quietly dropped rather than
          // exceeding the InstancedMesh's fixed capacity.
          if (!evictOldestPiled(kind)) continue;
        }

        const angle = rng.range(0, Math.PI * 2);
        const spread = rng.range(1.6, 3.4);
        const [sizeMin, sizeMax] = kind === 'cane' ? CANE_SIZE_RANGE : SWEET_SIZE_RANGE;
        candies.push({
          kind,
          x: origin.x,
          y: origin.y,
          z: origin.z,
          vx: Math.cos(angle) * spread * 0.5,
          vy: rng.range(1.5, 3.4),
          vz: rng.range(2.5, 4.5) + Math.sin(angle) * spread * 0.3,
          spin: rng.range(-7, 7),
          angle: rng.range(0, Math.PI * 2),
          bounces: 0,
          settledFor: 0,
          size: rng.range(sizeMin, sizeMax),
          wrapperColour: rng.pick(WRAPPER_COLOURS),
          piled: false,
          landFlourish: 0,
          order: spawnCounter,
        });
        spawnCounter += 1;
      }
    },

    update(dt: number, onCollect: () => void): void {
      for (const c of candies) {
        if (c.piled) {
          if (c.landFlourish > 0) {
            c.landFlourish = Math.max(0, c.landFlourish - dt / LAND_FLOURISH_SECONDS);
          }
          continue;
        }

        if (c.settledFor > 0) {
          c.settledFor -= dt;
          if (c.settledFor <= 0) {
            // Frozen in place, forever part of the pile — see "piling, not
            // popping" above. `onCollect()` fires here, exactly the instant
            // it always used to, so the backpack/candy-count/sound side of
            // collecting is unchanged; only the visual piece no longer
            // disappears afterwards.
            c.vx = 0;
            c.vy = 0;
            c.vz = 0;
            c.spin = 0;
            c.piled = true;
            c.landFlourish = 1;
            onCollect();
          }
          continue;
        }

        c.vy -= 9 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.angle += c.spin * dt;

        if (c.y <= FLOOR_Y && c.vy < 0) {
          c.y = FLOOR_Y;
          c.vy = -c.vy * 0.42;
          c.vx *= 0.6;
          c.vz *= 0.6;
          c.bounces += 1;
          // Settled once it has bounced a couple of times and stopped
          // climbing much — then a short pause before it joins the pile, so
          // several pieces poured together still land as a little sequence
          // rather than all freezing on the same frame.
          if (c.bounces >= 2 && Math.abs(c.vy) < 1.4) {
            c.settledFor = rng.range(...SETTLE_PAUSE_RANGE);
          }
        }
      }

      let sweetIndex = 0;
      let caneIndex = 0;
      for (const c of candies) {
        position.set(c.x, c.y, c.z);
        quaternion.setFromAxisAngle(axis, c.angle);
        // A settling piece keeps its usual size throughout (it never shrinks
        // away any more); a freshly-piled one gets a brief squash-and-grow
        // "plop" — purely cosmetic landing juice, decaying over
        // LAND_FLOURISH_SECONDS.
        const flourish = c.piled ? 1 + c.landFlourish * 0.22 : 1;
        scale.setScalar(c.size * flourish);
        matrix.compose(position, quaternion, scale);

        if (c.kind === 'cane') {
          caneMesh.setMatrixAt(caneIndex, matrix);
          caneIndex += 1;
        } else {
          colour.setHex(c.wrapperColour);
          sweetMesh.setMatrixAt(sweetIndex, matrix);
          sweetMesh.setColorAt(sweetIndex, colour);
          sweetIndex += 1;
        }
      }

      sweetMesh.count = sweetIndex;
      caneMesh.count = caneIndex;
      sweetMesh.instanceMatrix.needsUpdate = true;
      caneMesh.instanceMatrix.needsUpdate = true;
      if (sweetMesh.instanceColor) sweetMesh.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      sweetMesh.geometry.dispose();
      sweetMaterial.dispose();
      sweetMesh.dispose();
      caneMesh.geometry.dispose();
      caneMaterial.dispose();
      caneMesh.dispose();
    },
  };
}
