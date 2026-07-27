import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import {
  DAY_LENGTH_SECONDS,
  FAIRY_LIGHT_OFF,
  FAIRY_LIGHT_ON,
  FILL_LIGHT_RATIO,
  FOG_FAR,
  FOG_NEAR,
  NIGHT_FOG_FAR,
  NIGHT_FOG_NEAR,
  SHADOW_AREA,
} from '../core/constants';
import { shadowMapSize } from '../core/device';
import { PALETTE } from '../core/palette';
import { angleDelta, clamp, clamp01, lerp, smoothstep, TAU } from '../core/mathUtils';
import type { FrameContext, GameSystem } from '../core/types';
import type { Sky } from './Sky';
import { gameStore } from '../state';

/**
 * Time of day: the sun's arc, the colour of everything, and when the fairy
 * lights come on.
 *
 * The look is driven by a short table of keyframes ({@link SKY_KEYS}) rather
 * than a physical sky model — it is far easier to art-direct "sunset should be
 * this orange" than to derive it. Values are interpolated around the clock, so
 * the table wraps from the last entry back to the first.
 *
 * One full day takes DAY_LENGTH_SECONDS (see constants.ts) — deliberately short
 * for testing.
 */

interface SkyKey {
  /** Normalised time of day this key applies at. */
  readonly t: number;
  readonly top: number;
  readonly bottom: number;
  readonly horizon: number;
  readonly horizonStrength: number;
  /** Colour and strength of the key light (sun by day, moon by night). */
  readonly sun: number;
  readonly sunIntensity: number;
  /** Hemisphere light: sky tint, ground bounce tint, strength. */
  readonly ambientSky: number;
  readonly ambientGround: number;
  readonly ambientIntensity: number;
  /** Fog colour — always close to the horizon colour or the world detaches. */
  readonly fog: number;
}

/**
 * The colour distance fades to at midnight.
 *
 * Deliberately **darker than the night sky's own horizon band**
 * (`skyNightBottom`, 0x36407a), and close to the top of the sky
 * (`skyNightTop`, 0x121a3d). Fog that matches the horizon makes distant things
 * *vanish*; fog darker than it makes them read as silhouettes against a
 * lighter sky, which is what "distant items are less visible" actually looks
 * like at night — and it is the half of this the distances cannot do on their
 * own. It was 0x354272, near enough the horizon band to read as pale mist.
 *
 * Still a colour and not black: deep indigo, in keeping with ART_DIRECTION's
 * rule that nothing in this park bottoms out at black.
 */
const NIGHT_FOG_COLOUR = 0x1a2145;

