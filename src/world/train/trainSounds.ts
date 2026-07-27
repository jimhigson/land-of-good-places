/**
 * The train's three noises, synthesised.
 *
 * Same shape as `ui/chime.ts` and for the same reason: build step 9 is where
 * this game gets a real audio system, and until then a handful of oscillators
 * inline makes the park sound alive without adding an asset or a decision the
 * eventual sound designer would have to unpick.
 *
 * Everything is quiet on purpose. A six-year-old is holding the tablet about
 * thirty centimetres from their face.
 */

let context: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ensureContext(): AudioContext | null {
  if (context) {
    // Coming back from a background tab leaves it suspended.
    if (context.state === 'suspended') void context.resume();
    return context;
  }
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/**
 * How loud the train is right now, 0..1 — set by `ParkTrain` from how far away
 * it is. Nothing here is positional audio; it is one number, and it is enough
 * for a whistle across a park.
 */
let carry = 1;

export function setTrainAudioCarry(value: number): void {
  carry = value < 0 ? 0 : value > 1 ? 1 : value;
}

/** One shaped tone. `at` is an offset in seconds from now. */
function tone(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  at: number,
  duration: number,
  gain: number,
  detune = 0,
): void {
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.detune.setValueAtTime(detune, start);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.05);
  envelope.gain.setValueAtTime(Math.max(0.0002, gain), start + duration * 0.55);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/**
 * The two-tone whistle, blown as the train pulls away.
 *
 * Two notes a fourth apart sounding *together*, not one after the other — that
 * interval is what makes a steam whistle sound like a steam whistle rather than
 * like a doorbell. A touch of detune between a pair of oscillators on each note
 * gives it the breathy beating a single tone never has.
 */
export function playTrainWhistle(): void {
  const ctx = ensureContext();
  if (!ctx || carry <= 0.02) return;

  const level = 0.05 * carry;
  for (const [frequency, gain] of [
    [523.25, level],
    [698.46, level * 0.8],
  ] as const) {
    tone(ctx, 'triangle', frequency, 0, 0.85, gain, -7);
    tone(ctx, 'triangle', frequency, 0, 0.85, gain, 7);
  }
  // A breathy hiss underneath, which is most of what sells it as steam.
  hiss(ctx, 0, 0.8, 1400, 0.02 * carry);
}

/** The station bell: two quick strikes, bright and short. */
export function playStationBell(): void {
  const ctx = ensureContext();
  if (!ctx || carry <= 0.02) return;

  const level = 0.045 * carry;
  for (const at of [0, 0.19] as const) {
    // A bell is a stack of inharmonic partials; three is plenty at this size.
    tone(ctx, 'sine', 1174.7, at, 0.5, level);
    tone(ctx, 'sine', 1760, at, 0.34, level * 0.5);
    tone(ctx, 'sine', 2637, at, 0.22, level * 0.25);
  }
}

/**
 * One chuff.
 *
 * Filtered noise with a very fast decay. `strength` rises with the train's
 * speed, so pulling away sounds like effort and cruising sounds like ticking
 * over.
 */
export function playChuff(strength: number): void {
  const ctx = ensureContext();
  if (!ctx || carry <= 0.02) return;
  hiss(ctx, 0, 0.16, 620 + strength * 420, 0.02 * strength * carry);
}

/** A burst of band-passed white noise. */
function hiss(
  ctx: AudioContext,
  at: number,
  duration: number,
  centre: number,
  gain: number,
): void {
  if (gain <= 0.0002) return;
  const start = ctx.currentTime + at;

  if (!noiseBuffer) {
    const frames = Math.floor(ctx.sampleRate * 0.5);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(centre, start);
  filter.Q.setValueAtTime(1.6, start);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.05);
}
