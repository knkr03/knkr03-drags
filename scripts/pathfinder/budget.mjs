/* budget.mjs - how far a token may travel on one drag.
 *
 * Foundry v13 keeps a movement history per token: every recorded waypoint has a
 * `cost` in scene units (feet, metres, ...), and the history is cleared when the
 * combatant's turn starts or ends. The module uses that history as the movement
 * already spent, so the rule the user asked for is:
 *
 *   spent    = sum of the recorded waypoint costs
 *   budget   = rate - spent            while some movement remains
 *   budget   = rate * 2                when the rate is already used up
 *
 * In combat the clamp instead extends once and is then released (see
 * combatClamp): two clamped moves, then unlimited movement for the rest of the
 * turn.
 *
 * Everything here is plain maths on plain objects so it can be tested in Node
 * without Foundry.
 */

/** Data paths tried, in order, when the movement attribute setting is empty. */
export const RATE_PATHS = Object.freeze([
  "system.attributes.movement.walk",   // dnd5e 3+/4.x
  "system.attributes.movement.speed",
  "system.attributes.speed.value",     // dnd5e legacy
  "system.attributes.speed.total",     // pf2e
  "system.movement.walk",
  "system.movement.speed",
  "system.speed.value",
  "system.attributes.movement"         // numeric movement attribute
]);

/** Read a dot-separated property path from a plain object. */
export function getPath(object, path) {
  let value = object;
  for (const key of String(path).split(".")) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

/** Coerce a movement attribute (number or {value}) into a finite number. */
function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") {
    if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
    if (typeof value.total === "number" && Number.isFinite(value.total)) return value.total;
  }
  return null;
}

/**
 * Resolve an actor's movement rate, in scene units per turn.
 *
 * @param {object|null} actor
 * @param {object} [options]
 * @param {string} [options.attribute] explicit data path; when set it is the only one tried
 * @param {string[]} [options.paths]   candidate paths used when `attribute` is empty
 * @returns {{value:number, path:string, source:"attribute"|"system"}|null}
 */
export function resolveMovementRate(actor, { attribute = "", paths = RATE_PATHS } = {}) {
  if (!actor) return null;
  const candidates = attribute ? [attribute] : paths;
  for (const path of candidates) {
    const value = asNumber(getPath(actor, path));
    if (value !== null && value >= 0) {
      return { value, path, source: attribute ? "attribute" : "system" };
    }
  }
  return null;
}

/**
 * A sliver of leftover movement smaller than this is not a move. Foundry
 * measures the path between the waypoints it is given, and those are rounded to
 * whole pixels, so a drag that stopped exactly on a clamp records a hair less
 * than the clamp. Without this the next drag would be offered the leftover
 * 0.01 ft instead of the next clamp, with no way to spend it.
 *
 * @param {object} grid    {size, distance}
 * @param {number} [pixels] size of the sliver, in screen pixels
 * @returns {number}       the same distance in scene units
 */
export function sliverTolerance(grid, pixels = 2) {
  const size = grid?.size;
  const distance = grid?.distance;
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(distance) || distance <= 0) return 0;
  return (distance / size) * Math.max(0, pixels);
}

/**
 * Movement allowance for one drag.
 *
 * @param {number} rate         scene units available per turn (Infinity for no limit)
 * @param {number} used         scene units already recorded in movement history
 * @param {number} [tolerance]  leftover below this counts as spent (see sliverTolerance)
 * @returns {number}            scene units allowed on the next drag
 */
export function allowedMovement(rate, used, tolerance = 0) {
  if (!Number.isFinite(rate) || rate <= 0) return Infinity;
  const spent = Number.isFinite(used) ? Math.max(0, used) : rate;
  const remaining = rate - spent;
  return remaining > tolerance ? remaining : rate * 2;
}

/**
 * Combat allowance: the clamp extends by one base rate, and is released after
 * the second one. A combatant gets two clamped moves per turn; from the third
 * drag on, movement is unlimited until the turn ends.
 *
 *   spent 0  -> clamp 30,  30 available
 *   spent 30 -> clamp 60,  30 available
 *   spent 45 -> clamp 60,  15 available
 *   spent 60 -> unlimited
 *
 * The history is cleared when the combatant's turn starts or ends, so the
 * clamps and the release are per turn.
 *
 * @param {number} rate         base rate in scene units
 * @param {number} used         scene units already spent this turn
 * @param {number} [tolerance]  leftover below this counts as spent
 * @returns {number}            scene units available now
 */
