import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { ShipContext } from '../ui/ShipContext';
import { defaultKeybindings } from './keybindings';
import type { Telemetry } from './types';

test('the helm displays real current/max HP and proportional hit feedback for large and small hulls', () => {
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
    expect(html).toContain(`<strong>${(maxHp * .6).toLocaleString()}</strong><span> / ${maxHp.toLocaleString()}</span>`);
    expect(html).toContain('aria-label="Hull integrity 60 percent"');
    expect(html).toContain('class="fleet-health-loss" style="left:60%;width:20%;opacity:1"');
  }
});

test('Fletcher exposes live depth charge supply and broadside torpedo help, while gun-only ships keep their controls', () => {
  for (const id of ['fletcher', 'bismarck']) {
    const definition = shipPreset(id), sim = new CombatSimulation(definition);
    const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry(id === 'fletcher' ? 'depth-charge' : 'main', [1500, 0, 0]) };
    const html = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
    if (id === 'fletcher') {
      expect(html).toContain('Select depth charges · 28 charges · 4');
      expect(html).toContain('Burst at 10 m'); expect(html).toContain('Drop depth charge');
      data.combat = sim.telemetry('torpedo', [1500, 0, 0]);
      const torpedoHtml = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
      expect(torpedoHtml).toContain('Each broadside 40–140°'); expect(torpedoHtml).not.toContain('Bow / stern');
    } else expect(html).not.toContain('Select depth charges');
  }
});
