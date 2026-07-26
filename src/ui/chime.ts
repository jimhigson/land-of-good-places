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
