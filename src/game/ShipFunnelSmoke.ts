import { Box3, Camera, Color, Frustum, Group, MathUtils, Matrix4, Object3D, Sphere, Vector3 } from 'three/webgpu';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { systemHealth } from './machinery';
import { localToWorld } from './geometry';
import { motionVelocity } from './session/motion';
import { EffectParticlePool } from './EffectParticles';
import type { ShipView } from './ShipView';
import { EffectLighting } from './EffectLighting';
import { applySmokeSprite, smokeBillowTexture } from './SmokeSpriteMaterial';
import { SmokeRibbons, type RibbonPoint } from './SmokeRibbons';

export interface FunnelOutlet { id: string; position: Vec3; width: number; length: number; bearingRad?: number; }

/** Read the authored funnel rim, including raked jackets, in runtime coordinates.
 * These are visual emission datums, not a second ship definition or uptake simulation. */
export function funnelOutlets(definition: ShipDefinition, model?: Object3D): FunnelOutlet[] {
  const outlets: FunnelOutlet[] = (definition.structures ?? []).filter(s => s.exhaust || /(?:^|-)funnel(?:-jacket)?$/.test(s.id)).map(s => {
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
  // Construction uses retained component sockets, including rotated/raked
  // casings. Read only render datums; propulsion remains native simulation data.
  if (definition.construction && model) {
    model.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(model.matrixWorld).invert();
    const nodes = new Map<string, Object3D>();
    model.traverse(node => { if (node.userData.nodeId) nodes.set(node.userData.nodeId, node); });
    for (const instance of definition.construction.equipment) {
      const module = definition.modules.find(m => m.id === instance.id && m.role === 'boiler');
      const socket = nodes.get(`${instance.id}.socket.exhaust-out`);
      if (!module || !socket || outlets.some(o => o.id === instance.id)) continue;
      let owner: Object3D | null = socket;
      while (owner && owner !== model && !Number.isFinite(owner.userData.funnelOutletWidthM)) owner = owner.parent;
      const transform = new Matrix4().multiplyMatrices(inverse, socket.matrixWorld);
      const width = owner?.userData.funnelOutletWidthM ?? Math.min(module.size[0], module.size[2]) * .65;
      const length = owner?.userData.funnelOutletLengthM ?? Math.max(module.size[0], module.size[2]) * .65;
      if (!(width > 0 && length > 0 && Number.isFinite(width) && Number.isFinite(length))) continue;
      outlets.push({ id: instance.id, position: new Vector3().setFromMatrixPosition(transform).toArray() as Vec3,
        width, length, bearingRad: Math.atan2(-transform.elements[8], transform.elements[0]) });
    }
  }
  return outlets;
}

type SmokeShip = Pick<ShipView, 'actor' | 'definition' | 'motion'> & Partial<Pick<ShipView, 'model'>>;

/** A released plume sample: the ribbon's spine. It moves with the air once it leaves the rim. */
interface TrailPoint extends RibbonPoint { velocity: Vector3; life: number; width0: number; opacity0: number; }
interface Emitter {
  outlet: FunnelOutlet; previous: Vector3; credit: number; initialized: boolean;
  /** Ring of released samples in release order, oldest at `first`. */
  trail: TrailPoint[]; first: number; size: number; trailCredit: number; along: number;
}
interface ShipState { damage: SmokeShip['actor']['damage']; funnels: Emitter[]; speed: number; soot: number; }

const SPRITES = 6144;
/** Plume samples per funnel, one every TRAIL_INTERVAL seconds: up to about 85 s of drifting trail. */
const TRAIL_POINTS = 90, TRAIL_INTERVAL = 1;
/** Beyond this camera distance near-field billows thin out and the ribbon carries the plume. */
const SPRITE_LOD_M = 1400;
// Exhaust leaves the rim fast and hot, loses its momentum to the air within a couple of
// seconds and keeps only a slow buoyant rise, so the column bends over downwind.
const DRAG = .45, BUOYANCY = .12, INHERIT = .3;
const CRUISE = new Color('#bdbdba'), WORKING = new Color('#8f8f8d'), SOOT = new Color('#2b2a29');
const trailPoint = (): TrailPoint => ({ position: new Vector3(), velocity: new Vector3(), color: new Color(), width: 0, width0: 0, opacity: 0, opacity0: 0, along: 0, age: 0, spent: 0, life: 1 });

/** Exhaust from every funnel in the fleet. Lit near-field billows (one sprite batch) boil off the
 * rim; a continuous ribbon (one draw) carries the same plume downwind for about a kilometre, so a
 * ship trails a visible streak at range. Both are lit by the shared scene light and fade softly
 * into the funnel, superstructure and sea. Colour and density follow the machinery: light haze at
 * rest, heavier working smoke at speed, a sooty burst when working up, black smoke from damaged
 * boilers, and nothing once the plant is dead or the rim is under water. */
export class ShipFunnelSmoke {
  readonly root = new Group();
  private readonly map = smokeBillowTexture();
  private readonly pool = new EffectParticlePool(SPRITES, this.map, false, undefined, false, true);
  private readonly ribbons: SmokeRibbons;
  private readonly emitters = new Map<SmokeShip, ShipState>();
  private readonly position = new Vector3();
  private readonly origin = new Vector3();
  private readonly cameraPosition = new Vector3();
  private readonly albedo = new Color();
  private readonly head = trailPoint();
  private readonly ordered: TrailPoint[] = [];
  private readonly frustum = new Frustum();
  private readonly projection = new Matrix4();
  private readonly box = new Box3();
  private readonly sphere = new Sphere();
  private seed = 1;

  private readonly wind: Vector3;
  /** Scene light, wind and depth shared with combat effects and ship fires. */
  constructor(readonly lighting = new EffectLighting()) {
    this.wind = lighting.wind;
    this.root.name = 'Ship funnel exhaust';
    this.ribbons = new SmokeRibbons(lighting);
    this.pool.mesh.name = 'Drifting funnel smoke';
    applySmokeSprite(this.pool.mesh.material, lighting, this.map);
    // The trail draws first; nearer billows composite over it.
    this.root.add(this.ribbons.mesh, this.pool.mesh);
  }

  /** Emission rate multiplier from the combat effects setting. */
  density = 1;
  setWind(speed: number, direction: number): void { this.lighting.setWind(speed, direction); }

  update(ships: readonly SmokeShip[], dt: number, camera: Camera, hiddenSourceId?: string): void {
    // Replacement damage state is the simulation's reset boundary. Discard the
    // old voyage's smoke instead of connecting it to a teleported hull in port.
    let known = 0, stale = false;
    for (const ship of ships) {
      const state = this.emitters.get(ship);
      if (!state) continue;
      known++;
      if (state.damage !== ship.actor.damage) stale = true;
    }
    if (stale || known !== this.emitters.size) this.reset();
    const step = Math.max(0, Math.min(dt, .1));
    this.pool.advance(step, this.wind);
    camera.getWorldPosition(this.cameraPosition);
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    this.ribbons.begin(camera);
    for (const ship of ships) {
      let state = this.emitters.get(ship);
      if (!state) {
        state = { damage: ship.actor.damage, speed: ship.motion.speed, soot: 0, funnels: funnelOutlets(ship.definition, ship.model).map(outlet => ({
          outlet, previous: new Vector3(), credit: 0, initialized: false, first: 0, size: 0, trailCredit: 0, along: 0,
          trail: Array.from({ length: TRAIL_POINTS }, trailPoint) })) };
        this.emitters.set(ship, state);
      }
      if (!state.funnels.length) continue;
      const power = ship.actor.damage.sunk ? 0 : systemHealth(ship.actor, ship.definition, 'engine');
      const { forwardSpeed, reverseSpeed } = ship.definition.handling;
      const load = Math.min(1, Math.abs(ship.motion.speed) / (ship.motion.speed < 0 ? reverseSpeed : forwardSpeed));
      // Working up to speed makes smoke; so do damaged boilers, however slow the ship.
      if (step > 0) {
        const target = Math.min(1, Math.max(0, (Math.abs(ship.motion.speed) - Math.abs(state.speed)) / step) / (forwardSpeed * .015));
        state.soot += (target - state.soot) * (1 - Math.exp(-step / (target > state.soot ? .8 : 5)));
        state.speed = ship.motion.speed;
      }
      const soot = Math.max(state.soot * .9, 1 - MathUtils.smoothstep(power, .35, .92));
      this.albedo.copy(CRUISE).lerp(WORKING, load).lerp(SOOT, soot);
      const thickness = (.5 + load * .22 + soot * .28) * Math.sqrt(Math.max(0, power));
      const velocity = motionVelocity(ship.motion);
      const hidden = hiddenSourceId !== undefined && ship.motion.id === hiddenSourceId;
      for (const emitter of state.funnels) {
        const { outlet } = emitter;
        this.origin.set(...localToWorld(outlet.position, ship.motion));
        if (!emitter.initialized || emitter.previous.distanceToSquared(this.origin) > 10000) {
          emitter.previous.copy(this.origin); emitter.credit = 0; emitter.trailCredit = TRAIL_INTERVAL;
          emitter.size = 0; emitter.initialized = true;
        }
        const alive = power > .01 && this.origin.y > .3;
        const lod = MathUtils.clamp(SPRITE_LOD_M / Math.max(1, this.cameraPosition.distanceTo(this.origin)), .12, 1);
        const mouth = Math.max(1.5, outlet.width * .9);
        if (alive && step > 0) {
          const rate = (3.8 + load * 4.5 + soot * 5) * Math.sqrt(power) * this.density * lod, interval = 1 / rate;
          emitter.credit += step;
          while (emitter.credit + 1e-9 >= interval) {
            emitter.credit = Math.max(0, emitter.credit - interval);
            this.position.lerpVectors(emitter.previous, this.origin, 1 - emitter.credit / step);
            // Spread within the uptake, including a carrier's long funnel mouth.
            const across = (this.random() - .5) * outlet.width * .4, along = (this.random() - .5) * outlet.length * .5;
            const heading = ship.motion.heading + (outlet.bearingRad ?? 0);
            const sin = Math.sin(heading), cos = Math.cos(heading);
            this.position.x += across * cos - along * sin;
            this.position.z += across * sin + along * cos;
            const p = this.pool.emit(this.position, ship.motion.id);
            // Distant funnels shed fewer, larger billows; the ribbon carries the plume there.
            p.size = mouth * (.6 + this.random() * .7) / Math.sqrt(lod); p.stretch = .85 + this.random() * .35;
            p.growth = mouth * (1.1 + load * .5 + soot * .6); p.growthDecay = .32; p.diffusion = .45 + soot * .2;
            p.life = 7.5 + load * 2 + this.random() * 2.5;
            p.velocity.set(velocity[0] * INHERIT + (this.random() - .5) * 1.4, 4 + load * 3 + soot * 2 + this.random() * 1.5,
              velocity[2] * INHERIT + (this.random() - .5) * 1.4);
            p.drag = DRAG; p.gravity = -BUOYANCY; p.wind = 1;
            p.opacity = thickness * (.62 + this.random() * .25); p.fadeIn = .1;
            p.color.copy(this.albedo).multiplyScalar(.9 + this.random() * .18);
            p.angle = this.random() * Math.PI * 2; p.spin = (this.random() - .5) * .22;
          }
        } else if (!alive) emitter.credit = 0;
        this.advanceTrail(emitter, step);
        if (alive && step > 0) {
          emitter.trailCredit += step;
          while (emitter.trailCredit + 1e-9 >= TRAIL_INTERVAL) {
            emitter.trailCredit -= TRAIL_INTERVAL;
            const age = Math.max(0, emitter.trailCredit);
            this.position.lerpVectors(emitter.previous, this.origin, 1 - age / step);
            const newest = emitter.size ? emitter.trail[(emitter.first + emitter.size - 1) % TRAIL_POINTS] : undefined;
            // The released smoke's own spacing, so turbulence keeps its world scale whether the plume is
            // stretched by speed or bunched into a rising column.
            emitter.along += newest ? Math.max(.3, newest.position.distanceTo(this.position)) : 0;
            const released = this.release(emitter);
            released.position.copy(this.position); released.age = 0;
            released.velocity.set(velocity[0] * INHERIT, 4 + load * 3 + soot * 2, velocity[2] * INHERIT);
            released.width0 = mouth; released.opacity0 = thickness; released.color.copy(this.albedo);
            released.along = emitter.along; released.life = 60 + load * 25;
            this.integrate(released, age);
          }
        } else if (!alive) emitter.trailCredit = TRAIL_INTERVAL;
        if (!hidden) this.drawTrail(emitter, alive ? this.origin : undefined, mouth, lod);
        emitter.previous.copy(this.origin);
      }
    }
    this.ribbons.end();
    this.pool.publish(camera, hiddenSourceId);
  }

  /** The next slot in release order, giving up the oldest sample when the ring is full. */
  private release(emitter: Emitter): TrailPoint {
    if (emitter.size === TRAIL_POINTS) { emitter.first = (emitter.first + 1) % TRAIL_POINTS; emitter.size--; }
    return emitter.trail[(emitter.first + emitter.size++) % TRAIL_POINTS];
  }

  private advanceTrail(emitter: Emitter, step: number): void {
    if (step <= 0) return;
    for (let i = 0; i < emitter.size; i++) this.integrate(emitter.trail[(emitter.first + i) % TRAIL_POINTS], step);
    while (emitter.size && emitter.trail[emitter.first].age >= emitter.trail[emitter.first].life) {
      emitter.first = (emitter.first + 1) % TRAIL_POINTS; emitter.size--;
    }
  }

  /** Drag toward the moving air plus a slow buoyant rise, integrated exactly (frame-rate independent). */
  private integrate(p: TrailPoint, step: number): void {
    if (step <= 0) return;
    const decay = Math.exp(-DRAG * step), travel = (1 - decay) / DRAG, terminal = -BUOYANCY / DRAG;
    p.position.x += p.velocity.x * travel + this.wind.x * step;
    p.position.z += p.velocity.z * travel + this.wind.z * step;
    p.position.y += (p.velocity.y + terminal) * travel - terminal * step;
    p.velocity.x *= decay; p.velocity.z *= decay;
    p.velocity.y = (p.velocity.y + terminal) * decay - terminal;
    p.age += step;
  }

  private drawTrail(emitter: Emitter, mouth: Vector3 | undefined, width: number, lod: number): void {
    if (!emitter.size) return;
    // Cheap early cull from every eighth sample: offscreen plumes keep drifting but skip all strip work.
    this.box.makeEmpty();
    if (mouth) this.box.expandByPoint(mouth);
    for (let i = 0; i < emitter.size; i += 8) this.box.expandByPoint(emitter.trail[(emitter.first + i) % TRAIL_POINTS].position);
    const oldest = emitter.trail[emitter.first];
    this.box.expandByPoint(emitter.trail[(emitter.first + emitter.size - 1) % TRAIL_POINTS].position);
    this.box.getBoundingSphere(this.sphere);
    // Margin: the widest (oldest) section plus how far eight samples can bow out between those taken.
    this.sphere.radius += oldest.width0 * 3 + .65 * oldest.age + 60;
    if (!this.frustum.intersectsSphere(this.sphere)) return;
    const ordered = this.ordered;
    let count = 0;
    for (let i = 0; i < emitter.size; i++) {
      const p = emitter.trail[(emitter.first + i) % TRAIL_POINTS], t = p.age;
      // Turbulent spreading: fast at first, then steady diffusion that keeps widening downwind.
      p.width = p.width0 * (1 + 1.9 * (1 - Math.exp(-t / 5))) + .8 * t;
      // A wide plume sampled more finely than a fraction of its width folds over itself wherever its
      // direction wobbles; a distant one needs no more spine than the screen can show. Keep samples
      // a quarter-width apart, and about a degree apart as seen from the camera.
      const kept = count ? ordered[count - 1] : undefined;
      if (kept && i < emitter.size - 1) {
        const spacing = Math.max(Math.min(p.width, kept.width) * .25, p.position.distanceTo(this.cameraPosition) * .015);
        if (p.position.distanceToSquared(kept.position) < spacing * spacing) continue;
      }
      // Hidden under the billows near the rim; alone where the billows thin with distance.
      const emerge = MathUtils.lerp(MathUtils.smoothstep(t, 1.5, 6), MathUtils.smoothstep(t, 0, 1.5), 1 - lod);
      p.spent = Math.min(1, t / p.life);
      p.opacity = p.opacity0 * emerge * Math.pow(p.width0 / p.width, .35) * (1 - MathUtils.smoothstep(p.spent, .7, 1));
      ordered[count++] = p;
    }
    // A trail younger than its life has an unfaded first sample: taper the oldest end so it
    // trails off instead of stopping in a straight edge across the plume.
    let run = 0;
    for (let i = 0; i < count; i++) {
      if (i) run += ordered[i].position.distanceTo(ordered[i - 1].position);
      ordered[i].opacity *= MathUtils.smoothstep(run, 0, Math.max(40, ordered[i].width * 1.5));
    }
    if (mouth && count) {
      const head = this.head, newest = ordered[count - 1];
      head.position.copy(mouth); head.width = width; head.opacity = 0; head.color.copy(newest.color);
      head.along = newest.along + Math.max(.3, newest.position.distanceTo(mouth)); head.age = 0; head.spent = 0;
      ordered[count++] = head;
    }
    this.ribbons.strip(ordered, count);
  }

  private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  diagnostics() { return { particles: this.pool.count, capacity: this.pool.capacity, trailSegments: this.ribbons.segments,
    outlets: [...this.emitters].flatMap(([ship, state]) => state.funnels.map(e => ({ shipId: ship.motion.id, id: e.outlet.id, position: localToWorld(e.outlet.position, ship.motion) }))) }; }
  reset(): void { this.pool.reset(); this.ribbons.reset(); this.emitters.clear(); this.seed = 1; }
  dispose(): void { this.pool.dispose(); this.ribbons.dispose(); this.map.dispose(); this.emitters.clear(); }
}
