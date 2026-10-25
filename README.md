# knkr03 drags

A Foundry VTT **v13** module in two systems.

1. **Bridge** — reads a live token drag out of Foundry (token location, cursor
   location, footprint, movement speed, movement history, scene walls), hands it
   to the pathfinder on every drag move, and writes the returned path back:
   the ruler/overlay show it, the drag preview sits on the point the token will
   really reach, and releasing the drag commits it as a native multi-waypoint
   movement.
2. **Pathfinder** — the browser maze app converted to a plain module: swept-disc
   collision, grid A* and string pulling, with every web part removed. No DOM,
   no canvas, no fetch, no map file of its own; geometry arrives from the bridge
   (Foundry scene walls) and a path goes back.

The package id is `knkr03-drags` and the module title is **knkr03 drags**.
Foundry package ids may only contain lowercase letters, digits, `-` and `_`, and
the install folder must match the id — a folder named `knkr03 drags` with a
space would not load.

## Install

### From GitHub

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/knkr03/knkr03-drags/releases/latest/download/module.json
```

The manifest points at the zip attached to the latest GitHub release, so
Foundry can also update the module from its own installer.

### From a release zip

Download `knkr03-drags-v<version>.zip` from the
[releases page](https://github.com/knkr03/knkr03-drags/releases) and extract it
into `Data/modules/`, so the installed module is:

```
Data/modules/knkr03-drags/module.json
```

The archive has `module.json` at its root, as Foundry expects. Then enable the
module and optionally
[lib-wrapper](https://foundryvtt.com/packages/lib-wrapper). libWrapper is not
required; when it is active the wrappers are registered through it, otherwise
plain prototype wrappers are used. Every wrapper chains into the method it
wraps before answering, which is what lets `dnd5e`, `touch-vtt` and other
modules wrap the same drag methods without conflict.

Compatibility is pinned to `13.351` because the bridge uses the v13 drag
pipeline that exists there (`Token#findMovementPath`,
`Token#_prepareDragLeftDropUpdates`, `TokenDocument#movementHistory`,
`CONFIG.Token.rulerClass`). This was read from the installed 13.351 sources.

## How a drag flows

| moment | what happens |
|---|---|
| pointer down | Foundry starts its normal drag; the module attaches to that drag context |
| pointer move | `Token#_onDragLeftMove` → `_updateDragDestination` → `#recalculatePlannedMovementPath` → `Token#findMovementPath(waypoints, {preview: true})` |
| bridge | reads the token (centre, footprint, actor rate, movement history), the cursor (`canvas.mousePosition`), the grid and the scene's blocking walls |
| pathfinder | straight move clear → that line; otherwise A* around walls, every leg re-checked exactly; then the movement budget is applied |
| back to Foundry | the returned waypoints become `context.foundPath`, so the native token ruler draws them; over-budget remainder and the stop marker are drawn by the module's overlay; the drag preview is parked on the stop point |
| hold bypass | left Shift (rebindable): the next path is a straight line through walls with no clamp, and the drop skips both wall and cost constraints |
| pointer up | `Token#_prepareDragLeftDropUpdates` hands `context.foundPath.slice(1)` to Foundry's movement update, which animates the token along the waypoints, records the movement history and syncs every client |
| cancel / end | plans and overlay are cleared |

The drop commit is Foundry's own multi-waypoint movement (`method: "dragging"`,
the same path `TokenDocument#move(...)` takes), so history, animation and
permissions stay in core hands. The bridge marks the route as already
wall-validated for that update: the path was checked exactly for the disc, and
core's wall truncation would otherwise cut it back at a grazing waypoint.

Nothing is sent over sockets. Planning happens on the client doing the drag;
the result is a normal document update.

## Bypass key

The module registers a keybinding, **Bypass pathfinding (hold)**, default
**left Shift**, rebindable in *Configure Controls*. While it is held:

- the drag path is the straight line to the pointer, through walls
- the movement clamp is ignored
- the commit skips wall and cost constraints

