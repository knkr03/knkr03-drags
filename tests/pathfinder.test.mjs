/* Ported from the app's test_core.js: the collision and A* behaviour must be
 * unchanged by the conversion. Run: node --test tests/ */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Maze, closestOnSegment } from "../scripts/pathfinder/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "maze.map"), "utf8"));
const maze = new Maze(map);
const r = maze.radius;

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function legsClear(target, points, radius) {
  for (let i = 1; i < points.length; i++) {
    if (!target.checkMove(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], radius).clear) {
      return false;
    }
  }
  return true;
}

test("map fixture loads with the expected geometry", () => {
  assert.equal(maze.segments.length, 18);
  assert.equal(r, 28.5);
  assert.equal(maze.width, 1332);
  assert.equal(maze.height, 926);
});

test("open-space moves are clear", () => {
  const [x, y] = map.objects[0];
  const move = maze.checkMove(x, y, x, 620);
  assert.equal(move.clear, true);
  assert.ok(near(move.travelled, move.distance, 1e-9));
  assert.ok(near(move.stop[1], 620, 1e-9));
  assert.ok(move.minGap > 0);
});

test("a move into a wall stops exactly at contact", () => {
  const o = map.objects[0];
  const g = map.goals[0];
  const hit = maze.checkMove(o[0], o[1], g[0], g[1]);

  assert.equal(hit.clear, false);
  assert.ok(hit.t > 0.5 && hit.t < 1, `t=${hit.t}`);

  const wall = maze.segments[hit.collision.segment];
  assert.ok(near(closestOnSegment(hit.collision.at[0], hit.collision.at[1], wall).distance, 0, 1e-6));
  assert.ok(near(Math.hypot(hit.stop[0] - hit.collision.at[0], hit.stop[1] - hit.collision.at[1]), r, 1e-3));
  assert.ok(hit.stop[1] > g[1] && hit.stop[1] < o[1]);
  assert.ok(near(hit.travelled, hit.distance * hit.t, 1e-6));

  const again = maze.checkMove(hit.stop[0], hit.stop[1], g[0], g[1]);
  assert.equal(again.clear, false);
  assert.ok(again.travelled < 0.2, `travelled ${again.travelled}`);
});

test("a disc resting against a wall can back away, slide and leave at an angle", () => {
  const o = map.objects[0];
  const g = map.goals[0];
  const hit = maze.checkMove(o[0], o[1], g[0], g[1]);
  const stop = hit.stop;

  assert.ok(near(maze.clearance(stop[0], stop[1]).distance, r, 1e-6));

  const away = maze.checkMove(stop[0], stop[1], o[0], o[1]);
  assert.equal(away.clear, true);
  assert.ok(near(away.travelled, away.distance, 1e-9));

  const w = maze.segments[hit.collision.segment];
  const length = Math.hypot(w[2] - w[0], w[3] - w[1]);
  const slide = maze.checkMove(
    stop[0], stop[1],
    stop[0] + ((w[2] - w[0]) / length) * 15,
    stop[1] + ((w[3] - w[1]) / length) * 15
  );
  assert.equal(slide.clear, true);
  assert.ok(near(slide.travelled, 15, 1e-6));

  const diag = maze.checkMove(stop[0], stop[1], stop[0] + 15, stop[1] + 15);
  assert.equal(diag.clear, true);
  assert.ok(near(diag.travelled, diag.distance, 1e-9));
});

test("starting inside a wall is reported as stuck", () => {
  const move = maze.checkMove(138.5, 470, 400, 470);
  assert.equal(move.clear, false);
  assert.equal(move.collision.inside, true);
  assert.equal(move.travelled, 0);
});

test("zero-length moves are clear in free space", () => {
  const move = maze.checkMove(193.7, 739.7, 193.7, 739.7);
  assert.equal(move.clear, true);
  assert.equal(move.distance, 0);
});

