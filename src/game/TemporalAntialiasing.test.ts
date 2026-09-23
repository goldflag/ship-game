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
});

test('the combat volumes keep their colour under temporal AA and moving instances take no history', () => {
  const effects = new CombatEffects();
  const taa = new TemporalAntialiasing(new PerspectiveCamera());
  for (const name of ['Heavy AA burst smoke', 'Propellant and impact volumes']) {
    const material = (effects.root.getObjectByName(name) as InstancedMesh).material as MeshBasicNodeMaterial;
    expect(material.fragmentNode).not.toBeNull();
    const output = material.setupOutput(builder(taa.mrt), vec4(1)) as unknown as Outputs;
    expect(Object.keys(output.outputNodes)).toContain(MOTION_OUTPUT);
  }
  for (const name of ['Shell bodies', 'Shell streaks', 'Shell glows', 'Torpedo bodies', 'Depth charge bodies']) {
    expect(effects.root.getObjectByName(name)?.userData.temporalResponse).toBe(1);
  }
  effects.dispose();
});
