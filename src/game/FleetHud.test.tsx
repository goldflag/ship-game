import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { ShipContext } from '../ui/ShipContext';
import { defaultKeybindings } from './keybindings';
import type { Telemetry } from './types';
import { updateCapability } from '../simulation/stability';
import { GunneryPanel } from '../ui/GunneryPanel';

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

test('Gunnery separates penetrating hull damage from surviving equipment', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition);
  sim.target.controller = 'idle';
  Object.assign(sim.target.motion, { x: 0, z: 0, heading: 0 });
  sim.player.motion.x = -5000;
  const weapon = definition.mounts[0].weapon;
  sim.shells.push({ id: 900, ownerId: 'player', position: [-20, .5, -21], velocity: [730, -35, 0],
    age: 0, penetrationMm: 550, damage: weapon.damage, caliberM: weapon.caliberM, ap: weapon.ap, visited: [] });
  for (let i = 0; i < 30; i++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, .5, 0], fire: false, battery: 'main' });
  const data: Telemetry = { ship: sim.ship, order: 0, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry('main', [0, .5, 0]) };
  expect(data.combat!.targetIntegrity).toBeLessThan(1);
  expect(data.combat!.targetEquipmentIntegrity).toBe(1);
  const html = renderToStaticMarkup(<GunneryPanel data={data} game={null} expanded onExpand={() => {}} bindings={defaultKeybindings()}/>);
  expect(html).toContain('<dt>Hull</dt><dd>97%</dd>');
  expect(html).toContain('<dt>Equipment</dt><dd>100%</dd>');
  expect(html).toContain('45.5 hull damage');
  expect(html).toContain('without restoring hull HP');
});
