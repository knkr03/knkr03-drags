/* Entry-point checks: settings registration runs at init, the API is attached
 * at ready, and a missing Token class fails soft instead of breaking the game. */

import test from "node:test";
import assert from "node:assert/strict";

const onceHandlers = new Map();
const registrations = [];
const keyRegistrations = [];
const apiHolder = {};

globalThis.CONST = {
  KEYBINDING_PRECEDENCE: { NORMAL: 0, DEFERRED: 1, PRIORITY: 2 }
};

globalThis.Hooks = {
  once: (name, fn) => onceHandlers.set(name, fn),
  on: () => {}
};

globalThis.game = {
  user: { isGM: true },
  settings: {
    register: (moduleId, key, data) => registrations.push({ moduleId, key, ...data }),
    get: () => undefined
  },
  modules: {
    get: () => ({
      set api(value) { apiHolder.api = value; },
      get api() { return apiHolder.api; }
    })
  },
  keyboard: { downKeys: new Set() },
  keybindings: {
    register: (namespace, action, data) => keyRegistrations.push({ namespace, action, ...data }),
    get: () => [{ key: "ShiftLeft" }]
  }
};

globalThis.canvas = {};
globalThis.CONFIG = {};
globalThis.foundry = { utils: { getProperty: () => undefined } };

await import("../scripts/main.mjs");
const { MODULE_ID, SETTINGS } = await import("../scripts/const.mjs");

test("init registers every setting with a label, hint, scope and default", () => {
  onceHandlers.get("init")();
  assert.equal(registrations.length, Object.keys(SETTINGS).length);
  for (const entry of registrations) {
    assert.equal(entry.moduleId, MODULE_ID);
    assert.ok(entry.name.startsWith("KDRAGS.settings."), entry.key);
    assert.ok(entry.hint.startsWith("KDRAGS.settings."), entry.key);
    assert.equal(entry.scope, "client");
    assert.equal(entry.config, true);
    assert.ok("default" in entry, entry.key);
    assert.ok([Boolean, Number, String].includes(entry.type), entry.key);
  }
  const keys = registrations.map(entry => entry.key).sort();
  assert.deepEqual(keys, Object.values(SETTINGS).sort());
});

test("init registers the bypass keybinding with left Shift as its default", () => {
  assert.equal(keyRegistrations.length, 1);
  const binding = keyRegistrations[0];
  assert.equal(binding.namespace, MODULE_ID);
  assert.equal(binding.action, "bypassPathfinding");
  assert.equal(binding.name, "KDRAGS.keybindings.bypass.name");
  assert.equal(binding.hint, "KDRAGS.keybindings.bypass.hint");
  assert.deepEqual(binding.editable, [{ key: "ShiftLeft" }]);
  assert.equal(typeof binding.onDown, "function");
  assert.equal(typeof binding.onUp, "function");
});

test("every localization key used by the module exists in lang/en.json", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lang = JSON.parse(fs.readFileSync(path.join(here, "..", "lang", "en.json"), "utf8"));
  for (const entry of registrations) {
    assert.ok(lang[entry.name], `missing ${entry.name}`);
    assert.ok(lang[entry.hint], `missing ${entry.hint}`);
  }
  assert.ok(lang["KDRAGS.keybindings.bypass.name"]);
  assert.ok(lang["KDRAGS.keybindings.bypass.hint"]);
});

test("ready attaches the module API and survives a missing Token class", () => {
  assert.ok(onceHandlers.has("ready"));
  onceHandlers.get("ready")();
  assert.ok(apiHolder.api, "module api was not attached");
  assert.equal(apiHolder.api.id, MODULE_ID);
  for (const name of ["planForToken", "state", "install"]) {
    assert.equal(typeof apiHolder.api[name], "function", name);
  }
});
