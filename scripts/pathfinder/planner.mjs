/* planner.mjs - turn a drag into an ordered polyline, the way play.html did.
 *
 * One call answers the question a token drag asks: can the disc go straight,
 * and if not, how does it get there? The web page's goal snapping, scoring and
 * logging are deliberately gone; the route, the collision stop and the
 * movement-budget split are kept.
 */

import { polyline, clipPath, pointAt } from "./geometry.mjs";

/**
 * @typedef {object} PlanOptions
 * @property {import("./maze.mjs").Maze} maze   collision geometry
 * @property {{x:number,y:number}} from         disc centre at the start
 * @property {{x:number,y:number}} to           requested disc centre
 * @property {number} radius                    disc radius in px
 * @property {{x:number,y:number}[]} [waypoints] intermediate centres to visit before `to`
 * @property {number} [budgetPx]                furthest the disc may travel this move (Infinity: no limit)
 * @property {number} [cell]                    A* grid cell size in px
 * @property {number} [pad]                     extra clearance kept by the route, px
 * @property {number} [maxNodes]                A* node cap
 */

/**
 * Plan a move.
 *
 * Returns
 *   clear       the requested move was unobstructed all the way
 *   routed      A* was needed (and found a route)
 *   reached     the move ends on the requested target (a budget cut means it does not)
 *   points      [x,y] centres from the start to the stop point
 *   stop        centre where the move ends (budget-limited or blocked)
 *   length      total planned polyline length, px
 *   travel      length the disc may actually cover this move, px
 *   cut         travel < length (a movement budget clipped the path)
 *   near/far    the polyline split at `travel`; far is null when nothing is cut
 *   collision   null | { segment, at:[x,y], center:[x,y], inside:boolean }
 *   ms          time spent in A*, ms
 */
export function planPath(options) {
  const { maze, from, radius } = options;
  const anchors = (options.waypoints && options.waypoints.length
    ? options.waypoints
    : [options.to]).map(p => [p.x, p.y]);
  const budgetPx = options.budgetPx === undefined ? Infinity : options.budgetPx;
  const searchOpts = {
    cell: options.cell,
    pad: options.pad,
    maxNodes: options.maxNodes
  };
  const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

  const points = [[from.x, from.y]];
  let routed = false;
  let blocked = false;
  let collision = null;
  let ms = 0;

  for (let i = 0; i < anchors.length; i++) {
    const a = points[points.length - 1];
    const b = anchors[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) continue;

    const straight = maze.checkMove(a[0], a[1], b[0], b[1], radius);
    if (straight.clear) {
      points.push(b);
      continue;
    }

    const t0 = now();
    const waypoints = maze.findPath(a[0], a[1], b[0], b[1], radius, searchOpts);
    ms += now() - t0;

    if (waypoints && waypoints.length) {
      routed = true;
      for (const p of waypoints) pushDistinct(points, p);
      continue;
    }

    // No route at all: the straight move, stopped where it touches a wall.
    blocked = true;
    collision = straight.collision;
    pushDistinct(points, straight.stop);
    break;
  }

  const line = polyline(points);
  const travel = Math.min(line.length, Math.max(0, budgetPx));
  const split = clipPath(line.points, line.cum, travel);
  const stop = pointAt(line.points, line.cum, travel);
  const target = anchors[anchors.length - 1];

  return {
    clear: !blocked && !routed,
    routed,
    reached: !blocked && Math.hypot(stop[0] - target[0], stop[1] - target[1]) < 0.5,
    points: line.points,
    cum: line.cum,
    length: line.length,
    travel,
    cut: travel < line.length - 1e-9,
    stop,
    near: split.near,
    far: split.far,
    collision,
    ms,
    from: [from.x, from.y],
    to: [options.to.x, options.to.y],
    radius
  };
}

/** Append a point unless it repeats the last one. */
function pushDistinct(points, p) {
  const last = points[points.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.01) return;
  points.push([p[0], p[1]]);
}
