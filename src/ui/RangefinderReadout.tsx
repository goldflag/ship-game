import { RANGEFINDING_SECONDS, type RangefinderState } from '../game/Rangefinder';
import { bindingLabel, type Keybindings } from '../game/keybindings';

export function RangefinderReadout({ state, bindings }: { state: RangefinderState; bindings: Keybindings }) {
  const measured = state.rangeM !== undefined;
  const status = state.phase === 'measuring' ? `Ranging · ${Math.max(0, RANGEFINDING_SECONDS * (1 - state.progress)).toFixed(1)} s`
    : state.phase === 'lost' ? measured ? 'Contact lost · last range' : 'Measurement lost'
    : state.phase === 'no-target' ? 'No ship near sight'
    : state.locked ? 'Range locked · tracking' : state.phase === 'tracking' ? 'Range ready · tracking' : '';
  return <div className="fleet-rangefinder" data-locked={state.locked}>
    <div role="status" aria-live="off">
      {state.targetName && <span className="fleet-rangefinder-target" title={state.targetName}>{state.targetName}{measured && ` · ${(state.rangeM! / 1000).toFixed(2)} km`}</span>}
      {status && <span>{status}{state.phase === 'lost' && state.locked ? ' · locked' : ''}</span>}
    </div>
    {state.phase === 'measuring' ? <progress value={state.progress} max={1} aria-label="Range measurement progress"/> :
      <span className="fleet-rangefinder-keys"><span><kbd>{bindingLabel(bindings, 'rangefind')}</kbd> {state.phase === 'idle' || state.phase === 'no-target' ? 'Measure range' : 'Measure again'}</span>{measured && <span><kbd>{bindingLabel(bindings, 'rangeLock')}</kbd> {state.locked ? 'Unlock' : 'Lock range'}</span>}</span>}
  </div>;
}
