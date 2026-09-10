import { createHash } from 'node:crypto';
import { Euler, Matrix4, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { loadShipGeometry } from '../diagnostics/load-ship-geometry';

// Native fit samples are deliberately checked against published triangles, not
// the authored support points or native surface-height implementation.
// Run: bun scripts/aircraft/check_deck_contact.ts [native-samples.json]
// Floor contact and raised fittings are reported separately; neither failure
// class passes silently. Paint strips, wires and seams are not support datums.
type Point = [number, number, number];
type Triangle = [Point, Point, Point];
interface Sample {
  ship: string; model: string; modelHash: string; root: Point;
  attitude: { heading: number; pitch: number; roll: number };
}
const jointIds = ['gear.port', 'gear.starboard', 'gear.tail', 'arrestor.hook'];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const samplesPath = process.argv[2] ?? '.build/pve-ground/contact-poses.json';
const source = await Bun.file(samplesPath).json() as { manifestHash: string; samples: Sample[] };
const manifestBytes = new Uint8Array(await Bun.file('.build/naval-content/manifest.json').arrayBuffer());
if (hash(manifestBytes) !== source.manifestHash) throw new Error('Native samples belong to a different content manifest');
if (!source.samples.length) throw new Error('No native contact samples supplied');
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
  aircraft: { id: string; deckGeometry: { modelHash: string; hookDeckFraction: number } }[];
  ships: { id: string; contentHash: string; sha256: string; json: string }[];
};

