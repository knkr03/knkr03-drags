/* log.mjs - one place for module logging. */

let debugEnabled = false;

export function configureLogging(debug) {
  debugEnabled = !!debug;
}

export function debug(...args) {
  if (debugEnabled) console.log("%c[knkr03-drags]", "color:#22d94f", ...args);
}

export function warn(...args) {
  console.warn("[knkr03-drags]", ...args);
}

export function error(...args) {
  console.error("[knkr03-drags]", ...args);
}
