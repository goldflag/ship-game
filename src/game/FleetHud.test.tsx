import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { GunneryPanel } from '../ui/GunneryPanel';
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

test('Fletcher exposes live depth charge supply and broadside torpedo help, while gun-only ships keep their controls', () => {
  for (const id of ['fletcher', 'bismarck']) {
    const definition = shipPreset(id), sim = new CombatSimulation(definition);
    const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry(id === 'fletcher' ? 'depth-charge' : 'main', [1500, 0, 0]) };
    const html = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
    if (id === 'fletcher') {
      expect(html).toContain('Select depth charges · 28 charges · 4');
      expect(html).toContain('Burst at 10 m'); expect(html).toContain('Drop depth charge');
      const gunnery = renderToStaticMarkup(<GunneryPanel data={data} game={null} expanded onExpand={() => {}} bindings={defaultKeybindings()}/>);
      expect(gunnery).toContain('Ready to release');
      expect(gunnery).toContain('Own damage control');
      expect(gunnery).not.toContain('aria-label="Shell selection"');
      expect(gunnery).not.toContain('Aim at <select');
      data.combat = sim.telemetry('torpedo', [1500, 0, 0]);
      const torpedoHtml = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
      expect(torpedoHtml).toContain('Each broadside 40–140°'); expect(torpedoHtml).not.toContain('Bow / stern');
    } else expect(html).not.toContain('Select depth charges');
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
