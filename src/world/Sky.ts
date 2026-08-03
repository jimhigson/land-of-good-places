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
  /** Bearing of the view axis: `atan2(forward.x, forward.z)`. Ortho path only. */
  readonly yaw: number;
  /**
   * The camera's own axes in world space. These are what make the sky honest:
   * with them and the field of view, every pixel of the backdrop can work out
   * **which way it is looking**, and put a star at a fixed direction in the
   * world rather than at a fixed spot on the screen.
   *
   * Scratch vectors, rewritten every frame — read them, never keep them.
   */
  readonly right: Vector3;
  readonly up: Vector3;
  readonly forward: Vector3;
  /** `tan` of half the vertical field of view. Zero when there is no such thing. */
  readonly tanHalfFovY: number;
  /**
   * True when a perspective camera is drawing.
   *
   * False selects the orthographic cheat above, unchanged — which is what
   * guarantees ordinary play still renders exactly as it did.
   */
  readonly perspective: boolean;
}

/** Scratch for {@link skyViewFor}. Module-level so a per-frame call allocates nothing. */
const VIEW_RIGHT = new Vector3();
const VIEW_UP = new Vector3();
const VIEW_FORWARD = new Vector3();
/** Scratch for {@link Sky.directionToScreen}. Same reason: no per-frame allocation. */
const DIRECTION = new Vector3();

/**
 * Where a disc behind the camera is parked: far enough outside the frame that
 * neither it nor its exponential bloom can contribute a single pixel.
 */
