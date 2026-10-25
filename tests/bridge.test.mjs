/* The bridge wraps Foundry's drag pipeline. Foundry itself isn't available in
 * Node, so this file recreates the small part of it the bridge touches:
 * Token#findMovementPath / _onDragLeftMove / _prepareDragLeftDropUpdates /
 * _finalizeDragLeft, the drag context, the canvas, grid and settings.
 *
 * It verifies the data actually crossing the bridge: the waypoints returned to
 * Foundry, the preview position, the committed path and cleanup. */

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

/* ------------------------------------------------------- fake Foundry */

const GRID = { size: 100, distance: 5, units: "ft" };

const settings = {
  enabled: true,
  enforceBudget: true,
  movementAttribute: "",
  fallbackSpeed: 6,
  footprintScale: 1,
  gridCell: 8,
  clearancePad: 3,
  drawBeyondBudget: true,
  debug: false
};

globalThis.game = {
  user: { isGM: true },
  settings: {
    get: (_module, key) => settings[key],
    register: () => {}
  },
  modules: { get: () => undefined },
  combat: null,
  keyboard: { downKeys: new Set() },
  keybindings: { get: () => [{ key: "ShiftLeft" }] }
};

globalThis.CONST = {
  WALL_MOVEMENT_TYPES: { NONE: 0, NORMAL: 1 },
  WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
  WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
};

globalThis.Hooks = { on: () => {}, once: () => {} };

globalThis.PIXI = {
  LINE_JOIN: { ROUND: 1 },
  LINE_CAP: { ROUND: 1 },
  Graphics: class {
    constructor() {
      this.parent = null;
      this.destroyed = false;
      this.ops = [];
    }
    clear() { this.ops = []; }
    lineStyle(style) { this.ops.push(["lineStyle", style]); }
    moveTo(x, y) { this.ops.push(["moveTo", x, y]); }
    lineTo(x, y) { this.ops.push(["lineTo", x, y]); }
    beginFill(color, alpha) { this.ops.push(["beginFill", color, alpha]); }
    endFill() { this.ops.push(["endFill"]); }
    drawCircle(x, y, r) { this.ops.push(["drawCircle", x, y, r]); }
    destroy() { this.destroyed = true; }
  }
};

const walls = {
  contents: [
    // vertical wall with a gap at the bottom
    { c: [200, 0, 200, 160], move: 1, door: 0, ds: 0 }
  ]
};

globalThis.canvas = {
  scene: { id: "scene-1", width: 400, height: 240, walls, regions: { map: () => [] } },
  grid: { ...GRID, isSquare: true, isGridless: false },
  dimensions: { ...GRID, width: 400, height: 240 },
  mousePosition: { x: 320, y: 120 },
  interface: {
    addChild(child) { child.parent = this; return child; },
    removeChild(child) { child.parent = null; }
  },
  tokens: { _draggedToken: null, placeables: [] },
  walls: { placeables: [] }
};

/* --------------------------------------------------------- fake token */

class FakeToken {
  constructor({ id = "token-1", x = 30, y = 70, usedCost = 0 } = {}) {
    this.layer = globalThis.canvas.tokens;
    this.ruler = {};
    this.calls = [];
    this.document = {
      id,
      name: id,
      x,
      y,
      elevation: 0,
      width: 1,
      height: 1,
      shape: 1,
      movementAction: "walk",
      combatant: null,
      parent: { id: "scene-1" },
      actor: { system: { attributes: { movement: { walk: 30 } } } },
      movementHistory: usedCost > 0
        ? [{ x, y, elevation: 0, cost: usedCost, action: "walk", movementId: "m1", userId: "u1" }]
        : [],
      getCenterPoint(point) {
        const own = point ?? this;
        const width = (own.width ?? this.width) * GRID.size;
        const height = (own.height ?? this.height) * GRID.size;
        return {
          x: (own.x ?? this.x) + width / 2,
          y: (own.y ?? this.y) + height / 2,
          elevation: own.elevation ?? this.elevation
        };
      }
    };
  }

  _getDragMovementAction() {
    return "walk";
  }

  findMovementPath(waypoints, options) {
    this.calls.push({ method: "findMovementPath", waypoints, options });
    return { result: waypoints, promise: Promise.resolve(waypoints), cancel() {} };
  }

  _onDragLeftMove(event) {
    this.calls.push({ method: "_onDragLeftMove", event });
  }

  _prepareDragLeftDropUpdates(event) {
    this.calls.push({ method: "_prepareDragLeftDropUpdates", event });
    const id = this.document.id;
    return [[{ _id: id }], {
      movement: {
        [id]: { waypoints: [], method: "dragging", constrainOptions: { ignoreWalls: false, ignoreCost: false } },
        "other-token": { waypoints: [], method: "dragging", constrainOptions: { ignoreWalls: false } }
      }
    }];
  }

  _finalizeDragLeft(event) {
    this.calls.push({ method: "_finalizeDragLeft", event });
  }
}