const SKY_KEYS: readonly SkyKey[] = [
  {
    t: 0.0, // deep night
    top: PALETTE.skyNightTop,
    bottom: PALETTE.skyNightBottom,
    horizon: 0x4a5590,
    horizonStrength: 0.3,
    sun: PALETTE.moon,
    // The key light is the *sun* only now — below the horizon it fades out
    // and {@link DayNight.moonLight} takes over (see MOON_INTENSITY). This
    // value is what the fill light and the sky tint still read at night, so
    // it stays non-zero.
    sunIntensity: 0.34,
    // Lifted alongside the moonlight (from 0x4a5691 / 0x252b48 / 0.52). The
    // hemisphere is what decides how dark the *darkest* thing in the park
    // can get, and midnight was bottoming out barely off black — against the
    // "no black in this game" rule in ART_DIRECTION. Warmer and paler now, so
    // the shadow side of a toy at midnight is still obviously its own colour.
    ambientSky: 0x5d6cad,
    ambientGround: 0x3a3f66,
    ambientIntensity: 0.62,
    fog: NIGHT_FOG_COLOUR,
  },
  {
    t: 0.21, // first light
    top: PALETTE.skyDawnTop,
    bottom: PALETTE.skyDawnBottom,
    horizon: 0xffb98a,
    horizonStrength: 0.75,
    sun: 0xffb98a,
    sunIntensity: 0.9,
    ambientSky: 0xbfc6ec,
    ambientGround: 0x8d8090,
    ambientIntensity: 0.7,
    fog: 0xf2c3ad,
  },
  {
    t: 0.31, // morning
    top: 0x62b6f2,
    bottom: 0xd8f0ff,
    horizon: 0xffe0bd,
    horizonStrength: 0.4,
    sun: 0xfff0cf,
    sunIntensity: 1.35,
    ambientSky: PALETTE.ambientDay,
    ambientGround: 0x9ec98a,
    ambientIntensity: 0.72,
    fog: 0xd5edff,
  },
  {
    t: 0.5, // noon
    top: PALETTE.skyDayTop,
    bottom: PALETTE.skyDayBottom,
    horizon: 0xdff2ff,
    horizonStrength: 0.28,
    sun: PALETTE.sunDay,
    sunIntensity: 1.75,
    ambientSky: PALETTE.ambientDay,
    ambientGround: 0xa9d68f,
    ambientIntensity: 0.78,
    fog: 0xcfeaff,
  },
  {
    t: 0.65, // golden afternoon
    top: 0x4fa2e2,
    bottom: 0xffe2c0,
    horizon: 0xffcf9a,
    horizonStrength: 0.5,
    sun: 0xffddaa,
    sunIntensity: 1.5,
    ambientSky: 0xd7e6ff,
    ambientGround: 0xb0cf8c,
    ambientIntensity: 0.7,
    fog: 0xffe3c8,
  },
  {
    t: 0.735, // sunset
    top: PALETTE.skySunsetTop,
    bottom: PALETTE.skySunsetBottom,
    horizon: 0xff8f5a,
    horizonStrength: 1.0,
    sun: PALETTE.sunSet,
    sunIntensity: 1.35,
    ambientSky: 0xffb48f,
    ambientGround: 0xb88a72,
    ambientIntensity: 0.78,
    fog: 0xffa878,
  },
  {
    t: 0.80, // dusk
    top: 0x2f3873,
    bottom: 0x8a6ba8,
    horizon: 0xd4738a,
    horizonStrength: 0.6,
    sun: 0xc9a0d8,
    sunIntensity: 0.45,
    ambientSky: 0x8578b0,
    ambientGround: 0x54506e,
    ambientIntensity: 0.6,
    fog: 0x8a6f9e,
  },
];

/**
 * How hard the moon shines straight down on the park at its highest.
 *
 * Deliberately about a third of the noon sun. The brief from the family is
 * "a child can see where she is going and the park stays cosy", not "night
 * stops being night" — and the moon is a *pale* light, so most of what makes
 * it read as moonlight is {@link PALETTE.moon}, not the number.
 */
const MOON_INTENSITY = 0.62;

/**
 * The moon's own light is cool, so the cool opposite fill has less to do at
 * night than it does under a warm sun — but a little more of it is what keeps
 * the side of a toy facing away from the moon from going flat. Multiplies
 * {@link FILL_LIGHT_RATIO} for the moon's share only.
 */
const MOON_FILL_BOOST = 1.7;

export class DayNight implements GameSystem {
  readonly name = 'dayNight';

  /**
   * The sun. Casts the park's shadows, and **only ever shines by day** — it
   * used to be flipped round to the far side of the sky and dimmed to serve
   * as the moon as well, which meant a light of intensity ≈ 1.1 teleporting
   * 180° across the park the instant the sun touched the horizon, swinging
   * every shadow with it. It now simply fades out at the horizon and
   * {@link moonLight} fades in.
   */
  readonly keyLight: DirectionalLight;
  /**
   * The moon: pale, cool and dim, rising and setting on the moon's own arc —
   * which is the sun's arc reflected through the origin, exactly the arc the
   * moon is *drawn* on in {@link Sky} (`uMoonPosition`). One directional light
   * lights the whole park evenly, so night reads everywhere at once instead of
   * only in the pools under the lamp posts.
   *
   * It casts **no shadow**. A second shadow map would double the shadow pass
   * for the whole game to buy faint shadows nobody looks for at midnight; and
   * with no moon shadow there is no way for one to leak into the building's
   * interior, which is a bug this park has had before (see {@link setIndoors}).
   */
  readonly moonLight: DirectionalLight;
  /** The cool opposite fill. Casts nothing; colours the shadow side. */
  readonly fillLight: DirectionalLight;
  readonly ambientLight: HemisphereLight;

