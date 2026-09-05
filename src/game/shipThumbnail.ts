import * as THREE from 'three/webgpu';

/** Render the loaded exterior once; the port displays the resulting static image. */
export async function renderShipThumbnail(source: THREE.Object3D, signal: AbortSignal): Promise<string> {
  const model = source.clone(true);
  const scene = new THREE.Scene();
  scene.add(model, new THREE.HemisphereLight('#ffffff', '#87949e', 2.5));
  const key = new THREE.DirectionalLight('#fff6e7', 3);
  key.position.set(-120, 240, -180);
  const fill = new THREE.DirectionalLight('#dae9ff', 1.5);
  fill.position.set(120, 80, 160);
  scene.add(key, fill);

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const distance = bounds.getSize(new THREE.Vector3()).length();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, distance * 4);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(-1, .45, -.35).normalize(), distance * 2);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  // Fit the complete hull and mast in camera space for every ship preset.
  const projected = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      }
    }
  }
  const width = 600, height = 180;
  const size = projected.getSize(new THREE.Vector3());
  const halfHeight = Math.max(size.y, size.x * height / width) * .54;
  camera.top = halfHeight; camera.bottom = -halfHeight;
  camera.right = halfHeight * width / height; camera.left = -camera.right;
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearAlpha(0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await renderer.init();
    signal.throwIfAborted();
    renderer.render(scene, camera);
    // Copy immediately, before the drawing buffer is cleared for another frame.
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The ship thumbnail canvas could not be created.');
    context.drawImage(renderer.domElement, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    renderer.dispose();
    // Geometry, materials and textures belong to the game's loaded model.
  }
}
