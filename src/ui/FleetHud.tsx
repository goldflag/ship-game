import { useState, type PointerEvent } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { ENGINE_LABELS, KNOTS_PER_MPS } from '../simulation/ship';
import { Icon } from './Icons';
import { NavigationChart } from './NavigationChart';
import './FleetHud.css';

interface FleetHudProps {
  data: Telemetry;
  game: Game | null;
  visible: boolean;
}

function ShipBearing({ degrees }: { degrees: number }) {
  return <div className="fleet-bearing" aria-label={`Ship heading ${Math.round(degrees) % 360} degrees`}>
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeOpacity=".45"/>
      <circle cx="50" cy="50" r="33" stroke="currentColor" strokeOpacity=".18"/>
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M50 4v4" stroke="currentColor" strokeOpacity=".55" transform={`rotate(${i * 30} 50 50)`}/>)}
      <text x="50" y="18" textAnchor="middle" fill="currentColor" fontSize="8">N</text>
      <g transform={`rotate(${degrees} 50 50)`}>
        <path d="M50 23c-5 7-8 15-8 24v22l4 9h8l4-9V47c0-9-3-17-8-24Z" stroke="currentColor" fill="currentColor" fillOpacity=".15"/>
        <path d="M46 43h8v18h-8ZM46 34h8v5h-8Zm0 32h8v5h-8ZM48 34v-6m4 6v-6M48 71v5m4-5v5" stroke="currentColor" strokeWidth=".8"/>
        <path d="M50 22V7m-3 4 3-4 3 4" className="fleet-course-arrow" stroke="currentColor"/>
      </g>
    </svg>
  </div>;
}

function BearingTape({ degrees }: { degrees: number }) {
  const heading = String(Math.round(degrees) % 360).padStart(3, '0');
  const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  return <div className="fleet-compass" aria-label={`Course ${heading} degrees`}>
    <div className="fleet-compass-tape" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => {
      const value = Math.floor(degrees / 15) * 15 + (i - 7) * 15;
      const normalized = ((value % 360) + 360) % 360;
      return <span key={i} className={cardinals[normalized] ? 'fleet-cardinal' : ''} style={{ left: `calc(50% + ${(value - degrees) * 2.5}px)` }}>{cardinals[normalized] ?? String(normalized).padStart(3, '0')}</span>;
    })}</div>
    <i aria-hidden="true"/><strong>{heading}<small>°</small></strong>
  </div>;
}

function SecuredArmament() {
  return <section className="fleet-armament" aria-label="Armament secured during free sailing">
    <div className="fleet-battery-heading"><span>MAIN BATTERY <b>380 mm</b></span><strong>SECURED</strong></div>
    <div className="fleet-turrets" aria-label="Four main battery turrets secured">{['A', 'B', 'C', 'D'].map(turret => <span key={turret}><Icon name="turret" size={15}/><b>{turret}</b><i/></span>)}</div>
    <div className="fleet-weapon-row">
      <button disabled title="High explosive shells — weapons unavailable during free sailing"><Icon name="he" size={27}/><strong>HE</strong><small>380 mm</small></button>
      <button disabled title="Armor piercing shells — weapons unavailable during free sailing"><Icon name="shell" size={27}/><strong>AP</strong><small>380 mm</small></button>
      <button disabled title="Damage control becomes available with combat"><Icon name="repair" size={27}/><strong>DAMAGE CONTROL</strong><small>SECURED</small></button>
      <button disabled title="Repair party becomes available with combat"><Icon name="ship" size={27}/><strong>REPAIR PARTY</strong><small>SECURED</small></button>
      <button disabled title="Firing becomes available with combat"><Icon name="target" size={24}/><strong>FIRE SALVO</strong><small>SECURED</small></button>
    </div>
  </section>;
}

