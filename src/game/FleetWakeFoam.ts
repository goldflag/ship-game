import { LinearFilter, Vector4, type Camera, type Node, type Object3D, type Texture } from 'three/webgpu';
import { Fn, If, Loop, float, max, mx_noise_float, smoothstep, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import { SLICK_EXTENT, WakeFoam, WAKE_EXTENT, WAKE_TUNING, wakeStampBudget } from './WakeFoam';
import type { ShipDefinition } from '../ships/blueprint';
import { WakeStampCollector, type WakeFoamPainter, type WakeFoamPainterFactory } from './WakeFoamGpu';
import { wakeHull } from './wakeHull';
import type { ShipState, CombatEvent } from '../game/session/elements';

/** Any drawn hull with a pose and a definition leaves a wake: a simulated actor's
 * view or a report-only exterior alike. The root identifies the trail between frames. */
export interface WakeShip {
  root: Object3D;
  motion: Pick<ShipState, 'x' | 'y' | 'z' | 'heading' | 'speed'>;
  definition: Pick<ShipDefinition, 'hull' | 'handling'>;
}
const TILES = 8;
/** Trails the atlas can hold at once. */
export const WAKE_ATLAS_CAPACITY = TILES * TILES;

/** How the realistic wake's channels read on the water (`OceanRealism.wake`). Visual values; live. */
export const WAKE_SHADING = {
  /** Turbulence, torn by the eddies, at which churned water starts to foam and where the foam is solid. */
  foamStart: .28, foamFull: .62,
  /** How far the eddies tear the foam's edge, in turbulence: dense at the core, ragged where it thins. */
  tear: .38,
  /** Turbulence over which bubble clouds build under the water, and their densest share. */
  bubbleStart: .015, bubbleFull: .45, bubbles: .85,
  /** Slick paint at which the short waves are stilled completely, and how much of them a full slick stills. */
  slickFull: .3, calm: .85,
};
type ShadingKey = keyof typeof WAKE_SHADING;
const knob = (value: number) => uniform(value);

/** One texture binding for the fleet, with independent world-space tiles so
 * opponents kilometres away retain the same trail detail as the player. */
export class FleetWakeFoam {
  readonly texture: Texture;
  private readonly entries = new Map<WakeShip['root'], { foam: WakeFoam; collector: WakeStampCollector; slot: number; version: number }>();
  private readonly centers = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly bounds = uniformArray<'vec4'>(this.centers, 'vec4');
  /** Each tile's slick square centre (x, z). */
  private readonly slickCenters = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly slickBounds = uniformArray<'vec4'>(this.slickCenters, 'vec4');
  private readonly count = uniform(0, 'int');
  private readonly time = uniform(0);
  private readonly field;
  private readonly painter: WakeFoamPainter;
  private readonly reads = new WeakMap<Node, WeakMap<Node, Node<'vec4'>>>();
  private readonly knobs = Object.fromEntries(Object.entries(WAKE_SHADING).map(([key, value]) => [key, knob(value)])) as Record<ShadingKey, ReturnType<typeof knob>>;
  private dirty = true;
  private churned = false;
  /** Whether trails still paint the bow-shoulder crests; off while the analytic bow waves draw them. */
  bowShoulders = true;
  /** Live shape of the realistic trails (stamps) and how they read on the water (shading). */
  readonly tuning = { stamps: { ...WAKE_TUNING }, shading: { ...WAKE_SHADING } };

  /** `painter` draws the atlas: `gpuWakeFoamPainter(renderer)` in the game. Its green channel holds the slicks. */
  constructor(private readonly resolution: number, painter: WakeFoamPainterFactory) {
    this.painter = painter(resolution, TILES, 2);
    this.texture = this.painter.texture;
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
          const tile = this.field.sample(uv.add(bounds.zw).div(TILES));
          // The texture matrix is identity: skip its uniform and multiply on every read.
          tile.updateMatrix = false;
          energy.assign(max(energy, tile.r.mul(edge)));
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

  /** Paint the realistic wake: continuous churned water, bubble clouds and a slick (`read`), instead of `sample`'s
   * translucent streams. */
  get realistic(): boolean { return this.churned; }
  set realistic(value: boolean) {
    if (value === this.churned) return;
    this.churned = value;
    for (const entry of this.entries.values()) entry.foam.realistic = value;
    this.dirty = true;
  }

  /** The realistic wake at a world point: (foam energy, bubble cloud density, slick 0–1, 0). One evaluation per
   * (x, z) node pair, so the surface's foam, bubble and slick reads share one pass over the atlas. */
  read(x: Node<'float'>, z: Node<'float'>): Node<'vec4'> {
    let byZ = this.reads.get(x);
    if (!byZ) this.reads.set(x, byZ = new WeakMap());
    let value = byZ.get(z);
    if (!value) byZ.set(z, value = this.evaluate(x, z));
    return value;
  }

  private evaluate(x: Node<'float'>, z: Node<'float'>): Node<'vec4'> {
    const knob = this.knobs;
    const inside = (uv: Node<'vec2'>) => uv.x.greaterThan(.025).and(uv.x.lessThan(.975)).and(uv.y.greaterThan(.025)).and(uv.y.lessThan(.975));
    const edge = (uv: Node<'vec2'>) => smoothstep(.025, .05, uv.x).mul(float(1).sub(smoothstep(.95, .975, uv.x)))
      .mul(smoothstep(.025, .05, uv.y)).mul(float(1).sub(smoothstep(.95, .975, uv.y)));
    return Fn(() => {
      const world = vec2(x, z), turbulence = float(0).toVar(), slick = float(0).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const bounds = this.bounds.element(i), uv = world.sub(bounds.xy).div(WAKE_EXTENT).add(.5);
        If(inside(uv), () => {
          const tile = this.field.sample(uv.add(bounds.zw).div(TILES));
          tile.updateMatrix = false;
          turbulence.assign(max(turbulence, tile.r.mul(edge(uv))));
        });
        // The same tile's green channel, laid over its wider slick square.
        const slickUv = world.sub(this.slickBounds.element(i).xy).div(SLICK_EXTENT).add(.5);
        If(inside(slickUv), () => {
          const tile = this.field.sample(slickUv.add(bounds.zw).div(TILES));
          tile.updateMatrix = false;
          slick.assign(max(slick, tile.g.mul(edge(slickUv))));
        });
      });
      const foam = float(0).toVar(), bubbles = float(0).toVar();
      If(turbulence.greaterThan(.01), () => {
        // World-anchored eddies from tens of metres down to a few, drifting slowly: they tear the churned water's
        // edge and break its thinning remains into patches, while the dense core stays white.
        const eddies = mx_noise_float(vec3(world.mul(.032), this.time.mul(.05))).mul(.5)
          .add(mx_noise_float(vec3(world.mul(.085).add(17), this.time.mul(.09))).mul(.32))
          .add(mx_noise_float(vec3(world.mul(.23).add(41), this.time.mul(.16))).mul(.18));
        foam.assign(smoothstep(knob.foamStart, knob.foamFull, turbulence.add(eddies.mul(knob.tear))));
        bubbles.assign(smoothstep(knob.bubbleStart, knob.bubbleFull, turbulence).mul(eddies.mul(.35).add(.8).clamp(0, 1)).mul(knob.bubbles));
      });
      return vec4(foam, bubbles, smoothstep(0, knob.slickFull, slick).mul(knob.calm), 0);
    })();
  }

  update(ships: readonly WakeShip[], dt: number, events: readonly CombatEvent[], camera?: Camera): void {
    for (const key of Object.keys(this.knobs) as ShadingKey[]) this.knobs[key].value = this.tuning.shading[key];
    const roots = new Set(ships.map(ship => ship.root));
    for (const [root, entry] of this.entries) if (!roots.has(root)) {
      entry.foam.dispose(); this.entries.delete(root); this.dirty = true;
    }
    if (ships.length > WAKE_ATLAS_CAPACITY) throw new Error('Fleet exceeds wake atlas capacity');
    if (dt > 0) this.time.value += dt;
    this.count.value = ships.length;
    ships.forEach((ship, slot) => {
      let entry = this.entries.get(ship.root);
      if (!entry) {
        const hull = wakeHull(ship.definition.hull);
        const collector = new WakeStampCollector();
        collector.reserve(wakeStampBudget(Math.max(ship.definition.handling.forwardSpeed, ship.definition.handling.reverseSpeed)));
        entry = { foam: new WakeFoam(this.resolution, { ...hull, forwardSpeed: ship.definition.handling.forwardSpeed }, collector), collector, slot: -1, version: -1 };
        entry.foam.tuning = this.tuning.stamps; entry.foam.realistic = this.churned;
        this.entries.set(ship.root, entry);
      }
      entry.foam.bowShoulders = this.bowShoulders;
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
      this.slickCenters[slot].set(entry.foam.slickCenter.x, entry.foam.slickCenter.y, 0, 0);
      // A trail's texture version moves whenever it rasterises new stamps.
      if (entry.slot === slot && entry.version === entry.foam.texture.version) return;
      this.dirty = true;
      entry.slot = slot; entry.version = entry.foam.texture.version;
    });
    if (this.dirty) {
      // Reserve a full trail at each hull's maximum speed during loading. Growth
      // remains supported if a later scenario exceeds this preparation estimate.
      this.painter.reserve(ships.reduce((count, ship) => count + wakeStampBudget(Math.max(ship.definition.handling.forwardSpeed, ship.definition.handling.reverseSpeed)), 0));
      this.painter.update(ships.map(ship => this.entries.get(ship.root)!.collector));
      this.dirty = false;
    }
  }

  diagnostics() { return this.painter.diagnostics(); }

  /** Where a hull's trail sits in the atlas: its tile and the centres of its foam and slick squares. For checks. */
  frame(root: WakeShip['root']) {
    const entry = this.entries.get(root);
    return entry && { slot: entry.slot, center: entry.foam.center.clone(), slickCenter: entry.foam.slickCenter.clone() };
  }

  resetImpacts(): void { this.entries.forEach(entry => entry.foam.resetImpacts()); }
  reset(): void {
    this.entries.forEach(entry => entry.foam.dispose()); this.entries.clear();
    this.count.value = 0; this.time.value = 0;
    this.dirty = true;
  }
  dispose(): void { this.reset(); this.painter.dispose(); }
}