function inherited(object: Object3D, key: string): string {
  for (let node: Object3D | null = object; node; node = node.parent) if (typeof node.userData[key] === 'string') return node.userData[key];
  return '';
}
function meshTriangles(mesh: Mesh): { triangle: Triangle; material: Material }[] {
  const positions = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  const points = Array.from({ length: positions.count }, (_, i) => new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).toArray());
  const result: { triangle: Triangle; material: Material }[] = [];
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const group = mesh.geometry.groups.find(group => i >= group.start && i < group.start + group.count);
    const material = Array.isArray(mesh.material) ? mesh.material[group?.materialIndex ?? 0] : mesh.material;
    if (!material) throw new Error(`${mesh.name}: triangle has no material`);
    result.push({ triangle: [0, 1, 2].map(j => points[index ? index.getX(i + j) : i + j]) as Triangle, material });
  }
  return result;
}
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
function height(triangle: Triangle, point: Point): number {
  const [a, b, c] = triangle, area = cross(a, b, c);
  const u = cross(a, point, c) / area, v = cross(a, b, point) / area;
  return a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
}
function overlap(aircraft: Triangle, deck: Triangle, axes: [number, number] = [0, 2]): Point[] {
  let polygon: Point[] = aircraft;
  const side = (a: Point, b: Point, c: Point) => (b[axes[0]] - a[axes[0]]) * (c[axes[1]] - a[axes[1]]) - (b[axes[1]] - a[axes[1]]) * (c[axes[0]] - a[axes[0]]);
  const sign = Math.sign(side(...deck));
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const a = deck[edge], b = deck[(edge + 1) % 3], next: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dp = sign * side(a, b, p) + 1e-10, dq = sign * side(a, b, q) + 1e-10;
      const insideP = dp >= 0, insideQ = dq >= 0;
      if (insideP) next.push(p);
      if (insideP !== insideQ) {
        const t = dp / (dp - dq);
        next.push(p.map((value, axis) => value + (q[axis] - value) * t) as Point);
      }
    }
    polygon = next;
  }
  return polygon;
}
class DeckSurface {
  readonly triangles: Triangle[] = [];
  readonly meshes = new Map<string, number>();
  private readonly triangleMeshes: { mesh: string; material: string; nodeId: string; assemblyId: string }[] = [];
  witness?: { aircraft: Point; deckHeight?: number; mesh: string; material: string; nodeId: string; assemblyId: string; normal?: Point; intersection?: Point };
  constructor(private readonly kind: 'floor' | 'fitting' = 'floor') {}
  private readonly grid = new Map<string, number[]>();
  private keys(triangle: Triangle): string[] {
    const result: string[] = [];
    for (let x = Math.floor(Math.min(...triangle.map(p => p[0])) / 2); x <= Math.floor(Math.max(...triangle.map(p => p[0])) / 2); x++) {
      for (let z = Math.floor(Math.min(...triangle.map(p => p[2])) / 2); z <= Math.floor(Math.max(...triangle.map(p => p[2])) / 2); z++) result.push(`${x},${z}`);
    }
    return result;
  }
  add(mesh: Mesh, accept: (material: Material, triangle: Triangle) => boolean) {
    for (const { triangle, material } of meshTriangles(mesh)) if (accept(material, triangle)) this.include(mesh, triangle, material);
  }
  include(mesh: Mesh, triangle: Triangle, material: Material) {
    // Outward top-facing triangles; deck sides and undersides cannot support tyres.
    if (this.kind === 'floor' && cross(...triangle) >= -1e-10) return;
    const id = this.triangles.length; this.triangles.push(triangle);
    this.triangleMeshes.push({ mesh: mesh.name, material: material.name, nodeId: inherited(mesh, 'nodeId'), assemblyId: inherited(mesh, 'assemblyId') });
    for (const key of this.keys(triangle)) { const list = this.grid.get(key) ?? []; list.push(id); this.grid.set(key, list); }
    this.meshes.set(mesh.name, (this.meshes.get(mesh.name) ?? 0) + 1);
  }
  conformsToFloor(triangle: Triangle): boolean {
    if (cross(...triangle) >= -1e-10) return false;
    const candidates = [...new Set(this.keys(triangle).flatMap(key => this.grid.get(key) ?? []))].map(id => this.triangles[id]);
    const contains = (floor: Triangle, p: Point) => {
      const area = cross(...floor), u = cross(floor[0], p, floor[2]) / area, v = cross(floor[0], floor[1], p) / area;
      return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
    };
    // One containing floor triangle proves coverage of the whole convex finish:
    // vertex rays alone could bridge a hole or an unsupported platform edge.
    if (!candidates.some(floor => triangle.every(p => contains(floor, p) && p[1] - height(floor, p) >= 0 && p[1] - height(floor, p) <= .001))) return false;
    // A higher overlapping floor can pierce the finish between its vertices.
    return candidates.every(floor => overlap(triangle, floor).every(p => p[1] - height(floor, p) >= -1e-9));
  }
  gap(triangle: Triangle): number {
    let minimum = Infinity;
    this.witness = undefined;
    const candidates = new Set(this.keys(triangle).flatMap(key => this.grid.get(key) ?? []));
    for (const id of candidates) {
      const deck = this.triangles[id];
      if (this.kind === 'fitting') {
        // Only actual triangle crossings count as fitting penetration. An
        // overhead catwalk's projection is not a collision with gear below it.
        if ([0, 1, 2].some(axis => Math.min(...triangle.map(p => p[axis])) > Math.max(...deck.map(p => p[axis])) + 1e-9
          || Math.max(...triangle.map(p => p[axis])) < Math.min(...deck.map(p => p[axis])) - 1e-9)) continue;
        const a = new Vector3(...deck[0]), normal = new Vector3(...deck[1]).sub(a).cross(new Vector3(...deck[2]).sub(a));
        if (normal.lengthSq() < 1e-18) continue;
        normal.normalize();
        const components = normal.toArray(), major = components.map(Math.abs).indexOf(Math.max(...components.map(Math.abs)));
        const axes = [0, 1, 2].filter(axis => axis !== major) as [number, number];
        const polygon = overlap(triangle, deck, axes);
        const distances = polygon.map(point => normal.dot(new Vector3(...point).sub(a)));
        const low = Math.min(...distances), high = Math.max(...distances);
        // Front-to-back penetration of at least 1 mm. Coplanar contact and
        // wholly separated surfaces do not create a physical intersection.
        if (low < -.001 && high > 1e-9 && low < minimum) {
          minimum = low;
          const below = polygon[distances.indexOf(low)], above = polygon[distances.indexOf(high)];
          const intersection = below.map((value, axis) => value + (above[axis] - value) * -low / (high - low)) as Point;
          this.witness = { aircraft: below, normal: components, intersection, ...this.triangleMeshes[id] };
        }
        continue;
      }
      // Clip complete triangles: step edges inside a wheel/hook triangle still
      // count even when none of that triangle's original vertices cross them.
      for (const point of overlap(triangle, deck)) {
        const deckHeight = height(deck, point), gap = point[1] - deckHeight;
        if (gap < minimum) { minimum = gap; this.witness = { aircraft: point, deckHeight, ...this.triangleMeshes[id] }; }
      }
    }
    return minimum;
  }
}

