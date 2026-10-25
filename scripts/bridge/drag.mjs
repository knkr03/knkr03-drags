/* drag.mjs - the bridge's write half.
 *
 * Foundry v13.351 already asks a Token for its drag path:
 *
 *   Token#_onDragLeftMove -> _updateDragDestination -> #recalculatePlannedMovementPath
 *     -> Token#findMovementPath(waypoints, {preview, history, ...})
 *     -> context.foundPath -> TokenRuler
 *   Token#_onDragLeftDrop -> _prepareDragLeftDropUpdates(context.foundPath)
 *     -> TokenDocument movement update
 *
 * The module slots into that pipeline instead of replacing it:
 *
 *   findMovementPath   answer with a wall-aware route from the pathfinder
 *   _onDragLeftMove    draw the over-budget remainder, park the preview at the
 *                      stop point, and handle the no-ruler case
 *   _prepareDragLeftDropUpdates
 *                      keep the validated route instead of re-constraining it
 *   _finalizeDragLeft  clean up overlays and cached plans
 */

import { MODULE_ID, SETTINGS, TOKEN_NAMESPACE } from "../const.mjs";
import { Maze, planPath, polyline } from "../pathfinder/index.mjs";
import { wrapMethod } from "../util/wrap.mjs";
import { debug, error, warn } from "../util/log.mjs";
import {
  centerToTopLeft,
  computeBudget,
  getGeometry,
  invalidateGeometry,
  readCursor,
  readTokenState,
  tokenRadius
} from "./foundry-data.mjs";
import { PathOverlay } from "./overlay.mjs";
import { bypassActive, onBypassChange } from "./keybind.mjs";

/** tokenId -> { token, context, plan, budget, radius, request, template, origin } */
const plans = new Map();
const overlay = new PathOverlay();
let installed = false;

/* -------------------------------------------------------- entry point */

export function install() {
  if (installed) return true;
  const TokenClass = globalThis.CONFIG?.Token?.objectClass
    ?? globalThis.foundry?.canvas?.placeables?.Token
    ?? globalThis.Token;
  if (!TokenClass) {
    warn("Token class not found; drag pathfinding not installed");
    return false;
  }
  const opts = { moduleId: MODULE_ID, namespace: TOKEN_NAMESPACE };
  wrapMethod(TokenClass, "findMovementPath", onFindMovementPath, opts);
  wrapMethod(TokenClass, "_onDragLeftMove", onDragLeftMove, opts);
  wrapMethod(TokenClass, "_prepareDragLeftDropUpdates", onPrepareDrop, opts);
  wrapMethod(TokenClass, "_finalizeDragLeft", onFinalize, opts);

  for (const hook of ["createWall", "updateWall", "deleteWall"]) {
    Hooks.on(hook, () => invalidateGeometry());
  }
  Hooks.on("updateScene", () => invalidateGeometry());
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", onCanvasTearDown);

  // Pressing or releasing the bypass key re-plans the drag in progress, so the
  // straight/through-wall route appears on press and the routed path returns
  // on release without moving the mouse.
  onBypassChange(refreshDraggedPath);

  installed = true;
  debug("drag bridge installed");
  return true;
}

/* ------------------------------------------------------------ settings */

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * A* cell size for the scene, honouring the setting but coarsening it on very
 * large maps so the grid arrays stay bounded (~200k cells).
 */
function gridCellFor(bounds) {
  const configured = Number(setting(SETTINGS.gridCell)) || 8;
  const area = Math.max(1, (bounds?.width ?? 0) * (bounds?.height ?? 0));
  const minimum = Math.ceil(Math.sqrt(area / 200000));
  return Math.max(configured, minimum);
}

/* -------------------------------------------------------- drag context */

/** The drag context of a token, or null when it isn't the one being dragged. */
function getDragContext(token) {
  const layer = token?.layer ?? canvas.tokens;
  const dragged = layer?._draggedToken;
  const contexts = dragged?.mouseInteractionManager?.interactionData?.contexts;
  return contexts?.[token?.document?.id] ?? null;
}

