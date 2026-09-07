const directions: Record<string, readonly [number, number]> = {
  ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

/** Screen-space drag deltas shared by held keys and mouse edge panning. */
export class AirMapNavigation {
  private keys = new Set<string>();
  pointer?: { x: number; y: number };

  key(code: string, down: boolean) {
    if (!directions[code]) return false;
    if (down) this.keys.add(code); else this.keys.delete(code);
    return true;
  }
  clear() { this.keys.clear(); this.pointer = undefined; }

  step(dt: number, width: number, height: number): [number, number] {
    let x = 0, y = 0;
    for (const code of this.keys) { x += directions[code][0]; y += directions[code][1]; }
    const edge = (position: number, extent: number) => {
      const band = Math.min(32, extent / 4);
      return Math.max(0, 1 - position / band) - Math.max(0, 1 - (extent - position) / band);
    };
    const p = this.pointer;
    if (p && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) {
      x += edge(p.x, width); y += edge(p.y, height);
    }
    const speed = 600 * Math.max(0, Math.min(dt, .05)) / Math.max(1, Math.hypot(x, y));
    return [x * speed, y * speed];
  }
}
