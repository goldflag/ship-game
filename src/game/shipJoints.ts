import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { barrelIds } from '../ships/blueprint/blueprintTypes';
import { radians } from './geometry';

export interface JointMountPose { train: number; elevation: number; recoil: number }
export interface JointMotion { rudder: number; distance: number; speed: number }
type AppendageKind = keyof NonNullable<ShipDefinition['submarine']>['appendages'];

/** A ship model's moving joints and the transforms a pose writes to them.
 * `ShipRenderView` drives it every frame; the construction export writes its neutral pose, so this
 * module (not the rest of the ship view) is part of the construction model recipe. */
export class ShipJoints {
  /** Every model node that carries a `nodeId`. */
  readonly nodes = new Map<string, THREE.Object3D>();
  /** Per mount: its joints, the fixed yaw of its bearing (less a construction joint's own) and its recoil travel. */
  readonly mounts: { yaw: THREE.Object3D; elevation: THREE.Object3D[]; recoil: THREE.Object3D[]; muzzles: THREE.Object3D[]; bearing: number; recoilM: number }[];
  readonly launchers: THREE.Object3D[];
  readonly tubes: THREE.Object3D[];
  readonly appendages: { node: THREE.Object3D; base: THREE.Quaternion; kind: AppendageKind; index: number }[] = [];
  private gunCovers: { mesh: THREE.Mesh; elevation: THREE.Object3D; angles: number[]; baseAngle: number }[] = [];

  constructor(model: THREE.Object3D, definition: ShipDefinition) {
    const nodes = this.nodes;
    model.traverse(o => { if (o.userData.nodeId) nodes.set(o.userData.nodeId, o); });
    const node = (id: string) => { const n = nodes.get(id); if (!n) throw new Error(`Ship export is missing ${id}. Rebuild with bun run ship:build ${definition.id}`); return n; };
    this.mounts = definition.mounts.map(m => {
      const yaw = node(`${m.id}.yaw`);
      return { yaw, elevation: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.elevation`)), recoil: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.recoil`)),
        muzzles: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.muzzle`)), bearing: radians(m.bearingDeg - (yaw.userData.constructionBearingDeg ?? 0)), recoilM: m.weapon.recoilM };
    });
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !o.userData.gunCoverElevationId) return;
      const angles: number[] = o.userData.gunCoverAngles;
      const baseAngle: number = o.userData.gunCoverBaseAngle ?? 0;
      if (!Array.isArray(angles) || !angles.length || angles.length !== o.morphTargetInfluences?.length ||
          !Number.isFinite(baseAngle) || angles.some((a, i) => !Number.isFinite(a) || a <= (angles[i - 1] ?? baseAngle))) {
        throw new Error(`Ship export has invalid gun-cover shapes on ${o.name}. Rebuild with bun run ship:build ${definition.id}`);
      }
      this.gunCovers.push({ mesh: o, elevation: node(o.userData.gunCoverElevationId), angles, baseAngle });
    });
    this.launchers = (definition.torpedoLaunchers ?? []).map(l => node(`${l.id}.yaw`));
    this.tubes = (definition.torpedoTubes ?? []).map(t => node(`${t.id}.muzzle`));
    if (definition.submarine) for (const kind of ['bowPlanes', 'sternPlanes', 'rudders', 'propellers'] as const) {
      this.appendages.push(...definition.submarine.appendages[kind].map((id, index) => ({ node: node(id), base: node(id).quaternion.clone(), kind, index })));
    }
    if (definition.construction) for (const instance of definition.construction.equipment) {
      for (const [suffix, kind] of [['spin', 'propellers'], ['yaw', 'rudders']] as const) {
        const bound = nodes.get(`${instance.id}.${suffix}`);
        if (bound && (kind !== 'rudders' || bound.userData.constructionEquipmentKind === 'rudder')) this.appendages.push({ node: bound, base: bound.quaternion.clone(), kind, index: this.appendages.length });
      }
    }
  }

  /** Write one pose: per-mount train/elevation/recoil, per-launcher train, hull motion for rudders and screws, and dive planes. */
  pose(mounts: readonly JointMountPose[], launchers: readonly { train: number }[], motion: JointMotion, planes: number): void {
    this.mounts.forEach((b, i) => {
      // A 180° imported quaternion can decompose into nonzero X/Z Euler angles.
      // Replace the complete joint rotation instead of retaining those alternate axes.
      b.yaw.rotation.set(0, -(b.bearing + mounts[i].train), 0);
      b.elevation.forEach(n => { n.rotation.set(mounts[i].elevation, 0, 0); });
      b.recoil.forEach(n => { n.position.z = mounts[i].recoil * b.recoilM; });
    });
    // Cloth is visual-only: the same gun angle drives its shapes.
    // Fixed seams stay on the gunhouse or carriage; moving seams follow pitch.
    for (const { mesh, elevation, angles, baseAngle } of this.gunCovers) {
      const degrees = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(elevation.rotation.x), baseAngle, angles.at(-1)!);
      const weights = mesh.morphTargetInfluences!;
      weights.fill(0);
      const upper = angles.findIndex(a => a >= degrees), lowerAngle = angles[upper - 1] ?? baseAngle;
      const fraction = (degrees - lowerAngle) / (angles[upper] - lowerAngle);
      weights[upper] = fraction;
      if (upper > 0) weights[upper - 1] = 1 - fraction;
    }
    this.launchers.forEach((node, i) => { node.rotation.set(0, -launchers[i].train + radians(node.userData.constructionBearingDeg ?? 0), 0); });
    this.appendages.forEach(({ node, base, kind, index }) => {
      node.quaternion.copy(base);
      if (kind === 'rudders') node.rotateY(-motion.rudder * radians(35));
      else if (kind === 'propellers') node.rotateZ(motion.distance * (index % 2 ? -1 : 1) * Math.sign(motion.speed) * 1.8);
      else node.rotateX(planes * radians(kind === 'bowPlanes' ? -20 : 20));
    });
  }

  /** Every joint at its canonical neutral transform: trained fore and aft, guns level, barrels run out, a still hull. */
  neutral(): void {
    this.pose(this.mounts.map(() => ({ train: 0, elevation: 0, recoil: 0 })), this.launchers.map(() => ({ train: 0 })), { rudder: 0, distance: 0, speed: 0 }, 0);
  }
}
