import { buildColour, buildIdentity, type BuildIdentity } from '../build-identity';
import { FRAME_BUDGET_MS, type PerfProbe } from '../core/perfProbe';

/**
 * The `?perf=1` box: the frame rate, which build this is, and one button that
 * copies everything `core/perfProbe.ts` counts — so a number can be had from a
 * phone in a parent's hand (the real-phone baseline,
 * `docs/perf/REAL-PHONE-BASELINE.md`).
 *
 * Three things and no more. Jim, 15 Nov 2026, testing a freeze on an iPhone:
 * *"will I know right away I have the new build? … the box can just show fps
 * and a button to paste a report, it doesn't have to show all data live"*.
 *
 * - **fps**, big: frames drawn over about the last second of wall time,
 *   looked at twice a second and rewritten only when it changed. Wall time,
 *   so a stall shows as the number falling rather than holding the last good
 *   second.
 * - **the build**: its short sha and build time, on a background coloured by
 *   the build itself (`build-identity.ts`) — a new deploy is a new colour the
 *   moment it loads, and a cached one is still the old colour.
 * - **Copy report**: the full JSON ({@link PerfOverlay.report}), which holds
 *   everything the old live readout showed and a great deal more.
 *
 * Developer-only by construction: it exists only when the URL asks for it, the
 * same spirit as `/view` and `DevBadge`. Styled inline so this file is the
 * whole feature, and `pointer-events: none` except on the button, so it never
 * swallows a tap meant for the park.
 */

/** How often the fps figure is looked at: twice a second, so it covers the last two looks — about a second. */
const REFRESH_MS = 500;
/** The window the report's `lastTwoSeconds` covers, in frames: two seconds at 120 fps. */
const WINDOW_FRAMES = 240;
const BUTTON_LABEL = 'Copy report';
/** How long "Copied" stays on the button. */
const FLASH_MS = 1500;

export class PerfOverlay {
  private readonly probe: PerfProbe;
  private readonly build: BuildIdentity;
  private readonly element: HTMLElement;
  /** The fps figure's own text node: its `data` is rewritten in place, never a node replaced. */
  private readonly fps: Text;
  private readonly button: HTMLButtonElement;
  /** The figure on screen, so an unchanged second writes nothing. */
  private shownFps = -1;
  /**
   * The last two looks at the probe's frame count — when (`performance.now()`,
   * -1 for not yet) and how many frames had been drawn by then. The figure is
   * the frames drawn since the look before last: about a second.
   */
  private beforeLastAt = -1;
  private beforeLastCount = 0;
  private lastAt = -1;
  private lastCount = 0;
  private timer = 0;
  private flashTimer = 0;

