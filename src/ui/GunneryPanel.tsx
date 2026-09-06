import type { ControlPriority } from '../simulation/damageControl';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import type { Ammunition } from '../ships/blueprint';
import { Icon } from './Icons';
import { bindingLabel, type Keybindings } from '../game/keybindings';

export function GunneryPanel({ data, game, expanded, onExpand, bindings }: { bindings: Keybindings; data: Telemetry; game: Game | null; expanded: boolean; onExpand(expanded: boolean): void }) {
  const c = data.combat;
  if (!c) return null;
  return <section className="gunnery" aria-label="Gunnery and target damage">
    <div className="gunnery-heading">
      <button className="gunnery-toggle" aria-expanded={expanded} aria-controls="gunnery-details" onClick={() => onExpand(!expanded)}><span className="gunnery-title">Gunnery <Icon name="chevron" size={15} style={{ transform: expanded ? 'rotate(180deg)' : undefined }}/></span><span>{c.ready}/{c.total} can fire</span></button>
      <button className="fire-button" disabled={c.ready === 0 || c.playerSunk} onClick={e => { game?.fire(); e.currentTarget.blur(); }} title={c.battery === 'torpedo' ? `Launch one torpedo · Hold ${bindingLabel(bindings, 'fire')} to launch loaded tubes in sequence` : `Fire aligned guns · Hold ${bindingLabel(bindings, 'fire')} to fire as guns align and reload`}>{c.battery === 'torpedo' ? 'Launch' : 'Fire'} <kbd>{bindingLabel(bindings, 'fire')}</kbd></button>
    </div>
    {expanded && <><div id="gunnery-details" className="gunnery-details">
      <div className="battery-selector" role="group" aria-label="Battery selection">
        {c.batteries.filter(b => b.total > 0).map(({ battery }) => <button key={battery} aria-pressed={c.battery === battery} onClick={() => { if (game) game.battery = battery; }}>{battery === 'torpedo' ? 'Torpedo tubes' : `${Number(((game?.definition.mounts.find(m => m.battery === battery)?.weapon.caliberM ?? 0) * 100).toFixed(1))} cm ${battery}`}</button>)}
      </div>
      {c.battery !== 'torpedo' && <><div className="battery-selector" role="group" aria-label="Shell selection">
        {(['ap', 'he'] as Ammunition[]).map(type => <button key={type} aria-pressed={c.ammunition === type} disabled={type === 'he' && !c.heSupported} onClick={() => { if (game) game.ammunition[game.battery] = type; }}>
          {type.toUpperCase()} · {c.ammunitionStock[type]} rounds
        </button>)}
      </div>
      <p className="gunnery-help">AP penetrates armor before its delayed burst. HE bursts on contact against light protection. Changing type takes a full reload.</p></>}
      <div className="mount-readiness" aria-label="Weapon readiness">{c.mounts.map(m => <div key={m.id}>
        <span>{m.name.replace('Starboard Secondary ', 'Stbd ').replace('Port Secondary ', 'Port ')}</span>
        <span className={m.status === 'ready' ? 'gun-ready' : ''}>{m.loaded && `${m.loaded.toUpperCase()} · `}{m.status === 'ready' ? 'On aim · Loaded' : m.status === 'reloading' ? `Reload ${Math.ceil(m.reload)}s` : m.status === 'turning' && m.reload > 0 ? `Turning · Reload ${Math.ceil(m.reload)}s` : m.status.replaceAll('-', ' ')}</span>
        <small title="Ammunition remaining">{m.ammo}</small>
      </div>)}</div>
      <details className="shell-history">
        <summary>Own damage control · {[...c.control.rooms, ...c.control.mounts].filter(f => f.intensity > 0).length} fires · {c.control.teams.filter(Boolean).length}/{c.control.teams.length} teams</summary>
        <label className="aim-select">Priority <select value={c.control.priority} onChange={e => { if (game) game.controlPriority = e.target.value as ControlPriority; }}>
          <option value="balanced">Balanced</option><option value="fires">Fight fires</option><option value="flooding">Contain flooding</option><option value="repairs">Repair equipment</option>
        </select></label>
        <label className="aim-select">Focus <select value={c.control.focus} onChange={e => { if (game) game.controlFocus = e.target.value; }}>
          <option value="">Automatic</option>{c.controlTargets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <p className="gunnery-help">{c.control.spares.toFixed(0)} repair supplies · Repairs restore up to 60%; destroyed equipment stays lost. Crews shore small openings and pump accessible rooms.</p>
        <div className="module-conditions">{c.control.teams.map((job, i) => <div key={i}><span>Team {i + 1}</span><strong>{job ? `${job.kind.replaceAll('-', ' ')}${job.setup > 0 ? ` · ${Math.ceil(job.setup)}s setup` : ''}` : 'Available'}</strong></div>)}</div>
        <div className="module-conditions">{[...c.control.rooms.map((f, i) => ({ f, name: c.controlTargets[i]?.name })), ...c.control.mounts.map((f, i) => ({ f, name: c.controlTargets[c.control.rooms.length + i]?.name }))].filter(({ f }) => f.intensity > 0).map(({ f, name }, i) => <div key={i}><span>{name}</span><strong>Fire · {Math.round(f.intensity * 100)}%</strong></div>)}</div>
      </details>
      <label className="aim-select">Aim at <select value={data.aimModule ?? ''} onChange={e => game?.selectAim(e.target.value)}>
        <option value="point">Center sight · Manual</option>
        <option value="">Target waterline</option>
        {c.modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        <optgroup label="Gun mounts">{c.targetMounts.map(m => <option key={m.id} value={`mount:${m.id}`}>{m.name}{m.condition <= 0 ? ' · Disabled' : ''}</option>)}</optgroup>
      </select></label>
      <div className="target-condition"><strong>{c.targetName}{` · ${c.targetStatus.replaceAll('-', ' ')}`}</strong><span>{(c.targetRange / 1000).toFixed(2)} km</span></div>
      <dl className="damage-readout">
        <div><dt>Equipment</dt><dd>{Math.round(c.targetIntegrity * 100)}%</dd></div>
        <div><dt>Propulsion</dt><dd>{Math.round(c.targetPower * 100)}%</dd></div>
        <div><dt>List / trim</dt><dd>{c.targetList.toFixed(1)}° / {c.targetTrim.toFixed(1)}°</dd></div>
        <div><dt>Draft change</dt><dd>{c.targetDraftChange.toFixed(2)} m</dd></div>
        <div><dt>Fires</dt><dd>{c.targetFires}</dd></div>
        <div><dt>Flooding</dt><dd>{c.targetWater.toFixed(1)} m³</dd></div>
      </dl>
      <p className="damage-message" role="status">{c.message}</p>
      {c.targetDefeatCause && <p className="damage-message">Loss cause: {c.targetDefeatCause.replaceAll('-', ' ')}</p>}
      <details className="shell-history">
        <summary>Recent shell impacts · {c.shellHistory.length}</summary>
        {c.shellHistory.length === 0 ? <p>No hits recorded on this target.</p> : c.shellHistory.map(h => <details key={h.shellId}>
          <summary>{h.ammunition.toUpperCase()} shell {h.shellId} · {h.outcome.replace('internal', 'stopped inside')}</summary>
          <ol>{h.impacts.map((impact, i) => <li key={i}>
            <strong>{impact.targetName} · {impact.outcome}</strong>
            {impact.impactSpeedMps !== undefined && <span>{impact.impactSpeedMps.toFixed(0)} m/s at impact</span>}
            {impact.exitSpeedMps !== undefined && <span>{impact.exitSpeedMps.toFixed(0)} m/s after contact</span>}
            {impact.fuze && <span>{impact.fuze === 'unarmed' ? 'Fuze unarmed' : `Fuze armed · ${((impact.fuzeRemainingSeconds ?? 0) * 1000).toFixed(1)} ms to burst`}</span>}
            {impact.thicknessMm !== undefined && <span>{impact.thicknessMm.toFixed(1)} mm {impact.material}{impact.obliquityDeg !== undefined ? ` · ${impact.obliquityDeg.toFixed(1)}° from normal` : ''}</span>}
            {impact.fragmentBudgetMm !== undefined && <span>{impact.fragmentBudgetMm.toFixed(1)} mm fragment budget</span>}
            <span>{impact.resistanceMm !== undefined ? `${impact.resistanceMm.toFixed(1)} mm resistance · ` : ''}{impact.penetrationAfterMm.toFixed(1)} mm remaining</span>
            {!!impact.damage && <span>{impact.damage.toFixed(1)} damage</span>}
            {impact.breachAssignments ? impact.breachAssignments.filter(b => b.areaM2 > 0).map((b, index) => <span key={index}>{b.areaM2.toFixed(3)} m² opening · {b.compartmentId}</span>) : !!impact.breachAreaM2 && <span>{impact.breachAreaM2.toFixed(3)} m² opening · {impact.compartmentId ?? 'watertight boundary'}</span>}
          </li>)}</ol>
        </details>)}
      </details>
      <details className="shell-history">
        <summary>Damaged gun mounts · {c.targetMounts.filter(m => m.condition < 1).length}</summary>
        <div className="module-conditions">{c.targetMounts.filter(m => m.condition < 1).map(m => <div key={m.id}><span>{m.name}</span><strong>{m.condition <= 0 ? 'Disabled' : `${Math.round(m.condition * 100)}% condition`}</strong></div>)}</div>
        {c.targetMounts.every(m => m.condition === 1) && <p>No gun damage recorded on this target.</p>}
      </details>
      {data.inspecting && <div className="module-conditions" aria-label="Internal module condition">{c.modules.map(m => <div key={m.id}><span>{m.name}</span><strong>{m.reason === 'flooded' ? 'Flooded · offline' : m.reason === 'destroyed' ? 'Destroyed' : `${Math.round(m.availability * 100)}% available`}</strong></div>)}<p>Flooded equipment can recover when drained. Destroyed equipment stays offline.</p><p>Amber: armor · Pale outlines: flooded spaces · Blue: floodwater. The full dry layout is available in port.</p></div>}
      {c.battery === 'torpedo' && <p className="gunnery-help">Aim within the bow or stern arc. Each press launches one loaded tube; hold to launch in sequence. Torpedoes run straight. Target waterline computes a lead for the selected target.</p>}
      <p className="gunnery-help">Mouse aims the center sight. Hold left mouse or {bindingLabel(bindings, 'fire')} to fire. Shift opens binoculars; scroll adjusts magnification. Selecting a module tracks it until you move the mouse to aim again.</p>
      <p className="gunnery-help">Aim AP at turrets or magazines to disable weapons. Surviving guns keep fighting; flooding can sink the ship.</p>
    </div><div className="target-actions">
      <button aria-pressed={!!data.inspecting} onClick={() => { game?.inspectTarget(); if (window.innerWidth <= 760) onExpand(false); }}>{data.inspecting ? 'Return to ship' : 'Inspect target'}</button>
    </div></>}
    {!expanded && data.inspecting && <div className="target-actions"><button onClick={() => game?.inspectTarget()}>Return to ship</button><button onClick={() => onExpand(true)}>Module condition</button></div>}
  </section>;
}
