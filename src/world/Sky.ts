import {
  Color,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../core/palette';
import { DEG, angleDelta, clamp } from '../core/mathUtils';

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
 * Where the horizon line sits when the view is level, as a fraction of screen
 * height. The park's hill crest sits around here, which is what puts a sunset
 * glow just above the treetops instead of behind the ground.
 *
 * Pitching a first-person camera up slides it *down* from here — see
 * {@link Sky.setView}.
 */
const HORIZON_Y_LEVEL = 0.5;

/**
 * The legacy orthographic mapping's horizontal scale: a bearing this far off
 * the view axis lands one screen half-width across.
 *
 * Kept at exactly its old value (`Math.PI / 3`) rather than derived from
 * anything, because the park's camera has no field of view to derive it *from*
 * — a parallel projection does not have one. It is a cheat that has always
 * tracked convincingly, and this file's job is to leave it alone.
 */
const ORTHO_HALF_FOV_X = Math.PI / 3;

/** The same cheat's vertical mapping: altitude to screen, plus its offset. */
const ORTHO_ALTITUDE_SCALE = 1.55;
const ORTHO_ALTITUDE_OFFSET = -0.4;

/**
 * How the sky is being looked at this frame.
 *
 * Built by {@link skyViewFor} from whichever camera is about to draw. The
 * whole point is that this is a property of *the camera*, never of "is a ride
 * happening" — see this file's header.
 */
export interface SkyView {
  /** Bearing of the view axis: `atan2(forward.x, forward.z)`. */
  readonly yaw: number;
  /** Altitude of the view axis, radians, positive up. Zero for the park's rig. */
  readonly pitch: number;
  /** Half the vertical field of view, radians. Zero when there is no such thing. */
  readonly halfFovY: number;
  /**
   * True when a perspective camera is drawing.
   *
   * False selects the orthographic cheat above, unchanged — which is what
   * guarantees ordinary play still renders exactly as it did.
   */
  readonly perspective: boolean;
}

/** Scratch for {@link skyViewFor}. Module-level so a per-frame call allocates nothing. */
const VIEW_FORWARD = new Vector3();

/**
 * Reads a {@link SkyView} off whichever camera is drawing.
 *
 * `override` is `Game.cameraOverride` — the ride camera, or `/view`'s debug
 * camera, or `null` when the park's own rig has the world. A `PerspectiveCamera`
 * has a real field of view and a direction that can point anywhere, so both
 * come straight off it, `fov` included: `RideCamera` widens that with speed,
 * and taking it live is what stops the stars and the sun sliding against each
 * other when it does.
 *
 * `groundForward` is `IsoCamera.forward`, and is used **only** for the
 * orthographic case. It is passed in rather than read off the camera on
 * purpose: it is the exact vector whose bearing has always placed the sun and
 * moon, so routing the old path through the same number is what guarantees
 * ordinary play renders identically. Deriving it afresh from the camera's
 * world direction would *probably* agree — and "probably" is not a thing to
 * find out from a screenshot of a sunset.
 */
export function skyViewFor(
  override: PerspectiveCamera | null,
  groundForward: Readonly<Vector3>,
): SkyView {
  if (!override) {
    return {
      yaw: Math.atan2(groundForward.x, groundForward.z),
      pitch: 0,
      halfFovY: 0,
      perspective: false,
    };
  }
  override.getWorldDirection(VIEW_FORWARD);
  return {
    yaw: Math.atan2(VIEW_FORWARD.x, VIEW_FORWARD.z),
    pitch: Math.asin(clamp(VIEW_FORWARD.y, -1, 1)),
    halfFovY: (override.fov * DEG) / 2,
    perspective: true,
  };
}

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
 * likewise frame-identical.
 *
 * So the parallax is authored instead: see {@link SKY_PARALLAX}.
 *
 * ### The park's camera cannot rotate. Other cameras can.
 *
 * This file used to add "…and the camera never rotates either
 * (ARCHITECTURE.md, *One camera angle, forever*), so there is no rotation to
 * derive an offset from." That was true when it was written and stopped being
 * true the day first-person rides landed. `IsoCamera` still solves its basis
 * once from `CAMERA_YAW_DEGREES` and never turns — but a ride's `RideCamera`
 * is what actually draws the world while you are on it (`Game.cameraOverride`),
 * and *that* one turns as you turn your head. With no rotation term the whole
 * sky turned with it: stars, sun and moon all pinned to the screen, which is
 * the wallpaper bug this file was written to kill, back again in the one place
 * a child is deliberately looking around.
 *
 * So {@link Sky.setView} is told **which camera is drawing this frame**, not
 * whether a ride is on. Two consequences worth keeping:
 *
 * - The park's own orthographic rig reports zero rotation and zero pitch, so
 *   ordinary play is unchanged, to the bit.
 * - Anything else that ends up in `cameraOverride` — a first-person walking
 *   mode, `/view`'s debug camera — is handled the day it arrives, with no
 *   further work here.
 */
/** What {@link Sky.setView} reports for the park's own camera: level, unturned. */
const LEVEL_VIEW: SkyView = { yaw: 0, pitch: 0, halfFovY: 0, perspective: false };

export class Sky {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  /** Kept alongside `uAspect` because the direction mapping needs it too. */
  private aspect = 1;
  private view: SkyView = LEVEL_VIEW;
  /**
   * The view's bearing, **unwrapped** — it keeps counting past ±π instead of
   * jumping back round, and it is what the star field is panned by.
   *
   * `SkyView.yaw` is an `atan2`, so it snaps from +π to −π as you turn past
   * due south. Panning by that directly moves the whole star field across the
   * frame in a single frame — about thirteen screen widths at a 62° field of
   * view — which is a bright, obvious flick, and precisely the sort of thing
   * nobody would have found by turning slowly and watching. `check:sky-view`
   * caught it and now guards it.
   *
   * The discs do not need this: `angleDelta` already brings their bearing into
   * ±π, which is continuous everywhere except directly behind the camera,
   * where nothing is drawn.
   *
   * One residual, and it is deliberate: a **net** full turn leaves the field
   * panned a whole turn along, so the stars overhead are a different patch of
   * the hash grid than the ones you started under. The grid is unbounded and
   * statistically the same everywhere, so there is nothing to notice — and the
   * things a child actually navigates by (the sun, the moon, and in the ferris
   * wheel the Earth and the friends) are real directions that come back
   * exactly. Making the field itself periodic would mean forcing a whole turn
   * to be a whole number of star cells, which would break the honest
   * one-half-width-per-half-field-of-view scale the moment `fov` changed.
   */
  private panYaw = 0;
  /** Last frame's wrapped bearing, or NaN when the last frame was not perspective. */
  private lastViewYaw = Number.NaN;

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
        // How far the sky has turned, same units. Written by {@link Sky.setView}
        // from where the camera is *looking*. Deliberately a second uniform
        // rather than folded into `uSkyOffset`: that one is deliberately
        // saturated so walking can never push the moon off the frame
        // (DISC_TRAVEL_LIMIT), and turning your head absolutely should.
        uSkyRotation: { value: new Vector2(0, 0) },
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
        uniform vec2 uSkyRotation;

        // Cheap 2D hash for the star field.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec2 p = vec2(ndc.x * uAspect, ndc.y);

          // The sky's own coordinates: the screen's, slid by however far the
          // park has slid under the camera, and turned by however far the
          // camera has turned. Everything that is *in* the sky — stars, moon,
          // sun — is placed in these; everything that is the sky itself — the
          // gradient, the horizon band, the altitude fade — stays in screen
          // space, because the horizon does not move when you walk towards it.
          // (It does move when you look *up*, which is uHorizonY's job, not
          // this one's.)
          //
          // The star field is a hash grid over an unbounded domain, so panning
          // it has no seam, no wrap and no edge to reach: turning all the way
          // round costs one subtraction and finds new stars the whole way.
          vec2 skyP = p - uSkyOffset - uSkyRotation;

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
    this.aspect = aspect;
    (this.material.uniforms.uAspect as { value: number }).value = aspect;
  }

  /**
   * Tells the sky which camera is drawing it, so it can turn.
   *
   * Call once a frame, before {@link render}, with whatever camera the world
   * pass is about to use — `Game.cameraOverride ?? camera.camera`. The park's
   * orthographic rig reports a level, unrotated view and everything below
   * collapses to zero, so ordinary play is untouched.
   *
   * Two things move, and they have to move together or the sky comes apart:
   * the **star field**, panned by `uSkyRotation`, and the **sun and moon**,
   * placed by {@link directionToScreen}. Both take their scale from the same
   * {@link SkyView}, which is the only reason a `RideCamera` widening its own
   * `fov` with speed cannot slide one against the other.
   */
  setView(view: SkyView): void {
    const rotation = (this.material.uniforms.uSkyRotation as { value: Vector2 }).value;
    if (!view.perspective) {
      rotation.set(0, 0);
      (this.material.uniforms.uHorizonY as { value: number }).value = HORIZON_Y_LEVEL;
      // Forget the running bearing, so the next ride starts from its own first
      // frame rather than accumulating a jump across the curtain wipe.
      this.lastViewYaw = Number.NaN;
      this.view = view;
      return;
    }

    // Unwrap: accumulate the frame-to-frame change rather than taking the
    // bearing itself. See {@link panYaw}.
    this.panYaw = Number.isNaN(this.lastViewYaw)
      ? view.yaw
      : this.panYaw + angleDelta(this.lastViewYaw, view.yaw);
    this.lastViewYaw = view.yaw;

    const halfFovX = this.halfFovX(view);
    // Turn right and the stars go left, look up and they go down — hence both
    // negative. Radians into screen half-widths/half-heights: **linear in the
    // angle**, not `tan`, because a tangent mapping diverges at 90° and this
    // field has to survive being turned all the way round. Linear in angle is
    // a cylindrical projection, which is exactly the right feel for a sky that
    // wraps around you.
    rotation.set((-this.panYaw * this.aspect) / halfFovX, -view.pitch / view.halfFovY);

    // Look up and the horizon slides down the frame. Without this the stars
    // would pan while the gradient and the horizon band stayed nailed across
    // the middle of the screen — the same wallpaper tell, one level down, and
    // most obvious in a gondola looking up into space.
    (this.material.uniforms.uHorizonY as { value: number }).value = clamp(
      HORIZON_Y_LEVEL - (view.pitch / view.halfFovY) * HORIZON_Y_LEVEL,
      0.02,
      0.98,
    );
    this.view = view;
  }

  /**
   * Where something at a given compass bearing and altitude lands on screen,
   * in the shader's own coordinates (x spans ±aspect, y spans ±1).
   *
   * This is the one place that answers "where in the sky is that?", so the sun,
   * the moon and anything added later cannot disagree with each other or with
   * the star field.
   */
  directionToScreen(azimuth: number, altitude: number, into: Vector2): Vector2 {
    const view = this.view;
    const relative = angleDelta(view.yaw, azimuth);
    if (!view.perspective) {
      // The legacy cheat, byte for byte: bearing straight onto x, altitude
      // straight onto y. There is no field of view to do better with.
      return into.set(
        relative / ORTHO_HALF_FOV_X,
        ORTHO_ALTITUDE_OFFSET + (altitude / (Math.PI / 2)) * ORTHO_ALTITUDE_SCALE,
      );
    }
    return into.set(
      (relative * this.aspect) / this.halfFovX(view),
      (altitude - view.pitch) / view.halfFovY,
    );
  }

  /** True while a perspective camera is drawing — see {@link setView}. */
  get viewIsPerspective(): boolean {
    return this.view.perspective;
  }

  /** Bearing of the view axis this frame. */
  get viewYaw(): number {
    return this.view.yaw;
  }

  /** Half the horizontal field of view, widened from the vertical by the aspect. */
  private halfFovX(view: SkyView): number {
    return Math.atan(Math.tan(view.halfFovY) * this.aspect);
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
