/**
 * **Dumps one built bridge's drawn geometry to OBJ, so Blender can render it.**
 *
 * Issue #489's hole is in the *swept* masonry shell, not in the authored stone
 * kit, so no render of `bridgeStones.blend` can show it. This exists so the
 * artist's usual deliverable — an image Jim can judge by eye — is still
 * possible for a piece of geometry the game builds at runtime: it takes the
 * real park (`scripts/park-harness.mts`, the same one `check:park` measures),
 * finds one bridge, and writes every drawn mesh of it out as a Wavefront OBJ
 * in world space, one OBJ group per mesh name (`shell`, `wallTop`, `archRing`,
 * `coping`).
 *
 * Nothing is modelled here and no number is copied: the vertices written are
 * exactly the vertices the game draws.
 *
 * Usage:
 *   LGP_SEED=1 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     art/blend/bridge_shell_dump.mts <bridge-name> <out.obj>
 *
 * With no bridge name it lists the bridges on that seed and exits.
 * `art/blend/bridge_shell_render.py` renders what this writes.
 */
import { Mesh, Vector3, type Object3D, type BufferGeometry } from 'three';
import { writeFileSync } from 'node:fs';
import { buildHeadlessPark } from '../../scripts/park-harness.mts';
import { PARK_SEED } from '../../src/world/parkManifest.ts';

const wanted = process.argv[2];
const outPath = process.argv[3];

const { scene } = buildHeadlessPark();
scene.updateMatrixWorld(true);

const bridges = new Map<string, Object3D>();
scene.traverse((o: Object3D) => {
  if (/^bridge-\d/.test(o.name)) bridges.set(o.name, o);
});

if (!wanted || !outPath) {
  console.log(`seed ${PARK_SEED} bridges: ${[...bridges.keys()].join(', ') || '(none)'}`);
  process.exit(0);
}

const group = bridges.get(wanted);
if (!group) {
  throw new Error(
    `seed ${PARK_SEED} has no bridge named '${wanted}' — it has ${[...bridges.keys()].join(', ')}`,
  );
}

// Centre *and orient* the export on the bridge's own crown, so the camera in
// the render script can be written in bridge-local metres — across the bridge
// is +X, along it is +Z, up is +Y — and stay valid on every seed and every
// bearing. The `deck` marker is the one object that already carries both, and
// `bridges.ts` builds it from the same frame the shell is swept along, so this
// is not a second opinion about where the bridge is.
const deck = group.getObjectByName('deck');
if (!deck) throw new Error(`${wanted} has no 'deck' marker to centre the export on`);
const origin = new Vector3().setFromMatrixPosition(deck.matrixWorld);
const local = deck.matrixWorld.clone().invert();

const lines: string[] = [
  `# ${wanted}, seed ${PARK_SEED} — dumped by art/blend/bridge_shell_dump.mts`,
  `# world origin of this export: ${origin.x.toFixed(3)} ${origin.y.toFixed(3)} ${origin.z.toFixed(3)}`,
];
let written = 0;

group.traverse((o: Object3D) => {
  const mesh = o as Mesh;
  if (!mesh.isMesh || mesh.name === 'deck') return;
  const geometry = mesh.geometry as BufferGeometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index) return;

  lines.push(`g ${mesh.name}`);
  lines.push(`o ${mesh.name}`);
  const base = written;
  const v = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(local);
    lines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
  }
  written += position.count;
  for (let i = 0; i < index.count; i += 3) {
    // OBJ is 1-based, and counts vertices across the whole file.
    const a = base + (index.getX(i) as number) + 1;
    const b = base + (index.getX(i + 1) as number) + 1;
    const c = base + (index.getX(i + 2) as number) + 1;
    lines.push(`f ${a} ${b} ${c}`);
  }
});

writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`${wanted} (seed ${PARK_SEED}): ${written} vertices → ${outPath}`);