Pressing or releasing it re-plans the drag in progress, so the route changes
immediately without moving the mouse. Because the bypass key is Shift, Foundry
also stops snapping the dragged position while it is held (core behaviour);
rebind the key if you want snapping and bypass separately.


## Data contract

Bridge → pathfinder (one call per drag move):

```js
{
  maze,          // Maze instance for the scene walls
  from:   {x, y},            // token centre, scene px
  to:     {x, y},            // cursor/drop centre, scene px
  waypoints: [{x, y}],       // explicit intermediate drop points, if any
  radius,                    // disc radius, px (half the token's largest side)
  budgetPx,                  // furthest this drag may travel, Infinity = unlimited
  cell: 8, pad: 0, maxNodes: 60000
}
```

Pathfinder → bridge (the plan):

```js
{
  clear,     // straight move was unobstructed
  routed,    // A* was needed and succeeded
  reached,   // the move ends on the requested target
  points,    // [x,y] centres: start, ...route..., end of the whole route
  near,      // the part inside the budget; this is what Foundry receives
  far,       // the rest, drawn in blue; null when nothing was cut
  stop,      // centre where the token really ends this move
  length, travel, cut,
  collision, // null | {segment, at, center, inside}
  ms
}
```

`near` is converted back to Foundry movement waypoints (top-left `x/y`, plus
`elevation`, `width`, `height`, `shape`, `action`). When the target is reached the
last waypoint is the drop waypoint untouched, so core counts it as reachable.
When the budget cut the path, the last waypoint is the stop and core marks the
drop point as unreachable — which is exactly what the ruler should show.

## Movement budget

The demo gave every object a **max move** in pixels. The module replaces that
with the actor's movement rate and Foundry's recorded movement history.

Outside combat:

```
rate   = actor movement attribute (scene units), auto-detected or configured
spent  = sum of the token's recorded movementHistory costs this turn
budget = rate - spent            while budget > 0
budget = rate * 2                once the rate is spent
px     = budget / grid.distance * grid.size
```

In a running combat, for any token that has a combatant, the clamp extends by
one base rate each time it is used up, which allows several clamped moves per
turn:

```
spent  0 -> clamp 30, move up to 30
spent 30 -> clamp 60, move up to 30 again
spent 45 -> clamp 60, move up to 15
spent 60 -> clamp 90, move up to 30 again
px = available / grid.distance * grid.size
```

`api.state().activePlans[].budgetMode` reports `combat`, `standard` or
`unlimited`, and `clampTotal` the current combat clamp distance.

Movement history is maintained by Foundry and cleared when the combatant's turn
starts or ends, so the clamp resets each turn. If the actor has no readable
movement rate, the fallback setting (default 6 grid spaces per drag) becomes the
base rate; set it to 0 for no budget at all. `enforceBudget` can disable the
rule entirely, and a bypass drag ignores it regardless.

Auto-detected actor paths, in order: `system.attributes.movement.walk`,
`system.attributes.movement.speed`, `system.attributes.speed.value`,
`system.attributes.speed.total`, `system.movement.walk`,
`system.movement.speed`, `system.speed.value`, `system.attributes.movement`.
Set the movement attribute setting to force one path.

## Settings

| setting | default | meaning |
|---|---|---|
| Enable drag pathfinding | on | route dragged tokens; off = untouched Foundry behaviour |
| Bypass pathfinding (keybinding) | left Shift | hold to ignore pathfinding, collision and clamp |
| Limit movement by the actor's rate | on | apply the budget rule above |
| Movement attribute path | empty | explicit actor path, else auto-detect |
| Fallback movement (grid spaces) | 6 | used only when the actor rate is unknown; 0 = unlimited |
| Footprint scale | 1 | disc radius = half the token's largest side × this |
| Pathfinding grid cell (px) | 8 | A* cell size; smaller is finer and slower, and it is coarsened automatically on very large scenes |
| Extra wall clearance (px) | 0 | padding beyond the footprint; raise for smoother routes |
| Draw the route beyond the budget | on | blue remainder + stop ghost |
| Debug logging | off | one line per drag plan |

## API

