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
 * How far the sky slides when the park slides — the authored stand-in for the
 * parallax an orthographic camera cannot give us (see {@link Sky}).
 *
 * The scale is honest even if the number is a choice: `1.0` would pin the sky
 * to the ground and make the stars scroll past exactly as fast as the trees do,
 * `0` is the wallpaper we started with, and everything in between reads as a
 * sky that much further away.
 *
 * 0.03 puts a full crossing of the park — about 110 m — at a shift of roughly
 * four tenths of the screen's height. Walking a few metres visibly moves the
 * sky; nothing ever streams past.
 */
const SKY_PARALLAX = 0.03;

/**
 * How far the sun and the moon are allowed to travel with the sky, in screen
 * half-heights.
 *
 * They ride the same offset as the stars, because one of them holding still
 * while the field drifts around it is exactly the tell we are trying to remove.
 * But a star field is endless and a moon is a single disc: left unbounded it
 * would slide off the edge of the frame and a child standing at the boundary of
 * the park would have no moon at all. So their share of the offset saturates
 * smoothly towards this limit — one-to-one with the stars for the small
 * movements the eye actually compares, easing off long before the edge.
 */
const DISC_TRAVEL_LIMIT = 0.28;

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
 * and knows how to draw it. The one exception is {@link setParallax}, which is
 * about where the camera is rather than what time it is.
 *
 * ### Why the sky is not a dome, and cannot be
 *
 * The family's report was that the night stars sat still relative to the
 * *screen* and read as wallpaper. The obvious fix — put them on a huge
 * world-anchored dome — does not work here, and it is worth writing down why
 * so nobody spends an afternoon rediscovering it:
 *
 * an orthographic projection has **no depth parallax at all**. Every view ray
 * is parallel, so moving the camera sideways slides near and far things across
 * the frame by exactly the same number of pixels. A dome pinned to the world
 * therefore projects to identical pixels wherever the camera stands — which is
 * precisely the bug — and a dome re-centred on the camera each frame is
 * likewise frame-identical. The camera never rotates either (ARCHITECTURE.md,
 * "One camera angle, forever"), so there is no rotation to derive an offset
 * from.
 *
 * So the parallax is authored instead: see {@link SKY_PARALLAX}.
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
        // How far the whole sky has slid, in screen half-heights. Written by
        // {@link Sky.setParallax} from where the camera is standing.
        uSkyOffset: { value: new Vector2(0, 0) },
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
        uniform vec2 uSkyOffset;

        // Cheap 2D hash for the star field.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec2 p = vec2(ndc.x * uAspect, ndc.y);

          // The sky's own coordinates: the screen's, slid by however far the
          // park has slid under the camera. Everything that is *in* the sky
          // — stars, moon, sun — is placed in these; everything that is the
          // sky itself — the gradient, the horizon band, the altitude fade —
          // stays in screen space, because the horizon does not move when you
          // walk towards it.
          vec2 skyP = p - uSkyOffset;

          // The two discs saturate rather than travel forever, so neither can
          // ever leave the frame. See DISC_TRAVEL_LIMIT.
          float slide = length(uSkyOffset);
          vec2 discP = p - uSkyOffset * (${DISC_TRAVEL_LIMIT.toFixed(3)} / (${DISC_TRAVEL_LIMIT.toFixed(3)} + slide));

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
            vec2 grid = skyP * 26.0;
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
            float d = length(discP - uMoonPosition);
            float disc = smoothstep(0.075, 0.055, d);
            float halo = exp(-d * 7.0) * 0.35;
            colour += vec3(0.87, 0.91, 1.0) * (disc + halo) * uMoonVisible;
          }

          // Sun: bright core plus a wide, soft bloom.
          if (uSunVisible > 0.001) {
            float d = length(discP - uSunPosition);
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

  /**
   * Tells the sky where the player is standing, so it can slide.
   *
   * @param anchorX  world metres the origin sits right of screen centre
   * @param anchorY  world metres the origin sits above screen centre
   * @param halfHeight  half the camera's view box, in world metres
   *
   * Both anchors come from `IsoCamera.skyAnchor`; dividing by the view's own
   * half-height converts metres into the shader's screen units and gets the
   * zoom response for free — zoomed in, the same few steps across the grass
   * cover more of the frame, so the sky above them slides further too, exactly
   * as the trees do.
   */
  setParallax(anchorX: number, anchorY: number, halfHeight: number): void {
    const scale = SKY_PARALLAX / Math.max(0.001, halfHeight);
    (this.material.uniforms.uSkyOffset as { value: Vector2 }).value.set(
      anchorX * scale,
      anchorY * scale,
    );
  }

  /** Draws the backdrop. Call before rendering the world, with autoClear off. */
  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