/** Is this drag one the module should answer? */
function shouldHandle(token, options) {
  if (!setting(SETTINGS.enabled)) return false;
  if (!options?.preview) return false;
  if (options.ignoreWalls) return false;
  if (!canvas?.scene || !canvas?.grid) return false;
  if (game.user.isGM && game.settings.get("core", "unconstrainedMovement")) return false;
  const actionKey = token._getDragMovementAction?.() ?? token.document.movementAction;
  const action = actionKey ? CONFIG.Token.movement?.actions?.[actionKey] : null;
  if (actionKey && action && !action.walls) return false; // teleport-style movement
  return true;
}

/* -------------------------------------------------------------- plans */

/**
 * Plan a drag through the given explicit Foundry waypoints (origin first) and
 * remember everything needed to render and commit it.
 */
function buildPlan(token, waypoints) {
  const doc = token.document;
  const { maze, segments, bounds } = getGeometry(Maze);
  const cell = gridCellFor(bounds);
  const radius = tokenRadius(doc);
  const budget = computeBudget(token);
  const centers = waypoints.map(w => doc.getCenterPoint(w));
  const from = centers[0];
  const targets = centers.slice(1);
  const to = targets[targets.length - 1] ?? from;

  const plan = planPath({
    maze,
    from,
    to,
    waypoints: targets,
    radius,
    budgetPx: budget.budgetPx,
    cell,
    pad: Number(setting(SETTINGS.clearancePad)) || 0,
    maxNodes: 60000
  });

  const request = {
    token: readTokenState(token),
    cursor: readCursor(),
    target: { x: to.x, y: to.y },
    walls: segments.length,
    budget,
    gridCell: cell,
    clearancePad: Number(setting(SETTINGS.clearancePad)) || 0
  };

  const entry = {
    token,
    plan,
    budget,
    radius,
    request,
    template: waypoints[waypoints.length - 1],
    origin: waypoints[0],
    at: Date.now()
  };
  plans.set(doc.id, entry);

  if (setting(SETTINGS.debug)) {
    debug("plan", {
      token: doc.name,
      blocked: !plan.clear,
      routed: plan.routed,
      reached: plan.reached,
      points: plan.points.length,
      length: Math.round(plan.length),
      travel: Math.round(plan.travel),
      budget: budget.limited ? `${Math.round(budget.allowed * 100) / 100} ${budget.grid.units}` : "unlimited",
      used: budget.history.used,
      ms: Math.round(plan.ms * 10) / 10
    });
  }
  return entry;
}

/**
 * A bypass plan: straight through the explicit waypoints, ignoring walls and
 * the clamp. The preview already sits on the drop point, so only the waypoints
 * and the unlimited budget need to cross the bridge.
 */
function buildBypass(token, waypoints) {
  const doc = token.document;
  const points = [];
  for (const waypoint of waypoints) {
    const centre = doc.getCenterPoint(waypoint);
    const point = [centre.x, centre.y];
    const last = points[points.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.01) continue;
    points.push(point);
  }
  if (points.length === 0) points.push([doc.x, doc.y]);
  const line = polyline(points);
  const stop = line.points[line.points.length - 1];
  const plan = {
    clear: true,
    routed: false,
    reached: true,
    points: line.points,
    cum: line.cum,
    length: line.length,
    travel: line.length,
    cut: false,
    stop: [stop[0], stop[1]],
    near: line.points,
    far: null,
    collision: null,
    ms: 0,
    from: [line.points[0][0], line.points[0][1]],
    to: [stop[0], stop[1]],
    radius: tokenRadius(doc)
  };

  const entry = {
    token,
    plan,
    budget: computeBudget(token, { unlimited: true }),
    radius: tokenRadius(doc),
    request: {
      token: readTokenState(token),
      cursor: readCursor(),
      target: { x: stop[0], y: stop[1] },
      bypass: true,
      walls: 0
    },
    template: waypoints[waypoints.length - 1],
    origin: waypoints[0],
    at: Date.now(),
    bypass: true
  };
  plans.set(doc.id, entry);
  debug(`bypass drag for ${doc.name}`);
  return entry;
}

