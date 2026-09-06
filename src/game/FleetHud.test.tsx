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

test('VIIC depth instruments show real orders, ballast and recovery instructions only when fitted', () => {
  for (const id of ['type-viic', 'bismarck']) {
    const def = shipPreset(id), sim = new CombatSimulation(def);
    if (sim.player.submarine) { sim.player.submarine.targetDepthM = 50; sim.player.submarine.ballastM3 = 102; sim.ship.y = -50; }
    const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry('torpedo', [0, 0, -1500]) };
    const html = renderToStaticMarkup(<ShipContext.Provider value={def}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
    if (id === 'type-viic') {
      expect(html).toContain('aria-label="Depth and ballast"'); expect(html).toContain('Ordered 50 m');
      expect(html).toContain('Ballast 85%'); expect(html).toContain('Torpedoes: rise to 12 m or less');
      expect(html).toContain('Emergency blow'); expect(html).toContain('Periscope');
    } else expect(html).not.toContain('aria-label="Depth and ballast"');
  }
});
