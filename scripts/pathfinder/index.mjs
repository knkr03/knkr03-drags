/* index.mjs - public surface of the pathfinding system.
 *
 * The bridge (or any other caller) hands this module plain geometry and gets a
 * plain plan back; nothing here knows about Foundry or the DOM.
 */

export { Maze, CONTACT_SKIN } from "./maze.mjs";
export { planPath } from "./planner.mjs";
export {
  RATE_PATHS,
  getPath,
  resolveMovementRate,
  allowedMovement,
  combatClamp,
  combatClampTotal,
  unitsToPixels,
  movementBudget
} from "./budget.mjs";
export {
  closestOnSegment,
  segmentLength,
  pointAt,
  polyline,
  clipPath
} from "./geometry.mjs";
