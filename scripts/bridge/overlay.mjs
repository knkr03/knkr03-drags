/* overlay.mjs - the part of the drag preview Foundry's ruler doesn't draw.
 *
 * The native TokenRuler already shows the path the token will travel. This
 * overlay adds what the original app showed beyond it:
 *   - the rest of the route past the movement budget, in blue
 *   - a ghost disc where the token actually stops
 *   - a red cross where a move with no route hits a wall
 */

const COLORS = {
  near: 0x22d94f,
  far: 0x5a8cff,
  blocked: 0xff4d55
};

export class PathOverlay {
  constructor() {
    this.graphics = null;
  }

  /** Create the graphics object on the interface group, above tokens. */
  #ensure() {
    const layer = globalThis.canvas?.interface;
    if (!layer) return null;
    if (!this.graphics || this.graphics.destroyed) {
      const PIXI = globalThis.PIXI;
      if (!PIXI) return null;
      this.graphics = new PIXI.Graphics();
      this.graphics.name = "knkr03-drags-overlay";
      this.graphics.eventMode = "none";
      layer.addChild(this.graphics);
    }
    return this.graphics;
  }

  /**
   * Redraw the overlay for the given drag entries.
   * @param {Iterable<{plan: object, radius: number}>} entries
   */
  draw(entries) {
    const g = this.#ensure();
    if (!g) return;
    const PIXI = globalThis.PIXI;
    g.clear();

    for (const { plan, radius } of entries) {
      if (!plan) continue;

      // the route past the movement budget
      if (plan.far && plan.far.length > 1) {
        g.lineStyle({
          width: 2.4,
          color: COLORS.far,
          alpha: 0.85,
          join: PIXI.LINE_JOIN.ROUND,
          cap: PIXI.LINE_CAP.ROUND
        });
        g.moveTo(plan.far[0][0], plan.far[0][1]);
        for (let i = 1; i < plan.far.length; i++) g.lineTo(plan.far[i][0], plan.far[i][1]);

        g.beginFill(COLORS.far, 0.9);
        for (let i = 1; i < plan.far.length - 1; i++) {
          g.drawCircle(plan.far[i][0], plan.far[i][1], 2.6);
        }
        g.endFill();
      }

      // where the move ends, when a budget clipped it
      if (plan.cut) {
        g.lineStyle({ width: 1.4, color: COLORS.near, alpha: 0.9 });
        g.drawCircle(plan.stop[0], plan.stop[1], Math.max(2, radius));
      }

      // where a move with no route hits a wall
      if (!plan.clear && plan.collision?.at) {
        const [x, y] = plan.collision.at;
        g.lineStyle({ width: 2, color: COLORS.blocked, alpha: 1 });
        g.moveTo(x - 6, y - 6);
        g.lineTo(x + 6, y + 6);
        g.moveTo(x + 6, y - 6);
        g.lineTo(x - 6, y + 6);
      }
    }
  }

  /** Erase the overlay but keep it ready for the next drag. */
  clear() {
    this.graphics?.clear();
  }

  /** Remove the graphics object entirely (canvas teardown). */
  destroy() {
    if (!this.graphics) return;
    if (!this.graphics.destroyed) {
      this.graphics.parent?.removeChild(this.graphics);
      this.graphics.destroy();
    }
    this.graphics = null;
  }
}
