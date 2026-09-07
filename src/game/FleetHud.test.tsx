import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { FleetHud } from '../ui/FleetHud';
import { ShipContext } from '../ui/ShipContext';
import { defaultKeybindings } from './keybindings';
import type { Telemetry } from './types';
import { updateCapability } from '../simulation/stability';

test('the compact shell cycle exposes the current load, next choice, stocks and remapped shortcut', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition);
  const aim: [number, number, number] = [2000, 10, 0];
  sim.step({ throttle: 0, rudder: 0 }, { aim, fire: false, battery: 'main', ammunition: 'he' });
  const combat = sim.telemetry('main', aim);
  const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat };
  const bindings = defaultKeybindings(); bindings.shellType = ['KeyV', null];
  const render = () => renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={bindings}/></ShipContext.Provider>);
  const html = render();
  expect(html).toContain('aria-label="HE selected · 384 rounds. Queue AP · 576 rounds · V"');
  expect(html).toContain('aria-disabled="false"');
  expect(html).toContain('Armor piercing <b>AP · 576</b>');
  expect(html).toContain('High explosive <b>HE · 384</b>');
  expect(html).toContain('Single press queues next load. Double-press V to switch now with a full reload. Guns without HE keep AP.');
  expect(html).toContain('Select 38 cm twin mount · 576 shells');
  expect(html).toContain('<kbd>V</kbd>');
  combat.ammunitionStock.he = 0;
  expect(render()).toContain('aria-label="HE selected · 0 rounds. Queue AP · 576 rounds · V"');
  expect(render()).toContain('aria-disabled="false" data-empty="true"');
  expect(render()).toContain('Out of HE');
  combat.ammunitionStock.ap = 0;
  expect(render()).toContain('aria-disabled="true" data-empty="true"');
  expect(render()).toContain('HE selected · 0 rounds. Out of AP · V');
  combat.ammunition = 'ap'; combat.ammunitionStock.ap = 576;
  combat.heSupported = false;
  expect(render()).toContain('AP selected · 576 rounds. HE not fitted · V');
  expect(render()).toContain('High explosive <b>Not fitted</b>');
  combat.playerSunk = true;
  expect(render()).toContain('AP selected · 576 rounds. Ship lost · V');
});

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
      expect(html).not.toContain('class="fleet-shell-cycle"');
      expect(html).toContain('Select Mk 6 depth charge · 28 charges · 5');
      expect(html).toContain('Burst at 10 m');
      data.combat = sim.telemetry('torpedo', [1500, 0, 0]);
      const torpedoHtml = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
      expect(torpedoHtml).not.toContain('class="fleet-shell-cycle"');
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
      expect(html).toContain('Emergency blow'); expect(html).toContain('Periscope view');
      expect(html).toContain('Surface · U'); expect(html).toContain('Dive 50 m · J');
      expect(html).toContain('Dive 2 m'); expect(html).toContain('Rise 2 m');
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

test('battle HUD omits the removed gunnery panel and keeps weapon controls', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition);
  const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry('main', [0, 0, -5000]) };
  for (const inspecting of [false, true]) {
    const html = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={{ ...data, inspecting }} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
    expect(html).not.toContain('GUNNERY');
    expect(html).not.toContain('class="gunnery"');
    expect(html).toContain('aria-label="Weapons"');
    expect(html).toContain('class="fleet-shell-cycle"');
    expect(html).not.toContain('fleet-fire-slot');
    expect(html).not.toContain('fleet-utility-slot');
  }
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

test('weapon slots show separate types, custom shortcuts, and one selected group including on carriers', () => {
  for (const id of ['bismarck', 'enterprise-cv6']) {
    const definition = shipPreset(id), sim = new CombatSimulation(definition);
    const groups = sim.telemetry('main', [1800, 0, 0]).weaponGroups;
    const selected = groups[2];
    const combat = sim.telemetry(selected.battery, [1800, 0, 0], selected.id);
    const data: Telemetry = { ship: sim.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat };
    const bindings = defaultKeybindings(); bindings.weaponGroup3 = ['KeyL', null];
    const html = renderToStaticMarkup(<ShipContext.Provider value={definition}><FleetHud data={data} game={null} visible bindings={bindings}/></ShipContext.Provider>);
    expect(html).toContain('aria-label="Weapons"');
    for (const group of groups) expect(html).toContain(`Select ${group.name} ·`);
    expect(html).toContain('<kbd>L</kbd>');
    expect(html.match(/class="fleet-weapon-slot"[^>]*aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain(`${selected.name}</span>`);
    if (id === 'enterprise-cv6') {
      expect(html).not.toContain('aria-label="Squadron commands"');
    }
  }
});


test('spectator HUD uses the observed definition inside the player ship context', () => {
  const player = shipPreset('bismarck'), watched = shipPreset('fletcher');
  const sim = new CombatSimulation(player, { friendlyBots: [watched], enemies: [player] });
  sim.player.damage.sunk = true;
  const friend = sim.actors[1];
  friend.damage.integrity = friend.damage.maxIntegrity / 2;
  const data: Telemetry = { ship: friend.motion, shipDefinition: watched, spectatedShipId: friend.motion.id,
    order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: sim.telemetry('main', [0, 0, 0], undefined, friend) };
  const html = renderToStaticMarkup(<ShipContext.Provider value={player}><FleetHud data={data} game={null} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
  expect(html).toContain(`<h1>${watched.name.toUpperCase()}</h1>`);
  expect(html).not.toContain(`<h1>${player.name.toUpperCase()}</h1>`);
  expect(html).toContain(`aria-label="${friend.damage.integrity} of ${friend.damage.maxIntegrity} HP"`);
  expect(html).toContain('Spectating teammate');
  expect(html).not.toContain('380 mm');
  expect(html).toContain('disabled="" aria-label="Engine full"');
});
