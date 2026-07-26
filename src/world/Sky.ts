import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../core/palette';

/**
 * The sky, drawn as a full-screen backdrop pass before the world.
 *
 * Why not a sky *dome*? Because the game camera is orthographic. With parallel
 * projection every ray points the same way, so a dome would render as one flat
 * colour and the sun would never appear on screen. Drawing the sky in screen
 * space instead gives us a proper gradient, a sun that tracks across, a moon,
 * and a twinkling star field — for the cost of one full-screen quad.
 *
 * The {@link DayNight} system owns the values; this class just holds the shader
 * and knows how to draw it.
 */
export class Sky {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTopColour: { value: new Color(PALETTE.skyDayTop) },
        uBottomColour: { value: new Color(PALETTE.skyDayBottom) },
        uHorizonColour: { value: new Color(PALETTE.skyDayBottom) },
        uHorizonStrength: { value: 0.35 },
        uSunPosition: { value: new Vector2(0.2, 0.6) },
        uSunColour: { value: new Color(PALETTE.sunDay) },
        uSunVisible: { value: 1 },
        uMoonPosition: { value: new Vector2(-0.6, -0.4) },
        uMoonVisible: { value: 0 },
        uStarStrength: { value: 0 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        // Screen height (0 = bottom, 1 = top) treated as the horizon line. The
        // park's hill crest sits around 60% up the frame, so anchoring the
        // gradient here is what puts the sunset glow just above the treetops
        // instead of hiding it behind the ground.
        uHorizonY: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;

        varying vec2 vUv;

        uniform vec3 uTopColour;
        uniform vec3 uBottomColour;
        uniform vec3 uHorizonColour;
        uniform float uHorizonStrength;
        uniform vec2 uSunPosition;
        uniform vec3 uSunColour;
        uniform float uSunVisible;
        uniform vec2 uMoonPosition;
        uniform float uMoonVisible;
        uniform float uStarStrength;
        uniform float uAspect;
        uniform float uTime;
        uniform float uHorizonY;

        // Cheap 2D hash for the star field.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec2 p = vec2(ndc.x * uAspect, ndc.y);

          // Base vertical gradient, measured up from the horizon line rather
          // than from the bottom of the screen — only the top third or so of
          // the frame is ever sky, and the interesting colours live near the
          // horizon.
          float h = clamp((vUv.y - uHorizonY) / max(0.05, 1.0 - uHorizonY), 0.0, 1.0);
          vec3 colour = mix(uBottomColour, uTopColour, pow(h, 0.72));

          // Warm band hugging the horizon — this is what sells sunrise/sunset.
          colour = mix(colour, uHorizonColour, pow(1.0 - h, 2.0) * uHorizonStrength);

          // Stars: one candidate per cell of a coarse grid, jittered within it.
          if (uStarStrength > 0.001) {
            vec2 grid = p * 26.0;
            vec2 cell = floor(grid);
            vec2 local = fract(grid);
            float r = hash(cell);
            if (r > 0.72) {
              vec2 starPoint = vec2(hash(cell + 1.7), hash(cell + 4.3));
              float d = length(local - starPoint);
              float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + r * 40.0);
              float brightness = smoothstep(0.09, 0.0, d) * twinkle;
              // Fade stars out towards the horizon so they sit behind the park.
              float altitudeFade = smoothstep(0.05, 0.55, h);
              colour += vec3(1.0, 0.97, 0.9) * brightness * uStarStrength * altitudeFade;
            }
          }

          // Moon: a soft disc with a faint halo.
          if (uMoonVisible > 0.001) {
            float d = length(p - uMoonPosition);
            float disc = smoothstep(0.075, 0.055, d);
            float halo = exp(-d * 7.0) * 0.35;
            colour += vec3(0.87, 0.91, 1.0) * (disc + halo) * uMoonVisible;
          }

          // Sun: bright core plus a wide, soft bloom.
          if (uSunVisible > 0.001) {
            float d = length(p - uSunPosition);
            float disc = smoothstep(0.085, 0.06, d);
            float bloom = exp(-d * 2.6) * 0.45;
            colour += uSunColour * (disc * 1.15 + bloom) * uSunVisible;
          }

          gl_FragColor = vec4(colour, 1.0);

          // Essential, and easy to forget on a hand-written ShaderMaterial:
          // uniform Colors are linear, the framebuffer is sRGB, and the world
          // pass is tone-mapped. Without these two chunks the sky renders dark
          // and the wrong hue, and it no longer matches the lit scene.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Uniform bag. Written by DayNight; nothing else should touch it. */
  get uniforms(): Record<string, { value: unknown }> {
    return this.material.uniforms as Record<string, { value: unknown }>;
  }

  setAspect(aspect: number): void {
    (this.material.uniforms.uAspect as { value: number }).value = aspect;
  }

  setTime(elapsed: number): void {
    (this.material.uniforms.uTime as { value: number }).value = elapsed;
  }

  /** Draws the backdrop. Call before rendering the world, with autoClear off. */
  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
