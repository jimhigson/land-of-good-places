import {
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { glowTexture } from '../../core/textures';
import { decal } from '../style/materials';

/**
 * Splashing in the wishing fountain: droplets + a ring wave, plus the two
 * quiet noises that go with them.
 *
 * Built the same way as `rainbowRing.ts` (read that file's header first) — a
 * fixed pool, `MeshBasicMaterial` because this is an effect rather than a
 * solid toy, normal blending because a splash is pigment (foam), not light,
 * and a colour ramp baked into vertex colours rather than a shader. The
 * droplet side borrows `railRacer/confetti.ts`'s approach instead: one
 * `InstancedMesh`, one draw call, particles held in a plain array and
 * swap-removed on death — no mesh is ever `new`'d after construction.
 */

// --- droplets ---------------------------------------------------------------

const DROPLET_CAPACITY = 48;
const DROPLET_GRAVITY = 9;

interface Droplet {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  angle: number;
  life: number;
  ttl: number;
  size: number;
}

function createDropletField(): {
  root: Group;
  burst(x: number, y: number, z: number, count: number, power: number): void;
  update(dt: number): void;
  dispose(): void;
} {
  const root = new Group();
  root.name = 'effect.waterDroplets';

  // A soft round fleck rather than a hard-edged square — glowTexture is
  // already cached per colour, so reusing it here costs nothing extra.
  const geometry = new PlaneGeometry(0.16, 0.16);
  const material = new MeshBasicMaterial({
    map: glowTexture(PALETTE.waterFoam),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const mesh = decal(new InstancedMesh(geometry, material, DROPLET_CAPACITY));
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 5;
  root.add(mesh);

  const droplets: Droplet[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const axis = new Vector3(0.2, 0.6, 0.4).normalize();
  const colour = new Color();

  return {
    root,

    burst(x, y, z, count, power) {
      for (let i = 0; i < count; i += 1) {
        if (droplets.length >= DROPLET_CAPACITY) break;
        const angle = Math.random() * Math.PI * 2;
        const speed = (1.4 + Math.random() * 2.2) * power;
        droplets.push({
          x,
          y,
          z,
          vx: Math.cos(angle) * speed * 0.55,
          vy: (2.6 + Math.random() * 2.4) * power,
          vz: Math.sin(angle) * speed * 0.55,
          spin: (Math.random() - 0.5) * 10,
          angle: Math.random() * Math.PI * 2,
          life: 0,
          ttl: 0.35 + Math.random() * 0.35,
          size: (0.55 + Math.random() * 0.55) * Math.min(1.3, 0.7 + power * 0.3),
        });
        colour.setHex(Math.random() < 0.5 ? PALETTE.waterFoam : PALETTE.waterTop);
        mesh.setColorAt(droplets.length - 1, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    update(dt) {
      for (let i = droplets.length - 1; i >= 0; i -= 1) {
        const drop = droplets[i];
        if (!drop) continue;
        drop.life += dt;
        if (drop.life >= drop.ttl) {
          const last = droplets[droplets.length - 1];
          if (last && last !== drop) {
            droplets[i] = last;
            mesh.getColorAt(droplets.length - 1, colour);
            mesh.setColorAt(i, colour);
          }
          droplets.pop();
          continue;
        }
        drop.vy -= DROPLET_GRAVITY * dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        drop.z += drop.vz * dt;
        drop.angle += drop.spin * dt;
      }

      mesh.count = droplets.length;
      for (let i = 0; i < droplets.length; i += 1) {
        const drop = droplets[i];
        if (!drop) continue;
        const fade = 1 - Math.max(0, drop.life / drop.ttl - 0.6) / 0.4;
        position.set(drop.x, drop.y, drop.z);
        quaternion.setFromAxisAngle(axis, drop.angle);
        scale.setScalar(drop.size * fade);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

// --- ring wave ---------------------------------------------------------------

/** Rings alive at once — foot splashes come every ~0.3 s while wading. */
const RING_POOL_SIZE = 6;

function splashRingGeometry(): RingGeometry {
  const geometry = new RingGeometry(0.08, 1, 40, 1);
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const inner = new Color(PALETTE.waterFoam);
  const outer = new Color(PALETTE.waterTop);
  const mixed = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i));
    mixed.copy(inner).lerp(outer, Math.min(1, Math.max(0, radius)));
    colours[i * 3] = mixed.r;
    colours[i * 3 + 1] = mixed.g;
    colours[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function createRingWaves(): {
  root: Group;
  burst(x: number, y: number, z: number, startRadius: number, endRadius: number, lifetime: number, strength: number): void;
  update(dt: number): void;
  dispose(): void;
} {
  const root = new Group();
  root.name = 'effect.waterRings';

  const geometry = splashRingGeometry();
  const meshes: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  const materials: MeshBasicMaterial[] = [];
  const ages: number[] = [];
  const startRadii: number[] = [];
  const endRadii: number[] = [];
  const lifetimes: number[] = [];
  const strengths: number[] = [];
  let next = 0;

  for (let i = 0; i < RING_POOL_SIZE; i += 1) {
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = decal(new Mesh(geometry, material));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    ages.push(1);
    startRadii.push(0.08);
    endRadii.push(1);
    lifetimes.push(1);
    strengths.push(1);
  }

  return {
    root,

    burst(x, y, z, startRadius, endRadius, lifetime, strength) {
      const index = next;
      next = (next + 1) % RING_POOL_SIZE;
      const mesh = meshes[index];
      if (!mesh) return;
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(startRadius);
      mesh.visible = true;
      ages[index] = 0;
      startRadii[index] = startRadius;
      endRadii[index] = endRadius;
      lifetimes[index] = lifetime;
      strengths[index] = strength;
    },

    update(dt) {
      for (let i = 0; i < RING_POOL_SIZE; i += 1) {
        const lifetime = lifetimes[i] ?? 1;
        const age = ages[i] ?? lifetime;
        if (age >= lifetime) continue;

        const next_ = age + dt;
        ages[i] = next_;
        const mesh = meshes[i];
        const material = materials[i];
        if (!mesh || !material) continue;

        if (next_ >= lifetime) {
          mesh.visible = false;
          material.opacity = 0;
          continue;
        }

        const t = next_ / lifetime;
        const eased = easeOut(t);
        const start = startRadii[i] ?? 0.08;
        const end = endRadii[i] ?? 1;
        mesh.scale.setScalar(start + (end - start) * eased);
        const peak = 0.8 * (strengths[i] ?? 1);
        material.opacity = t < 0.2 ? peak : peak * (1 - (t - 0.2) / 0.8) ** 1.5;
      }
    },

    dispose() {
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

// --- combined effect ----------------------------------------------------

export interface WaterSplashEffects {
  /** Parent this wherever local coordinates make sense — the fountain parents
   *  it to its own group, since every splash happens inside the basin. */
  readonly root: Group;
  /**
   * A proper splash: droplets burst up and outward and a wave ring rolls out
   * across the water. Used when landing in the water from a jump.
   */
  splash(x: number, y: number, z: number): void;
  /**
   * A small splash: a couple of droplets and a modest ripple. Used for
   * wading footsteps and for stepping in/out of the water at a walk.
   */
  footSplash(x: number, y: number, z: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createWaterSplashEffects(): WaterSplashEffects {
  const root = new Group();
  root.name = 'effect.waterSplash';

  const droplets = createDropletField();
  const rings = createRingWaves();
  root.add(droplets.root, rings.root);

  return {
    root,

    splash(x, y, z) {
      droplets.burst(x, y, z, 12, 1.6);
      rings.burst(x, y, z, 0.1, 2.4, 0.75, 1);
    },

    footSplash(x, y, z) {
      droplets.burst(x, y, z, 3, 0.7);
      rings.burst(x, y, z, 0.06, 0.85, 0.45, 0.55);
    },

    update(dt) {
      droplets.update(dt);
      rings.update(dt);
    },

    dispose() {
      droplets.dispose();
      rings.dispose();
    },
  };
}

// --- sound ----------------------------------------------------------------

/**
 * Two tiny WebAudio noise bursts — a "plip" for a foot dabbling in the water
 * and a "ploosh" for a proper jump-in splash.
 *
 * Deliberately not reusing `ui/chime.ts`: that file synthesises tuned notes
 * for the shops, this wants filtered noise instead, and the fountain's own
 * effects file is the right home for the sound that goes with them. Same
 * lazy-`AudioContext` technique — browsers only allow audio to start from a
 * response to user input, which every trigger here always is.
 */
let audioContext: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  if (audioContext) {
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  }
  const Ctor =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/** One second of white noise, generated once and reused for every burst. */
let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

function playWaterBurst(duration: number, peakGain: number, frequencyFrom: number, frequencyTo: number): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(frequencyFrom, start);
  filter.frequency.exponentialRampToValueAtTime(frequencyTo, start + duration);

  const envelope = ctx.createGain();
  // Gentle — quiet and cute, not a bucket tipping over.
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peakGain, start + duration * 0.18);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.05);
}

/** A tiny dabbling-foot plip. `strength` scales the volume down further. */
export function playPlip(strength = 1): void {
  playWaterBurst(0.12, 0.045 * strength, 2600, 1200);
}

/** The bigger jump-in ploosh. */
export function playPloosh(): void {
  playWaterBurst(0.34, 0.085, 1400, 380);
}