globalThis.CONFIG = {
  Token: {
    objectClass: FakeToken,
    movement: { actions: { walk: { walls: "normal" }, teleport: {} } }
  }
};
globalThis.Token = FakeToken;
globalThis.foundry = { utils: { getProperty: () => undefined } };

/* ------------------------------------------------------------- helpers */

const { install, bridgeState } = await import("../scripts/bridge/drag.mjs");
const { invalidateGeometry } = await import("../scripts/bridge/foundry-data.mjs");

assert.equal(install(), true, "bridge did not install");
const { Maze } = await import("../scripts/pathfinder/index.mjs");
assert.ok(new Maze({ segments: [] }));

function waypoint(x, y, extra = {}) {
  return {
    x,
    y,
    elevation: 0,
    width: 1,
    height: 1,
    shape: 1,
    action: "walk",
    snapped: true,
    explicit: true,
    checkpoint: true,
    ...extra
  };
}

const activeDrags = [];
afterEach(() => {
  for (const { token, event } of activeDrags) token._finalizeDragLeft(event);
  activeDrags.length = 0;
});

function makeDrag(token, destination = waypoint(270, 70)) {
  const preview = { document: { x: destination.x, y: destination.y }, renderFlags: { set() {} } };
  const context = {
    token,
    clonedToken: preview,
    origin: waypoint(token.document.x, token.document.y),
    destination,
    waypoints: [],
    foundPath: [waypoint(token.document.x, token.document.y)],
    unreachableWaypoints: []
  };
  globalThis.canvas.tokens._draggedToken = {
    mouseInteractionManager: { interactionData: { contexts: { [token.document.id]: context } } }
  };
  const event = { interactionData: { contexts: { [token.document.id]: context } } };
  activeDrags.push({ token, event });
  return { context, preview, event };
}

/** Path length in pixels. */
function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/* --------------------------------------------------------------- tests */

test("findMovementPath answers with a routed, wall-clear path", () => {
  const token = new FakeToken();
  const { context } = makeDrag(token);
  const origin = waypoint(30, 70);
  const destination = waypoint(270, 70);

  const job = token.findMovementPath([origin, destination], { preview: true, history: true });
  assert.ok(Array.isArray(job.result), "a synchronous result keeps the ruler from waiting");
  const path = job.result;

  assert.ok(path.length > 2, `expected a detour, got ${path.length} waypoints`);
  assert.deepEqual(path[0], { ...origin, intermediate: false });
  assert.equal(path[path.length - 1].x, destination.x);
  assert.equal(path[path.length - 1].y, destination.y);

  // the route must pass below the wall, through the 80 px gap
  const lowest = Math.max(...path.map(p => p.y + 50));
  assert.ok(lowest > 160, `route did not use the gap (lowest centre y=${lowest})`);

  // a point on the straight line would be blocked, so the detour is real
  const maze = new Maze({ segments: [[200, 0, 200, 160]], width: 400, height: 240 });
  assert.equal(maze.checkMove(80, 120, 320, 120, 50).clear, false);

  assert.equal(context.foundPath.length, 1, "the bridge must not mutate the context itself");
});

test("the plan is budget-limited by rate and movement history", () => {
  const token = new FakeToken({ id: "token-budget", usedCost: 29.9 });
  makeDrag(token);
  const job = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  const path = job.result;

  // 0.1 ft remaining on a 5 ft / 100 px grid is 2 px of travel
  assert.equal(path.length, 2, "a 2 px budget should produce origin + stop");
  const travel = polylineLength(path);
  assert.ok(travel <= 3, `travel ${travel.toFixed(2)} px`);
  assert.notEqual(path[path.length - 1].x, 270);
});

test("a spent rate doubles the budget on the next drag", () => {
  const token = new FakeToken({ id: "token-spent", usedCost: 30 });
  makeDrag(token);
  const job = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  const path = job.result;

  // 60 ft = 1200 px, far more than the route around the wall: nothing is cut
  assert.equal(path[path.length - 1].x, 270);
  assert.equal(bridgeState().activePlans[0].cut, false);
});

test("the drag preview is parked on the point the token will reach", () => {
  const token = new FakeToken({ id: "token-preview", usedCost: 29.9 });
  const { context, preview, event } = makeDrag(token, waypoint(270, 70));

  token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  token._onDragLeftMove(event);

  assert.notEqual(preview.document.x, 270, "preview stayed on the unreachable drop point");
  const stop = bridgeState().activePlans[0];
  assert.equal(stop.cut, true);
  assert.ok(Math.hypot(preview.document.x - 30, preview.document.y - 70) < 5);
  assert.equal(context.foundPath.length, 1);
});

test("the committed drop keeps the validated route", () => {
  const token = new FakeToken({ id: "token-drop" });
  const { event } = makeDrag(token);
  token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });

  const result = token._prepareDragLeftDropUpdates(event);
  assert.equal(result[1].movement["token-drop"].constrainOptions.ignoreWalls, true);
  assert.equal(result[1].movement["other-token"].constrainOptions.ignoreWalls, false);
});

