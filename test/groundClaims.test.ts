import { describe, it, expect } from 'vitest';
import type { Capsule, Claim, ClaimKind, Disc } from '../src/boot/groundClaims';
import {
  CLAIM_COMPATIBILITY,
  GroundClaims,
  overlapDepth,
  shapesOverlap,
} from '../src/boot/groundClaims';

/**
 * Unit tests for the ground-claims registry — pure and fast, no park. Each
 * rule of the compatibility table is exercised in both directions, every
 * geometry pairing is proved able to overlap AND able to clear (a test that
 * cannot fail is the repo's named disease), and the crossing exemption is
 * shown to be a gate, not a hole.
 */

const disc = (x: number, z: number, radius: number): Disc => ({ shape: 'disc', x, z, radius });
const capsule = (
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  halfWidth: number,
): Capsule => ({ shape: 'capsule', x1, z1, x2, z2, halfWidth });
const claim = (kind: ClaimKind, shape: Claim['shape']): Claim => ({ kind, shape });

const KINDS: readonly ClaimKind[] = ['footprint', 'corridor', 'walkable', 'surface'];

describe('CLAIM_COMPATIBILITY', () => {
  it('is symmetric — the law does not depend on who asks', () => {
    for (const a of KINDS) {
      for (const b of KINDS) {
        expect(CLAIM_COMPATIBILITY[a][b], `${a} vs ${b}`).toBe(CLAIM_COMPATIBILITY[b][a]);
      }
    }
  });

  it('nothing may share ground with a footprint', () => {
    for (const kind of KINDS) {
      expect(CLAIM_COMPATIBILITY[kind].footprint, `${kind} vs footprint`).toBe(false);
    }
  });
});

describe('shapesOverlap', () => {
  it('disc–disc: overlaps when radii meet, clears when they do not', () => {
    expect(shapesOverlap(disc(0, 0, 2), disc(3, 0, 2))).toBe(true);
    expect(shapesOverlap(disc(0, 0, 2), disc(5, 0, 2))).toBe(false);
  });

  it('disc–capsule: measured to the segment, not its endpoints', () => {
    const path = capsule(-10, 5, 10, 5, 1);
    expect(shapesOverlap(disc(0, 3.5, 1), path)).toBe(true); // 1.5 m gap < 2 m reach
    expect(shapesOverlap(disc(0, 8, 1), path)).toBe(false); // 3 m gap > 2 m reach
  });

  it('overlapDepth carries the real measurement, signed', () => {
    expect(overlapDepth(disc(0, 0, 2), disc(3, 0, 2))).toBeCloseTo(1); // 4 reach - 3 gap
    expect(overlapDepth(disc(0, 0, 2), disc(5, 0, 2))).toBeCloseTo(-1); // clear by 1
    expect(overlapDepth(disc(0, 3.5, 1), capsule(-10, 5, 10, 5, 1))).toBeCloseTo(0.5);
  });

  it('capsule–capsule: crossing segments overlap regardless of width', () => {
    expect(shapesOverlap(capsule(-5, 0, 5, 0, 0.1), capsule(0, -5, 0, 5, 0.1))).toBe(true);
  });

  it('capsule–capsule: parallel lanes overlap only inside the halo', () => {
    const a = capsule(0, 0, 10, 0, 1.5);
    // 2.5 m apart against a 2.4 m combined reach: clears by 0.1 m.
    expect(shapesOverlap(a, capsule(0, 2.5, 10, 2.5, 0.9))).toBe(false);
    // 2.3 m apart against the same reach: overlaps by 0.1 m.
    expect(shapesOverlap(a, capsule(0, 2.3, 10, 2.3, 0.9))).toBe(true);
  });
});

