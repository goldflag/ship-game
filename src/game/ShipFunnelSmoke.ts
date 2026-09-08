import { Camera, Group, Vector3 } from 'three/webgpu';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { systemHealth } from '../simulation/machinery';
import { localToWorld } from '../simulation/geometry';
import { motionVelocity } from '../simulation/ship';
import { EffectParticlePool, effectTexture } from './EffectParticles';
import type { ShipView } from './ShipView';

export interface FunnelOutlet { id: string; position: Vec3; width: number; length: number; }

/** Read the authored funnel rim, including raked jackets, in runtime coordinates.
 * These are visual emission datums, not a second ship definition or uptake simulation. */
export function funnelOutlets(definition: ShipDefinition): FunnelOutlet[] {
  return (definition.structures ?? []).filter(s => /(?:^|-)funnel(?:-jacket)?$/.test(s.id)).map(s => {
    if (s.exhaust) return { id: s.id, ...s.exhaust };
    let rim: Vec3[] = s.footprint.map(([x, z]) => [x, s.baseY + s.height, z]);
    if (s.surface) {
      const { vertices, triangles } = s.surface;
      const edges = new Map<string, { a: number; b: number; count: number }>();
      for (const t of triangles) for (let i = 0; i < 3; i++) {
        const a = Math.min(t[i], t[(i + 1) % 3]), b = Math.max(t[i], t[(i + 1) % 3]), key = `${a}:${b}`;
        const edge = edges.get(key);
        if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
      }
      const upper = s.baseY + s.height * .6, indices = new Set<number>();
      for (const { a, b, count } of edges.values()) {
        if (count === 1 && vertices[a][1] > upper && vertices[b][1] > upper) { indices.add(a); indices.add(b); }
      }
      // Closed jackets have a lid instead of an open boundary. Find its upward
      // faces, preserving the full sloping rim rather than just its highest tip.
      if (!indices.size) for (const t of triangles) {
        const [a, b, c] = t.map(i => vertices[i]);
        const ab = new Vector3(...b).sub(new Vector3(...a)), ac = new Vector3(...c).sub(new Vector3(...a));
        const normal = ab.cross(ac);
        if (normal.y > normal.length() * .6 && (a[1] + b[1] + c[1]) / 3 > upper) t.forEach(i => indices.add(i));
      }
      if (indices.size) rim = [...indices].map(i => vertices[i]);
    }
    const minX = Math.min(...rim.map(p => p[0])), maxX = Math.max(...rim.map(p => p[0]));
    const minZ = Math.min(...rim.map(p => p[2])), maxZ = Math.max(...rim.map(p => p[2]));
    return { id: s.id, position: [(minX + maxX) / 2, rim.reduce((sum, p) => sum + p[1], 0) / rim.length + .15, (minZ + maxZ) / 2],
      width: maxX - minX, length: maxZ - minZ };
  });
}

type SmokeShip = Pick<ShipView, 'actor' | 'definition' | 'motion'>;
interface Emitter { outlet: FunnelOutlet; previous: Vector3; credit: number; initialized: boolean; }

/** One bounded fleet batch. Puffs stay in world space after leaving the moving rim. */
export class ShipFunnelSmoke {
  readonly root = new Group();
  private readonly map = effectTexture('smoke');
  private readonly pool = new EffectParticlePool(6144, this.map);
  private readonly emitters = new Map<SmokeShip, { damage: SmokeShip['actor']['damage']; funnels: Emitter[] }>();
  private readonly wind = new Vector3(1.5, 0, 1);
  private readonly position = new Vector3();
  private readonly origin = new Vector3();
  private seed = 1;

  constructor() {
    this.root.name = 'Ship funnel exhaust';
    this.pool.mesh.name = 'Drifting funnel smoke';
    this.root.add(this.pool.mesh);
  }

  setWind(speed: number, direction: number): void {
    this.wind.set(Math.cos(direction), 0, Math.sin(direction)).multiplyScalar(speed * .35);
  }

