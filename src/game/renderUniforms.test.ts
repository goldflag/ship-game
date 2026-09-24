import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import { objectGroup, reference, renderGroup, uniform, uniformArray } from 'three/tsl';
import { PackedVec4Arrays } from './packedUniforms';
import { perRender, perRenderUniforms, setPerRenderUniforms } from './renderUniforms';

type Grouped = { groupNode?: unknown; group?: unknown; node?: { groupNode: unknown } | null; update(frame: unknown): void };

test('perRender puts uniforms, arrays and references in the render group, and the switch moves them all back and forth', () => {
  const fog = { start: 10 };
  const value = perRender(uniform(new Vector3(1, 2, 3))), list = perRender(uniformArray([1, 2, 3], 'float')), start = perRender(reference('start', 'float', fog));
  const packed = new PackedVec4Arrays([2, 3], undefined, perRender);
  const plain = uniform(1);
  const nodes = [value, list, packed.node] as unknown as Grouped[], ref = start as unknown as Grouped;
  for (const node of nodes) expect(node.groupNode).toBe(renderGroup);
  expect(ref.group).toBe(renderGroup);
  // A reference builds its uniform when first read, with the group it has then.
  ref.update({});
  expect(ref.node!.groupNode).toBe(renderGroup);
  expect((plain as unknown as Grouped).groupNode).toBe(objectGroup);
  expect(perRenderUniforms()).toMatchObject({ enabled: true });
  try {
    setPerRenderUniforms(false);
    for (const node of nodes) expect(node.groupNode).toBe(objectGroup);
    expect(ref.group).toBe(objectGroup);
    expect(ref.node!.groupNode).toBe(objectGroup);
    // Made while off: stays in its object group until switched on.
    const late = perRender(uniform(2)) as unknown as Grouped;
    expect(late.groupNode).toBe(objectGroup);
    setPerRenderUniforms(true);
    for (const node of [...nodes, late]) expect(node.groupNode).toBe(renderGroup);
    expect(ref.node!.groupNode).toBe(renderGroup);
    expect((plain as unknown as Grouped).groupNode).toBe(objectGroup);
  } finally { setPerRenderUniforms(true); }
});
