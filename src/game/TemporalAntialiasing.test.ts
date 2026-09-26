import { expect, test } from 'bun:test';
import { InstancedMesh, MeshBasicNodeMaterial, PerspectiveCamera, type Node } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import { CombatEffects } from './CombatEffects';
import { MOTION_OUTPUT, TemporalAntialiasing, writeSceneTargets } from './TemporalAntialiasing';

type Outputs = { isMRTNode?: boolean; outputNodes: Record<string, Node> };
const builder = (mrt: unknown) => ({ renderer: { getMRT: () => mrt, getRenderTarget: () => ({}) } }) as never;

test('a material with its own fragment output fills every scene target of the pass', () => {
  const material = writeSceneTargets(new MeshBasicNodeMaterial());
  const color = vec4(1, .5, .25, 1);
  // Without extra targets the colour passes through unchanged.
  expect(material.setupOutput(builder(null), color)).toBe(color);
  const taa = new TemporalAntialiasing(new PerspectiveCamera());
  const output = material.setupOutput(builder(taa.mrt), color) as unknown as Outputs;
  expect(output.isMRTNode).toBe(true);
  expect(Object.keys(output.outputNodes).sort()).toEqual([MOTION_OUTPUT, 'output'].sort());
  expect(output.outputNodes.output).toBe(color);
  // The motion target keeps the pass's additive blending, so what is below survives.
  expect((output as unknown as { blendModes: object }).blendModes).toEqual((taa.mrt as unknown as { blendModes: object }).blendModes);
});

test('a surface that asks for no history writes that response into the motion target', () => {
  const material = writeSceneTargets(new MeshBasicNodeMaterial());
  material.userData.temporalResponse = 1;
  const taa = new TemporalAntialiasing(new PerspectiveCamera());
  const output = material.setupOutput(builder(taa.mrt), vec4(1)) as unknown as Outputs;
  const motion = output.outputNodes[MOTION_OUTPUT] as unknown as { node: { value: { toArray(): number[] } } };
  expect(motion.node.value.toArray()).toEqual([0, 0, 1, 0]);
});

test('the combat gas keeps its colour under temporal AA and moving instances take no history', () => {
  const effects = new CombatEffects();
  for (const name of ['Heavy AA burst smoke', 'Propellant and impact volumes', 'Smouldering and fragment smoke', 'Falling aircraft smoke']) {
    const material = (effects.root.getObjectByName(name) as InstancedMesh).material as MeshBasicNodeMaterial;
    // Gas shades through the standard colour and opacity, so the pass fills its motion target like any transparent surface's;
    // a material with its own fragment output would have to write the scene targets itself (see above).
    expect(material.fragmentNode).toBeNull();
    expect(material.colorNode).not.toBeNull();
    expect(material.transparent).toBe(true);
  }
  for (const name of ['Shell bodies', 'Shell streaks', 'Shell glows', 'Torpedo bodies', 'Depth charge bodies']) {
    expect(effects.root.getObjectByName(name)?.userData.temporalResponse).toBe(1);
  }
  effects.dispose();
});
