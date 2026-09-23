import { LinearFilter, Vector4, type Camera, type Node, type Object3D, type Texture } from 'three/webgpu';
import { Fn, If, Loop, float, fwidth, max, mix, mx_noise_float, smoothstep, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import { EMPTY, SLICK_EXTENT, WakeFoam, WAKE_EXTENT, WAKE_TUNING, wakeStampBudget } from './WakeFoam';
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
  /** Turbulence over which churned water goes from clear to its densest foam, and the share of the water that foam
   * covers there: even behind the stern the boil shows green water between the white. */
  foamStart: .05, foamFull: .75, foamCover: .88,
  /** Softness of the foam's edge against the eddies it follows. */
  tear: .1,
  /** Turbulence over which bubble clouds build under the water, and their densest share. */
  bubbleStart: .04, bubbleFull: .7, bubbles: .6,
  /** How far the eddies ragged the bubble clouds' edge, in turbulence. */
  bubbleTear: .18,
  /** Metres the churned water's outline frays, and the wavenumber (rad/m) of that fraying. The trail's own stamps lay
   * its lobes, in proportion to the hull. */
  lobes: 2.5, lobeScale: .35,
  /** The eddies' coarsest wavenumber (cycles/m) and the weight of their finest octave. */
  eddyScale: .11, eddyFine: .45,
  /** Slick paint at which the short waves are stilled completely, and how much of them a full slick stills. */
  slickFull: .15, calm: .75,
  /** Bubble density left along the whole slick: the fine bubbles that linger for minutes keep an old wake a shade
   * lighter than the sea around it, as seen from the air. */
  residue: .08,
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
  /** Each tile's painted extent (minX, minZ, maxX, maxZ): of its churned water, of its slick, and of both. A tile is
   * read only inside them, so the cost follows the trails' area rather than their squares'. */
  private readonly foamBoxValues = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly slickBoxValues = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly boxValues = Array.from({ length: TILES * TILES }, () => new Vector4());
  private readonly foamBoxes = uniformArray<'vec4'>(this.foamBoxValues, 'vec4');
  private readonly slickBoxes = uniformArray<'vec4'>(this.slickBoxValues, 'vec4');
  private readonly boxes = uniformArray<'vec4'>(this.boxValues, 'vec4');
  /** Every tile's painted extent together: the sea outside it skips the tiles. */
  private readonly reach = uniform(new Vector4(1, 1, 0, 0));
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
    const within = (p: Node<'vec2'>, box: Node<'vec4'>) => p.x.greaterThan(box.x).and(p.y.greaterThan(box.y)).and(p.x.lessThan(box.z)).and(p.y.lessThan(box.w));
    const edge = (uv: Node<'vec2'>) => smoothstep(.025, .05, uv.x).mul(float(1).sub(smoothstep(.95, .975, uv.x)))
      .mul(smoothstep(.025, .05, uv.y)).mul(float(1).sub(smoothstep(.95, .975, uv.y)));
    const sway = (p: Node<'vec2'>, f: Node<'float'>, phase: number) => p.x.mul(f).add(p.y.mul(f.mul(.61)).add(phase).sin().mul(1.7)).sin();
    return Fn(() => {
      const at = vec2(x, z), reach = this.reach;
      // Metres per pixel, taken here in uniform control flow: where the eddies fall below a pixel the foam takes their
      // mean coverage instead of aliasing into speckle that averages away to grey.
      const footprint = max(fwidth(at.x), fwidth(at.y));
      const turbulence = float(0).toVar(), slick = float(0).toVar(), foam = float(0).toVar(), bubbles = float(0).toVar();
      // Most of the sea lies outside every trail: one test against their union spares it the tiles.
      If(within(at, reach), () => {
        // The trail is read through a gentle warp, so its outline frays at a few metres instead of following the
        // stamps' smooth edge (the stamps themselves lay the larger lobes).
        const k = knob.lobeScale;
        // A variable, so the loop reads it instead of re-deriving the warp at every use in every iteration.
        const world = at.add(vec2(sway(at, k, 1.3).add(sway(at.yx, k.mul(1.83), 4.1).mul(.5)), sway(at.yx, k.mul(1.19), 2.9).add(sway(at, k.mul(2.07), .7).mul(.5))).mul(knob.lobes)).toVar();
        Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
          // One test per tile for most of the sea; a channel is read only inside what its stamps painted, and inside
          // its square (the green channel is laid wider over the same tile).
          If(within(world, this.boxes.element(i)), () => {
            const bounds = this.bounds.element(i), slickUv = world.sub(this.slickBounds.element(i).xy).div(SLICK_EXTENT).add(.5);
            If(within(world, this.slickBoxes.element(i)).and(inside(slickUv)), () => {
              const wide = this.field.sample(slickUv.add(bounds.zw).div(TILES));
              // The texture matrix is identity: skip its uniform and multiply on every read.
              wide.updateMatrix = false;
              slick.assign(max(slick, wide.g.mul(edge(slickUv))));
            });
            const uv = world.sub(bounds.xy).div(WAKE_EXTENT).add(.5);
            If(within(world, this.foamBoxes.element(i)).and(inside(uv)), () => {
              const tile = this.field.sample(uv.add(bounds.zw).div(TILES));
              tile.updateMatrix = false;
              turbulence.assign(max(turbulence, tile.r.mul(edge(uv))));
            });
          });
        });
        If(turbulence.greaterThan(.01), () => {
          // World-anchored eddies from ten metres down to a metre and a half, evolving slowly (one rate everywhere: a
          // rate that varied with the turbulence would sweep the noise's time axis across every gradient of it and
          // draw contour rings). Foam covers the share of them the turbulence sets, so the churned water is nearly
          // all white behind the stern, tears at its edge and breaks into patches as it decays, instead of fading
          // as a sheet.
          const f = knob.eddyScale, fine = knob.eddyFine, coarse = float(1).sub(fine), time = this.time;
          const eddies = mx_noise_float(vec3(world.mul(f), time.mul(.05))).mul(coarse.mul(.56))
            .add(mx_noise_float(vec3(world.mul(f.mul(2.4)).add(17), time.mul(.09))).mul(coarse.mul(.44)))
            .add(mx_noise_float(vec3(world.mul(f.mul(6)).add(41), time.mul(.16))).mul(fine));
          const pattern = eddies.mul(1.3).add(.5).clamp(0, 1);
          const cover = smoothstep(knob.foamStart, knob.foamFull, turbulence).mul(knob.foamCover), threshold = float(1).sub(cover);
          const resolved = float(1).sub(smoothstep(.15, .6, footprint.mul(f)));
          foam.assign(mix(smoothstep(0, 1, cover), smoothstep(threshold.sub(knob.tear), threshold.add(knob.tear), pattern), resolved));
          bubbles.assign(smoothstep(knob.bubbleStart, knob.bubbleFull, turbulence.add(eddies.mul(knob.bubbleTear))).mul(pattern.mul(.4).add(.6)).mul(knob.bubbles));
        });
      });
      const calm = smoothstep(0, knob.slickFull, slick);
      return vec4(foam, max(bubbles, calm.mul(knob.residue)), calm.mul(knob.calm), 0);
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
    this.reach.value.copy(EMPTY);
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
      const [foamBox, slickBox] = entry.foam.painted, box = this.boxValues[slot], reach = this.reach.value;
      this.foamBoxValues[slot].copy(foamBox); this.slickBoxValues[slot].copy(slickBox);
      box.set(Math.min(foamBox.x, slickBox.x), Math.min(foamBox.y, slickBox.y), Math.max(foamBox.z, slickBox.z), Math.max(foamBox.w, slickBox.w));
      reach.set(Math.min(reach.x, box.x), Math.min(reach.y, box.y), Math.max(reach.z, box.z), Math.max(reach.w, box.w));
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
