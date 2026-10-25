/* settings.mjs - module settings. All client-scoped: the path is planned and
 * displayed on the client doing the drag, and committed through the normal
 * token document update. */

import { MODULE_ID, SETTINGS } from "./const.mjs";
import { configureLogging } from "./util/log.mjs";

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, {
    scope: "client",
    config: true,
    ...data
  });
  const key = name => `KDRAGS.settings.${name}`;

  register(SETTINGS.enabled, {
    name: key("enabled.name"),
    hint: key("enabled.hint"),
    type: Boolean,
    default: true
  });

  register(SETTINGS.enforceBudget, {
    name: key("enforceBudget.name"),
    hint: key("enforceBudget.hint"),
    type: Boolean,
    default: true
  });

  register(SETTINGS.movementAttribute, {
    name: key("movementAttribute.name"),
    hint: key("movementAttribute.hint"),
    type: String,
    default: ""
  });

  register(SETTINGS.fallbackSpeed, {
    name: key("fallbackSpeed.name"),
    hint: key("fallbackSpeed.hint"),
    type: Number,
    default: 6,
    range: { min: 0, max: 30, step: 0.5 }
  });

  register(SETTINGS.footprintScale, {
    name: key("footprintScale.name"),
    hint: key("footprintScale.hint"),
    type: Number,
    default: 1,
    range: { min: 0.25, max: 1.5, step: 0.05 }
  });

  register(SETTINGS.gridCell, {
    name: key("gridCell.name"),
    hint: key("gridCell.hint"),
    type: Number,
    default: 8,
    range: { min: 4, max: 32, step: 1 }
  });

  register(SETTINGS.clearancePad, {
    name: key("clearancePad.name"),
    hint: key("clearancePad.hint"),
    type: Number,
    default: 0,
    range: { min: 0, max: 20, step: 0.5 }
  });

  register(SETTINGS.drawBeyondBudget, {
    name: key("drawBeyondBudget.name"),
    hint: key("drawBeyondBudget.hint"),
    type: Boolean,
    default: true
  });

  register(SETTINGS.debug, {
    name: key("debug.name"),
    hint: key("debug.hint"),
    type: Boolean,
    default: false,
    onChange: value => configureLogging(value)
  });
}
