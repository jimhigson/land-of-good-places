/** Scratch: LGP_SEED=N LGP_ONLY='substr|substr' — run matching PARK_ACCEPTANCE entries on the accepted park. */
import './headless-canvas.mjs';
import { ACCEPTED_RESTARTS } from '../src/world/acceptedRestarts.ts';
const seed = Number(process.env['LGP_SEED'] ?? 0);
const restart = Number(process.env['LGP_PARK_RESTART'] ?? ACCEPTED_RESTARTS[seed] ?? 0);
const only = (process.env['LGP_ONLY'] ?? '').split('|').filter(Boolean);
const { buildParkFacts } = await import('../test/procgen/parkFacts.ts');
const facts = await buildParkFacts(seed, restart);
if (process.env['LGP_CONTROL']) {
  const control = await import(process.env['LGP_CONTROL']);
  control.default(facts);
}
const { PARK_ACCEPTANCE } = await import('../test/procgen/invariants.ts');
for (const [name, check] of PARK_ACCEPTANCE) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  const complaints = check(facts);
  console.log(`RESULT seed=${seed} restart=${restart} ${complaints.length === 0 ? 'PASS' : `FAIL(${complaints.length})`} ${name}`);
  for (const c of complaints.slice(0, 12)) console.log(`  - ${c}`);
}
process.exit(0);
