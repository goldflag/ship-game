import { expect, test } from 'bun:test';
import { DirectionalLight, PCFSoftShadowMap, PerspectiveCamera, Vector3, VSMShadowMap } from 'three/webgpu';
import { FocusShadowNode, NEAR_SHADOW_MIN, nearShadowFocus } from './FocusShadowNode';

function camera(fov = 52, zoom = 1) {
  const view = new PerspectiveCamera(fov, 16 / 9, .5, 60000);
  view.zoom = zoom; view.position.set(0, 20, 100); view.lookAt(0, 0, 0); view.updateMatrixWorld();
  return view;
}

test('the near shadow map centres along the view at the subject distance and covers the visible frame', () => {
  const view = camera(), subject = new Vector3(0, 0, 0), focus = new Vector3();
  const radius = nearShadowFocus(view, subject, 380, focus);
  const distance = view.position.distanceTo(subject);
  expect(focus.distanceTo(subject)).toBeLessThan(1e-9);
  // Half the horizontal frame at the subject distance, within a quarter-octave step.
  const halfWidth = distance * Math.tan(26 * Math.PI / 180) * 16 / 9;
  expect(radius).toBeGreaterThan(halfWidth);
  expect(radius).toBeLessThan(halfWidth * 1.1 * 2 ** (1 / 8));
});

test('binocular zoom narrows the near map and its size is clamped both ways', () => {
  const subject = new Vector3(), focus = new Vector3();
  const wide = nearShadowFocus(camera(52, 1), subject, 380, focus);
  const zoomed = nearShadowFocus(camera(52, 8), subject, 380, focus);
  expect(zoomed).toBeLessThan(wide / 4);
  expect(nearShadowFocus(camera(52, 1000), subject, 380, focus)).toBe(NEAR_SHADOW_MIN);
  const far = camera(); far.position.set(0, 20, 4000); far.lookAt(0, 0, 0); far.updateMatrixWorld();
  expect(nearShadowFocus(far, subject, 380, focus)).toBe(380);
});

test('the near map size moves in quarter-octave steps so small camera motion keeps its texel size', () => {
  const subject = new Vector3(), focus = new Vector3(), view = camera();
  const first = nearShadowFocus(view, subject, 380, focus);
  view.position.multiplyScalar(1.01); view.updateMatrixWorld();
  expect(nearShadowFocus(view, subject, 380, focus)).toBe(first);
});

test('every map hands three one soft filter of its own, and three keeps its own filters otherwise', () => {
  const node = new FocusShadowNode(new DirectionalLight()), builder = { renderer: { shadowMap: { type: PCFSoftShadowMap as number } } };
  const lights = [node.near, node.wide, ...node.views.map(view => view.light)];
  const filters = () => lights.map(light => (light.shadow as typeof light.shadow & { filterNode?: unknown }).filterNode);
  node.setup(builder as never);
  expect(filters()).toEqual(lights.map(light => light.softFilter));
  expect(new Set(filters()).size).toBe(lights.length);
  builder.renderer.shadowMap.type = VSMShadowMap; node.setup(builder as never);
  expect(filters().every(filter => filter === null)).toBe(true);
  builder.renderer.shadowMap.type = PCFSoftShadowMap; FocusShadowNode.sharedMapSize = false;
  try { node.setup(builder as never); expect(filters().every(filter => filter === null)).toBe(true); }
  finally { FocusShadowNode.sharedMapSize = true; node.dispose(); }
});
