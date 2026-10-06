import { proveScatterDecoupled } from './scatterDecoupling.ts';

// The canonical seed, with nothing pinned: the park everyone looks at. Its own
// file so its two builds and seed 12's do not queue behind each other — see
// `scatterDecoupling.ts`.
await proveScatterDecoupled({ label: 'the canonical seed', env: {} }, { control: false });
