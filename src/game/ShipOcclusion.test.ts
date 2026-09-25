import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { SHIP_OCCLUSION_LAYER, ShipOcclusion } from './ShipOcclusion';
import type { DepthCasterPass } from './ShadowCasterPass';

const box = () => new THREE.BoxGeometry();

test('ship surfaces join the occlusion layer and share one occlusion node that Off removes', () => {
  const occlusion = new ShipOcclusion(new THREE.PerspectiveCamera(), true);
  const paint = new THREE.MeshStandardNodeMaterial(), deck = new THREE.MeshStandardNodeMaterial();
  const glass = new THREE.MeshStandardNodeMaterial({ transparent: true });
  const flag = new THREE.MeshStandardNodeMaterial(); flag.positionNode = float(0) as never;
  const ship = new THREE.Group();
  const [hull, planks, window, ensign] = [paint, deck, glass, flag].map(material => new THREE.Mesh(box(), material));
  ship.add(hull, planks, window, ensign);

  occlusion.adopt(ship);
  expect([hull, planks, window, ensign].map(mesh => mesh.layers.isEnabled(SHIP_OCCLUSION_LAYER))).toEqual([true, true, false, false]);
  // The default layer stays, so the scene pass draws them exactly as before.
  expect(hull.layers.isEnabled(0)).toBe(true);
  expect(paint.aoNode).toBeNull();

  const version = paint.version;
  occlusion.setLevel('low');
  expect(paint.aoNode).not.toBeNull();
  expect(deck.aoNode).toBe(paint.aoNode);
  expect(glass.aoNode).toBeNull();
  expect(paint.version).toBe(version + 1);

  // Changing the sample budget is a uniform, not a recompile.
  occlusion.setLevel('high');
  expect(paint.version).toBe(version + 1);

  occlusion.setLevel('off');
  expect(paint.aoNode).toBeNull();
  expect(deck.aoNode).toBeNull();

  // A hull adopted while occlusion is on is connected at once.
  occlusion.setLevel('low');
  const later = new THREE.MeshStandardNodeMaterial();
  occlusion.adopt(new THREE.Mesh(box(), later));
  expect(later.aoNode).toBe(paint.aoNode);
  occlusion.dispose();
});

/** A renderer that records what it renders and nothing else. */
function recordingRenderer(rendered: THREE.Object3D[]): THREE.Renderer {
  return new Proxy({ autoClear: true } as Record<string | symbol, unknown>, {
    get: (target, key) => key in target ? target[key]
      : key === 'render' ? (scene: THREE.Object3D) => { rendered.push(scene); }
      : key === 'getDrawingBufferSize' ? (size: THREE.Vector2) => size.set(1280, 720)
      : key === 'getClearColor' ? (color: THREE.Color) => color
      : () => undefined,
  }) as unknown as THREE.Renderer;
}

test('the prepass draws through its caster pass, with the scene as three would see it, and falls back to three', () => {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, .5, 60000);
  const occlusion = new ShipOcclusion(camera, true);
  const scene = new THREE.Scene(), hull = new THREE.Mesh(box(), new THREE.MeshStandardNodeMaterial());
  hull.position.set(0, 0, -40); scene.add(hull);
  occlusion.adopt(hull); occlusion.setLevel('low');
  let drawn = true;
  const seen: { layers: number; far: number; override: THREE.Material | null; frame: number; hullZ: number }[] = [];
  occlusion.casters = { enabled: true, draw: (s: THREE.Scene, c: THREE.PerspectiveCamera, _target: unknown, frame: number) => {
    seen.push({ layers: c.layers.mask, far: c.far, override: s.overrideMaterial, frame, hullZ: hull.matrixWorld.elements[14] });
    return drawn;
  }, dispose() {} } as unknown as DepthCasterPass;
  const rendered: THREE.Object3D[] = [], renderer = recordingRenderer(rendered);

  occlusion.render(renderer, scene);
  // The pass sees the occlusion layer alone, the shortened far plane and the depth override, after the
  // scene's world matrices are brought up to date; three renders only the three occlusion quads.
  expect(seen).toEqual([{ layers: 1 << SHIP_OCCLUSION_LAYER, far: occlusion.fadeEnd.value * 1.05, override: seen[0].override, frame: 1, hullZ: -40 }]);
  expect(seen[0].override).not.toBeNull();
  expect(rendered).not.toContain(scene);
  expect(rendered.length).toBe(3);
  expect([camera.layers.mask, camera.far, scene.overrideMaterial]).toEqual([1, 60000, null]);

  // Declined (its pipeline still compiling), three renders the prepass itself.
  drawn = false; rendered.length = 0;
  occlusion.render(renderer, scene);
  expect(rendered[0]).toBe(scene);
  expect(seen.at(-1)!.frame).toBe(2);

  // Off, the pass is not asked at all.
  occlusion.casters!.enabled = false; rendered.length = 0;
  occlusion.render(renderer, scene);
  expect(seen.length).toBe(2);
  expect(rendered[0]).toBe(scene);
  occlusion.dispose();
});
