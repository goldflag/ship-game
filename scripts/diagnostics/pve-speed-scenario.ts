import type { PveRequest } from '../../src/multiplayer/generated/PveRequest';

/** Fixed, legal maximum-count fleets. The planner retains the seeded opponent. */
export function pveSpeedScenario(scenario: 'surface' | 'carrier' = 'surface'): PveRequest {
  const roster = scenario === 'carrier'
    ? ['enterprise-cv6', 'shokaku', 'bismarck', ...Array<string>(12).fill('fletcher')]
    : ['bismarck', 'iowa', ...Array<string>(4).fill('baltimore'), ...Array<string>(9).fill('fletcher')];
  return {
    version: 1, seed: 17001, mapId: 'pacific-islands', weather: 'clear', difficulty: 'normal',
    ships: roster.map((presetId, i) => ({ id: `own-${i}`, presetId, groupId: scenario === 'carrier' && i < 2 ? 'rear' : 'front' })),
    groups: scenario === 'carrier'
      ? [{ id: 'rear', name: 'Carriers', station: 'rear' }, { id: 'front', name: 'Surface', station: 'front' }]
      : [{ id: 'front', name: 'Surface', station: 'front' }],
  };
}
