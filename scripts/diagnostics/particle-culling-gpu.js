import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import { EffectParticlePool, effectTexture } from '/src/game/EffectParticles.ts';
import { effectVolumeMaterial, effectVolumeTexture } from '/src/game/EffectVolume.ts';
import { prepareInstanceUploads } from '/src/game/InstanceUploads.ts';
import { installInstanceBufferNames } from '/src/game/InstanceBufferNames.ts';

const map = effectTexture('smoke'), volumeMap = effectVolumeTexture(), rows = [];
const hash = async pixels => [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(n => n.toString(16).padStart(2, '0')).join('');
for (const reversed of [false, true]) {
const renderer = new THREE.WebGPURenderer({ reversedDepthBuffer: reversed });
await renderer.init(); installInstanceBufferNames(renderer.backend);
const target = new THREE.RenderTarget(256, 256), scene = new THREE.Scene();
renderer.setRenderTarget(target);
for (const kind of ['billboard', 'velocity', 'water', 'additive', 'volume']) {
  const pools = [false, true].map(cull => {
    const material = kind === 'volume'
      ? effectVolumeMaterial(volumeMap, uniform(new THREE.Vector3(-.55, .74, -.39).normalize()), float(reversed ? 0 : 1), 16, true) : undefined;
    const pool = new EffectParticlePool(128, map, kind === 'additive', material, false, cull);
    prepareInstanceUploads(pool.mesh); scene.add(pool.mesh); return pool;
  });
  for (const view of ['wide', 'edge', 'rear', 'zoom', 'inside', 'near', 'ortho']) {
    const camera = view === 'ortho' ? new THREE.OrthographicCamera(-20, 20, 20, -20, .5, 1000)
      : new THREE.PerspectiveCamera(view === 'zoom' ? 3 : 60, 1, view === 'near' ? 10 : .5, 1000);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera._reversedDepth = reversed; camera.updateProjectionMatrix();
    camera.position.set(view === 'edge' ? 35 : 0, view === 'inside' || view === 'near' ? 10 : 18, view === 'inside' || view === 'near' ? 0 : 35);
    camera.lookAt(0, 10, view === 'rear' ? 100 : -20); camera.updateMatrixWorld(true);
    for (const pool of pools) {
      pool.reset();
      for (let i = 0; i < 96; i++) {
        const p = pool.emit(new THREE.Vector3(i < 2 ? 0 : Math.sin(i * 2.3) * 160, i < 2 ? 10 : 10 + Math.cos(i) * 8, i === 0 ? 0 : i === 1 ? -20 : Math.cos(i * .71) * 140));
        p.size = i === 0 && view === 'near' ? 1 : 6; p.life = 8; p.age = i % 7 * .13;
        p.growth = i % 3 - 1; p.growthDecay = .4; p.diffusion = .2; p.stretch = 1 + i % 4;
        p.velocity.set(Math.cos(i) * 5, Math.sin(i) * 3, -2); p.angle = i * .7;
        p.align = kind === 'velocity' || kind === 'water' ? kind : 'billboard';
        p.volumeAspect = 1 + i % 3; p.volumeYaw = i * .3; p.volumeAxisY = Math.sin(i);
        p.color.setRGB(.5, .6, .7); p.opacity = .7; p.density = 4;
      }
    }
    // Move both copies identically; culling must only affect publication.
    for (const pool of pools) pool.advance(.016, new THREE.Vector3(1, 0, 2));
    const pictures = [];
    for (const [i, pool] of pools.entries()) {
      pool.publish(camera); pools[1 - i].mesh.visible = false;
      renderer.render(scene, camera);
      pictures.push(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256));
    }
    const hashes = await Promise.all(pictures.map(hash));
    let max = 0, different = 0;
    for (let i = 0; i < pictures[0].length; i++) {
      const delta = Math.abs(pictures[0][i] - pictures[1][i]);
      max = Math.max(max, delta); if (delta) different++;
    }
    rows.push({ kind, reversed, view, counts: pools.map(p => p.count), hashes, max, different,
      lit: pictures[0].filter((v, i) => i % 4 !== 3 && v > 0).length });
    if (!reversed && ['edge', 'inside'].includes(view)) for (const [i, pixels] of pictures.entries()) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      canvas.title = `${kind} ${view} ${i ? 'culled' : 'reference'}`;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 256, 256), 0, 0);
      document.body.append(canvas);
    }
  }
  for (const pool of pools) { pool.mesh.removeFromParent(); pool.dispose(); }
}
target.dispose(); renderer.dispose();
}
window.result = { passed: rows.every(r => r.max === 0) && rows.some(r => r.counts[1] < r.counts[0]) && rows.every(r => r.lit > 0), rows };
document.querySelector('#status').textContent = JSON.stringify(window.result, null, 2);
map.dispose(); volumeMap.dispose();