/** Convert a plan's centre points into Foundry movement waypoints. */
function toWaypoints(entry) {
  const { token, plan, template, origin } = entry;
  const doc = token.document;
  // Foundry must only receive the part inside the movement budget; the rest of
  // the route is display-only.
  const points = plan.near;
  const lastIndex = points.length - 1;

  const out = points.map((point, index) => {
    const isLast = index === lastIndex;
    const topLeft = centerToTopLeft(doc, { x: point[0], y: point[1] }, template);
    return {
      x: Math.round(topLeft.x),
      y: Math.round(topLeft.y),
      elevation: isLast
        ? (template.elevation ?? origin.elevation ?? 0)
        : (origin.elevation ?? 0),
      width: template.width ?? doc.width,
      height: template.height ?? doc.height,
      shape: template.shape ?? doc.shape,
      action: template.action ?? doc.movementAction,
      snapped: isLast ? !!template.snapped : false,
      explicit: isLast ? !!template.explicit : false,
      checkpoint: isLast ? !!template.checkpoint : false,
      intermediate: false
    };
  });

  out[0] = { ...origin, intermediate: false };

  // An exact match with the drop waypoint is what tells Foundry the target was
  // reached; keep it byte-for-byte instead of a rounded reconstruction.
  if (plan.reached && out.length > 1) {
    out[lastIndex] = {
      ...template,
      x: template.x,
      y: template.y,
      intermediate: false
    };
  }
  return out;
}

/* -------------------------------------------------------- path display */

/**
 * Park each drag preview at the point the token will really stop. Foundry only
 * moves the preview when the pointer destination changes, so a budget-limited
 * path would otherwise leave the ghost token on the wrong side of the wall.
 */
function positionPreviews() {
  for (const entry of plans.values()) {
    const context = entry.context ?? getDragContext(entry.token);
    const preview = context?.clonedToken;
    if (!preview?.document) continue;
    if (entry.plan.reached) continue; // Foundry already put it on the drop point

    const topLeft = centerToTopLeft(
      entry.token.document,
      { x: entry.plan.stop[0], y: entry.plan.stop[1] },
      entry.template
    );
    const x = Math.round(topLeft.x);
    const y = Math.round(topLeft.y);
    if (preview.document.x === x && preview.document.y === y) continue;
    preview.document.x = x;
    preview.document.y = y;
    preview.renderFlags?.set({ refreshPosition: true });
  }
}

function drawOverlay() {
  if (!setting(SETTINGS.drawBeyondBudget)) {
    overlay.clear();
    return;
  }
  const entries = [];
  for (const entry of plans.values()) {
    // the far side of the route is only interesting when a budget cut it
    if (!entry.plan.cut && entry.plan.clear) continue;
    entries.push({ plan: entry.plan, radius: entry.radius });
  }
  overlay.draw(entries);
}

/* ----------------------------------------------------------- wrappers */

function onFindMovementPath(wrapped, waypoints, options) {
  try {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      return wrapped.call(this, waypoints, options);
    }
    if (!setting(SETTINGS.enabled)) return wrapped.call(this, waypoints, options);
    const context = getDragContext(this);
    if (!context) return wrapped.call(this, waypoints, options);

    // Hold the bypass key: no pathfinding, no collision, no clamp.
    if (bypassActive()) {
      const entry = buildBypass(this, waypoints);
      entry.context = context;
      const result = toWaypoints(entry);
      return { result, promise: Promise.resolve(result), cancel() {} };
    }

    if (!shouldHandle(this, options)) return wrapped.call(this, waypoints, options);

    const { segments } = getGeometry(Maze);
    if (segments.length === 0) return wrapped.call(this, waypoints, options);

    const entry = buildPlan(this, waypoints);
    entry.context = context;
    const result = toWaypoints(entry);
    return { result, promise: Promise.resolve(result), cancel() {} };
  } catch (err) {
    error("findMovementPath failed; falling back to Foundry's path", err);
    return wrapped.call(this, waypoints, options);
  }
}

