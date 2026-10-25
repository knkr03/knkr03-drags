/* keybind.mjs - the hold-to-bypass key.
 *
 * Default is the left Shift key. While it is held, a drag ignores pathfinding,
 * wall collision and the movement clamp, and ends wherever the pointer is.
 * Holding works from either the Foundry keybinding callback or by inspecting
 * the currently depressed keys, so a rebind and a missed keyup both behave.
 */

import { MODULE_ID } from "../const.mjs";

export const BYPASS_ACTION = "bypassPathfinding";

/** Modifier name -> the KeyboardEvent.code values Foundry tracks. */
const MODIFIER_CODES = {
  Shift: ["ShiftLeft", "ShiftRight"],
  Control: ["ControlLeft", "ControlRight", "MetaLeft", "MetaRight"],
  Alt: ["AltLeft", "AltRight"]
};

let changeHandler = null;

/** Called whenever the bypass key goes down or up (used to refresh the drag). */
export function onBypassChange(handler) {
  changeHandler = handler;
}

function notifyChange() {
  try {
    changeHandler?.();
  } catch (err) {
    console.error("[knkr03-drags] bypass key handler failed", err);
  }
}

/** Register the keybinding. Must run during the init hook. */
export function registerBypassKeybinding() {
  if (!game?.keybindings?.register) return;
  game.keybindings.register(MODULE_ID, BYPASS_ACTION, {
    name: "KDRAGS.keybindings.bypass.name",
    hint: "KDRAGS.keybindings.bypass.hint",
    editable: [{ key: "ShiftLeft" }],
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    // Return false: the key is not consumed, so core still sees Shift for its
    // own unsnapped dragging.
    onDown: () => {
      notifyChange();
      return false;
    },
    onUp: () => {
      notifyChange();
      return false;
    }
  });
}

/** Is the bypass key currently held? */
export function bypassActive() {
  const down = game?.keyboard?.downKeys;
  if (!down?.has) return false;
  let bindings = [];
  try {
    bindings = game.keybindings?.get?.(MODULE_ID, BYPASS_ACTION) ?? [];
  } catch {
    return false;
  }
  return bindings.some(binding => {
    if (!binding?.key || !down.has(binding.key)) return false;
    return (binding.modifiers ?? []).every(modifier =>
      (MODIFIER_CODES[modifier] ?? []).some(code => down.has(code))
    );
  });
}
