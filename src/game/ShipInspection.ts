import * as THREE from 'three/webgpu';
import { materialColor, mix, normalFlat, uniform, vec3 } from 'three/tsl';
import type { ShipDefinition } from '../ships/blueprint';
import { inspectionColor, inspectionEntries, type InspectionMode, type InspectionEntry } from '../ships/inspection';
import type { Combatant } from '../simulation/damage';
import { radians } from '../simulation/geometry';
import { EXTERIOR_PLATING_REPLACEMENT_M } from '../simulation/structure';

/** Shared port and combat X-ray geometry. No simulation state is changed by inspection. */
export class ShipInspection {
  readonly root = new THREE.Group();
  readonly entries: InspectionEntry[];
  mode: InspectionMode | 'all' = 'exterior';
  selectedId?: string;
  hoveredId?: string;
  private hoverColor = new THREE.Color('#ffffff');
  private armorShading = uniform(0);
  private volumes: { entry: InspectionEntry; color: string; group: THREE.Group; fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial | THREE.MeshBasicNodeMaterial>; outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>; water?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> }[];
  constructor(private definition: ShipDefinition) {
    this.entries = inspectionEntries(definition);
    this.root.name = 'Ship inspection'; this.root.visible = false;
    // A neutral upper-left inspection light follows the camera, independent of
    // harbor exposure. Face normals keep plate edges crisp, including back faces.
    const shade = normalFlat.dot(vec3(-.55, .8, .7).normalize()).max(0).mul(.68).add(.32);
    const armorColor = materialColor.mul(mix(1, shade, this.armorShading));
    this.volumes = this.entries.map(entry => {
      const geometry = entry.surface ? surfaceGeometry(entry, definition) : entry.plate ? plateGeometry(entry) : new THREE.BoxGeometry(...entry.size), group = new THREE.Group();
      group.position.fromArray(entry.anchor ?? entry.center); group.userData.inspectionId = entry.id;
      const color = inspectionColor(entry);
      const Material = entry.kind === 'armor' ? THREE.MeshBasicNodeMaterial : THREE.MeshBasicMaterial;
      const material = new Material({ color, transparent: true, depthWrite: false, depthTest: false, side:THREE.DoubleSide, toneMapped: entry.kind !== 'armor' });
      if (material instanceof THREE.MeshBasicNodeMaterial) material.colorNode = armorColor;
      const fill = new THREE.Mesh(geometry, material);
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: entry.kind === 'armor', toneMapped: entry.kind !== 'armor' }));
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
    this.armorShading.value = opaqueArmor ? 1 : 0;
    this.volumes.forEach(({ entry, fill, outline }) => {
      if (entry.kind !== 'armor') return;
      outline.visible = false;
      if (fill.material.transparent === opaqueArmor) {
        fill.material.transparent = !opaqueArmor;
        fill.material.depthTest = opaqueArmor;
        fill.material.depthWrite = opaqueArmor;
        // Keep the hover edge clear of its own surface while other plates still occlude it.
        fill.material.polygonOffset = opaqueArmor;
        fill.material.polygonOffsetFactor = 1;
        fill.material.polygonOffsetUnits = 1;
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
    this.volumes.forEach(({ entry, color, fill, outline }) => {
      if (entry.kind !== 'armor') return;
      outline.visible = entry.id === this.hoveredId;
      outline.material.color.copy(this.hoverColor);
      outline.material.opacity = 1;
      fill.material.color.set(color);
      if (entry.id === this.hoveredId) fill.material.color.lerp(this.hoverColor, .3);
    });
  }
  update(actor: Combatant): void {
    if (!this.root.visible) return;
    this.volumes.forEach(({ entry, color, group, fill, outline, water }) => {
      group.visible = (this.mode === 'all' || (this.mode === 'armor' ? entry.kind === 'armor' : entry.kind !== 'armor')) && (!this.selectedId || entry.id === this.selectedId);
      const selected = entry.id === this.selectedId, dim = this.selectedId && !selected;
      if (entry.kind === 'armor') outline.visible = entry.id === this.hoveredId;
      outline.material.color.set(entry.kind === 'armor' ? this.hoverColor : selected ? '#fff3c9' : color);
      outline.material.opacity = entry.kind === 'armor' ? 1 : dim ? .18 : selected ? 1 : .65;
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

function surfaceGeometry(entry: InspectionEntry, definition: ShipDefinition): THREE.BufferGeometry {
  const surface = entry.surface!, vertices = surface.vertices.map(v => new THREE.Vector3(...v));
  // Combat replaces nominal hull plating near an exterior armor face. Remove
  // those patches from the inspection skin too, exposing the actual belt color
  // and pick target while retaining opaque plating at the unarmored hull ends.
  const cutters = entry.id === 'structure:hull' ? definition.armor.flatMap(armor => {
    if (!armor.plate?.exterior || armor.plate.mountId) return [];
    const points = armor.plate.vertices.map(v => new THREE.Vector3(...v));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    const planes = [new THREE.Plane(normal, -normal.dot(points[0]) + EXTERIOR_PLATING_REPLACEMENT_M), new THREE.Plane(normal.clone().negate(), normal.dot(points[0]) + EXTERIOR_PLATING_REPLACEMENT_M)];
    points.forEach((point, i) => {
      const inward = normal.clone().cross(points[(i + 1) % points.length].clone().sub(point)).normalize();
      planes.push(new THREE.Plane(inward, -inward.dot(point)));
    });
    return [{ planes, bounds: new THREE.Box3().setFromPoints(points).expandByScalar(EXTERIOR_PLATING_REPLACEMENT_M) }];
  }) : [];
  const positions: number[] = [], center = new THREE.Vector3(...entry.center);
  for (const ids of surface.triangles) {
    let polygons = [ids.map(i => vertices[i])];
    const bounds = new THREE.Box3().setFromPoints(polygons[0]);
    for (const cutter of cutters) {
      if (!bounds.intersectsBox(cutter.bounds)) continue;
      polygons = polygons.flatMap(polygon => {
        const outside: THREE.Vector3[][] = [];
        let remainder = polygon;
        for (const plane of cutter.planes) {
          const part = clipSurface(remainder, plane, false);
          if (part.length >= 3) outside.push(part);
          remainder = clipSurface(remainder, plane, true);
          if (remainder.length < 3) break;
        }
        return outside;
      });
    }
    for (const polygon of polygons) for (let i = 1; i < polygon.length - 1; i++) {
      for (const point of [polygon[0], polygon[i], polygon[i + 1]]) positions.push(...point.clone().sub(center).toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Clip one convex polygon against a half-space without changing its winding. */
function clipSurface(points: THREE.Vector3[], plane: THREE.Plane, inside: boolean): THREE.Vector3[] {
  const result: THREE.Vector3[] = [], sign = inside ? 1 : -1;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length], da = sign * plane.distanceToPoint(a), db = sign * plane.distanceToPoint(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) result.push(a.clone().lerp(b, da / (da - db)));
  });
  return result;
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
