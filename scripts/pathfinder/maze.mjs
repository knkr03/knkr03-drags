/* maze.mjs - wall segments plus swept-disc collision and grid A*.
 *
 * This is maze-core.js with every web-facing part removed: no canvas renderer,
 * no map loader, no fetch fallback. What remains is the collision model and the
 * pathfinder, driven by plain data.
 *
 *   const maze = new Maze({segments, width, height, radius});
 *   maze.checkMove(ax, ay, bx, by, r)   // swept disc of radius r from a to b
 *   maze.findPath(ax, ay, bx, by, r)    // waypoints after the start, or null
 *
 * Coordinates are scene pixels: x right, y down.
 */

import { closestOnSegment } from "./geometry.mjs";

/**
 * Contact skin, in px. A blocked move leaves the disc exactly touching a wall,
 * so the next move starts from a position whose clearance is the radius to
 * within rounding error. Moves that start in contact are allowed this much
 * overlap, which is what lets a stopped disc back away from the wall or slide
 * along it. Overlap deeper than this is a real stuck state.
 */
export const CONTACT_SKIN = 0.05;

export class Maze {
  /**
   * @param {object} map
   * @param {number[][]} map.segments   [x1,y1,x2,y2] wall centrelines
   * @param {number} [map.width]        scene width in px
   * @param {number} [map.height]       scene height in px
   * @param {number} [map.radius]       default disc radius in px
   */
  constructor(map) {
    if (!map || !Array.isArray(map.segments)) {
      throw new Error("maze geometry needs a segments array");
    }
    this.segments = map.segments.map(s => s.slice(0, 4));
    this.width = map.width || 0;
    this.height = map.height || 0;
    this.radius = map.radius || map.object_radius || 28;
  }

