import * as THREE from 'three';
import type { ConstructionFittingDefinition, ConstructionSurfaceFinish } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { solidPrimitive, TUBE_SIDES } from '../ships/constructionCustomFittings';
import { constructionFinishRoughness, constructionPaintColor } from '../ships/constructionPaints';
import { primitiveGeometry, primitiveRotation } from './constructionShapeGeometry';
import { constructionTubeGeometry } from './constructionTubeGeometry';

/** The one drawing of a design-local fitting, for the editor, thumbnails, port, battle and export.
 * Solids come from the same display recipes as hull blocks, so a fitting looks exactly like the
 * blocks it was made from. Display only: mass, support and fit belong to the native compiler.
 * One mesh per coating: solids and tubes without a `paint` follow the instance and ship paint
 * (`paintConstructionFitting`), explicitly painted ones keep their colour. */
export function createConstructionFittingModel(def: ConstructionFittingDefinition, options: { ghost?: boolean; finish?: ConstructionSurfaceFinish } = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = def.name;
  const coats = new Map<string, number[][]>();
  const add = (paint: string | undefined, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    if (matrix) flat.applyMatrix4(matrix);
    const bucket = coats.get(paint ?? '') ?? [[], []];
    coats.set(paint ?? '', bucket);
    const position = flat.getAttribute('position').array,
      normal = flat.getAttribute('normal').array;
    for (let i = 0; i < position.length; i++) {
      bucket[0].push(position[i]);
      bucket[1].push(normal[i]);
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  };
  for (const solid of def.solids) {
    try {
      const part = solidPrimitive(solid);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...part.position), new THREE.Quaternion().setFromEuler(primitiveRotation(part)), new THREE.Vector3(1, 1, 1));
      add(solid.paint, primitiveGeometry(part.kind, part.size, part.vertices, undefined, part.shaping, undefined, part.mesh, part.solid), matrix);
    } catch {
      // An invalid draft solid stays out of the drawing; the compiler names it.
    }
  }
  for (const tube of def.tubes) {
    if (tube.points.length < 2 || !(tube.diameterM > 0) || tube.points.some((p) => p.some((n) => !Number.isFinite(n)))) continue;
    add(tube.paint, constructionTubeGeometry([tube.points], tube.diameterM / 2, undefined, TUBE_SIDES));
  }
  for (const [paint, [positions, normals]] of coats) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const surface = componentMaterial('naval');
    const material = new THREE.MeshStandardMaterial({
      color: options.ghost ? new THREE.Color('#e0c58d') : paint ? new THREE.Color(constructionPaintColor(paint)) : new THREE.Color().setRGB(...(surface.color as [number, number, number])),
      roughness: paint ? constructionFinishRoughness(options.finish, surface.roughness) : surface.roughness,
      metalness: surface.metallic,
      transparent: !!options.ghost,
      opacity: options.ghost ? 0.6 : 1,
      depthWrite: !options.ghost,
      side: THREE.DoubleSide,
    });
    material.name = paint ? `custom-fitting.${paint}` : 'custom-fitting';
    // Only unpainted shapes follow the installation's coating.
    if (!paint) material.userData = surface.userData;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = paint ? `${def.id}.${paint}` : def.id;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
