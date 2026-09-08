import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { fireReadout } from './damageReadout';
import { directControl, heatMount, updateDamageControl } from './damageControl';

test('fire report distinguishes deployment, suppression, cooling and exhausted fuel with real team progress', () => {
  const def = shipPreset('bismarck'), actor = new CombatSimulation(def).player;
  heatMount(actor, 0, 100); updateDamageControl(actor, def, 1 / 60, () => {});
  let row = fireReadout(actor, def)[0];
  expect(row.crew).toBe('Crew deploying'); expect(row.setupSeconds).toBeCloseTo(def.damageControl!.setupSeconds - 1 / 60);
  expect(row.location).toBe('Forward · Centreline'); expect(row.threat).toContain('Anton');
  for (let i = 0; i < 480; i++) updateDamageControl(actor, def, 1 / 60, () => {});
  row = fireReadout(actor, def)[0]; expect(row.crew).toBe('Suppressing fire'); expect(row.status).toBe('Being fought');
  for (let i = 0; i < 1200 && actor.damage.control.mounts[0].intensity > 0; i++) updateDamageControl(actor, def, 1 / 60, () => {});
  row = fireReadout(actor, def)[0]; expect(row.status).toBe('Cooling'); expect(row.crew).toBe('Cooling space'); expect(row.threat).toBeUndefined();
  actor.damage.control.mounts[0].fuel = 0; expect(fireReadout(actor, def)[0].status).toBe('Burned out · cooling');
  actor.damage.sunk = true; expect(fireReadout(actor, def)[0].crew).toBe('Crews unavailable');
});

test('focus redirects an existing team through timed setup and can be released to automatic management', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), actor = sim.player;
  actor.damage.control.teams = [null];
  heatMount(actor, 0, 100); heatMount(actor, 3, 100);
  updateDamageControl(actor, def, 1, () => {});
  expect(fireReadout(actor, def).find(f => f.id === 'dora')!.crew).toBe('Awaiting crew');
  directControl(actor, 'fires', 'dora'); updateDamageControl(actor, def, 1, () => {});
  expect(fireReadout(actor, def).find(f => f.id === 'dora')!.crew).toBe('Crew deploying');
  expect(actor.damage.control.teams[0]?.index).toBe(3);
  directControl(actor, 'balanced'); expect(actor.damage.control.focus).toBe('');
  sim.reset(); expect(fireReadout(sim.player, def)).toEqual([]);
});
