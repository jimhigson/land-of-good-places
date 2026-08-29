/**
 * Casts a fan of rays from the orbit315 camera (the shot showing a pale grey
 * plane slicing through bridge-172.0) and names every object each ray meets.
 */
import './scripts/headless-canvas.mjs';
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { Raycaster, Vector3, Box3, Mesh, type Object3D } from 'three';
import { readFileSync } from 'node:fs';

const park = buildHeadlessPark();
const scene = (park as unknown as { scene: Object3D }).scene;
scene.updateMatrixWorld(true);

const shots: [string, string, string][] = JSON.parse(readFileSync('/tmp/shots-349.json', 'utf8'));
const shot = shots.find((s) => s[0] === 'bridge1720-orbit315')!;
const [cx, cy, cz] = shot[1].split(',').map(Number) as [number, number, number];
const [dx, dy, dz] = shot[2].split(',').map(Number) as [number, number, number];

const origin = new Vector3(cx, cy, cz);
const forward = new Vector3(dx, dy, dz).normalize();
const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
const up = new Vector3().crossVectors(right, forward).normalize();

const pathOf = (o: Object3D): string => {
  const parts: string[] = [];
  let n: Object3D | null = o;
  while (n) { parts.unshift(n.name || n.type); n = n.parent; }
  return parts.join('/');
};

// Meshes only. The park's NPC name labels are Sprites, and Sprite.raycast
// dereferences `raycaster.camera`, which a bare Raycaster has not got.
const meshes: Mesh[] = [];
scene.traverse((o) => { if (o instanceof Mesh && o.visible) meshes.push(o); });
console.log(`raycasting against ${meshes.length} visible meshes`);

const seen = new Map<string, { hits: number; near: number; far: number; ymin: number; ymax: number }>();
const ray = new Raycaster();
ray.far = 60;

// ~35 degree half-angle fan, matching roughly what the screenshot frames.
const N = 26;
for (let iy = -N; iy <= N; iy += 1) {
  for (let ix = -N; ix <= N; ix += 1) {
    const ax = (ix / N) * 0.55;
    const ay = (iy / N) * 0.40;
    const dir = forward.clone().addScaledVector(right, ax).addScaledVector(up, ay).normalize();
    ray.set(origin, dir);
    for (const hit of ray.intersectObjects(meshes, false)) {
      const o = hit.object;
      if (!(o instanceof Mesh)) continue;
      if (!o.visible) continue;
      const p = pathOf(o);
      const e = seen.get(p) ?? { hits: 0, near: Infinity, far: -Infinity, ymin: Infinity, ymax: -Infinity };
      e.hits += 1;
      e.near = Math.min(e.near, hit.distance);
      e.far = Math.max(e.far, hit.distance);
      e.ymin = Math.min(e.ymin, hit.point.y);
      e.ymax = Math.max(e.ymax, hit.point.y);
      seen.set(p, e);
      break; // first visible hit only — what the camera actually sees
    }
  }
}

console.log(`camera ${origin.toArray().map((n) => n.toFixed(2)).join(',')} -> ${forward.toArray().map((n) => n.toFixed(2)).join(',')}`);
console.log('\nWhat the camera actually sees, by pixel count:');
const rows = [...seen.entries()].sort((a, b) => b[1].hits - a[1].hits);
for (const [p, e] of rows) {
  console.log(
    `  ${String(e.hits).padStart(5)} rays  d ${e.near.toFixed(1)}..${e.far.toFixed(1)}  ` +
      `y ${e.ymin.toFixed(2)}..${e.ymax.toFixed(2)}  ${p}`,
  );
}

// And specifically: anything drawn that is not the bridge, standing inside the
// bridge's own masonry bounds.
const bridges = park.world.train.group.getObjectByName('railway-bridges')!;
const group = bridges.children.find((c) => c.name === 'bridge-172.0')!;
const masonry = new Box3();
group.traverse((o) => { if (o instanceof Mesh && o.name !== 'deck') masonry.expandByObject(o); });
console.log('\nVisible non-bridge geometry with a hit point INSIDE the masonry bounds:');
const inside = new Map<string, number>();
for (let iy = -N; iy <= N; iy += 1) {
  for (let ix = -N; ix <= N; ix += 1) {
    const dir = forward.clone()
      .addScaledVector(right, (ix / N) * 0.55)
      .addScaledVector(up, (iy / N) * 0.40).normalize();
    ray.set(origin, dir);
    for (const hit of ray.intersectObjects(meshes, false)) {
      const o = hit.object;
      if (!(o instanceof Mesh) || !o.visible) continue;
      let n: Object3D | null = o; let own = false;
      while (n) { if (n === group) { own = true; break; } n = n.parent; }
      if (!own && masonry.containsPoint(hit.point)) {
        const p = pathOf(o);
        inside.set(p, (inside.get(p) ?? 0) + 1);
      }
      break;
    }
  }
}
for (const [p, n] of [...inside.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)} rays  ${p}`);
}