test("finalising the drag clears plans and the overlay", () => {
  const token = new FakeToken({ id: "token-final" });
  const { event } = makeDrag(token);
  token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.equal(bridgeState().activePlans.length, 1);

  token._finalizeDragLeft(event);
  assert.equal(bridgeState().activePlans.length, 0);
});

test("the bridge leaves Foundry alone when disabled or already unconstrained", () => {
  const token = new FakeToken({ id: "token-skip" });
  makeDrag(token);

  const unconstrained = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], {
    preview: true,
    ignoreWalls: true
  });
  assert.equal(unconstrained.result.length, 2, "ignoreWalls option should bypass the bridge");

  const notDragging = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], {});
  assert.equal(notDragging.result.length, 2, "non-preview calls should bypass the bridge");

  settings.enabled = false;
  const disabled = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.equal(disabled.result.length, 2);
  settings.enabled = true;
});

test("teleport-style movement actions are not routed", () => {
  const token = new FakeToken({ id: "token-teleport" });
  makeDrag(token);
  token._getDragMovementAction = () => "teleport";
  const job = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.equal(job.result.length, 2);
  delete token._getDragMovementAction;
  token._getDragMovementAction = () => "walk";
});

test("an empty wall layer falls back to Foundry's straight path", () => {
  const token = new FakeToken({ id: "token-empty" });
  makeDrag(token);
  walls.contents = [];
  invalidateGeometry();

  const job = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.equal(job.result.length, 2);

  walls.contents = [{ c: [200, 0, 200, 160], move: 1, door: 0, ds: 0 }];
  invalidateGeometry();
});

test("holding the bypass key returns a straight through-wall path", () => {
  const token = new FakeToken({ id: "token-bypass", usedCost: 30 });
  makeDrag(token);
  globalThis.game.keyboard.downKeys.add("ShiftLeft");

  const job = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  const path = job.result;
  assert.equal(path.length, 2, "bypass should not route around the wall");
  assert.equal(path[1].x, 270);
  assert.equal(path[1].y, 70);

  const state = bridgeState();
  assert.equal(state.bypass, true);
  assert.equal(state.activePlans[0].bypass, true);
  assert.equal(state.activePlans[0].budgetMode, "unlimited", "bypass ignores the clamp");

  const drop = token._prepareDragLeftDropUpdates({ interactionData: {} });
  const constrain = drop[1].movement["token-bypass"].constrainOptions;
  assert.equal(constrain.ignoreWalls, true);
  assert.equal(constrain.ignoreCost, true);

  // releasing the key must route the same drag again
  globalThis.game.keyboard.downKeys.delete("ShiftLeft");
  const routed = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.ok(routed.result.length > 2, "path was not routed after the key was released");
});

test("a running combat switches the budget to the extending clamp", () => {
  const token = new FakeToken({ id: "token-combat", usedCost: 30 });
  token.document.combatant = { id: "combatant-1" };
  globalThis.game.combat = { started: true };
  makeDrag(token);

  token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  const plan = bridgeState().activePlans[0];
  assert.equal(plan.budgetMode, "combat");
  assert.equal(plan.clampTotal, 60);
  assert.equal(plan.budgetPx, 600, "another base move, not the doubled standard budget");

  globalThis.game.combat = null;
});

test("every answer still chains into Foundry's own pathfinder", () => {
  // libWrapper unregisters -- and throws from -- a WRAPPER that returns
  // without calling through. FakeToken#findMovementPath records the chained
  // call, so this is the contract test for the real chain.
  const token = new FakeToken({ id: "token-chain" });
  makeDrag(token);

  const routed = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  assert.equal(
    token.calls.filter(call => call.method === "findMovementPath").length,
    1,
    "the routed answer must chain exactly once"
  );
  assert.ok(routed.result.length > 2, "the module's route should still be the result");

  token.calls.length = 0;
  globalThis.game.keyboard.downKeys.add("ShiftLeft");
  const bypass = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { preview: true });
  globalThis.game.keyboard.downKeys.delete("ShiftLeft");
  assert.equal(token.calls.filter(call => call.method === "findMovementPath").length, 1);
  assert.equal(bypass.result.length, 2);

  token.calls.length = 0;
  const skipped = token.findMovementPath([waypoint(30, 70), waypoint(270, 70)], { ignoreWalls: true });
  assert.equal(token.calls.filter(call => call.method === "findMovementPath").length, 1);
  assert.equal(skipped.result.length, 2, "an early-out returns Foundry's own job");

  token.calls.length = 0;
  const empty = token.findMovementPath([waypoint(30, 70)], { preview: true });
  assert.equal(token.calls.filter(call => call.method === "findMovementPath").length, 1);
  assert.equal(empty.result.length, 1);
});

test("bridge state reports the scene geometry", () => {
  const state = bridgeState();
  assert.equal(state.installed, true);
  assert.equal(state.scene, "scene-1");
  assert.equal(state.walls, 1);
  assert.deepEqual(state.bounds, { width: 400, height: 240 });
});
