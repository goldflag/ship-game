import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ArmorOverlay } from './ArmorOverlay';

test('armor reuses the prepared ship pose and restores renderer state even when its pass fails', () => {
  const overlay = new ArmorOverlay(), root = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  root.position.set(12, 3, -8); root.updateMatrixWorld(true);
  const prepared = root.matrixWorld.clone();
  let updates = 0;
  const updateWorld = root.updateWorldMatrix.bind(root), update = root.updateMatrixWorld.bind(root);
  root.updateWorldMatrix = (...args) => { updates++; updateWorld(...args); };
  root.updateMatrixWorld = (...args) => { updates++; update(...args); };
  const previousTarget = new THREE.RenderTarget(), previousColor = new THREE.Color('#123456');
  let target = previousTarget, alpha = .7, fail = false;
  const color = previousColor.clone();
  const renderer = {
    autoClear: false,
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(1280, 720),
    getRenderTarget: () => target, setRenderTarget: (next: THREE.RenderTarget) => { target = next; },
    getClearAlpha: () => alpha, getClearColor: (out: THREE.Color) => out.copy(color),
    setClearColor: (next: THREE.ColorRepresentation, a: number) => { color.set(next); alpha = a; },
    render: (object: THREE.Object3D) => {
      // Match Three's scene update gate; ShipView already prepared these matrices.
      if (object.matrixWorldAutoUpdate) object.updateMatrixWorld();
      expect(object.matrixWorld.equals(prepared)).toBe(true);
      if (fail) throw new Error('render failed');
    },
  };
  for (fail of [false, true]) {
    const render = () => overlay.render(renderer as unknown as THREE.WebGPURenderer, camera, root);
    if (fail) expect(render).toThrow('render failed'); else render();
    expect(updates).toBe(0);
    expect(root.matrixWorldAutoUpdate).toBe(true);
    expect(target).toBe(previousTarget); expect(renderer.autoClear).toBe(false);
    expect(color.equals(previousColor)).toBe(true); expect(alpha).toBe(.7);
  }
  overlay.dispose(); previousTarget.dispose();
});
