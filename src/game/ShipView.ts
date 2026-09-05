import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { barrelIds } from '../ships/blueprint';
import type { Combatant } from '../simulation/damage';
import { radians } from '../simulation/geometry';
import { muzzleWorld, shotDirection } from '../simulation/weapons';
import { ShipInspection } from './ShipInspection';
import type { InspectionMode } from '../ships/inspection';

/** Renderer adapter. Simulation geometry and transforms come from the same definition. */
export class ShipView {
  readonly root = new THREE.Group();
  readonly inspection: ShipInspection;
  get internals() { return this.inspection.root; }
  private bindings: { yaw: THREE.Object3D; elevation: THREE.Object3D[]; recoil: THREE.Object3D[]; muzzles: THREE.Object3D[] }[];
  private surfaces: { material: THREE.MeshStandardMaterial; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  private inspecting = false;
  constructor(model: THREE.Group, readonly definition: ShipDefinition, readonly actor: Combatant) {
    this.root.name = actor.motion.id;
    this.inspection = new ShipInspection(definition);
    const nodes = new Map<string, THREE.Object3D>();
    model.traverse(o => {
      if (o.userData.nodeId) nodes.set(o.userData.nodeId, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true; o.receiveShadow = true;
        const copy = (m: THREE.Material) => {
          const material = m.clone();
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
    this.root.add(model, this.internals);
    this.update();
  }
  inspect(enabled: boolean): void { this.setInspection(enabled ? 'all' : 'exterior'); }
  setInspection(mode: InspectionMode | 'all', selectedId?: string): void {
    this.inspection.setMode(mode, selectedId);
    const enabled = mode !== 'exterior';
    if (this.inspecting !== enabled) {
      this.inspecting = enabled;
      this.surfaces.forEach(({ material, opacity, transparent, depthWrite }) => {
        material.transparent = enabled || transparent; material.opacity = enabled ? .16 : opacity;
        material.depthWrite = enabled ? false : depthWrite; material.needsUpdate = true;
      });
    }
    this.inspection.update(this.actor);
  }
  /** Read-only development check against the actual loaded scene graph, including recoil. */
  muzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.bindings.flatMap((binding, i) => binding.muzzles.map((node, barrel) => {
      const m = this.definition.mounts[i], state = this.actor.mounts[i];
      const expected = new THREE.Vector3(...muzzleWorld(m, state, barrel, this.actor.motion));
      expected.addScaledVector(new THREE.Vector3(...shotDirection(m, state, this.actor.motion)), -state.recoil * m.weapon.recoilM);
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    }));
  }
  update(): void {
    const { motion, mounts } = this.actor;
    this.root.position.set(motion.x, motion.y, motion.z);
    this.root.rotation.set(motion.pitch, -motion.heading, motion.roll, 'YXZ');
    this.bindings.forEach((b, i) => {
      // A 180° imported quaternion can decompose into nonzero X/Z Euler angles.
      // Replace the complete joint rotation instead of retaining those alternate axes.
      b.yaw.rotation.set(0, -(radians(this.definition.mounts[i].bearingDeg) + mounts[i].train), 0);
      b.elevation.forEach(n => { n.rotation.set(mounts[i].elevation, 0, 0); });
      b.recoil.forEach(n => { n.position.z = mounts[i].recoil * this.definition.mounts[i].weapon.recoilM; });
    });
    this.inspection.update(this.actor);
  }
}
