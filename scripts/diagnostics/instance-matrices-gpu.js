import * as THREE from 'three/webgpu';
import { AircraftView } from '/src/game/AircraftView.ts';
import { AircraftGunfire } from '/src/game/AircraftGunfire.ts';
import { installInstanceBufferNames } from '/src/game/InstanceBufferNames.ts';
import { CombatSimulation } from '/src/simulation/combat.ts';
import { shipPreset } from '/src/ships/presets.ts';

const renderer = new THREE.WebGPURenderer();
await renderer.init();
if (new URLSearchParams(location.search).has('stable')) installInstanceBufferNames(renderer.backend);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(52, 1, .5, 60000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(20, 60, 50); scene.add(sun);
const target = new THREE.RenderTarget(256, 256);
renderer.setRenderTarget(target);
const a = new AircraftView(), b = new AircraftView();
await a.load(['f4f-4-wildcat']); await b.load(['f4f-4-wildcat'], true);
scene.add(a.root, b.root);
const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
const template = sim.aircraft.find(p => p.modelId === 'f4f-4-wildcat');
sim.player.airWing.planes = Array.from({ length: 801 }, (_, i) => ({ ...structuredClone(template), id: `matrix-${i}`, phase: 'outbound',
  payload: false, position: [(i % 5 - 2) * 16, 100, -Math.floor(i / 5) * 22],
  previousPosition: [(i % 5 - 2) * 16, 100, -Math.floor(i / 5) * 22], wingFold: i % 3 * .4 }));
const rows = [];
const hash = async pixels => [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(n => n.toString(16).padStart(2, '0')).join('');
for (const [count, distance] of [[1, 80], [6, 120], [0, 120], [801, 5000], [2, 80], [6, 400], [6, 1200]]) {
  sim.aircraft.forEach((p, i) => { p.phase = i < count ? 'outbound' : 'lost'; });
  camera.position.set(0, 100 + distance * .3, distance); camera.lookAt(0, 100, -10); camera.updateMatrixWorld(true);
  const pictures = [];
  let repeatedMatrixUploads = 0;
  for (const [view, other] of [[a, b], [b, a]]) {
    view.update(sim, camera, true); other.root.visible = false;
    renderer.render(scene, camera);
    if (view === b) {
      const queue = renderer.backend.device.queue, write = queue.writeBuffer;
      queue.writeBuffer = function (buffer, ...args) {
        if (buffer.label.startsWith('Aircraft model ')) repeatedMatrixUploads++;
        return write.call(this, buffer, ...args);
      };
      try { renderer.render(scene, camera); } finally { queue.writeBuffer = write; }
    }
    pictures.push(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256));
  }
  let max = 0, different = 0, lit = 0;
  for (let i = 0; i < pictures[0].length; i++) {
    const d = Math.abs(pictures[0][i] - pictures[1][i]); max = Math.max(max, d); if (d > 1) different++;
    if (i % 4 !== 3 && pictures[0][i]) lit++;
  }
  rows.push({ count, distance, max, different, lit, instances: b.diagnostics().instances, repeatedMatrixUploads,
    referenceHash: await hash(pictures[0]), storageHash: await hash(pictures[1]) });
}

// Record which first-use pipelines belong to dynamically added tracer pages.
a.root.visible = b.root.visible = false;
const gunfire = new AircraftGunfire(); scene.add(gunfire.root);
const pipelines = [], modules = new WeakMap(), device = renderer.backend.device;
const originalModule = device.createShaderModule.bind(device);
device.createShaderModule = descriptor => { const module = originalModule(descriptor); modules.set(module, descriptor.code); return module; };
const original = device.createRenderPipeline.bind(device);
renderer.backend.device.createRenderPipeline = descriptor => {
  pipelines.push({ label: descriptor.label, stage: window.stage, vertex: modules.get(descriptor.vertex.module), fragment: modules.get(descriptor.fragment.module) }); return original(descriptor);
};
camera.position.set(0, 100, 100); camera.lookAt(0, 100, -100); camera.updateMatrixWorld(true);
const tracers = [];
for (const events of [1, 100, 101]) {
  sim.events.length = 0;
  // A fresh event history and damage identity reset gunfire's event cache.
  sim.reset(); sim.tick = 16;
  for (let i = 0; i < events; i++) sim.events.push({ sequence: i + 1, tick: 0, kind: 'aircraft-fire', position: [i % 20, 100, 0], shipId: 'player', message: 'Diagnostic burst',
    aircraft: { id: `fighter-${i}`, target: [i % 20, 100, -500] } });
  window.stage = events; gunfire.update(sim, camera); renderer.render(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
  tracers.push({ events, count: gunfire.diagnostics(), hash: await hash(pixels), lit: pixels.filter((n, i) => i % 4 !== 3 && n > 0).length });
}
window.result = { passed: rows.every(r => r.max <= 1 && r.repeatedMatrixUploads === 0 && (r.count === 0 || r.lit > 0)) && tracers.every(r => r.lit > 0)
  && (!new URLSearchParams(location.search).has('stable') || pipelines.every(p => p.stage === 1)), rows, pipelines, tracers };
document.querySelector('#status').textContent = JSON.stringify(window.result, null, 2);
await a.dispose(); await b.dispose(); gunfire.dispose(); target.dispose(); renderer.dispose();
