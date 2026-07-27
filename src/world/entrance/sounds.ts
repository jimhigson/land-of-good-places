/**
 * Tiny WebAudio sound effects for the cat bus's arrival: a brake squeak, a
 * door hiss and a happy horn toot.
 *
 * Built the same way `ui/chime.ts` builds the shop chimes — a few oscillators
 * and an envelope, no audio assets, no dependency on a real sound system
 * (build step 9) that does not exist yet. Kept as its own tiny context here
 * rather than reusing `chime.ts`'s (private, unexported) one, so this feature
 * stays self-contained inside `world/entrance/`.
 */

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

/** A short, friendly two-tone "toot-toot!" — never harsh, this is a toy horn. */
export function playHornToot(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  for (const [at, frequency] of [[0, 392], [0.16, 392]] as const) {
    const start = ctx.currentTime + at;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, start);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, start);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);

    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  }
}

/** A quick, cartoonish downward-sliding squeak, for the bus settling to a stop. */
export function playBrakeSqueak(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime;
  const duration = 0.34;

  const oscillator = ctx.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(1450, start);
  oscillator.frequency.exponentialRampToValueAtTime(620, start + duration);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(0.05, start + 0.03);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/** A short, breathy filtered-noise burst — the doors hissing open. */
export function playDoorHiss(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime;
  const duration = 0.3;

  const bufferSize = Math.max(1, Math.round(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, start);
  filter.Q.value = 0.7;

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(0.05, start + 0.05);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  noise.connect(filter);
  filter.connect(envelope);
  envelope.connect(ctx.destination);
  noise.start(start);
  noise.stop(start + duration + 0.02);
}
