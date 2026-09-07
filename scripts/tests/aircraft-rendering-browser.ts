import * as THREE from 'three/webgpu';
import { AircraftView } from '../../src/game/AircraftView';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';

/** Run through Vite in a browser. Count airframe pixels separately from payloads
 * after the GPU has already rendered a smaller flight. CPU counts miss this bug. */
export async function checkAircraftRendering(forceWebGL = false, verify = true) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL });
  await renderer.init();
  const size = 768, cells = 3, cellSize = size / cells;
  renderer.setSize(size, size); renderer.setClearColor(0, 0);
  renderer.info.autoReset = false;
  const target = new THREE.RenderTarget(size, size);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 3));
  const camera = new THREE.PerspectiveCamera(52, 1, .5, 60000);
  const view = new AircraftView(); view.resize(size);
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
  const templates = [...new Map(sim.aircraft.map(p => [p.modelId, p])).values()];
  scene.add(view.root);
  const frames: { model: string; lod: number; count: number; airframes: number; payloads: number; contacts: number; triangles: number }[] = [];
  const occupied = async () => {
    renderer.info.reset();
    renderer.render(scene, camera);
    const rgba = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    const pixels = Array<number>(cells * cells).fill(0);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3] > 0) pixels[Math.floor(y / cellSize) * cells + Math.floor(x / cellSize)]++;
    }
    return pixels;
  };
  try {
    await view.load();
    view.root.getObjectByName('Aircraft gunfire')!.visible = false;
    renderer.setRenderTarget(target);
    for (const template of templates) for (const [lod, distance] of [[0, 70], [1, 200], [2, 600], [0, 70]]) {
      const planes = Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(template), id: `player/render-${i}` }));
      sim.player.airWing!.planes = planes;
      camera.position.set(0, 300, distance); camera.lookAt(0, 300, 0); camera.updateMatrixWorld(true);
      const spacing = 2 * distance / camera.projectionMatrix.elements[5] / cells;
      planes.forEach((plane, i) => {
        plane.position = plane.previousPosition = [(i % cells - 1) * spacing, 300 + (Math.floor(i / cells) - 1) * spacing, 0];
        plane.pitch = plane.bank = plane.heading = plane.wingFold = 0;
        plane.previousAttitude = { pitch: 0, bank: 0, heading: 0 };
      });
      let trianglesPerPlane = 0;
      for (const count of [0, 1, 6, 2, 0, 9]) {
        planes.forEach((plane, i) => { plane.phase = i < count ? 'outbound' : 'lost'; });
        view.update(sim, camera, true);
        const models = view.root.children.filter(c => c.name.startsWith('Aircraft model ') && c.visible);
        if (models.some(m => m.name !== `Aircraft model ${template.modelId}/${lod}`)) throw new Error('Fixture selected the wrong aircraft LOD');
        const contacts = view.root.getObjectByName('Distant aircraft silhouettes')!;
        const contactsVisible = contacts.visible;
        contacts.visible = false;
        const payload = view.root.getObjectByName(template.role === 'dive-bomber' ? 'Aircraft bombs' : 'Aircraft torpedo payloads')!;
        const payloadVisible = payload.visible;
        payload.visible = false;
        const pixels = await occupied();
        const triangles = renderer.info.render.triangles;
        if (count === 1) trianglesPerPlane = triangles;
        if (triangles !== trianglesPerPlane * count) throw new Error(`Unused airframes submitted: ${triangles} triangles for ${count} planes`);
        payload.visible = payloadVisible;
        models.forEach(m => { m.visible = false; });
        const payloadPixels = await occupied();
        payload.visible = false; contacts.visible = contactsVisible;
        const contactPixels = await occupied();
        models.forEach(m => { m.visible = true; });
        payload.visible = payloadVisible;
        const frame = { model: template.modelId, lod, count, airframes: pixels.filter(n => n > 0).length,
          payloads: payloadPixels.filter(n => n > 0).length, contacts: contactPixels.filter(n => n > 0).length, triangles };
        frames.push(frame);
        if (verify && (frame.airframes !== count || (lod === 0 && frame.payloads !== (template.payload ? count : 0))
          || frame.contacts !== view.diagnostics().contacts)) throw new Error(`Aircraft visibility failed: ${JSON.stringify(frames)}`);
      }
    }
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', frames };
  } finally { target.dispose(); await view.dispose(); renderer.dispose(); }
}