function onDragLeftMove(wrapped, event) {
  const result = wrapped.call(this, event);
  try {
    if (!setting(SETTINGS.enabled)) return result;
    const context = getDragContext(this);
    if (!context) return result;

    // Foundry skips its pathfinder entirely when the token has no ruler. Fill
    // the context here so the drop still follows the routed (or bypass) path.
    if (!this.ruler) {
      const explicit = [{ ...context.origin }, ...(context.waypoints ?? []), { ...context.destination }];
      if (bypassActive()) {
        const entry = buildBypass(this, explicit);
        entry.context = context;
        context.foundPath = toWaypoints(entry);
      } else if (shouldHandle(this, { preview: true })) {
        const { segments } = getGeometry(Maze);
        if (segments.length) {
          const entry = buildPlan(this, explicit);
          entry.context = context;
          context.foundPath = toWaypoints(entry);
        }
      }
    }

    positionPreviews();
    drawOverlay();
  } catch (err) {
    error("drag move handling failed", err);
  }
  return result;
}

function onPrepareDrop(wrapped, event) {
  const result = wrapped.call(this, event);
  try {
    const options = Array.isArray(result) ? result[1] : null;
    const movement = options?.movement;
    if (movement) {
      for (const [id, update] of Object.entries(movement)) {
        const entry = plans.get(id);
        if (!entry) continue;
        // The route is already collision-free for the disc; core's own wall
        // truncation would cut it back at grazing waypoints. A bypass drag
        // also skips the cost constraint.
        if (update?.constrainOptions) {
          update.constrainOptions.ignoreWalls = true;
          if (entry.bypass) update.constrainOptions.ignoreCost = true;
        }
      }
    }
  } catch (err) {
    error("drop preparation failed", err);
  }
  return result;
}

function onFinalize(wrapped, event) {
  const result = wrapped.call(this, event);
  try {
    const contexts = event?.interactionData?.contexts;
    if (contexts) {
      for (const id of Object.keys(contexts)) plans.delete(id);
    }
    plans.delete(this.document.id);
    overlay.clear();
  } catch (err) {
    error("drag finalize failed", err);
  }
  return result;
}

/* ------------------------------------------------------------- bypass */

/**
 * Re-plan the drag in progress, if any. Called when the bypass key goes down
 * or up so the displayed path and the committed path follow the key state.
 */
function refreshDraggedPath() {
  const token = canvas?.tokens?._draggedToken;
  if (!token || typeof token.recalculatePlannedMovementPath !== "function") return;
  try {
    token.recalculatePlannedMovementPath();
    const after = () => {
      positionPreviews();
      drawOverlay();
    };
    if (canvas.app?.ticker?.addOnce) canvas.app.ticker.addOnce(after);
    else after();
  } catch (err) {
    error("bypass refresh failed", err);
  }
}

/* ------------------------------------------------------------- canvas */

function onCanvasReady() {
  plans.clear();
  overlay.destroy();
  invalidateGeometry();
}

function onCanvasTearDown() {
  plans.clear();
  overlay.destroy();
}

/* ---------------------------------------------------------------- api */

/** Plan a route for a token to a scene point, without starting a drag. */
export function planForToken(token, point) {
  const doc = token?.document;
  if (!doc) throw new Error("planForToken needs a Token placeable");
  const origin = doc.getCenterPoint();
  const destination = { x: point.x, y: point.y, elevation: doc.elevation };
  const { maze, bounds } = getGeometry(Maze);
  const budget = computeBudget(token);
  const radius = tokenRadius(doc);
  return planPath({
    maze,
    from: origin,
    to: destination,
    radius,
    budgetPx: budget.budgetPx,
    cell: gridCellFor(bounds),
    pad: Number(setting(SETTINGS.clearancePad)) || 0
  });
}

/** Snapshot used by the debug API. */
export function bridgeState() {
  const { segments, bounds } = getGeometry(Maze);
  return {
    installed,
    enabled: setting(SETTINGS.enabled),
    bypass: bypassActive(),
    scene: canvas?.scene?.id ?? null,
    bounds,
    walls: segments.length,
    activePlans: [...plans.values()].map(entry => ({
      token: entry.token.document.name,
      points: entry.plan.points.length,
      length: Math.round(entry.plan.length),
      travel: Math.round(entry.plan.travel),
      budgetPx: Number.isFinite(entry.budget.budgetPx) ? Math.round(entry.budget.budgetPx) : null,
      budgetMode: entry.budget.mode,
      clampTotal: entry.budget.clampTotal,
      bypass: !!entry.bypass,
      reached: entry.plan.reached,
      cut: entry.plan.cut,
      routed: entry.plan.routed
    }))
  };
}
