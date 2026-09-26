import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import { EffectLighting } from './EffectLighting';
import { GAS_VARIANTS, GasAtlas, gasLobes, gasSpriteMaterial } from './GasAtlas';

test('every baked puff is the same on every load, and its lobes stay inside its tile', () => {
  const lobes = gasLobes();
  expect(lobes.length % GAS_VARIANTS).toBe(0);
  expect(lobes.map(l => l.toArray())).toEqual(gasLobes().map(l => l.toArray()));
  // Billows grow a little past the lobes; the tile's disc must still hold them.
  for (const lobe of lobes) expect(new Vector3(lobe.x, lobe.y, lobe.z).length() + lobe.w).toBeLessThanOrEqual(.92 + 1e-9);
  // Each puff is its own shape: no two share their lobes.
  const per = lobes.length / GAS_VARIANTS, keys = new Set<string>();
  for (let v = 0; v < GAS_VARIANTS; v++) keys.add(JSON.stringify(lobes.slice(v * per, (v + 1) * per).map(l => l.toArray().map(n => n.toFixed(3)))));
  expect(keys.size).toBe(GAS_VARIANTS);
});

test('an unbaked atlas is ready for materials, which read it as soon as it is baked', () => {
  const atlas = new GasAtlas(), lighting = new EffectLighting();
  try {
    expect(atlas.ready).toBe(false);
    const material = gasSpriteMaterial(atlas, { lighting });
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.colorNode).toBeTruthy(); expect(material.opacityNode).toBeTruthy();
    material.dispose();
  } finally { atlas.dispose(); lighting.dispose(); }
});
