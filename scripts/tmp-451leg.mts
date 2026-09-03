/** TEMP: would the arriving-connector screen have accepted seed 451's
 * `spur-stall.spookyHouse` leg? Control rows: a leg that plainly does clear
 * the same plot, and the public (non-arriving) screen on the same leg. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugArrivalLegScreens } from '../src/world/paths.ts';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
quietly(() => buildHeadlessPark());
const spur = PATH_GRAPH.edges.find((e) => e.route.name === 'spur-stall.spookyHouse')!;
const a = spur.route.points[0]!;
const b = spur.route.points[spur.route.points.length - 1]!;
console.log('THE LEG', JSON.stringify(debugArrivalLegScreens(a[0], a[1], b[0], b[1], b[0], b[1]), null, 1));
console.log('\nCONTROL — a leg well clear of the booth, same door exemption:');
console.log(JSON.stringify(debugArrivalLegScreens(a[0], a[1], a[0], a[1] + 4, b[0], b[1]), null, 1));
