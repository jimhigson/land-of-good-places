import { proveScatterDecoupled } from './scatterDecoupling.ts';

// Seed 12, the park that caught the last coupling, plus the control that the
// digest can tell two parks apart — see `scatterDecoupling.ts`.
await proveScatterDecoupled({ label: 'seed 12', env: { LGP_SEED: '12' } }, { control: true });
