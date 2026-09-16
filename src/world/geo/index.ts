/**
 * **The sphere is the domain.** `SPHERE-DOMAIN.md` is the design; this is the
 * vocabulary it describes, and it is what every subsystem builds on.
 *
 * Five types and nothing else:
 *
 * - {@link Geo} — a position is a 3-vector from the planet's centre. Its
 *   components are `cx`/`cy`/`cz`, so a `y` difference standing in for a
 *   distance will not compile.
 * - {@link Frame} — a place *and a way round*. There is no global yaw, because
 *   there is no global north.
 * - {@link Chart} — flatness is a declared local privilege with a stated
 *   validity radius and a printed departure from the sphere.
 * - {@link Field} — a quantity that varies; a constant one must name the chart
 *   it is constant over.
 * - {@link Anchor} — the one translation to Cartesian, at scene-graph
 *   attachment. Below it, three.js's own matrix composition is already correct
 *   tangent-space arithmetic.
 *
 * ## For an engineer picking up a subsystem
 *
 * **World space is a pure translation of this space** — `(0, +220, 0)`, no
 * rotation, no scale. So `Geo.fromWorld` / `toWorld` are exact and free, every
 * *direction* and every quaternion you already have is valid unchanged, and a
 * subsystem can convert at its own boundary and reason in `Geo` inside while
 * its callers still speak world coordinates. That is the migration, and it is
 * why several of us can do it at once.
 *
 * Three rules that cover most of what goes wrong:
 *
 * 1. **Never subtract a `y`.** Heights are `altitude(geo)`; distances are
 *    `chordTo` (through the air) or `arcTo` (along the ground).
 * 2. **Never write `new Vector3(0, 1, 0)` outdoors.** Up is `geo.up(target)` or
 *    `chart.upAt(local, target)`.
 * 3. **Never add to the scene root with a computed position.** Hang it off an
 *    {@link Anchor}, and leave the model's own local transforms alone.
 */
export { Geo, PLANET_CENTRE_WORLD_Y, PLANET_RADIUS, scratchGeo } from './Geo';
export { Frame } from './Frame';
export {
  FLAT_BUDGET_RADIUS,
  FLAT_DEPARTURE_BUDGET,
  PARK_CHART,
  allCharts,
  chartById,
  curvedChart,
  flatChart,
  flatDeparture,
  flatRadiusFor,
  resetCharts,
  type Chart,
  type ChartId,
  type DepartureAccepted,
} from './Chart';
export { constantOver, field, unboundedConstant, type Field } from './Field';
export { Anchor } from './Anchor';
export {
  ON_THE_GROUND,
  altitudeOfMetres,
  clearanceBetween,
  formatAltitude,
  isAbove,
  isBelow,
  metresOf,
  raisedBy,
  type Altitude,
} from './Altitude';
// `asUp` is deliberately NOT re-exported: Geo.up, Frame.up and Chart.upAt are
// the only honest suppliers of an `Up`, and they live inside this directory.
export { type Up } from './Up';
export {
  advance,
  advancedFrom,
  geodesicLerp,
  rotateGeoAbout,
  tangentTowards,
} from './geodesic';
export {
  altitude,
  altitudeOf,
  dropToGround,
  groundAt,
  groundRadiusToward,
  groundRadiusUnder,
  setAltitude,
  worldYAtAltitude,
} from './ground';
