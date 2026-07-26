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
  DAY_START_TIME,
  FAIRY_LIGHT_OFF,
  FAIRY_LIGHT_ON,
  FILL_LIGHT_RATIO,
  FOG_FAR,
  FOG_NEAR,
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

const SKY_KEYS: readonly SkyKey[] = [
  {
    t: 0.0, // deep night
    top: PALETTE.skyNightTop,
    bottom: PALETTE.skyNightBottom,
    horizon: 0x4a5590,
    horizonStrength: 0.3,
    sun: PALETTE.moon,
    sunIntensity: 0.3,
    ambientSky: 0x4a5691,
    ambientGround: 0x252b48,
    ambientIntensity: 0.46,
    fog: 0x2b3560,
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

export class DayNight implements GameSystem {
  readonly name = 'dayNight';

  readonly keyLight: DirectionalLight;
  /** The cool opposite fill. Casts nothing; colours the shadow side. */
  readonly fillLight: DirectionalLight;
  readonly ambientLight: HemisphereLight;

  /** Normalised clock. 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  private time = DAY_START_TIME;
  private days = 0;
  private nightFactorValue = 0;
  private lightsOnValue = false;
  private paused = false;

  private readonly sunDirection = new Vector3(0, 1, 0);
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

  /** World-space direction *towards* the sun. */
  get sunDirectionVector(): Readonly<Vector3> {
    return this.sunDirection;
  }

  /** Jump the clock, e.g. from a debug key or a cutscene. */
  setTimeOfDay(time: number): void {
    this.time = ((time % 1) + 1) % 1;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
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

    this.applyLook(this.time, context.cameraForward);
    this.followPlayer(context.playerPosition);
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
    // Below the horizon the key light becomes moonlight: it flips to shine from
    // the opposite side, dims right down and turns cool blue.
    const isDay = this.sunDirection.y > 0;
    if (!isDay) this.sunDirection.negate();

    this.keyLight.color.setHex(look.sun);
    this.keyLight.intensity = look.sunIntensity;

    // The fill sits opposite the sun on the compass but still above the park:
    // straight opposite would light the ground from underneath and every toy
    // would glow along its bottom edge.
    this.fillLight.position
      .set(-this.sunDirection.x, 0.55, -this.sunDirection.z)
      .normalize()
      .multiplyScalar(60);
    this.fillLight.color.setHex(look.ambientSky);
    this.fillLight.intensity = look.sunIntensity * FILL_LIGHT_RATIO;

    this.ambientLight.color.setHex(look.ambientSky);
    this.ambientLight.groundColor.setHex(look.ambientGround);
    this.ambientLight.intensity = look.ambientIntensity;

    this.fogColour.setHex(look.fog);
    const fog = this.scene.fog;
    if (fog instanceof Fog) {
      fog.color.copy(this.fogColour);
      // Night pulls the fog in a little; it makes the lit park feel snug.
      fog.near = lerp(FOG_NEAR, FOG_NEAR * 0.7, this.nightFactorValue);
      fog.far = lerp(FOG_FAR, FOG_FAR * 0.72, this.nightFactorValue);
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
