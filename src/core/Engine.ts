import {
  Color,
  Fog,
  NeutralToneMapping,
  Scene,
  SRGBColorSpace,
  VSMShadowMap,
  WebGLRenderer,
} from 'three';
import { FOG_FAR, FOG_NEAR } from './constants';
import { AdaptiveResolution, adaptiveResolutionRequested } from './adaptiveResolution';
import { pixelRatioCap } from './device';
import { PALETTE } from './palette';

/**
 * Owns the WebGL renderer, the scene and the canvas sizing.
 *
 * Deliberately knows nothing about gameplay: it is the "screen" the rest of the
 * game draws onto. Systems should never touch `renderer` directly except for
 * the odd capability query.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;

  private readonly resizeCallbacks = new Set<(width: number, height: number) => void>();
  private readonly resizeObserver: ResizeObserver;

  private widthValue = 1;
  private heightValue = 1;

  /**
   * **The quality governor** (120 fps plan, step 17;
   * `core/adaptiveResolution.ts`): steps the pixel ratio down when GPU-bound
   * frames persist and back up when they stop. The one owner of the quality
   * level — read `.quality`, or `.subscribe()` to hear it change. Always
   * present: under `?adaptiveDpr=0` it is pinned at the screen's cap (one
   * level, never changes) for A/B measurement.
   */
  readonly adaptiveResolution: AdaptiveResolution;

  private readonly bufferCallbacks = new Set<(pixelRatio: number) => void>();
  private frameStartMs = -1;
  private lastCpuMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.adaptiveResolution = new AdaptiveResolution(pixelRatioCap(), { pinned: !adaptiveResolutionRequested() });
    this.renderer.setPixelRatio(this.adaptiveResolution.pixelRatio);
    // **The single biggest cause of mid-play stutter, and it is not our code.**
    // three.js checks every newly-linked shader program for errors the first
    // time it is used (`WebGLProgram`'s `onFirstUse`), and the check begins with
    // `gl.getProgramInfoLog`. That call cannot answer until the GPU process has
    // finished linking, so it blocks the main thread on a synchronous
    // round-trip — measured on an M4 Pro at up to **152 ms for a single
    // program**, arriving in bursts as new materials come into view, and once
    // stalling a frame for 1.29 s. Programs compile lazily, so this lands while
    // a child is walking about, not at load.
    //
    // Off in the build the family plays; **on in dev**, where a shader author
    // needs the error text and a stall costs nothing. This is why a broken
    // hand-written `ShaderMaterial` still reports itself during development.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Neutral rather than ACES: ACES filmic desaturates bright colours towards
    // white, which is exactly the wrong look for a park made of sweets. Neutral
    // rolls off the highlights without draining the pinks and greens.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in current three; VSM gives genuinely soft
    // edges, which suits the chunky, rounded geometry far better than hard PCF.
    this.renderer.shadowMap.type = VSMShadowMap;
    // The Sky system draws a full-screen backdrop pass before the world, so the
    // game owns clearing (see Game.render).
    this.renderer.autoClear = false;
    this.renderer.setClearColor(new Color(PALETTE.skyDayBottom), 1);

    this.scene = new Scene();
    // Left null on purpose: the sky pass has already painted the frame, and a
    // scene background here would draw straight over it.
    this.scene.background = null;
    // Linear fog gives the cosy "the park fades into a nice day" feeling. The
    // DayNight system re-tints this colour as the sun moves.
    this.scene.fog = new Fog(PALETTE.skyDayBottom, FOG_NEAR, FOG_FAR);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement ?? document.body);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  get aspect(): number {
    return this.widthValue / Math.max(1, this.heightValue);
  }

  /** Registers a resize handler and immediately calls it with current size. */
  onResize(callback: (width: number, height: number) => void): () => void {
    this.resizeCallbacks.add(callback);
    callback(this.widthValue, this.heightValue);
    return () => this.resizeCallbacks.delete(callback);
  }

  /**
   * Registers a handler for the **drawing buffer** changing size without the
   * canvas changing size on the page — the governor stepping the pixel ratio.
   * Anything that owns a render target sized in device pixels (an outline or
   * post-processing pass) resizes it here; `onResize` alone would never tell
   * it, because the CSS size it reports has not moved. Called before the first
   * draw at the new size.
   */
  onDrawingBufferResize(callback: (pixelRatio: number) => void): () => void {
    this.bufferCallbacks.add(callback);
    return () => this.bufferCallbacks.delete(callback);
  }

  /**
   * Called by the game loop **before anything is drawn** each frame. Feeds the
   * governor the frame that has just ended and applies its answer.
   *
   * Why here and not after the frame's last render: changing the pixel ratio
   * reallocates the drawing buffer, which clears it. Done after the draw, the
   * browser would composite that cleared buffer — one black frame, a flash on
   * every step. Done first, the buffer is cleared and fully redrawn inside
   * the same task and the only thing presented is a finished frame. The
   * canvas's CSS box is untouched (`setPixelRatio` resizes with
   * `updateStyle: false`), so nothing in the page reflows and the DOM UI,
   * which the browser rasterises at the real device ratio, stays as crisp as
   * it was.
   *
   * `busy` (a transition is covering the screen) and `scene` (a key that
   * changes with the space she is in) pause adaptation — see the governor.
   */
  beginFrame(busy = false, scene?: string | number): void {
    const now = performance.now();
    const ratio = this.adaptiveResolution.frame(now, this.lastCpuMs, busy, scene);
    this.frameStartMs = now;
    if (ratio !== this.renderer.getPixelRatio()) this.applyPixelRatio(ratio);
  }

  /** Called by the game loop after the frame's last render call: closes the CPU measurement. */
  endFrame(): void {
    this.lastCpuMs = this.frameStartMs < 0 ? 0 : performance.now() - this.frameStartMs;
  }

  private applyPixelRatio(ratio: number): void {
    // `setPixelRatio` resizes the drawing buffer (three calls
    // `setSize(w, h, false)`), so only on a change — the governor's hysteresis
    // keeps those rare.
    this.renderer.setPixelRatio(ratio);
    for (const callback of this.bufferCallbacks) callback(ratio);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }

  private readonly handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, Math.floor(parent?.clientWidth ?? window.innerWidth));
    const height = Math.max(1, Math.floor(parent?.clientHeight ?? window.innerHeight));
    if (width === this.widthValue && height === this.heightValue) return;

    this.widthValue = width;
    this.heightValue = height;
    // The screen's cap can change on a resize (a window dragged to another
    // monitor); the controller restarts from the top of the new ladder.
    this.adaptiveResolution.setCap(pixelRatioCap());
    this.renderer.setPixelRatio(this.adaptiveResolution.pixelRatio);
    this.renderer.setSize(width, height, false);
    for (const callback of this.resizeCallbacks) callback(width, height);
  };
}
