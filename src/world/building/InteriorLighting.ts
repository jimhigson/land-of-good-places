import { DirectionalLight, Group, HemisphereLight } from 'three';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z } from '../../core/constants';
import { shadowMapSize } from '../../core/device';
import { PALETTE } from '../../core/palette';

/**
 * The building's own cosy, constant lighting (GAME_DESIGN.md item 18).
 *
 * Outdoors the whole park shares one sun that swings round the sky and drags
 * its shadows with it (`DayNight`). Indoors is a different continuum
 * (item 30c) and gets a different rule entirely: one fixed warm light,
 * shining from the same corner of the sky for ever, plus a soft hemisphere
 * fill. Nothing here ever changes colour, direction or intensity, so the
 * shadows it casts never move and there is no day or night — only "indoors",
 * whatever the clock outside is doing.
 *
 * `Building` switches this on and off with {@link setActive} — active on every
 * floor except the roof, which is genuinely outdoors and keeps the real sun
 * (see `DayNight.setIndoors`, which is gated by the same signal).
 *
 * Deliberately not a `GameSystem`: fixed lights need no per-frame update at
 * all, which is the whole point of them.
 */
export class InteriorLighting {
  readonly group = new Group();

  constructor() {
    this.group.name = 'interior-lighting';

    // A permanently "afternoon-through-the-window" angle, leaning the same way
    // the outdoor sun does at midday (see `DayNight.applyLook`) so shadows fall
    // towards the camera indoors too, and nothing about the cutaway view looks
    // like it swapped lighting rigs.
    const key = new DirectionalLight(PALETTE.buildingWindowWarm, 1.7);
    key.position.set(-INTERIOR_HALF_X * 0.6, 34, -INTERIOR_HALF_Z * 0.55);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;

    const shadowSize = shadowMapSize();
    key.shadow.mapSize.set(shadowSize, shadowSize);
    const shadowCamera = key.shadow.camera;
    // Framed once to the interior's own floor plate rather than following the
    // player: a fixed frustum is what makes the shadows themselves fixed.
    shadowCamera.left = -INTERIOR_HALF_X - 2;
    shadowCamera.right = INTERIOR_HALF_X + 2;
    shadowCamera.top = INTERIOR_HALF_Z + 2;
    shadowCamera.bottom = -(INTERIOR_HALF_Z + 2);
    shadowCamera.near = 1;
    shadowCamera.far = 80;
    shadowCamera.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    key.shadow.blurSamples = 10;

    // A warm sky / wood-toned ground bounce — cosy rather than daylight blue,
    // and the only other source of light indoors.
    const ambient = new HemisphereLight(PALETTE.sunDay, PALETTE.woodLight, 0.95);

    this.group.add(key, key.target, ambient);
  }

  /** On for every indoor floor; off outdoors and on the roof (see `Building`). */
  setActive(active: boolean): void {
    this.group.visible = active;
  }
}
