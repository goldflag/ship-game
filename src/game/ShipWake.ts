import { Camera, Mesh, Vector3, type Node, type Object3D, type Scene } from 'three/webgpu';
import { max } from 'three/tsl';
import { WaterSurfaceMaterial, type WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import { BISMARCK, type ShipState } from '../simulation/ship';
import { WakeFoam } from './WakeFoam';

/** Render-side wake configuration; driven by ship motion, independent of the helm. */
export class ShipWake {
  private readonly anchor = new Camera();
  private readonly bow: number;
  private readonly stern: number;
  private readonly foam: WakeFoam;
  private readonly materials = new Set<WaterSurfaceMaterial>();

  constructor(private readonly wake: WaterSystem['wake'], ship: Object3D, scene: Scene) {
    // The default 100 m camera-centered field misses a 250 m hull in chase view.
    // Anchor a larger field to the ship so orbiting/zooming cannot erase its trail.
    this.anchor.position.set(ship.position.x, 1, ship.position.z);
    this.anchor.rotation.x = -Math.PI / 2;
    wake.setCamera(this.anchor);
    wake.worldSize = 1536;
    // Retain the selected quality's grid resolution: expanding world coverage
    // does not increase the number of cells dispatched per wake solve.
    this.bow = wake.addGenerator(ship, {
      active: false, depth: 0.32, radius: 10, offset: new Vector3(0, 0, -112), teleportThreshold: 100,
    });
    this.stern = wake.addGenerator(ship, {
      active: false, depth: 0.18, radius: 14, offset: new Vector3(0, 0, 112), teleportThreshold: 100,
    });
    wake.friction = 0.065;
    wake.foamBreakThreshold = 0.09;
    wake.foamStrength = 1.2;
    wake.foamPersistence = Math.exp(-(1 / 60) / 9);
    this.foam = new WakeFoam(Math.min(wake.resolution, 512));
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

  update(state: Pick<ShipState, 'x' | 'z' | 'heading' | 'speed'>, dt: number): void {
    this.anchor.position.set(state.x, 1, state.z);
    const speed = Math.abs(state.speed);
    const speedRatio = Math.min(speed / BISMARCK.forwardSpeed, 1);
    const active = speed > 0.1;
    const displacement = speedRatio * speedRatio;
    this.wake.updateGenerator(this.bow, { active, depth: 0.32 * displacement });
    this.wake.updateGenerator(this.stern, { active, depth: 0.18 * displacement });
    this.wake.foamStrength = 1.2 * speedRatio;
    // Water Pro's decay is per solve. Express it in seconds so foam lifetime
    // and its coupled injection rate remain consistent across frame rates.
    if (dt > 0) this.wake.foamPersistence = Math.exp(-dt / 9);
    this.foam.update(state, dt);
  }

  reset(): void {
    this.foam.reset();
    // Clear native displacement too when returning to port, even if the
    // reset distance is below the solver's automatic teleport threshold.
    const enabled = this.wake.enabled;
    this.wake.enabled = false;
    this.wake.enabled = enabled;
    for (const id of [this.bow, this.stern]) {
      const generator = this.wake.getGenerators().get(id);
      if (generator) generator.isFirstFrame = true;
    }
  }

  dispose(): void {
    this.wake.removeGenerator(this.bow);
    this.wake.removeGenerator(this.stern);
    this.materials.forEach(material => material.setWakeFieldSampler(this.wake.getSampler()));
    this.foam.dispose();
  }
}
