import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { updateCapability } from './stability';

const aim = [-5000, 50, 500] as [number, number, number];
test.each(['gun', 'magazine'] as const)('a destroyed %s marks its turret disabled in the damage tick', cause => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), mount = sim.player.mounts[0];
  sim.step({ throttle: 0, rudder: 0 }, { aim, fire: false, battery: 'main' });
  if (cause === 'gun') mount.hp = 0;
  else sim.player.damage.modules.find(m => m.id === def.mounts[0].magazineId)!.hp = 0;
  updateCapability(sim.player, def); // Also called immediately by the live impact ledger.
  expect(mount.status).toBe('disabled');
});

test.each(['gun', 'magazine', 'flooding'] as const)('a turret disabled by %s holds train and elevation despite new aim and helm commands', cause => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def] });
  for (const actor of [sim.player, sim.target]) {
    Object.assign(actor.mounts[0], { train: .4, elevation: .2 });
    const magazine = def.modules.find(m => m.id === def.mounts[0].magazineId)!;
    if (cause === 'gun') actor.mounts[0].hp = 0;
    else if (cause === 'magazine') actor.damage.modules.find(m => m.id === magazine.id)!.hp = 0;
    else actor.damage.compartments.find(c => c.id === magazine.compartmentId)!.waterM3 = def.compartments.find(c => c.id === magazine.compartmentId)!.capacityM3;
  }
  const ammunition = [sim.player.mounts[0].ammo, sim.target.mounts[0].ammo];
  for (let tick = 0; tick < 180; tick++) sim.step({ throttle: 1, rudder: 1 }, { aim, fire: true, battery: 'main' });
  for (const [i, actor] of [sim.player, sim.target].entries()) {
    expect(actor.mounts[0].status).toBe('disabled');
    expect(actor.mounts[0].train).toBe(.4);
    expect(actor.mounts[0].elevation).toBe(.2);
    expect(actor.mounts[0].ammo).toBe(ammunition[i]);
  }
  if (cause === 'flooding') {
    sim.player.damage.compartments.forEach(c => c.waterM3 = 0);
    sim.step({ throttle: 0, rudder: 0 }, { aim, fire: false, battery: 'main' });
    expect(sim.player.mounts[0].status).not.toBe('disabled');
    expect(sim.player.mounts[0].train).not.toBe(.4);
  }
});