```js
const api = game.modules.get("knkr03-drags").api;

api.planForToken(token, {x: 1200, y: 800});  // plan a route without dragging
api.state();                                 // {installed, walls, bounds, activePlans}
api.install();                               // no-op after ready
```

## What was removed from the app

Kept: the collision model (`clearance`, `checkMove` with `CONTACT_SKIN`, the
1 px sweep and 45-step bisection), grid A* with padded clearance, diagonal
blocking, the exact leg re-check, greedy string pulling, and the
straight → route → contact-stop plan semantics with the budget split.

Removed: the canvas renderer and scene drawing, pointer handlers, the HTML
panels/log/score, the max-move inputs, `maze.map`/`maze-data.js` and the loader
(geometry is Foundry walls now), goal snapping (there is no goal data when walls
come from the scene), and `extract_map.py`.

## Development

```
npm test                 # 57 Node tests: pathfinder, planner, budget, walls, bridge, module
node tools/build.mjs     # checks, bumps the version, stages and zips
```

`tools/build.mjs` bumps the patch version by default (`--minor`, `--major`,
`--no-bump`, `--version=x.y.z`, `--skip-checks` are supported), runs the syntax
check and test suite, writes `dist/knkr03-drags/module.json` plus the staged
module, and produces `dist/knkr03-drags-v<version>.zip` with `module.json` at the
archive root. Every iteration gets a new version number and its own zip.

Tests cover:

- the ported maze collision matrix and A* routes on the original map fixture
- straight, routed, blocked and budget-clipped plans, waypoint chains
- the movement-rate rule, unit conversion and fallback budget
- wall filtering (non-blocking walls, open/closed/locked/secret doors, bad data)
- the bridge against a mocked v13 drag pipeline: waypoints crossing the bridge,
  preview position, committed route options, cleanup, bypass conditions
- the hold-to-bypass key: straight through-wall path, unlimited budget,
  wall/cost constraint flags on the drop, and routing again after release
- the combat clamp: base-by-base extension, clamp totals, fallback rate, and
  the unchanged out-of-combat doubling rule
- the manifest entry point: settings and keybinding registration, localization
  keys, and graceful startup without a live canvas or Token class
- a 400-wall scene benchmark (planning stays ~40 ms for a long route)

## Limits / not verified in a live world

Foundry was not launched while building this, so the bridge is verified against
its 13.351 sources and a mocked pipeline, not an actual world. The manual check:

1. Enable the module, open a scene with walls, select an owned token and drag it
   past a corner: the ruler should bend around the wall and the ghost token
   should sit at the end of the green path.
2. Drag at a wall: the token should slide to contact and stop, with a red cross.
3. Spend the actor's movement (`api.state()` / the ruler cost), drag again: the
   next drag should allow twice the rate and the blue remainder should appear.
4. Release: the token should animate along the displayed path and the movement
   cost should appear in the ruler labels / history on another client.
5. Hold left Shift mid-drag: the route becomes a straight line through walls at
the cursor and the drag is no longer clamped; release it and the routed path
returns without moving the mouse.
6. Start a combat and move a combatant 30 ft: `api.state()` should report
`budgetMode: "combat"`, `clampTotal: 60`, and the next drag should allow
another 30 ft.
7. Right-click drag cancel and Escape mid-drag: no overlay or ghost may remain.

Known approximations:

- the token is a disc of half its largest side (`footprintScale` adjusts), so a
  rectangular token may refuse a diagonal gap its corner would hit
- scene walls only; `WallDocument.move`, doors (`ds`) and locked doors are
  handled, wall levels/elevation are not
- elevation changes are not path-found; the route stays at the drag's elevation
- terrain and region movement costs are not used to clip the budget (the native
  ruler still shows the measured cost)
- a door state changed during a drag is only picked up on the next drag move
- GM core "Unconstrained Movement" and teleport-style movement actions bypass
  the module; holding the bypass key does the same for one drag
- the bypass key is Shift, which also turns off Foundry's own drag snapping
- the drag ruler must exist for Foundry to ask for a path; without it the module
  plans in its drag-move fallback, which still commits the route but has no
  native ruler to draw it
