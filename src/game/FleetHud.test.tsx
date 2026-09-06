import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { ShipContext } from '../ui/ShipContext';
import { defaultKeybindings } from './keybindings';
import type { Telemetry } from './types';
import { updateCapability } from '../simulation/stability';

test('the helm displays current/max HP and proportional hit feedback for large and small hulls', () => {
  for (const id of ['yamato', 'baltimore']) {
    const definition = shipPreset(id), sim = new CombatSimulation(definition);
    const maxHp = sim.player.damage.maxIntegrity;
    sim.player.damage.integrity = maxHp * .6;
    const data: Telemetry = {
      ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [],
      combat: sim.telemetry('main', [0, 0, -5000]),
      playerDamage: { amount: maxHp * .2, fromHp: maxHp * .8, opacity: 1 },
    };
    const html = renderToStaticMarkup(<ShipContext.Provider value={definition}>
      <FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/>
    </ShipContext.Provider>);
    expect(html).toContain(`<strong>${Math.round(maxHp * .6).toLocaleString()}</strong><span> / ${maxHp.toLocaleString()} HP</span>`);
    expect(html).toContain(`aria-label="${Math.round(maxHp * .6)} of ${maxHp} HP"`);
    expect(html).toContain(`aria-valuenow="${Math.round(maxHp * .6)}" aria-valuemin="0" aria-valuemax="${maxHp}"`);
    expect(html).toContain('class="fleet-health-loss" style="left:60%;width:20%;opacity:1"');
  }
});

test('main battery loss leaves an armed ship in its fleet without an extra status label', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition] });
  definition.mounts.forEach((m, i) => { if (m.battery === 'main') sim.player.mounts[i].hp = 0; });
  updateCapability(sim.player, definition);
  const data: Telemetry = { ship: sim.ship, order: 0, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry('main', [0, 0, -5000]) };
  const html = renderToStaticMarkup(<ShipContext.Provider value={definition}>
    <FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/>
  </ShipContext.Provider>);
  expect(html).not.toContain('knocked out');
  expect(html).not.toContain('crippled');
  expect(html).toContain('Friendly <strong>2</strong>');
});
