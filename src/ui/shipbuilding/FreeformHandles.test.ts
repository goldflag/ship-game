import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ConstructionSource } from '../../ships/blueprint';
import { FreeformHandles } from './FreeformHandles';

// Only DOM writes are stubbed; camera movement and the production handle projection are real.
class HandleElement extends EventTarget {
  style: Record<string,string> = { transform: '' };
  dataset: Record<string,string> = {};
  classList = { add() {} };
  attributes: Record<string,string> = {};
  children: HandleElement[] = [];
  hidden = false;
  clientWidth = 1200;
  clientHeight = 900;
  setAttribute(name: string,value: string) { this.attributes[name]=value; }
  append(element: HandleElement) { this.children.push(element); }
  remove() {}
}
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new HandleElement(), createElementNS: () => new HandleElement() } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
});
afterEach(() => {
  for (const [key, descriptor] of [['document', originalDocument], ['window', originalWindow]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

for (const mode of ['vertex','edge','face'] as const) for (const projection of ['orthographic', 'perspective'] as const) {
  for (const motion of ['orbit', 'pan'] as const) {
    test(`${projection} ${mode} handles follow ${motion} and damping in the frame being rendered`, () => {
      const camera = projection === 'perspective'
        ? new THREE.PerspectiveCamera(40, 4 / 3, .1, 1000)
        : new THREE.OrthographicCamera(-12, 12, 9, -9, .1, 1000);
      camera.position.set(65, 45, -75);
      const controls = new OrbitControls(camera);
      controls.enableDamping = true; controls.dampingFactor = .15;
      const host = new HandleElement();
      controls.domElement = host as unknown as HTMLElement;
      camera.updateMatrixWorld();
      const handles = new FreeformHandles(host as unknown as HTMLElement, () => camera, () => {});
      const source = { revision: 'camera-test', construction: { primitives: [
        { id: 'cube', kind: 'box', position: [0, 0, 0], size: [4, 4, 4], rotationDeg: 0 },
      ] } } as unknown as ConstructionSource;
      handles.update(source, { id: 'cube', selection:{mode,index:0}, axes: [false, false, false],
        unit: .2, snap: false, onSelect() {}, onCommit() {} });
      try {
        for (let frame = 0; frame < 60; frame++) {
          if (frame < 30) {
            if (motion === 'pan') controls.pan(5, -3);
            else { controls.rotateLeft(.012); controls.rotateUp(.006); }
          }
          // This is the viewport's order: controls, handle projection, then WebGL render.
          controls.update(); handles.frame();
          const handle = host.children[0].children.find(element => element.attributes['aria-label'] === (mode==='face'?'Bow face':mode==='edge'?'Edge 1':'Vertex 1'))!;
          const [x, y] = handle.style.transform.match(/translate\((.*)px,(.*)px\)/)!.slice(1).map(Number);
          // WebGLRenderer refreshes camera matrices before drawing the hull.
          camera.updateMatrixWorld();
          const corner = new THREE.Vector3(mode==='vertex'?-2:0, mode==='face'?0:-2, -2).project(camera);
          const expectedX = (corner.x + 1) * host.clientWidth / 2;
          const expectedY = (1 - corner.y) * host.clientHeight / 2;
          expect(Math.hypot(x - expectedX, y - expectedY)).toBeLessThan(1e-7);
        }
      } finally { handles.dispose(); }
    });
  }
}
