import { type CSSProperties, type PointerEvent } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { ENGINE_LABELS, KNOTS_PER_MPS } from '../simulation/ship';
import { Icon } from './Icons';
import { NavigationChart } from './NavigationChart';
import { GunneryPanel } from './GunneryPanel';
import { useShip } from './ShipContext';
import './FleetHud.css';

interface FleetHudProps { data: Telemetry; game: Game | null; visible: boolean; }

function ShipBearing({ data }: { data: Telemetry }) {
  const selectedShip = useShip();
  const degrees = data.ship.heading * 180 / Math.PI;
  const mounts = selectedShip.mounts.filter(m => m.battery === (data.combat?.battery ?? 'main'));
  return <div className="fleet-bearing" aria-label={`Ship heading ${Math.round(degrees) % 360} degrees`}>
    <svg viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="92" stroke="currentColor" strokeOpacity=".65"/>
      <circle cx="100" cy="100" r="87" stroke="currentColor" strokeOpacity=".2"/>
      {Array.from({ length: 36 }, (_, i) => <path key={i} d={i % 3 === 0 ? 'M100 8v7' : 'M100 8v3'} stroke="currentColor" strokeOpacity=".5" transform={`rotate(${i * 10} 100 100)`}/>)}
      <text x="100" y="29" textAnchor="middle">N</text><text x="174" y="104" textAnchor="middle">E</text><text x="100" y="181" textAnchor="middle">S</text><text x="26" y="104" textAnchor="middle">W</text>
      <g transform={`rotate(${(data.viewBearing ?? data.ship.heading) * 180 / Math.PI} 100 100)`}>
        <path d="M100 100 66 15Q100 2 134 15Z" fill="currentColor" fillOpacity=".045"/>
        <path d="M100 100V10" stroke="var(--fleet-active)" strokeOpacity=".55" strokeDasharray="3 4"/>
        <circle cx="100" cy="13" r="3" fill="var(--fleet-active)"/>
      </g>
      <g transform={`rotate(${degrees} 100 100)`}>
        <path d="M100 37c-8 12-14 24-14 39v66l6 16h16l6-16V76c0-15-6-27-14-39Z" stroke="currentColor" fill="currentColor" fillOpacity=".12"/>
        <path d="M95 81h10v39H95ZM91 127h18v8H91ZM94 72h12v7H94Z" stroke="currentColor" strokeOpacity=".45"/>
        {mounts.map((mount, i) => {
          const status = data.combat?.mounts.find(m => m.id === mount.id)?.status;
          const x = 100 + mount.position[0] / selectedShip.hull.beam * 25;
          const y = 100 + mount.position[2] / selectedShip.hull.length * 114;
          return <g key={mount.id} transform={`translate(${x} ${y})`} className={status === 'ready' ? 'bearing-gun-ready' : 'bearing-gun'}>
            <circle r="3" fill="currentColor"/><text x={mount.position[0] < 0 ? -9 : 9} y="3" textAnchor="middle">{i + 1}</text>
          </g>;
        })}
      </g>
    </svg>
    <span className="fleet-bearing-course">{String(Math.round(degrees) % 360).padStart(3, '0')}°</span>
  </div>;
}

function BearingTape({ degrees }: { degrees: number }) {
  const heading = String(Math.round(degrees) % 360).padStart(3, '0');
  const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  return <div className="fleet-compass" aria-label={`View bearing ${heading} degrees`}>
    <div className="fleet-compass-tape" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => {
      const value = Math.floor(degrees / 15) * 15 + (i - 7) * 15;
      const normalized = ((value % 360) + 360) % 360;
      return <span key={i} className={cardinals[normalized] ? 'fleet-cardinal' : ''} style={{ left: `calc(50% + ${(value - degrees) * 2.5}px)` }}>{cardinals[normalized] ?? String(normalized).padStart(3, '0')}</span>;
    })}</div><i aria-hidden="true"/><strong>{heading}<small>°</small></strong>
  </div>;
}

