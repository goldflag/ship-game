import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';

export function SimulationSpeed({ game, data, bindings }: { game: Game; data: Telemetry; bindings?: Keybindings }) {
  if (game.simulation.networked || !game.simulation.missionRules || !game.simulation.setSimulationSpeed) return null;
  const selected = data.simulationSpeed ?? 1, achieved = data.achievedSpeed;
  const shortcut = bindings ? bindingLabel(bindings, 'simulationSpeed') : '';
  // The battle keeps its own time; a worker that cannot hold the requested speed
  // says so here rather than quietly running slower than the label claims.
  const overrun = achieved !== undefined && achieved < selected - .25;
  return <div className="fleet-simulation-speed" role="group" aria-label="Simulation speed">
    {([1, 2, 4] as const).map(speed => <button key={speed} aria-pressed={selected === speed}
      className={overrun && selected === speed ? 'fleet-speed-overrun' : undefined}
      disabled={data.combat?.result !== 'active'}
      title={overrun && selected === speed ? `${speed}× requested, reaching ${achieved.toFixed(1)}×` : `${speed}× simulation speed${shortcut ? ` · ${shortcut} cycles` : ''}`}
      onClick={() => game.simulation.setSimulationSpeed?.(speed)}>{speed}×</button>)}
    {overrun && <span className="fleet-speed-achieved" role="status">{achieved.toFixed(1)}×</span>}
    {shortcut && <kbd title={`${shortcut} cycles the simulation speed`}>{shortcut}</kbd>}
  </div>;
}