  constructor(probe: PerfProbe) {
    this.probe = probe;
    this.build = buildIdentity();
    this.element = document.createElement('div');
    this.element.className = 'perf-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    Object.assign(this.element.style, {
      position: 'fixed',
      left: 'calc(0.5rem + env(safe-area-inset-left))',
      bottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
      padding: '0.45rem 0.65rem 0.55rem',
      // Opaque: a see-through box takes on the park's colours behind it, and
      // the colour is the whole point.
      background: buildColour(this.build.sha),
      color: '#fff',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.2',
      borderRadius: '0.5rem',
      boxShadow: '0 0.1rem 0.5rem rgba(0, 0, 0, 0.35)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '99998',
    } satisfies Partial<CSSStyleDeclaration>);

    const rate = document.createElement('div');
    Object.assign(rate.style, {
      fontSize: '2.25rem',
      fontWeight: '700',
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    // A dash until the first frame is drawn — and for good, if none ever is.
    this.fps = document.createTextNode('–');
    const unit = document.createElement('span');
    unit.textContent = ' fps';
    Object.assign(unit.style, { fontSize: '1rem', fontWeight: '400' } satisfies Partial<CSSStyleDeclaration>);
    rate.append(this.fps, unit);

    // Two short lines rather than one long one: narrow enough at 430 px to
    // stay clear of the hop button in the opposite corner.
    const build = document.createElement('div');
    build.textContent = describeBuild(this.build);
    Object.assign(build.style, {
      fontSize: '0.9rem',
      whiteSpace: 'pre',
      marginTop: '0.15rem',
    } satisfies Partial<CSSStyleDeclaration>);

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = BUTTON_LABEL;
    Object.assign(this.button.style, {
      display: 'block',
      marginTop: '0.45rem',
      minHeight: '2.75rem',
      padding: '0.4rem 0.8rem',
      fontFamily: 'inherit',
      fontSize: '1rem',
      fontWeight: '700',
      color: '#111',
      background: 'rgba(255, 255, 255, 0.92)',
      border: '0',
      borderRadius: '0.35rem',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.copy();
    });
    this.button.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.button.addEventListener('pointerup', (event) => event.stopPropagation());

    this.element.append(rate, build, this.button);
    document.body.append(this.element);
    this.timer = window.setInterval(() => this.redraw(), REFRESH_MS);
    // The same JSON the button copies, for a check or a console.
    probe.api.report = () => this.report();
  }

  /**
   * The JSON the button copies: which build this is, everything in the ring,
   * summarised, plus context — and **why the slowest frames were slow**
   * (`core/perfAttribution.ts`): `slowestFrames` over the ring the `session`
   * summary covers, `slowestFramesSinceStart` over the whole run, `gl` for
   * what was counted in all, and `Game`'s once-a-session facts (the boot path,
   * the background warm-up).
   */
  report(): Record<string, unknown> {
    return {
      at: new Date().toISOString(),
      url: location.href,
      build: { sha: this.build.sha, builtAt: this.build.builtAt },
      ...this.probe.describe(),
      budgetMs: FRAME_BUDGET_MS,
      session: this.probe.summary(),
      lastTwoSeconds: this.probe.summary(WINDOW_FRAMES),
      ...this.probe.detail(),
      gl: this.probe.attribution.session(),
      slowestFrames: this.probe.attribution.slowest(),
      slowestFramesSinceStart: this.probe.attribution.slowestSinceStart(),
    };
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.flashTimer);
    this.element.remove();
  }

  /**
   * The fps figure, and nothing else: frames drawn per second of wall time
   * since the look before last, from four numbers kept here — nothing
   * allocated, nothing asked of the probe but its count, and the DOM written
   * only when the figure changes. A look's own late arrival (a blocked main
   * thread fires no timers) only widens the window, so a freeze reads as the
   * low figure it was.
   */
  private redraw(): void {
    const now = performance.now();
    const count = this.probe.frameCount;
    const fromAt = this.beforeLastAt >= 0 ? this.beforeLastAt : this.lastAt;
    const fromCount = this.beforeLastAt >= 0 ? this.beforeLastCount : this.lastCount;
    this.beforeLastAt = this.lastAt;
    this.beforeLastCount = this.lastCount;
    this.lastAt = now;
    this.lastCount = count;
    if (count === 0 || fromAt < 0 || now <= fromAt) return;
    const fps = Math.round(((count - fromCount) * 1000) / (now - fromAt));
    if (fps === this.shownFps) return;
    this.shownFps = fps;
    this.fps.data = String(fps);
  }

  private async copy(): Promise<void> {
    const json = JSON.stringify(this.report(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.flash('Copied');
    } catch {
      // No clipboard (an http:// LAN address on a phone is not a secure
      // context): put it somewhere a long-press can select it.
      const area = document.createElement('textarea');
      area.value = json;
      Object.assign(area.style, {
        position: 'fixed',
        inset: '10%',
        zIndex: '99999',
        fontSize: '1rem',
      } satisfies Partial<CSSStyleDeclaration>);
      area.addEventListener('blur', () => area.remove());
      document.body.append(area);
      area.focus();
      area.select();
      this.flash('Select + copy');
    }
  }

  private flash(label: string): void {
    this.button.textContent = label;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.button.textContent = BUTTON_LABEL), FLASH_MS);
  }
}

/** `a1b2c3d`, then `built 15 Nov, 14:32` beneath it — the build time in the phone's own zone and words. */
function describeBuild(build: BuildIdentity): string {
  if (build.builtAt === null) return build.id;
  const at = new Date(build.builtAt);
  if (Number.isNaN(at.getTime())) return `${build.id}\nbuilt ${build.builtAt}`;
  const when = at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${build.id}\nbuilt ${when}`;
}
