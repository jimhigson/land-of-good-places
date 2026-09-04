import './headless-dom.mjs';
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { CANONICAL_PARK_SEED, parkSeedSource } = await import('../src/world/parkSeedPool.ts');
console.log(`PARK_SEED=${PARK_SEED} canonical=${CANONICAL_PARK_SEED} source=${parkSeedSource()} localStorageWasNative=${process.env.LS_NATIVE ?? '?'}`);