  /** Distance from (x,y) to the nearest wall, plus which one and where. */
  clearance(x, y) {
    let best = Infinity, index = -1, px = 0, py = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const c = closestOnSegment(x, y, this.segments[i]);
      if (c.distance < best) {
        best = c.distance;
        index = i;
        px = c.x;
        py = c.y;
      }
    }
    return { distance: best, segment: index, point: [px, py] };
  }

  /** Same as clearance() but allocation-free, for the inner loops. */
  _dist(x, y) {
    let best = Infinity;
    const segments = this.segments;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let u = 0;
      if (len2 > 0) {
        u = ((x - x1) * dx + (y - y1) * dy) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
      }
      const qx = x1 + u * dx, qy = y1 + u * dy;
      const d = Math.hypot(x - qx, y - qy);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Sweep a disc of radius r along the straight move a -> b.
   *
   * Returns
   *   clear       true when the whole move is free
   *   t           fraction of the move that is safe (1 when clear)
   *   travelled   distance that can be covered, in px
   *   stop        centre position where the disc must stop
   *   minGap      smallest clearance minus radius along the safe part (px)
   *   collision   null | { segment, at:[x,y], center:[x,y], inside }
   */
  checkMove(ax, ay, bx, by, r) {
    const radius = r === undefined || r === null ? this.radius : r;
    const dx = bx - ax, dy = by - ay;
    const distance = Math.hypot(dx, dy);
    const result = {
      clear: true,
      radius,
      from: [ax, ay],
      to: [bx, by],
      distance,
      travelled: distance,
      t: 1,
      stop: [bx, by],
      minGap: 0,
      minGapAt: [ax, ay],
      collision: null
    };

    const startGap = this._dist(ax, ay) - radius;
    if (distance < 0.25) {
      result.minGap = startGap;
      result.minGapAt = [ax, ay];
      if (startGap < -CONTACT_SKIN) {
        const near = this.clearance(ax, ay);
        result.clear = false;
        result.travelled = 0;
        result.t = 0;
        result.stop = [ax, ay];
        result.collision = { segment: near.segment, at: near.point, center: [ax, ay], inside: true };
      }
      return result;
    }

    const steps = Math.max(1, Math.ceil(distance));
    let minGap = startGap;
    let minAt = 0;

    // Already inside a wall by more than the skin: nothing to salvage.
    if (startGap < -CONTACT_SKIN) {
      const near = this.clearance(ax, ay);
      result.clear = false;
      result.travelled = 0;
      result.t = 0;
      result.stop = [ax, ay];
      result.minGap = startGap;
      result.collision = { segment: near.segment, at: near.point, center: [ax, ay], inside: true };
      return result;
    }

    // Free space starts at 0 for a normal move; a move that begins in contact
    // may ride that contact (backing away, sliding along a wall) until it would
    // dig a further CONTACT_SKIN into the wall.
    const limit = startGap > 0 ? 0 : startGap - CONTACT_SKIN;

    let prevT = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const gap = this._dist(ax + dx * t, ay + dy * t) - radius;
      if (gap <= limit) {
        // refine the contact fraction between prevT (free) and t (blocked)
        let lo = prevT, hi = t;
        for (let k = 0; k < 45; k++) {
          const mid = (lo + hi) * 0.5;
          if (this._dist(ax + dx * mid, ay + dy * mid) - radius > limit) lo = mid;
          else hi = mid;
        }
        const tc = (lo + hi) * 0.5;
        const cx = ax + dx * tc, cy = ay + dy * tc;
        const near = this.clearance(cx, cy);
        result.clear = false;
        result.t = tc;
        result.travelled = distance * tc;
        result.stop = [cx, cy];
        result.minGap = minGap;
        result.minGapAt = [ax + dx * minAt, ay + dy * minAt];
        result.collision = { segment: near.segment, at: near.point, center: [cx, cy], inside: false };
        return result;
      }
      if (gap < minGap) {
        minGap = gap;
        minAt = t;
      }
      prevT = t;
    }

    result.minGap = minGap;
    result.minGapAt = [ax + dx * minAt, ay + dy * minAt];
    return result;
  }

  /** Convenience: is the straight move free for radius r? */
  pathClear(ax, ay, bx, by, r) {
    return this.checkMove(ax, ay, bx, by, r).clear;
  }

  /* ------------------------------------------------------------- A* */

  /**
   * Grid A* for a disc of radius r, then string pulling with the exact
   * swept-disc test.
   *
   * The grid only decides the route in the rough (8-connected, one cell per
   * `cell` px, diagonal moves rejected when either orthogonal neighbour is
   * blocked). Every leg of the returned path is then re-checked with
   * checkMove(), so the polyline is exactly collision-free for the disc even
   * though the grid is coarse.
   *
   * Returns an array of waypoints to visit in order, starting with the first
   * point after the start and ending at (bx,by) when it is reachable, or at the
   * closest reachable point when it is not. Returns null when no route exists.
   *
   * opts: { cell: 8, pad: 3, maxNodes: 60000 }
   */
  findPath(ax, ay, bx, by, r, opts) {
    const options = opts || {};
    const radius = r === undefined || r === null ? this.radius : r;
    const cell = options.cell > 0 ? options.cell : 8;
    const pad = options.pad === undefined ? 3 : Math.max(0, options.pad);
    const need = radius + pad;

    const cols = Math.max(1, Math.ceil(this.width / cell));
    const rows = Math.max(1, Math.ceil(this.height / cell));
    const n = cols * rows;
    if (n < 4) return null;
    this._ensureGrid(n, cols, rows, cell);

    const clear = this._clearance;
    const g = this._g;
    const f = this._f;
    const parent = this._parent;
    const stamp = this._stamp;
    const closed = this._closed;
    const gen = ++this._gen;

    const cxOf = idx => ((idx % cols) + 0.5) * cell;
    const cyOf = idx => (Math.floor(idx / cols) + 0.5) * cell;

    // exact distance from a cell centre to the nearest wall, cached per grid
    const clearOf = idx => {
      let v = clear[idx];
      if (v !== v) {
        v = this._dist(cxOf(idx), cyOf(idx));
        clear[idx] = v;
      }
      return v;
    };

    const cellOf = (x, y) => {
      let ix = Math.floor(x / cell);
      let iy = Math.floor(y / cell);
      if (ix < 0) ix = 0; else if (ix >= cols) ix = cols - 1;
      if (iy < 0) iy = 0; else if (iy >= rows) iy = rows - 1;
      return iy * cols + ix;
    };

    // Nearest cell the disc fits in. A disc resting against a wall sits in a
    // blocked cell centre, so its own cell is often unusable.
    //
    // requireLeg: the leg from (x,y) to the cell must be clear. True for the
    // start, where the disc really is. False for a drop point that may sit
    // inside a wall, where no leg from it can be clear; `bias` is then used to
    // prefer the near side of that wall.
    const nearestNode = (x, y, maxRing, bias, requireLeg) => {
      const home = cellOf(x, y);
      if (clearOf(home) >= need) return home;
      const hx = home % cols;
      const hy = (home - hx) / cols;
      for (let ring = 1; ring <= maxRing; ring++) {
        let best = -1, bestScore = Infinity;
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const ix = hx + dx, iy = hy + dy;
            if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) continue;
            const idx = iy * cols + ix;
            if (clearOf(idx) < need) continue;
            const cx = cxOf(idx), cy = cyOf(idx);
            let score = Math.hypot(cx - x, cy - y);
            if (requireLeg) {
              if (!this.checkMove(x, y, cx, cy, radius).clear) continue;
            } else if (bias) {
              score += 0.3 * Math.hypot(cx - bias[0], cy - bias[1]);
            }
            if (score < bestScore) {
              bestScore = score;
              best = idx;
            }
          }
        }
        if (best >= 0) return best;
      }
      return -1;
    };

    const startNode = nearestNode(ax, ay, 8, null, true);
    if (startNode < 0) return null;
    const goalNode = nearestNode(bx, by, 8, [ax, ay], false);
    if (goalNode < 0) return null;

    const hOf = idx => Math.hypot(cxOf(idx) - bx, cyOf(idx) - by);

    const heap = [];
    const pushIdx = idx => {
      heap.push(idx);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
        i = p;
      }
    };
    const popIdx = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break;
          const t = heap[m]; heap[m] = heap[i]; heap[i] = t;
          i = m;
        }
      }
      return top;
    };

    const DIAG = Math.SQRT2;
    const DIRS = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG]
    ];

    let found = false;
    let expanded = 0;
    const maxNodes = options.maxNodes > 0 ? options.maxNodes : 60000;

    stamp[startNode] = gen;
    g[startNode] = 0;
    f[startNode] = hOf(startNode) * 1.001;
    parent[startNode] = -1;
    pushIdx(startNode);

    while (heap.length) {
      const cur = popIdx();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goalNode) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;

      const ix = cur % cols;
      const iy = (cur - ix) / cols;
      for (let k = 0; k < 8; k++) {
        const nx = ix + DIRS[k][0];
        const ny = iy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nidx = ny * cols + nx;
        if (closed[nidx] === gen) continue;
        if (clearOf(nidx) < need) continue;
        if (DIRS[k][0] !== 0 && DIRS[k][1] !== 0) {
          // no squeezing diagonally between two blocked cells
          if (clearOf(iy * cols + nx) < need) continue;
          if (clearOf(ny * cols + ix) < need) continue;
        }
        const ng = g[cur] + DIRS[k][2] * cell;
        if (stamp[nidx] === gen && ng >= g[nidx]) continue;
        stamp[nidx] = gen;
        g[nidx] = ng;
        parent[nidx] = cur;
        f[nidx] = ng + hOf(nidx) * 1.001;
        pushIdx(nidx);
      }
    }

    if (!found) return null;

    const pts = [];
    for (let idx = goalNode; ; idx = parent[idx]) {
      pts.push([cxOf(idx), cyOf(idx)]);
      if (idx === startNode) break;
    }
    pts.reverse();
    pts[0] = [ax, ay];

    // string pulling: skip every waypoint the disc can see past. A second pass
    // merges the runs the first one left as staircase.
    this._smooth(pts, radius);
    this._smooth(pts, radius);

    // The grid rules only make a cell-to-cell edge *probably* free. Every leg
    // of the answer is now checked exactly, and the path is cut back at the
    // first leg that does graze (so the caller never receives one).
    let keep = 1;
    while (keep < pts.length &&
           this.checkMove(pts[keep - 1][0], pts[keep - 1][1],
                          pts[keep][0], pts[keep][1], radius).clear) keep++;
    if (keep < 2) return null;
    pts.length = keep;

    // finally try to reach the real drop point, which may sit between cells
    const end = pts[pts.length - 1];
    if (Math.hypot(end[0] - bx, end[1] - by) > 0.5) {
      if (this.checkMove(end[0], end[1], bx, by, radius).clear) pts.push([bx, by]);
    } else {
      pts[pts.length - 1] = [bx, by];
    }

    return pts.slice(1);
  }

  /**
   * Conservative straight-line test: true only when the whole line keeps at
   * least `r` of clearance. Samples every `step` px and demands r + step/2,
   * which is safe because the distance field is 1-Lipschitz, and is about 4x
   * cheaper than checkMove. Never accepts a line that checkMove rejects.
   */
  _passes(ax, ay, bx, by, r, step) {
    const s = step > 0 ? step : 8;
    const dx = bx - ax, dy = by - ay;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) return this._dist(ax, ay) >= r;
    const need = r + s * 0.5;
    const n = Math.max(1, Math.ceil(distance / s));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this._dist(ax + dx * t, ay + dy * t) < need) return false;
    }
    return true;
  }

  /**
   * Greedy string pulling: from each anchor, keep the farthest later waypoint
   * the disc can reach in a straight line. The far end is tried first (it
   * usually succeeds), then bisected, so this stays cheap even for a few
   * hundred grid nodes.
   */
  _smooth(pts, radius) {
    const last = pts.length - 1;
    if (last < 2) return pts;
    const STEP = 8;
    const visible = (i, j) => this._passes(pts[i][0], pts[i][1],
      pts[j][0], pts[j][1], radius, STEP);

    let anchor = 0;
    let write = 1;
    while (anchor < last) {
      if (visible(anchor, last)) {
        pts[write++] = pts[last];
        break;
      }
      let good = anchor + 1;
      let step = 2;
      while (anchor + step < last && visible(anchor, anchor + step)) {
        good = anchor + step;
        step *= 2;
      }
      let bad = Math.min(anchor + step, last);
      while (bad - good > 1) {
        const mid = (good + bad) >> 1;
        if (visible(anchor, mid)) good = mid;
        else bad = mid;
      }
      pts[write++] = pts[good];
      anchor = good;
    }
    pts.length = write;
    return pts;
  }

  _ensureGrid(n, cols, rows, cell) {
    const key = cell + ":" + cols + "x" + rows;
    if (this._gridKey !== key) {
      this._gridKey = key;
      this._cols = cols;
      this._rows = rows;
      this._cell = cell;
      this._clearance = new Float32Array(n).fill(NaN);
    }
    if (!this._g || this._g.length < n) {
      this._g = new Float64Array(n);
      this._f = new Float64Array(n);
      this._parent = new Int32Array(n);
      this._stamp = new Int32Array(n);
      this._closed = new Int32Array(n);
    }
    if (this._gen === undefined) this._gen = 0;
  }
}
