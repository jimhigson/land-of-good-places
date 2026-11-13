/**
 * **The one `AudioContext`.** Every sound in the park plays through this one;
 * nothing else in `src/` constructs its own.
 *
 * Why it exists (step 9 of `docs/perf/FRAME-DROPS-2026-11.md`): the
 * constructor is not cheap. `new AudioContext()` blocks the main thread for
 * **~150 ms** on an M4 Pro in Chrome (measured: 146–179 ms over eight
 * constructions, muted or not, before or after a gesture — it is opening the
 * audio device, and nothing about *when* it runs makes it cheaper). Each sound
 * module used to make its own, lazily, on its first sound — six contexts, six
 * 150 ms frames, the first of them a wild puff singing mid-play
 * (`WildPets.advance → playPuffMelody → new AudioContext`, 133 ms on `/spawn`,
 * 168 ms in the library). A frame budget at 120 fps is 8.3 ms.
 *
 * So the context is built **once, at boot** (`prepareAudio`, from `main.ts`,
 * before the first park frame exists — the cost lands behind the splash, not
 * in a frame), and **unlocked on the first gesture** (`resume()` from a capture
 * listener). Moving only the construction into the gesture handler would have
 * moved the 150 ms, not removed it: a handler that blocks for 150 ms drops the
 * next frame just the same, and on `/spawn` the first key press *is* mid-play.
 *
 * **The browsers' rule, and why this still obeys it.** Chrome starts a context
 * made before any user activation `suspended` (and says so once in the
 * console); iOS Safari keeps one made outside a gesture suspended until
 * `resume()` is called *from inside* one. Both are satisfied by resuming in
 * the gesture rather than constructing in it — `resume()` costs ~0.1 ms. The
 * listeners stay armed for the life of the page, because iOS can suspend or
 * "interrupt" a running context again (a phone call, the tab backgrounded)
 * and only a fresh gesture is guaranteed to bring it back.
 *
 * Every sound that played before still plays: a sound asked for before the
 * first gesture was silent before (its brand-new context started suspended)
 * and is silent now; every sound after the first gesture finds the context
 * already running.
 */

let context: AudioContext | null = null;
/** Construction was attempted (successfully or not) — never retry a failure every sound. */
let attempted = false;
let armed = false;

function construct(): AudioContext | null {
  if (attempted) return context;
  attempted = true;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/**
 * Old iOS (before 14.5 or so) unlocked audio only when something actually
 * *started* inside the gesture, not on `resume()` alone. One silent sample is
 * the customary key; it costs nothing on a browser that does not need it.
 */
function playSilentSample(ctx: AudioContext): void {
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Unlocking is best-effort; a failure here only means a later sound is quiet.
  }
}

/**
 * Every gesture while the context is not running retries the whole unlock —
 * `resume()` **and** the silent sample — never just the first one. iOS does
 * not count `pointerdown`/`mousedown` (or a `touchstart` it turns into one) as
 * user activation; only the `touchend`/`pointerup`/`click` that follows does.
 * A one-shot unlock spent on the first `pointerdown` would therefore be spent
 * where iOS ignores it, and the gesture that *would* have worked would find
 * the key already used. Retrying is cheap (~0.1 ms) and stops by itself: once
 * the context reports `running`, every handler returns at the first line.
 */
function onGesture(): void {
  const ctx = construct();
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
  void ctx.resume();
  playSilentSample(ctx);
}

/**
 * Every event either browser counts as user activation, in capture so nothing
 * can swallow it. `pointerdown`/`mousedown` count in Chrome (and are where a
 * desktop click first lands); `pointerup`/`touchend`/`click` are the ones iOS
 * counts; `keydown` is every keyboard player's first gesture.
 */
const GESTURES = ['pointerdown', 'mousedown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * Build the context now and arm the gesture unlock. Call once, at boot, before
 * any park frame is drawn. Idempotent.
 */
export function prepareAudio(): void {
  if (typeof window === 'undefined') return;
  construct();
  if (armed) return;
  armed = true;
  for (const type of GESTURES) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

/**
 * The shared context, for a sound about to play. `null` when the browser has
 * no Web Audio. Nudges a suspended context (a tab coming back from the
 * background) the way every sound module used to — harmless when the browser
 * refuses, because the next gesture resumes it anyway.
 *
 * If `prepareAudio` was never called (a page other than the game), this
 * constructs on first use, as each module did before — correct, just not free.
 */
export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const ctx = construct();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
