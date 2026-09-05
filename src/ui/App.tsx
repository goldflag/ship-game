import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import { createShipState, ENGINE_LABELS, KNOTS_PER_MPS } from '../simulation/ship';
import { DEFAULT_SETTINGS, type GameSettings, type Telemetry } from '../game/types';
import { Icon } from './Icons';
import { NavigationChart } from './NavigationChart';

const INITIAL_TELEMETRY: Telemetry = { ship: createShipState(), order: 1, camera: 'Chase', fps: 0, backend: 'webgpu', trail: [] };
function loadSettings(): GameSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('bismarck-settings') ?? '{}');
    return {
      quality: ['medium', 'high', 'ultra'].includes(saved.quality) ? saved.quality : DEFAULT_SETTINGS.quality,
      sea: ['Fair', 'Atlantic', 'Heavy'].includes(saved.sea) ? saved.sea : DEFAULT_SETTINGS.sea,
      resolution: [0.65, 0.8, 1].includes(saved.resolution) ? saved.resolution : DEFAULT_SETTINGS.resolution,
    };
  } catch { return DEFAULT_SETTINGS; }
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [draft, setDraft] = useState(settings);
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState(INITIAL_TELEMETRY);
  const [loading, setLoading] = useState({ label: 'Preparing your sea trial', progress: 0 });
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(true);
  const [help, setHelp] = useState(true);

  useEffect(() => {
    let active = true;
    setReady(false); setError(''); setPaused(false); setData(INITIAL_TELEMETRY);
    const session = new Game(host.current!, settings, {
      progress: (label, progress) => active && setLoading({ label, progress }),
      ready: () => active && setReady(true),
      telemetry: value => active && setData(value),
      pause: value => active && setPaused(value),
      hud: () => active && setHud(value => !value),
      error: message => active && setError(message),
    });
    game.current = session;
    session.start();
    return () => { active = false; game.current = null; void session.dispose(); };
  }, [generation, settings]);

  useEffect(() => {
    if (paused && ready && !error) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error]);

  const degrees = data.ship.heading * 180 / Math.PI;
  const heading = String(Math.round(degrees) % 360).padStart(3, '0');
  const speed = Math.abs(data.ship.speed * KNOTS_PER_MPS).toFixed(1);
  const rudderDegrees = Math.round(data.ship.rudder * 35);
  const applySettings = () => {
    try { localStorage.setItem('bismarck-settings', JSON.stringify(draft)); } catch { /* Storage is optional. */ }
    if (JSON.stringify(settings) === JSON.stringify(draft)) setGeneration(value => value + 1);
    else setSettings({ ...draft });
  };

  return <main className="game-shell">
    <div ref={host} className="ocean-viewport" />
    <div className="scene-shade" aria-hidden="true" />
    {ready && !error && <div className={`hud ${!hud ? 'hud-hidden' : ''}`}>
      <header className="top-bar">
        <div className="identity"><Icon name="anchor" size={27}/><div><h1>BISMARCK</h1><span>SEA TRIALS</span></div><span className="identity-rule"/><p>SINGLEPLAYER<br/><strong>Open Atlantic</strong></p></div>
        <div className="compass" aria-label={`Heading ${heading} degrees`}>
          <div className="compass-tape">{Array.from({ length: 25 }, (_, i) => {
            const value = Math.floor(degrees / 15) * 15 + (i - 12) * 15;
            const normalized = ((value % 360) + 360) % 360;
            const cardinal: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
            return <span key={i} className={cardinal[normalized] ? 'cardinal' : ''} style={{ left: `calc(50% + ${(value - degrees) * 2.2}px)` }}>{cardinal[normalized] ?? String(normalized).padStart(3, '0')}</span>;
          })}</div>
          <div className="compass-marker"/><strong>{heading}<small>°</small></strong>
        </div>
        <div className="top-actions"><span className="session-status"><i/>FREE SAILING</span><button className="icon-button" aria-label="Pause and settings" title="Pause · Esc" onClick={() => game.current?.setPaused(true)}><Icon name="pause"/></button></div>
      </header>

      <div className="environment-caption"><span className="fine-rule"/><span>{settings.sea === 'Fair' ? 'LIGHT SWELL' : settings.sea === 'Heavy' ? 'HEAVY SWELL' : 'ATLANTIC SWELL'}</span><span>DAYLIGHT</span></div>

      <section className="helm" aria-label="Ship controls">
        <div className="speed-row"><div className="speed"><span className="speed-number">{speed}</span><div><span>KNOTS</span><span className="speed-direction">{data.ship.speed < -0.01 ? 'ASTERN' : data.ship.speed > 0.01 ? 'AHEAD' : 'AT REST'}</span></div></div><div className="engine-status"><span>ENGINE ORDER</span><strong>{ENGINE_LABELS[data.order]}</strong></div></div>
        <div className="engine-telegraph" role="group" aria-label="Engine telegraph">
          {['REV', 'STOP', '¼', '½', '¾', 'FULL'].map((label, i) => <button key={label} title={ENGINE_LABELS[i]} aria-label={`Engine ${ENGINE_LABELS[i].toLowerCase()}`} aria-pressed={data.order === i} className={data.order === i ? 'selected' : ''} onClick={e => { game.current?.input.setOrder(i); e.currentTarget.blur(); }}><span className="order-tick"/>{label}</button>)}
        </div>
        <div className="rudder-label"><span>PORT</span><strong>{rudderDegrees === 0 ? 'RUDDER AMIDSHIPS' : `${Math.abs(rudderDegrees)}° ${rudderDegrees < 0 ? 'PORT' : 'STARBOARD'}`}</strong><span>STBD</span></div>
        <div className="rudder-track"><span className="rudder-center"/><span className="rudder-needle" style={{ left: `${50 + data.ship.rudder * 48}%` }}/></div>
        <div className="touch-helm"><button aria-label="Hold to steer port" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); game.current?.input.setRudder(-1); }} onPointerUp={() => game.current?.input.setRudder(0)} onPointerCancel={() => game.current?.input.setRudder(0)} onLostPointerCapture={() => game.current?.input.setRudder(0)}>PORT</button><button aria-label="Hold to steer starboard" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); game.current?.input.setRudder(1); }} onPointerUp={() => game.current?.input.setRudder(0)} onPointerCancel={() => game.current?.input.setRudder(0)} onLostPointerCapture={() => game.current?.input.setRudder(0)}>STARBOARD</button></div>
      </section>

      <aside className="chart-area"><NavigationChart data={data}/><div className="chart-meta"><span>{heading}° COURSE</span><span>{(data.ship.distance / 1852).toFixed(2)} NM SAILED</span></div></aside>

      <div className="camera-controls"><button onClick={e => { game.current?.cycleCamera(); e.currentTarget.blur(); }}><Icon name="camera" size={16}/>{data.camera} camera<kbd>C</kbd></button><button className="icon-button" aria-label="Recenter camera" title="Recenter · R" onClick={e => { game.current?.recenter(); e.currentTarget.blur(); }}><Icon name="compass" size={17}/></button><button className="icon-button" aria-label="Toggle fullscreen" title="Fullscreen · F" onClick={() => game.current?.fullscreen()}><Icon name="expand" size={16}/></button></div>

      <footer className="control-footer"><span><kbd>W</kbd><kbd>S</kbd> Engine</span><span><kbd>A</kbd><kbd>D</kbd> Rudder</span><span><kbd>SPACE</kbd> Stop engine</span><span className="mouse-hint">Drag to look · Scroll to zoom</span><button onClick={() => setHelp(value => !value)}>Controls <kbd>?</kbd></button></footer>
      {help && <div className="sailing-hint"><button aria-label="Dismiss sailing hint" onClick={() => setHelp(false)}><Icon name="close" size={15}/></button><strong>The Atlantic is yours.</strong><p>Tap <kbd>W</kbd> to increase the engine order. Hold <kbd>A</kbd> or <kbd>D</kbd> to turn. A battleship takes time to gather speed.</p></div>}
    </div>}

    {ready && !hud && <button className="restore-hud" onClick={() => setHud(true)}>Show instruments <kbd>H</kbd></button>}

    {(!ready || error) && <section className="loading-screen" aria-live="polite">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>SEA TRIALS</span></div>
      <div className="loading-content"><h1>BISMARCK</h1><p className="loading-subtitle">Take the helm.</p><div className="ship-measure"><div/><span>250.5 M</span><div/></div>
        {error ? <div className="error-message"><h2>Unable to launch the sea trial</h2><p>{error}</p><p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p><button className="primary-button" onClick={() => setGeneration(value => value + 1)}>Try again <Icon name="arrow" size={18}/></button></div> : <><div className="loading-progress" role="progressbar" aria-label="Loading sea trial" aria-valuenow={Math.round(loading.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${loading.progress * 100}%` }}/></div><div className="loading-status"><span>{loading.label}</span><span>{Math.round(loading.progress * 100)}%</span></div><p className="compile-note">The first launch prepares the ocean and cloud shaders.</p></>}
      </div><div className="loading-bottom"><span>SINGLEPLAYER · OPEN OCEAN</span><span>BISMARCK / 1941</span></div>
    </section>}

    <dialog ref={dialog} className="pause-menu" onCancel={e => { e.preventDefault(); game.current?.setPaused(false); }}>
      <div className="menu-heading"><h2>At your command.</h2><button className="icon-button" aria-label="Resume sailing" onClick={() => game.current?.setPaused(false)}><Icon name="close"/></button></div>
      <p className="menu-description">Sea trial paused. Your engine order is held.</p>
      <button autoFocus className="primary-button" onClick={() => game.current?.setPaused(false)}>Resume sailing <Icon name="play" size={18}/></button>
      <div className="settings-heading">SEA TRIAL SETTINGS</div>
      <label className="setting-row">Ocean detail<select value={draft.quality} onChange={e => setDraft({ ...draft, quality: e.target.value as GameSettings['quality'] })}><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
      <label className="setting-row">Render scale<select value={draft.resolution} onChange={e => setDraft({ ...draft, resolution: Number(e.target.value) })}><option value={0.65}>65%</option><option value={0.8}>80%</option><option value={1}>100%</option></select></label>
      <label className="setting-row">Sea conditions<select value={draft.sea} onChange={e => setDraft({ ...draft, sea: e.target.value as GameSettings['sea'] })}><option>Fair</option><option>Atlantic</option><option>Heavy</option></select></label>
      <button className="secondary-button restart-button" onClick={applySettings}>Apply & restart sea trial <Icon name="arrow" size={17}/></button>
      <p className="settings-note">Restarts from your departure point. Lower detail or render scale can improve performance.</p>
      <div className="menu-controls"><span><kbd>C</kbd> Change camera</span><span><kbd>R</kbd> Recenter view</span><span><kbd>H</kbd> Hide instruments</span><span><kbd>F</kbd> Fullscreen</span></div>
      <div className="renderer-status"><span>{data.backend.toUpperCase()} RENDERER</span><span>{data.fps} FPS</span></div>
    </dialog>
  </main>;
}
