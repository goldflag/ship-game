import { equipmentCenter, equipmentPose } from './equipmentPose';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { positionWorld, float } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { mountFrame } from './mountFrames';
import { attribute, materialColor, mix, normalFlat, uniform, vec3 } from 'three/tsl';
import type { ShipDefinition } from '../ships/blueprint';
import { entryInMode, inspectionColor, inspectionEntries, type InspectionMode, type InspectionEntry } from '../ships/inspection';
import { equipmentCondition } from './machinery';
import { EXTERIOR_PLATING_REPLACEMENT_M } from './hullStructure';
import type { Combatant } from '../game/session/elements';
import { waterLevel as compartmentWaterLevel } from './floodwater';
import { regionCondition } from './session/damageReadout';
import { DAMAGE_COLORS, damageTone, type DamageTone } from './session/shipDamageReadout';

// A neutral inspection light follows the camera, independent of harbor exposure.
const armorShade = () => normalFlat.dot(vec3(-.55, .8, .7).normalize()).max(0).mul(.68).add(.32);

/** Shared port and combat X-ray geometry. No simulation state is changed by inspection. */
export class ShipInspection {
  readonly root = new THREE.Group();
  readonly entries: InspectionEntry[];
  mode: InspectionMode | 'all' | 'damage' = 'exterior';
  selectedId?: string;
  hoveredId?: string;
  private hoverColor = new THREE.Color('#ffffff');
  private armorShading = uniform(0);
  private armorBatches: THREE.Mesh[] = [];
  private armorColors = new Map<string, { attribute: THREE.BufferAttribute; offset: number; count: number; color: THREE.Color }>();
  private regionOutlines: { id: string; mesh: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> }[] = [];
  private volumes: { entry: InspectionEntry; color: string; group: THREE.Group; fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial | THREE.MeshBasicNodeMaterial>; outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; water?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>; waterline?: { value: number } }[] = [];
  constructor(private definition: ShipDefinition) {
    this.entries = inspectionEntries(definition);
    this.root.name = 'Ship inspection'; this.root.visible = false;
  }
  /** Most fleet actors are never inspected. Build their X-ray meshes on demand. */
  private buildVolumes(): void {
    if (this.volumes.length) return;
    const definition = this.definition;
    this.regionOutlines = (definition.localDamage?.regions ?? []).filter(r => !r.mountId && !r.moduleId).map(r => {
      const box = new THREE.BoxGeometry(...r.size), edges = new THREE.EdgesGeometry(box); box.dispose();
      const mesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#dfbd83', transparent: true, opacity: .4, depthTest: false, depthWrite: false }));
      mesh.position.fromArray(r.center); mesh.visible = false; mesh.renderOrder = 99; this.root.add(mesh);
      return { id: r.id, mesh };
    });
    const armorColor = materialColor.mul(mix(1, armorShade(), this.armorShading));
    this.volumes = this.entries.map(entry => {
      const geometry = entry.surface ? surfaceGeometry(entry, definition) : entry.plate ? plateGeometry(entry) : entry.volumes ? volumeGeometry(entry) : entry.cells ? cellGeometry(entry) : new THREE.BoxGeometry(...entry.size), group = new THREE.Group();
      group.position.fromArray(entry.anchor ?? entry.center); group.userData.inspectionId = entry.id;
      group.updateMatrix(); group.matrixAutoUpdate = false;
      const color = inspectionColor(entry);
      const Material = entry.kind === 'armor' ? THREE.MeshBasicNodeMaterial : THREE.MeshBasicMaterial;
      const material = new Material({ color, transparent: true, depthWrite: false, depthTest: false, side:THREE.DoubleSide, toneMapped: entry.kind !== 'armor' });
      if (material instanceof THREE.MeshBasicNodeMaterial) material.colorNode = armorColor;
      const fill = new THREE.Mesh(geometry, material);
      const edges = entry.armorIds && entry.armorIds.length > 1 ? panelEdges(geometry, entry.plate!.vertices.length) : new THREE.EdgesGeometry(geometry);
      const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false, depthTest: entry.kind === 'armor', toneMapped: entry.kind !== 'armor' }));
      fill.matrixAutoUpdate = outline.matrixAutoUpdate = false;
      fill.renderOrder = 100; outline.renderOrder = 102;
      group.add(fill, outline); this.root.add(group);
      let water: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial> | undefined;
      const waterline = uniform(0);
      if (entry.compartmentIndex !== undefined) {
        const material = new THREE.MeshBasicNodeMaterial({ color: '#519fc0', transparent: true, depthWrite: false, depthTest: false });
        material.opacityNode = positionWorld.y.lessThanEqual(waterline).select(float(.45), float(0));
        water = new THREE.Mesh(geometry, material);
        water.renderOrder = 101; water.visible = false; water.matrixAutoUpdate = false; group.add(water);
      }
      return { entry, color, group, fill, outline, water, waterline };
    });
  }
  /** Opaque plates share one draw per moving mount (and one for the fixed hull).
   * Original solids remain the pick targets and the isolated-plate view. */
  private buildArmorBatches(): void {
    if (this.armorBatches.length) return;
    const groups = new Map<number | undefined, typeof this.volumes>();
    for (const volume of this.volumes) {
      if (volume.entry.kind !== 'armor' || volume.entry.underwaterProtection) continue;
      const group = groups.get(volume.entry.mountIndex) ?? [];
      group.push(volume); groups.set(volume.entry.mountIndex, group);
    }
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    material.colorNode = armorShade().mul(attribute('color', 'vec3'));
    for (const volumes of groups.values()) {
      const owner = volumes[0].group;
      owner.updateMatrix();
      const inverse = owner.matrix.clone().invert();
      let offset = 0;
      const ranges = volumes.map(({ entry, color, group, fill }) => {
        group.updateMatrix();
        const geometry = fill.geometry.index ? fill.geometry.toNonIndexed() : fill.geometry.clone();
        // Boxes also carry UVs; all plates use the same position/normal/color layout.
        for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, group.matrix));
        const count = geometry.attributes.position.count, tint = new THREE.Color(color);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) tint.toArray(colors, i * 3);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const range = { id: entry.id, geometry, offset, count, color: tint }; offset += count;
        return range;
      });
      const geometry = mergeGeometries(ranges.map(range => range.geometry))!;
      for (const range of ranges) {
        range.geometry.dispose();
        this.armorColors.set(range.id, { attribute: geometry.getAttribute('color') as THREE.BufferAttribute,
          offset: range.offset, count: range.count, color: range.color });
      }
      const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 100; mesh.name = 'Armor surfaces';
      mesh.matrixAutoUpdate = false;
      owner.add(mesh); this.armorBatches.push(mesh);
    }
  }
  setMode(mode: InspectionMode | 'all' | 'damage', selectedId?: string): void {
    if (mode !== 'exterior') this.buildVolumes();
    if (mode === 'armor') this.buildArmorBatches();
    this.mode = mode;
    this.selectedId = this.entries.some(e => e.id === selectedId && this.inMode(e, mode)) ? selectedId : undefined;
    this.root.visible = mode !== 'exterior';
    this.regionOutlines.forEach(r => r.mesh.visible = false);
    this.setHovered(undefined);
    const opaqueArmor = mode === 'armor';
    this.armorShading.value = opaqueArmor ? 1 : 0;
    this.armorBatches.forEach(mesh => mesh.visible = opaqueArmor && !this.selectedId);
    this.volumes.forEach(({ entry, fill, outline }) => {
      if (entry.kind !== 'armor') return;
      fill.visible = !opaqueArmor || !!this.selectedId || !!entry.underwaterProtection;
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
    this.volumes.forEach(volume => this.paint(volume));
  }
  private inMode(entry: InspectionEntry, mode = this.mode): boolean {
    return mode === 'all' || (mode === 'damage' ? entry.kind !== 'armor' : entryInMode(entry, mode));
  }
  /** Pick the nearest visible plate (with physical thickness and current turret pose) in the
   * armor view, equipment in Internals, or spaces in Flooding. */
  pick(raycaster: THREE.Raycaster): InspectionEntry | undefined {
    if ((this.mode !== 'armor' && this.mode !== 'internals' && this.mode !== 'compartments') || !this.root.visible) return;
    this.root.updateWorldMatrix(true, true);
    const candidates = this.volumes.filter(v => v.group.visible && this.inMode(v.entry));
    const hits = raycaster.intersectObjects(candidates.map(v => v.fill), false);
    const entryOf = (object?: THREE.Object3D) => candidates.find(v => v.fill === object)?.entry;
    // Compound residual spaces wrap the detailed room layout. Let the specific
    // rooms remain hoverable through that context; the residual
    // cells are still pickable alone, in empty areas, or after row isolation.
    const nearest = this.mode === 'compartments' && !this.selectedId
      ? hits.find(hit => !entryOf(hit.object)?.cells) ?? hits[0] : hits[0];
    if (this.mode === 'armor' || !nearest) return entryOf(nearest?.object);
    return entryOf(nearest.object);
  }
  setHovered(id?: string): void {
    if (id === this.hoveredId) return;
    this.paintBatchedArmor(this.hoveredId, false);
    const hoverable = this.mode === 'armor' || this.mode === 'internals' || this.mode === 'compartments';
    this.hoveredId = hoverable && (!this.selectedId || this.selectedId === id) && this.entries.some(e => e.id === id && this.inMode(e)) ? id : undefined;
    this.paintBatchedArmor(this.hoveredId, true);
    this.volumes.forEach(volume => this.paint(volume));
  }
  private paintBatchedArmor(id: string | undefined, hovered: boolean): void {
    const range = id ? this.armorColors.get(id) : undefined;
    if (!range) return;
    const { attribute, offset, count } = range, color = range.color.clone();
    if (hovered) color.lerp(this.hoverColor, .3);
    for (let i = offset; i < offset + count; i++) attribute.setXYZ(i, color.r, color.g, color.b);
    attribute.addUpdateRange(offset * 3, count * 3); attribute.needsUpdate = true;
  }
  /** Hover and selection styling shared by immediate hover changes and per-frame updates. */
  private paint({ entry, color, fill, outline }: (typeof this.volumes)[number]): void {
    const hovered = entry.id === this.hoveredId, selected = entry.id === this.selectedId, dim = !!this.selectedId && !selected;
    if (entry.kind === 'armor') {
      outline.visible = hovered;
      outline.material.color.copy(this.hoverColor);
      outline.material.opacity = 1;
      fill.material.opacity = this.mode === 'armor' ? 1 : dim ? .025 : selected ? .4 : .1;
    } else {
      outline.material.color.set(hovered ? this.hoverColor : selected ? '#fff3c9' : color);
      outline.material.opacity = hovered || selected ? 1 : dim ? .18 : .65;
      fill.material.opacity = hovered ? (entry.kind === 'compartment' ? .14 : .6) : dim ? .025 : selected ? .4 : entry.kind === 'compartment' ? .015 : .4;
    }
    fill.material.color.set(color);
    if (hovered) fill.material.color.lerp(this.hoverColor, .3);
  }
  update(actor: Combatant): void {
    if (!this.root.visible) return;
    const trains = actor.mounts.map(mount => mount.train);
    for (const { id, mesh } of this.regionOutlines) {
      const condition = regionCondition(actor, id);
      mesh.visible = (this.mode === 'all' || this.mode === 'damage') && !this.selectedId && condition < .95;
      mesh.material.color.set(condition < .05 ? '#aebabe' : '#dfbd83');
      mesh.material.opacity = condition < .05 ? .55 : .3;
    }
    this.volumes.forEach(volume => {
      const { entry, group, fill, outline, water, waterline } = volume;
      let tone: DamageTone = 'healthy';
      fill.renderOrder = 100; outline.renderOrder = 102;
      if (water) water.renderOrder = this.mode === 'damage' ? 111 : 101;
      // Defense coverage is a gameplay envelope, not a plate that should hide armor.
      group.visible = this.inMode(entry) && (!this.selectedId || entry.id === this.selectedId)
        && (!entry.underwaterProtection || entry.id === this.selectedId);
      if (!group.visible) return;
      // Opaque armor colors change only on mode, selection or hover changes.
      if (this.mode !== 'armor') this.paint(volume);
      if (entry.moduleIndex !== undefined) {
        const module = this.definition.modules[entry.moduleIndex];
        group.position.fromArray(equipmentCenter(actor, this.definition, module));
        group.rotation.y = -(equipmentPose(actor, this.definition, module)?.heading ?? 0);
        const condition = actor.damage.modules[entry.moduleIndex].hp / this.definition.modules[entry.moduleIndex].hp;
        if (condition < 1) { fill.material.color.set(condition <= 0 ? '#d36b4f' : '#dfbd83'); if (entry.id === this.hoveredId) fill.material.color.lerp(this.hoverColor, .3); }
        const equipment = equipmentCondition(actor, this.definition, module);
        if (equipment.reason === 'flooded') fill.material.color.set('#519fc0');
        if (this.mode === 'damage') {
          const room = this.definition.compartments.findIndex(c => c.id === module.compartmentId);
          const fire = room < 0 ? 0 : actor.damage.control.rooms[room].intensity;
          tone = damageTone(condition, equipment.reason === 'flooded', fire);
        }
      }
      if (entry.kind === 'weapon' && entry.mountIndex !== undefined) {
        const hp = actor.mounts[entry.mountIndex].hp;
        if (hp < entry.hp!) fill.material.color.set(hp <= 0 ? '#d36b4f' : '#dfbd83');
        if (this.mode === 'damage') {
          tone = damageTone(hp / entry.hp!, false, actor.damage.control.mounts[entry.mountIndex].intensity);
          if (tone === 'healthy' && actor.mounts[entry.mountIndex].status === 'disabled') tone = 'damaged';
        }
      }
      if (entry.mountIndex !== undefined) {
        const pose = mountFrame(this.definition, entry.mountIndex, trains);
        const mount = this.definition.mounts[entry.mountIndex], anchor = entry.anchor ?? entry.center;
        group.position.set(pose.x + anchor[0] - mount.position[0], pose.y + anchor[1] - mount.position[1], pose.z + anchor[2] - mount.position[2]);
        group.rotation.y = -pose.heading;
      }
      if (entry.moduleIndex !== undefined || entry.mountIndex !== undefined) group.updateMatrix();
      if (water && entry.compartmentIndex !== undefined) {
        const fraction = actor.damage.compartments[entry.compartmentIndex].waterM3 / entry.capacityM3!;
        // Combat emphasizes consequences; the complete dry layout stays
        // available in the port's Flooding view and through selection.
        const fire = actor.damage.control.rooms[entry.compartmentIndex].intensity;
        if (fire > 0) { fill.material.color.set('#e69b57'); fill.material.opacity = .12; }
        if ((this.mode === 'all' || this.mode === 'damage') && entry.id !== this.selectedId && fraction <= .0001 && fire <= 0 && actor.damage.compartments[entry.compartmentIndex].breachAreaM2 <= 0) group.visible = false;
        if (this.mode === 'damage') {
          tone = fire > 0 ? 'fire' : fraction > .0001 ? 'flooded' : actor.damage.compartments[entry.compartmentIndex].breachAreaM2 > 0 ? 'damaged' : 'healthy';
        }
        water.visible = fraction > .0001;
        waterline!.value = this.definition.construction ? (actor.damage.compartments[entry.compartmentIndex] as { waterLevelY?: number }).waterLevelY ?? -1e6 : compartmentWaterLevel(actor, this.definition, entry.compartmentIndex);
      }
      if (this.mode === 'damage') {
        const selected = entry.id === this.selectedId, affected = tone !== 'healthy';
        fill.material.color.set(DAMAGE_COLORS[tone]);
        fill.material.opacity = entry.kind === 'compartment' ? selected ? .24 : .1 : selected || affected ? .6 : .08;
        // Healthy machinery supplies context; damage must remain visible through overlapping volumes.
        fill.renderOrder = affected || selected ? 110 : 100;
        outline.renderOrder = affected || selected ? 112 : 102;
        outline.material.opacity = selected ? 1 : affected ? .9 : .25;
        if (!selected) outline.material.color.copy(fill.material.color);
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
  const vertices = (entry.inwardPlate ? [-2, 0] : [-1,1]).flatMap(sign => points.flatMap(p => p.clone().addScaledVector(normal, sign).sub(center).toArray()));
  const n=points.length, indices:number[]=[];
  for (let i=1;i<n-1;i++) indices.push(0,i+1,i,n,n+i,n+i+1);
  for (let i=0;i<n;i++) { const j=(i+1)%n; indices.push(i,j,n+j,i,n+j,n+i); }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

/** Outline the panel's perimeter and thickness, never its triangulation crease. */
function panelEdges(geometry: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
  const positions = geometry.getAttribute('position'), vertices: number[] = [];
  const edge = (a: number, b: number) => {
    for (const i of [a, b]) vertices.push(positions.getX(i), positions.getY(i), positions.getZ(i));
  };
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    edge(i, j); edge(count + i, count + j); edge(i, count + i);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
}

function cellGeometry(entry: InspectionEntry): THREE.BufferGeometry {
  const boxes = entry.cells!.map(c => new THREE.BoxGeometry(...c.size).translate(c.center[0] - entry.center[0], c.center[1] - entry.center[1], c.center[2] - entry.center[2]));
  const geometry = mergeGeometries(boxes)!; boxes.forEach(b => b.dispose()); return geometry;
}

/** Direct triangulation of native usable voids preserves sloped rooms and gaps. */
function volumeGeometry(entry: InspectionEntry): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const volume of entry.volumes!) for (const face of volume.faces) for (let i = 1; i < face.vertices.length - 1; i++) {
    for (const point of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) positions.push(point[0] - entry.center[0], point[1] - entry.center[1], point[2] - entry.center[2]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); return geometry;
}
