import * as THREE from 'three';
import type { ConstructionFittingDefinition, ConstructionFittingMesh, ConstructionSurfaceFinish } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { solidPrimitive, TUBE_SIDES } from '../ships/constructionCustomFittings';
import { decodeFittingMesh, type DecodedFittingMesh } from '../ships/constructionFittingMesh';
import { constructionFinishRoughness, constructionPaintColor } from '../ships/constructionPaints';
import { primitiveGeometry, primitiveRotation } from './constructionShapeGeometry';
import { constructionTubeGeometry } from './constructionTubeGeometry';

/** Faces meeting at more than this angle keep a hard edge on a visual mesh. */
export const FITTING_MESH_CREASE_DEG = 35;

type Coat = { positions: number[]; normals: number[]; indices: number[] };

/** Crease-angle normals for one decoded mesh, as indexed runs per coating. A triangle corner averages the
 * area-weighted normals of the faces around its vertex that lie within the crease angle of its own face;
 * corners of one vertex with the same normal and coating share an output vertex. `paintOf(t)` names the
 * coating of triangle t. */
export function creasedFittingMesh(
  mesh: DecodedFittingMesh,
  paintOf: (triangle: number) => string,
  creaseDeg = FITTING_MESH_CREASE_DEG,
  coats = new Map<string, Coat>(),
) {
  const { points: p, triangles: t } = mesh,
    count = t.length / 3,
    vertices = p.length / 3;
  const weighted = new Float64Array(3 * count),
    unit = new Float64Array(3 * count);
  for (let f = 0; f < count; f++) {
    const a = 3 * t[3 * f],
      b = 3 * t[3 * f + 1],
      c = 3 * t[3 * f + 2];
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    weighted.set([nx, ny, nz], 3 * f);
    if (length > 0) unit.set([nx / length, ny / length, nz / length], 3 * f);
  }
  // Faces around each vertex, compressed rows.
  const start = new Uint32Array(vertices + 1);
  for (let i = 0; i < t.length; i++) start[t[i] + 1]++;
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v];
  const around = new Uint32Array(t.length),
    fill = start.slice(0, vertices);
  for (let i = 0; i < t.length; i++) around[fill[t[i]]++] = Math.floor(i / 3);
  const limit = Math.cos((creaseDeg * Math.PI) / 180);
  // Output vertices already made for a source vertex: coating, normal and index.
  const made = new Map<number, { coat: string; normal: [number, number, number]; index: number }[]>();
  for (let f = 0; f < count; f++) {
    const paint = paintOf(f);
    let coat = coats.get(paint);
    if (!coat) coats.set(paint, (coat = { positions: [], normals: [], indices: [] }));
    for (let corner = 0; corner < 3; corner++) {
      const v = t[3 * f + corner];
      let nx = 0,
        ny = 0,
        nz = 0;
      for (let i = start[v]; i < start[v + 1]; i++) {
        const g = around[i];
        if (unit[3 * f] * unit[3 * g] + unit[3 * f + 1] * unit[3 * g + 1] + unit[3 * f + 2] * unit[3 * g + 2] < limit) continue;
        nx += weighted[3 * g];
        ny += weighted[3 * g + 1];
        nz += weighted[3 * g + 2];
      }
      const length = Math.hypot(nx, ny, nz);
      const normal: [number, number, number] =
        length > 0
          ? [nx / length, ny / length, nz / length]
          : unit[3 * f] || unit[3 * f + 1] || unit[3 * f + 2]
            ? [unit[3 * f], unit[3 * f + 1], unit[3 * f + 2]]
            : [0, 1, 0];
      const list = made.get(v) ?? [];
      made.set(v, list);
      let out = list.find((m) => m.coat === paint && m.normal[0] * normal[0] + m.normal[1] * normal[1] + m.normal[2] * normal[2] > 0.9999);
      if (!out) {
        out = { coat: paint, normal, index: coat.positions.length / 3 };
        coat.positions.push(p[3 * v], p[3 * v + 1], p[3 * v + 2]);
        coat.normals.push(...normal);
        list.push(out);
      }
      coat.indices.push(out.index);
    }
  }
  return coats;
}

