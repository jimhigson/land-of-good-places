import { Sprite, SpriteMaterial, type Object3D } from 'three';
import { PALETTE } from '../../core/palette';
import type { Rng } from '../../core/mathUtils';
import { glowTexture } from '../../core/textures';

/**
 * **A fixed pool of glowing sprites that puff up and fade** — hearts over a
 * greeted snake, sparkles over a library card, a warm breath from a baby
 * dragon.
 *
 * Lifted verbatim out of `world/reptileHouse/ReptileHouse.ts`, where it was
 * the private `HeartPuffs`, because the library wants four of them (the card
 * sparkles, the glowing book's twinkle, the dragon's puffs, the cat's hearts)
 * and four private copies of one effect is CLAUDE.md's "two definitions of one
 * thing" four times over. The only things that were baked in and are now
 * parameters are the colour and the size; the defaults are the reptile
 * house's own pink hearts at 0.35, so `new SpritePuffs(hallRoot, 12)` is
 * exactly the effect it always was.
 *
 * **The rng draws are part of the contract.** `puff` takes two `rng.range`
 * draws per sprite, x then z, in that order — the same two, in the same order,
 * `HeartPuffs` took. The reptile house shares its seeded `Rng` with the rest of
 * its hall, so a different number of draws here would shift every later
 * random decision in the building.
 *
 * Like `rainbowRing.ts`, the reference effect: everything is allocated at
 * construction, a puff reuses the oldest slot, and nothing is `new`'d per
 * puff or per frame. Sprites live in `parent`'s coordinates.
 */
/** How long a puffed sprite lives, seconds, and how fast it rises, m/s — so a speaker can hang its bubble clear of the whole rise ({@link PUFF_RISE}). */
export const PUFF_LIFE = 1.2;
export const PUFF_RISE_SPEED = 0.8;
/** How far a puffed sprite's middle rises over its life, metres. */
export const PUFF_RISE = PUFF_LIFE * PUFF_RISE_SPEED;
/** The smallest a sprite gets, as a share of its puff's scale (at the end of its life). */
export const PUFF_END_SCALE = 0.6;

export class SpritePuffs {
  private readonly pool: Sprite[] = [];
  private readonly life: number[] = [];
  private readonly scale: number;
  private next = 0;

  constructor(parent: Object3D, count: number, colour: number = PALETTE.markerPink, scale = 0.35) {
    this.scale = scale;
    for (let i = 0; i < count; i += 1) {
      const sprite = new Sprite(new SpriteMaterial({ map: glowTexture(colour), transparent: true, depthWrite: false }));
      sprite.visible = false;
      sprite.scale.setScalar(scale);
      parent.add(sprite);
      this.pool.push(sprite);
      this.life.push(0);
    }
  }

  /** Every sprite of the pool, live or not (`visible` says which) — for a check to measure where they are drawn. */
  get sprites(): readonly Sprite[] {
    return this.pool;
  }

  /** `count` sprites at (x, y, z), each jittered ±0.3 m in x and z. */
  puff(x: number, y: number, z: number, rng: Rng, count = 3): void {
    for (let i = 0; i < count; i += 1) {
      const index = this.next;
      this.next = (this.next + 1) % this.pool.length;
      const sprite = this.pool[index]!;
      sprite.position.set(x + rng.range(-0.3, 0.3), y, z + rng.range(-0.3, 0.3));
      sprite.visible = true;
      this.life[index] = PUFF_LIFE;
    }
  }

  /** Rises, shrinks and fades every live sprite; call once a frame. */
  update(dt: number): void {
    this.pool.forEach((sprite, index) => {
      const life = this.life[index] ?? 0;
      if (life <= 0) return;
      const remaining = Math.max(0, life - dt);
      this.life[index] = remaining;
      sprite.position.y += dt * PUFF_RISE_SPEED;
      sprite.scale.setScalar(this.scale * (PUFF_END_SCALE + remaining / PUFF_LIFE));
      (sprite.material as SpriteMaterial).opacity = remaining / PUFF_LIFE;
      sprite.visible = remaining > 0;
    });
  }
}
