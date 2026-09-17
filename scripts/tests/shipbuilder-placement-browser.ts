import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import type { Vec3 } from '../../src/ships/blueprint';

/** Real React, WebGL, OrbitControls, IndexedDB and native compiler regression for the
 * cursor ghost, runs, fills and camera gestures. Only pointer capture is stubbed for
 * synthetic events; repeat the gestures with browser mouse input when reviewing capture. */
export async function checkShipbuilderPlacement() {
  const checks: string[] = [], failures: string[] = [];
  let scene: THREE.Scene | undefined, camera: THREE.Camera | undefined, orbit: OrbitControls | undefined;
  const rendered = THREE.Scene.prototype.onAfterRender, connect = OrbitControls.prototype.connect;
  THREE.Scene.prototype.onAfterRender = function (...args) { scene = this; camera = args[2]; rendered.apply(this, args); };
  OrbitControls.prototype.connect = function (element) { orbit = this; connect.call(this, element); };
  const wait = async (condition: () => unknown, label: string) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > 45000) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const check = (condition: unknown, label: string) => { (condition ? checks : failures).push(label); };
  const compiled = () => !document.querySelector('.sb-ledger h4 span');
  try {
    window.shipbuilderReview?.close(); await mountShipbuilderReview();
    const source = () => window.shipbuilderReview!.source!;
    await wait(() => source() && scene && camera && orbit && compiled(), 'ready editor');
    const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
    canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
    const screen = (point: Vec3) => {
      const projected = new THREE.Vector3(...point).project(camera!);
      const bounds = canvas.getBoundingClientRect();
      return [bounds.x + (projected.x + 1) * bounds.width / 2, bounds.y + (1 - projected.y) * bounds.height / 2];
    };
    const pointer = (type: string, x: number, y: number, button = 0, buttons = 0, options: PointerEventInit = {}) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 71, pointerType: 'mouse', button, buttons, clientX: x, clientY: y, ...options }));
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
    const equipmentMeshes = (id: string) => {
      const meshes: THREE.Object3D[] = [];
      scene!.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !visible(object) || object.userData.sourceId !== id) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(material => !(material as THREE.MeshBasicMaterial).wireframe)) meshes.push(object);
      });
      return meshes;
    };
    await wait(() => equipmentMeshes('gun-forward').length && equipmentMeshes('funnel').length, 'full equipment models loaded');
    const gunMesh = equipmentMeshes('gun-forward')[0], funnelMesh = equipmentMeshes('funnel')[0];
    const viewport = window.shipbuilderViewport as unknown as { floorGrid: THREE.Group; pickMeshes: THREE.Object3D[] };
    check(!!viewport.floorGrid.getObjectByName('Ship centerline'), 'the floor grid has a ship centerline');
    const floorObjects = new Set<THREE.Object3D>(); viewport.floorGrid.traverse(object => floorObjects.add(object));
    check(viewport.pickMeshes.every(object => !floorObjects.has(object)), 'the floor grid is visual only, never a placement target');
    const startCount = source().construction.primitives.length, initialIds = new Set(source().construction.primitives.map(part => part.id));
    const placed = () => source().construction.primitives.find(part => !initialIds.has(part.id))!;
    controls.key('m'); await frame();
    let [x, y] = screen([12, 0, 0]);
    pointer('pointermove', x, y); await frame();
    check(!ghost(), 'empty space has no placement preview');
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y); await frame(); await frame();
    check(source().construction.primitives.length === startCount, 'clicking empty space cannot create a block');
    [x, y] = screen([3, 2.5, 0]);
    pointer('pointermove', x, y); await frame();
    const preview = ghost();
    check(!!preview, 'an existing block shows an attached placement preview');
    const hoverGroup = (window.shipbuilderViewport as unknown as { hoverGroup: THREE.Group }).hoverGroup;
    check(!hoverGroup.children.length, 'Place keeps the support block clear while showing the placement preview');
    if (preview) {
      const bounds = new THREE.Box3().setFromObject(preview);
      check(Math.abs(bounds.min.y - 2.5) < .001, 'the preview rests on the existing hull face');
    }
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y);
    await frame(); await frame();
    check(equipmentMeshes('gun-forward').includes(gunMesh) && equipmentMeshes('funnel').includes(funnelMesh), 'placing a block retains the same full turret and funnel meshes during compilation');
    await wait(() => source().construction.primitives.length === startCount + 1 && compiled(), 'attached piece saved and compiled');
    check(!document.querySelector('.sb-warn')?.textContent?.includes('Detached hull'), 'face placement keeps the hull connected');
    check(!document.querySelector('[data-tag="ghost"]') && document.querySelector<HTMLElement>('[data-coords]')?.style.visibility === 'visible', 'the ghost carries no tooltip; its cell reads out under the palette');

    const beforePan = orbit!.target.clone(), heading = () => camera!.position.clone().sub(orbit!.target);
    [x, y] = screen([0, 0, 0]);
    pointer('pointerdown', x, y, 2, 2); pointer('pointermove', x + 60, y + 35, -1, 2); pointer('pointerup', x + 60, y + 35, 2);
    await frame();
    check(orbit!.target.distanceTo(beforePan) > .1, 'right-drag pans while Place is selected');
    check(source().construction.primitives.length === startCount + 1, 'right-drag does not place or remove a block');
    // A left drag from the hull lays a run of pieces along the face plane, one undoable stroke, and leaves the camera heading alone.
    const beforeRun = heading();
    const [rx, ry] = screen([-2, 2.5, -2]), [ex, ey] = screen([-2, 2.5, -5]);
    pointer('pointerdown', rx, ry, 0, 1); pointer('pointermove', ex, ey, -1, 1);
    await frame();
    const strokePreview = () => scene!.children.find(object => object.userData.strokePreview);
    check((strokePreview()?.children.length ?? 0) >= 3, 'the full run is visible before releasing the mouse');
    pointer('pointerup', ex, ey);
    await wait(() => source().construction.primitives.length >= startCount + 3, 'a left drag lays a run of pieces');
    check(heading().angleTo(beforeRun) < .001, 'a run drag does not orbit the camera');
    check(orbit!.enabled, 'the run releases the camera controls');
    // A left drag from empty space orbits instead of placing.
    const beforeOrbit = heading();
    [x, y] = screen([40, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', x + 60, y + 35, -1, 1); pointer('pointerup', x + 60, y + 35);
    await frame();
    check(heading().angleTo(beforeOrbit) > .01, 'left-drag from empty space orbits while Place is selected');
    check(source().construction.primitives.length >= startCount + 3, 'an orbit drag does not place a block');
    const run = source().construction.primitives.length - startCount - 1;
    check(run >= 3 && run <= 5, `a run covers the dragged length without gaps (${run} pieces)`);
    document.querySelector<HTMLButtonElement>('.sb-undo')!.click();
    await wait(() => source().construction.primitives.length === startCount + 1, 'one undo removes the whole run');
    await controls.tool('Select');
    [x, y] = screen(placed().position);
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y);
    await wait(() => document.querySelector('[data-tag^="piece-"]'), 'the placed block remains selectable and tagged');
    checks.push('the placed block remains selectable and tagged');
    check(!ghost(), 'Select removes the placement ghost');
    check(hoverGroup.children.length > 0, 'Select keeps the hovered block outline');
    // A left drag on the selected block moves it in the plane of the pressed face by whole grid steps; one undo restores it.
    // The earlier orbit drag coasts under damping for a few dozen frames; let the camera settle before measuring the heading.
    for (let settling = heading(), frames = 0; frames < 120; frames++) { await frame(); const next = heading(); if (next.angleTo(settling) < 1e-6) break; settling = next; }
    const restingAt = [...placed().position] as Vec3, beforeMove = heading();
    const [mx, my] = screen([restingAt[0], restingAt[1] + .5, restingAt[2]]), [nx, ny] = screen([restingAt[0], restingAt[1] + .5, restingAt[2] + 3]);
    pointer('pointerdown', mx, my, 0, 1); pointer('pointermove', nx, ny, -1, 1); await frame();
    check(!!scene!.children.find(object => object.userData.movePreview)?.visible, 'dragging a block shows a brass preview at its new position');
    check(!orbit!.enabled, 'a move drag holds the camera controls');
    pointer('pointerup', nx, ny);
    await wait(() => Math.abs(placed().position[2] - restingAt[2] - 3) < 1e-6, 'a left drag moves the block 3 m along the deck');
    check(Math.abs(placed().position[0] - restingAt[0]) < 1e-6 && Math.abs(placed().position[1] - restingAt[1]) < 1e-6, 'the move stays in the plane of the pressed face');
    check(heading().angleTo(beforeMove) < .001, 'a move drag does not orbit the camera');
    check(orbit!.enabled, 'releasing a move restores the camera controls');
    check(!scene!.children.find(object => object.userData.movePreview)?.visible, 'releasing removes the move preview');
    document.querySelector<HTMLButtonElement>('.sb-undo')!.click();
    await wait(() => Math.abs(placed().position[2] - restingAt[2]) < 1e-6, 'one undo restores the moved block');
    [x, y] = screen(placed().position); pointer('pointermove', x, y); await frame();
    pointer('pointermove', ...screen([40, 0, 0]) as [number, number]); await frame();
    check(!hoverGroup.children.length, 'hover outline clears in empty space');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await wait(() => source().construction.primitives.length === startCount, 'removing the placed block saves source');
    await wait(() => compiled() && !document.querySelector('.sb-cmd')?.hasAttribute('disabled'), 'removal compiles original hull');
    check(Math.abs((hitHeight(3, 0) ?? Infinity) - 2.5) < .01, 'the native rendered hull returns');

    controls.key('q'); await frame(); await frame();
    controls.key('p'); await frame(); await frame(); // The editor starts in perspective; explicitly request orthographic.
    // In Select a drag on the hull moves it, so navigation starts from empty water.
    const beforeTopPan = orbit!.target.clone(), hullBefore = JSON.stringify(source().construction.primitives);
    [x, y] = screen([40, 0, 0]);
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', x + 40, y + 20, -1, 1); pointer('pointerup', x + 40, y + 20); await frame();
    check(orbit!.target.distanceTo(beforeTopPan) > .1, 'left-drag from empty space pans in an orthographic construction view with Select');
    check(source().construction.primitives.length === startCount && JSON.stringify(source().construction.primitives) === hullBefore, 'orthographic navigation does not place or move a block');
    await controls.tool('Fill'); await controls.slot(1);
    const beforeFill = source().construction.primitives.length;
    [x, y] = screen([1, 2.5, -4]); const end = screen([3, 2.5, -2]);
    pointer('pointermove', x, y); await frame();
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', end[0], end[1], -1, 1);
    await frame();
    check((strokePreview()?.children.length ?? 0) >= 6, 'Fill shows every piece before releasing the mouse');
    pointer('pointerup', end[0], end[1]);
    await wait(() => source().construction.primitives.length > beforeFill, 'fill saves hull pieces');
    check(source().construction.primitives.length - beforeFill >= 6, 'Fill covers the dragged rectangle');
    document.querySelector<HTMLButtonElement>('.sb-undo')!.click(); await wait(() => source().construction.primitives.length === beforeFill, 'undo removes the entire fill');
    pointer('pointerdown', x, y, 0, 1); pointer('pointermove', end[0], end[1], -1, 1); pointer('pointercancel', end[0], end[1]); await frame();
    check(source().construction.primitives.length === startCount && !ghost(), 'cancelled placement does not save a fill and hides its preview');

    pointer('pointerdown', x, y, 0, 1); const empty = screen([20, 2.5, 0]);
    pointer('pointermove', empty[0], empty[1], -1, 1); pointer('pointerup', empty[0], empty[1]); await frame();
    check(source().construction.primitives.length === startCount, 'releasing Fill in empty space cancels placement');

    // Shift-drag claims the primary pointer before OrbitControls, even in Place.
    await controls.tool('Place');
    const beforeSelection = camera!.position.clone(), beforeTarget = orbit!.target.clone();
    const corners = [[-6, 2.5, -33], [6, 2.5, 25]].map(point => screen(point as Vec3));
    pointer('pointerdown', ...corners[0] as [number, number], 0, 1, { shiftKey: true });
    pointer('pointermove', ...corners[1] as [number, number], -1, 1, { shiftKey: true }); await frame();
    check(!document.querySelector<HTMLElement>('[data-selection-box]')!.hidden, 'Shift-drag shows a selection rectangle');
    pointer('pointerup', ...corners[1] as [number, number], 0, 0, { shiftKey: true }); await frame(); await frame();
    check(!!document.querySelector('[data-tag="group"]'), 'Shift-drag selects multiple ship pieces while Place is active');
    check(camera!.position.distanceTo(beforeSelection) < .001 && orbit!.target.distanceTo(beforeTarget) < .001, 'box selection leaves the camera still');
    check(source().construction.primitives.length === startCount, 'box selection never places pieces');
    check(orbit!.enabled && document.querySelector<HTMLElement>('[data-selection-box]')!.hidden, 'releasing selection restores navigation and removes the rectangle');

    // A stationary secondary click deletes; a secondary drag remains navigation.
    [x, y] = screen([3, 2.5, 0]);
    pointer('pointerdown', x, y, 2, 2); pointer('pointerup', x, y, 2);
    await wait(() => source().construction.primitives.length === startCount - 1, 'right-click removes the targeted hull block');
    controls.key('z', { ctrlKey: true }); await wait(() => source().construction.primitives.length === startCount, 'right-click deletion is undoable');
    await wait(compiled, 'undo compiles'); await frame();
    const gun = source().construction.equipment.find(item => item.id === 'gun-forward')!;
    [x, y] = screen([gun.position[0], gun.position[1] + 1, gun.position[2]]);
    const equipmentCount = source().construction.equipment.length;
    pointer('pointerdown', x, y, 2, 2); pointer('pointerup', x, y, 2);
    await wait(() => source().construction.equipment.length === equipmentCount - 1, 'right-click removes a fitting');
    check(!equipmentMeshes(gun.id).length, 'removed equipment disappears immediately');
    controls.key('z', { ctrlKey: true }); await wait(() => source().construction.equipment.length === equipmentCount, 'undo restores the fitting');
    await frame(); check(equipmentMeshes(gun.id).length > 0, 'undo restores the full fitting model from the cached asset');

    await controls.tab('Fittings');
    document.querySelector<HTMLButtonElement>('.sb-hotbar .more')!.click();
    await controls.settled(() => !!document.querySelector('.sb-drawer'), 'fittings drawer');
    const funnelSlot = [...document.querySelectorAll<HTMLButtonElement>('.sb-drawer .sb-slot')].find(button => /funnel/i.test(button.getAttribute('aria-label') ?? ''))!;
    funnelSlot.click(); await controls.settled(() => !document.querySelector('.sb-drawer'), 'funnel slot');
    [x, y] = screen([3, 2.5, 2]); pointer('pointermove', x, y); await frame();
    const previewPosition = ghost()!.position.toArray();
    const beforeFitting = new Set(source().construction.equipment.map(item => item.id));
    pointer('pointerdown', x, y, 0, 1); pointer('pointerup', x, y);
    await wait(() => source().construction.equipment.some(item => !beforeFitting.has(item.id)), 'fitting placed');
    const added = source().construction.equipment.find(item => !beforeFitting.has(item.id))!;
    check(added.position.every((value, index) => Math.abs(value - previewPosition[index]) < 1e-6), 'a placed fitting preserves its preview position and exact attachment height');
    check(equipmentMeshes(added.id).length > 0, 'new fitting instances immediately reuse the full cached model');
    return { passed: checks.length, failed: failures.length, checks, failures };
  } finally {
    THREE.Scene.prototype.onAfterRender = rendered; OrbitControls.prototype.connect = connect;
    window.shipbuilderReview?.close();
  }
}
