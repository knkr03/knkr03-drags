/* foundry-data.mjs - the bridge's read-only half.
 *
 * Every value the pathfinder needs about the live table is gathered here:
 * token location, cursor location, footprint, movement speed, movement history,
 * grid and scene walls. Nothing in this file changes the game state.
 */

import { MODULE_ID, SETTINGS } from "../const.mjs";
import { resolveMovementRate, movementBudget } from "../pathfinder/index.mjs";
import { wallConstants, wallSegments } from "./walls.mjs";
import { debug } from "../util/log.mjs";

/* --------------------------------------------------------------- grid */

/** The active scene's grid, normalised to the fields the pathfinder needs. */
export function getGrid() {
  const grid = globalThis.canvas?.grid;
  const dimensions = globalThis.canvas?.dimensions ?? {};
  return {
    size: grid?.size ?? dimensions.size ?? 100,
    distance: grid?.distance ?? dimensions.distance ?? 5,
    units: grid?.units ?? dimensions.units ?? "",
    isSquare: grid?.isSquare ?? true,
    isGridless: grid?.isGridless ?? false
  };
}

/** Scene size in pixels; wall and token coordinates live in this space. */
export function getSceneBounds() {
  const scene = globalThis.canvas?.scene;
  return {
    width: scene?.width ?? globalThis.canvas?.dimensions?.width ?? 0,
    height: scene?.height ?? globalThis.canvas?.dimensions?.height ?? 0
  };
}

/* -------------------------------------------------------------- walls */

/** Wall documents of the active scene. */
export function readWallDocuments(scene = globalThis.canvas?.scene) {
  const collection = scene?.walls;
  if (collection?.contents) return collection.contents;
  return globalThis.canvas?.walls?.placeables?.map(p => p.document) ?? [];
}

/* --------------------------------------------------- movement history */

/**
 * Movement already recorded for a token this turn.
 *
 * @param {TokenDocument} doc
 * @returns {{entries: object[], used: number, unmeasured: boolean}}
 */
export function readMovementHistory(doc) {
  const history = doc?.movementHistory ?? [];
  const entries = [];
  let used = 0;
  let unmeasured = false;
  for (const waypoint of history) {
    const finite = Number.isFinite(waypoint.cost);
    if (finite) used += waypoint.cost;
    else unmeasured = true;
    entries.push({
      x: waypoint.x,
      y: waypoint.y,
      elevation: waypoint.elevation,
      action: waypoint.action,
      movementId: waypoint.movementId ?? null,
      userId: waypoint.userId ?? null,
      cost: finite ? waypoint.cost : null
    });
  }
  return { entries, used, unmeasured };
}

/* -------------------------------------------------------------- speed */

/** Actor movement rate in scene units per turn, or null when the system has none. */
export function readMovementSpeed(actor) {
  const attribute = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.movementAttribute) ?? "";
  return resolveMovementRate(actor, { attribute });
}

/* ------------------------------------------------------------- budget */

/**
 * Pixel budget for the next drag of this token.
 *
 * Outside combat: rate minus recorded history, doubled once the rate is spent.
 * In combat: an extending clamp (base, then base + base, then + base again),
 * so a combatant can take several base-length moves per turn.
 *
 * @param {Token} token
 * @param {object} [options]
 * @param {boolean} [options.unlimited]  force no clamp (bypass drags)
 */
export function computeBudget(token, { unlimited = false } = {}) {
  const grid = getGrid();
  const doc = token?.document;
  const history = readMovementHistory(doc);
  const disabled = unlimited || !globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.enforceBudget);
  const fallbackSpaces = Number(globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.fallbackSpeed) ?? 0);
  const speed = readMovementSpeed(doc?.actor);
  const combat = !!globalThis.game?.combat?.started && !!doc?.combatant;
  const budget = movementBudget({
    rate: speed?.value ?? null,
    used: history.used,
    usedInfinite: history.unmeasured,
    grid,
    unlimited: disabled,
    fallbackSpaces,
    combat
  });
  return {
    ...budget,
    speed,
    history: { waypoints: history.entries.length, used: history.used, unmeasured: history.unmeasured },
    grid
  };
}

/* -------------------------------------------------------------- token */

/** Disc radius used to model a token's footprint. */
export function tokenRadius(doc, grid = getGrid()) {
  const scale = Number(globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS.footprintScale) ?? 1);
  const width = (doc?.width ?? 1) * grid.size;
  const height = (doc?.height ?? 1) * grid.size;
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(width, height) * 0.5 * factor;
}

/** Everything the bridge reports about a token. */
export function readTokenState(token) {
  const doc = token?.document;
  if (!doc) return null;
  const grid = getGrid();
  const center = doc.getCenterPoint();
  return {
    id: doc.id,
    name: doc.name,
    sceneId: doc.parent?.id ?? null,
    actorId: doc.actorId ?? null,
    x: doc.x,
    y: doc.y,
    center: { x: center.x, y: center.y, elevation: center.elevation ?? doc.elevation },
    elevation: doc.elevation,
    width: doc.width,
    height: doc.height,
    shape: doc.shape,
    radius: tokenRadius(doc, grid),
    movementAction: doc.movementAction ?? null,
    speed: readMovementSpeed(doc.actor),
    history: readMovementHistory(doc),
    grid
  };
}

/** Where the pointer currently is, in scene pixels. */
export function readCursor() {
  const point = globalThis.canvas?.mousePosition;
  if (!point) return null;
  return { x: point.x, y: point.y };
}

/* ----------------------------------------------------------- geometry */

let revision = 0;
let cache = { key: null, segments: [], maze: null };

/** Force the wall geometry to be rebuilt on the next request. */
export function invalidateGeometry() {
  revision += 1;
  cache.key = null;
}

/**
 * The current scene's blocking segments and a ready-to-use maze for them.
 *
 * @param {typeof import("../pathfinder/index.mjs").Maze} MazeClass
 * @returns {{segments:number[][], maze:object, bounds:{width:number,height:number}, revision:number}}
 */
export function getGeometry(MazeClass) {
  const scene = globalThis.canvas?.scene;
  const bounds = getSceneBounds();
  const walls = readWallDocuments(scene);
  const key = `${scene?.id ?? "none"}:${revision}:${walls.length}:${bounds.width}x${bounds.height}`;
  if (cache.key !== key) {
    const segments = wallSegments(walls, wallConstants());
    cache = {
      key,
      segments,
      maze: new MazeClass({ segments, width: bounds.width, height: bounds.height }),
      bounds
    };
    debug(`geometry rebuilt: ${segments.length} blocking walls on ${bounds.width}x${bounds.height}`);
  }
  return { ...cache, revision };
}

/**
 * Convert a scene centre point into the top-left token position Foundry's
 * movement waypoints expect, for a token with the given dimensions and shape.
 */
export function centerToTopLeft(doc, center, { width, height, shape } = {}) {
  const pivot = doc.getCenterPoint({
    x: 0,
    y: 0,
    elevation: 0,
    width: width ?? doc.width,
    height: height ?? doc.height,
    shape: shape ?? doc.shape
  });
  return { x: center.x - pivot.x, y: center.y - pivot.y };
}
