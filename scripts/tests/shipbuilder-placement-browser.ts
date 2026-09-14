import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mountShipbuilderReview } from './shipbuilder-browser';
import type { Vec3 } from '../../src/ships/blueprint';

/** Real React, WebGL, OrbitControls, IndexedDB and native compiler regression.
 * Only pointer capture is stubbed for synthetic events; repeat the gestures with
 * browser mouse input when reviewing capture and drag behavior. */
export async function checkShipbuilderPlacement() {
  const checks: string[] = [], failures: string[] = [];
  let scene: THREE.Scene | undefined, camera: THREE.Camera | undefined, controls: OrbitControls | undefined;
  const rendered = THREE.Scene.prototype.onAfterRender, connect = OrbitControls.prototype.connect;
  THREE.Scene.prototype.onAfterRender = function (...args) { scene = this; camera = args[2]; rendered.apply(this, args); };
  OrbitControls.prototype.connect = function (element) { controls = this; connect.call(this, element); };
  const wait = async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > 45000) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const check = (condition: unknown, label: string) => { (condition ? checks : failures).push(label); };
  try {
    window.shipbuilderReview?.close(); await mountShipbuilderReview();
    const source = () => window.shipbuilderReview!.source!;
    await wait(() => source() && scene && camera && controls && !document.querySelector('.shipbuilder-compile')?.textContent?.includes('Compiling'), 'ready editor');
    const canvas = document.querySelector<HTMLCanvasElement>('.shipbuilder-canvas canvas')!;
    canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
    const host = canvas.parentElement!;
    host.setPointerCapture = host.releasePointerCapture = () => {};
    const click = async (label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.shipbuilder button')].find(item => item.textContent?.trim() === label);
      if (!button || button.disabled) throw new Error(`Button unavailable: ${label}`);
      button.click(); await frame();
    };
    const screen = (point: Vec3) => {
      const projected = new THREE.Vector3(...point).project(camera!);
      const bounds = canvas.getBoundingClientRect();
      return [bounds.x + (projected.x + 1) * bounds.width / 2, bounds.y + (1 - projected.y) * bounds.height / 2];
    };
    const pointer = (type: string, x: number, y: number, button = 0, buttons = 0) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 71, pointerType: 'mouse', button, buttons, clientX: x, clientY: y }));
    const visible = (object: THREE.Object3D): boolean => object.visible && (!object.parent || visible(object.parent));
    const hitHeight = (x: number, z: number) => {
      scene!.updateMatrixWorld(true);
      const meshes: THREE.Object3D[] = [];
      scene!.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !visible(object)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every(material => material.opacity >= .5 && !(material as THREE.MeshBasicMaterial).wireframe)) meshes.push(object);
      });
      return new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes, false)[0]?.point.y;
    };
    const ghost = () => {
      let found: THREE.Object3D | undefined;
      scene!.traverse(object => { if (object.userData.placementPreview && visible(object)) found = object; });
      return found;
    };
    const startCount = source().construction.primitives.length;
    await click('Place');
    let [x, y] = screen([12, 0, 0]);
    pointer('pointermove', x, y); await frame();
    const preview = ghost();
    check(!!preview, 'Place shows a visible cursor preview');
    if (preview) {
      const bounds = new THREE.Box3().setFromObject(preview);
      check(bounds.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(12, 0, 0)) < .001 && bounds.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 1, 1)) < .001, 'preview matches the snapped placement and chosen dimensions');
    }
    check(source().construction.primitives.length === startCount, 'hover does not modify the design');
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y);
    await wait(() => source().construction.primitives.length === startCount + 1 && document.querySelector('.shipbuilder-inspector')?.textContent?.includes('Detached hull'), 'detached piece saved and validated');
    await frame();
    check(Math.abs((hitHeight(3, 0) ?? Infinity) - 2.5) < .01, 'a disconnected draft keeps the original hull visible');
    check(Math.abs((hitHeight(12, 0) ?? Infinity) - .5) < .01, 'the newly placed disconnected block stays visible');
    check([...document.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent?.trim() === 'Sea trial' && button.disabled), 'draft validation still blocks trial launch');

    const beforeOrbit = camera!.position.clone();
    [x, y] = screen([0, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', x + 60, y + 35, -1, 1); pointer('pointerup', x + 60, y + 35);
    await frame();
    check(camera!.position.distanceTo(beforeOrbit) > .1, 'left-drag orbits while Place is selected');
    check(source().construction.primitives.length === startCount + 1, 'camera drag does not place a block');
    for (let attempt = 0; attempt < 2; attempt++) {
      const beforePan = controls!.target.clone();
      pointer('pointerdown', x, y, 2, 2); pointer('pointermove', x + 45, y + 25, -1, 2); pointer('pointerup', x + 45, y + 25, 2);
      await frame();
      check(controls!.target.distanceTo(beforePan) > .1, `right-drag pans after placement (gesture ${attempt + 1})`);
    }
    // Returning the pointer to its start still counts as a camera drag.
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', x + 30, y + 20, -1, 1); pointer('pointermove', x, y, -1, 1); pointer('pointerup', x, y);
    await frame();
    check(source().construction.primitives.length === startCount + 1, 'a drag returning to its start does not place a block');
    await click('Select');
    [x, y] = screen([12, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y); await frame();
    check(document.querySelector('.shipbuilder-inspector h2')?.textContent === '1 selected', 'a disconnected draft block remains selectable');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await wait(() => source().construction.primitives.length === startCount, 'removing disconnected block saves source');
    check(!ghost(), 'Select removes the placement ghost');
    await click('Undo');
    await wait(() => source().construction.primitives.length === startCount + 1, 'undo restores disconnected block');
    await click('Undo');
    await wait(() => source().construction.primitives.length === startCount && !document.querySelector('.shipbuilder-compile')?.textContent?.includes('Compiling') && document.querySelector('.shipbuilder-inspector')?.textContent?.includes('Launchable'), 'undo compiles original hull');
    check(Math.abs((hitHeight(3, 0) ?? Infinity) - 2.5) < .01, 'undo restores the native rendered hull');

    await click('Place'); await click('Top');
    const beforeTopPan = controls!.target.clone();
    [x, y] = screen([0, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', x + 40, y + 20, -1, 1); pointer('pointerup', x + 40, y + 20); await frame();
    check(controls!.target.distanceTo(beforeTopPan) > .1, 'left-drag pans in an orthographic construction view');
    check(source().construction.primitives.length === startCount, 'orthographic navigation does not place a block');
    await click('Brush');
    const beforeBrush = source().construction.primitives.length;
    [x, y] = screen([12, 0, 0]); const end = screen([14, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', end[0], end[1], -1, 1); pointer('pointerup', end[0], end[1]);
    await wait(() => source().construction.primitives.length > beforeBrush, 'brush saves hull pieces');
    check(source().construction.primitives.length >= beforeBrush + 2, 'Brush keeps its primary-drag placement gesture');
    await click('Undo'); await wait(() => source().construction.primitives.length === beforeBrush, 'undo removes entire brush stroke');
    check(source().construction.primitives.length === startCount, 'one undo removes the complete brush stroke');
    [x, y] = screen([12, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', end[0], end[1], -1, 1); pointer('pointercancel', end[0], end[1]); await frame();
    check(source().construction.primitives.length === startCount && !ghost(), 'cancelled placement does not save a stroke and hides its preview');
    return { passed: checks.length, failed: failures.length, checks, failures };
  } finally {
    THREE.Scene.prototype.onAfterRender = rendered; OrbitControls.prototype.connect = connect;
    window.shipbuilderReview?.close();
  }
}