const decks = new Map<string, DeckSurface>(), fittings = new Map<string, DeckSurface>(), modelHashes: Record<string, string> = {}, finishCounts: Record<string, number> = {};
for (const ship of new Set(source.samples.map(sample => sample.ship))) {
  const root = await loadShipGeometry(ship), deck = new DeckSurface(), obstacles = new DeckSurface('fitting'); root.updateMatrixWorld(true);
  const record = manifest.ships.find(record => record.id === ship);
  const published = new Uint8Array(await Bun.file(`public/models/${ship}.json`).arrayBuffer());
  if (!record || hash(new TextEncoder().encode(record.json)) !== record.sha256 || hash(published) !== record.sha256
    || JSON.parse(record.json).contentHash !== record.contentHash || root.userData.definitionHash !== record.contentHash) {
    throw new Error(`${ship}: published ship definition/GLB does not match the sampled content manifest`);
  }
  const meshes: Mesh[] = [];
  root.traverse(object => { if ((object as Mesh).geometry) meshes.push(object as Mesh); });
  const supportMaterial = (mesh: Mesh, material: Material) => {
    const node = inherited(mesh, 'nodeId'), assembly = inherited(mesh, 'assemblyId');
    const scope = node === 'flight-deck.surface' || /^elevator-.*\.surface$/.test(node) || assembly === 'flight-deck-planking';
    return scope && (['deck', 'elevator', 'steel-deck'].includes(material.name)
      || /^(Original weathered deck timber|Stained Douglas fir) \d+$/.test(material.name));
  };
  for (const mesh of meshes) deck.add(mesh, material => supportMaterial(mesh, material));
  const finishes: { mesh: Mesh; triangle: Triangle; material: Material }[] = [];
  for (const mesh of meshes) {
    const node = inherited(mesh, 'nodeId'), assembly = inherited(mesh, 'assemblyId');
    const coatingScope = node === 'flight-deck.surface' || /^elevator-.*\.(surface|lift)$/.test(node)
      || ['flight-deck', 'flight-deck-planking'].includes(assembly);
    obstacles.add(mesh, (material, triangle) => {
      if (supportMaterial(mesh, material)) return false;
      if (coatingScope && ['line', 'edge'].includes(material.name) && deck.conformsToFloor(triangle)) {
        finishes.push({ mesh, triangle, material }); return false;
      }
      return true;
    });
  }
  // Classify every coating against the underlying floor before adding accepted
  // finishes to the floor query and its unchanged tyre/hook contact tolerances.
  for (const { mesh, triangle, material } of finishes) deck.include(mesh, triangle, material);
  finishCounts[ship] = finishes.length;
  if (!deck.triangles.length) throw new Error(`${ship}: missing published flight deck`);
  modelHashes[ship] = hash(new Uint8Array(await Bun.file(`public/models/${ship}.glb`).arrayBuffer()));
  decks.set(ship, deck); fittings.set(ship, obstacles);
  console.log(`${ship}: ${deck.triangles.length} supporting triangles from ${deck.meshes.size} meshes; ${obstacles.triangles.length} fitting triangles`);
}

