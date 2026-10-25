/* const.mjs - shared identifiers for the module. */

export const MODULE_ID = "knkr03-drags";
export const MODULE_TITLE = "knkr03 drags";

/** Where the Token drag pipeline lives in v13's ESM namespace. */
export const TOKEN_NAMESPACE = "foundry.canvas.placeables.Token";

export const SETTINGS = Object.freeze({
  enabled: "enabled",
  enforceBudget: "enforceBudget",
  movementAttribute: "movementAttribute",
  fallbackSpeed: "fallbackSpeed",
  footprintScale: "footprintScale",
  gridCell: "gridCell",
  clearancePad: "clearancePad",
  drawBeyondBudget: "drawBeyondBudget",
  debug: "debug"
});