function AmmoGlyph({ secondary = false }: { secondary?: boolean }) {
  return <svg className="fleet-ammo-glyph" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <g transform={secondary ? 'translate(3 4) rotate(28 32 32)' : 'rotate(28 32 32)'}>
      {secondary && <path d="M17 49V22l6-12 6 12v27Z" fill="#99a8ae" stroke="#e1e9e9"/>}
      <path d="M26 48V21c0-7 6-16 6-16s6 9 6 16v27Z" fill={secondary ? '#bacbd0' : '#d9b665'} stroke="#e8e0c3" strokeWidth="1.2"/>
      <path d="M26 21c0-7 6-16 6-16s6 9 6 16Z" fill={secondary ? '#bb715b' : '#f2e2a8'}/>
      <path d="M28 23v20" stroke="#fff" strokeOpacity=".45" strokeWidth="2"/>
      <path d="M25 44h14v4H25Zm-1 7h16v4H24Z" fill="#d9e0d7"/>
      <path d="M26 48h12v3H26Z" fill="#778991"/>
    </g>
  </svg>;
}

function BinocularGlyph() {
  return <svg className="fleet-optics-glyph" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m10 41 6-25h11l2 25m6 0 2-25h11l6 25M27 25h10M28 32h8M18 16v-5h7v5m14 0v-5h7v5"/><circle cx="19" cy="43" r="10" fill="#233e4a"/><circle cx="45" cy="43" r="10" fill="#233e4a"/><circle cx="19" cy="43" r="6" strokeOpacity=".45"/><circle cx="45" cy="43" r="6" strokeOpacity=".45"/></svg>;
}

function ActiveArmament({ data, game }: FleetHudProps) {
  const selectedShip = useShip();
  const combat = data.combat;
  if (!combat) return null;
  const caliber = (battery: 'main' | 'secondary') => Math.round((selectedShip.mounts.find(m => m.battery === battery)?.weapon.caliberM ?? 0) * 1000);
  return <section className="fleet-armament" aria-label="Weapons and gunnery">
    <div className="fleet-turrets" aria-label="Battery mount readiness">{combat.mounts.map((mount, i) => {
      const reloadSeconds = selectedShip.mounts.find(m => m.id === mount.id)?.weapon.reloadSeconds ?? 1;
      const ready = mount.status === 'ready';
      const progress = mount.reload > 0 ? 1 - mount.reload / reloadSeconds : ready ? 1 : 0;
      const label = ready ? 'Ready' : mount.status === 'reloading' ? `Reloading · ${Math.ceil(mount.reload)} seconds` : mount.status.replaceAll('-', ' ');
      return <div key={mount.id} title={`${mount.name}: ${label} · ${mount.ammo} shells`} aria-label={`${mount.name}: ${label}`} className={`fleet-mount ${ready ? 'fleet-gun-ready' : ''} ${mount.status === 'disabled' ? 'fleet-gun-disabled' : ''}`}>
        <svg viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="16"/><circle className="fleet-reload-progress" cx="19" cy="19" r="16" pathLength="100" strokeDasharray={`${progress * 100} 100`} transform="rotate(-90 19 19)"/></svg>
        <b>{mount.reload > 0 ? Math.ceil(mount.reload) : ready ? <Icon name="turret" size={18}/> : '—'}</b><small>{i + 1}</small>
      </div>;
    })}</div>
    <div className="fleet-battery-heading"><span>{caliber(combat.battery)} mm · {combat.battery === 'main' ? 'Main battery' : 'Secondary battery'}</span><strong>{combat.ready}/{combat.total} ready</strong></div>
    <div className="fleet-weapon-row">
      {combat.batteries.map((battery, i) => <button key={battery.battery} className="fleet-weapon-slot" aria-label={`Select ${battery.battery} AP battery · ${battery.ammo} shells · ${i + 1}`} aria-pressed={combat.battery === battery.battery} disabled={!battery.total} onClick={event => { if (game) game.battery = battery.battery; event.currentTarget.blur(); }}>
        <span className="fleet-slot-label">{battery.battery === 'main' ? 'MAIN AP' : 'SEC. AP'}</span><AmmoGlyph secondary={battery.battery === 'secondary'}/>
        <strong className="fleet-ammo-count">{battery.ammo}</strong>
        {battery.reload > 0 && Number.isFinite(battery.reload) && battery.ready === 0 && <span className="fleet-slot-cooldown">{Math.ceil(battery.reload)}<small>s</small></span>}
        <kbd>{i + 1}</kbd>
      </button>)}
      <button className="fleet-weapon-slot fleet-utility-slot" aria-label="Toggle binocular aiming · Shift" aria-pressed={!!data.binoculars} onClick={event => { game?.toggleBinoculars(); event.currentTarget.blur(); }}><span className="fleet-slot-label">BINOCULARS</span><BinocularGlyph/><strong className="fleet-slot-value">{data.binoculars ? `${data.magnification}×` : ''}</strong><kbd>SHIFT</kbd></button>
      <button className="fleet-weapon-slot" aria-label="Gunnery and target damage · G" aria-expanded={!!data.gunneryOpen} onClick={event => { game?.setGunneryOpen(!data.gunneryOpen); event.currentTarget.blur(); }}><span className="fleet-slot-label">GUNNERY</span><Icon name="target" size={39}/><kbd>G</kbd></button>
      <button className="fleet-weapon-slot fleet-fire-slot" aria-label="Fire ready guns · Left mouse or Q" disabled={!combat.ready} onClick={event => { game?.fire(); event.currentTarget.blur(); }}><span className="fleet-slot-label">FIRE</span><Icon name="turret" size={39}/><kbd>Q / LMB</kbd></button>
    </div>
    <div className="fleet-control-hint"><span><kbd>CTRL</kbd> Cursor</span><span><kbd>SHIFT</kbd> Aim</span><span><kbd>ESC</kbd> Menu</span></div>
  </section>;
}

