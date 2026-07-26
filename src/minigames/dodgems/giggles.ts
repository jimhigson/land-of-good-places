import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { PALETTE, hexToCss } from '../../core/palette';
import { Rng, clamp01 } from '../../core/mathUtils';

/**
 * "hee hee!" — the little giggle bubbles that pop over a car when it is bumped.
 *
 * The design asks for *giggles on every bump*, and the game has no sound yet
 * (that is build step 9), so the giggle is drawn instead of heard. Sprites,
 * because a bubble must face the camera and this game's camera is not level.
 *
 * A pool of six, allocated once and reused; the textures are drawn once at
 * module level and shared by every visit to the stall.
 */

const WORDS = ['hee hee!', 'wheee!', 'oops!', 'bonk!', 'ha ha!', 'wheeee!'] as const;

const POOL = 6;
const LIFE = 1.15;

export interface Giggles {
  readonly root: Group;
  /** Pops a random giggle over a point. */
  pop(x: number, y: number, z: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createGiggles(): Giggles {
  const root = new Group();
  root.name = 'dodgems:giggles';

  const rng = new Rng(0x91661e);
  const textures = WORDS.map((word, index) => giggleTexture(word, index));

  interface Bubble {
    readonly sprite: Sprite;
    readonly material: SpriteMaterial;
    life: number;
    x: number;
    y: number;
    z: number;
  }

  const bubbles: Bubble[] = [];
  for (let i = 0; i < POOL; i += 1) {
    const material = new SpriteMaterial({
      map: textures[0] ?? null,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(1.7, 0.95, 1);
    sprite.visible = false;
    sprite.renderOrder = 4;
    root.add(sprite);
    bubbles.push({ sprite, material, life: 0, x: 0, y: 0, z: 0 });
  }

  let next = 0;

  return {
    root,

    pop(x: number, y: number, z: number): void {
      const bubble = bubbles[next % POOL];
      next += 1;
      if (!bubble) return;
      const texture = textures[rng.int(0, textures.length - 1)];
      if (texture) {
        bubble.material.map = texture;
        bubble.material.needsUpdate = true;
      }
      bubble.life = LIFE;
      bubble.x = x + rng.range(-0.3, 0.3);
      bubble.y = y;
      bubble.z = z + rng.range(-0.3, 0.3);
      bubble.sprite.visible = true;
      bubble.sprite.position.set(bubble.x, bubble.y, bubble.z);
    },

    update(dt: number): void {
      for (const bubble of bubbles) {
        if (bubble.life <= 0) continue;
        bubble.life -= dt;
        if (bubble.life <= 0) {
          bubble.sprite.visible = false;
          continue;
        }
        const t = 1 - bubble.life / LIFE;
        bubble.sprite.position.y = bubble.y + t * 1.2;
        // Pops big, settles, then fades — held at full size for most of its life.
        const pop = t < 0.18 ? 0.5 + (t / 0.18) * 0.62 : 1.12 - (t - 0.18) * 0.12;
        bubble.sprite.scale.set(1.7 * pop, 0.95 * pop, 1);
        bubble.material.opacity = clamp01((1 - t) * 2.6);
      }
    },

    dispose(): void {
      for (const bubble of bubbles) bubble.material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

const ACCENTS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLilac,
  PALETTE.blossomPink,
];

function giggleTexture(word: string, index: number): CanvasTexture {
  const width = 256;
  const height = 144;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot draw a giggle.');

  const accent = ACCENTS[index % ACCENTS.length] ?? PALETTE.markerPink;

  // A soft rounded pill with a chunky ink line, matching the park's signage.
  const radius = 46;
  ctx.beginPath();
  ctx.moveTo(radius + 8, 20);
  ctx.arcTo(width - 8, 20, width - 8, height - 40, radius);
  ctx.arcTo(width - 8, height - 34, 8, height - 34, radius);
  ctx.arcTo(8, height - 34, 8, 20, radius);
  ctx.arcTo(8, 20, width - 8, 20, radius);
  ctx.closePath();
  ctx.fillStyle = '#fff6ea';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 54px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillStyle = hexToCss(accent);
  ctx.lineWidth = 5;
  ctx.strokeText(word, width / 2, height * 0.4);
  ctx.fillText(word, width / 2, height * 0.4);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
