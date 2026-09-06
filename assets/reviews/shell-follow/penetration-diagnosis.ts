// Diagnostic reproduction; see penetration-diagnosis.md for findings and limits.
import { strict as assert } from 'node:assert';
import { Camera, InstancedMesh, Matrix4, Vector3 } from 'three/webgpu';
import { CombatEffects } from '../../../src/game/CombatEffects';
import { CombatSimulation } from '../../../src/simulation/combat';
import { shipPreset } from '../../../src/ships/presets';
import { ShellFollow } from '../../../src/game/ShellFollow';
import { FIXED_DT } from '../../../src/simulation/ship';
import type { Shell } from '../../../src/simulation/damage';

const def = shipPreset('bismarck');
const weapon = def.mounts[0].weapon;
const results: unknown[] = [];
for (const [label, y, z] of [['bridge', 15, -18], ['armored hull', .5, 0], ['unarmored bow', 4, -115]] as const) {
  const sim = new CombatSimulation(def);
  sim.player.motion.x = -1000;
  Object.assign(sim.target.motion, { x: 0, z: 0 });
  const round: Shell = { id: 1, ownerId: 'player', position: [-30, y, z], velocity: [weapon.muzzleSpeed, -20, 0], age: 0,
    caliberM: weapon.caliberM, damage: weapon.damage, penetrationMm: weapon.penetrationMm, type: 'AP', visited: [] };
  sim.shells.push(round);
  const follow = new ShellFollow();
  follow.setEnabled(true);
  follow.update(sim.shells, sim.events, 'player', 0);
  const effects = new CombatEffects(), camera = new Camera();
  const mesh = effects.root.getObjectByName('Shell bodies') as InstancedMesh;
  const matrix = new Matrix4();
  let positionChecks = 0;
  let seq = 0;
  const trace: unknown[] = [];
  for (let i = 0; i < 600 && sim.shells.length; i++) {
    sim.step({ throttle: 0, rudder: 0 }, { aim: [0, y, z], fire: false, battery: 'main' });
    follow.update(sim.shells, sim.events, 'player', FIXED_DT);
    effects.update(sim, FIXED_DT, camera);
    mesh.getMatrixAt(0, matrix);
    const firstImpact = sim.events.find(event => event.shell?.id === round.id && event.kind !== 'shot');
    assert.equal(follow.shellId, round.id);
    if (firstImpact) {
      assert.equal(follow.phase, 'impact');
      assert.deepEqual(follow.view!.position, firstImpact.position);
    } else {
      assert.equal(follow.phase, 'flight');
      assert.deepEqual(follow.view!.position, round.position);
    }
    if (sim.shells.length) {
      assert.ok(new Vector3().setFromMatrixPosition(matrix).distanceTo(new Vector3(...round.position)) < .0001);
      positionChecks++;
    } else {
      assert.deepEqual(new Vector3().setFromMatrixScale(matrix).toArray(), [0, 0, 0]);
    }
    for (const event of sim.events.filter(e => e.sequence > seq)) {
      seq = event.sequence;
      trace.push({ time: +(sim.tick * FIXED_DT).toFixed(3), shellId: event.shell?.id, kind: event.kind, message: event.message,
        impact: event.position.map(n => +n.toFixed(3)), damage: sim.target.damage.maxIntegrity - sim.target.damage.integrity,
        shellAlive: sim.shells.length === 1, penetrationLeft: +round.penetrationMm.toFixed(2),
        follow: follow.phase, followPosition: follow.view?.position.map(n => +n.toFixed(3)) });
    }
  }
  assert.equal(sim.shells.length, 0);
  assert.ok(sim.target.damage.integrity < sim.target.damage.maxIntegrity);
  assert.equal(sim.events.at(-1)!.kind, label === 'armored hull' ? 'stopped' : 'splash');
  assert.equal(sim.events.some(e => e.kind === 'splash'), label !== 'armored hull');
  effects.dispose();
  results.push({ label, positionChecks, trace });
}

console.log(JSON.stringify(results, null, 2));