export function FleetHud({ data, game, visible }: FleetHudProps) {
  const selectedShip = useShip();
  const degrees = ((data.viewBearing ?? data.ship.heading) * 180 / Math.PI + 360) % 360;
  const speed = Math.abs(data.ship.speed * KNOTS_PER_MPS).toFixed(1);
  const rudder = Math.round(data.ship.rudder * 35);
  const integrity = Math.max(0, Math.min(1, data.combat?.playerIntegrity ?? 1));
  const steer = (event: PointerEvent<HTMLButtonElement>, value: number) => {
    event.currentTarget.setPointerCapture(event.pointerId); game?.input.setRudder(value);
  };
  const releaseRudder = () => game?.input.setRudder(0);
  const mapSize = [240, 280, 320, 360, 400][data.chartSize ?? 2];

  return <div className={`fleet-hud ${visible ? '' : 'fleet-hud-hidden'} ${data.binoculars ? 'fleet-in-optics' : ''}`} inert={!visible} style={{ '--map-factor': mapSize / 400 } as CSSProperties}>
    <div className="fleet-edge-shade" aria-hidden="true"/>
    <BearingTape degrees={degrees}/>
    <div className="fleet-top-actions"><span className="fleet-fps" aria-label={`${data.fps} frames per second`}><strong>{data.fps || '—'}</strong> FPS</span><button className="icon-button" aria-label="Pause and settings" title="Pause · Esc" onClick={() => game?.setPaused(true)}><Icon name="pause" size={17}/></button></div>

    {!data.inspecting && <div className={`fleet-sight ${data.binoculars ? 'fleet-sight-optics' : 'fleet-sight-chase'}`} aria-hidden="true">
      {data.binoculars ? <><svg viewBox="0 0 540 80" fill="none"><path d="M10 40h238m44 0h238M270 15v14m0 22v14" stroke="currentColor"/>
        {Array.from({ length: 21 }, (_, i) => i === 10 ? null : <g key={i}><path d={`M${20 + i * 25} 40v${i % 2 === 0 ? 9 : 5}`} stroke="currentColor"/>{i % 2 === 0 && <text x={20 + i * 25} y="65" fill="currentColor" textAnchor="middle" fontSize="10">{Math.abs(i - 10)}</text>}</g>)}
        <circle cx="270" cy="40" r="5" stroke="currentColor"/><circle cx="270" cy="40" r="1.5" fill="currentColor"/></svg>
        <div className="fleet-scope-readout"><strong>{((data.combat?.range ?? 0) / 1000).toFixed(2)} <small>km</small></strong><span>{data.magnification}× <small>SCROLL TO ZOOM</small></span></div></> :
        <svg viewBox="0 0 44 44" fill="none"><path d="M3 22h9m20 0h9M22 3v9m0 20v9" stroke="currentColor"/><circle cx="22" cy="22" r="5" stroke="currentColor"/><circle cx="22" cy="22" r="1" fill="currentColor"/></svg>}
    </div>}
    {!data.pointerLocked && !data.inspecting && !data.gunneryOpen && <button className="fleet-capture-hint" onClick={() => game?.capturePointer()}>Click sea to aim <span>Hold Ctrl for cursor</span></button>}

    <section className="fleet-ship" aria-label="Ship condition and helm">
      <svg className="fleet-ship-silhouette" viewBox="0 0 180 34" fill="currentColor" aria-hidden="true"><path d="m3 24 8 8h151l14-10-27 2v-5h-17v-6h-12V9h-8V4h-2v5h-8v7H85V9H73V5h-2v4H60v9H42v5H27v-5H15v6Zm35-7h20v2H38Zm94-5h25v2h-25Z"/></svg>
      <div className="fleet-ship-name"><h1>{selectedShip.name.toUpperCase()}</h1><span className="fleet-hp" aria-label={`Hull integrity ${Math.round(integrity * 100)} percent`}><strong>{Math.round(integrity * 1000).toLocaleString()}</strong><span> / 1,000</span></span></div>
      <div className="fleet-health-track" role="meter" aria-label="Hull integrity" aria-valuenow={Math.round(integrity * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${integrity * 100}%` }}/></div>
      <div className="fleet-navigation"><ShipBearing data={data}/><div className="fleet-engine">
        <div className="fleet-speed"><strong>{speed}</strong><span>kts</span></div>
        <div className="fleet-throttle" role="group" aria-label="Engine telegraph">{[{ label: 'FULL', index: 5 }, { label: '3/4', index: 4 }, { label: '1/2', index: 3 }, { label: '1/4', index: 2 }, { label: 'STOP', index: 1 }, { label: 'FULL', index: 0 }].map(({ label, index }) => <button key={index} aria-label={`Engine ${ENGINE_LABELS[index].toLowerCase()}`} title={ENGINE_LABELS[index]} aria-pressed={data.order === index} onClick={event => { game?.input.setOrder(index); event.currentTarget.blur(); }}><span>{label}</span>{index === 0 && <small>ASTERN</small>}</button>)}</div>
      </div></div>
      <div className="fleet-steering" aria-label={`Rudder ${Math.abs(rudder)} degrees ${rudder < 0 ? 'port' : rudder > 0 ? 'starboard' : 'amidships'}`}><kbd>A</kbd><span>PORT</span><div><i style={{ left: `${50 + data.ship.rudder * 47}%` }}/></div><span>STBD</span><kbd>D</kbd></div>
      {(data.combat?.playerWater ?? 0) > .1 && <p className="fleet-flood-warning">Flooding · {data.combat!.playerWater.toFixed(1)} m³</p>}
      <div className="fleet-touch-helm"><button aria-label="Hold to steer port" onPointerDown={event => steer(event, -1)} onPointerUp={releaseRudder} onPointerCancel={releaseRudder} onLostPointerCapture={releaseRudder}>PORT</button><button aria-label="Hold to steer starboard" onPointerDown={event => steer(event, 1)} onPointerUp={releaseRudder} onPointerCancel={releaseRudder} onLostPointerCapture={releaseRudder}>STARBOARD</button></div>
    </section>

    <ActiveArmament data={data} game={game} visible={visible}/>
    {(data.gunneryOpen || data.inspecting) && <GunneryPanel data={data} game={game} expanded={!!data.gunneryOpen} onExpand={value => game?.setGunneryOpen(value)}/>}
    {data.binoculars && data.aimModule !== 'point' && data.aimMarker?.visible && <div className="aim-marker" aria-hidden="true" style={{ left: `${data.aimMarker.x}%`, top: `${data.aimMarker.y}%` }}><span/><small>TRACKED AIM</small></div>}
    <aside className="fleet-map-area" aria-label="Navigation minimap"><NavigationChart data={data} onResize={direction => game?.resizeChart(direction)}/></aside>
  </div>;
}
