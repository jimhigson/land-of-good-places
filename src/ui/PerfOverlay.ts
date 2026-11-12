import {
  FRAME_BUDGET_MS,
  type PerfProbe,
  type PerfSummary,
} from '../core/perfProbe';

/**
 * The `?perf=1` readout: what `core/perfProbe.ts` counts, on screen, with a
 * "copy JSON" button — so a number can be had from a phone in a parent's hand
 * (the real-phone baseline, `docs/perf/REAL-PHONE-BASELINE.md`).
 *
 * Developer-only by construction: it exists only when the URL asks for it, the
 * same spirit as `/view` and `DevBadge`. Styled inline so this file is the
 * whole feature, and `pointer-events: none` except on the button, so it never
 * swallows a tap meant for the park.
 *
 * Redrawn four times a second over the last two seconds of frames — often
 * enough to watch a scene change, rarely enough that the overlay's own DOM
 * writes do not show up in the numbers it reports.
 */

/** How often the text is rewritten. */
const REFRESH_MS = 250;
/** The window the live numbers cover, in frames: two seconds at 120 fps. */
const WINDOW_FRAMES = 240;

export class PerfOverlay {
  private readonly probe: PerfProbe;
  private readonly element: HTMLElement;
  private readonly text: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly describe: () => Record<string, unknown>;
  private timer = 0;

  /**
   * @param describe — context for the copied JSON that the probe cannot know:
   *   the space she is in, the device, the renderer string.
   */
  constructor(probe: PerfProbe, describe: () => Record<string, unknown>) {
    this.probe = probe;
    this.describe = describe;
    this.element = document.createElement('div');
    this.element.className = 'perf-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    Object.assign(this.element.style, {
      position: 'fixed',
      left: 'calc(0.5rem + env(safe-area-inset-left))',
      bottom: 'calc(0.5rem + env(safe-area-inset-bottom))',
      padding: '0.4rem 0.6rem',
      background: 'rgba(0, 0, 0, 0.72)',
      color: '#e8ffe8',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '1rem',
      lineHeight: '1.25',
      borderRadius: '0.4rem',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '99998',
      whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);

    this.text = document.createElement('div');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'copy JSON';
    Object.assign(this.button.style, {
      marginTop: '0.3rem',
      fontFamily: 'inherit',
      fontSize: '1rem',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.copy();
    });
    this.button.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.button.addEventListener('pointerup', (event) => event.stopPropagation());

    this.element.append(this.text, this.button);
    document.body.append(this.element);
    this.timer = window.setInterval(() => this.redraw(), REFRESH_MS);
  }

  /** The JSON the button copies: everything in the ring, summarised, plus context. */
  report(): Record<string, unknown> {
    return {
      at: new Date().toISOString(),
      url: location.href,
      ...this.describe(),
      budgetMs: FRAME_BUDGET_MS,
      session: this.probe.summary(),
      lastTwoSeconds: this.probe.summary(WINDOW_FRAMES),
    };
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.element.remove();
  }

  private redraw(): void {
    const s = this.probe.summary(WINDOW_FRAMES);
    const context = this.describe();
    this.text.textContent = formatSummary(s, String(context['space'] ?? '?'));
    // Green under budget, amber when CPU alone is over it, red when frames are being missed.
    this.element.style.color =
      s.missedVsync > 0.02 ? '#ff9a9a' : s.cpuP50 > FRAME_BUDGET_MS ? '#ffd27a' : '#e8ffe8';
  }

  private async copy(): Promise<void> {
    const json = JSON.stringify(this.report(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.flash('copied');
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
      this.flash('select + copy');
    }
  }

  private flash(label: string): void {
    this.button.textContent = label;
    window.setTimeout(() => (this.button.textContent = 'copy JSON'), 1500);
  }
}

const ms = (n: number): string => n.toFixed(1).padStart(5);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const count = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)} k` : String(n);

/** The overlay's text. Exported so its wording is checked without a DOM. */
export function formatSummary(s: PerfSummary, space: string): string {
  const heap =
    s.heapChurnMBps !== null && s.heapMB !== null
      ? `heap  ${s.heapMB.toFixed(0)} MB  +${s.heapChurnMBps.toFixed(1)} MB/s`
      : `heap  ${s.heapMB === null ? 'n/a' : `${s.heapMB.toFixed(0)} MB`} (${s.heapNote ?? 'n/a'})`;
  return [
    `${space}  ${s.fps.toFixed(0)} fps  budget ${FRAME_BUDGET_MS.toFixed(1)} ms`,
    `frame p50 ${ms(s.intervalP50)}  p99 ${ms(s.intervalP99)}  worst ${s.worstInterval.toFixed(0)} ms`,
    `cpu   p50 ${ms(s.cpuP50)}  p99 ${ms(s.cpuP99)}  over ${pct(s.cpuOverBudget)}`,
    `missed 120Hz ${pct(s.missedVsync)}  >16.7 ${pct(s.over16)}`,
    `draws ${count(s.drawsMax)}  tris ${count(s.trisMax)} (max)`,
    heap,
  ].join('\n');
}
