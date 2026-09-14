/**
 * **Where does the rail-race rig's NaN come from, and where does the camera
 * actually stand?**
 *
 * Control first, per CLAUDE.md: the instrument prints a *known-good* projection
 * (a camera built by hand, looking at a point 30 m away) before it prints
 * anything about the real rig. If the control does not read 0.5 across, nothing
 * below it means anything.
 */
import './headless-canvas.mjs';
import { PerspectiveCamera, Vector3 } from 'three';
import { RAIL_RACE_PLAN } from '../src/world/railRace/plan.ts';
import { RaceCamera, RIDER_RIDE_HEIGHT } from '../src/world/railRace/camera.ts';
import { PLAYER_LANE } from '../src/world/railRace/route.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const say = (s: string) => process.stderr.write(s + '\n');

// --- control -----------------------------------------------------------------
{
  const cam = new PerspectiveCamera(60, 16 / 9, 1, 3200);
  cam.position.set(0, 0, 0);
  const at = new Vector3(0, 0, -30);
  cam.lookAt(at);
  cam.updateMatrixWorld();
  const ndc = at.clone().project(cam);
  say(`control    a point dead ahead projects to ${((ndc.x + 1) / 2).toFixed(4)} across (want 0.5000)`);
  const off = new Vector3(3, 0, -30).project(cam);
  say(`control    3 m right of it lands ${((off.x + 1) / 2).toFixed(4)} across (want > 0.5)`);
}

const route = RAIL_RACE_PLAN.raceRing;
const rig = new RaceCamera(route);
rig.resize(1280, 720);
rig.reset(0);

const cam = rig.camera;
const finite = (v: { x: number; y: number; z: number }) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

say('');
say(`rig        camera at (${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})  finite=${finite(cam.position)}`);
const dir = new Vector3();
cam.getWorldDirection(dir);
say(`rig        looks along (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})  finite=${finite(dir)}`);
say(`rig        fov ${cam.fov.toFixed(1)}  aspect ${cam.aspect.toFixed(3)}  near ${cam.near} far ${cam.far}`);
say(`rig        projection matrix has NaN: ${cam.projectionMatrix.elements.some((e) => !Number.isFinite(e))}`);
say(`rig        world matrix has NaN:      ${cam.matrixWorld.elements.some((e) => !Number.isFinite(e))}`);

// The private fields, read through the escape hatch an instrument is allowed.
const inner = rig as unknown as {
  stand: { out: number; along: number; rise: number };
  look: { out: number; along: number; rise: number };
  zoomCeiling: readonly number[];
  lookahead: readonly { along: number; out: number }[];
  rider: Vector3;
  out: Vector3;
  along: Vector3;
  aim: Vector3;
};
say('');
say(`solved     stand out ${inner.stand.out.toFixed(3)} along ${inner.stand.along.toFixed(3)} rise ${inner.stand.rise.toFixed(3)}`);
say(`solved     look  out ${inner.look.out.toFixed(3)} along ${inner.look.along.toFixed(3)} rise ${inner.look.rise.toFixed(3)}`);
const badLook = inner.lookahead.filter((p) => !Number.isFinite(p.along) || !Number.isFinite(p.out));
say(`solved     lookahead table ${inner.lookahead.length} stations, ${badLook.length} non-finite`);
const badCeil = inner.zoomCeiling.filter((z) => !Number.isFinite(z));
say(`solved     zoomCeiling ${inner.zoomCeiling.length} stations, ${badCeil.length} non-finite, ` +
  `min ${Math.min(...inner.zoomCeiling).toFixed(4)} max ${Math.max(...inner.zoomCeiling).toFixed(4)}`);
say(`place      rider (${inner.rider.x.toFixed(2)}, ${inner.rider.y.toFixed(2)}, ${inner.rider.z.toFixed(2)})`);
say(`place      aim   (${inner.aim.x.toFixed(2)}, ${inner.aim.y.toFixed(2)}, ${inner.aim.z.toFixed(2)})`);
say(`place      out   (${inner.out.x.toFixed(3)}, ${inner.out.y.toFixed(3)}, ${inner.out.z.toFixed(3)})`);
say(`place      along (${inner.along.x.toFixed(3)}, ${inner.along.y.toFixed(3)}, ${inner.along.z.toFixed(3)})`);

// --- where is the rig, relative to the ground it stands over? ---------------
say('');
const g = terrainHeight(cam.position.x, cam.position.z);
say(`ground     terrain under the camera is ${g.toFixed(2)} m; the camera is at y ${cam.position.y.toFixed(2)} ` +
  `(${(cam.position.y - g).toFixed(2)} m over it)`);

// Where the drawn rider actually is, against where the rig aims.
const drawn = route.pointAt(PLAYER_LANE, route.startDistance, new Vector3());
say(`rider      drawn on the sphere at (${drawn.x.toFixed(2)}, ${drawn.y.toFixed(2)}, ${drawn.z.toFixed(2)})`);
say(`rider      rig aims at the flat ghost, ${inner.rider.distanceTo(drawn).toFixed(3)} m away ` +
  `(ride height ${RIDER_RIDE_HEIGHT})`);
