import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';

export function SimulationSpeed({ game, data }: { game: Game; data: Telemetry }) {
  if (game.simulation.networked || !game.simulation.missionRules || !game.simulation.setSimulationSpeed) return null;
  const selected = data.simulationSpeed ?? 1, achieved = data.achievedSpeed;
  // The battle keeps its own time; a worker that cannot hold the requested speed
  // says so here rather than quietly running slower than the label claims.
  const overrun = achieved !== undefined && achieved < selected - .25;
  return <div className="fleet-simulation-speed" role="group" aria-label="Simulation speed">
    {([1, 2, 4] as const).map(speed => <button key={speed} aria-pressed={selected === speed}
      className={overrun && selected === speed ? 'fleet-speed-overrun' : undefined}
      disabled={data.combat?.result !== 'active'}
      title={overrun && selected === speed ? `${speed}× requested, reaching ${achieved.toFixed(1)}×` : `${speed}× simulation speed`}
      onClick={() => game.simulation.setSimulationSpeed?.(speed)}>{speed}×</button>)}
    {overrun && <span className="fleet-speed-achieved" role="status">{achieved.toFixed(1)}×</span>}
  </div>;
}
