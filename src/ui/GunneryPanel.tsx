import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import type { Battery } from '../ships/blueprint';
import { Icon } from './Icons';
import { bindingLabel, type Keybindings } from '../game/keybindings';

export function GunneryPanel({ data, game, expanded, onExpand, bindings }: { bindings: Keybindings; data: Telemetry; game: Game | null; expanded: boolean; onExpand(expanded: boolean): void }) {
  const c = data.combat;
  if (!c) return null;
  return <section className="gunnery" aria-label="Gunnery and target damage">
    <div className="gunnery-heading">
      <button className="gunnery-toggle" aria-expanded={expanded} aria-controls="gunnery-details" onClick={() => onExpand(!expanded)}><span className="gunnery-title">Gunnery <Icon name="chevron" size={15} style={{ transform: expanded ? 'rotate(180deg)' : undefined }}/></span><span>{c.ready}/{c.total} ready</span></button>
      <button className="fire-button" disabled={c.ready === 0 || c.playerSunk} onClick={e => { game?.fire(); e.currentTarget.blur(); }} title={`Fire ready guns · Hold ${bindingLabel(bindings, 'fire')} for repeated salvos`}>Fire <kbd>{bindingLabel(bindings, 'fire')}</kbd></button>
    </div>
    {expanded && <><div id="gunnery-details" className="gunnery-details">
      <div className="battery-selector" role="group" aria-label="Battery selection">
        {(['main', 'secondary'] as Battery[]).map(battery => <button key={battery} aria-pressed={c.battery === battery} onClick={() => { if (game) game.battery = battery; }}>{Number(((game?.definition.mounts.find(m => m.battery === battery)?.weapon.caliberM ?? 0) * 100).toFixed(1))} cm {battery}</button>)}
      </div>
      <div className="mount-readiness" aria-label="Gun readiness">{c.mounts.map(m => <div key={m.id}>
        <span>{m.name.replace('Starboard Secondary ', 'Stbd ').replace('Port Secondary ', 'Port ')}</span>
        <span className={m.status === 'ready' ? 'gun-ready' : ''}>{m.status === 'reloading' ? `${Math.ceil(m.reload)}s` : m.status.replaceAll('-', ' ')}</span>
        <small title="Shells remaining">{m.ammo}</small>
      </div>)}</div>
      <label className="aim-select">Aim at <select value={data.aimModule ?? ''} onChange={e => game?.selectAim(e.target.value)}>
        <option value="point">Center sight · Manual</option>
        <option value="">Target waterline</option>
        {c.modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>
      <div className="target-condition"><strong>{c.targetName}{c.targetSunk ? ' · Sinking' : ''}</strong><span>{(c.targetRange / 1000).toFixed(2)} km</span></div>
      <dl className="damage-readout">
        <div><dt>Structure</dt><dd>{Math.round(c.targetIntegrity * 100)}%</dd></div>
        <div><dt>Propulsion</dt><dd>{Math.round(c.targetPower * 100)}%</dd></div>
        <div><dt>Flooding</dt><dd>{c.targetWater.toFixed(1)} m³</dd></div>
      </dl>
      <p className="damage-message" role="status">{c.message}</p>
      {data.inspecting && <div className="module-conditions" aria-label="Internal module condition">{c.modules.map(m => <div key={m.id}><span>{m.name}</span><strong>{m.condition <= 0 ? 'Disabled' : `${Math.round(m.condition * 100)}%`}</strong></div>)}<p>Amber outlines: armor · Pale outlines: compartments · Blue: floodwater</p></div>}
      <p className="gunnery-help">Mouse aims the center sight. Hold left mouse or {bindingLabel(bindings, 'fire')} to fire. Shift opens binoculars; scroll adjusts magnification. Selecting a module tracks it until you move the mouse to aim again.</p>
    </div><div className="target-actions">
      <button aria-pressed={!!data.inspecting} onClick={() => { game?.inspectTarget(); if (window.innerWidth <= 760) onExpand(false); }}>{data.inspecting ? 'Return to ship' : 'Inspect target'}</button>
    </div></>}
    {!expanded && data.inspecting && <div className="target-actions"><button onClick={() => game?.inspectTarget()}>Return to ship</button><button onClick={() => onExpand(true)}>Module condition</button></div>}
  </section>;
}
