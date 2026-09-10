import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PveResults } from './PveResults';

test('results distinguish permanent incapacity from sinking and describe the two replay choices', () => {
  const html = renderToStaticMarkup(<PveResults result="victory" outcome={{ winnerTeamId: 'a', reason: 'destruction', finalTick: 3600, afloatKg: [2924000, 2924000] }} debrief={{ seed: 123, tick: 3600, ships: [
    { id: 'own', presetId: 'fletcher', team: 'friendly', status: 'operational', damageDealt: 1520, frags: 0, aircraftRemaining: 0 },
    { id: 'opponent', presetId: 'fletcher', team: 'enemy', status: 'incapacitated', damageDealt: 0, frags: 0, aircraftRemaining: 0 },
  ] }} onRestart={async () => {}} onNewBattle={async () => {}} onPort={async () => {}}/>);
  expect(html).toContain('Victory'); expect(html).toContain('Permanently incapacitated'); expect(html).toContain('Combat capable');
  expect(html).toContain('1:00 elapsed'); expect(html).toContain('Same fleets, seed and starting positions'); expect(html).toContain('generate a new opponent');
  expect(html).toContain('1,520');
});
