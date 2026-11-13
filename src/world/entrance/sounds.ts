import { audioContext } from '../../core/audio';

/**
 * Tiny WebAudio sound effects for the cat bus's arrival: a brake squeak, a
 * door hiss and a happy horn toot.
 *
 * Built the same way `ui/chime.ts` builds the shop chimes — a few oscillators
 * and an envelope, no audio assets, no dependency on a real sound system
 * (build step 9) that does not exist yet. It does share the park's one
 * `AudioContext` (`core/audio.ts`) — constructing one is a ~150 ms main-thread
 * stall, so there is exactly one, built at boot.
 */

/** A short, friendly two-tone "toot-toot!" — never harsh, this is a toy horn. */
export function playHornToot(): void {
  const ctx = audioContext();
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
  const ctx = audioContext();
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
  const ctx = audioContext();
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
