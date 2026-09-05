import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { INSPECTION_COLORS, inspectionEntries, type InspectionMode, type InspectionEntry } from '../ships/inspection';
import type { Combatant } from '../simulation/damage';
import { radians } from '../simulation/geometry';

/** Shared port and combat X-ray geometry. No simulation state is changed by inspection. */
export class ShipInspection {
  readonly root = new THREE.Group();
  readonly entries: InspectionEntry[];
  mode: InspectionMode | 'all' = 'exterior';
  selectedId?: string;
  private volumes: { entry: InspectionEntry; group: THREE.Group; fill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>; water?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> }[];
  constructor(private definition: ShipDefinition) {
    this.entries = inspectionEntries(definition);
    this.root.name = 'Ship inspection'; this.root.visible = false;
    this.volumes = this.entries.map(entry => {
      const geometry = new THREE.BoxGeometry(...entry.size), group = new THREE.Group();
      group.position.fromArray(entry.center); group.userData.inspectionId = entry.id;
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: INSPECTION_COLORS[entry.kind], transparent: true, depthWrite: false, depthTest: false }));
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: INSPECTION_COLORS[entry.kind], transparent: true, depthWrite: false, depthTest: false }));
      fill.renderOrder = 100; outline.renderOrder = 102;
      group.add(fill, outline); this.root.add(group);
      let water: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | undefined;
      if (entry.compartmentIndex !== undefined) {
        water = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#519fc0', transparent: true, opacity: .45, depthWrite: false, depthTest: false }));
        water.renderOrder = 101; water.visible = false; group.add(water);
      }
      return { entry, group, fill, outline, water };
    });
  }
  setMode(mode: InspectionMode | 'all', selectedId?: string): void {
    this.mode = mode;
    this.selectedId = this.entries.some(e => e.id === selectedId && (mode === 'all' || (mode === 'armor' ? e.kind === 'armor' : mode === 'internals' && e.kind !== 'armor'))) ? selectedId : undefined;
    this.root.visible = mode !== 'exterior';
  }
  update(actor: Combatant): void {
    if (!this.root.visible) return;
    this.volumes.forEach(({ entry, group, fill, outline, water }) => {
      group.visible = (this.mode === 'all' || (this.mode === 'armor' ? entry.kind === 'armor' : entry.kind !== 'armor')) && (!this.selectedId || entry.id === this.selectedId);
      const selected = entry.id === this.selectedId, dim = this.selectedId && !selected;
      outline.material.color.set(selected ? '#fff3c9' : INSPECTION_COLORS[entry.kind]);
      outline.material.opacity = dim ? .18 : selected ? 1 : .65;
      fill.material.opacity = dim ? .025 : selected ? .4 : entry.kind === 'compartment' ? .015 : entry.kind === 'armor' ? .1 : .4;
      fill.material.color.set(INSPECTION_COLORS[entry.kind]);
      if (entry.moduleIndex !== undefined) {
        const condition = actor.damage.modules[entry.moduleIndex].hp / this.definition.modules[entry.moduleIndex].hp;
        if (condition < 1) fill.material.color.set(condition <= 0 ? '#d36b4f' : '#dfbd83');
      }
      if (entry.mountIndex !== undefined) group.rotation.y = -(radians(entry.bearingDeg!) + actor.mounts[entry.mountIndex].train);
      if (water && entry.compartmentIndex !== undefined) {
        const fraction = actor.damage.compartments[entry.compartmentIndex].waterM3 / entry.capacityM3!;
        water.visible = fraction > .0001; water.scale.y = Math.max(.001, fraction);
        water.position.y = -entry.size[1] / 2 + entry.size[1] * fraction / 2;
      }
    });
  }
}
