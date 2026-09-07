import { expect, test } from 'bun:test';
import { Matrix4, Vector3, type Mesh } from 'three';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { aircraftDeckAttitude, aircraftGroundPose } from './aircraftGroundPose';
import { rotate } from './geometry';

test('all exported carrier aircraft seat both main wheels and the tail wheel at every LOD', async () => {
  for (const id of ['f4f-4-wildcat', 'sbd-3-dauntless', 'tbd-1-devastator']) {
    const { pitch, clearance } = aircraftGroundPose(id);
    for (const lod of [0, 1, 2]) {
      const root = await loadShipGeometry(lod ? `aircraft/LOD${lod}/${id}-lod${lod}` : `aircraft/${id}`);
      root.rotation.x = pitch; root.position.y = clearance; root.updateMatrixWorld(true);
      for (const nodeId of ['gear.port', 'gear.starboard', 'gear.tail']) {
        let lowest = Infinity;
        root.traverse(joint => {
          if (joint.userData.nodeId !== nodeId) return;
          joint.traverse(object => {
            const mesh = object as Mesh, positions = mesh.geometry?.getAttribute('position');
            if (!positions) return;
            for (let i = 0; i < positions.count; i++) lowest = Math.min(lowest, new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).y);
          });
        });
        // Tyre tread and simplified distant LODs vary by up to 13 mm.
        expect(lowest, `${id} LOD${lod} ${nodeId}`).toBeGreaterThanOrEqual(-.02);
        expect(lowest, `${id} LOD${lod} ${nodeId}`).toBeLessThan(.02);
      }
      root.traverse(object => (object as Mesh).geometry?.dispose());
    }
  }
});

test('CPU deck attitude composes carrier pitch and roll with taxi heading and resting pitch', () => {
  const carrier = { heading: .7, pitch: .12, roll: -.18 };
  for (const heading of [-Math.PI, -.8, 0, 1.4, Math.PI]) {
    const attitude = aircraftDeckAttitude(carrier, 'sbd-3-dauntless', heading);
    const carrierMatrix = new Matrix4().makeRotationY(-carrier.heading).multiply(new Matrix4().makeRotationX(carrier.pitch)).multiply(new Matrix4().makeRotationZ(carrier.roll));
    const expected = carrierMatrix.multiply(new Matrix4().makeRotationY(-heading)).multiply(new Matrix4().makeRotationX(aircraftGroundPose('sbd-3-dauntless').pitch));
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
      const actual = rotate([...axis], { ...attitude, roll: attitude.bank });
      const vector = new Vector3(...axis).applyMatrix4(expected).toArray();
      actual.forEach((value, i) => expect(value).toBeCloseTo(vector[i], 10));
    }
  }
});
