import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ConstructionEquipmentPart } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { ventFinCenters } from '../../assets/parts/construction/vent_geometry';

/** Adjustable version of the original surface_fittings.py vents. Shared by
 * fitted previews and exports before projecting their wall attachments. */
export function constructionVentModel(template: THREE.Group, part: ConstructionEquipmentPart, width: number, height: number): THREE.Group | undefined {
  if (!['generic-louvered-vent', 'generic-round-wall-vent'].includes(part.id)) return;
  const group = new THREE.Group(), round = part.id === 'generic-round-wall-vent';
  const materials = new Map<string, THREE.Material>();
  template.traverse(node => {
    if (node instanceof THREE.Mesh) for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      if (m.userData.componentMaterialRole) materials.set(m.userData.componentMaterialRole, m);
    }
  });
  const material = (role: 'naval' | 'dark' | 'painted-edge') => {
    const original = materials.get(role);
    if (original) return original.clone();
    const surface = componentMaterial(role);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...surface.color as [number, number, number]), roughness: surface.roughness, metalness: surface.metallic });
    m.userData = surface.userData; return m;
  };
  const add = (name: string, geometry: THREE.BufferGeometry, role: 'naval' | 'dark' | 'painted-edge', relief = true) => {
    const mesh = new THREE.Mesh(geometry, material(role)); mesh.name = name; mesh.userData.wallRelief = relief; group.add(mesh);
  };
  const backing = round ? new THREE.CircleGeometry(1, 24).scale(width / 2, height / 2, 1) : new THREE.PlaneGeometry(width, height);
  add('vent-backing', backing.rotateY(Math.PI), 'dark', false);
  if (round) {
    // A stamped flange needs a silhouette, not dozens of overlapping round rods.
    const positions: number[] = [], indices: number[] = [];
    const rx = width * .46, ry = height * .46;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      for (const inset of [0, .024]) positions.push((rx - inset) * Math.cos(a), (ry - inset) * Math.sin(a), -.034);
      const j = i * 2, k = (i + 1) % 24 * 2; indices.push(j, j + 1, k, j + 1, k + 1, k);
    }
    const flange = new THREE.BufferGeometry(); flange.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); flange.setIndex(indices); flange.computeVertexNormals();
    add('vent-flange', flange, 'naval');
    for (const y of ventFinCenters(height, true)) {
      const half = rx * Math.sqrt(Math.max(0, 1 - ((Math.abs(y) + .0085) / ry) ** 2));
      add('vent-fin', new THREE.BoxGeometry(half * 2, .017, .035).translate(0, y, -.027), 'painted-edge');
    }
  } else {
    for (const side of [-1, 1]) add('vent-side', new THREE.BoxGeometry(.032, height, .044).translate(side * (width / 2 - .016), 0, -.022), 'naval');
    for (const y of ventFinCenters(height, false)) {
      const half = width / 2 - .03;
      const fin = new THREE.BufferGeometry();
      fin.setAttribute('position', new THREE.Float32BufferAttribute([-half, y + .025, -.004, half, y + .025, -.004, half, y - .019, -.055, -half, y - .019, -.055], 3));
      fin.setIndex([0, 1, 2, 0, 2, 3]); fin.computeVertexNormals();
      add('vent-fin', fin, 'naval');
    }
  }
  // Keep each vent to a few draws regardless of its height. Projection consumes
  // ordinary merged geometry, so it remains identical in previews and GLB export.
  for (const name of ['vent-fin', 'vent-side']) {
    const meshes = group.children.filter(n => n.name === name) as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
    if (!meshes.length) continue;
    const geometry = mergeGeometries(meshes.map(m => m.geometry));
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, meshes[0].material); mesh.name = name; mesh.userData.wallRelief = true;
    for (const [i, old] of meshes.entries()) { group.remove(old); old.geometry.dispose(); if (i) old.material.dispose(); }
    group.add(mesh);
  }
  return group;
}
