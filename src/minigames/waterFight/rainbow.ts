import { BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { ART } from '../../art/style/artPalette';
import { clamp01 } from '../../core/mathUtils';
import { decal } from '../../art/style/materials';

/**
 * The little rainbow over the water-fight garden.
 *
 * Straight out of GAME_DESIGN: *"When lots of water flies, a little rainbow
 * appears."* It is not a reward you can aim for and not a score — it is the
 * garden noticing that the fight has got big, which is exactly the thing the
 * design wants children to keep doing.
 *
 * Built the same way as the hop ring (`art/effects/rainbowRing.ts`): **the
 * bands are baked into the vertex colours of one `RingGeometry`**, so there is
 * no shader, no texture and no uniform to keep in step with the park's
 * lighting. Half a ring, stood upright, is an arch.
 *
 * Two things learned putting it up:
 *
 * - **It hangs behind the garden, not over it.** Directly overhead, an
 *   orthographic camera pitched 38° down puts the arch across the children's
 *   faces. Pushed back past the fence it sits in the sky where a rainbow
 *   belongs, and every child stays legible underneath it.
 * - **It fades in over half a second and out over two.** Snapping on looks like
 *   a bug; a slow fade out means the rainbow is still there for the moment
 *   after the squirting stops, which is when a child actually looks up.
 */

/** Radius of the arch in metres, measured to the middle of the bands. */
const RADIUS = 8.5;

/** How thick the whole six-band ribbon is. */
const THICKNESS = 1.3;

/**
 * Where the arch stands, in the camera's own frame.
 *
 * `Z` is straight away from the viewer, which with an orthographic camera moves
 * it behind everything without moving it on screen at all. `Y` sinks its feet
 * below the horizon so only the top of the arc clears the fence — a *little*
 * rainbow, which is the word GAME_DESIGN uses.
 */
const OFFSET_Z = -14;
const OFFSET_Y = -3;

/**
 * How high the arch reaches above the point the camera is looking at.
 *
 * `WaterFight.resize` frames the garden by fitting a list of things that must
 * not be cropped, and this is one of them.
 */
export const RAINBOW_SCREEN_TOP = OFFSET_Y + RADIUS + THICKNESS / 2;

/** Air-wetness at which the rainbow starts to show, and where it is fully out. */
const FADE_IN = 0.3;
const FADE_FULL = 0.62;

/** Strongest the rainbow ever gets. A rainbow you cannot see through is paint. */
const MAX_OPACITY = 0.8;

export interface Rainbow {
  readonly root: Group;
  /** True once the arch is actually visible — the HUD says a word about it. */
  readonly showing: boolean;
  /** Feed it the water system's `density` every frame. */
  update(dt: number, density: number): void;
  /** Keeps the arch square-on to the camera when the framing yaw changes. */
  setYaw(yaw: number): void;
  dispose(): void;
}

export function createRainbow(): Rainbow {
  const root = new Group();
  root.name = 'waterfight:rainbow';

  const inner = RADIUS - THICKNESS / 2;
  const outer = RADIUS + THICKNESS / 2;
  // Half a ring: thetaStart 0, thetaLength π, which in the XY plane is the top
  // half — an arch standing on the horizon.
  const geometry = new RingGeometry(inner, outer, 72, ART.rainbow.length * 2, 0, Math.PI);

  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const from = new Color();
  const to = new Color();
  const mixed = new Color();
  const lastBand = ART.rainbow.length - 1;
  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i));
    const across = clamp01((radius - inner) / (outer - inner));
    // Red on the outside, violet on the inside — which is the way round a real
    // rainbow goes, and the reverse of the hop ring's inside-out ramp.
    const band = (1 - across) * lastBand;
    const index = Math.min(lastBand - 1, Math.floor(band));
    from.setHex(ART.rainbow[index] ?? 0xffffff);
    to.setHex(ART.rainbow[index + 1] ?? 0xffffff);
    mixed.copy(from).lerp(to, band - index);
    colours[i * 3] = mixed.r;
    colours[i * 3 + 1] = mixed.g;
    colours[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3));

  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    // Not additive, for the reason spelled out in rainbowRing.ts: in a park made
    // of painted things, a rainbow is pigment.
    fog: false,
  });

  const arch = decal(new Mesh(geometry, material));
  arch.position.set(0, OFFSET_Y, OFFSET_Z);
  arch.visible = false;
  arch.renderOrder = 3;
  root.add(arch);

  let strength = 0;

  return {
    root,

    get showing(): boolean {
      return strength > 0.15;
    },

    update(dt: number, density: number): void {
      const target = clamp01((density - FADE_IN) / (FADE_FULL - FADE_IN));
      const halfLife = target > strength ? 0.16 : 0.62;
      strength = target + (strength - target) * Math.pow(2, -dt / halfLife);
      if (strength < 0.01) {
        arch.visible = false;
        return;
      }
      arch.visible = true;
      material.opacity = strength * MAX_OPACITY;
      // Grows into place as it appears, so it arcs over the garden rather than
      // switching on at full size.
      arch.scale.setScalar(0.88 + strength * 0.12);
    },

    setYaw(yaw: number): void {
      // The whole group turns with the camera, which is what keeps a flat ring
      // reading as an arch rather than as a ribbon seen edge-on.
      root.rotation.y = yaw;
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
