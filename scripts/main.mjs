/* main.mjs - module entry point. */

import { MODULE_ID, MODULE_TITLE, SETTINGS } from "./const.mjs";
import { registerSettings } from "./settings.mjs";
import { registerBypassKeybinding } from "./bridge/keybind.mjs";
import { install, planForToken, bridgeState } from "./bridge/drag.mjs";
import { configureLogging, warn } from "./util/log.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerBypassKeybinding();
});

Hooks.once("ready", () => {
  configureLogging(game.settings.get(MODULE_ID, SETTINGS.debug));
  const ok = install();

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      /** Plan a route from a token to a scene point without dragging. */
      planForToken,
      /** Walls, bounds and active drag plans. */
      state: bridgeState,
      /** Re-install the wrappers (normally done once at ready). */
      install,
      id: MODULE_ID
    };
  }

  console.info(`${MODULE_TITLE} | ${ok ? "drag pathfinding ready" : "bridge not installed (no Token class)"}`);
  if (ok && !game.modules.get("lib-wrapper")?.active) {
    warn("lib-wrapper is not active; using plain wrappers. Loading lib-wrapper improves compatibility with other token modules.");
  }
});
