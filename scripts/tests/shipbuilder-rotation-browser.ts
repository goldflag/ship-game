import * as THREE from 'three';
import { controls, mountShipbuilderReview } from './shipbuilder-browser';
import type { BuilderScene } from '../../src/ui/shipbuilding/builderScene';

/** Real viewport regression: rotation must stay visible without another pointer move. */
export async function checkShipbuilderRotation() {
  window.shipbuilderReview?.close(); await mountShipbuilderReview();
  await controls.settled(() => window.shipbuilderViewport, 'viewport');
  const viewport = window.shipbuilderViewport as unknown as { ghost: THREE.Group; equipment: { group: THREE.Group }; props: { scene: BuilderScene }; camera: THREE.Camera };
  await controls.tab('Armament');
  const canvas = document.querySelector<HTMLCanvasElement>('.sb-canvas canvas')!;
  canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
  const checks: string[] = [], failures: string[] = [];
  const check = (ok: unknown, label: string) => (ok ? checks : failures).push(label);
  const pointer = (type: string, x: number, y: number, button = -1, buttons = 0, shiftKey = false) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 91, pointerType: 'mouse', clientX: x, clientY: y, button, buttons, shiftKey }));
  const settle = () => controls.settled(() => true, 'frame');
  const [x, y] = await controls.screen([3, 2.5, 0]);
  pointer('pointermove', x, y); await settle();
  check(viewport.ghost.visible, 'placement ghost starts visible');
  for (let i = 0; i < 3; i++) {
    controls.key('r'); await settle();
    check(viewport.ghost.visible, `hotkey rotation ${i + 1} stays visible with a stationary pointer`);
  }
  pointer('pointermove', x, y); await settle();
  const mesh = viewport.ghost.children[0], bearing = () => viewport.props.scene.placementPiece?.kind === 'equipment' ? viewport.props.scene.placementPiece.bearingDeg : NaN;
  const before = bearing(), camera = viewport.camera.position.clone();
  pointer('pointerdown', x, y, 2, 2);
  for (let i = 1; i <= 10; i++) pointer('pointermove', x + 2.1 * i, y, -1, 2, true); await settle();
  check(viewport.ghost.visible && viewport.ghost.children[0] === mesh, 'fine drag retains the visible placement model');
  check(Math.abs(viewport.ghost.rotation.y * -180 / Math.PI - before - 2.1) < 1e-6, 'Shift-drag previews a fractional 2.1 degree turn');
  check(bearing() === before, 'drag leaves the tool bearing unchanged before release');
  pointer('pointerup', x + 21, y, 2); await settle();
  check(Math.abs(bearing() - before - 2.1) < 1e-6, 'release retains the fractional bearing');
  check(camera.distanceTo(viewport.camera.position) < 1e-6, 'rotation does not pan the camera');
  controls.key('R', { shiftKey: true }); await settle();
  check(Math.abs(bearing() - before - 3.1) < 1e-6, 'Shift-R rotates the cursor by one degree');

  await controls.tool('Select');
  await controls.settled(() => viewport.equipment.group.getObjectByName('gun-forward'), 'fitted gun model');
  const gun = viewport.equipment.group.getObjectByName('gun-forward')!;
  const center = new THREE.Box3().setFromObject(gun).getCenter(new THREE.Vector3());
  const [gx, gy] = await controls.screen(center.toArray() as [number, number, number]);
  const source = () => viewport.props.scene.source;
  const gunBearing = () => source().construction.equipment.find(p => p.id === 'gun-forward')!.bearingDeg;
  const initial = gunBearing(), revision = source().revision;
  pointer('pointerdown', gx, gy, 2, 2);
  pointer('pointermove', gx + 23, gy, -1, 2, true); await settle();
  check(source().revision === revision && gunBearing() === initial, 'installed fitting drag does not compile or write source per frame');
  check(Math.abs(gun.rotation.y * -180 / Math.PI - initial - 2.3) < 1e-6, 'installed fitting rotates immediately in its original mesh');
  pointer('pointerup', gx + 23, gy, 2); await settle();
  check(Math.abs(gunBearing() - initial - 2.3) < 1e-6 && viewport.equipment.group.getObjectByName('gun-forward') === gun, 'release commits the fine bearing without replacing the fitted model');
  controls.key('z', { ctrlKey: true }); await settle();
  check(gunBearing() === initial, 'one undo restores the whole drag');
  controls.key('z', { ctrlKey: true, shiftKey: true }); await settle();
  check(Math.abs(gunBearing() - initial - 2.3) < 1e-6, 'redo restores the fine bearing');
  for (const cancellation of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'origin']) {
    const saved = gunBearing(), savedRevision = source().revision;
    pointer('pointerdown', gx, gy, 2, 2);
    pointer('pointermove', gx + 30, gy, -1, 2); await settle();
    if (cancellation === 'escape') controls.key('Escape');
    else if (cancellation === 'blur') window.dispatchEvent(new Event('blur'));
    else if (cancellation === 'origin') { pointer('pointermove', gx, gy, -1, 2); pointer('pointerup', gx, gy, 2); }
    else pointer(cancellation, gx + 30, gy, 2);
    await settle();
    check(gunBearing() === saved && source().revision === savedRevision && Math.abs(gun.rotation.y * -180 / Math.PI - saved) < 1e-6, `${cancellation} restores the preview without a source edit`);
  }
  controls.click(gx, gy); await settle();
  const beforeKey = gunBearing();
  controls.key('R', { shiftKey: true }); await settle();
  check(Math.abs(gunBearing() - beforeKey - 1) < 1e-6 && viewport.equipment.group.getObjectByName('gun-forward') === gun && gun.visible, 'Shift-R turns the fitted selection immediately without replacing its mesh');
  const panStart = viewport.camera.position.clone();
  pointer('pointerdown', 1100, 700, 2, 2); pointer('pointermove', 1150, 720, -1, 2); pointer('pointerup', 1150, 720, 2); await settle();
  check(panStart.distanceTo(viewport.camera.position) > .1, 'right-drag on empty space still pans');
  return { checks, failures };
}
