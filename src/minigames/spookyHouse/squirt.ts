import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, clamp01 } from '../../core/mathUtils';

/**
 * "Tap the mouth → water squirts out AT YOU" — a spray of droplets flying
 * straight down the camera's throat, plus a brief screen-splash overlay when
 * it lands. Silly, not startling: it is over in well under a second and the
 * droplets are toy-shop blue, never a realistic spray.
 *
 * The scene is built with the camera parked on the +Z side looking at the
 * face on the back wall (see `SpookyHouse.ts`), so "at the viewer" is simply
 * "along world +Z" — no need to read the camera back out, the same shortcut
 * `railRacer/confetti.ts` takes with "up".
 */

const CAPACITY = 90;

const DROPLET_COLOURS = [PALETTE.waterTop, PALETTE.waterDeep, PALETTE.waterFoam];

interface Droplet {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ttl: number;
  size: number;
}

export interface Squirt {
  readonly root: Group;
  /** Fires a spray from `origin`, toward the camera. */
  fire(origin: Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSquirt(): Squirt {
  const root = new Group();
  root.name = 'spookyHouse:squirt';

  const geometry = new SphereGeometry(0.09, 8, 6);
  const material = new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.92 });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  const droplets: Droplet[] = [];
  const rng = new Rng(0x5717e5);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const colour = new Color();

  return {
    root,

    fire(origin: Vector3): void {
      const count = 34;
      for (let i = 0; i < count; i += 1) {
        if (droplets.length >= CAPACITY) break;
        droplets.push({
          x: origin.x + rng.range(-0.12, 0.12),
          y: origin.y + rng.range(-0.1, 0.14),
          z: origin.z,
          vx: rng.range(-1.1, 1.1),
          vy: rng.range(-0.6, 1.6),
          vz: rng.range(9, 13),
          life: 0,
          ttl: rng.range(0.45, 0.62),
          size: rng.range(0.6, 1.3),
        });
        colour.setHex(rng.pick(DROPLET_COLOURS));
        mesh.setColorAt(droplets.length - 1, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt: number): void {
      for (let i = droplets.length - 1; i >= 0; i -= 1) {
        const d = droplets[i];
        if (!d) continue;
        d.life += dt;
        if (d.life >= d.ttl) {
          const last = droplets[droplets.length - 1];
          if (last && last !== d) droplets[i] = last;
          droplets.pop();
          continue;
        }
        // A little gravity so the spray arcs rather than flying dead straight.
        d.vy -= 3 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
      }

      mesh.count = droplets.length;
      for (let i = 0; i < droplets.length; i += 1) {
        const d = droplets[i];
        if (!d) continue;
        const t = clamp01(d.life / d.ttl);
        // Grows on the way to the viewer, then shrinks fast right at the end —
        // the orthographic-camera version of "getting closer", and it hides
        // the pop when a droplet is retired instead of just vanishing.
        const grow = t < 0.75 ? t / 0.75 : 1 - (t - 0.75) / 0.25;
        position.set(d.x, d.y, d.z);
        quaternion.identity();
        scale.setScalar(d.size * Math.max(0.05, grow));
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

// -------------------------------------------------------------- screen splash

export interface ScreenSplash {
  trigger(): void;
  update(dt: number): void;
  dispose(): void;
}

/**
 * A soft blue flash across the screen the instant the spray reaches the
 * viewer. Plain DOM rather than a shader quad (this game already has one
 * screen-space effect layer for free — the framework's `.mg-layer` — and a
 * `<div>` with a radial gradient is cheaper than a second render pass for
 * something this simple).
 */
export function createScreenSplash(container: HTMLElement): ScreenSplash {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  el.style.background = `radial-gradient(circle at 50% 62%, ${hexToRgba(PALETTE.waterTop, 0.55)} 0%, ${hexToRgba(PALETTE.waterDeep, 0.28)} 45%, transparent 72%)`;
  el.style.opacity = '0';
  container.appendChild(el);

  let timer = 0;
  const DURATION = 0.4;

  return {
    trigger(): void {
      timer = DURATION;
    },
    update(dt: number): void {
      if (timer <= 0 && el.style.opacity === '0') return;
      timer = Math.max(0, timer - dt);
      const t = clamp01(timer / DURATION);
      // Snappy in, gentle fade out.
      el.style.opacity = String(t * t);
    },
    dispose(): void {
      el.remove();
    },
  };
}

function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
