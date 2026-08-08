const t0 = performance.now();
const { COASTER_PLANS } = await import('../src/world/coaster/plan.ts');
const cruiserMs = performance.now() - t0;
console.log('cruiser stage ms', cruiserMs.toFixed(0));
console.log('cruiser report', JSON.stringify(COASTER_PLANS.cruiser.route.plan.report));
const t1 = performance.now();
const { SLIDE_PLAN } = await import('../src/world/slide/plan.ts');
console.log('slide stage ms', (performance.now() - t1).toFixed(0));
console.log('slide report', JSON.stringify(SLIDE_PLAN.route.report));
