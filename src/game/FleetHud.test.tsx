import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { ShipContext } from '../ui/ShipContext';
import { defaultKeybindings } from './keybindings';
import type { Telemetry } from './types';

test('the helm displays equipment condition and proportional hit feedback for large and small hulls', () => {
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
    expect(html).toContain('<strong>60%</strong><span> condition</span>');
    expect(html).toContain('aria-label="Equipment condition 60 percent"');
    expect(html).toContain('class="fleet-health-loss" style="left:60%;width:20%;opacity:1"');
  }
});
