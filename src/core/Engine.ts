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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatioCap());
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
    this.renderer.setPixelRatio(pixelRatioCap());
    this.renderer.setSize(width, height, false);
    for (const callback of this.resizeCallbacks) callback(width, height);
  };
}
