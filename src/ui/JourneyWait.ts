import type { GenerationStage } from '../boot/parkGeneration';

/**
 * **"Getting your park ready!" — the loading caption for the parked wait.**
 *
 * On a dev laptop the park generates in a few seconds, well inside the twenty-
 * second ride, and this is never seen. On the device a six-year-old actually
 * holds, generation can outlast the ride (see `JourneyDirector.overrunning`): the
 * bus reaches the gate and waits while the last of the park is built. A *stopped*
 * bus with no explanation is what Jim reported as "it gets to the same point and
 * stops forever" — so the wait needs to say, unmistakably, that it is a wait and
 * that it is going somewhere.
 *
 * Two decisions carry that:
 *
 * 1. **The motion is CSS, not JavaScript.** During the wait the generator is
 *    handed most of each frame (`OVERRUN_GENERATION_BUDGET_MS`), so the main
 *    thread is blocked for ~200 ms at a stretch and anything animated in JS would
 *    freeze exactly when it needs to reassure. The bouncing dots are a CSS
 *    keyframe animation, which runs on the compositor and keeps moving through a
 *    blocked main thread. That is what lets the budget be generous *and* the
 *    screen stay legibly alive.
 * 2. **It names what it is doing.** The generator's own {@link GenerationStage}
 *    strings — "shaping the ginormous slide", "laying the railway" — are already
 *    written for a child, so the caption shows them: honest progress rather than
 *    a spinner that could be spinning over nothing.
 *
 * Mounted on `document.body` for the same reason {@link JourneySkip} is: `Hud`
 * empties `#ui-root` from `new Game(...)`, which runs mid-ride, so anything put
 * there would be deleted at the moment it becomes useful.
 *
 * **This is not the fix.** Uncapping the generator during the wait
 * (`overrunAwareBudgetMs`) is what makes the wait short; this only makes a short
 * wait legible. A caption over a wait that is still minutes long is a lie, and
 * the wait is measured rather than trusted — see the PR.
 */
export class JourneyWait {
  private readonly root: HTMLElement;
  private readonly caption: HTMLElement;
  private waiting = false;
  private lastStage: GenerationStage | '' = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'journey-wait journey-wait--idle';

    const card = document.createElement('div');
    card.className = 'journey-wait__card';

    const heading = document.createElement('div');
    heading.className = 'journey-wait__heading';
    // Three dots that bounce forever on the compositor thread, so the wait reads
    // as alive even while the main thread is busy building the park.
    heading.innerHTML =
      'Getting your park ready' +
      '<span class="journey-wait__dots" aria-hidden="true">' +
      '<span></span><span></span><span></span></span>';

    this.caption = document.createElement('div');
    this.caption.className = 'journey-wait__stage';

    card.append(heading, this.caption);
    this.root.append(card);
    document.body.append(this.root);
  }

  /** True while the caption is on screen. For a check to read. */
  get shown(): boolean {
    return this.waiting;
  }

  /**
   * Show or hide the caption, and — while shown — say which part of the park is
   * being built. Called every frame from the ride loop with
   * `director.overrunning` and `generation.stage`.
   */
  update(waiting: boolean, stage: GenerationStage): void {
    if (waiting !== this.waiting) {
      this.waiting = waiting;
      this.root.classList.toggle('journey-wait--idle', !waiting);
      this.root.classList.toggle('journey-wait--busy', waiting);
    }
    if (waiting && stage !== this.lastStage) {
      this.lastStage = stage;
      this.caption.textContent = stageCaption(stage);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** The child-facing line for each stage. The generator's names, softened. */
function stageCaption(stage: GenerationStage): string {
  switch (stage) {
    case 'measuring out the park':
      return 'Measuring out the park…';
    case 'flying the sky cruiser':
      return 'Flying the sky cruiser…';
    case 'laying the railway':
      return 'Laying the railway…';
    case 'shaping the ginormous slide':
      return 'Shaping the ginormous slide…';
    case 'joining up the paths':
      return 'Joining up the paths…';
    case 'ready':
      return 'All done!';
    case 'waiting':
    default:
      return 'Warming up the engine…';
  }
}
