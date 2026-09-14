import { terrainHeight, planetRadiusAt, yAtAltitude, altitudeAt } from '../src/world/terrain';

const CELL = 0.5;
const MAX_STEP = 0.62;
const steps = [[CELL,0],[0,CELL],[CELL,CELL],[-CELL,-CELL]] as const;

const dY = (x:number,z:number,dx:number,dz:number,ledge=0) => {
  const y0 = terrainHeight(x,z);
  // a REAL ledge is `ledge` metres of altitude above the grass in the new column
  const y1 = yAtAltitude(x+dx, z+dz, ledge);
  return { dy: Math.abs(y1-y0), dr: Math.abs(planetRadiusAt(x+dx,y1,z+dz) - planetRadiusAt(x,y0,z)) };
};

console.log('=== CONTROL A: flat grass. A step across level ground must pass both gates. ===');
for (const [x,z] of [[0,0],[80,0],[135.4,0],[157,0],[111,111]] as const) {
  const worst = steps.map(([dx,dz]) => dY(x,z,dx,dz));
  const wy = Math.max(...worst.map(w=>w.dy)), wr = Math.max(...worst.map(w=>w.dr));
  console.log(` d=${Math.hypot(x,z).toFixed(1).padStart(6)}  worst |Δy|=${wy.toFixed(3)} ${wy>MAX_STEP?'BLOCKED  <-- refuses to walk on flat grass':'ok'}   worst |Δradius|=${wr.toFixed(3)} ${wr>MAX_STEP?'BLOCKED':'ok'}`);
}

console.log('\n=== CONTROL B: a real 0.70 m ledge (0.70 m of ALTITUDE). Must be BLOCKED everywhere by a working gate. ===');
for (const [x,z] of [[0,0],[80,0],[157,0],[111,111]] as const) {
  const { dy, dr } = dY(x,z,CELL,0,0.70);
  console.log(` d=${Math.hypot(x,z).toFixed(1).padStart(6)} outward  |Δy|=${dy.toFixed(3)} ${dy>MAX_STEP?'BLOCKED':'LEAKED  <-- router climbs a wall'}   |Δradius|=${dr.toFixed(3)} ${dr>MAX_STEP?'BLOCKED':'LEAKED'}`);
  const i = dY(x,z,-CELL,0,0.70);
  console.log(` d=${Math.hypot(x,z).toFixed(1).padStart(6)} inward   |Δy|=${i.dy.toFixed(3)} ${i.dy>MAX_STEP?'BLOCKED':'LEAKED  <-- router climbs a wall'}   |Δradius|=${i.dr.toFixed(3)} ${i.dr>MAX_STEP?'BLOCKED':'LEAKED'}`);
}

console.log('\n=== CONTROL C: a real 0.40 m step-up (under BUILDING_STEP_UP). Must PASS everywhere. ===');
for (const [x,z] of [[0,0],[157,0]] as const) {
  const { dy, dr } = dY(x,z,CELL,0,0.40);
  console.log(` d=${Math.hypot(x,z).toFixed(1).padStart(6)}  |Δy|=${dy.toFixed(3)} ${dy>MAX_STEP?'BLOCKED <-- refuses a legal stair':'ok'}   |Δradius|=${dr.toFixed(3)} ${dr>MAX_STEP?'BLOCKED':'ok'}`);
}

console.log('\n=== What MAX_STEP would have to become to let flat grass through, and what it then leaks ===');
for (const d of [80,135.4,157,180]) {
  const x = d/Math.SQRT2, z = d/Math.SQRT2;
  const flat = Math.max(...steps.map(([dx,dz]) => dY(x,z,dx,dz).dy));
  console.log(` d=${d.toFixed(1).padStart(6)}  MAX_STEP must exceed ${flat.toFixed(3)} m — which then admits a real ledge of up to ${(flat/ (planetRadiusAt(x,terrainHeight(x,z),z)===0?1:1) ).toFixed(3)} m of y, i.e. ${(altitudeAt(x, terrainHeight(x,z)+flat, z)).toFixed(3)} m of real altitude, unchecked`);
}
