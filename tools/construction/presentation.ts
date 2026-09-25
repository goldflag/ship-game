import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import type { ShipRenderView } from '../../src/game/ShipRenderView';
import type { ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';
import type { ReviewView } from './review';

/** The one canvas, renderer and lit scene of a review page; `render` and `view` both draw into it. */
export function createReviewCanvas() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#eef3f5', '#66625b', 2.4));
  const sun = new THREE.DirectionalLight('#fff3db', 3); sun.position.set(70, 100, -50); scene.add(sun);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.append(renderer.domElement);
  return { scene, renderer, sun, dispose() { renderer.dispose(); renderer.domElement.remove(); } };
}
export type ReviewCanvas = ReturnType<typeof createReviewCanvas>;

/** Presentation changes invalidate images, never the exported model. */
export function createReviewPresentation(view: ShipRenderView, model: THREE.Object3D, source: ConstructionSource,
  definition: ShipDefinition, resetPose: () => void, focus: (id?: string, isolate?: boolean) => THREE.Object3D, canvas: ReviewCanvas = createReviewCanvas()) {
  const { scene, renderer } = canvas; scene.add(view.root);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 10000);
  const render = async (name: ReviewView = 'quarter', options: { id?: string; isolate?: boolean; width?: number; height?: number; transparent?: boolean; keepPose?: boolean } = {}) => {
    if (!options.keepPose) resetPose();
    const target = focus(options.id, options.isolate);
    view.updateRenderMatrices(); model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(target), center = bounds.getCenter(new THREE.Vector3());
    if (bounds.isEmpty()) throw new Error('Selected assembly has no renderable geometry.');
    const [width, height] = [options.width ?? (['profile', 'plan'].includes(name) ? 1600 : name === 'quarter' ? 1400 : 800), options.height ?? (['profile', 'plan'].includes(name) ? 520 : name === 'quarter' ? 900 : 800)];
    const directions = { profile: [1, 0, 0], plan: [0, 1, 0], bow: [0, 0, -1], stern: [0, 0, 1], quarter: [1, .6, -1] } as const;
    const radius = Math.max(5, bounds.getSize(new THREE.Vector3()).length());
    camera.position.copy(center).addScaledVector(new THREE.Vector3(...directions[name]).normalize(), radius * 2);
    camera.up.set(name === 'plan' ? 1 : 0, name === 'plan' ? 0 : 1, 0);
    camera.lookAt(center); camera.updateMatrixWorld(true);
    const extents = new THREE.Box3();
    for (let c = 0; c < 8; c++) extents.expandByPoint(new THREE.Vector3(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(camera.matrixWorldInverse));
    const size = extents.getSize(new THREE.Vector3()), aspect = width / height;
    const halfHeight = Math.max(size.y, size.x / aspect, .2) * .55;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
    camera.far = radius * 6; camera.updateProjectionMatrix();
    renderer.setSize(width, height); renderer.setClearColor('#353b3f', options.transparent ? 0 : 1);
    renderer.render(scene, camera);
    return { png: renderer.domElement.toDataURL('image/png'), camera: { name, position: camera.position.toArray(), target: center.toArray(), up: camera.up.toArray(), projection: 'orthographic', width, height, halfHeight, sourceRevision: source.revision, contentHash: definition.contentHash } };
  };
  return { render, dispose() { canvas.dispose(); } };
}