  /**
   * Normalised clock. 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
   *
   * Seeded from the store rather than from `DAY_START_TIME` directly, which is
   * what makes the park clock survive a save: `update()` already pushes the
   * time *into* the store every frame, so reading the initial value back out
   * of it closes the loop with no plumbing through `World` or `Game`. A fresh
   * game is unchanged — `createInitialState()` seeds the store with
   * `DAY_START_TIME`, so the two agree by construction.
   */
  private time = gameStore.get().world.timeOfDay;
  private days = gameStore.get().world.dayCount;
  private nightFactorValue = 0;
  private lightsOnValue = false;
  private paused = false;
  /**
   * True while the player is indoors under a ceiling (`Building.
   * playerInRoofedInterior`, item 18). The sun stops moving and stops
   * shining the moment this flips on — see `update`.
   */
  private indoors = false;

  /** World-space direction *towards* the sun. Always the true sun, day or night. */
  private readonly sunDirection = new Vector3(0, 1, 0);
  /** World-space direction *towards* the moon — the sun's, reflected. */
  private readonly moonDirection = new Vector3(0, -1, 0);
  private readonly fogColour = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly sky: Sky,
  ) {
    this.keyLight = new DirectionalLight(PALETTE.sunDay, 2.2);
    this.keyLight.castShadow = true;
    // One notch down on a modest phone: the shadow pass is fill-rate bound, and
    // VSM's blur hides most of what the resolution loses.
    const shadowSize = shadowMapSize();
    this.keyLight.shadow.mapSize.set(shadowSize, shadowSize);
    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.left = -SHADOW_AREA;
    shadowCamera.right = SHADOW_AREA;
    shadowCamera.top = SHADOW_AREA;
    shadowCamera.bottom = -SHADOW_AREA;
    shadowCamera.near = 1;
    shadowCamera.far = 190;
    shadowCamera.updateProjectionMatrix();
    // Tuned against the chunky, mostly-convex park geometry: enough blur for
    // soft edges without letting light bleed through the wooden walls (VSM's
    // one weakness).
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 3;
    this.keyLight.shadow.blurSamples = 10;
    scene.add(this.keyLight, this.keyLight.target);

    // The moon. Positioned exactly the way the sun's key light is — a point
    // far out along the direction the light comes *from*, aimed at a target —
    // except that with no shadow camera to keep centred on the action there is
    // nothing to gain from following the player, so its target simply sits at
    // the origin and only the direction ever changes.
    this.moonLight = new DirectionalLight(PALETTE.moon, 0);
    this.moonLight.castShadow = false;
    scene.add(this.moonLight, this.moonLight.target);

    // The cool opposite fill (ART_DIRECTION.md §6). It shines from the far side
    // of the sun and slightly above, never casts a shadow, and exists purely so
    // the toon ramp's shadow band keeps a colour temperature instead of sinking
    // into the hemisphere's green ground bounce.
    this.fillLight = new DirectionalLight(PALETTE.skyDayBottom, 0.5);
    this.fillLight.castShadow = false;
    scene.add(this.fillLight);

    this.ambientLight = new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.1);
    scene.add(this.ambientLight);

    this.applyLook(this.time, new Vector3(0, 0, -1));
  }

  /** 0 in broad daylight, 1 in the middle of the night. */
  get nightFactor(): number {
    return this.nightFactorValue;
  }

  /** True once the fairy lights have switched on for the evening. */
  get lightsOn(): boolean {
    return this.lightsOnValue;
  }

  get timeOfDay(): number {
    return this.time;
  }

  /**
   * World-space direction *towards* the sun — the real sun, even at night when
   * it is below the horizon and lighting nothing. (It used to be flipped to
   * point at the moon after dark; {@link moonDirectionVector} is that now.)
   */
  get sunDirectionVector(): Readonly<Vector3> {
    return this.sunDirection;
  }

  /** World-space direction *towards* the moon. The sun's, reflected. */
  get moonDirectionVector(): Readonly<Vector3> {
    return this.moonDirection;
  }

  /** Jump the clock, e.g. from a debug key or a cutscene. */
  setTimeOfDay(time: number): void {
    this.time = ((time % 1) + 1) % 1;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * Told once a frame by `World`, from `Building.playerInRoofedInterior`.
   *
   * The building's interior is a separate continuum from the park (item 30c)
   * and keeps its own constant lighting (item 18): the sun, its fill light and
   * the sky's ambient all switch off rather than tracking the player in there,
   * so nothing here casts a shadow indoors and nothing about the look changes
   * with the time of day. `InteriorLighting` takes over instead. Stepping out
   * onto the roof — genuinely outdoors — clears this straight back to normal.
   */
  setIndoors(indoors: boolean): void {
    this.indoors = indoors;
  }

  /** Human-readable clock for the HUD, e.g. "14:35". */
  formatClock(): string {
    const totalMinutes = Math.floor(this.time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  update(context: FrameContext): void {
    if (!this.paused) {
      this.time += context.dt / DAY_LENGTH_SECONDS;
      while (this.time >= 1) {
        this.time -= 1;
        this.days += 1;
      }
    }

    // The clock itself always keeps running — the park outside must be
    // exactly the right time of day the instant the player steps back out —
    // but while indoors none of that is allowed to touch the actual lights:
    // no sun position, no shadow camera chasing the player, no colour drift.
    // Simply not visible is enough: an invisible light contributes nothing to
    // either the lit scene or the shadow pass, and needs no further per-frame
    // work (see `InteriorLighting`, which is what lights the room instead).
    this.keyLight.visible = !this.indoors;
    this.moonLight.visible = !this.indoors;
    this.fillLight.visible = !this.indoors;
    this.ambientLight.visible = !this.indoors;

    if (!this.indoors) {
      this.applyLook(this.time, context.cameraForward);
      this.followPlayer(context.playerPosition);
    } else {
      // Fog is the one thing in this method that is *not* a light, so it does
      // not switch off with them — and `scene.fog` is shared, so whatever the
      // park was last set to follows the player indoors. That never showed
      // before, because night fog only reached full 96 m out and no room is
      // that big. Now that midnight fog closes at 50 m it would hang a dark
      // haze across the far end of the castle's floors, so the interior is
      // given the open daytime distances explicitly. Its own constant lighting
      // is `InteriorLighting`'s job; this is the same idea for depth.
      const fog = this.scene.fog;
      if (fog instanceof Fog) {
        fog.near = FOG_NEAR;
        fog.far = FOG_FAR;
      }
    }
    this.sky.setTime(context.elapsed);

    gameStore.setTimeOfDay(this.time, this.days, this.lightsOnValue);
  }

  // ------------------------------------------------------------- internals

  /** Keeps the shadow frustum centred on the action rather than the origin. */
  private followPlayer(playerPosition: Vector3): void {
    this.keyLight.target.position.copy(playerPosition);
    this.keyLight.target.updateMatrixWorld();
    this.keyLight.position
      .copy(playerPosition)
      .addScaledVector(this.sunDirection, 95);
    this.keyLight.updateMatrixWorld();
  }

  private applyLook(time: number, cameraForward: Readonly<Vector3>): void {
    // --- sun position ----------------------------------------------------
    // Sunrise at t=0.25 in the east (+X), noon overhead, sunset in the west.
    // The arc leans north so midday shadows fall towards the camera and the
    // park never looks flat.
    const theta = (time - 0.25) * TAU;
    this.sunDirection
      .set(Math.cos(theta), Math.sin(theta), -0.42 * Math.sin(theta) - 0.28)
      .normalize();

    const altitude = Math.asin(clamp(this.sunDirection.y, -1, 1));
    const daylight = smoothstep(-0.12, 0.12, this.sunDirection.y);
    this.nightFactorValue = 1 - daylight;

    // Hysteresis on the fairy lights so they don't flicker around the
    // threshold at dusk.
    if (!this.lightsOnValue && (time > FAIRY_LIGHT_ON || time < FAIRY_LIGHT_OFF)) {
      this.lightsOnValue = true;
    } else if (this.lightsOnValue && time > FAIRY_LIGHT_OFF && time < FAIRY_LIGHT_ON) {
      this.lightsOnValue = false;
    }

    // --- interpolate the look table --------------------------------------
    const look = sampleSkyKeys(time);

    const uniforms = this.sky.uniforms;
    (uniforms.uTopColour as { value: Color }).value.setHex(look.top);
    (uniforms.uBottomColour as { value: Color }).value.setHex(look.bottom);
    (uniforms.uHorizonColour as { value: Color }).value.setHex(look.horizon);
    (uniforms.uHorizonStrength as { value: number }).value = look.horizonStrength;
    (uniforms.uStarStrength as { value: number }).value = smoothstep(0.35, 0.85, this.nightFactorValue);

    // --- project sun and moon into screen space ---------------------------
    // The camera is orthographic, so there is no true projection for something
    // at infinity. Instead the sun's compass bearing relative to the camera is
    // mapped straight onto the screen's x axis, and its altitude onto y. It is
    // a cheat, but it tracks convincingly as the view rotates.
    const cameraAzimuth = Math.atan2(cameraForward.x, cameraForward.z);
    const sunAzimuth = Math.atan2(this.sunDirection.x, this.sunDirection.z);
    const relative = angleDelta(cameraAzimuth, sunAzimuth);

    const sunPosition = (uniforms.uSunPosition as { value: Vector2 }).value;
    sunPosition.set(relative / (Math.PI / 3), -0.4 + (altitude / (Math.PI / 2)) * 1.55);
    (uniforms.uSunColour as { value: Color }).value.setHex(
      this.sunDirection.y > 0 ? look.sun : PALETTE.sunSet,
    );
    (uniforms.uSunVisible as { value: number }).value =
      smoothstep(1.45, 0.85, Math.abs(relative)) * smoothstep(-0.14, 0.05, this.sunDirection.y);

    const moonRelative = angleDelta(cameraAzimuth, sunAzimuth + Math.PI);
    const moonPosition = (uniforms.uMoonPosition as { value: Vector2 }).value;
    moonPosition.set(moonRelative / (Math.PI / 3), -0.4 + (-altitude / (Math.PI / 2)) * 1.55);
    (uniforms.uMoonVisible as { value: number }).value =
      smoothstep(1.45, 0.85, Math.abs(moonRelative)) * smoothstep(0.02, 0.2, -this.sunDirection.y);

    // --- lights ----------------------------------------------------------
    // The sun and the moon cross-fade through the horizon, in **mirrored**
    // windows — `moonUp` is `1 - sunUp` by construction. That matters: the
    // first version of this used two narrow offset windows, and measuring the
    // whole day's light curve showed that for the few seconds either side of
    // sunrise and sunset *neither* light was contributing, so the park went
    // briefly flat and ambient-only. Mirrored windows mean the two always sum
    // to one light's worth. For those few seconds both are lit at part
    // strength, from opposite sides — which is exactly what dusk looks like
    // with the moon already up.
    const sunUp = smoothstep(-0.12, 0.12, this.sunDirection.y);
    const moonUp = 1 - sunUp;
    const sunStrength = look.sunIntensity * sunUp;
    const moonStrength = MOON_INTENSITY * moonUp;

    this.keyLight.color.setHex(look.sun);
    this.keyLight.intensity = sunStrength;

    // The shadow pass is the single most expensive thing this light does, and
    // at night it renders a map for a light of intensity zero. Freezing the
    // map (rather than clearing `castShadow`, which changes three.js's light
    // counts and recompiles every material in the park) skips the pass
    // outright. Never frozen before the first map exists, or the shader would
    // sample a texture that was never created.
    this.keyLight.shadow.autoUpdate = sunStrength > 0.02 || this.keyLight.shadow.map === null;

    this.moonDirection.copy(this.sunDirection).negate();
    this.moonLight.position.copy(this.moonDirection).multiplyScalar(120);
    this.moonLight.intensity = moonStrength;

    // The fill sits opposite whichever of the two is actually lighting the
    // park, but still above it: straight opposite would light the ground from
    // underneath and every toy would glow along its bottom edge.
    const keyDirection = sunStrength >= moonStrength ? this.sunDirection : this.moonDirection;
    this.fillLight.position
      .set(-keyDirection.x, 0.55, -keyDirection.z)
      .normalize()
      .multiplyScalar(60);
    this.fillLight.color.setHex(look.ambientSky);
    this.fillLight.intensity =
      (sunStrength + moonStrength * MOON_FILL_BOOST) * FILL_LIGHT_RATIO;

    this.ambientLight.color.setHex(look.ambientSky);
    this.ambientLight.groundColor.setHex(look.ambientGround);
    this.ambientLight.intensity = look.ambientIntensity;

    this.fogColour.setHex(look.fog);
    const fog = this.scene.fog;
    if (fog instanceof Fog) {
      fog.color.copy(this.fogColour);
      // Night pulls the fog right in, so distance falls away into the dark
      // while the ground under the lamps stays bright and legible — see
      // NIGHT_FOG_NEAR. The old 0.7/0.72 scaling put full fog 96 m out, which
      // is further than the far side of the park, so it never did anything.
      fog.near = lerp(FOG_NEAR, NIGHT_FOG_NEAR, this.nightFactorValue);
      fog.far = lerp(FOG_FAR, NIGHT_FOG_FAR, this.nightFactorValue);
    }
  }
}

/** Interpolates the keyframe table at `time`, wrapping around midnight. */
function sampleSkyKeys(time: number): SkyKey {
  const count = SKY_KEYS.length;
  let index = count - 1;
  for (let i = 0; i < count; i += 1) {
    const key = SKY_KEYS[i] as SkyKey;
    if (key.t <= time) index = i;
    else break;
  }
  const from = SKY_KEYS[index] as SkyKey;
  const to = SKY_KEYS[(index + 1) % count] as SkyKey;
  // The final segment wraps past 1.0 back to the first key.
  const span = to.t > from.t ? to.t - from.t : to.t + 1 - from.t;
  const along = time >= from.t ? time - from.t : time + 1 - from.t;
  const t = clamp01(span > 0 ? along / span : 0);

  return {
    t: time,
    top: mixHex(from.top, to.top, t),
    bottom: mixHex(from.bottom, to.bottom, t),
    horizon: mixHex(from.horizon, to.horizon, t),
    horizonStrength: lerp(from.horizonStrength, to.horizonStrength, t),
    sun: mixHex(from.sun, to.sun, t),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, t),
    ambientSky: mixHex(from.ambientSky, to.ambientSky, t),
    ambientGround: mixHex(from.ambientGround, to.ambientGround, t),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, t),
    fog: mixHex(from.fog, to.fog, t),
  };
}

const MIX_A = new Color();
const MIX_B = new Color();

function mixHex(a: number, b: number, t: number): number {
  MIX_A.setHex(a);
  MIX_B.setHex(b);
  return MIX_A.lerp(MIX_B, t).getHex();
}