test("grazing inside the clearance limit collides, 2 px outside does not", () => {
  const wallY = 519;
  const tooClose = maze.checkMove(250, wallY - r - 0.4, 350, wallY - r - 0.4, r);
  assert.equal(tooClose.clear, false);

  const clear = maze.checkMove(280, wallY - r - 2, 320, wallY - r - 2, r);
  assert.equal(clear.clear, true);
  assert.ok(clear.minGap > 0);
});

test("radius changes the collision result", () => {
  const y = 519 - r - 6;
  const small = maze.checkMove(250, y, 350, y, 10);
  const big = maze.checkMove(250, y, 350, y, r + 12);
  assert.equal(small.clear, true);
  assert.equal(big.clear, false);
});

test("minGap is the closest approach and matches the distance field", () => {
  const move = maze.checkMove(193.7, 739.7, 193.7, 620);
  const startGap = maze.clearance(193.7, 739.7).distance - r;
  assert.ok(move.minGap <= startGap + 1e-9);
  const field = maze.clearance(move.minGapAt[0], move.minGapAt[1]).distance - r;
  assert.ok(near(field, move.minGap, 1e-6));
});

test("a move that ends inside a wall reports a hit", () => {
  const move = maze.checkMove(700, 700, 616, 470);
  assert.equal(move.clear, false);
  assert.ok(move.travelled < move.distance);
});

test("A* reaches every object/goal pair with clear legs", () => {
  let found = 0;
  let waypoints = 0;
  let worst = 0;
  for (const o of map.objects) {
    for (const g of map.goals) {
      const t0 = performance.now();
      const foundPath = maze.findPath(o[0], o[1], g[0], g[1], r);
      worst = Math.max(worst, performance.now() - t0);
      assert.ok(foundPath, `no route from ${o} to ${g}`);
      found += 1;
      waypoints += foundPath.length;

      const points = [[o[0], o[1]], ...foundPath];
      assert.ok(legsClear(maze, points, r), "a leg is not collision-free");
      const end = points[points.length - 1];
      assert.ok(Math.hypot(end[0] - g[0], end[1] - g[1]) <= 0.5, "route does not end on the goal");
      assert.ok(foundPath.length <= 25, "route was not smoothed");
    }
  }
  assert.equal(found, 10);
  assert.ok(waypoints / found < 10, `average ${waypoints / found} waypoints`);
  assert.ok(worst < 250, `worst planning time ${worst.toFixed(1)} ms`);
});

test("A* routes around a wall, through a gap, and not through a solid wall", () => {
  const open = new Maze({
    width: 400, height: 240, radius: 10,
    segments: [[200, 0, 200, 160]]
  });
  const route = open.findPath(80, 120, 320, 120, 10);
  assert.ok(route);
  const points = [[80, 120], ...route];
  assert.ok(legsClear(open, points, 10));
  assert.ok(Math.max(...points.map(p => p[1])) > 160, "route does not pass through the gap");
  const end = points[points.length - 1];
  assert.ok(Math.hypot(end[0] - 320, end[1] - 120) < 0.5);

  const closed = new Maze({
    width: 400, height: 240, radius: 10,
    segments: [[200, 0, 200, 240]]
  });
  assert.equal(closed.findPath(80, 120, 320, 120, 10), null);

  const slot = new Maze({
    width: 400, height: 240, radius: 10,
    segments: [[200, 0, 200, 160], [200, 200, 200, 240]]
  });
  assert.ok(slot.findPath(80, 120, 320, 120, 10));
  assert.equal(slot.findPath(80, 120, 320, 120, 45), null);
});

test("a target inside a wall yields a route that stops clear of it", () => {
  const open = new Maze({
    width: 400, height: 240, radius: 10,
    segments: [[200, 0, 200, 160]]
  });
  const route = open.findPath(80, 120, 200, 100, 10);
  assert.ok(route);
  const points = [[80, 120], ...route];
  assert.ok(legsClear(open, points, 10));
  const end = points[points.length - 1];
  assert.ok(open.clearance(end[0], end[1]).distance >= 10);
});
