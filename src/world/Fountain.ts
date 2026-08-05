import {
  BufferAttribute,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { pinkStoneTexture } from '../core/textures';
import { ART } from '../art/style/artPalette';
import { toonMaterial, inkTint } from '../art/style/materials';
import { createRipikaStatue, type RipikaStatueHandle } from '../art/models/ripikaStatue';
import {
  createWaterSplashEffects,
  playPlip,
  playPloosh,
  type WaterSplashEffects,
} from '../art/effects/waterSplash';
import { terrainHeight } from './terrain';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';
import type { Player } from '../entities/Player';

/**
 * The wishing fountain in the middle of the plaza.
 *
 * Water is not a shader: the surface is a ring mesh whose vertices are nudged
 * every frame by a couple of sine waves. That keeps it compatible with the
 * scene's fog and shadows for free, and it costs about a thousand vertex writes
 * a frame — nothing.
 *
 * Coin-tossing arrives in a later step. When you build it, the rim radius and
 * water height are exposed as {@link rimRadius} and {@link waterLevel}.
 *
 * **The rim is jumpable** (design feedback #12 — "the fountain is jumpable").
 * The collider is not a single `addCircle`: a circle collider has no notion
 * of "hollow in the middle", so one big circle would make the whole interior
 * solid rather than just its edge. Instead the rim is a ring of short
 * `addWall` segments approximating a circle — each one only blocks the
 * ground right at the wall, so a grounded walker bounces off from any angle
 * exactly as a single circle would, but a jump that clears one segment's
 * `topHeight` finds nothing left to push it back out once it lands inside.
 * See `attachPlayer` and `groundLevel` for what happens once you're in.
 */
/**
 * The fountain's share of "make the lit area three times bigger in radius".
 *
 * Same solve as `LampPosts` and `FairyLights`, and the same trap: `distance`
 * is only a hard outer edge in three.js's falloff, and at the old decay of 2.0
 * the light had faded to nothing long before reaching it, so moving it out
 * alone would have changed nothing anyone could see. Decay 2.0 → 1.25,
 * intensity solved (6 → 5.23) to hold the brightness in the water itself
 * exactly where it was. Ground pool 6.0 m → 17.4 m, ratio 2.9–3.1× across
 * every visibility threshold tested.
 *
 * Kept at a higher decay than the other two on purpose. This light sits *in*
 * the water, 1.2 m up rather than 3.2 m, and it is the fountain's own glow
 * rather than a lamp meant to light a path — it should still fall away faster
 * than the lamps do, so the fountain reads as the bright thing in the middle
 * of the plaza instead of a floodlight.
 */
const GLOW_INTENSITY = 5.23;
const GLOW_DECAY = 1.25;
const GLOW_DISTANCE = 27;

export class Fountain implements GameSystem {
  readonly name = 'fountain';
  readonly group = new Group();

  /** Centre of the fountain in world space. */
  readonly centre: Vector3;
  readonly rimRadius = 4.2;
  readonly waterLevel: number;

  /** 0 in daylight, 1 at night. Set by the DayNight system each frame. */
  nightFactor = 0;

  /** How high a jump must clear to sail over the rim — see the class doc. */
  private static readonly RIM_TOP_HEIGHT = 1.1;

  /** Anything closer to the centre than this counts as "in the water". */
  private readonly waterRadius = this.rimRadius - 0.3;

  /** Feet sink this far below the water's visual surface while wading. */
  private static readonly WADE_SINK = 0.12;

  /** Wading multiplies the player's speed limit by this. */
  private static readonly WADE_SPEED_FACTOR = 0.6;

  /** How often a fresh foot splash may spawn while wading and moving. */
  private static readonly FOOT_SPLASH_INTERVAL = 0.28;
  /** The plip that goes with it plays less often than the splash itself —
   *  a plip on every single footfall reads as a leaky tap, not a puddle. */
  private static readonly FOOT_SOUND_INTERVAL = 0.6;

  private readonly waterGeometry: RingGeometry;
  private readonly waterBase: Float32Array;
  private readonly waterMaterial: MeshStandardMaterial;
  private readonly jets: Mesh[] = [];
  private readonly glow: PointLight;
  /** The grey-stone RiPika standing on the upper bowl — issue #121. */
  private readonly statue: RipikaStatueHandle;
  private readonly splashEffects: WaterSplashEffects = createWaterSplashEffects();

  /** Set once by `attachPlayer`. Read from `update()` — see the class doc. */
  private player: Player | null = null;
  private wasAirborne = false;
  private wasInWaterGrounded = false;
  private footSplashTimer = 0;
  private footSoundTimer = 0;

  constructor(collision: CollisionWorld, x = 0, z = 0) {
    this.group.name = 'fountain';
    const groundY = terrainHeight(x, z);
    this.centre = new Vector3(x, groundY, z);
    this.group.position.copy(this.centre);
    this.waterLevel = groundY + 0.82;

    // Stonework is a toy object, so it bands with everything else in the park.
    // The water below is deliberately NOT toon-shaded — see `waterMaterial`.
    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(6, 1) });
    const trimMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- basin -----------------------------------------------------------
    const basinWall = new Mesh(
      new CylinderGeometry(this.rimRadius, this.rimRadius + 0.22, 1.05, 40, 1, true),
      stoneMaterial,
    );
    basinWall.position.y = 0.52;
    basinWall.castShadow = true;
    basinWall.receiveShadow = true;
    this.group.add(basinWall);

    const rim = new Mesh(new TorusGeometry(this.rimRadius + 0.06, 0.22, 10, 44), trimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.05;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(rim);

    const floor = new Mesh(
      new CylinderGeometry(this.rimRadius, this.rimRadius, 0.16, 40),
      toonMaterial(PALETTE.stonePinkDark),
    );
    floor.position.y = 0.08;
    floor.receiveShadow = true;
    this.group.add(floor);

    // --- water -----------------------------------------------------------
    this.waterGeometry = new RingGeometry(0.42, this.rimRadius - 0.08, 44, 7);
    this.waterGeometry.rotateX(-Math.PI / 2);
    const positions = this.waterGeometry.getAttribute('position') as BufferAttribute;
    this.waterBase = Float32Array.from(positions.array);

    // Water stays MeshStandardMaterial on purpose: banding a transparent
    // rippling surface looks broken, and the faint specular is what sells it.
    this.waterMaterial = new MeshStandardMaterial({
      color: PALETTE.waterTop,
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.86,
      emissive: PALETTE.waterDeep,
      emissiveIntensity: 0.12,
    });
    const water = new Mesh(this.waterGeometry, this.waterMaterial);
    water.name = 'fountain-water';
    water.position.y = 0.82;
    water.receiveShadow = true;
    this.group.add(water);

    // --- pedestal and upper bowl -----------------------------------------
    const column = new Mesh(new CylinderGeometry(0.42, 0.62, 1.7, 16), stoneMaterial);
    column.position.y = 0.95;
    column.castShadow = true;
    column.receiveShadow = true;
    this.group.add(column);

    const bowl = new Mesh(new CylinderGeometry(1.35, 0.55, 0.42, 24), trimMaterial);
    bowl.position.y = 1.95;
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    this.group.add(bowl);

    const bowlWater = new Mesh(
      new CylinderGeometry(1.2, 1.2, 0.06, 24),
      this.waterMaterial,
    );
    bowlWater.position.y = 2.14;
    this.group.add(bowlWater);

    // --- the statue -------------------------------------------------------
    // Family request (#121): a large grey-stone RiPika in the fountain's
    // middle. It stands where the old stone finial and its little water spout
    // used to be — both are gone, and the fountain reads better for it: a
    // figure standing in a bowl that brims over into the six jets below is a
    // fountain, where a ball with water bobbling out of the top was an
    // ornament.
    //
    // Seated on the **surface of the bowl water** (`bowlWater` spans y 2.11 to
    // 2.17), and the statue's origin is the base of its plinth, so this single
    // number is the whole placement — no fudge factor, per the asset contract.
    //
    // Clearances, both measured rather than assumed:
    //  - the six jets occupy y 0.80–2.10 at radius 1.22. The plinth starts
    //    0.07 m above their tops and is 0.82 m at its widest, so nothing the
    //    statue owns comes near them.
    //  - the bowl water it stands on is a 1.2 m-radius disc, against the
    //    plinth's 0.82 m footing — it sits comfortably inside its own puddle.
    //
    // No collider. The plinth base is 2.17 m up, well over the 1.4 m jump
    // ceiling `Player.ts` documents, so a child cannot reach it to be blocked
    // by it — and the central column below has never had one either.
    this.statue = createRipikaStatue();
    this.statue.root.position.y = 2.17;
    this.group.add(this.statue.root);

    // --- falling water ----------------------------------------------------
    // Four thin tapered streams arcing from the upper bowl into the basin.
    const jetMaterial = new MeshStandardMaterial({
      color: PALETTE.waterFoam,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.1,
      emissive: PALETTE.waterTop,
      emissiveIntensity: 0.25,
    });
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const jet = new Mesh(new CylinderGeometry(0.05, 0.12, 1.3, 7, 1, true), jetMaterial);
      jet.position.set(Math.cos(angle) * 1.22, 1.45, Math.sin(angle) * 1.22);
      jet.rotation.z = Math.cos(angle) * 0.16;
      jet.rotation.x = -Math.sin(angle) * 0.16;
      this.group.add(jet);
      this.jets.push(jet);
    }

    // A hint of light in the water so the fountain still reads after dark.
    this.glow = new PointLight(PALETTE.waterTop, 0, GLOW_DISTANCE, GLOW_DECAY);
    this.glow.position.y = 1.2;
    this.group.add(this.glow);

    // --- wishing coins -----------------------------------------------------
    // Purely decorative — the wishing/coin-toss mechanic lives elsewhere and
    // is untouched here. Sitting just above the floor, under the water, so
    // they glint through it rather than resting on top.
    const coinMaterial = toonMaterial(ART.helmetGold);
    const coinRimMaterial = toonMaterial(inkTint(ART.helmetGold, 0.3));
    const coinLayout: readonly [x: number, z: number, rotationY: number, tilt: number][] = [
      [1.15, 0.4, 0.4, 0.03],
      [-1.7, -0.75, 1.9, -0.05],
      [0.3, -1.95, 2.6, 0.02],
      [-0.55, 1.75, 0.9, 0.06],
      [2.1, 0.55, 3.4, -0.02],
      [-1.15, -0.15, 4.7, 0.04],
      [0.6, 1.1, 5.6, -0.03],
    ];
    for (const [cx, cz, rotationY, tilt] of coinLayout) {
      const coin = new Mesh(new CylinderGeometry(0.13, 0.13, 0.025, 14), [
        coinRimMaterial,
        coinMaterial,
        coinMaterial,
      ]);
      coin.position.set(cx, 0.095, cz);
      coin.rotation.y = rotationY;
      coin.rotation.z = tilt;
      coin.receiveShadow = true;
      this.group.add(coin);
    }

    // --- rim collider: a ring of short walls, not one filled circle --------
    // See the class doc for why. `Fountain.RIM_TOP_HEIGHT` is comfortably
    // under the 1.4 m jump ceiling `Player.ts` documents, and the segment
    // count is high enough that the polygon reads as a circle: at 28
    // segments the midpoint of an edge sags under the true radius by about
    // 2.5 cm, well inside the walls' own thickness.
    const RIM_SEGMENTS = 28;
    for (let i = 0; i < RIM_SEGMENTS; i += 1) {
      const a1 = (i / RIM_SEGMENTS) * Math.PI * 2;
      const a2 = ((i + 1) / RIM_SEGMENTS) * Math.PI * 2;
      collision.addWall(
        x + Math.cos(a1) * this.rimRadius,
        z + Math.sin(a1) * this.rimRadius,
        x + Math.cos(a2) * this.rimRadius,
        z + Math.sin(a2) * this.rimRadius,
        0.32,
        Fountain.RIM_TOP_HEIGHT,
      );
    }

    this.group.add(this.splashEffects.root);
  }

  /**
   * Gives the fountain the player, so `update()` can read their position,
   * velocity and airborne state to drive wading and splashes. Called once
   * from `World.attachPlayer`, same as `Building.attachPlayer`.
   */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * The ground-sampler hook: inside the water disc, the ground is a fixed
   * shallow-water height regardless of the terrain underneath; everywhere
   * else, `fallback` (whatever the building or bare terrain already said)
   * passes straight through untouched. `World.attachPlayer` composes this on
   * top of the player's existing ground sampler, so this is the only place
   * that needs to know the fountain dips the ground at all.
   */
  groundLevel(x: number, z: number, fallback: number): number {
    const dx = x - this.centre.x;
    const dz = z - this.centre.z;
    if (dx * dx + dz * dz < this.waterRadius * this.waterRadius) {
      return this.waterLevel - Fountain.WADE_SINK;
    }
    return fallback;
  }

  update({ dt, elapsed }: FrameContext): void {
    this.splashEffects.update(dt);
    this.updateWading(dt);

    // Ripples: two crossing waves plus a radial ring travelling outwards.
    const positions = this.waterGeometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;
    for (let i = 0; i < positions.count; i += 1) {
      const index = i * 3;
      const x = this.waterBase[index] ?? 0;
      const z = this.waterBase[index + 2] ?? 0;
      const radius = Math.hypot(x, z);
      const ripple =
        Math.sin(radius * 3.1 - elapsed * 3.4) * 0.028 +
        Math.sin(x * 1.9 + elapsed * 2.1) * 0.016 +
        Math.sin(z * 2.3 - elapsed * 1.7) * 0.016;
      array[index + 1] = ripple;
    }
    positions.needsUpdate = true;

    // Jets wobble and shimmer rather than being rigid tubes.
    for (let i = 0; i < this.jets.length; i += 1) {
      const jet = this.jets[i];
      if (!jet) continue;
      const phase = elapsed * 5 + i * 1.1;
      jet.scale.y = 1 + Math.sin(phase) * 0.07;
      const material = jet.material as MeshStandardMaterial;
      material.opacity = 0.48 + Math.sin(phase * 1.3) * 0.08;
    }

    this.waterMaterial.emissiveIntensity = 0.12 + this.nightFactor * 0.55;
    // `dt` is unused for the ripple maths (it is driven by `elapsed`), but the
    // light eases so a sudden nightfall doesn't pop.
    this.glow.intensity +=
      (this.nightFactor * GLOW_INTENSITY - this.glow.intensity) * Math.min(1, dt * 3);
  }

  /**
   * Wading, speed, expression and splashes — all read from the player rather
   * than pushed onto it (see the class doc and `Player.speedMultiplier` /
   * `Player.waterHappy`, the only two fields that exist on the other end of
   * this). Runs after `Player.update()` this same frame (see `Game.ts`'s
   * frame order), so `player.position` and `player.isAirborne` are this
   * frame's settled values; what this writes back only takes effect next
   * frame, the same one-frame lag `hopClearance` already tolerates.
   */
  private updateWading(dt: number): void {
    const player = this.player;
    if (!player) return;

    const dx = player.position.x - this.centre.x;
    const dz = player.position.z - this.centre.z;
    const inWater = dx * dx + dz * dz < this.waterRadius * this.waterRadius;
    const airborne = player.isAirborne;
    const grounded = !airborne;

    player.speedMultiplier = inWater ? Fountain.WADE_SPEED_FACTOR : 1;
    player.waterHappy = inWater;

    // Splash positions are given in the fountain group's own local space
    // (it has no rotation, so world offset from the centre is local x/z
    // directly) — `splashEffects.root` is parented to `this.group`.
    const localY = this.waterLevel - this.centre.y;

    // Landed in the water from a jump: the proper splash.
    if (this.wasAirborne && !airborne && inWater) {
      this.splashEffects.splash(dx, localY, dz);
      playPloosh();
    }

    // Jumped while standing in the water: a smaller splash on takeoff.
    if (!this.wasAirborne && airborne && this.wasInWaterGrounded) {
      this.splashEffects.footSplash(dx, localY, dz);
      playPlip(0.8);
    }

    // Wading: small continuous splashes at the feet while moving.
    if (grounded && inWater) {
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (speed > 0.4) {
        this.footSplashTimer -= dt;
        this.footSoundTimer -= dt;
        if (this.footSplashTimer <= 0) {
          this.footSplashTimer = Fountain.FOOT_SPLASH_INTERVAL;
          this.splashEffects.footSplash(dx, localY, dz);
        }
        if (this.footSoundTimer <= 0) {
          this.footSoundTimer = Fountain.FOOT_SOUND_INTERVAL;
          playPlip(0.5);
        }
      } else {
        // Standing still in the water: ready to splash again the moment you
        // move, rather than waiting out the rest of a stale interval.
        this.footSplashTimer = Math.min(this.footSplashTimer, Fountain.FOOT_SPLASH_INTERVAL * 0.4);
      }
    }

    this.wasAirborne = airborne;
    this.wasInWaterGrounded = grounded && inWater;
  }

  dispose(): void {
    this.waterGeometry.dispose();
    this.waterMaterial.dispose();
    this.splashEffects.dispose();
    this.statue.dispose?.();
  }
}