export function combatClamp(rate, used, tolerance = 0) {
  if (!Number.isFinite(rate) || rate <= 0) return Infinity;
  const spent = Number.isFinite(used) ? Math.max(0, used) : 0;
  if (spent >= rate * 2 - tolerance) return Infinity;
  return Math.max(0, rate * clampLevel(rate, spent, tolerance) - spent);
}

/** Total clamp distance in combat, or Infinity once the second clamp is spent. */
export function combatClampTotal(rate, used, tolerance = 0) {
  if (!Number.isFinite(rate) || rate <= 0) return Infinity;
  const spent = Number.isFinite(used) ? Math.max(0, used) : 0;
  if (spent >= rate * 2 - tolerance) return Infinity;
  return rate * clampLevel(rate, spent, tolerance);
}

/**
 * Which clamp the movement history sits in, 1 for the first.
 *
 * A leftover below the tolerance means the previous clamp has been used up, so
 * the next one is offered instead of an unusable sliver.
 */
function clampLevel(rate, spent, tolerance = 0) {
  const level = Math.floor(spent / rate + 1e-9) + 1;
  return rate * level - spent > tolerance ? level : level + 1;
}

/**
 * Convert scene units into pixels for the current grid.
 * Gridless scenes have no reliable units-per-pixel, so units are treated as px.
 */
export function unitsToPixels(units, grid) {
  if (!Number.isFinite(units)) return Infinity;
  const size = grid?.size;
  const distance = grid?.distance;
  if (!Number.isFinite(size) || !Number.isFinite(distance) || distance <= 0) return units;
  return (units / distance) * size;
}

/**
 * Work out the pixel budget for a drag.
 *
 * @param {object} options
 * @param {number|null} options.rate        resolved actor rate in scene units, null when unknown
 * @param {number} [options.used]           scene units already spent
 * @param {boolean} [options.usedInfinite]  a recorded cost was unmeasurable
 * @param {object} options.grid             {size, distance}
 * @param {boolean} [options.unlimited]     budget disabled by setting
 * @param {number} [options.fallbackSpaces] grid spaces allowed when the actor rate is unknown
 * @param {boolean} [options.combat]        use the extending combat clamp
 * @returns {{limited:boolean, budgetPx:number, rate:number|null, used:number,
 *            allowed:number, units:number, fallback:boolean, combat:boolean,
 *            clampTotal:number|null, mode:string}}
 */
export function movementBudget({
  rate,
  used = 0,
  usedInfinite = false,
  grid,
  unlimited = false,
  fallbackSpaces = 6,
  combat = false
}) {
  const noBudget = {
    limited: false,
    budgetPx: Infinity,
    rate: Number.isFinite(rate) ? rate : null,
    used: Number.isFinite(used) ? used : 0,
    allowed: Infinity,
    units: Infinity,
    fallback: false,
    combat: false,
    clampTotal: null,
    mode: "unlimited"
  };
  if (unlimited) return noBudget;

  let baseRate = Number.isFinite(rate) && rate > 0 ? rate : null;
  let fallback = false;
  if (baseRate === null) {
    const spaces = Number.isFinite(fallbackSpaces) ? Math.max(0, fallbackSpaces) : 0;
    if (spaces === 0) return noBudget;
    baseRate = spaces * (grid?.distance || 1);
    fallback = true;
  }

  const spent = usedInfinite ? baseRate : (Number.isFinite(used) ? Math.max(0, used) : 0);
  const tolerance = sliverTolerance(grid);
  const allowed = combat
    ? combatClamp(baseRate, spent, tolerance)
    : allowedMovement(baseRate, spent, tolerance);
  const budgetPx = unitsToPixels(allowed, grid);
  return {
    limited: Number.isFinite(budgetPx),
    budgetPx,
    rate: baseRate,
    used: spent,
    allowed,
    units: Number.isFinite(budgetPx) ? allowed : Infinity,
    fallback,
    combat: !!combat,
    clampTotal: combat ? combatClampTotal(baseRate, spent, tolerance) : null,
    mode: combat ? "combat" : "standard"
  };
}
