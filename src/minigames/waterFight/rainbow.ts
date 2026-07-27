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
 * - **It hangs off the camera, not off the world** — the trick the rail
 *   racer's backdrop documents. The first version stood the arch in the garden
 *   and pushed it back past the fence, which does nothing at all under an
 *   orthographic camera pitched 38° down: moving something away from the
 *   viewer moves it *up the screen*, and the whole rainbow sailed off the top
 *   of the frame. Parented to the camera, `y` is screen metres and `z` is
 *   simply how far in front it sits, so the arch is exactly where it was
 *   authored whichever way the garden is framed.
 * - **It is painted over the garden, not hung in the sky behind it**, because
 *   in this projection there is no sky to hang it in. An orthographic camera
 *   pitched 38° over flat ground never reaches a horizon — the lawn fills the
 *   frame all the way to the top, exactly as it does in the park itself — so
 *   the second attempt, which put the arch a hundred metres back, was neatly
 *   occluded by grass. It now sits in *front* of everything with `depthTest`
 *   off, at two-thirds opacity, which is the same call the hop ring makes: in
 *   a park built out of painted things, a rainbow is pigment.
 * - **It fades in over half a second and out over two.** Snapping on looks like
 *   a bug; a slow fade out means the rainbow is still there for the moment
 *   after the squirting stops, which is when a child actually looks up.
 */

/**
 * Radius of the arch in metres, measured to the middle of the bands, and how
 * thick the six-band ribbon is.
 *
 * Small, because GAME_DESIGN's word is *"a little rainbow"* — and because a big
 * one drawn in front of the garden would have its legs planted across the
 * children.
 */
const RADIUS = 4.4;
const THICKNESS = 0.9;

/**
 * Where the arch hangs, in the camera's own frame.
 *
 * `Y` is screen metres above the point the camera is looking at, chosen so both
 * feet land beyond the fence and the whole arc sits over the far half of the
 * garden rather than across anybody's face. `Z` is how far in front of the
 * camera it sits — nearer than the garden, since it is painted over the top.
 */
const OFFSET_Z = -40;
const OFFSET_Y = 3;

/**
 * How high the arch reaches above the point the camera is looking at.
 *
 * `WaterFight.resize` frames the garden by fitting a list of things that must
 * not be cropped, and this is one of them. It currently comes out just under
 * what the garden itself needs, which is the point: the rainbow costs the
 * framing nothing, so the camera does not lurch when one appears.
 */
export const RAINBOW_SCREEN_TOP = OFFSET_Y + RADIUS + THICKNESS / 2;

/**
 * Air-wetness at which the rainbow starts to show, and where it is fully out.
 *
 * Set against the live-droplet count in `water.ts`: one squirt in flight reads
 * about 0.47, so a child squirting on their own stays just under the line and
 * any two at once clear it easily. That is the design — the rainbow is the
 * garden noticing that the fight has got bigger, so it must not come out for
 * one person taking pot shots.
 */
const FADE_IN = 0.52;
const FADE_FULL = 0.82;

/**
 * Strongest the rainbow ever gets.
 *
 * It is drawn in front of the garden, so this is also the number that decides
 * whether a child standing under it is still legible. Two thirds reads clearly
 * as a rainbow and hides nobody.
 */
const MAX_OPACITY = 0.66;

export interface Rainbow {
  /** Parent this to the **camera**, not the scene. See the note above. */
  readonly root: Group;
  /** True once the arch is actually visible — the HUD says a word about it. */
  readonly showing: boolean;
  /** Feed it the water system's `density` every frame. */
  update(dt: number, density: number): void;
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
    // Off, so the arch is never cut into by the lawn behind it — see the note
    // about there being no sky in this projection. Normal blending, not
    // additive, for the reason spelled out in rainbowRing.ts: in a park made of
    // painted things, a rainbow is pigment.
    depthTest: false,
    fog: false,
  });

  const arch = decal(new Mesh(geometry, material));
  arch.position.set(0, OFFSET_Y, OFFSET_Z);
  arch.visible = false;
  arch.renderOrder = 20;
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

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
