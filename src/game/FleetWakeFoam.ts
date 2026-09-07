import { DataTexture, LinearFilter, RedFormat, Vector4, type Camera, type Node } from 'three/webgpu';
import { Fn, If, Loop, float, max, mx_noise_float, smoothstep, texture, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import { WakeFoam, WAKE_EXTENT } from './WakeFoam';
import type { ShipView } from './ShipView';
import type { CombatEvent } from '../simulation/combat';

export type WakeShip = Pick<ShipView, 'root' | 'motion' | 'definition'>;
const TILES = 8;

/** One texture binding for the fleet, with independent world-space tiles so
 * opponents kilometres away retain the same trail detail as the player. */
export class FleetWakeFoam {
  readonly texture: DataTexture;
  private readonly entries = new Map<WakeShip['root'], { foam: WakeFoam; slot: number; version: number }>();
  private readonly centers = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly bounds = uniformArray<'vec4'>(this.centers, 'vec4');
  private readonly count = uniform(0, 'int');
  private readonly time = uniform(0);
  private readonly pixels: Uint8Array;
  private readonly field;

  constructor(private readonly resolution: number) {
    const size = resolution * TILES;
    this.pixels = new Uint8Array(size * size);
    this.texture = new DataTexture(this.pixels, size, size, RedFormat);
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.field = texture(this.texture);
  }

  sample(x: Node<'float'>, z: Node<'float'>): Node<'float'> {
    return Fn(() => {
      const world = vec2(x, z), energy = float(0).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const bounds = this.bounds.element(i);
        const uv = world.sub(bounds.xy).div(WAKE_EXTENT).add(.5);
        If(uv.x.greaterThan(.025).and(uv.x.lessThan(.975)).and(uv.y.greaterThan(.025)).and(uv.y.lessThan(.975)), () => {
          const edge = smoothstep(.025, .05, uv.x).mul(float(1).sub(smoothstep(.95, .975, uv.x)))
            .mul(smoothstep(.025, .05, uv.y)).mul(float(1).sub(smoothstep(.95, .975, uv.y)));
          energy.assign(max(energy, this.field.sample(uv.add(bounds.zw).div(TILES)).r.mul(edge)));
        });
      });
      If(energy.greaterThan(.01), () => {
        const noise = mx_noise_float(vec3(world.mul(.075), this.time.mul(.07)));
        const eddies = mx_noise_float(vec3(world.mul(.028).add(17), this.time.mul(.045)));
        energy.mulAssign(noise.mul(.4).add(eddies.mul(.75)).add(.72).clamp(.2, 1));
      });
      return energy;
    })();
  }

  update(ships: readonly WakeShip[], dt: number, events: readonly CombatEvent[], camera?: Camera): void {
    const roots = new Set(ships.map(ship => ship.root));
    for (const [root, entry] of this.entries) if (!roots.has(root)) {
      entry.foam.dispose(); this.entries.delete(root);
    }
    if (ships.length > TILES * TILES) throw new Error('Fleet exceeds wake atlas capacity');
    if (dt > 0) this.time.value += dt;
    this.count.value = ships.length;
    ships.forEach((ship, slot) => {
      let entry = this.entries.get(ship.root);
      if (!entry) {
        const { length, beam } = ship.definition.hull;
        entry = { foam: new WakeFoam(this.resolution, { length, beam, forwardSpeed: ship.definition.handling.forwardSpeed }), slot: -1, version: -1 };
        this.entries.set(ship.root, entry);
      }
      for (const event of events) {
        if (event.kind === 'aircraft-crash') entry.foam.splash(event.position[0], event.position[2], .65);
        if (event.kind === 'splash') entry.foam.splash(event.position[0], event.position[2], event.shell?.caliberM ?? .38);
      }
      const surface = Math.max(0, Math.min(1, 1 + ship.motion.y / 3));
      const distance = camera ? Math.hypot(ship.motion.x - camera.position.x, ship.motion.y - camera.position.y, ship.motion.z - camera.position.z) : 0;
      // Keep every turn/emission sample, but refresh distant coverage at 5 Hz.
      // Optical magnification restores the nearby 20 Hz rate automatically.
      const apparentDistance = camera ? distance * 2.05 / camera.projectionMatrix.elements[5] : 0;
      entry.foam.update({ ...ship.motion, speed: ship.motion.speed * surface }, dt, apparentDistance > 2500 ? .2 : .05);
      const tx = slot % TILES, ty = Math.floor(slot / TILES);
      this.centers[slot].set(entry.foam.center.x, entry.foam.center.y, tx, ty);
      if (entry.slot === slot && entry.version === entry.foam.texture.version) return;
      const source = entry.foam.texture.image.data as Uint8Array;
      for (let row = 0; row < this.resolution; row++) {
        this.pixels.set(source.subarray(row * this.resolution, (row + 1) * this.resolution),
          (ty * this.resolution + row) * this.resolution * TILES + tx * this.resolution);
      }
      entry.slot = slot; entry.version = entry.foam.texture.version;
      this.texture.needsUpdate = true;
    });
  }

  resetImpacts(): void { this.entries.forEach(entry => entry.foam.resetImpacts()); }
  reset(): void {
    this.entries.forEach(entry => entry.foam.dispose()); this.entries.clear();
    this.count.value = 0; this.time.value = 0;
    this.pixels.fill(0); this.texture.needsUpdate = true;
  }
  dispose(): void { this.reset(); this.texture.dispose(); }
}
