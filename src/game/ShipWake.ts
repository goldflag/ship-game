import { Camera, Mesh, Vector3, type Node, type Object3D, type Scene } from 'three/webgpu';
import { max } from 'three/tsl';
import { WaterSurfaceMaterial, type WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import { FleetWakeFoam, type WakeShip } from './FleetWakeFoam';
import type { CombatEvent } from '../simulation/combat';

/** Render-side wake configuration; driven by ship motion, independent of the helm. */
export class ShipWake {
  private readonly anchor = new Camera();
  private readonly generators = new Map<WakeShip['root'], { bow: number; stern: number }>();
  private readonly foam: FleetWakeFoam;
  private readonly materials = new Set<WaterSurfaceMaterial>();
  private eventSequence = 0;

  constructor(private readonly wake: WaterSystem['wake'], ship: Object3D, scene: Scene) {
    // The default 100 m camera-centered field misses a 250 m hull in chase view.
    // Anchor a larger field to the ship so orbiting/zooming cannot erase its trail.
    this.anchor.position.set(ship.position.x, 1, ship.position.z);
    this.anchor.rotation.x = -Math.PI / 2;
    wake.setCamera(this.anchor);
    wake.worldSize = 1536;
    // Retain the selected quality's grid resolution: expanding world coverage
    // does not increase the number of cells dispatched per wake solve.
    wake.friction = 0.065;
    wake.foamBreakThreshold = 0.09;
    wake.foamStrength = 1.2;
    wake.foamPersistence = Math.exp(-(1 / 60) / 9);
    this.foam = new FleetWakeFoam(Math.min(wake.resolution, 256));
    const native = wake.getSampler();
    const sampler: ReturnType<WaterSystem['wake']['getSampler']> = {
      sample: (x, z) => native.sample(x, z),
      sampleNormal: (x, z) => native.sampleNormal(x, z),
      // The vendor declaration erases scalar node types at its public boundary.
      sampleFoamEnergy: (x, z) => max(native.sampleFoamEnergy(x, z) as Node<'float'>,
        this.foam.sample(x as Node<'float'>, z as Node<'float'>)),
    };
    // Use Water Pro's public material sampler hook: the wake shares the real
    // ocean's displacement, lighting, reflections and foam dissolve texture.
    // Game recreates this binding with its water system when quality changes.
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof WaterSurfaceMaterial) this.materials.add(material);
      }
    });
    this.materials.forEach(material => material.setWakeFieldSampler(sampler));
  }

  update(ships: readonly WakeShip[], dt: number, events: readonly CombatEvent[] = [], camera?: Camera): void {
    const freshEvents = events.filter(event => event.sequence > this.eventSequence);
    for (const event of freshEvents) this.eventSequence = Math.max(this.eventSequence, event.sequence);
    const focus = ships[0]?.motion;
    if (focus) this.anchor.position.set(focus.x, 1, focus.z);
    // The pinned vendor solver accepts 16 generators. Give its local swell
    // field to the nearest eight hulls; the foam atlas covers every ship.
    const nearby = ships.filter(ship => Math.abs(ship.motion.x - this.anchor.position.x) < 900
      && Math.abs(ship.motion.z - this.anchor.position.z) < 900)
      .sort((a, b) => Math.hypot(a.motion.x - this.anchor.position.x, a.motion.z - this.anchor.position.z)
        - Math.hypot(b.motion.x - this.anchor.position.x, b.motion.z - this.anchor.position.z)).slice(0, 8);
    const roots = new Set(nearby.map(ship => ship.root));
    for (const [root, ids] of this.generators) if (!roots.has(root)) {
      this.wake.removeGenerator(ids.bow); this.wake.removeGenerator(ids.stern); this.generators.delete(root);
    }
    let strength = 0;
    for (const ship of nearby) {
      let ids = this.generators.get(ship.root);
      if (!ids) {
        const { length, beam } = ship.definition.hull;
        ids = {
          bow: this.wake.addGenerator(ship.root, { active: false, depth: .32, radius: beam * .28, offset: new Vector3(0, 0, -length * .448), teleportThreshold: 100 }),
          stern: this.wake.addGenerator(ship.root, { active: false, depth: .18, radius: beam * .39, offset: new Vector3(0, 0, length * .448), teleportThreshold: 100 }),
        };
        this.generators.set(ship.root, ids);
      }
      const surface = Math.max(0, Math.min(1, 1 + ship.motion.y / 3));
      const speed = Math.abs(ship.motion.speed) * surface;
      const ratio = Math.min(speed / ship.definition.handling.forwardSpeed, 1);
      this.wake.updateGenerator(ids.bow, { active: speed > .1, depth: .32 * ratio * ratio });
      this.wake.updateGenerator(ids.stern, { active: speed > .1, depth: .18 * ratio * ratio });
      strength = Math.max(strength, ratio);
    }
    this.wake.foamStrength = 1.2 * strength;
    if (dt > 0) this.wake.foamPersistence = Math.exp(-dt / 9);
    this.foam.update(ships, dt, freshEvents, camera);
  }

  resetImpacts(): void { this.foam.resetImpacts(); this.eventSequence = 0; }

  reset(): void {
    this.foam.reset();
    this.eventSequence = 0;
    // Clear native displacement too when returning to port, even if the
    // reset distance is below the solver's automatic teleport threshold.
    const enabled = this.wake.enabled;
    this.wake.enabled = false;
    this.wake.enabled = enabled;
    for (const ids of this.generators.values()) for (const id of [ids.bow, ids.stern]) {
      const generator = this.wake.getGenerators().get(id);
      if (generator) generator.isFirstFrame = true;
    }
  }

  dispose(): void {
    for (const ids of this.generators.values()) {
      this.wake.removeGenerator(ids.bow); this.wake.removeGenerator(ids.stern);
    }
    this.generators.clear();
    this.materials.forEach(material => material.setWakeFieldSampler(this.wake.getSampler()));
    this.foam.dispose();
  }
}
