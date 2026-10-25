/* The budget rule the user asked for: actor movement rate minus recorded
 * movement history, doubled when the rate is already spent. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedMovement,
  combatClamp,
  combatClampTotal,
  movementBudget,
  resolveMovementRate,
  sliverTolerance,
  unitsToPixels
} from "../scripts/pathfinder/index.mjs";

const grid = { size: 100, distance: 5, units: "ft" };

test("common actor movement paths are detected", () => {
  const dnd5e = { system: { attributes: { movement: { walk: 30 } } } };
  assert.deepEqual(resolveMovementRate(dnd5e), {
    value: 30,
    path: "system.attributes.movement.walk",
    source: "system"
  });

  const pf2e = { system: { attributes: { speed: { total: 25 } } } };
  assert.equal(resolveMovementRate(pf2e).value, 25);

  const nested = { system: { attributes: { movement: { walk: { value: 40 } } } } };
  assert.equal(resolveMovementRate(nested).value, 40);

  const numeric = { system: { attributes: { movement: 35 } } };
  assert.equal(resolveMovementRate(numeric).value, 35);
});

test("an explicit attribute path wins and is the only one tried", () => {
  const actor = { system: { attributes: { movement: { walk: 30 } } }, system2: { speed: 12 } };
  const result = resolveMovementRate(actor, { attribute: "system2.speed" });
  assert.equal(result.value, 12);
  assert.equal(result.source, "attribute");

  assert.equal(resolveMovementRate(actor, { attribute: "system.missing.value" }), null);
});

test("actors without a movement rate and empty actors resolve to null", () => {
  assert.equal(resolveMovementRate(null), null);
  assert.equal(resolveMovementRate({}), null);
  assert.equal(resolveMovementRate({ system: { attributes: {} } }), null);
});

test("remaining movement is the rate minus what history recorded", () => {
  assert.equal(allowedMovement(30, 0), 30);
  assert.equal(allowedMovement(30, 10), 20);
  assert.equal(allowedMovement(30, 29.5), 0.5);
});

test("a spent rate allows twice the rate on the next drag", () => {
  assert.equal(allowedMovement(30, 30), 60);
  assert.equal(allowedMovement(30, 55), 60);
});

test("no rate or a non-positive rate means unlimited movement", () => {
  assert.equal(allowedMovement(Infinity, 12), Infinity);
  assert.equal(allowedMovement(0, 12), Infinity);
  assert.equal(allowedMovement(null, 12), Infinity);
});

test("scene units convert to pixels through the grid", () => {
  assert.equal(unitsToPixels(30, grid), 600);
  assert.equal(unitsToPixels(6, { size: 64, distance: 1 }), 384);
  assert.equal(unitsToPixels(10, { size: 100, distance: 0 }), 10);
  assert.equal(unitsToPixels(Infinity, grid), Infinity);
});

test("movementBudget turns rate and history into a pixel budget", () => {
  const fresh = movementBudget({ rate: 30, used: 0, grid });
  assert.equal(fresh.limited, true);
  assert.equal(fresh.budgetPx, 600);
  assert.equal(fresh.allowed, 30);

  const partly = movementBudget({ rate: 30, used: 20, grid });
  assert.equal(partly.budgetPx, 200);

  const spent = movementBudget({ rate: 30, used: 30, grid });
  assert.equal(spent.budgetPx, 1200);

  const unmeasured = movementBudget({ rate: 30, usedInfinite: true, grid });
  assert.equal(unmeasured.budgetPx, 1200);
});

test("budget falls back to grid spaces when the actor rate is unknown", () => {
  const fallback = movementBudget({ rate: null, grid, fallbackSpaces: 6 });
  assert.equal(fallback.limited, true);
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.units, 30);
  assert.equal(fallback.budgetPx, 600);

  const unlimited = movementBudget({ rate: null, grid, fallbackSpaces: 0 });
  assert.equal(unlimited.limited, false);
  assert.equal(unlimited.budgetPx, Infinity);
});

test("the budget can be disabled outright", () => {
  const budget = movementBudget({ rate: 30, used: 10, grid, unlimited: true });
  assert.equal(budget.budgetPx, Infinity);
  assert.equal(budget.limited, false);
});

test("the combat clamp extends by one base rate each time it is used up", () => {
  assert.equal(combatClamp(30, 0), 30);
  assert.equal(combatClampTotal(30, 0), 30);

  // all 30 spent: the clamp moves to 60, another 30 becomes available
  assert.equal(combatClamp(30, 30), 30);
  assert.equal(combatClampTotal(30, 30), 60);

  // partway through the second clamp
  assert.equal(combatClamp(30, 45), 15);
  assert.equal(combatClampTotal(30, 45), 60);
  assert.ok(Math.abs(combatClamp(30, 59.9) - 0.1) < 1e-9);

  // second clamp also spent: the rest of the turn is unlimited
  assert.equal(combatClamp(30, 60), Infinity);
  assert.equal(combatClampTotal(30, 60), Infinity);
  assert.equal(combatClamp(30, 95), Infinity);
  assert.equal(combatClampTotal(30, 95), Infinity);

  assert.equal(combatClamp(Infinity, 10), Infinity);
});

test("the combat clamp is released once the second clamp is spent", () => {
  // 59.9 is still inside the second clamp
  assert.ok(Math.abs(combatClamp(30, 59.9) - 0.1) < 1e-9);
  assert.equal(combatClampTotal(30, 59.9), 60);

  // a token nudged a hair past the clamp is released too
  assert.equal(combatClamp(30, 60.2), Infinity);
  assert.equal(combatClampTotal(30, 60.2), Infinity);
});

test("in combat the budget uses the extending clamp instead of the doubling rule", () => {
  const fresh = movementBudget({ rate: 30, used: 0, grid, combat: true });
  assert.equal(fresh.mode, "combat");
  assert.equal(fresh.clampTotal, 30);
  assert.equal(fresh.allowed, 30);
  assert.equal(fresh.budgetPx, 600);

  const spent = movementBudget({ rate: 30, used: 30, grid, combat: true });
  assert.equal(spent.mode, "combat");
  assert.equal(spent.clampTotal, 60);
  assert.equal(spent.allowed, 30, "a second base-length move, not a doubled one");
  assert.equal(spent.budgetPx, 600);

  const outside = movementBudget({ rate: 30, used: 30, grid });
  assert.equal(outside.mode, "standard");
  assert.equal(outside.budgetPx, 1200, "outside combat the doubling rule is unchanged");
});

test("a leftover smaller than a couple of pixels counts as spent", () => {
  // 5 ft / 100 px grid: two pixels is 0.1 ft
  const tolerance = sliverTolerance(grid);
  assert.ok(Math.abs(tolerance - 0.1) < 1e-9);
  assert.equal(sliverTolerance({ size: 100, distance: 0 }), 0);
  assert.equal(sliverTolerance(null), 0);

  // a drag that stopped on the clamp records a hair under it, because Foundry
  // measures between the integer waypoints it was given
  assert.equal(allowedMovement(30, 29.9914, tolerance), 60);
  assert.equal(combatClamp(30, 29.9914, tolerance), 30.0086);
  assert.equal(combatClampTotal(30, 29.9914, tolerance), 60);

  // the release at the second clamp is boundary-tolerant too
  assert.equal(combatClamp(30, 59.99, tolerance), Infinity);
  assert.equal(combatClampTotal(30, 59.99, tolerance), Infinity);

  // a leftover worth moving (half a foot) is still offered
  assert.equal(combatClamp(30, 29.5, tolerance), 0.5);
  assert.equal(allowedMovement(30, 29.5, tolerance), 0.5);
});

test("the budget treats a sub-pixel leftover as spent", () => {
  const combat = movementBudget({ rate: 30, used: 29.9914, grid, combat: true });
  assert.equal(combat.allowed, 30.0086);
  assert.equal(combat.clampTotal, 60);
  assert.ok(Math.abs(combat.budgetPx - 600.17) < 0.1);

  const standard = movementBudget({ rate: 30, used: 29.9914, grid });
  assert.equal(standard.allowed, 60, "outside combat the rate counts as spent");

  const fallback = movementBudget({ rate: null, used: 29.9914, grid, fallbackSpaces: 6 });
  assert.equal(fallback.allowed, 60);
});

test("in combat the third drag is unlimited", () => {
  const released = movementBudget({ rate: 30, used: 60, grid, combat: true });
  assert.equal(released.mode, "combat");
  assert.equal(released.limited, false);
  assert.equal(released.budgetPx, Infinity);
  assert.equal(released.allowed, Infinity);
  assert.equal(released.clampTotal, Infinity);
});

test("the combat clamp also extends the fallback rate", () => {
  const budget = movementBudget({ rate: null, used: 30, grid, fallbackSpaces: 6, combat: true });
  assert.equal(budget.fallback, true);
  assert.equal(budget.allowed, 30);
  assert.equal(budget.budgetPx, 600);
  assert.equal(budget.clampTotal, 60);
});
