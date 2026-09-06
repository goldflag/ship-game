import * as THREE from 'three/webgpu';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CombatEvent } from '../simulation/combat';
import type { ShellType, SurfaceImpact } from '../simulation/damage';
import { impactTexture } from './ImpactTexture';

export const MAX_SHIP_IMPACT_MARKS = 96;
const SURFACE_SEARCH_M = 3;
let atlas: THREE.DataTexture | undefined, atlasUsers = 0;

export function impactStyle(caliberM: number, type: ShellType, outcome: SurfaceImpact['outcome']) {
  // Readable paint damage around a caliber-sized wound. These are visual approximations.
  const diameter = THREE.MathUtils.clamp(caliberM, .02, 2) * 5;
  const tile = outcome === 'ricochet' ? 2 : type === 'HE' && outcome !== 'penetration' ? 3 : outcome === 'penetration' ? 0 : 1;
  const blast = type === 'HE' ? 1.65 : 1;
  return { tile, width: diameter * (outcome === 'ricochet' ? 2.5 : blast), height: diameter * blast };
}

/** Clip a small, front-facing subset before asking DecalGeometry to split triangles.
 * Avoids allocating hundreds of thousands of decal vertices for each hull strike. */
function projectSurface(receiver: THREE.Mesh, point: THREE.Vector3, normal: THREE.Vector3, tangent: THREE.Vector3, width: number, height: number) {
  const across = tangent.clone().normalize(), up = new THREE.Vector3().crossVectors(normal, across).normalize();
  const basis = new THREE.Matrix4().makeBasis(across, up, normal);
  const orientation = new THREE.Euler().setFromRotationMatrix(basis);
  const projector = basis.clone().setPosition(point).invert().multiply(receiver.matrixWorld);
  const source = receiver.geometry, positions = source.getAttribute('position'), normals = source.getAttribute('normal');
  const index = source.index, count = index?.count ?? positions.count;
  const vertices: number[] = [], directions: number[] = [];
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const depth = Math.min(.8, Math.max(.16, Math.min(width, height) * .3));
  for (let i = 0; i < count; i += 3) {
    for (let j = 0; j < 3; j++) p[j].fromBufferAttribute(positions, index ? index.getX(i + j) : i + j).applyMatrix4(projector);
    if (p.every(v => v.x < -width / 2) || p.every(v => v.x > width / 2) ||
        p.every(v => v.y < -height / 2) || p.every(v => v.y > height / 2) ||
        p.every(v => v.z < -depth / 2) || p.every(v => v.z > depth / 2)) continue;
    if (a.subVectors(p[1], p[0]).cross(b.subVectors(p[2], p[0])).normalize().z < .25) continue;
    for (let j = 0; j < 3; j++) {
      const id = index ? index.getX(i + j) : i + j;
      vertices.push(positions.getX(id), positions.getY(id), positions.getZ(id));
      if (normals) directions.push(normals.getX(id), normals.getY(id), normals.getZ(id));
    }
  }
  const subset = new THREE.BufferGeometry();
  subset.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (normals) subset.setAttribute('normal', new THREE.Float32BufferAttribute(directions, 3));
  else subset.computeVertexNormals();
  const proxy = new THREE.Mesh(subset); proxy.matrixWorld.copy(receiver.matrixWorld);
  const geometry = new DecalGeometry(proxy, point, orientation, new THREE.Vector3(width, height, depth));
  subset.dispose();
  geometry.applyMatrix4(receiver.matrixWorld.clone().invert());
  return geometry;
}

type Mark = { receiver: THREE.Mesh; geometry: THREE.BufferGeometry; shellId: number; point: THREE.Vector3 };

/** Persistent, mesh-conforming battle scars. All combat decisions stay in the CPU. */
export class ShipImpactMarks {
  private readonly receivers: { mesh: THREE.Mesh; mountId?: string }[] = [];
  private readonly marks: Mark[] = [];
  private readonly batches = new Map<THREE.Mesh, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  private material?: THREE.MeshStandardMaterial;
  private visible = true;
  private sequence = 0;

