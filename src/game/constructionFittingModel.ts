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
/** Triangles facing within this cosine of straight up are roofs, as the hull's decks are. */
const ROOF_NORMAL_Y = 0.7;
/** A horizontal mesh triangle with the fitting's own geometry this close above it is an underside (a slab's
 * lower face, a closed box's floor), not a roof. */
const ROOF_CLEARANCE_M = 1;
/** Coat-key suffix of the roofs split from a coating that wears the installation or ship paint. */
const ROOF = '\u0000roof';

type Coat = { positions: number[]; normals: number[]; indices: number[] };
/** The ship paint, and the colour roofs explicitly painted with it are drawn. */
export type FittingRoof = { shipPaint: string; color: string };

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

/** Horizontal triangles of a mesh open to the sky: a vertical line up from each one's centroid meets none of
 * the mesh's own triangles within `ROOF_CLEARANCE_M`. Exported meshes do not keep a consistent winding, so a
 * triangle facing either way counts; a roof wound downward is still a roof and a slab's lower face is not. */
export function exposedTops(mesh: DecodedFittingMesh): Uint8Array {
  const { points: p, triangles: t } = mesh,
    count = t.length / 3,
    tops = new Uint8Array(count);
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    z0 = Math.min(z0, p[i + 2]);
    z1 = Math.max(z1, p[i + 2]);
  }
  // Triangles binned by their plan bounds, about one per cell.
  const n = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(count)))),
    sx = n / Math.max(x1 - x0, 1e-6),
    sz = n / Math.max(z1 - z0, 1e-6);
  const column = (x: number) => Math.min(n - 1, Math.max(0, Math.floor((x - x0) * sx))),
    row = (z: number) => Math.min(n - 1, Math.max(0, Math.floor((z - z0) * sz)));
  const cells: number[][] = Array.from({ length: n * n }, () => []);
  const corners = (f: number) => [3 * t[3 * f], 3 * t[3 * f + 1], 3 * t[3 * f + 2]] as const;
  for (let f = 0; f < count; f++) {
    const [a, b, c] = corners(f);
    for (let i = column(Math.min(p[a], p[b], p[c])); i <= column(Math.max(p[a], p[b], p[c])); i++)
      for (let k = row(Math.min(p[a + 2], p[b + 2], p[c + 2])); k <= row(Math.max(p[a + 2], p[b + 2], p[c + 2])); k++)
        cells[i * n + k].push(f);
  }
  // Height of triangle g over the plan point (x, z), when that point lies inside its plan.
  const heightAt = (g: number, x: number, z: number) => {
    const [a, b, c] = corners(g);
    const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
    if (Math.abs(d) < 1e-12) return undefined;
    const u = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d,
      v = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d;
    return u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9 ? undefined : u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1];
  };
  for (let f = 0; f < count; f++) {
    const [a, b, c] = corners(f);
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const ny = uz * vx - ux * vz;
    if (!(Math.abs(ny) > ROOF_NORMAL_Y * Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx))) continue;
    const x = (p[a] + p[b] + p[c]) / 3,
      y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
      z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const covered = cells[column(x) * n + row(z)].some((g) => {
      const h = g === f ? undefined : heightAt(g, x, z);
      return h !== undefined && h > y + 1e-3 && h < y + ROOF_CLEARANCE_M;
    });
    if (!covered) tops[f] = 1;
  }
  return tops;
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
 * painted ones keep their colour. Roofs of solids and meshes that follow the installation get their own
 * `roof`-role coating, which that paint recolours with its roof colour; roofs explicitly painted
 * `roof.shipPaint` are drawn `roof.color`. Tubes have no roofs. Build it once per definition and clone
 * it per instance: clones share the geometry. */
export function createConstructionFittingModel(
  def: ConstructionFittingDefinition,
  options: { ghost?: boolean; finish?: ConstructionSurfaceFinish; roof?: FittingRoof } = {},
): THREE.Group {
  const group = new THREE.Group();
  group.name = def.name;
  const coats = new Map<string, Coat>();
  const roofed = (paint: string) => paint === '' || paint === options.roof?.shipPaint;
  const add = (paint = '', geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4, roofs = true) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    if (matrix) flat.applyMatrix4(matrix);
    const position = flat.getAttribute('position').array,
      normal = flat.getAttribute('normal').array;
    for (let i = 0; i < position.length; i += 9) {
      // Solids are drawn with outward lighting normals; their sum says which way a triangle faces.
      const nx = normal[i] + normal[i + 3] + normal[i + 6],
        ny = normal[i + 1] + normal[i + 4] + normal[i + 7],
        nz = normal[i + 2] + normal[i + 5] + normal[i + 8];
      const key = roofs && roofed(paint) && ny > ROOF_NORMAL_Y * Math.hypot(nx, ny, nz) ? paint + ROOF : paint;
      let coat = coats.get(key);
      if (!coat) coats.set(key, (coat = { positions: [], normals: [], indices: [] }));
      const base = coat.positions.length / 3;
      for (let k = i; k < i + 9; k++) {
        coat.positions.push(position[k]);
        coat.normals.push(normal[k]);
      }
      coat.indices.push(base, base + 1, base + 2);
    }
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
    add(tube.paint, constructionTubeGeometry([tube.points], tube.diameterM / 2, undefined, TUBE_SIDES), undefined, false);
  }
  for (const mesh of def.meshes ?? []) {
    try {
      const decoded = decodeFittingMesh(mesh),
        paintOf = meshPaints(mesh),
        tops = exposedTops(decoded);
      creasedFittingMesh(decoded, (t) => (tops[t] && roofed(paintOf(t)) ? paintOf(t) + ROOF : paintOf(t)), FITTING_MESH_CREASE_DEG, coats);
    } catch {
      // An undecodable mesh stays out of the drawing; the compiler names it.
    }
  }
  const walls = componentMaterial('naval'),
    roofs = componentMaterial('roof');
  for (const [key, { positions, normals, indices }] of coats) {
    if (!indices.length) continue;
    const roof = key.endsWith(ROOF),
      paint = roof ? key.slice(0, -ROOF.length) : key,
      surface = roof ? roofs : walls,
      name = (paint ? '.' + paint : '') + (roof ? '.roof' : '');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(
      positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: options.ghost
        ? new THREE.Color('#e0c58d')
        : paint
          ? new THREE.Color(roof ? options.roof!.color : constructionPaintColor(paint))
          : new THREE.Color().setRGB(...(surface.color as [number, number, number])),
      roughness: paint ? constructionFinishRoughness(options.finish, surface.roughness) : surface.roughness,
      metalness: surface.metallic,
      transparent: !!options.ghost,
      opacity: options.ghost ? 0.6 : 1,
      depthWrite: !options.ghost,
      side: THREE.DoubleSide,
    });
    material.name = 'custom-fitting' + name;
    // Only unpainted shapes follow the installation's coating.
    if (!paint) material.userData = surface.userData;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = def.id + name;
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
