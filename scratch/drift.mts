import { CollisionWorld } from '../src/world/Collision.ts';
import { GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { JUMP_SPEED, SimPlayer } from '../scripts/playerSim.mts';

const DT = 1 / 60;
for (const d of [0, 40, 80, 120, 157]) {
  const collision = new CollisionWorld();
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const p = new SimPlayer(collision, { ground: (x, z) => terrainHeight(x, z) });
  p.placeOnGround(d, 0);
  const sx = p.position.x, sz = p.position.z;
  p.verticalVelocity = JUMP_SPEED;
  p.airborne = true;
  let landedAt = -1;
  const at: Record<number, number> = {};
  for (let f = 0; f < 200; f += 1) {
    p.step(DT, 0, 0, false);
    if (landedAt < 0 && !p.airborne && f > 2) landedAt = f;
    if (landedAt >= 0 && [0, 1, 2, 5, 20].includes(f - landedAt)) {
      at[f - landedAt] = Math.hypot(p.position.x - sx, p.position.z - sz);
    }
    if (landedAt >= 0 && f - landedAt >= 20) break;
  }
  console.log(
    `d=${String(d).padStart(3)} drift at landing ${at[0].toFixed(4)}  +1 ${at[1].toFixed(4)}  +2 ${at[2].toFixed(4)}  +5 ${at[5].toFixed(4)}  +20 ${at[20].toFixed(4)}`,
  );
}