  update(ships: readonly SmokeShip[], dt: number, camera: Camera, hiddenSourceId?: string): void {
    // Replacement damage state is the simulation's reset boundary. Discard the
    // old voyage's smoke instead of connecting it to a teleported hull in port.
    if (ships.some(ship => this.emitters.has(ship) && this.emitters.get(ship)!.damage !== ship.actor.damage)
      || [...this.emitters.keys()].some(ship => !ships.includes(ship))) this.reset();
    const step = Math.max(0, Math.min(dt, .1));
    this.pool.advance(step, this.wind);
    for (const ship of ships) {
      let state = this.emitters.get(ship);
      if (!state) {
        state = { damage: ship.actor.damage, funnels: funnelOutlets(ship.definition).map(outlet => ({ outlet, previous: new Vector3(), credit: 0, initialized: false })) };
        this.emitters.set(ship, state);
      }
      if (!state.funnels.length) continue;
      const power = ship.actor.damage.sunk ? 0 : systemHealth(ship.actor, ship.definition, 'engine');
      const load = Math.min(1, Math.abs(ship.motion.speed) / (ship.motion.speed < 0 ? ship.definition.handling.reverseSpeed : ship.definition.handling.forwardSpeed));
      const velocity = motionVelocity(ship.motion);
      for (const emitter of state.funnels) {
        const { outlet } = emitter;
        this.origin.set(...localToWorld(outlet.position, ship.motion));
        if (!emitter.initialized || emitter.previous.distanceToSquared(this.origin) > 10000) {
          emitter.previous.copy(this.origin); emitter.credit = 0; emitter.initialized = true;
        }
        if (power > .01 && this.origin.y > .3 && step > 0) {
          const rate = (2.5 + load * 1.5) * Math.sqrt(power), interval = 1 / rate;
          emitter.credit += step;
          while (emitter.credit + 1e-9 >= interval) {
            emitter.credit = Math.max(0, emitter.credit - interval);
            this.position.lerpVectors(emitter.previous, this.origin, 1 - emitter.credit / step);
            // Spread within the uptake, including a carrier's long funnel mouth.
            const across = (this.random() - .5) * outlet.width * .45, along = (this.random() - .5) * outlet.length * .55;
            const sin = Math.sin(ship.motion.heading), cos = Math.cos(ship.motion.heading);
            this.position.x += across * cos - along * sin;
            this.position.z += across * sin + along * cos;
            const p = this.pool.emit(this.position, ship.motion.id);
            const size = Math.max(1.5, outlet.width * .85);
            p.size = size * (.85 + this.random() * .3);
            p.growth = size * (.5 + load * .2); p.growthDecay = .18; p.diffusion = .35;
            p.life = 9 + load * 3;
            p.velocity.set(velocity[0] * .35 + (this.random() - .5) * .7, 2.8 + load * 1.5 + this.random(), velocity[2] * .35 + (this.random() - .5) * .7);
            p.drag = .22; p.gravity = -.35; p.wind = 1;
            p.opacity = .28 + load * .2;
            p.color.set('#858781').multiplyScalar(.9 - load * .3 + this.random() * .12);
            p.angle = this.random() * Math.PI * 2; p.spin = (this.random() - .5) * .25;
          }
        } else if (power <= .01 || this.origin.y <= .3) emitter.credit = 0;
        emitter.previous.copy(this.origin);
      }
    }
    this.pool.publish(camera, hiddenSourceId);
  }

  private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  diagnostics() { return { particles: this.pool.count, capacity: this.pool.capacity,
    outlets: [...this.emitters].flatMap(([ship, state]) => state.funnels.map(e => ({ shipId: ship.motion.id, id: e.outlet.id, position: localToWorld(e.outlet.position, ship.motion) }))) }; }
  reset(): void { this.pool.reset(); this.emitters.clear(); this.seed = 1; }
  dispose(): void { this.pool.dispose(); this.map.dispose(); this.emitters.clear(); }
}
