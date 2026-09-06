import { expect, test } from 'bun:test';
import type { WebGPURenderer } from 'three/webgpu';
// Exercise the installed renderer's real sort/reversal, not a copy of its algorithm.
// @ts-expect-error Three does not publish declarations for its internal RenderList.
import RenderList from 'three/src/renderers/common/RenderList.js';
import { configureRenderOrder } from './renderOrder';

for (const reversed of [false, true]) test(`authored layers and depth order survive renderer sorting (reversed=${reversed})`, () => {
  let opaqueSort: Parameters<WebGPURenderer['setOpaqueSort']>[0] = null;
  let transparentSort: Parameters<WebGPURenderer['setTransparentSort']>[0] = null;
  configureRenderOrder({ reversedDepthBuffer: reversed,
    setOpaqueSort: sort => { opaqueSort = sort; },
    setTransparentSort: sort => { transparentSort = sort; },
  } as WebGPURenderer);
  const list = new RenderList({ getNode: () => ({}) });
  const item = (id: number, order: number, distance: number, groupOrder = 0) =>
    ({ id, renderOrder: order, groupOrder, z: reversed ? 1 - distance : distance });
  list.opaque.push(item(1, -100, 1), item(2, 0, .4), item(3, 0, .8));
  const transparent = [
    item(4, -45, 1), // high clouds
    item(5, -30, .9), // ocean background
    item(6, 0, .2), item(7, 0, .7), item(8, 0, .2), // near/far effects, stable ties
    item(9, -100, .5, 1), // explicit group priority takes precedence
  ];
  list.transparent.push(...transparent);
  list.transparentDoublePass.push(...transparent);
  list.sort(opaqueSort, transparentSort, reversed);
  expect(list.opaque.map((o: { id: number }) => o.id)).toEqual([1, 2, 3]);
  for (const items of [list.transparent, list.transparentDoublePass]) {
    expect(items.map((o: { id: number }) => o.id)).toEqual([4, 5, 7, 6, 8, 9]);
  }
});