  constructor(private readonly root: THREE.Group, model: THREE.Group, private readonly mounts: Map<string, THREE.Object3D>) {
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      let mountId: string | undefined;
      for (let parent: THREE.Object3D | null = object; parent && !mountId; parent = parent.parent) {
        for (const [id, node] of mounts) if (parent === node) { mountId = id; break; }
      }
      this.receivers.push({ mesh: object, mountId });
    });
  }

  get count() { return this.marks.length; }
  get drawCalls() { return this.batches.size; }

  update(events: readonly CombatEvent[], shipId: string): void {
    const dirty = new Set<THREE.Mesh>();
    let updated = false;
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.shipId !== shipId || !event.impact || !event.shell) continue;
      if (!updated) { this.root.updateMatrixWorld(true); updated = true; }
      const { impact, shell } = event;
      const frame = impact.mountId ? this.mounts.get(impact.mountId) : this.root;
      if (!frame) continue;
      const point = new THREE.Vector3(...impact.position).applyMatrix4(frame.matrixWorld);
      const normal = new THREE.Vector3(...impact.normal).transformDirection(frame.matrixWorld);
      const direction = new THREE.Vector3(...impact.direction).transformDirection(frame.matrixWorld);
      if (![...point, ...normal, ...direction, shell.caliberM].every(Number.isFinite) || normal.lengthSq() < .5) continue;
      const candidates = this.receivers.filter(r => r.mountId === impact.mountId).map(r => r.mesh);
      // Physical plate winding need not point outwards (port belt plates share
      // starboard winding). Search both normal directions and use the mesh face.
      const hits = [1, -1].flatMap(sign => {
        const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, SURFACE_SEARCH_M * sign),
          normal.clone().multiplyScalar(-sign), 0, SURFACE_SEARCH_M * 2);
        return ray.intersectObjects(candidates, false);
      }).filter(hit => hit.face &&
        Math.abs(hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(normal)) > .25);
      hits.sort((a, b) => a.point.distanceToSquared(point) - b.point.distanceToSquared(point));
      const hit = hits[0];
      if (!hit) continue; // Never draw a floating mark when the proxy has no matching visible surface.
      const receiver = hit.object as THREE.Mesh;
      const localPoint = receiver.worldToLocal(hit.point.clone());
      if (this.marks.some(mark => mark.shellId === shell.id && mark.receiver === receiver && mark.point.distanceTo(localPoint) < Math.max(.5, shell.caliberM * 2))) continue;
      const faceNormal = hit.face!.normal.clone().transformDirection(receiver.matrixWorld);
      const tangent = direction.clone().addScaledVector(faceNormal, -direction.dot(faceNormal));
      if (tangent.lengthSq() < .001) tangent.crossVectors(Math.abs(faceNormal.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), faceNormal);
      tangent.normalize();
      const style = impactStyle(shell.caliberM, shell.type ?? 'AP', impact.outcome);
      if (impact.outcome !== 'ricochet') tangent.applyAxisAngle(faceNormal, (shell.id * 2.399963) % (Math.PI * 2));
      const geometry = projectSurface(receiver, hit.point, faceNormal, tangent, style.width, style.height);
      if (!geometry.getAttribute('position').count) { geometry.dispose(); continue; }
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + style.tile) / 4);
      this.marks.push({ receiver, geometry, shellId: shell.id, point: localPoint }); dirty.add(receiver);
      while (this.marks.length > MAX_SHIP_IMPACT_MARKS) {
        const oldest = this.marks.shift()!; oldest.geometry.dispose(); dirty.add(oldest.receiver);
      }
    }
    for (const receiver of dirty) this.rebuild(receiver);
  }

  private rebuild(receiver: THREE.Mesh): void {
    const old = this.batches.get(receiver);
    if (old) { old.removeFromParent(); old.geometry.dispose(); this.batches.delete(receiver); }
    const geometries = this.marks.filter(mark => mark.receiver === receiver).map(mark => mark.geometry);
    if (!geometries.length) return;
    if (!this.material) {
      atlas ??= impactTexture(); atlasUsers++;
      this.material = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: .92, metalness: .15 });
    }
    const batch = new THREE.Mesh(mergeGeometries(geometries)!, this.material);
    batch.name = 'Shell impact marks'; batch.visible = this.visible; batch.receiveShadow = true;
    batch.renderOrder = 1; batch.raycast = () => {};
    receiver.add(batch); this.batches.set(receiver, batch);
  }

  setVisible(visible: boolean): void {
    this.visible = visible; this.batches.forEach(batch => { batch.visible = visible; });
  }

  clear(): void {
    this.marks.forEach(mark => mark.geometry.dispose()); this.marks.length = 0;
    this.batches.forEach(batch => { batch.removeFromParent(); batch.geometry.dispose(); }); this.batches.clear();
    this.sequence = 0;
  }

  dispose(): void {
    this.clear();
    if (this.material) {
      this.material.dispose(); this.material = undefined;
      if (--atlasUsers === 0) { atlas?.dispose(); atlas = undefined; }
    }
  }
}
