/**
 * TEMP diagnostic (delete with the other probes): on seed 288, can a child walk
 * from the entrance to the three destinations in the bridge's far quarter?
 *
 * The far side of `bridge-walk-0` holds `ferrisWheel`, `stall.spaceFerrisWheel`
 * and `exit-ferrisWheel`, and all three drew **no ribbon at all**
 * (`paved=false`). Unpaved is not the same as unreachable — grass is walkable —
 * so this asks the walking question directly, with `reachableFromEntrance`, the
 * same `NavGrid` the game itself walks.
 *
 * **CONTROL, printed on the same run, because a flood fill that answers
 * everything the same way has answered nothing** (CLAUDE.md: two agents got
 * clean, decisive, wrong answers from flood fills and only a control caught
 * it): every other destination in the park is asked the same question, and a
 * point 400 m outside the boundary is asked it too. A run in which the far
 * quarter comes back unreachable is only evidence if the near quarter comes
 * back reachable and the point outside the park does not.
 */
import { describe, it, beforeAll } from 'vitest';
import { buildParkFacts, type ParkFacts } from './parkFacts.ts';

const FAR_QUARTER = ['ferrisWheel', 'stall.spaceFerrisWheel', 'exit-ferrisWheel'];

describe('TEMP seed 288 far-quarter reachability', () => {
  let facts: ParkFacts;
  beforeAll(async () => {
    facts = await buildParkFacts(288);
  }, 300_000);

  it('reports which destinations a child can walk to', () => {
    const say = (line: string): void => {
      process.stderr.write(`${line}\n`);
    };
    say('--- CONTROL: a point 400 m outside the park boundary ---');
    say(`  (400, 400) reachable=${facts.reachableFromEntrance(400, 400)}  (must be false)`);
    say('--- every destination node ---');
    for (const node of facts.pathNodes) {
      const reachable = facts.reachableFromEntrance(node.x, node.z);
      const standable = facts.isStandable(node.x, node.z);
      const paved = facts.pathEdges.some((edge) => edge.to === node.id || edge.from === node.id);
      let grass = Infinity;
      for (const edge of facts.pathEdges) {
        for (const p of edge.points) {
          const gap = Math.hypot(node.x - p[0], node.z - p[1]) - edge.halfWidth - node.reach;
          if (gap < grass) grass = gap;
        }
      }
      say(
        `  ${FAR_QUARTER.includes(node.id) ? 'FAR ' : '    '}${node.id.padEnd(28)} ` +
          `reachable=${String(reachable).padEnd(5)} standable=${String(standable).padEnd(5)} ` +
          `pavedRibbon=${String(paved).padEnd(5)} grassToNearestPaving=${Math.max(0, grass).toFixed(2)} m`,
      );
    }
  }, 300_000);
});
