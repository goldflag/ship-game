import { expect, test } from 'bun:test';
import { InstancedMesh, Matrix4, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { CombatEffects } from './CombatEffects';
import { disposeObjects } from './disposeObjects';

test('the shell pool keeps its shader capacity through empty frames, salvos and resets', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  const effects = new CombatEffects();
  const pool = effects.root.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
  const matrix = new Matrix4(), scale = new Vector3();
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [1800, 0, 0] as [number, number, number], battery: 'main' as const, fire: false };
  const check = () => {
    effects.update(sim, 0);
    // Three's instancing shader sizes its buffer from count when it first compiles.
    expect(pool.count).toBe(pool.instanceMatrix.count);
    for (let i = 0; i < pool.count; i++) {
      pool.getMatrixAt(i, matrix);
      if (i < sim.shells.length) {
        const position = new Vector3().setFromMatrixPosition(matrix);
        sim.shells[i].position.forEach((value, axis) => expect(position.getComponent(axis)).toBeCloseTo(value, 3));
        expect(scale.setFromMatrixScale(matrix).toArray()).toEqual([1, 1, 1]);
      } else {
        expect(scale.setFromMatrixScale(matrix).toArray()).toEqual([0, 0, 0]);
      }
    }
  };
  try {
    check();
    for (let i = 0; i < 3600; i++) sim.step(helm, intent);
    sim.step(helm, { ...intent, fire: true });
    expect(sim.shells).toHaveLength(8);
    check();
    sim.shells.splice(1);
    check();
    sim.reset();
    check();
    for (let i = 0; i < 3600; i++) sim.step(helm, intent);
    sim.step(helm, { ...intent, fire: true });
    expect(sim.shells).toHaveLength(8);
    check();
  } finally {
    disposeObjects(effects.root);
  }
});
