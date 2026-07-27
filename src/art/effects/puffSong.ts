import { CanvasTexture, Color, Group, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { ART } from '../style/artPalette';
import { hexToCss, PALETTE, Rng } from '../style/bridge';

/**
 * Everything the singing puff needs to actually sing: a quiet WebAudio melody,
 * a little pool of musical-note sprites that float up while it plays, and the
 * timer that decides when the next song happens.
 *
 * Kept entirely self-contained (own tiny `AudioContext`, own canvas texture,
 * own pool) rather than reaching into `src/ui/chime.ts`, because this file is
 * owned end-to-end by one asset and must not create merge conflicts with
 * whatever the sound-effects system looks like once build step 9 lands.
 *
 * `pets.ts` and `hats.ts` both drive this from their own `update()` — a song
 * is exactly the kind of autonomous idle behaviour (like the jiggle) that the
 * asset contract already allows a creature to own; it is not "follow or AI
 * logic" in the sense ART_DIRECTION.md means to keep out of asset files.
 */

// --------------------------------------------------------------- the melody

/** A cheerful pentatonic run — any of these notes sound nice next to any other. */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return context;
  }
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function singNote(frequency: number, at: number, duration: number, gain: number): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  // Triangle rather than the chime's sine — a touch reedier, reads more like a
  // little voice than a doorbell.
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(frequency, start);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.03);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

export interface PuffSong {
  readonly noteCount: number;
  /** Total seconds from the first note to the last one finishing. */
  readonly duration: number;
}

/**
 * Plays one little song: 3–6 notes, randomly drawn from the pentatonic set so
 * it is never quite the same tune twice, always quiet and always gentle.
 * `rng` should be the puff's own seeded RNG (never `Math.random()`, per
 * ART_DIRECTION.md) so a replay with the same seed sings the same tune.
 */
export function playPuffMelody(rng: Rng, volume = 1): PuffSong {
  const noteCount = rng.int(3, 6);
  const noteDuration = 0.26;
  const gap = 0.17;
  // Quiet — this can fire every few seconds all park long, so it must sit
  // well under the purchase chime, not compete with it.
  const gain = 0.018 * volume;

  let t = 0;
  for (let i = 0; i < noteCount; i += 1) {
    const frequency = rng.pick(PENTATONIC);
    singNote(frequency, t, noteDuration, gain);
    t += gap;
  }

  return { noteCount, duration: t + noteDuration };
}

// --------------------------------------------------------- the note sprites

/** Notes alive at once. A song is at most 6 notes; a couple can overlap. */
const POOL_SIZE = 10;

/** Seconds from spawning to gone. */
const LIFETIME = 1.5;

/** How far a note drifts upward over its life, in metres. */
const RISE = 0.6;

/** Sideways sway amplitude, in metres — notes wander, they don't fly straight. */
const SWAY = 0.1;

/** Pastel tints a note can be drawn in. Always from PALETTE/ART, never inline hex. */
const NOTE_COLOURS: readonly number[] = [
  ART.heartPink,
  PALETTE.markerLilac,
  ART.rainbow[2] ?? 0xffe27a,
  ART.rainbow[4] ?? 0x8cc9ff,
];

let noteGlyph: CanvasTexture | null = null;

/**
 * Paints one small eighth-note glyph, filled white on transparent so every
 * sprite can tint it via `material.color` — the same trick as the plum
 * outlines: one shape, many colours. The stroke is baked in at `ART.ink`, so
 * every tint keeps the hand-painted outline the rest of the park uses.
 */
function noteTexture(): CanvasTexture {
  if (noteGlyph) return noteGlyph;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint a music note.');

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = hexToCss(ART.ink);
  ctx.lineWidth = size * 0.05;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Notehead: a small tilted oval, bottom-left of the glyph.
  ctx.save();
  ctx.translate(size * 0.36, size * 0.72);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.16, size * 0.115, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Stem, up from the notehead.
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.68);
  ctx.lineTo(size * 0.5, size * 0.16);
  ctx.stroke();

  // One flag, curling off the top of the stem — reads as a single "♪" at a
  // glance, which is all a floating particle needs to do.
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.16);
  ctx.quadraticCurveTo(size * 0.78, size * 0.24, size * 0.7, size * 0.46);
  ctx.quadraticCurveTo(size * 0.6, size * 0.34, size * 0.5, size * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  noteGlyph = texture;
  return texture;
}

