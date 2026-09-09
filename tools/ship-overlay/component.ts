import * as THREE from 'three';
import type { GunPart } from '../../src/ships/blueprint';

/** Display-only isolation of published geometry. Never an authoring input. */
export function isolateAssembly(scene: THREE.Object3D, assemblyId: string) {
  const originalMeshes: THREE.Mesh[] = [];
  let yaw: THREE.Object3D | undefined;
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.userData.nodeId === `${assemblyId}.yaw`) yaw = o; if (o instanceof THREE.Mesh) originalMeshes.push(o); });
  if (!yaw) throw new Error(`Published model has no ${assemblyId}.yaw joint`);
  const origin = yaw.matrixWorld.clone().invert();
  let meshes = 0;
  const prune = (o: THREE.Object3D, inherited = false): boolean => {
    // GLTFLoader expands a multi-material mesh into untagged primitive meshes
    // under a tagged group. Ownership propagates until explicitly overridden.
    const tagged = o.userData.assemblyId !== undefined || o.userData.nodeId !== undefined;
    const belongs = tagged ? o.userData.assemblyId === assemblyId || String(o.userData.nodeId ?? '').startsWith(`${assemblyId}.`) : inherited;
    for (const child of [...o.children]) if (!prune(child, belongs)) o.remove(child);
    if (o instanceof THREE.Mesh && belongs) meshes++;
    if (o instanceof THREE.Mesh && !belongs && o.children.length) throw new Error('Cannot isolate a mixed assembly mesh');
    return belongs || o.children.length > 0;
  };
  prune(scene);
  if (!meshes) throw new Error(`No separate geometry for ${assemblyId}; rebuild its original recipe with assembly IDs`);
  const retained = new Set<THREE.Mesh>(); scene.traverse(o => { if (o instanceof THREE.Mesh) retained.add(o); });
  const geometries = new Set([...retained].map(o => o.geometry));
  const materials = new Set([...retained].flatMap(o => Array.isArray(o.material) ? o.material : [o.material]));
  const textures = new Set([...materials].flatMap(m => Object.values(m).filter(v => v instanceof THREE.Texture)));
  for (const mesh of originalMeshes) if (!retained.has(mesh)) {
    if (!geometries.has(mesh.geometry)) mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!materials.has(material)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && !textures.has(value)) value.dispose();
      material.dispose();
    }
  }
  const frame = new THREE.Group(); frame.applyMatrix4(origin); frame.add(scene);
  return frame;
}

export class ComponentArticulation {
  private joints: { node: THREE.Object3D; suffix: string; rotation: THREE.Quaternion; position: THREE.Vector3 }[] = [];
  private covers: { mesh: THREE.Mesh; angles: number[] }[] = [];
  constructor(root: THREE.Object3D, assemblyId: string) {
    root.traverse(node => {
      if (node instanceof THREE.Mesh && String(node.userData.gunCoverElevationId ?? '').startsWith(`${assemblyId}.`)) {
        const angles = node.userData.gunCoverAngles;
        if (Array.isArray(angles) && angles.length && angles.length === node.morphTargetInfluences?.length && angles.every((a, i) => Number.isFinite(a) && a > (angles[i - 1] ?? 0))) this.covers.push({ mesh: node, angles });
      }
      const id = String(node.userData.nodeId ?? '');
      if (!id.startsWith(`${assemblyId}.`)) return;
      const suffix = id.slice(assemblyId.length + 1);
      if (suffix === 'yaw' || suffix.endsWith('.elevation') || suffix.endsWith('.recoil')) this.joints.push({ node, suffix, rotation: node.quaternion.clone(), position: node.position.clone() });
    });
  }
  pose(weapon: GunPart, yaw: number, elevation: number, recoil: number) {
    const deg = THREE.MathUtils.degToRad;
    for (const joint of this.joints) {
      joint.node.quaternion.copy(joint.rotation); joint.node.position.copy(joint.position);
      if (joint.suffix === 'yaw') joint.node.rotateY(-deg(THREE.MathUtils.clamp(yaw, -weapon.traverseDeg, weapon.traverseDeg)));
      else if (joint.suffix.endsWith('.elevation')) {
        const initial = new THREE.Euler().setFromQuaternion(joint.rotation).x;
        joint.node.rotateX(deg(THREE.MathUtils.clamp(elevation, weapon.elevationMinDeg, weapon.elevationMaxDeg)) - initial);
      }
      else joint.node.position.z += THREE.MathUtils.clamp(recoil, 0, 1) * weapon.recoilM;
    }
    for (const { mesh, angles } of this.covers) {
      const angle = THREE.MathUtils.clamp(elevation, 0, Math.min(weapon.elevationMaxDeg, angles.at(-1)!));
      const weights = mesh.morphTargetInfluences!; weights.fill(0);
      const upper = angles.findIndex(a => a >= angle), lower = angles[upper - 1] ?? 0;
      const fraction = (angle - lower) / (angles[upper] - lower);
      weights[upper] = fraction; if (upper > 0) weights[upper - 1] = 1 - fraction;
    }
  }
}
