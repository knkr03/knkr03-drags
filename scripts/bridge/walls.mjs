/* walls.mjs - turn scene Wall documents into wall segments for the pathfinder.
 *
 * Foundry's movement restriction is a single flag per wall (`move`), plus doors:
 *
 *   move === CONST.WALL_MOVEMENT_TYPES.NONE     movement ignores this wall
 *   door !== CONST.WALL_DOOR_TYPES.NONE         a door; open doors don't block
 *   ds   === CONST.WALL_DOOR_STATES.OPEN        the open door state
 *
 * Everything else blocks movement. Kept free of Foundry imports so it can be
 * exercised in Node; the bridge passes the live constants in.
 */

/**
 * @param {object[]} walls                 Wall documents (or plain objects with `c`, `move`, `door`, `ds`)
 * @param {object} [constants]
 * @param {number} [constants.moveNone]    CONST.WALL_MOVEMENT_TYPES.NONE
 * @param {number} [constants.doorNone]    CONST.WALL_DOOR_TYPES.NONE
 * @param {number} [constants.doorOpen]    CONST.WALL_DOOR_STATES.OPEN
 * @returns {number[][]}                   [x1,y1,x2,y2] blocking wall centrelines
 */
export function wallSegments(walls, {
  moveNone = 0,
  doorNone = 0,
  doorOpen = 1
} = {}) {
  const segments = [];
  for (const wall of walls ?? []) {
    const c = wall?.c ?? wall?.coords;
    if (!Array.isArray(c) || c.length < 4) continue;
    if (wall.move === moveNone) continue;
    const isDoor = (wall.door ?? doorNone) !== doorNone;
    if (isDoor && wall.ds === doorOpen) continue;
    const x1 = Number(c[0]), y1 = Number(c[1]), x2 = Number(c[2]), y2 = Number(c[3]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    if (Math.hypot(x2 - x1, y2 - y1) < 0.5) continue;
    segments.push([x1, y1, x2, y2]);
  }
  return segments;
}

/** Live constants for wallSegments(). */
export function wallConstants() {
  const C = globalThis.CONST;
  return {
    moveNone: C?.WALL_MOVEMENT_TYPES?.NONE ?? 0,
    doorNone: C?.WALL_DOOR_TYPES?.NONE ?? 0,
    doorOpen: C?.WALL_DOOR_STATES?.OPEN ?? 1
  };
}