type Failure = { sample: number; ship: string; model: string; lod: number; joint: string; gap: number | null; root: Point; witness?: DeckSurface['witness'] };
const failures: Failure[] = [], fittingConflicts: Failure[] = [];
const ranges: Record<string, { min: number; max: number; checks: number }> = {};
let checks = 0;
for (const model of new Set(source.samples.map(sample => sample.model))) {
  const geometry = manifest.aircraft.find(aircraft => aircraft.id === model)?.deckGeometry;
  if (!geometry || !Number.isFinite(geometry.hookDeckFraction)) throw new Error(`${model}: missing baked hook stop`);
  for (const lod of [0, 1, 2]) {
    const id = lod ? `aircraft/LOD${lod}/${model}-lod${lod}` : `aircraft/${model}`;
    const bytes = new Uint8Array(await Bun.file(`public/models/${id}.glb`).arrayBuffer()); modelHashes[id] = hash(bytes);
    if (!lod && modelHashes[id] !== geometry.modelHash) throw new Error(`${model}: published GLB differs from manifest`);
    const root = await loadShipGeometry(id);
    root.traverse(object => { if (object.userData.nodeId === 'arrestor.hook') object.rotateX(.65 * geometry.hookDeckFraction); });
    root.updateMatrixWorld(true);
    const joints = new Map<string, Triangle[]>();
    root.traverse(object => {
      if (!(object as Mesh).geometry) return;
      let owner: Object3D | null = object;
      while (owner && !jointIds.includes(owner.userData.nodeId)) owner = owner.parent;
      if (!owner) return;
      const id = String(owner.userData.nodeId), triangles = joints.get(id) ?? [];
      triangles.push(...meshTriangles(object as Mesh).map(record => record.triangle)); joints.set(id, triangles);
    });
    for (const id of jointIds) if (!joints.get(id)?.length) throw new Error(`${model} LOD${lod}: missing ${id} geometry`);
    for (const [index, sample] of source.samples.entries()) {
      if (sample.model !== model) continue;
      if (sample.modelHash !== geometry.modelHash) throw new Error(`Sample ${index}: model hash mismatch`);
      const matrix = new Matrix4().makeRotationFromEuler(new Euler(sample.attitude.pitch, -sample.attitude.heading, sample.attitude.roll, 'YXZ'));
      matrix.setPosition(...sample.root);
      const deck = decks.get(sample.ship)!;
      for (const [joint, triangles] of joints) {
        let gap = Infinity, fittingGap = Infinity;
        let witness: DeckSurface['witness'], fittingWitness: DeckSurface['witness'];
        const obstacles = fittings.get(sample.ship)!;
        for (const triangle of triangles) {
          const posed = triangle.map(point => new Vector3(...point).applyMatrix4(matrix).toArray()) as Triangle;
          const candidate = deck.gap(posed);
          if (candidate < gap) { gap = candidate; witness = deck.witness; }
          const obstacleGap = obstacles.gap(posed);
          if (obstacleGap < fittingGap) { fittingGap = obstacleGap; fittingWitness = obstacles.witness; }
        }
        if (fittingGap < -.001) fittingConflicts.push({ sample: index, ship: sample.ship, model, lod, joint, gap: fittingGap, root: sample.root, witness: fittingWitness });
        const key = `${sample.ship}/${model}/LOD${lod}/${joint}`, range = ranges[key] ?? { min: Infinity, max: -Infinity, checks: 0 };
        range.min = Math.min(range.min, gap); range.max = Math.max(range.max, gap); range.checks++; ranges[key] = range; checks++;
        const hook = joint === 'arrestor.hook';
        if (!Number.isFinite(gap) || gap < (hook ? -.001 : -.02) || (!hook && gap > .02)) {
          failures.push({ sample: index, ship: sample.ship, model, lod, joint, gap: Number.isFinite(gap) ? gap : null, root: sample.root, witness });
        }
      }
    }
    console.log(`${model} LOD${lod}: checked (${failures.length} cumulative failures)`);
  }
}
const reportPath = samplesPath.replace(/\.json$/, '') + '.checked.json';
const surfaceSummary = (surfaces: Map<string, DeckSurface>) => Object.fromEntries([...surfaces].map(([id, deck]) => [id, { triangles: deck.triangles.length, meshes: Object.fromEntries(deck.meshes) }]));
await Bun.write(reportPath, JSON.stringify({ manifestHash: source.manifestHash, samples: source.samples.length, checks, modelHashes, finishCounts, decks: surfaceSummary(decks), fittings: surfaceSummary(fittings), ranges, failures, fittingConflicts }, null, 2));
console.log(`${source.samples.length} native poses, ${checks} gear/hook checks, ${failures.length} floor failures, ${fittingConflicts.length} fitting conflicts; ${reportPath}`);
if (failures.length || fittingConflicts.length) { console.error(JSON.stringify({ failures: failures.slice(0, 12), fittingConflicts: fittingConflicts.slice(0, 12) }, null, 2)); process.exitCode = 1; }
