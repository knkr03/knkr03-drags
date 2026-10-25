/* geometry.mjs - polyline and segment maths for the pathfinder.
 *
 * Coordinates are scene pixels: x right, y down. A segment is [x1,y1,x2,y2].
 * This is the part of the original maze app that does not touch the DOM.
 */

/** Closest point on segment s = [x1,y1,x2,y2] to (px,py). */
export function closestOnSegment(px, py, s) {
  const x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3];
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let u = 0;
  if (len2 > 0) {
    u = ((px - x1) * dx + (py - y1) * dy) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
  }
  const qx = x1 + u * dx, qy = y1 + u * dy;
  return { x: qx, y: qy, u, distance: Math.hypot(px - qx, py - qy) };
}

/** Length of segment s = [x1,y1,x2,y2]. */
export function segmentLength(s) {
  return Math.hypot(s[2] - s[0], s[3] - s[1]);
}

/** Point at arc length s along a polyline of [x,y] pairs with cumulative lengths cum. */
export function pointAt(points, cum, s) {
  if (points.length === 1 || s <= 0) return [points[0][0], points[0][1]];
  for (let k = 1; k < points.length; k++) {
    if (cum[k] >= s) {
      const seg = cum[k] - cum[k - 1];
      const f = seg > 1e-9 ? (s - cum[k - 1]) / seg : 0;
      return [
        points[k - 1][0] + (points[k][0] - points[k - 1][0]) * f,
        points[k - 1][1] + (points[k][1] - points[k - 1][1]) * f
      ];
    }
  }
  const e = points[points.length - 1];
  return [e[0], e[1]];
}

/**
 * Cumulative arc lengths of a polyline.
 * @param {number[][]} points  [x,y] pairs
 * @returns {{points: number[][], cum: number[], length: number}}
 */
export function polyline(points) {
  const cum = [0];
  let length = 0;
  for (let k = 1; k < points.length; k++) {
    length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    cum.push(length);
  }
  return { points, cum, length };
}

/**
 * Split a polyline at arc length s into the part it can reach and the rest.
 * `far` is null when the whole line is within s.
 */
export function clipPath(points, cum, s) {
  const near = [points[0]];
  let far = null;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    if (far) {
      far.push(b);
      continue;
    }
    if (cum[k] <= s) {
      near.push(b);
      continue;
    }
    const seg = cum[k] - cum[k - 1];
    const f = seg > 1e-9 ? (s - cum[k - 1]) / seg : 0;
    const cut = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const last = near[near.length - 1];
    if (Math.hypot(cut[0] - last[0], cut[1] - last[1]) > 1e-9) near.push(cut);
    far = [cut, b];
  }
  return { near, far };
}
