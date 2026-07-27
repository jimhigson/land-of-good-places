/**
 * Tiny WebAudio blips for the Spooky House — pop, squirt, candy-rattle.
 *
 * Same lazy-context, oscillator-and-envelope approach as `ui/chime.ts` (there
 * is no shared audio system yet — see that file's note about build step 9),
 * kept local to this mini-game rather than reaching into `ui/` for three
 * one-line helpers. Gentle throughout: this is a funfair ghost-train gag for a
 * six-year-old, not a jump scare, so nothing here is loud or sudden.
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

function tone(
  frequency: number,
  at: number,
  duration: number,
  gain: number,
  type: OscillatorType = 'sine',
  glideTo?: number,
): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (glideTo !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), start + duration);
  }

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

/** A short burst of filtered noise — the "shh" under the squirt and the rattle. */
function noiseBurst(at: number, duration: number, gain: number, filterHz: number): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + at;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterHz;
  filter.Q.value = 0.9;

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

/** The eye popping out on its stalk: a quick upward "boing". */
export function playPopSound(): void {
  tone(320, 0, 0.16, 0.05, 'triangle', 640);
  tone(200, 0.02, 0.1, 0.02, 'sine');
}

/** The squirt — a soft downward-sweeping "shh" rather than a splash bang. */
export function playSquirtSound(): void {
  noiseBurst(0, 0.28, 0.05, 2200);
  tone(560, 0, 0.22, 0.02, 'sine', 260);
}

/** The candy shower: a bright little rattle of high notes. */
export function playCandySound(): void {
  const notes = [880, 1046.5, 987.77, 1174.66];
  notes.forEach((frequency, index) => {
    tone(frequency, index * 0.055, 0.14, 0.035, 'triangle');
  });
  noiseBurst(0, 0.35, 0.02, 4200);
}

/** A gentle "boo" — a soft two-note dip, never a shout. */
export function playBooSound(): void {
  tone(300, 0, 0.22, 0.045, 'sine', 190);
  tone(150, 0.16, 0.28, 0.03, 'sine');
}
