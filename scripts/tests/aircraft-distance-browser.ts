import * as THREE from 'three/webgpu';
import { AircraftView } from '../../src/game/AircraftView';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';

/** Compare the aircraft presentation with its actual lit airframe. Only a
 * faint subpixel contact may supplement geometry, within its projected span. */
export async function checkAircraftDistanceRendering(forceWebGL = false, verify = true) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL });
  await renderer.init();
  const size = 512;
  renderer.setSize(size, size); renderer.setClearColor(0, 0);
  const target = new THREE.RenderTarget(size, size);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaabbd0, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(5, 10, 8); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(52, 1, .5, 60000);
  const view = new AircraftView(); view.resize(size); scene.add(view.root);
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const planes = [...new Map(sim.aircraft.map(p => [p.modelId, p])).values()];
  sim.aircraft.forEach(p => { p.phase = 'lost'; });
  const frames: { model: string; distance: number; zoom: number; span: number; width: number; modelWidth: number; changedPixels: number; addedAlpha: number }[] = [];
  const render = async () => {
    renderer.render(scene, camera);
    return await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
  };
  const width = (pixels: ArrayLike<number>) => {
    let left = size, right = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3] > 0) {
      left = Math.min(left, x); right = Math.max(right, x);
    }
    return Math.max(0, right - left + 1);
  };
  try {
    await view.load(); renderer.setRenderTarget(target);
    for (const plane of planes) {
      plane.phase = 'outbound'; plane.payload = false;
      plane.position = plane.previousPosition = [0, 300, 0];
      plane.pitch = plane.bank = plane.heading = plane.wingFold = 0;
      plane.previousAttitude = { pitch: 0, bank: 0, heading: 0 };
      let wingspan = 0;
      for (const [distance, zoom] of [[150, 1], [400, 1], [800, 1], [1600, 1], [3200, 1], [6400, 1], [3200, 16]]) {
        camera.position.set(0, 300, distance); camera.lookAt(0, 300, 0);
        camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        view.update(sim, camera, true);
        if (!wingspan) {
          const bounds = new THREE.Box3(), matrix = new THREE.Matrix4();
          for (const object of view.root.children) if (object instanceof THREE.InstancedMesh && object.visible && object.name.startsWith('Aircraft model ')) {
            object.getMatrixAt(0, matrix);
            const box = new THREE.Box3().setFromBufferAttribute(object.geometry.getAttribute('position') as THREE.BufferAttribute);
            bounds.union(box.applyMatrix4(matrix));
          }
          wingspan = bounds.max.x - bounds.min.x;
        }
        const span = wingspan * camera.projectionMatrix.elements[5] * size / (2 * distance);
        const full = await render();
        const supplements = view.root.children.filter(c => c.visible && !c.name.startsWith('Aircraft model '));
        supplements.forEach(c => { c.visible = false; });
        const model = await render();
        supplements.forEach(c => { c.visible = true; });
        let changedPixels = 0, addedAlpha = 0;
        for (let i = 0; i < full.length; i += 4) {
          if ([0, 1, 2, 3].some(c => full[i + c] !== model[i + c])) changedPixels++;
          addedAlpha = Math.max(addedAlpha, full[i + 3] - model[i + 3]);
        }
        const frame = { model: plane.modelId, distance, zoom, span, width: width(full), modelWidth: width(model), changedPixels, addedAlpha };
        frames.push(frame);
        if (verify && ((span >= 12 && changedPixels > 0) || (span >= 2 && frame.width === 0)
          || frame.width > Math.ceil(span) + 1 || addedAlpha > 255 * .3)) {
          throw new Error(`Distant aircraft enlarged or repainted: ${JSON.stringify(frame)}`);
        }
      }
      plane.phase = 'lost';
    }
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', frames };
  } finally { target.dispose(); await view.dispose(); renderer.dispose(); }
}