export function FleetHud({ data, game, visible }: FleetHudProps) {
  const [help, setHelp] = useState(false);
  const degrees = ((data.ship.heading * 180 / Math.PI) % 360 + 360) % 360;
  const heading = String(Math.round(degrees) % 360).padStart(3, '0');
  const speed = Math.abs(data.ship.speed * KNOTS_PER_MPS).toFixed(1);
  const rudder = Math.round(data.ship.rudder * 35);
  const direction = data.ship.speed < -0.01 ? 'ASTERN' : data.ship.speed > 0.01 ? 'UNDERWAY' : 'AT REST';
  const steer = (event: PointerEvent<HTMLButtonElement>, value: number) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    game?.input.setRudder(value);
  };
  const releaseRudder = () => game?.input.setRudder(0);

  return <div className={`fleet-hud ${visible ? '' : 'fleet-hud-hidden'}`} inert={!visible}>
    <div className="fleet-edge-shade" aria-hidden="true"/>
    <header className="fleet-mission"><strong>NORTH ATLANTIC</strong><span>Free sailing · Singleplayer</span></header>
    <BearingTape degrees={degrees}/>
    <div className="fleet-top-actions">
      <span className="fleet-fps" aria-label={`${data.fps} frames per second`}><strong>{data.fps || '—'}</strong> FPS</span>
      <button className="icon-button" aria-label="Pause and settings" title="Pause · Esc" onClick={() => game?.setPaused(true)}><Icon name="pause" size={17}/></button>
    </div>

    <div className="fleet-sight" aria-hidden="true"><svg viewBox="0 0 540 80" fill="none">
      <path d="M10 35h235m50 0h235M270 12v13m0 20v13" stroke="currentColor"/>
      {Array.from({ length: 21 }, (_, i) => i === 10 ? null : <g key={i}><path d={`M${20 + i * 25} 35v${i % 2 === 0 ? 9 : 5}`} stroke="currentColor"/>{i % 2 === 0 && <text x={20 + i * 25} y="60" fill="currentColor" textAnchor="middle" fontSize="10">{Math.abs(i - 10)}</text>}</g>)}
      <circle cx="270" cy="35" r="6" stroke="currentColor"/><path d="M267 35h6m-3-3v6" stroke="currentColor"/>
    </svg></div>

    <section className="fleet-ship" aria-label="Ship navigation and engine controls">
      <div className="fleet-ship-name"><Icon name="ship" size={22}/><h1>BISMARCK</h1><span>BATTLESHIP</span></div>
      <div className="fleet-ship-status"><strong>{direction}</strong><span>{heading}° COURSE</span></div>
      <div className="fleet-status-rule" aria-hidden="true"/>
      <div className="fleet-navigation"><ShipBearing degrees={degrees}/><div className="fleet-engine">
        <div className="fleet-speed"><strong>{speed}</strong><span>kn</span><b>{ENGINE_LABELS[data.order]}</b></div>
        <div className="fleet-throttle" role="group" aria-label="Engine telegraph">{['REV', 'STOP', '¼', '½', '¾', 'FULL'].map((label, index) => <button key={label} aria-label={`Engine ${ENGINE_LABELS[index].toLowerCase()}`} title={ENGINE_LABELS[index]} aria-pressed={data.order === index} onClick={event => { game?.input.setOrder(index); event.currentTarget.blur(); }}>{label}</button>)}</div>
        <div className="fleet-steering" aria-label={`Rudder ${Math.abs(rudder)} degrees ${rudder < 0 ? 'port' : rudder > 0 ? 'starboard' : 'amidships'}`}><span>PORT</span><div><i style={{ left: `${50 + data.ship.rudder * 48}%` }}/></div><span>STBD</span><strong>{rudder === 0 ? '0°' : `${Math.abs(rudder)}° ${rudder < 0 ? 'P' : 'S'}`}</strong></div>
      </div></div>
      <div className="fleet-touch-helm"><button aria-label="Hold to steer port" onPointerDown={event => steer(event, -1)} onPointerUp={releaseRudder} onPointerCancel={releaseRudder} onLostPointerCapture={releaseRudder}>PORT</button><button aria-label="Hold to steer starboard" onPointerDown={event => steer(event, 1)} onPointerUp={releaseRudder} onPointerCancel={releaseRudder} onLostPointerCapture={releaseRudder}>STARBOARD</button></div>
      <div className="fleet-sailing-meta"><span>{(data.ship.distance / 1852).toFixed(2)} NM SAILED</span><span><kbd>W</kbd><kbd>S</kbd> ENGINE</span></div>
    </section>

    <SecuredArmament/>
    <aside className="fleet-map-area">
      <div className="fleet-camera-controls"><button onClick={event => { game?.cycleCamera(); event.currentTarget.blur(); }} title="Cycle camera · C"><Icon name="camera" size={14}/>{data.camera}<kbd>C</kbd></button><button aria-label="Recenter camera" title="Recenter camera · R" onClick={event => { game?.recenter(); event.currentTarget.blur(); }}><Icon name="compass" size={15}/></button><button aria-label="Toggle fullscreen" title="Fullscreen · F" onClick={() => game?.fullscreen()}><Icon name="expand" size={14}/></button></div>
      <NavigationChart data={data}/>
    </aside>
    <button className="fleet-help-button" aria-expanded={help} aria-controls="fleet-help" onClick={() => setHelp(value => !value)}>Controls</button>
    {help && <aside className="fleet-help" id="fleet-help" aria-label="Sailing controls"><div><strong>SAILING CONTROLS</strong><button aria-label="Close controls" onClick={() => setHelp(false)}><Icon name="close" size={16}/></button></div><dl><div><dt><kbd>W</kbd><kbd>S</kbd></dt><dd>Change engine order</dd></div><div><dt><kbd>A</kbd><kbd>D</kbd></dt><dd>Hold to steer</dd></div><div><dt><kbd>SPACE</kbd></dt><dd>Stop engine</dd></div><div><dt>Drag / scroll</dt><dd>Orbit / zoom</dd></div><div><dt><kbd>H</kbd></dt><dd>Hide instruments</dd></div><div><dt><kbd>ESC</kbd></dt><dd>Pause and settings</dd></div></dl><p>Weapons are secured during free sailing.</p></aside>}
  </div>;
}