/** Coating of each triangle of a mesh: its group's paint, or '' to follow the instance and ship paint. */
function meshPaints(mesh: ConstructionFittingMesh): (triangle: number) => string {
  const groups = mesh.groups ?? [];
  if (!groups.some((g) => g.paint)) return () => '';
  const paint = new Array<string>(mesh.triangles).fill('');
  for (const g of groups) if (g.paint) paint.fill(g.paint, g.start, g.start + g.count);
  return (t) => paint[t];
}

/** The one drawing of a design-local fitting, for the editor, thumbnails, port, battle and export.
 * Solids come from the same display recipes as hull blocks, so a fitting looks exactly like the
 * blocks it was made from; visual meshes are drawn with crease-angle normals. Display only: mass,
 * support and fit belong to the native compiler. One indexed mesh per coating: shapes, tubes and mesh
 * groups without a `paint` follow the instance and ship paint (`paintConstructionFitting`), explicitly
 * painted ones keep their colour. Build it once per definition and clone it per instance: clones share
 * the geometry. */
export function createConstructionFittingModel(
  def: ConstructionFittingDefinition,
  options: { ghost?: boolean; finish?: ConstructionSurfaceFinish } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = def.name;
  const coats = new Map<string, Coat>();
  const add = (paint: string | undefined, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    if (matrix) flat.applyMatrix4(matrix);
    let coat = coats.get(paint ?? '');
    if (!coat) coats.set(paint ?? '', (coat = { positions: [], normals: [], indices: [] }));
    const position = flat.getAttribute('position').array,
      normal = flat.getAttribute('normal').array,
      base = coat.positions.length / 3;
    for (let i = 0; i < position.length; i++) {
      coat.positions.push(position[i]);
      coat.normals.push(normal[i]);
    }
    for (let i = 0; i < position.length / 3; i++) coat.indices.push(base + i);
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  };
  for (const solid of def.solids) {
    try {
      const part = solidPrimitive(solid);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...part.position),
        new THREE.Quaternion().setFromEuler(primitiveRotation(part)),
        new THREE.Vector3(1, 1, 1),
      );
      add(
        solid.paint,
        primitiveGeometry(part.kind, part.size, part.vertices, undefined, part.shaping, undefined, part.mesh, part.solid),
        matrix,
      );
    } catch {
      // An invalid draft solid stays out of the drawing; the compiler names it.
    }
  }
  for (const tube of def.tubes) {
    if (tube.points.length < 2 || !(tube.diameterM > 0) || tube.points.some((p) => p.some((n) => !Number.isFinite(n)))) continue;
    add(tube.paint, constructionTubeGeometry([tube.points], tube.diameterM / 2, undefined, TUBE_SIDES));
  }
  for (const mesh of def.meshes ?? []) {
    try {
      creasedFittingMesh(decodeFittingMesh(mesh), meshPaints(mesh), FITTING_MESH_CREASE_DEG, coats);
    } catch {
      // An undecodable mesh stays out of the drawing; the compiler names it.
    }
  }
  for (const [paint, { positions, normals, indices }] of coats) {
    if (!indices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(
      positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const surface = componentMaterial('naval');
    const material = new THREE.MeshStandardMaterial({
      color: options.ghost
        ? new THREE.Color('#e0c58d')
        : paint
          ? new THREE.Color(constructionPaintColor(paint))
          : new THREE.Color().setRGB(...(surface.color as [number, number, number])),
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

/** Triangles a fitting drawing holds, for budgets and tests. */
export function fittingModelTriangles(model: THREE.Object3D): number {
  let triangles = 0;
  model.traverse((node) => {
    if (node instanceof THREE.Mesh) triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
  });
  return triangles;
}
