/**
 * Tiny WebAudio blips for the shops.
 *
 * Deliberately not an audio system — build step 9 is where music and effects
 * get one. This is three oscillators and an envelope, inline, so that buying
 * something makes a happy noise today without adding a single asset or a single
 * decision the real sound designer would have to unpick later.
 *
 * The context is created lazily on the first sound, which is always a response
 * to a tap or a key press: browsers refuse to start audio any other way.
 */
let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context) {
    // Coming back from a background tab leaves it suspended.
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

/** One soft sine note. `at` is an offset in seconds from now. */
function note(frequency: number, at: number, duration: number, gain: number): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);

  const envelope = ctx.createGain();
  // Gentle: a six-year-old is holding this tablet about 30 cm from their face.
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/** The "bought it!" chime: a bright major arpeggio. */
export function playPurchaseChime(): void {
  note(659.25, 0, 0.18, 0.07); // E5
  note(783.99, 0.075, 0.2, 0.06); // G5
  note(1046.5, 0.15, 0.32, 0.055); // C6
}

/** The surprise-egg reveal: higher, sparklier, four notes. */
export function playSurpriseChime(): void {
  note(880, 0, 0.14, 0.055); // A5
  note(1108.7, 0.07, 0.14, 0.05); // C#6
  note(1318.5, 0.14, 0.16, 0.05); // E6
  note(1760, 0.22, 0.4, 0.045); // A6
}

/** A soft blip for opening a shop or the backpack. */
export function playOpenChime(): void {
  note(523.25, 0, 0.12, 0.04); // C5
  note(698.46, 0.06, 0.16, 0.035); // F5
}

/**
 * The lift's doors. Two descending notes, because that is the noise every lift
 * in the world makes and a six-year-old already knows what it means.
 */
export function playLiftDing(): void {
  note(1046.5, 0, 0.16, 0.05); // C6
  note(783.99, 0.13, 0.34, 0.045); // G5
}

// ------------------------------------------------------------------ eating

/**
 * How long the whole munch lasts, in seconds, and how many bites it takes.
 *
 * Exported because `entities/EatenTreat.ts` chews the model down on exactly
 * this clock: the sound schedules its bites ahead of time in the audio graph
 * and the model shrinks on the frame clock, and the two only stay in step if
 * they are counting the same bites over the same seconds. Two hand-tuned
 * numbers in two files drifted apart the moment either was adjusted.
 */
export const EAT_SECONDS = 2.2;
export const EAT_BITES = 3;

/** The moment bite `n` (0-based) is taken, in seconds from the start. */
export function biteAt(n: number): number {
  return (n * EAT_SECONDS) / EAT_BITES;
}

/**
 * One bite: a soft crunch, made the same way the water sounds are — a band of
 * noise with a fast attack and a very short tail. Low and round rather than
 * bright and snappy, because this is ice cream and candy floss, not crisps.
 */
function crunch(at: number, gain: number): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + at;

  const source = ctx.createBufferSource();
  source.buffer = ensureNoise(ctx);
  source.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(1100, start);
  band.frequency.exponentialRampToValueAtTime(300, start + 0.11);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);

  source.connect(band);
  band.connect(envelope);
  envelope.connect(ctx.destination);
  source.start(start, Math.random() * 1.5);
  source.stop(start + 0.2);
}

/**
 * Eating something: three happy little bites, then a satisfied "mmm!".
 *
 * The whole sound is scheduled in one go — the browser's audio clock is far
 * steadier than a frame, and a chomp that arrives a stuttering frame late
 * stops sounding like a chomp. `EatenTreat` takes the matching visual bite out
 * of the model at each {@link biteAt}.
 */
export function playEatingSound(): void {
  for (let n = 0; n < EAT_BITES; n += 1) crunch(biteAt(n), 0.06 - n * 0.008);
  // The "mmm!" — two notes rising, right after the last bite.
  const after = biteAt(EAT_BITES - 1) + 0.34;
  note(587.33, after, 0.16, 0.045); // D5
  note(880, after + 0.11, 0.3, 0.04); // A5
}

// ------------------------------------------------------------------ water

/**
 * A couple of seconds of white noise, made once and shared.
 *
 * Running water is noise through a filter, and that is the whole trick behind
 * both sounds below. One buffer is enough: every playback gets its own
 * `BufferSource`, and starting them at different offsets keeps two flushes from
 * sounding identical.
 */
let noiseBuffer: AudioBuffer | null = null;

function ensureNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

interface WaterOptions {
  readonly at: number;
  readonly duration: number;
  readonly gain: number;
  /** Bandpass centre at the start and at the end, in hertz. */
  readonly fromHz: number;
  readonly toHz: number;
  readonly q: number;
  /** Fraction of the sound spent fading in. The rest is the tail. */
  readonly attack: number;
}

/** Filtered noise with a swept band — the shape of any water sound. */
function water(options: WaterOptions): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + options.at;

  const source = ctx.createBufferSource();
  source.buffer = ensureNoise(ctx);
  source.loop = true;
  // Start somewhere random in the buffer so no two flushes are the same sound.
  const offset = Math.random() * 1.5;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = options.q;
  band.frequency.setValueAtTime(options.fromHz, start);
  band.frequency.exponentialRampToValueAtTime(options.toHz, start + options.duration);

  // A gentle low-pass on top keeps the hiss off the top end. A six-year-old is
  // holding this tablet about 30 cm from their face.
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 2600;

  const envelope = ctx.createGain();
  const attack = options.duration * options.attack;
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(options.gain, start + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  source.connect(band);
  band.connect(soften);
  soften.connect(envelope);
  envelope.connect(ctx.destination);
  source.start(start, offset);
  source.stop(start + options.duration + 0.05);
}

/**
 * The flush.
 *
 * A short gulp, then a swirling rush whose band sweeps downwards as the water
 * goes round and away, finished off by the cistern refilling — which is the bit
 * that makes it read as a toilet rather than as a tap.
 */
export function playFlush(): void {
  // The handle, and the first gulp.
  note(220, 0, 0.08, 0.03);
  water({ at: 0.02, duration: 0.28, gain: 0.075, fromHz: 900, toHz: 320, q: 1.1, attack: 0.12 });
  // The swirl: louder, longer, sweeping down as it drains away.
  water({ at: 0.16, duration: 1.05, gain: 0.09, fromHz: 1400, toHz: 260, q: 0.9, attack: 0.18 });
  // The cistern refilling: quiet, and its band climbs as the tank fills up.
  water({ at: 0.85, duration: 0.75, gain: 0.035, fromHz: 500, toHz: 1500, q: 2.4, attack: 0.3 });
}

/**
 * Washing your hands: the tap runs, splashes off two palms, and stops.
 *
 * Deliberately quieter and steadier than the flush — it is the polite little
 * coda to the joke, not the punchline.
 */
export function playHandwash(): void {
  // The tap itself: a steady, bright, unwavering band.
  water({ at: 0, duration: 1.2, gain: 0.055, fromHz: 1700, toHz: 1500, q: 1.6, attack: 0.1 });
  // Two splashes as hands go under it and come back out.
  water({ at: 0.28, duration: 0.22, gain: 0.045, fromHz: 2300, toHz: 900, q: 0.8, attack: 0.15 });
  water({ at: 0.68, duration: 0.24, gain: 0.04, fromHz: 2100, toHz: 800, q: 0.8, attack: 0.15 });
  // A tiny squeak as the tap is turned off. Good manners deserve a flourish.
  note(1244.5, 1.18, 0.09, 0.025); // D#6
  note(1661.2, 1.24, 0.12, 0.02); // G#6
}
