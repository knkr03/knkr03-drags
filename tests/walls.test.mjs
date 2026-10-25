/* Only walls that block movement may enter the pathfinder. */

import test from "node:test";
import assert from "node:assert/strict";
import { wallSegments } from "../scripts/bridge/walls.mjs";

const constants = { moveNone: 0, doorNone: 0, doorOpen: 1 };

const wall = (c, extra = {}) => ({ c, move: 1, door: 0, ds: 0, ...extra });

test("normal walls become segments", () => {
  const segments = wallSegments([
    wall([0, 0, 100, 0]),
    wall([100, 0, 100, 100])
  ], constants);
  assert.deepEqual(segments, [[0, 0, 100, 0], [100, 0, 100, 100]]);
});

test("walls whose movement restriction is none do not block", () => {
  const segments = wallSegments([
    wall([0, 0, 100, 0], { move: 0 }),
    wall([0, 10, 100, 10])
  ], constants);
  assert.deepEqual(segments, [[0, 10, 100, 10]]);
});

test("closed and locked doors block, open doors do not", () => {
  const segments = wallSegments([
    wall([0, 0, 10, 0], { door: 1, ds: 0 }),   // closed
    wall([0, 10, 10, 10], { door: 1, ds: 2 }), // locked
    wall([0, 20, 10, 20], { door: 1, ds: 1 }), // open
    wall([0, 30, 10, 30], { door: 0, ds: 1 })  // not a door: state is irrelevant
  ], constants);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map(s => s[1]), [0, 10, 30]);
});

test("secret doors behave like doors", () => {
  const segments = wallSegments([
    wall([0, 0, 10, 0], { door: 2, ds: 1 }),
    wall([0, 10, 10, 10], { door: 2, ds: 0 })
  ], constants);
  assert.deepEqual(segments, [[0, 10, 10, 10]]);
});

test("degenerate and malformed walls are skipped", () => {
  const segments = wallSegments([
    wall([5, 5, 5, 5]),                 // zero length
    { c: [0, 0, 10] },                  // too few coordinates
    { c: ["a", 0, 10, 10] },            // non-numeric
    null,
    wall([0, 0, 20, 20])
  ], constants);
  assert.deepEqual(segments, [[0, 0, 20, 20]]);
});

test("the placeable coords alias is accepted", () => {
  const segments = wallSegments([{ coords: [1, 2, 3, 4], move: 1, door: 0, ds: 0 }], constants);
  assert.deepEqual(segments, [[1, 2, 3, 4]]);
});
