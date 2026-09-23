import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShipDamage } from './ShipDamage';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { defaultKeybindings } from '../game/keybindings';
import type { Telemetry } from '../game/types';

test('damage panel names damaged equipment, water and crews instead of relying on colors', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def);
  sim.player.mounts[0].hp = 34;
  sim.player.damage.compartments[0].waterM3 = def.compartments[0].capacityM3 * .5;
  sim.player.damage.control.teams[0] = { kind: 'pump', index: 0, setup: 0 };
  const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, trail: [], combat: sim.telemetry('main', [0, 0, 0]) };
  const bindings = defaultKeybindings(); bindings.shipDamage = ['KeyV', null];
  const html = renderToStaticMarkup(<ShipDamage data={data} desk={null} bindings={bindings}/>);
  for (const text of ['Ship damage', '34% condition', '50% flooded', 'Crew: Pumping', 'Battle continues', '<kbd>V</kbd>', def.mounts[0].name]) expect(html).toContain(text);
  expect(html).not.toContain(def.mounts[1].name);
});