export interface PuffNotes {
  /** Parent this on the singer — musical notes rising from a moving character
   *  are meant to drift along with them, unlike a ground effect that must stay
   *  put (compare `rainbowRing.ts`). Local space is deliberate here. */
  readonly root: Group;
  /** Releases `count` notes from a point local to `root`'s parent. */
  burst(x: number, y: number, z: number, count: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** A little pool of floating musical notes, for a creature that sings. */
export function createPuffNotes(seed: number): PuffNotes {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'effect.puffNotes';

  const texture = noteTexture();
  const sprites: Sprite[] = [];
  const materials: SpriteMaterial[] = [];
  const ages: number[] = [];
  const bases: [number, number, number][] = [];
  const swayPhase: number[] = [];
  const swaySpeed: number[] = [];
  let next = 0;

  for (let i = 0; i < POOL_SIZE; i += 1) {
    const material = new SpriteMaterial({
      map: texture,
      color: new Color(NOTE_COLOURS[0]),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.setScalar(0.001);
    sprite.visible = false;
    sprite.renderOrder = 6;
    root.add(sprite);
    sprites.push(sprite);
    materials.push(material);
    ages.push(LIFETIME);
    bases.push([0, 0, 0]);
    swayPhase.push(0);
    swaySpeed.push(1);
  }

  return {
    root,

    burst(x, y, z, count) {
      const n = Math.max(1, Math.min(POOL_SIZE, Math.round(count)));
      for (let i = 0; i < n; i += 1) {
        const index = next;
        next = (next + 1) % POOL_SIZE;
        const sprite = sprites[index];
        const material = materials[index];
        if (!sprite || !material) continue;

        sprite.position.set(x + rng.range(-0.05, 0.05), y, z + rng.range(-0.03, 0.03));
        sprite.scale.setScalar(0.14 + rng.range(-0.02, 0.03));
        sprite.visible = true;
        material.color.setHex(rng.pick(NOTE_COLOURS));
        material.opacity = 0;
        ages[index] = 0;
        bases[index] = [x, y, z];
        swayPhase[index] = rng.range(0, Math.PI * 2);
        swaySpeed[index] = rng.range(2.4, 3.6);
      }
    },

    update(dt) {
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const age = ages[i] ?? LIFETIME;
        if (age >= LIFETIME) continue;

        const next_ = age + dt;
        ages[i] = next_;
        const sprite = sprites[i];
        const material = materials[i];
        const base = bases[i];
        if (!sprite || !material || !base) continue;

        if (next_ >= LIFETIME) {
          sprite.visible = false;
          material.opacity = 0;
          continue;
        }

        const t = next_ / LIFETIME;
        const eased = 1 - (1 - t) * (1 - t);
        sprite.position.y = base[1] + RISE * eased;
        sprite.position.x = base[0] + Math.sin((swayPhase[i] ?? 0) + next_ * (swaySpeed[i] ?? 3)) * SWAY;

        // Hold at full strength briefly, then fade on a curve — a linear fade
        // reads as the note switching off rather than drifting out of earshot.
        material.opacity = t < 0.15 ? 1 : (1 - (t - 0.15) / 0.85) ** 1.4;
      }
    },

    dispose() {
      texture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

// -------------------------------------------------------------- the timer

export interface SongScheduler {
  /**
   * Advances the countdown. Returns true on the exact frame a song should
   * start, and rolls a new countdown for next time.
   *
   * `near` biases the countdown to run down faster — a puff that is close to
   * the player (following right behind you, or the one you're currently
   * browsing in the shop pen) bursts into song more often than one sitting
   * further off. There is no live player-distance signal reaching an asset
   * factory (assets don't get a scene or player reference — see
   * ART_DIRECTION.md §7), so callers pass their own best guess: `pets.ts`
   * assumes "near" by default, since a parade pet is always close behind its
   * owner; `hats.ts` assumes "not near" and additionally widens the whole
   * interval, since a hat sings rarer than the pet by design, worn or not.
   */
  update(dt: number, near: boolean): boolean;
}

export function createSongScheduler(
  rng: Rng,
  options: { min: number; max: number; nearSpeedup?: number },
): SongScheduler {
  const { min, max, nearSpeedup = 2.4 } = options;
  // The very first song comes sooner than the steady-state gap, so a shopper
  // standing at the pen for a few seconds actually gets to hear it.
  let countdown = rng.range(min, max) * 0.5;

  return {
    update(dt, near) {
      countdown -= dt * (near ? nearSpeedup : 1);
      if (countdown > 0) return false;
      countdown = rng.range(min, max);
      return true;
    },
  };
}
