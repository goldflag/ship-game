import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';

export function SimulationSpeed({ game, data }: { game: Game; data: Telemetry }) {
  if (game.simulation.networked || !game.simulation.missionRules || !game.simulation.setSimulationSpeed) return null;
  return <div className="fleet-simulation-speed" role="group" aria-label="Simulation speed">
    {([1, 2, 4] as const).map(speed => <button key={speed} aria-pressed={(data.simulationSpeed ?? 1) === speed}
      disabled={data.combat?.result !== 'active'} title={`${speed}× simulation speed`}
      onClick={() => game.simulation.setSimulationSpeed?.(speed)}>{speed}×</button>)}
  </div>;
}
