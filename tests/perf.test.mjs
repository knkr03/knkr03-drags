/* Foundry scenes can carry hundreds of walls. Planning runs inside the drag
 * handler, so keep an eye on the cost of a wall-heavy scene. */

import test from "node:test";
import assert from "node:assert/strict";
import { Maze, planPath } from "../scripts/pathfinder/index.mjs";

function wallHeavyScene(count = 400) {
  const segments = [];
  let seed = 1234567;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  while (segments.length < count) {
    const x = 40 + Math.floor(random() * 920);
    const y = 40 + Math.floor(random() * 920);
    const horizontal = random() < 0.5;
    const length = 30 + Math.floor(random() * 110);
    const segment = horizontal
      ? [x, y, Math.min(999, x + length), y]
      : [x, y, x, Math.min(999, y + length)];
    // keep the endpoints clear so the test always has a route
    if (Math.hypot(segment[0] - 50, segment[1] - 50) < 60) continue;
    if (Math.hypot(segment[0] - 950, segment[1] - 950) < 60) continue;
    segments.push(segment);
  }
  return new Maze({ segments, width: 1000, height: 1000, radius: 20 });
}

test("planning stays usable on a scene with hundreds of walls", t => {
  const maze = wallHeavyScene();
  assert.ok(maze.segments.length >= 380);

  const start = performance.now();
  const plan = planPath({
    maze,
    from: { x: 50, y: 50 },
    to: { x: 950, y: 950 },
    radius: 20,
    cell: 8,
    pad: 3
  });
  const elapsed = performance.now() - start;

  t.diagnostic(`${maze.segments.length} walls, ${plan.points.length} points, ${elapsed.toFixed(1)} ms`);
  assert.ok(plan.points.length >= 2);
  if (plan.routed) {
    for (let i = 1; i < plan.points.length; i++) {
      const [ax, ay] = plan.points[i - 1];
      const [bx, by] = plan.points[i];
      assert.ok(maze.checkMove(ax, ay, bx, by, 20).clear, "route leg is not clear");
    }
  }
  assert.ok(elapsed < 2000, `planning took ${elapsed.toFixed(1)} ms`);
});
