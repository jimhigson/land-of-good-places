import {
  BackSide,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { glowTexture } from '../core/textures';
import { toonMaterial, outlineGeometry, inkTint } from '../art/style/materials';
import { clamp01, smoothstep } from '../core/mathUtils';
import { terrainHeight } from './terrain';
import { isOnPath } from './paths';
import { ANCHORS } from './anchors';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';

/**
 * Cute curly cast-iron-style lamp posts, standing just off the paths.
 *
 * Design feedback from the family: the park at night is too dark. Fairy
 * lights (see {@link FairyLights}) only ring the fountain plaza — everywhere
 * else along the paths stays gloomy after dusk. Lamp posts fill that gap.
 *
 * Placement mirrors {@link "./paths"}'s technique rather than reaching into
 * it: `paths.ts`'s route control points and sampled centreline are
 * module-private, so this file re-authors the same short main-loop and
 * fountain-approach point lists (they are the single source of truth in
 * `paths.ts`; if that file's `ROUTES` ever move, these need a matching nudge)
 * and walks its own `CatmullRomCurve3` to find perpendicular offsets, exactly
 * the way `addRibbon` does. Every candidate is then checked against the
 * already-exported {@link isOnPath} (stay off the paving) and {@link ANCHORS}
 * (stay out of the reserved ride plots) before it is kept.
 *
 * Performance: 18 lamps would mean 18 real lights, which is exactly what
 * {@link FairyLights} avoids and so does this. Every lamp gets a cheap fake —
 * an emissive-looking bulb (instanced, unlit, brightness baked into
 * per-instance colour like the fairy bulbs) plus a baked ground-glow decal
 * disc — and only a handful of real {@link PointLight}s exist at all,
 * reassigned every frame to whichever lamps are nearest the player.
 */
/**
 * ## Why these four numbers are what they are
 *
 * The family asked for the lit area around every night light to be **about
 * three times greater in radius**. Tripling `distance` alone does not do that,
 * and this is the trap worth writing down: three.js's falloff is
 *
 * ```
 * E = intensity / d^decay  ×  (1 - (d/distance)^4)^2
 * ```
 *
 * so `distance` is only a *hard outer edge*. At the old decay of 1.8 the
 * `1/d^decay` term had already taken the light down to nothing well inside the
 * old edge, and moving the edge out just extends a curve that has already
 * died. Nothing visible would have changed, which is exactly what the family
 * would have reported.
 *
 * What actually trebles the pool is **lowering the decay**, and the reason is
 * worth understanding. Raising `intensity` at a fixed decay also works on
 * paper — the radius at which the light fades out goes as
 * `(intensity/threshold)^(1/decay)`, so trebling the radius at decay 1.8 needs
 * `3^1.8 ≈ 7.2×` the intensity — but that same 7.2× lands on the ground
 * directly under the lamp too, and blows it out to white. Flattening the
 * falloff instead spreads the light the lamp already has over a bigger area,
 * which is what a wider pool physically *is*.
 *
 * So: decay 1.8 → 1.0, and intensity solved (9 → 3.48) to hold the brightness
 * directly under the lamp exactly where it was. Verified numerically against
 * the formula above — the ground radius goes 6.9 m → 20.5 m, and the ratio
 * holds between 2.9× and 3.1× at every visibility threshold tested rather than
 * hitting 3× at one cherry-picked cut-off.
 *
 * Decay 1.0 is inverse-linear rather than the inverse-square of a bare bulb.
 * That is deliberate and it is not physical: it is the falloff of a long strip
 * light, and it gives the broad soft-edged wash a cosy park wants instead of a
 * spotlight with a hard rim.
 */
const LIGHT_INTENSITY = 3.48;
const LIGHT_DECAY = 1.0;
const LIGHT_DISTANCE = 30;

/** How far above the lamp's base the real light sits. */
const LIGHT_HEIGHT = 3.2;

/**
 * Size of the painted ground-glow plane, tripled with everything else
 * (was 4.2). This is the pool the family actually sees on **every** lamp —
 * only {@link REAL_LIGHTS} of the thirteen get a real light — so if it did not
 * grow with the rest, twelve lamps out of thirteen would look untouched.
 *
 * Kept at three times the radius rather than stretched out to meet the real
 * light's new 20.5 m: it was 2.1 m against a 6.9 m light pool before, and it
 * is 6.3 m against a 20.5 m one now, so the two stay in exactly the
 * relationship they have always had — a bright painted core inside a wider,
 * softer wash. Making it reach the full 20.5 m would mean thirteen 41-metre
 * transparent quads on a lawn that is only about 110 m across, which is
 * several screens of overdraw every night frame on a phone.
 */
const GLOW_SIZE = 12.6;

/**
 * How far the glow plane floats above its lamp's base (was 0.03).
 *
 * The plane is flat and the park is not. Measured across all thirteen lamps:
 * within the old 2.1 m radius the ground never rose more than 0.04 m above the
 * lamp's own base, so 0.03 very nearly held. Within the new 6.3 m it rises as
 * much as **0.13 m, at ten lamps out of thirteen** — the disc would be buried
 * on its uphill side and clip against the grass along a hard straight line,
 * which is the opposite of a soft pool of light.
 *
 * Lifting it clear is the cheap fix. Draping the glow over the terrain instead
 * would look better still, but each lamp would then need its own vertex data
 * and the whole thing stops being one instanced draw call. At 0.25 m under a
 * 12.6 m disc — 2% of its width — the parallax against the grass is about
 * 0.3 m at the camera's fixed 38°, which is nothing on a soft gradient.
 */
const GLOW_LIFT = 0.25;

/**
 * How many lamps hold a real {@link PointLight} at once.
 *
 * Three was plenty when the pool was 6.9 m: the hand-over between one lamp and
 * the next happened at a median 14.8 m, by which distance the old light had
 * been cut off entirely and contributed exactly nothing, so the swap was
 * invisible. At 20.5 m that is no longer true — a light being handed over at
 * 14.8 m is still worth 0.44 where it stands, and a distant pool would visibly
 * blink from one lamp to the next as the player walks.
 *
 * Five moves the median hand-over out to 26.7 m. **Paid for by giving two back
 * from `FairyLights`**, which drops 5 → 3 in the same change: with its own
 * pool trebled to about 40 m, three sources cover the plaza several times
 * over. The park's total point-light count is unchanged.
 */
const REAL_LIGHTS = 5;

/**
 * Where a real light starts fading out, as a fraction of the hand-over
 * distance — see {@link LampPosts.update}.
 *
 * Five lights alone would leave a worst case: where the lamps bunch up, the
 * hand-over can happen as close as 17.4 m, and there the light is still worth
 * 0.15. This closes it exactly rather than approximately. A light is faded on
 * how far *its own lamp* is from the player, reaching zero at the boundary —
 * and because the two lamps swapping places are by definition the same
 * distance away at the moment they swap, the outgoing light is always at
 * exactly zero when it goes. The hand-over cannot pop, whatever the lamp
 * spacing, and it costs no extra lights.
 */
const HANDOVER_FADE = 0.75;

export class LampPosts implements GameSystem {
  readonly name = 'lampPosts';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully lit. Set by World from DayNight, same gating as FairyLights. */
  nightFactor = 0;

  private readonly lampPositions: Vector3[] = [];
  private readonly bulbs: InstancedMesh;
  private readonly bulbColours: Color[] = [];
  private readonly bulbBase: Color;
  private readonly groundGlow: InstancedMesh;
  private readonly groundGlowMaterial: MeshBasicMaterial;
  private readonly lights: PointLight[] = [];
  private readonly scratchColour = new Color();
  /**
   * Working set for {@link assignNearestLights}, sized once to the number of
   * real lights. These used to be two array literals built fresh every frame —
   * named on ARCHITECTURE-REVIEW's list of allocation suspects behind the
   * family's GC-pause complaint. Same search, no garbage.
   */
  private readonly nearestIndex: Int32Array;
  private readonly nearestDistance: Float64Array;
  /** How many of {@link lights} `assignNearestLights` actually placed this frame. */
  private assigned = 0;

  constructor(collision: CollisionWorld) {
    this.group.name = 'lamp-posts';

    const positions = placeLampPosts();
    for (const [x, z] of positions) {
      const ground = terrainHeight(x, z);
      this.lampPositions.push(new Vector3(x, ground, z));
      collision.addCircle(x, z, 0.22);
    }
    const count = this.lampPositions.length;

    // --- hardware: pole, curls, housing, cap, finial — all static, so one
    // InstancedMesh each is plenty (no per-frame matrix churn needed). -------
    const poleMaterial = toonMaterial(PALETTE.stonePinkDark);
    const curlMaterial = toonMaterial(PALETTE.stonePink);
    const housingMaterial = toonMaterial(PALETTE.stonePinkLight);
    const capMaterial = toonMaterial(PALETTE.stonePinkDark);
    const finialMaterial = toonMaterial(PALETTE.stonePink);

    const baseGeometry = new CylinderGeometry(0.16, 0.23, 0.28, 8);
    const shaftGeometry = new CylinderGeometry(0.09, 0.13, 2.35, 8);
    const curlGeometry = new TorusGeometry(0.15, 0.045, 6, 12);
    const housingGeometry = new CylinderGeometry(0.3, 0.34, 0.55, 6);
    const capGeometry = new ConeGeometry(0.38, 0.34, 6);
    const finialGeometry = new SphereGeometry(0.09, 10, 8);

    const baseY = 0.14;
    const shaftY = 0.28 + 2.35 / 2;
    const curlLowY = 0.28 + 2.35 * 0.38;
    const curlHighY = 0.28 + 2.35 * 0.78;
    const housingY = 0.28 + 2.35 + 0.55 / 2;
    const capY = 0.28 + 2.35 + 0.55 + 0.34 / 2;
    const finialY = 0.28 + 2.35 + 0.55 + 0.34 + 0.09;

    const baseMesh = instanceAt(baseGeometry, poleMaterial, this.lampPositions, baseY, count);
    const shaftMesh = instanceAt(shaftGeometry, poleMaterial, this.lampPositions, shaftY, count);
    const curlLowMesh = instanceCurl(curlGeometry, curlMaterial, this.lampPositions, curlLowY, count);
    const curlHighMesh = instanceCurl(curlGeometry, curlMaterial, this.lampPositions, curlHighY, count);
    const housingMesh = instanceAt(housingGeometry, housingMaterial, this.lampPositions, housingY, count);
    const capMesh = instanceAt(capGeometry, capMaterial, this.lampPositions, capY, count);
    const finialMesh = instanceAt(finialGeometry, finialMaterial, this.lampPositions, finialY, count);

    for (const mesh of [baseMesh, shaftMesh, curlLowMesh, curlHighMesh, housingMesh, capMesh, finialMesh]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Outlines on the silhouette parts only (shaft, housing) — ART_DIRECTION's
    // rule against outlining every little part, done by hand since `addOutline`
    // targets a single Mesh rather than an InstancedMesh.
    const shaftOutline = new InstancedMesh(
      outlineGeometry(shaftGeometry, 0.018),
      new MeshBasicMaterial({ color: inkTint(PALETTE.stonePinkDark), side: BackSide }),
      count,
    );
    shaftOutline.instanceMatrix = shaftMesh.instanceMatrix;
    shaftOutline.renderOrder = -1;
    this.group.add(shaftOutline);

    const housingOutline = new InstancedMesh(
      outlineGeometry(housingGeometry, 0.018),
      new MeshBasicMaterial({ color: inkTint(PALETTE.stonePinkLight), side: BackSide }),
      count,
    );
    housingOutline.instanceMatrix = housingMesh.instanceMatrix;
    housingOutline.renderOrder = -1;
    this.group.add(housingOutline);

    // --- the bulb: unlit, per-instance colour breathes with the fairy lights'
    // formula so the two lighting rigs read as one family after dusk. -------
    this.bulbBase = new Color(PALETTE.fairyWarm);
    const bulbGeometry = new SphereGeometry(0.135, 10, 8);
    this.bulbs = instanceAt(bulbGeometry, new MeshBasicMaterial({ color: 0xffffff }), this.lampPositions, housingY - 0.05, count);
    this.bulbs.name = 'lamp-bulbs';
    for (let i = 0; i < count; i += 1) {
      const colour = this.bulbBase.clone();
      this.bulbColours.push(colour);
      this.bulbs.setColorAt(i, colour);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    this.group.add(this.bulbs);

    // --- ground-glow pool: one shared material, fades with nightFactor at the
    // material level (no per-instance opacity in three.js), so it is fully
    // invisible all day rather than a faint disc sitting on the daylit grass. -
    this.groundGlowMaterial = new MeshBasicMaterial({
      map: glowTexture(PALETTE.fairyWarm),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const glowGeometry = new PlaneGeometry(GLOW_SIZE, GLOW_SIZE);
    glowGeometry.rotateX(-Math.PI / 2);
    this.groundGlow = instanceAt(glowGeometry, this.groundGlowMaterial, this.lampPositions, GLOW_LIFT, count);
    this.groundGlow.name = 'lamp-ground-glow';
    this.group.add(this.groundGlow);

    // --- the real lights: a small fixed pool, handed to whichever lamps are
    // nearest the player each frame (see `update`). -------------------------
    const realLightCount = Math.min(REAL_LIGHTS, count);
    for (let i = 0; i < realLightCount; i += 1) {
      const light = new PointLight(PALETTE.fairyWarm, 0, LIGHT_DISTANCE, LIGHT_DECAY);
      this.group.add(light);
      this.lights.push(light);
    }
    this.nearestIndex = new Int32Array(realLightCount);
    this.nearestDistance = new Float64Array(realLightCount);
  }

  update({ elapsed, playerPosition }: FrameContext): void {
    const lit = clamp01(this.nightFactor);

    if (this.bulbs.instanceColor) {
      for (let i = 0; i < this.bulbColours.length; i += 1) {
        const target = this.bulbColours[i];
        if (!target) continue;
        const flicker = 0.82 + 0.18 * Math.sin(elapsed * 1.9 + i * 1.3);
        this.scratchColour.copy(this.bulbBase).multiplyScalar(flicker * (0.42 + lit * 0.58));
        target.copy(this.scratchColour);
        this.bulbs.setColorAt(i, target);
      }
      this.bulbs.instanceColor.needsUpdate = true;
    }

    this.groundGlowMaterial.opacity = lit * 0.5;
    this.groundGlow.visible = lit > 0.02;

    this.assignNearestLights(playerPosition);
    // The hand-over boundary: the distance to the furthest lamp currently
    // holding a real light. A light exactly at the boundary is the one about
    // to be taken away, so it is faded to nothing — see `HANDOVER_FADE`.
    let boundarySq = 0;
    for (let i = 0; i < this.assigned; i += 1) {
      const distSq = this.nearestDistance[i] as number;
      if (distSq > boundarySq) boundarySq = distSq;
    }
    const boundary = Math.sqrt(boundarySq);
    const fadeFrom = boundary * HANDOVER_FADE;

    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      if (!light) continue;
      if (i >= this.assigned) {
        light.visible = false;
        continue;
      }
      // Keyed to the **lamp**, not to this light's slot in the pool. The pool
      // reshuffles which slot holds which lamp as the player walks, and point
      // lights are summed in the shader, so a pure permutation of the slots is
      // invisible — but only if nothing about a light depends on its slot.
      // Keying the flicker to `i` meant a lamp changing slots changed
      // brightness in one frame, worth up to 0.83 across the pool: a pop that
      // had nothing to do with the hand-over and survived every other fix.
      const lamp = this.nearestIndex[i] as number;
      const flicker = 0.86 + 0.14 * Math.sin(elapsed * 1.6 + lamp * 2.1);
      const distance = Math.sqrt(this.nearestDistance[i] as number);
      const handover = boundary > fadeFrom ? smoothstep(boundary, fadeFrom, distance) : 1;
      light.intensity = lit * LIGHT_INTENSITY * flicker * handover;
      light.visible = lit > 0.02 && handover > 0.001;
    }
  }

  dispose(): void {
    this.groundGlowMaterial.dispose();
  }

  /** Hands the small pool of real lights to the lamps nearest the player. */
  private assignNearestLights(playerPosition: Vector3): void {
    const count = this.lights.length;
    if (count === 0) return;
    const bestIndex = this.nearestIndex;
    const bestDist = this.nearestDistance;
    let filled = 0;

    for (let i = 0; i < this.lampPositions.length; i += 1) {
      const lamp = this.lampPositions[i] as Vector3;
      const dx = lamp.x - playerPosition.x;
      const dz = lamp.z - playerPosition.z;
      const distSq = dx * dx + dz * dz;

      if (filled < count) {
        bestIndex[filled] = i;
        bestDist[filled] = distSq;
        filled += 1;
      } else {
        let worst = 0;
        for (let k = 1; k < count; k += 1) {
          if ((bestDist[k] as number) > (bestDist[worst] as number)) worst = k;
        }
        if (distSq < (bestDist[worst] as number)) {
          bestIndex[worst] = i;
          bestDist[worst] = distSq;
        }
      }
    }

    this.assigned = filled;
    for (let i = 0; i < filled; i += 1) {
      const light = this.lights[i];
      const lamp = this.lampPositions[bestIndex[i] as number];
      if (!light || !lamp) continue;
      light.position.set(lamp.x, lamp.y + LIGHT_HEIGHT, lamp.z);
    }
  }
}

// ---------------------------------------------------------------- placement

/**
 * Mirrors `paths.ts`'s `main-loop` route control points — see the class doc
 * comment. Keep in sync by hand if that route ever moves.
 */
const MAIN_LOOP_POINTS: readonly (readonly [number, number])[] = [
  [0, -21],
  [15, -20],
  [24, -12],
  [25, 2],
  [18, 15],
  [4, 22],
  [-12, 22],
  [-23, 13],
  [-24, -3],
  [-17, -16],
];
const MAIN_LOOP_HALF_WIDTH = 1.8;

/** Mirrors `paths.ts`'s `fountain-approach` route control points. */
const FOUNTAIN_APPROACH_POINTS: readonly (readonly [number, number])[] = [
  [0, -21],
  [0, -15],
  [0, -9],
];
const FOUNTAIN_APPROACH_HALF_WIDTH = 1.5;

/** Extra clearance beyond a route's half-width so lamps stand clear of the kerb. */
const EDGE_GAP = 1.7;

/** Kept clear of every reserved ride plot by this much on top of its own radius. */
const ANCHOR_MARGIN = 1.2;

/**
 * Sampled more densely than the final lamp count needs: a good third of these
 * fall within a reserved ride plot's clearance and are dropped by
 * {@link offsetFromCurve}, since the anchors sit right off this ring road by
 * design. Oversampling here is what keeps the survivors in the ~12-18 target
 * range instead of the sparse handful a 1-for-1 sample count would leave.
 */
function placeLampPosts(): (readonly [number, number])[] {
  const positions: (readonly [number, number])[] = [];

  const mainLoop = makeCurve(MAIN_LOOP_POINTS, true);
  const mainLoopSamples = 24;
  for (let i = 0; i < mainLoopSamples; i += 1) {
    const t = i / mainLoopSamples;
    const point = offsetFromCurve(mainLoop, t, MAIN_LOOP_HALF_WIDTH + EDGE_GAP);
    if (point) positions.push(point);
  }

  const fountainApproach = makeCurve(FOUNTAIN_APPROACH_POINTS, false);
  for (const t of [0.35, 0.75]) {
    const point = offsetFromCurve(fountainApproach, t, FOUNTAIN_APPROACH_HALF_WIDTH + EDGE_GAP);
    if (point) positions.push(point);
  }

  return positions;
}

function makeCurve(points: readonly (readonly [number, number])[], closed: boolean): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    points.map(([x, z]) => new Vector3(x, 0, z)),
    closed,
    'catmullrom',
    0.4,
  );
}

const CENTRE = new Vector3(1, 0, 0.2);

/**
 * Samples the curve at `t`, offsets perpendicular to the tangent by `offset`
 * (choosing the side that points away from the plaza, same convention the
 * fairy-light ring and the paths themselves are built around), then rejects
 * the point if it still lands on paving or inside a reserved ride plot.
 */
function offsetFromCurve(curve: CatmullRomCurve3, t: number, offset: number): (readonly [number, number]) | null {
  const point = curve.getPoint(t);
  const tangent = curve.getTangent(t);
  const nx = -tangent.z;
  const nz = tangent.x;
  const length = Math.hypot(nx, nz) || 1;

  const candidateA = { x: point.x + (nx / length) * offset, z: point.z + (nz / length) * offset };
  const candidateB = { x: point.x - (nx / length) * offset, z: point.z - (nz / length) * offset };
  const distA = Math.hypot(candidateA.x - CENTRE.x, candidateA.z - CENTRE.z);
  const distB = Math.hypot(candidateB.x - CENTRE.x, candidateB.z - CENTRE.z);
  const candidate = distA >= distB ? candidateA : candidateB;

  if (isOnPath(candidate.x, candidate.z, 0.2)) return null;
  for (const anchor of ANCHORS) {
    const [ax, az] = anchor.position;
    if (Math.hypot(candidate.x - ax, candidate.z - az) < anchor.boundingRadius + ANCHOR_MARGIN) return null;
  }

  return [candidate.x, candidate.z];
}

// ------------------------------------------------------------------ helpers

const IDENTITY_QUATERNION = new Quaternion();
const UNIT_SCALE = new Vector3(1, 1, 1);
const scratchMatrix = new Matrix4();
const scratchPosition = new Vector3();

/** One InstancedMesh, upright, at every lamp base plus a fixed Y offset. */
function instanceAt(
  geometry: ConeGeometry | CylinderGeometry | SphereGeometry | TorusGeometry | PlaneGeometry,
  material: MeshBasicMaterial | ReturnType<typeof toonMaterial>,
  bases: readonly Vector3[],
  yOffset: number,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  bases.forEach((base, index) => {
    scratchPosition.set(base.x, base.y + yOffset, base.z);
    scratchMatrix.compose(scratchPosition, IDENTITY_QUATERNION, UNIT_SCALE);
    mesh.setMatrixAt(index, scratchMatrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

const CURL_QUATERNION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** The decorative curl rings lie flat by default; stand them upright around the pole. */
function instanceCurl(
  geometry: TorusGeometry,
  material: ReturnType<typeof toonMaterial>,
  bases: readonly Vector3[],
  yOffset: number,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  bases.forEach((base, index) => {
    scratchPosition.set(base.x, base.y + yOffset, base.z);
    scratchMatrix.compose(scratchPosition, CURL_QUATERNION, UNIT_SCALE);
    mesh.setMatrixAt(index, scratchMatrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
