import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { inspectionColor, inspectionEntries, type InspectionMode, type InspectionEntry } from '../ships/inspection';
import type { Combatant } from '../simulation/damage';
import { radians } from '../simulation/geometry';

/** Shared port and combat X-ray geometry. No simulation state is changed by inspection. */
export class ShipInspection {
  readonly root = new THREE.Group();
  readonly entries: InspectionEntry[];
  mode: InspectionMode | 'all' = 'exterior';
  selectedId?: string;
  hoveredId?: string;
  private hoverColor = new THREE.Color('#ffffff');
  private volumes: { entry: InspectionEntry; color: string; group: THREE.Group; fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>; water?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> }[];
  constructor(private definition: ShipDefinition) {
    this.entries = inspectionEntries(definition);
    this.root.name = 'Ship inspection'; this.root.visible = false;
    this.volumes = this.entries.map(entry => {
      const geometry = entry.plate ? plateGeometry(entry) : new THREE.BoxGeometry(...entry.size), group = new THREE.Group();
      group.position.fromArray(entry.anchor ?? entry.center); group.userData.inspectionId = entry.id;
      const color = inspectionColor(entry);
      const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, side:THREE.DoubleSide, toneMapped: entry.kind !== 'armor' }));
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: false, toneMapped: entry.kind !== 'armor' }));
      fill.renderOrder = 100; outline.renderOrder = 102;
      group.add(fill, outline); this.root.add(group);
      let water: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | undefined;
      if (entry.compartmentIndex !== undefined) {
        water = new THREE.Mesh(geometry as THREE.BoxGeometry, new THREE.MeshBasicMaterial({ color: '#519fc0', transparent: true, opacity: .45, depthWrite: false, depthTest: false }));
        water.renderOrder = 101; water.visible = false; group.add(water);
      }
      return { entry, color, group, fill, outline, water };
    });
  }
  setMode(mode: InspectionMode | 'all', selectedId?: string): void {
    this.mode = mode;
    this.selectedId = this.entries.some(e => e.id === selectedId && (mode === 'all' || (mode === 'armor' ? e.kind === 'armor' : mode === 'internals' && e.kind !== 'armor'))) ? selectedId : undefined;
    this.root.visible = mode !== 'exterior';
    this.setHovered(undefined);
    const opaqueArmor = mode === 'armor';
    this.volumes.forEach(({ entry, fill, outline }) => {
      if (entry.kind !== 'armor') return;
      outline.visible = false;
      if (fill.material.transparent === opaqueArmor) {
        fill.material.transparent = !opaqueArmor;
        fill.material.depthTest = opaqueArmor;
        fill.material.depthWrite = opaqueArmor;
        fill.material.needsUpdate = true;
      }
    });
  }
  /** Pick the nearest visible plate, including its physical thickness and current turret pose. */
  pickArmor(raycaster: THREE.Raycaster): InspectionEntry | undefined {
    if (this.mode !== 'armor' || !this.root.visible) return;
    this.root.updateWorldMatrix(true, true);
    const meshes = this.volumes.filter(v => v.entry.kind === 'armor' && v.group.visible).map(v => v.fill);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit && this.volumes.find(v => v.fill === hit.object)?.entry;
  }
  setHovered(id?: string): void {
    if (id === this.hoveredId) return;
    this.hoveredId = this.mode === 'armor' && (!this.selectedId || this.selectedId === id) && this.entries.some(e => e.kind === 'armor' && e.id === id) ? id : undefined;
    this.volumes.forEach(({ entry, color, fill }) => {
      if (entry.kind !== 'armor') return;
      fill.material.color.set(color);
      if (entry.id === this.hoveredId) fill.material.color.lerp(this.hoverColor, .3);
    });
  }
  update(actor: Combatant): void {
    if (!this.root.visible) return;
    this.volumes.forEach(({ entry, color, group, fill, outline, water }) => {
      group.visible = (this.mode === 'all' || (this.mode === 'armor' ? entry.kind === 'armor' : entry.kind !== 'armor')) && (!this.selectedId || entry.id === this.selectedId);
      const selected = entry.id === this.selectedId, dim = this.selectedId && !selected;
      outline.material.color.set(selected && entry.kind !== 'armor' ? '#fff3c9' : color);
      outline.material.opacity = dim ? .18 : selected ? 1 : entry.kind === 'armor' ? .9 : .65;
      fill.material.opacity = entry.kind === 'armor' && this.mode === 'armor' ? 1 : dim ? .025 : selected ? .4 : entry.kind === 'compartment' ? .015 : entry.kind === 'armor' ? .1 : .4;
      fill.material.color.set(color);
      if (entry.id === this.hoveredId) fill.material.color.lerp(this.hoverColor, .3);
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

/** Physical thickness for inspection; CPU intersection uses the same plate's mid-surface. */
function plateGeometry(entry: InspectionEntry): THREE.BufferGeometry {
  const points = entry.plate!.vertices.map(p => new THREE.Vector3().fromArray(p));
  const normal = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize().multiplyScalar(entry.thicknessMm! / 2000);
  const center = entry.anchor ? new THREE.Vector3() : new THREE.Vector3().fromArray(entry.center);
  const vertices = [-1,1].flatMap(sign => points.flatMap(p => p.clone().addScaledVector(normal, sign).sub(center).toArray()));
  const n=points.length, indices:number[]=[];
  for (let i=1;i<n-1;i++) indices.push(0,i+1,i,n,n+i,n+i+1);
  for (let i=0;i<n;i++) { const j=(i+1)%n; indices.push(i,j,n+j,i,n+j,n+i); }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
