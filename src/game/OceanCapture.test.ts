import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { SceneCapturePass } from '../../vendor/threejs-water-pro/build/index.js';

function fixture() {
  const scene = new THREE.Scene(), excluded = new THREE.Group();
  scene.add(excluded); scene.background = new THREE.Color('blue');
  const capture = new SceneCapturePass(scene, new THREE.PerspectiveCamera(), 4, 4);
  capture.excludeObject(excluded);
  let target: unknown = null;
  const calls: { transparent: boolean; opaque: boolean }[] = [];
  const renderer = {
    transparent: true, opaque: true, autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (value: unknown) => { target = value; },
    setClearColor: () => {}, clear: () => {}, setRenderObjectFunction: () => {},
    render: () => { calls.push({ transparent: renderer.transparent, opaque: renderer.opaque }); },
  };
  return { scene, excluded, capture, renderer, calls };
}

test('surface capture omits transparent effects while submerged fog retains both transparent passes', () => {
  const { capture, renderer, calls } = fixture();
  capture.render(renderer as unknown as THREE.WebGPURenderer, false, false);
  expect(calls).toEqual([{ transparent: false, opaque: true }]);
  expect(renderer.transparent).toBe(true);
  calls.length = 0;
  capture.render(renderer as unknown as THREE.WebGPURenderer, true, true);
  expect(calls).toEqual([
    { transparent: true, opaque: true },
    { transparent: true, opaque: false },
    { transparent: true, opaque: false },
  ]);
  expect(renderer.opaque).toBe(true);
  capture.dispose();
});

test('capture failure restores transparency, target, clearing, background and excluded visibility', () => {
  const { capture, renderer, scene, excluded } = fixture();
  const background = scene.background, target = new THREE.RenderTarget(4, 4);
  renderer.setRenderTarget(target);
  renderer.render = () => { throw new Error('render failed'); };
  expect(() => capture.render(renderer as unknown as THREE.WebGPURenderer, false, false)).toThrow('render failed');
  expect(renderer.transparent).toBe(true);
  expect(renderer.autoClear).toBe(true);
  expect(renderer.getRenderTarget()).toBe(target);
  expect(scene.background).toBe(background);
  expect(excluded.visible).toBe(true);
  capture.dispose(); target.dispose();
});
