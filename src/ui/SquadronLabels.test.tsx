import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadronLabels } from './AirOperations';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';

test('ship-view enemy aircraft names require a current sighting from the spectated ship', () => {
  const simulation = new CombatSimulation(shipPreset('fletcher'));
  Object.assign(simulation, {
    observedAircraft: ['visible', 'other-lookout', 'stale'].map(id => ({ id, modelId: 'a6m2-zero', observers: [id === 'other-lookout' ? 'other-ship' : simulation.ship.id] })),
    observationTracks: ['visible', 'other-lookout', 'stale'].map(id => ({ id, status: id === 'stale' ? 'stale' : 'tracked', lastObservedTick: 0, velocity: [0, 0, 0] })),
  });
  const game = { simulation } as unknown as Game;
  const data = { ship: simulation.ship, spectatedShipId: simulation.ship.id } as Telemetry;
  const render = (state = data) => renderToStaticMarkup(<SquadronLabels data={state} game={game}/>);
  expect(render()).toContain('data-aircraft-contact="visible"');
  expect(render()).not.toContain('data-aircraft-contact="other-lookout"');
  expect(render()).not.toContain('data-aircraft-contact="stale"');
  expect(render({ ...data, airOperationsOpen: true })).not.toContain('data-aircraft-contact=');
});
