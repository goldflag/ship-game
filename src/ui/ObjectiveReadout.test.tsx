import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { deadlineCaption, deadlineReached, ObjectiveReadout } from './ObjectiveReadout';
import { SCENARIOS, scenarioOrders } from './battle/scenarios';

test('a scenario names its clock and counts the ships it must protect', () => {
  const missionId = SCENARIOS[0].missionId;
  const objective = { missionId, protectedAfloat: 3, protectedTotal: 4 };
  expect(deadlineCaption({ objective })).toBe('to dawn');
  expect(deadlineReached({ objective })).toBe('Dawn');
  expect(deadlineCaption({})).toBe('remaining');
  expect(deadlineReached({})).toBe('Time limit reached');
  const html = renderToStaticMarkup(<ObjectiveReadout combat={{ objective }} />);
  expect(html).toContain('Transports <strong>3/4</strong> afloat');
  expect(html).toContain('data-lost="true"');
  expect(renderToStaticMarkup(<ObjectiveReadout combat={{}} />)).toBe('');
});

test('the briefing states the scoring the content applies', () => {
  const [savo] = SCENARIOS;
  const orders = scenarioOrders(savo).join(' ');
  const { objective, durationSeconds } = savo.content.mission;
  expect(orders).toContain(`gives the enemy ${objective.protectedPoints} points`);
  expect(orders).toContain(`Dawn comes in ${durationSeconds / 60} minutes`);
  expect(savo.content.mission.objective.protectedShipIds.every(id => savo.content.groups.some(group => group.ships.some(ship => ship.id === id)))).toBe(true);
  // Every plan the raid can follow has words for the result screen, and every ship on either side its own name.
  expect(Object.keys(savo.plans).sort()).toEqual(savo.content.raid.plans.map(plan => plan.id).sort());
  const forces = savo.content.raid.forces;
  const ids = [...savo.content.groups.flatMap(group => group.ships), ...forces.easy, ...forces.normal, ...forces.hard].map(ship => ship.id);
  expect(ids.filter(id => !savo.shipNames[id])).toEqual([]);
});