const BEHIND_THE_CAMERA = 1e3;

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
      right: VIEW_RIGHT.set(1, 0, 0),
      up: VIEW_UP.set(0, 1, 0),
      forward: VIEW_FORWARD.set(0, 0, 1),
      tanHalfFovY: 0,
      perspective: false,
    };
  }
  // The camera's own axes, straight off its world matrix. A three.js camera
  // looks down its **−z**, so the third basis vector is "back" and is negated.
  override.updateMatrixWorld();
  override.matrixWorld.extractBasis(VIEW_RIGHT, VIEW_UP, VIEW_FORWARD);
  VIEW_RIGHT.normalize();
  VIEW_UP.normalize();
  VIEW_FORWARD.normalize().negate();
  return {
    yaw: Math.atan2(VIEW_FORWARD.x, VIEW_FORWARD.z),
    right: VIEW_RIGHT,
    up: VIEW_UP,
    forward: VIEW_FORWARD,
    tanHalfFovY: Math.tan((override.fov * DEG) / 2),
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
const LEVEL_VIEW: SkyView = {
  yaw: 0,
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  forward: new Vector3(0, 0, 1),
  tanHalfFovY: 0,
  perspective: false,
};

export class Sky {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  /** Kept alongside `uAspect` because the direction mapping needs it too. */
  private aspect = 1;
  private view: SkyView = LEVEL_VIEW;
  //
  // There is deliberately **no accumulated pan** here any more.
  //
  // The first version of this file slid a flat star grid sideways by the
  // camera's bearing, which needed the bearing unwrapped past ±pi (an `atan2`
  // snaps there, and the field flicked thirteen screen widths in one frame),
  // and which was still about 30% too fast because a lens projects `tan` of an
  // angle rather than the angle. Both problems were the same problem: a screen
  // offset standing in for a rotation. Passing the camera's axes to the shader
  // and letting each pixel find its own ray removes the stand-in, and with it
  // every rate, wrap and seam that came with it.

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
        // Which way the camera is looking, as its own three axes plus the two
        // tangents of its field of view. With these every pixel can work out
        // its own view ray, which is what lets stars sit at fixed directions in
        // the world instead of being slid about the screen. Zero for the park's
        // orthographic rig, where there is no such thing as a per-pixel ray.
        uPerspective: { value: 0 },
        uViewRight: { value: new Vector3(1, 0, 0) },
        uViewUp: { value: new Vector3(0, 1, 0) },
        uViewForward: { value: new Vector3(0, 0, 1) },
        uTanHalfFovX: { value: 1 },
        uTanHalfFovY: { value: 1 },
        // How far towards space the sky has been taken, 0..1 — `DayNight`'s
        // own space factor, passed straight through. The shader decides what
        // that means; right now it means the star field's horizon fade eases
        // off until there is none, because up there there is no horizon.
        uSpace: { value: 0 },
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
        uniform float uPerspective;
        uniform vec3 uViewRight;
        uniform vec3 uViewUp;
        uniform vec3 uViewForward;
        uniform float uTanHalfFovX;
        uniform float uTanHalfFovY;
        uniform float uSpace;

        // Cheap 2D hash for the star field.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        /**
         * Where a star field cell lives for a given view ray.
         *
         * The direction is dropped onto whichever face of a cube around the
         * camera it points at, and that face's own 2D coordinates are what get
         * hashed. A cube face is the cheapest way to cut a sphere into cells
         * that are all roughly the same size and shape — hashing the raw xyz
         * instead clumps stars towards the axes, and hashing latitude/longitude
         * piles them up at the poles, which is exactly overhead.
         *
         * The face index is folded into the coordinates so no two faces draw
         * the same stars.
         */
        vec2 skyCell(vec3 direction) {
          vec3 a = abs(direction);
          if (a.x >= a.y && a.x >= a.z) {
            return vec2(direction.z, direction.y) / a.x + (direction.x > 0.0 ? 11.0 : 23.0);
          }
          if (a.y >= a.z) {
            return vec2(direction.x, direction.z) / a.y + (direction.y > 0.0 ? 37.0 : 51.0);
          }
          return vec2(direction.x, direction.y) / a.z + (direction.z > 0.0 ? 67.0 : 83.0);
        }

        void main() {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec2 p = vec2(ndc.x * uAspect, ndc.y);

          // The sky's own coordinates: the screen's, slid by however far the
          // park has slid under the camera. Used by the orthographic path,
          // where there is no view ray to speak of. Everything that is the sky
          // itself — the gradient, the horizon band — stays in screen space,
          // because the horizon does not move when you walk towards it. (It
          // does move when you look *up*, which is uHorizonY's job.)
          vec2 skyP = p - uSkyOffset;

          // This pixel's own view ray, in world space. The whole reason the
          // camera's axes are passed in: with a real ray, a star can be a fixed
          // *direction* rather than a spot on the screen that has to be slid
          // about to fake one. Slide it and the rate is wrong by however much
          // tan differs from the angle itself — about 30% at a 62 degree
          // field of view, which is very visible as stars racing the world.
          vec3 ray = normalize(
            uViewForward
              + uViewRight * (ndc.x * uTanHalfFovX)
              + uViewUp * (ndc.y * uTanHalfFovY)
          );

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
          //
          // Under a perspective camera the grid is wrapped round a cube in the
          // *world* (see skyCell), so a star holds its direction however the
          // camera turns, tilts or widens its lens — the projection does all
          // the work, and there is no pan rate left to get wrong. The
          // orthographic park keeps the flat screen grid, because a parallel
          // projection has no per-pixel ray to hang a direction on.
          if (uStarStrength > 0.001) {
            vec2 grid = uPerspective > 0.5 ? skyCell(ray) * 40.0 : skyP * 26.0;
            vec2 cell = floor(grid);
            vec2 local = fract(grid);
            float r = hash(cell);
            if (r > 0.72) {
              vec2 starPoint = vec2(hash(cell + 1.7), hash(cell + 4.3));
              float d = length(local - starPoint);
              float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + r * 40.0);
              float brightness = smoothstep(0.09, 0.0, d) * twinkle;
              // Fade stars out towards the horizon so they sit behind the park
              // — by the ray's own altitude where there is one, which is what
              // makes looking *down* from a ride dark and starless rather than
              // starry-because-it-is-high-on-the-screen.
              //
              // ...and the higher you climb the less horizon there is to fade
              // towards, until in space there is none at all and the stars go
              // the whole way round, underfoot included. Straight in
              // proportion to uSpace: no second curve, so how quickly the
              // stars wrap around a child is exactly how quickly she is
              // getting to space.
              float altitude = uPerspective > 0.5 ? smoothstep(-0.04, 0.30, ray.y) : smoothstep(0.05, 0.55, h);
              float altitudeFade = mix(altitude, 1.0, uSpace);
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
   * orthographic rig reports a level, unturned view and everything below
   * collapses to the mapping it always had, so ordinary play is untouched.
   *
   * **The camera's axes are the whole trick.** Handing them to the shader lets
   * every pixel of the backdrop reconstruct its own view ray, so a star is a
   * fixed direction in the world and the projection is what moves it. There is
   * no pan rate to get wrong, no wrap at ±pi to flick over, and a `RideCamera`
   * widening its own `fov` with speed is handled by the arithmetic rather than
   * by anything here having to notice.
   *
   * The first version of this *did* slide a flat star grid about, scaled
   * linearly in the turn angle. Jim rode it and said the stars scrolled too
   * fast — they did, by about 30% at this ride's 62 degree lens, because a
   * lens projects `tan(angle)` and not the angle. That is the bug this shape
   * makes unrepresentable.
   */
  setView(view: SkyView): void {
    const uniforms = this.material.uniforms;
    (uniforms.uPerspective as { value: number }).value = view.perspective ? 1 : 0;
    this.view = view;

    if (!view.perspective) {
      (uniforms.uHorizonY as { value: number }).value = HORIZON_Y_LEVEL;
      return;
    }

    (uniforms.uViewRight as { value: Vector3 }).value.copy(view.right);
    (uniforms.uViewUp as { value: Vector3 }).value.copy(view.up);
    (uniforms.uViewForward as { value: Vector3 }).value.copy(view.forward);
    (uniforms.uTanHalfFovY as { value: number }).value = view.tanHalfFovY;
    (uniforms.uTanHalfFovX as { value: number }).value = view.tanHalfFovY * this.aspect;

    // Look up and the horizon slides down the frame. Without this the stars
    // would move correctly while the gradient and the horizon band stayed
    // nailed across the middle of the screen.
    const pitch = Math.asin(clamp(view.forward.y, -1, 1));
    const halfFovY = Math.atan(view.tanHalfFovY);
    (uniforms.uHorizonY as { value: number }).value = clamp(
      HORIZON_Y_LEVEL - (pitch / halfFovY) * HORIZON_Y_LEVEL,
      0.02,
      0.98,
    );
  }

  /**
   * How far towards space the sky has been taken, 0..1.
   *
   * `DayNight`'s own space factor, passed through **unshaped** — the sky is
   * told how high up it is and works out what that means, rather than being
   * handed a second curve someone would then have to keep in step with the
   * first. Today it means the star field's horizon fade eases off: on the
   * ground stars fade out low so they sit behind the park, and up there is no
   * horizon to fade towards, so they go all the way round and underfoot.
   */
  setSpace(amount: number): void {
    (this.material.uniforms.uSpace as { value: number }).value = clamp(amount, 0, 1);
  }

  /**
   * Where something at a given compass bearing and altitude lands on screen,
   * in the shader's own coordinates (x spans +/-aspect, y spans +/-1).
   *
   * Under a perspective camera this is a **real projection** through the
   * camera's own axes and lens — the same arithmetic the star field's rays
   * come from, so the sun and the moon cannot drift against the stars. Under
   * the park's orthographic rig it is the old cheat, because a parallel
   * projection has no true projection of something at infinity.
   */
  directionToScreen(azimuth: number, altitude: number, into: Vector2): Vector2 {
    const view = this.view;
    if (!view.perspective) {
      // The legacy cheat, byte for byte: bearing straight onto x, altitude
      // straight onto y. There is no field of view to do better with.
      const relative = angleDelta(view.yaw, azimuth);
      return into.set(
        relative / ORTHO_HALF_FOV_X,
        ORTHO_ALTITUDE_OFFSET + (altitude / (Math.PI / 2)) * ORTHO_ALTITUDE_SCALE,
      );
    }

    // The world direction it sits in, then that direction in the camera's own
    // frame, then a perspective divide. Textbook, and the point is precisely
    // that it is textbook: nothing here is tuned, so nothing here can be
    // tuned wrong.
    const cosAltitude = Math.cos(altitude);
    DIRECTION.set(
      Math.sin(azimuth) * cosAltitude,
      Math.sin(altitude),
      Math.cos(azimuth) * cosAltitude,
    );
    const forward = DIRECTION.dot(view.forward);
    if (forward <= 1e-4) {
      // Behind the camera. There is no projection of that onto the frame, so
      // park it far outside instead — the disc is not drawn and its bloom,
      // which falls off exponentially, contributes nothing.
      return into.set(BEHIND_THE_CAMERA, BEHIND_THE_CAMERA);
    }
    return into.set(
      (DIRECTION.dot(view.right) / forward / (view.tanHalfFovY * this.aspect)) * this.aspect,
      DIRECTION.dot(view.up) / forward / view.tanHalfFovY,
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
