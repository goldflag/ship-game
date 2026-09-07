/** Renderer-free visual cloth: fixed-step Verlet particles, aerodynamic pressure,
 * drag, gravity and structural/shear/bend constraints. The hoist stays pinned. */
export class FlagCloth {
  readonly columns = 12;
  readonly rows = 6;
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  private readonly previous: Float32Array;
  private readonly forces: Float32Array;
  private readonly links: { a: number; b: number; length: number; stiffness: number }[] = [];
  private accumulator = 0;
  private time = 0;
  constructor(readonly width: number, readonly height: number, readonly phase = 0) {
    this.positions = new Float32Array((this.columns + 1) * (this.rows + 1) * 3);
    this.previous = new Float32Array(this.positions.length);
    this.forces = new Float32Array(this.positions.length);
    const triangles: number[] = [];
    const index = (x: number, y: number) => y * (this.columns + 1) + x;
    for (let y = 0; y <= this.rows; y++) for (let x = 0; x <= this.columns; x++) {
      const a = index(x, y);
      for (const [dx, dy, stiffness] of [[1, 0, 1], [0, 1, 1], [1, 1, .85], [-1, 1, .85], [2, 0, .15], [0, 2, .15]]) {
        if (x + dx >= 0 && x + dx <= this.columns && y + dy <= this.rows) {
          this.links.push({ a: a * 3, b: index(x + dx, y + dy) * 3, length: Math.hypot(dx * width / this.columns, dy * height / this.rows), stiffness });
        }
      }
      if (x < this.columns && y < this.rows) {
        const b = index(x + 1, y), c = index(x, y + 1), d = index(x + 1, y + 1);
        triangles.push(a, c, b, b, c, d);
      }
    }
    this.indices = new Uint16Array(triangles);
    this.reset();
  }
  reset(): void {
    for (let y = 0; y <= this.rows; y++) for (let x = 0; x <= this.columns; x++) {
      const i = (y * (this.columns + 1) + x) * 3, u = x / this.columns;
      // A slight initial fold breaks the perfectly edge-on aerodynamic equilibrium.
      this.positions.set([u * this.width, -y / this.rows * this.height, .035 * this.width * Math.sin(u * 8 + this.phase) * u], i);
    }
    this.previous.set(this.positions); this.accumulator = 0; this.time = 0;
  }
  advance(dt: number, wind: readonly number[], gravity: readonly number[] = [0, -9.81, 0]): boolean {
    if (!(dt > 0) || !Number.isFinite(dt)) return false;
    this.accumulator += Math.min(dt, .1);
    const h = 1 / 120;
    let changed = false;
    while (this.accumulator + 1e-9 >= h) {
      this.accumulator -= h; this.time += h; this.step(h, wind, gravity); changed = true;
    }
    return changed;
  }
  private pinned(i: number): boolean { return (i / 3) % (this.columns + 1) === 0; }
  private step(dt: number, wind: readonly number[], gravity: readonly number[]): void {
    const p = this.positions, old = this.previous, f = this.forces;
    const speed = Math.hypot(...wind);
    const horizontalSpeed = Math.max(.001, Math.hypot(wind[0], wind[2]));
    // Gusts and vortex shedding scale to available wind energy; still air stays still.
    const gust = 1 + .14 * Math.sin(this.time * 1.7 + this.phase) + .07 * Math.sin(this.time * 4.1 + this.phase * 2);
    for (let i = 0; i < p.length; i += 3) {
      const u = (i / 3 % (this.columns + 1)) / this.columns;
      const flutter = Math.sin(this.time * (3 + speed * .7) - u * 9 + this.phase) * speed * .09 * u;
      f[i] = gravity[0]; f[i + 1] = gravity[1]; f[i + 2] = gravity[2];
      // Skin drag also acts when the fabric is parallel to the incident airflow.
      for (let axis = 0; axis < 3; axis++) {
        const crosswind = axis === 0 ? -wind[2] / horizontalSpeed : axis === 2 ? wind[0] / horizontalSpeed : .3;
        const relative = wind[axis] * gust + flutter * crosswind - (p[i + axis] - old[i + axis]) / dt;
        f[i + axis] += relative * .9;
      }
    }
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t] * 3, b = this.indices[t + 1] * 3, c = this.indices[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area2 < 1e-9) continue;
      nx /= area2; ny /= area2; nz /= area2;
      const rx = wind[0] * gust - (p[a] - old[a] + p[b] - old[b] + p[c] - old[c]) / (3 * dt);
      const ry = wind[1] * gust - (p[a + 1] - old[a + 1] + p[b + 1] - old[b + 1] + p[c + 1] - old[c + 1]) / (3 * dt);
      const rz = wind[2] * gust - (p[a + 2] - old[a + 2] + p[b + 2] - old[b + 2] + p[c + 2] - old[c + 2]) / (3 * dt);
      const normalSpeed = rx * nx + ry * ny + rz * nz;
      // Air density 1.225 kg/m³, drag coefficient 1.15, cloth 0.22 kg/m².
      // Bound acceleration for abrupt camera/teleport/weather transitions.
      const pressure = Math.max(-110, Math.min(110, .5 * 1.225 * 1.15 / .22 * normalSpeed * Math.abs(normalSpeed) / 6));
      const fx = nx * pressure, fy = ny * pressure, fz = nz * pressure;
      f[a] += fx; f[a + 1] += fy; f[a + 2] += fz;
      f[b] += fx; f[b + 1] += fy; f[b + 2] += fz;
      f[c] += fx; f[c + 1] += fy; f[c + 2] += fz;
    }
    for (let i = 0; i < p.length; i += 3) {
      if (this.pinned(i)) continue;
      for (let axis = 0; axis < 3; axis++) {
        const at = i + axis, position = p[at];
        p[at] += (position - old[at]) * .992 + f[at] * dt * dt;
        old[at] = position;
      }
    }
    for (let iteration = 0; iteration < 6; iteration++) for (const link of this.links) {
      const { a, b, length, stiffness } = link;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const wa = this.pinned(a) ? 0 : 1, wb = this.pinned(b) ? 0 : 1;
      if (!wa && !wb || distance < 1e-9) continue;
      const correction = (distance - length) / distance * stiffness / (wa + wb);
      p[a] += dx * correction * wa; p[a + 1] += dy * correction * wa; p[a + 2] += dz * correction * wa;
      p[b] -= dx * correction * wb; p[b + 1] -= dy * correction * wb; p[b + 2] -= dz * correction * wb;
    }
  }
}
