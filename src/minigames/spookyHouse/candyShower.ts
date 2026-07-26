import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, clamp01 } from '../../core/mathUtils';

/**
 * "Tap the mouth TWICE quickly → CANDY pours out" — a shower of colourful
 * wrapped-sweet billboards that bounce on the floor and are then collected.
 *
 * Billboards rather than the real `candyModel.ts` prop, on purpose and for the
 * same reason `railRacer/confetti.ts` is billboards rather than little paper
 * models: a shower needs a couple of dozen of these on screen at once, and an
 * `InstancedMesh` of planes is one draw call where two dozen real props would
 * be two dozen. The catalogue's `candy.spookyHouse` prop is what actually
 * represents "the candy" everywhere else in the game (backpack, Cute-o-dex);
 * these are just how it looks while it's still falling.
 *
 * `CANDY_COLOURS` below is deliberately just visual variety, not a set of
 * different collectibles — see the note on the catalogue entry in
 * `catalogue.ts`. One kind of sweet, several wrapper colours.
 */

const CAPACITY = 60;

const CANDY_COLOURS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerLilac,
  PALETTE.markerSky,
];

/** Floor of the little room, in world Y. Matches `room.ts`'s floor top. */
const FLOOR_Y = 0.02;

interface Candy {
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
  collected: boolean;
}

export interface CandyShower {
  readonly root: Group;
  /** Pours `count` sweets out from `origin`. */
  pour(origin: Vector3, count: number): void;
  /** Called once per piece the instant it is considered "collected". */
  update(dt: number, onCollect: () => void): void;
  dispose(): void;
}

export function createCandyShower(): CandyShower {
  const root = new Group();
  root.name = 'spookyHouse:candyShower';

  const geometry = new PlaneGeometry(0.22, 0.14);
  const material = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  const candies: Candy[] = [];
  const rng = new Rng(0xca4d1e);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3(0.4, 0.7, 0.2).normalize();
  const colour = new Color();

  return {
    root,

    pour(origin: Vector3, count: number): void {
      for (let i = 0; i < count; i += 1) {
        if (candies.length >= CAPACITY) break;
        const angle = rng.range(0, Math.PI * 2);
        const spread = rng.range(1.6, 3.4);
        candies.push({
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
          collected: false,
        });
        colour.setHex(rng.pick(CANDY_COLOURS));
        mesh.setColorAt(candies.length - 1, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt: number, onCollect: () => void): void {
      for (let i = candies.length - 1; i >= 0; i -= 1) {
        const c = candies[i];
        if (!c) continue;

        if (c.settledFor > 0) {
          c.settledFor -= dt;
          if (c.settledFor <= 0) {
            onCollect();
            const last = candies[candies.length - 1];
            if (last && last !== c) candies[i] = last;
            candies.pop();
            continue;
          }
        } else {
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
            // climbing much — then a short pause before it "pops" into the
            // backpack, so the collection reads as a sequence, not one burst.
            if (c.bounces >= 2 && Math.abs(c.vy) < 1.4) {
              c.settledFor = rng.range(0.15, 0.55);
            }
          }
        }
      }

      mesh.count = candies.length;
      for (let i = 0; i < candies.length; i += 1) {
        const c = candies[i];
        if (!c) continue;
        position.set(c.x, c.y, c.z);
        quaternion.setFromAxisAngle(axis, c.angle);
        const pop = c.settledFor > 0 ? clamp01(c.settledFor / 0.55) : 1;
        scale.setScalar(pop);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
