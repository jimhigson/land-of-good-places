import {
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { CAMERA_PITCH_DEGREES } from '../core/constants';
import { PALETTE } from '../core/palette';
import { clamp01, Rng, TAU } from '../core/mathUtils';
import { glowTexture } from '../core/textures';
import { terrainHeight } from './terrain';
import { ANCHORS } from './anchors';
import type { FrameContext, GameSystem } from '../core/types';

/**
 * Fireflies: a few small swarms drifting over the lawn after dark.
 *
 * The family asked for "fireflies flying around at night", and the brief that
 * came with it was *charming, not swarm-like or creepy*. Three things do that
 * work, and they are the only things that matter here:
 *
 * - **Clusters, not a cloud.** {@link SWARM_COUNT} loose knots of
 *   {@link PER_SWARM} each, rather than the same number of flies spread evenly
 *   across the park. A handful of them dancing together over one bush is a
 *   lovely thing to walk up to; the same flies scattered over a hundred metres
 *   is a screen of noise.
 * - **They never go out.** Each one breathes between {@link DIM} and full
 *   rather than blinking off. Real fireflies do blink off, and it looks
 *   unsettling — the eye reads the gaps as something moving in the dark.
 * - **They are gone by morning.** Brightness scales with `nightFactor` and the
 *   whole group is switched off in daylight, so there is never a translucent
 *   grey speck hanging over the grass at noon.
 *
 * ## Cost
 *
 * One `InstancedMesh`, one draw call, no lights, and **nothing allocated after
 * construction**. Every fly's flight path is a closed-form function of
 * `elapsed` — three sines with mutually incommensurate frequencies, so the
 * path wanders quasi-periodically and never visibly repeats — which means
 * there is no per-fly state to keep and no per-frame object to make. `update`
 * composes into one reused `Matrix4` and writes floats into instance buffers
 * that already exist. This is deliberate: GC pauses are a live complaint from
 * the family (see ARCHITECTURE-REVIEW), and a drifting particle system is
 * exactly the kind of thing that lands on that list.
 */

/** Loose knots of fireflies. */
const SWARM_COUNT = 12;
/** Flies in each knot. */
const PER_SWARM = 7;
/** How far a knot's members are scattered from its centre, in metres. */
const SWARM_SPREAD = 2.4;

/** Fireflies live in this ring of lawn — outside the plaza, inside the park. */
const MIN_RADIUS = 13;
const MAX_RADIUS = 42;
/** Clear of every reserved ride plot by this much, so none hovers inside a ride. */
const ANCHOR_MARGIN = 2;

/**
 * Height band above the ground a knot's centre sits in.
 *
 * The floor is not arbitrary: a fly's home is scattered ±0.35 m inside its
 * knot and then drifts a further ±{@link DRIFT_VERTICAL}, so the lowest a fly
 * can ever get is `MIN_HEIGHT − 0.9`. Anything under about 1.3 here and one
 * of them eventually sinks through the lawn.
 */
const MIN_HEIGHT = 1.4;
const MAX_HEIGHT = 2.8;

/** How far a fly drifts from its home point, per axis. */
const DRIFT_HORIZONTAL = 1.5;
const DRIFT_VERTICAL = 0.55;

/** The dimmest a fly ever gets — it breathes, it does not blink out. See above. */
const DIM = 0.32;

/** Width of a fly's glow, in metres. Small: it is a spark, not a lantern. */
const SIZE = 0.3;

/** Warm gold with the occasional green one, both straight out of the palette. */
const FLY_COLOURS = [PALETTE.fairyWarm, PALETTE.fairyWarm, PALETTE.fairyMint];

/** Stride of {@link Fireflies.flight}: home xyz, three drift frequencies, three phases, blink rate. */
const STRIDE = 10;

export class Fireflies implements GameSystem {
  readonly name = 'fireflies';
  readonly group = new Group();

  /** 0 = off (daytime), 1 = fully out. Set by World from DayNight. */
  nightFactor = 0;

  /** How many fireflies there are. Fixed at construction; see the class doc. */
  readonly count: number;

  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  /** Flight parameters, {@link STRIDE} floats per fly. Read-only after construction. */
  private readonly flight: Float32Array;
  /** Each fly's unlit colour, three floats per fly, in the instance buffer's colour space. */
  private readonly base: Float32Array;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly facing = new Quaternion();
  private readonly facingEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly size = new Vector3(1, 1, 1);

  constructor() {
    this.group.name = 'fireflies';
    const rng = new Rng(0xf1efa1);

    const homes: number[] = [];
    for (let swarm = 0; swarm < SWARM_COUNT; swarm += 1) {
      const centre = pickSwarmCentre(rng);
      if (!centre) continue;
      const [cx, cz] = centre;
      const height = rng.range(MIN_HEIGHT, MAX_HEIGHT);
      for (let i = 0; i < PER_SWARM; i += 1) {
        const angle = rng.range(0, TAU);
        const spread = Math.sqrt(rng.unit()) * SWARM_SPREAD;
        const x = cx + Math.cos(angle) * spread;
        const z = cz + Math.sin(angle) * spread;
        homes.push(x, terrainHeight(x, z) + height + rng.range(-0.35, 0.35), z);
      }
    }

    this.count = homes.length / 3;
    this.flight = new Float32Array(this.count * STRIDE);
    this.base = new Float32Array(this.count * 3);

    const colour = new Color();
    for (let i = 0; i < this.count; i += 1) {
      const f = i * STRIDE;
      this.flight[f] = homes[i * 3] as number;
      this.flight[f + 1] = homes[i * 3 + 1] as number;
      this.flight[f + 2] = homes[i * 3 + 2] as number;
      // Three frequencies that share no simple ratio, so x, y and z come back
      // into phase with each other only after a very long time — the fly never
      // visibly retraces a loop.
      this.flight[f + 3] = rng.range(0.26, 0.42);
      this.flight[f + 4] = rng.range(0.55, 0.78);
      this.flight[f + 5] = rng.range(0.31, 0.49);
      this.flight[f + 6] = rng.range(0, TAU);
      this.flight[f + 7] = rng.range(0, TAU);
      this.flight[f + 8] = rng.range(0, TAU);
      this.flight[f + 9] = rng.range(1.1, 2.0);

      colour.setHex(rng.pick(FLY_COLOURS));
      this.base[i * 3] = colour.r;
      this.base[i * 3 + 1] = colour.g;
      this.base[i * 3 + 2] = colour.b;
    }

    // A soft white blob; the per-instance colour does all the tinting, so the
    // texture cache holds one glow for every firefly in the park.
    //
    // Normal blending, not additive: ART_DIRECTION is explicit that an effect
    // in this park is pigment. Additive sparks would blow out to flat white
    // the moment one drifted over a pale sand path at dusk, which is exactly
    // the bug the rainbow hop ring was written to avoid.
    this.material = new MeshBasicMaterial({
      map: glowTexture(0xffffff),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });

    this.mesh = new InstancedMesh(
      new PlaneGeometry(SIZE, SIZE),
      this.material,
      Math.max(1, this.count),
    );
    this.mesh.name = 'firefly-sparks';
    this.mesh.count = this.count;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    // The flies move every frame anyway, so there is nothing to gain from a
    // bounding sphere that would have to be recomputed to stay true.
    this.mesh.frustumCulled = false;

    for (let i = 0; i < this.count; i += 1) {
      this.mesh.setColorAt(i, colour.setRGB(
        this.base[i * 3] as number,
        this.base[i * 3 + 1] as number,
        this.base[i * 3 + 2] as number,
      ));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  update({ elapsed, cameraForward }: FrameContext): void {
    const lit = clamp01(this.nightFactor);
    this.group.visible = lit > 0.02;
    if (!this.group.visible) return;

    // Material opacity carries the night fade; per-instance colour carries the
    // individual breathing. `InstancedMesh` has no per-instance opacity, so the
    // two have to be split like this.
    this.material.opacity = lit;

    // Every spark faces the camera. One quaternion for the lot: the camera has
    // exactly one pitch, forever (ARCHITECTURE.md), and only its yaw ever
    // changes, so turning the ground-plane `cameraForward` into a facing is a
    // single `atan2` per frame rather than per fly.
    this.facingEuler.set(-CAMERA_PITCH, Math.atan2(-cameraForward.x, -cameraForward.z), 0);
    this.facing.setFromEuler(this.facingEuler);

    const instanceColor = this.mesh.instanceColor;
    const colours = instanceColor ? (instanceColor.array as Float32Array) : null;

    for (let i = 0; i < this.count; i += 1) {
      const f = i * STRIDE;
      const driftX = Math.sin(elapsed * (this.flight[f + 3] as number) + (this.flight[f + 6] as number));
      const driftY = Math.sin(elapsed * (this.flight[f + 4] as number) + (this.flight[f + 7] as number));
      const driftZ = Math.sin(elapsed * (this.flight[f + 5] as number) + (this.flight[f + 8] as number));

      this.position.set(
        (this.flight[f] as number) + driftX * DRIFT_HORIZONTAL,
        (this.flight[f + 1] as number) + driftY * DRIFT_VERTICAL,
        (this.flight[f + 2] as number) + driftZ * DRIFT_HORIZONTAL,
      );
      this.matrix.compose(this.position, this.facing, this.size);
      this.mesh.setMatrixAt(i, this.matrix);

      if (colours) {
        // A slow breathe, never all the way out — see the class doc.
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * (this.flight[f + 9] as number) + (this.flight[f + 6] as number));
        const brightness = DIM + (1 - DIM) * pulse * pulse;
        const c = i * 3;
        colours[c] = (this.base[c] as number) * brightness;
        colours[c + 1] = (this.base[c + 1] as number) * brightness;
        colours[c + 2] = (this.base[c + 2] as number) * brightness;
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (instanceColor) instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const CAMERA_PITCH = (CAMERA_PITCH_DEGREES * Math.PI) / 180;

/**
 * Somewhere on the lawn to hang a swarm.
 *
 * Fireflies are not bothered by paving — one drifting over a path is a nice
 * thing to walk under — but a knot of them hovering *inside* the ferris wheel
 * is not, so the reserved plots are the one thing avoided. Gives up after a
 * few tries rather than looping forever; one swarm fewer is not worth a
 * pathological seed.
 */
function pickSwarmCentre(rng: Rng): readonly [number, number] | null {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const angle = rng.range(0, TAU);
    const distance = Math.sqrt(rng.range((MIN_RADIUS / MAX_RADIUS) ** 2, 1)) * MAX_RADIUS;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    let clear = true;
    for (const anchor of ANCHORS) {
      const [ax, az] = anchor.position;
      if (Math.hypot(x - ax, z - az) < anchor.boundingRadius + ANCHOR_MARGIN) {
        clear = false;
        break;
      }
    }
    if (clear) return [x, z];
  }
  return null;
}
