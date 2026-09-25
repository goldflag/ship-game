import * as THREE from 'three/webgpu';
import type { Battery, Vec3 } from '../ships/blueprint';
import { ShipRenderView } from './ShipRenderView';
import { tubeLocalPosition } from './torpedoAim';
import { gunAimPoints } from './gunAim';
import { muzzleWorld, shotDirection } from './mountGeometry';

/** The ship view the game and tools hold: `ShipRenderView` plus read-only queries against its drawn pose.
 * These never write a transform or a material, so the sight, ballistics and muzzle checks stay out of the
 * construction presentation recipe. Anything that changes a drawn frame belongs in `ShipRenderView`. */
export class ShipView extends ShipRenderView {
  /** Read-only check of the loaded joints against the CPU poses sampled for this frame. */
  muzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.joints.mounts.flatMap((binding, i) => binding.muzzles.map((node, barrel) => {
      const m = this.definition.mounts[i], state = this.renderedMounts[i];
      const expected = new THREE.Vector3(...muzzleWorld(m, state, barrel, this.motion));
      expected.addScaledVector(new THREE.Vector3(...shotDirection(m, state, this.motion)), -state.recoil * m.weapon.recoilM);
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    }));
  }
  torpedoMuzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.joints.tubes.map((node, i) => {
      const local = tubeLocalPosition({ definition: this.definition, torpedoLaunchers: this.renderedLaunchers }, this.definition.torpedoTubes![i]);
      const expected = this.root.localToWorld(new THREE.Vector3(...local));
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    });
  }
  /** Match the displayed barrels; readiness remains from the authoritative tick. */
  gunAimPoints(battery: Battery, aim: Vec3, weaponGroupId?: string) {
    return gunAimPoints({ ...this.actor, motion: this.motion, mounts: this.renderedMounts }, this.definition, battery, aim, weaponGroupId);
  }
}
