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

test('battle reports distinguish weapons, incoming hits, duplicate ships, damaged ships and permanent losses', () => {
  const definition = shipPreset('bismarck');
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition, definition] });
  sim.actors[1].damage.integrity *= .5;
  sim.target.damage.stability.combatLost = true;
  sim.target.damage.stability.status = 'disarmed';
  const combat = sim.telemetry('secondary', [0, 0, -5000]);
  combat.damageLog = [
    { id: 2, tick: 3720, sourceId: 'enemy-2', targetId: 'player', weapon: '150 mm HE · Secondary', damage: 21, hits: 2 },
    { id: 1, tick: 3600, sourceId: 'player', targetId: 'enemy-1', weapon: '380 mm AP · Main', damage: 364, hits: 8 },
  ];
  const data: Telemetry = { ship: sim.ship, order: 0, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat };
  const html = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
  expect(html).toContain('Friendly fleet: 2 of 2 in action, 1 damaged, 0 lost');
  expect(html).toContain('Enemy fleet: 1 of 2 in action, 0 damaged, 1 lost');
  expect(html).toContain('Bismarck (You)');
  expect(html).toContain('Bismarck #2');
  expect(html).toContain('Lost · disarmed');
  expect(html).toContain('1:02 · Taken 21 HP');
  expect(html).toContain('150 mm HE · Secondary');
  expect(html).toContain('From Bismarck #2 · 2 hits');
  expect(html).toContain('380 mm AP · Main');
  expect(html).toContain('To Bismarck #1 · 8 hits');
  expect(html.indexOf('Your battle score')).toBeLessThan(html.indexOf('Damage log'));
  combat.damageLog = [];
  const empty = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
  expect(empty).not.toContain('class="fleet-damage-log"');
});
