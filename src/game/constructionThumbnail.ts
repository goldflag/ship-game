import * as THREE from 'three';
import { createConstructionModel, disposeConstructionModel } from './constructionModel';
import type { LocalShipRevision } from '../ships/localShips';

const WIDTH = 600, HEIGHT = 180;

/** Render the same exterior and fittings as the harbor, independent of its camera. */
export async function bakeConstructionThumbnail(ship: LocalShipRevision): Promise<string> {
  const model = await createConstructionModel(ship.source, ship.result);
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    const scene = new THREE.Scene(); scene.add(model);
    scene.add(new THREE.HemisphereLight('#edf0f2', '#595c5f', 2.6));
    const sun = new THREE.DirectionalLight('#fff2d2', 3);
    sun.position.set(-80, 150, -120); scene.add(sun);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) throw new Error('The ship has no exterior to render.');
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, radius * 4);
    camera.position.copy(center).addScaledVector(new THREE.Vector3(-1, .32, -.18).normalize(), radius * 2);
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    const size = projected.getSize(new THREE.Vector3()), mid = projected.getCenter(new THREE.Vector3());
    const halfHeight = Math.max(size.y, size.x * HEIGHT / WIDTH, .1) * .55;
    const halfWidth = halfHeight * WIDTH / HEIGHT;
    camera.left = mid.x - halfWidth; camera.right = mid.x + halfWidth;
    camera.bottom = mid.y - halfHeight; camera.top = mid.y + halfHeight;
    camera.updateProjectionMatrix();
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    disposeConstructionModel(model);
    renderer?.dispose(); renderer?.forceContextLoss();
  }
}
