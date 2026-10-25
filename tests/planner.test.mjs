/* The planner is play.html's planMove with the page removed: same route
 * decisions, same budget split, same stop point. */

import test from "node:test";
import assert from "node:assert/strict";
import { Maze, planPath } from "../scripts/pathfinder/index.mjs";

const wall = new Maze({
  width: 400,
  height: 240,
  radius: 10,
  segments: [[200, 0, 200, 160]]
});

const arena = {
  maze: wall,
  from: { x: 80, y: 120 },
  to: { x: 320, y: 120 },
  radius: 10,
  cell: 8,
  pad: 3
};

test("a clear straight move stays a two-point line", () => {
  const plan = planPath({ ...arena, from: { x: 60, y: 40 }, to: { x: 140, y: 40 } });
  assert.equal(plan.clear, true);
  assert.equal(plan.routed, false);
  assert.equal(plan.reached, true);
  assert.deepEqual(plan.points, [[60, 40], [140, 40]]);
  assert.equal(plan.length, 80);
  assert.equal(plan.cut, false);
  assert.equal(plan.far, null);
  assert.equal(plan.collision, null);
});

test("a blocked move is routed around the wall and ends on the target", () => {
  const plan = planPath(arena);
  assert.equal(plan.clear, false);
  assert.equal(plan.routed, true);
  assert.equal(plan.reached, true);
  assert.ok(plan.points.length > 2);
  assert.equal(plan.far, null);
  assert.equal(plan.cut, false);
  assert.ok(plan.length > 240);

  const points = plan.points;
  for (let i = 1; i < points.length; i++) {
    assert.ok(wall.checkMove(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 10).clear);
  }
});

test("a movement budget clips the route and reports both halves", () => {
  const budgetPx = 100;
  const plan = planPath({ ...arena, budgetPx });

  assert.equal(plan.cut, true);
  assert.ok(Math.abs(plan.travel - budgetPx) < 1e-6);
  assert.equal(plan.reached, false);
  assert.ok(plan.far && plan.far.length >= 2);

  const nearLength = plan.near.reduce((total, point, index) => {
    if (index === 0) return 0;
    const previous = plan.near[index - 1];
    return total + Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  }, 0);
  assert.ok(Math.abs(nearLength - budgetPx) < 1e-6, `near length ${nearLength}`);

  const stopDistance = Math.hypot(plan.stop[0] - 80, plan.stop[1] - 120);
  assert.ok(Math.abs(stopDistance - budgetPx) < 1e-6);
  assert.deepEqual(plan.far[0], plan.stop);
});

test("a zero budget keeps the token where it is", () => {
  const plan = planPath({ ...arena, budgetPx: 0 });
  assert.equal(plan.travel, 0);
  assert.equal(plan.cut, true);
  assert.deepEqual(plan.stop, [80, 120]);
  assert.deepEqual(plan.near, [[80, 120]]);
  assert.ok(plan.far);
});

test("a wall across the whole map gives no route and a contact stop", () => {
  const closed = new Maze({
    width: 400,
    height: 240,
    radius: 10,
    segments: [[200, 0, 200, 240]]
  });
  const plan = planPath({ ...arena, maze: closed });

  assert.equal(plan.clear, false);
  assert.equal(plan.routed, false);
  assert.equal(plan.reached, false);
  assert.ok(plan.collision);
  assert.equal(plan.collision.inside, false);
  const [x] = plan.stop;
  assert.ok(x < 200 && x > 180, `stop x ${x}`);
});

test("an unreachable target still yields a clear partial route", () => {
  const plan = planPath({
    ...arena,
    to: { x: 200, y: 100 }
  });
  assert.equal(plan.clear, false);
  assert.equal(plan.reached, false);
  if (plan.routed) {
    const end = plan.points[plan.points.length - 1];
    assert.ok(wall.clearance(end[0], end[1]).distance >= 10);
  }
});

test("intermediate waypoints are visited in order", () => {
  const plan = planPath({
    ...arena,
    to: { x: 320, y: 120 },
    waypoints: [{ x: 80, y: 200 }, { x: 320, y: 200 }]
  });
  assert.equal(plan.reached, true);
  const hasFirst = plan.points.some(p => Math.hypot(p[0] - 80, p[1] - 200) < 25);
  const hasSecond = plan.points.some(p => Math.hypot(p[0] - 320, p[1] - 200) < 25);
  assert.ok(hasFirst && hasSecond, "route skipped an intermediate waypoint");
});

test("a zero-length move is a single-point plan", () => {
  const plan = planPath({ ...arena, to: { x: 80, y: 120 } });
  assert.equal(plan.length, 0);
  assert.equal(plan.reached, true);
  assert.equal(plan.points.length, 1);
});
