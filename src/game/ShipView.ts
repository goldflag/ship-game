import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { barrelIds } from '../ships/blueprint';
import type { Combatant } from '../simulation/damage';
import { radians, wrapAngle } from '../simulation/geometry';
import { muzzleWorld, shotDirection } from '../simulation/weapons';
import { ShipInspection } from './ShipInspection';
import type { InspectionMode } from '../ships/inspection';
import { ShipImpactMarks } from './ShipImpactMarks';
import { tubeLocalPosition } from '../simulation/torpedoes';

/** Renderer adapter. Simulation geometry and transforms come from the same definition. */
export class ShipView {
  readonly root = new THREE.Group();
  readonly inspection: ShipInspection;
  readonly motion: Combatant['motion'];
  readonly impactMarks: ShipImpactMarks;
  private damageSource: Combatant['damage'];
  private previousMotion: Combatant['motion'];
  private motionSource: Combatant['motion'];
  private previousMounts: Combatant['mounts'];
  private renderedMounts: Combatant['mounts'];
  private previousLaunchers: number[];
  private renderedLaunchers: NonNullable<Combatant['torpedoLaunchers']>;
  private launcherBindings: THREE.Object3D[];
  private tubeBindings: THREE.Object3D[];
  get internals() { return this.inspection.root; }
  private bindings: { yaw: THREE.Object3D; elevation: THREE.Object3D[]; recoil: THREE.Object3D[]; muzzles: THREE.Object3D[] }[];
  private surfaces: { material: THREE.MeshStandardMaterial; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  private inspecting = false;
  private appendages: { node: THREE.Object3D; base: THREE.Quaternion; kind: keyof NonNullable<ShipDefinition['submarine']>['appendages']; index: number }[] = [];
  constructor(model: THREE.Group, readonly definition: ShipDefinition, readonly actor: Combatant) {
    this.motionSource = actor.motion;
    this.damageSource = actor.damage;
    this.motion = { ...actor.motion };
    this.previousMotion = { ...actor.motion };
    this.previousMounts = actor.mounts.map(m => ({ ...m }));
    this.renderedMounts = actor.mounts.map(m => ({ ...m }));
    this.previousLaunchers = (actor.torpedoLaunchers ?? []).map(l => l.train);
    this.renderedLaunchers = (actor.torpedoLaunchers ?? []).map(l => ({ ...l }));
    this.root.name = actor.motion.id;
    this.inspection = new ShipInspection(definition);
    const nodes = new Map<string, THREE.Object3D>();
    // Preserve GLTF material sharing within a hull, with separate inspection state per ship.
    const materials = new Map<THREE.Material, THREE.Material>();
    model.traverse(o => {
      if (o.userData.nodeId) nodes.set(o.userData.nodeId, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true; o.receiveShadow = true;
        const copy = (m: THREE.Material) => {
          const cached = materials.get(m);
          if (cached) return cached;
          const material = m.clone();
          materials.set(m, material);
          if (material instanceof THREE.MeshStandardMaterial) {
            if (material.map) material.map.anisotropy = 8;
            this.surfaces.push({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
          }
          return material;
        };
        o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
      }
    });
    const node = (id: string) => { const n = nodes.get(id); if (!n) throw new Error(`Ship export is missing ${id}. Rebuild with bun run ship:build ${definition.id}`); return n; };
    this.bindings = definition.mounts.map(m => ({ yaw: node(`${m.id}.yaw`), elevation: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.elevation`)), recoil: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.recoil`)), muzzles: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.muzzle`)) }));
    this.launcherBindings = (definition.torpedoLaunchers ?? []).map(l => node(`${l.id}.yaw`));
    this.tubeBindings = (definition.torpedoTubes ?? []).map(t => node(`${t.id}.muzzle`));
    if (definition.submarine) for (const kind of ['bowPlanes', 'sternPlanes', 'rudders', 'propellers'] as const) {
      this.appendages.push(...definition.submarine.appendages[kind].map((id, index) => ({ node: node(id), base: node(id).quaternion.clone(), kind, index })));
    }
    this.root.add(model, this.internals);
    this.impactMarks = new ShipImpactMarks(this.root, model, new Map(definition.mounts.map((m, i) => [m.id, this.bindings[i].yaw])));
    this.update();
  }
  inspect(enabled: boolean): void { this.setInspection(enabled ? 'all' : 'exterior'); }
  setInspection(mode: InspectionMode | 'all', selectedId?: string): void {
    this.inspection.setMode(mode, selectedId);
    const enabled = mode !== 'exterior';
    this.impactMarks.setVisible(!enabled);
    if (this.inspecting !== enabled) {
      this.inspecting = enabled;
      this.surfaces.forEach(({ material, opacity, transparent, depthWrite }) => {
        material.transparent = enabled || transparent; material.opacity = enabled ? .16 : opacity;
        material.depthWrite = enabled ? false : depthWrite; material.needsUpdate = true;
      });
    }
    this.updateInspection();
  }
  /** Read-only check of the loaded joints against the CPU poses sampled for this frame. */
  muzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.bindings.flatMap((binding, i) => binding.muzzles.map((node, barrel) => {
      const m = this.definition.mounts[i], state = this.renderedMounts[i];
      const expected = new THREE.Vector3(...muzzleWorld(m, state, barrel, this.motion));
      expected.addScaledVector(new THREE.Vector3(...shotDirection(m, state, this.motion)), -state.recoil * m.weapon.recoilM);
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    }));
  }
  torpedoMuzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.tubeBindings.map((node, i) => {
      const local = tubeLocalPosition({ definition: this.definition, torpedoLaunchers: this.renderedLaunchers }, this.definition.torpedoTubes![i]);
      const expected = this.root.localToWorld(new THREE.Vector3(...local));
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    });
  }
  /** Capture before every fixed tick, including all ticks in a catch-up frame. */
  capturePreviousPose(): void {
    this.motionSource = this.actor.motion;
    Object.assign(this.previousMotion, this.actor.motion);
    this.previousMounts.forEach((m, i) => Object.assign(m, this.actor.mounts[i]));
    this.previousLaunchers = (this.actor.torpedoLaunchers ?? []).map(l => l.train);
  }
  /** Teleports and port transitions must not interpolate across the old voyage. */
  snap(): void { this.capturePreviousPose(); this.update(); }
  update(alpha = 1): void {
    if (this.damageSource !== this.actor.damage) {
      this.impactMarks.clear(); this.damageSource = this.actor.damage;
    }
    if (this.motionSource !== this.actor.motion) this.capturePreviousPose();
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    const current = this.actor.motion, previous = this.previousMotion;
    const motion = this.motion, mounts = this.renderedMounts;
    Object.assign(motion, current);
    for (const key of ['x', 'y', 'z', 'roll', 'pitch', 'speed'] as const) {
      motion[key] = THREE.MathUtils.lerp(previous[key], current[key], t);
    }
    motion.heading = previous.heading + wrapAngle(current.heading - previous.heading) * t;
    mounts.forEach((m, i) => {
      const currentMount = this.actor.mounts[i], previousMount = this.previousMounts[i];
      Object.assign(m, currentMount);
      // Mount train is a bounded interval; wrapping would cross forbidden arcs.
      for (const key of ['train', 'elevation', 'recoil'] as const) {
        // A gun can be disabled after it trained in the current tick. Stop at
        // the authoritative angle immediately instead of finishing that turn
        // across later display frames. Recoil may still settle independently.
        const stopped = key !== 'recoil' && (currentMount.hp <= 0 || currentMount.status === 'disabled' || this.actor.damage.sunk);
        m[key] = stopped ? currentMount[key] : THREE.MathUtils.lerp(previousMount[key], currentMount[key], t);
      }
    });
    this.root.position.set(motion.x, motion.y, motion.z);
    this.root.rotation.set(motion.pitch, -motion.heading, motion.roll, 'YXZ');
    this.bindings.forEach((b, i) => {
      // A 180° imported quaternion can decompose into nonzero X/Z Euler angles.
      // Replace the complete joint rotation instead of retaining those alternate axes.
      b.yaw.rotation.set(0, -(radians(this.definition.mounts[i].bearingDeg) + mounts[i].train), 0);
      b.elevation.forEach(n => { n.rotation.set(mounts[i].elevation, 0, 0); });
      b.recoil.forEach(n => { n.position.z = mounts[i].recoil * this.definition.mounts[i].weapon.recoilM; });
    });
    this.launcherBindings.forEach((node, i) => {
      const train = this.actor.torpedoLaunchers?.[i].train ?? 0, previous = this.previousLaunchers[i] ?? train;
      this.renderedLaunchers[i].train = previous + wrapAngle(train - previous) * t;
      node.rotation.set(0, -this.renderedLaunchers[i].train, 0);
    });
    this.appendages.forEach(({ node, base, kind, index }) => {
      node.quaternion.copy(base);
      if (kind === 'rudders') node.rotateY(-motion.rudder * radians(35));
      else if (kind === 'propellers') node.rotateZ(motion.distance * (index % 2 ? -1 : 1) * Math.sign(motion.speed) * 1.8);
      else node.rotateX((this.actor.submarine?.planes ?? 0) * radians(kind === 'bowPlanes' ? -20 : 20));
    });
    this.updateInspection();
  }
  private updateInspection(): void {
    this.inspection.update({ ...this.actor, motion: this.motion, mounts: this.renderedMounts });
  }
}
