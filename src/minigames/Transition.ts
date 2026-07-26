import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../core/palette';
import { clamp01 } from '../core/mathUtils';

/**
 * The iris wipe between the park and a mini-game.
 *
 * A single full-screen quad with a scalloped hole punched in it — the cheapest
 * possible transition (one draw call, no render targets, no copies of the
 * frame) and the one that reads most like a fairground curtain. It is drawn
 * *over* whatever was rendered that frame, so the same object covers both
 * halves of the journey: it closes over the park, the mini-game is built behind
 * it, and it opens again over the mini-game.
 *
 * The edge is deliberately not a circle. Eight shallow scallops turn a camera
 * iris into something more like a flower closing, which is the difference
 * between "loading" and "here we go!".
 */

/** Seconds for one half of the wipe. Two of these bracket every entrance. */
export const WIPE_SECONDS = 0.42;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * `uOpen` is 0 (fully closed, screen covered) to 1 (fully open, nothing drawn).
 *
 * The `<tonemapping_fragment>` / `<colorspace_fragment>` includes are not
 * optional: uniform colours are linear and the framebuffer is sRGB, so without
 * them the curtain comes out dark and the wrong hue (see ARCHITECTURE.md).
 */
const FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpen;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float d = length(p);
    float angle = atan(p.y, p.x);
    // Scalloped edge: eight shallow petals, and a half-scallop offset so the
    // shape turns very slightly as it closes.
    float scallop = 1.0 + 0.055 * cos(angle * 8.0 + uOpen * 2.4);
    float radius = uOpen * 0.92 * scallop;
    float alpha = 1.0 - smoothstep(radius - 0.035, radius + 0.035, d);
    // Inside the iris nothing is drawn at all, so the world shows through.
    if (alpha >= 0.999) discard;
    gl_FragColor = vec4(uColour, 1.0 - alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export type WipeDirection = 'closing' | 'opening';

export class Transition {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  private direction: WipeDirection = 'opening';
  private timer = WIPE_SECONDS;

  constructor(colour: number = PALETTE.markerPink) {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColour: { value: new Color(colour) },
        uOpen: { value: 1 },
        uAspect: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** True while the wipe is still moving. */
  get busy(): boolean {
    return this.timer < WIPE_SECONDS;
  }

  /** True when the screen is completely covered. */
  get covered(): boolean {
    return this.openAmount <= 0.001;
  }

  setAspect(aspect: number): void {
    this.material.uniforms.uAspect!.value = aspect;
  }

  setColour(colour: number): void {
    (this.material.uniforms.uColour!.value as Color).setHex(colour);
  }

  /** Starts a wipe. `closing` covers the screen; `opening` reveals it. */
  play(direction: WipeDirection, colour?: number): void {
    if (colour !== undefined) this.setColour(colour);
    this.direction = direction;
    this.timer = 0;
    this.apply();
  }

  /** Puts the curtain somewhere immediately: fully open, or fully closed. */
  snap(direction: WipeDirection): void {
    this.direction = direction;
    this.timer = WIPE_SECONDS;
    this.apply();
  }

  update(dt: number): void {
    if (!this.busy) return;
    this.timer = Math.min(WIPE_SECONDS, this.timer + dt);
    this.apply();
  }

  render(renderer: WebGLRenderer): void {
    // Nothing to draw once the iris is fully open — and skipping it means the
    // park pays nothing at all for the framework existing.
    if (this.openAmount >= 0.999) return;
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  // -------------------------------------------------------------- internals

  private get openAmount(): number {
    return this.material.uniforms.uOpen!.value as number;
  }

  private apply(): void {
    const t = clamp01(this.timer / WIPE_SECONDS);
    // Ease so the curtain starts briskly and settles, rather than arriving at a
    // dead stop. `t * t * (3 - 2 * t)` on the way out, eased-in on the way back.
    const eased = t * t * (3 - 2 * t);
    this.material.uniforms.uOpen!.value = this.direction === 'closing' ? 1 - eased : eased;
  }
}