describe('GroundClaims', () => {
  it('refuses a footprint on a committed footprint, and allows it once clear', () => {
    const ground = new GroundClaims();
    ground.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] });
    expect(ground.allows('bridge', claim('footprint', disc(2, 0, 1)))).toBe(false);
    expect(ground.allows('bridge', claim('footprint', disc(10, 0, 1)))).toBe(true);
  });

  it('a feature never refuses itself — internal geometry is its own business', () => {
    const ground = new GroundClaims();
    ground.commit('paths', { claims: [claim('corridor', capsule(0, 0, 10, 0, 1.5))] });
    expect(ground.allows('paths', claim('corridor', capsule(5, -5, 5, 5, 1.5)))).toBe(true);
  });

  it('a corridor may cross a surface — the path over the bridge deck', () => {
    const ground = new GroundClaims();
    ground.commit('bridge', { claims: [claim('surface', capsule(0, -4, 0, 4, 2.5))] });
    expect(ground.allows('paths', claim('corridor', capsule(-6, 0, 6, 0, 1.5)))).toBe(true);
  });

  it('a solid may NOT stand on a surface, nor a surface on a solid', () => {
    const ground = new GroundClaims();
    ground.commit('bridge', { claims: [claim('surface', capsule(0, -4, 0, 4, 2.5))] });
    expect(ground.allows('lamps', claim('footprint', disc(0, 0, 0.4)))).toBe(false);
    const ground2 = new GroundClaims();
    ground2.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] });
    expect(ground2.allows('bridge', claim('surface', capsule(0, -4, 0, 4, 2.5)))).toBe(false);
  });

  it('nothing solid overlaps a walkable-must-remain; paving is welcome to', () => {
    const ground = new GroundClaims();
    ground.commit('hotel', { claims: [claim('walkable', disc(0, 0, 1.2))] });
    expect(ground.allows('fences', claim('footprint', capsule(-3, 0, 3, 0, 0.2)))).toBe(false);
    expect(ground.allows('paths', claim('corridor', capsule(-3, 0, 3, 0, 1.5)))).toBe(true);
  });

  it('two corridors may NOT share ground without a declared crossing', () => {
    const ground = new GroundClaims();
    ground.commit('railway', { claims: [claim('corridor', capsule(-20, 0, 20, 0, 2))] });
    expect(ground.allows('paths', claim('corridor', capsule(0, -10, 0, 10, 1.5)))).toBe(false);
  });

  it('a declared crossing legalises exactly the overlap at the crossing', () => {
    const ground = new GroundClaims();
    ground.commit('railway', {
      claims: [claim('corridor', capsule(-20, 0, 20, 0, 2))],
      crossings: [{ x: 0, z: 0, radius: 4, between: ['railway', 'paths'] }],
    });
    // The path through the declared crossing point: legal.
    expect(ground.allows('paths', claim('corridor', capsule(0, -10, 0, 10, 1.5)))).toBe(true);
    // The same path ten metres along the line: still a refusal — the
    // crossing is a gate, not a licence for the whole railway.
    expect(ground.allows('paths', claim('corridor', capsule(10, -10, 10, 10, 1.5)))).toBe(false);
    // A crossing declared between two OTHER features legalises nothing here.
    const ground2 = new GroundClaims();
    ground2.commit('railway', {
      claims: [claim('corridor', capsule(-20, 0, 20, 0, 2))],
      crossings: [{ x: 0, z: 0, radius: 4, between: ['railway', 'road'] }],
    });
    expect(ground2.allows('paths', claim('corridor', capsule(0, -10, 0, 10, 1.5)))).toBe(false);
  });

  it('a parallel lane-share that grazes the crossing zone is still refused', () => {
    const ground = new GroundClaims();
    ground.commit('railway', {
      claims: [claim('corridor', capsule(-20, 0, 20, 0, 2))],
      crossings: [{ x: -18, z: 0, radius: 3, between: ['railway', 'paths'] }],
    });
    // Runs alongside the railway for its whole length, sharing the lane; its
    // deepest overlap is nowhere near the crossing.
    expect(ground.allows('paths', claim('corridor', capsule(-20, 1, 20, 1, 1.5)))).toBe(false);
  });

  it('blockers names every refusing feature once, in commit order', () => {
    const ground = new GroundClaims();
    ground.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] });
    ground.commit('railway', { claims: [claim('corridor', capsule(-20, 5, 20, 5, 2))] });
    const wanted = [
      claim('corridor', capsule(0, -10, 0, 10, 1.5)), // through the statue AND the rail
      claim('corridor', capsule(0, 10, 10, 10, 1.5)), // clear
    ];
    expect(ground.blockers('paths', wanted).map((r) => r.feature)).toEqual([
      'statue',
      'railway',
    ]);
  });

  it('withdraw frees the ground — the backtrack', () => {
    const ground = new GroundClaims();
    ground.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] });
    expect(ground.allows('bridge', claim('footprint', disc(2, 0, 1)))).toBe(false);
    ground.withdraw('statue');
    expect(ground.allows('bridge', claim('footprint', disc(2, 0, 1)))).toBe(true);
  });

  it("a demand is served by another feature's corridor terminating on it", () => {
    const ground = new GroundClaims();
    ground.commit('hotel', {
      claims: [claim('walkable', disc(5, 5, 1.2))],
      demands: [{ x: 5, z: 5, radius: 1.2, label: 'hotel front door' }],
    });
    expect(ground.unservedDemands().map((u) => u.demand.label)).toEqual(['hotel front door']);
    ground.commit('paths', { claims: [claim('corridor', capsule(5, 5, 5, 15, 1.5))] });
    expect(ground.unservedDemands()).toEqual([]);
    // Withdrawing the paving un-serves it again — service is a live question,
    // never a latch.
    ground.withdraw('paths');
    expect(ground.unservedDemands().map((u) => u.demand.label)).toEqual(['hotel front door']);
  });

  it("a feature's OWN door stub never serves its own demand", () => {
    // The design's normal case: a building plants its stub and its demand in
    // one commit. The stub is the demand's mouth, not its answer — a hotel
    // alone in an empty park is UNSERVED until the network arrives.
    const ground = new GroundClaims();
    ground.commit('hotel', {
      claims: [
        claim('walkable', disc(5, 5, 1.2)),
        claim('corridor', capsule(5, 5, 5, 9, 1.5)), // its own perpendicular stub
      ],
      demands: [{ x: 5, z: 9, radius: 1.2, label: 'hotel stub free end' }],
    });
    expect(ground.unservedDemands().map((u) => u.demand.label)).toEqual(['hotel stub free end']);
    // The network joining the stub's free end is what serves it.
    ground.commit('paths', { claims: [claim('corridor', capsule(5, 9, 5, 30, 1.5))] });
    expect(ground.unservedDemands()).toEqual([]);
  });

  it('a corridor passing through without terminating does not serve', () => {
    // "Terminate here" means terminate: a 100 m road sailing straight past
    // the door leaves the child as cut off as no road at all.
    const ground = new GroundClaims();
    ground.commit('hotel', {
      claims: [claim('walkable', disc(5, 5, 1.2))],
      demands: [{ x: 5, z: 5, radius: 1.2, label: 'hotel front door' }],
    });
    ground.commit('roads', { claims: [claim('corridor', capsule(-50, 5, 50, 5, 1.5))] });
    expect(ground.unservedDemands().map((u) => u.demand.label)).toEqual(['hotel front door']);
  });

  it('a re-commit keeps its original order, so blocker order is stable', () => {
    const ground = new GroundClaims();
    ground.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] });
    ground.commit('railway', { claims: [claim('corridor', capsule(-20, 5, 20, 5, 2))] });
    ground.commit('statue', { claims: [claim('footprint', disc(0, 0, 3))] }); // re-commit
    const wanted = [claim('corridor', capsule(0, -10, 0, 10, 1.5))];
    expect(ground.blockers('paths', wanted).map((r) => r.feature)).toEqual([
      'statue',
      'railway',
    ]);
  });
});
