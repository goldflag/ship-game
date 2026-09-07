import { useId, useState } from 'react';
import type { Game } from '../game/Game';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import type { CombatTelemetry } from '../simulation/combat';

export function ShellCycle({ combat, game, bindings }: { combat: CombatTelemetry; game: Game | null; bindings: Keybindings }) {
  const descriptionId = useId();
  const [dismissed, setDismissed] = useState(false);
  const current = combat.ammunition, next = current === 'ap' ? 'he' : 'ap';
  const stock = combat.ammunitionStock;
  const unavailable = combat.playerSunk ? 'Ship lost' : next === 'he' && !combat.heSupported ? 'HE not fitted' : stock[next] === 0 ? `Out of ${next.toUpperCase()}` : '';
  const shortcut = bindingLabel(bindings, 'shellType');

  return <div className="fleet-shell-cycle-wrap" data-dismissed={dismissed} onPointerEnter={() => setDismissed(false)}>
    <button className="fleet-shell-cycle" aria-disabled={!!unavailable} data-empty={stock[current] === 0}
      aria-label={`${current.toUpperCase()} selected · ${stock[current]} rounds. ${unavailable || `Switch to ${next.toUpperCase()} · ${stock[next]} rounds`} · ${shortcut}`}
      aria-describedby={descriptionId}
      onFocus={() => setDismissed(false)}
      onKeyDown={event => {
        if (event.key === 'Escape' && !dismissed) { setDismissed(true); event.stopPropagation(); }
      }}
      onContextMenu={event => {
        // macOS sends Ctrl + primary click as contextmenu instead of click.
        if (event.ctrlKey && event.button === 0) {
          event.preventDefault();
          if (!unavailable) game?.selectAmmunition(next);
          event.currentTarget.blur();
        }
      }}
      onClick={event => {
        if (!unavailable) game?.selectAmmunition(next);
        // Mouse users resume ship shortcuts; keyboard users can continue cycling with Enter/Space.
        if (event.detail > 0) event.currentTarget.blur();
      }}>
      <strong>{current.toUpperCase()}</strong>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h14m-4-3 3 3-3 3M17 14H3m4-3-3 3 3 3"/></svg>
      <kbd>{shortcut}</kbd>
    </button>
    <div className="fleet-shell-cycle-info" role="tooltip" id={descriptionId}>
      <span>Armor piercing <b>AP · {stock.ap}</b></span>
      <span>High explosive <b>{combat.heSupported ? `HE · ${stock.he}` : 'Not fitted'}</b></span>
      <small>Full reload on change. Guns without HE keep AP.</small>
      {(unavailable || stock[current] === 0) && <small className="fleet-shell-cycle-note">{stock[current] === 0 ? `Out of ${current.toUpperCase()}` : unavailable}</small>}
    </div>
  </div>;
}
