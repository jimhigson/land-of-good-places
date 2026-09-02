/**
 * Probe: the park gate arch (`park-gate-arch`) — where its ring actually lies
 * in world space, how much of it is above ground, and whether anything solid
 * covers the parts a child can walk into.
 */
import { buildHeadlessPark } from './park-harness.mts';
import { Box3, Mesh, Vector3 } from 'three';
import { terrainHeight } from '../src/world/terrain.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

const arch = park.scene.getObjectByName('park-gate-arch');
if (!(arch instanceof Mesh)) throw new Error('no park-gate-arch mesh in the scene');

const box = new Box3().setFromObject(arch, true);
process.stdout.write(`park-gate-arch\n`);
process.stdout.write(`  position   ${arch.position.toArray().map((n) => n.toFixed(2)).join(', ')}\n`);
process.stdout.write(`  rotation   ${['x', 'y', 'z'].map((k) => `${k}=${(arch.rotation as unknown as Record<string, number>)[k].toFixed(3)}`).join(' ')}\n`);
process.stdout.write(`  world bbox min ${box.min.toArray().map((n) => n.toFixed(2)).join(', ')} max ${box.max.toArray().map((n) => n.toFixed(2)).join(', ')}\n`);

// Walk the ring's centre line in world space by transforming the ideal torus
// centre circle through the mesh's own world matrix — no re-deriving the maths.
const R = 4.3; // ENTRANCE_GATE_HALF_WIDTH — the torus radius as built
process.stdout.write(`\n  ring centre line (angle 0..PI), world:\n`);
const pts: Vector3[] = [];
for (let i = 0; i <= 12; i += 1) {
  const t = (i / 12) * Math.PI;
  const p = new Vector3(Math.cos(t) * R, Math.sin(t) * R, 0).applyMatrix4(arch.matrixWorld);
  pts.push(p);
  const ground = terrainHeight(p.x, p.z);
  process.stdout.write(
    `   t=${((t * 180) / Math.PI).toFixed(0).padStart(3)}deg  (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})  ` +
      `ground=${ground.toFixed(2)}  ${p.y > ground ? `ABOVE by ${(p.y - ground).toFixed(2)}` : `buried ${(ground - p.y).toFixed(2)}`}\n`,
  );
}

// Collision: can a child walk through the two above-ground horns?
const collision = park.world.collision;
process.stdout.write(`\n  collision at the ring's above-ground points (PLAYER_RADIUS=${PLAYER_RADIUS}):\n`);
for (const p of pts) {
  const ground = terrainHeight(p.x, p.z);
  if (p.y <= ground) continue;
  // March a player-sized body straight at the point from 2 m away, along z.
  const pos = new Vector3(p.x, ground, p.z - 2);
  for (let i = 0; i < 80; i += 1) collision.resolveMovement(pos, 0, 0.05, PLAYER_RADIUS);
  const reached = pos.z;
  process.stdout.write(
    `   at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) ring height ${(p.y - ground).toFixed(2)} m: ` +
      `marched to z=${reached.toFixed(2)} (target ${(p.z + 2).toFixed(2)}) — ` +
      `${reached > p.z + 0.3 ? 'walks straight through' : 'BLOCKED'}\n`,
  );
}
