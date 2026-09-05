import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import { createShipState } from '../simulation/ship';
import { DEFAULT_SETTINGS, type GameSettings, type Telemetry } from '../game/types';
import { Icon } from './Icons';
import { FleetHud } from './FleetHud';
import { Garage } from './Garage';
import { selectedShip as initialShip, shipPreset } from '../ships/presets';
import { ShipContext } from './ShipContext';

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
  const [selectedShip, setSelectedShip] = useState(initialShip);
  const selectedRef = useRef(selectedShip);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const switchPending = useRef(false);
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
  const [phase, setPhase] = useState<'garage' | 'sailing'>('garage');

  useEffect(() => {
    let active = true;
    setSwitching(false); setSwitchError(''); switchPending.current = false;
    setReady(false); setError(''); setPaused(false); setData(INITIAL_TELEMETRY); setPhase('garage');
    const session = new Game(host.current!, settings, {
      progress: (label, progress) => active && setLoading({ label, progress }),
      ready: () => active && setReady(true),
      telemetry: value => active && setData(value),
      pause: value => active && setPaused(value),
      hud: () => active && setHud(value => !value),
      error: message => active && setError(message),
    }, selectedRef.current);
    game.current = session;
    session.setInPort(true);
    const reviewWindow = window as unknown as {
      shipTrialDiagnostics?: () => unknown;
      shipTrialArticulation?: (pose: Parameters<Game['previewArticulation']>[0]) => unknown;
    };
    if (import.meta.env.DEV) {
      reviewWindow.shipTrialDiagnostics = () => session.diagnostics();
      reviewWindow.shipTrialArticulation = pose => session.previewArticulation(pose);
    }
    session.start();
    return () => {
      active = false; game.current = null;
      if (import.meta.env.DEV) { delete reviewWindow.shipTrialDiagnostics; delete reviewWindow.shipTrialArticulation; }
      void session.dispose();
    };
  }, [generation, settings]);

  useEffect(() => {
    if (paused && ready && !error) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error]);

  const launch = () => {
    if (!ready || switchPending.current) return;
    game.current?.setInPort(false);
    setHud(true);
    setPhase('sailing');
  };
  const returnToPort = () => {
    game.current?.setInPort(true);
    setPhase('garage');
  };

  useEffect(() => { document.title = `${selectedShip.name} — Sea Trials`; }, [selectedShip]);

  const switchShip = async (id: string) => {
    const session = game.current;
    if (!ready || phase !== 'garage' || !session || switchPending.current || id === selectedShip.id) return;
    switchPending.current = true; setSwitching(true); setSwitchError('');
    try {
      const definition = shipPreset(id);
      await session.switchShip(definition);
      if (game.current !== session) return;
      selectedRef.current = definition;
      setSelectedShip(definition);
      const url = new URL(window.location.href);
      url.searchParams.set('ship', definition.id);
      window.history.replaceState(null, '', url);
    } catch (error) {
      if (game.current === session) setSwitchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (game.current === session) { switchPending.current = false; setSwitching(false); }
    }
  };

  const applySettings = () => {
    try { localStorage.setItem('bismarck-settings', JSON.stringify(draft)); } catch { /* Storage is optional. */ }
    if (JSON.stringify(settings) === JSON.stringify(draft)) setGeneration(value => value + 1);
    else setSettings({ ...draft });
  };

  return <ShipContext value={selectedShip}><main className="game-shell">
    <div ref={host} className="ocean-viewport" />
    {phase === 'garage' && !error && <Garage key={selectedShip.id} switching={switching} switchError={switchError} onSelectShip={switchShip} game={game.current} ready={ready} progress={loading.progress} fps={data.fps} onLaunch={launch} onSettings={() => game.current?.setPaused(true)}/>}
    {phase === 'sailing' && ready && !error && <FleetHud data={data} game={game.current} visible={hud}/>}

    {phase === 'sailing' && ready && !hud && <button className="restore-hud" onClick={() => setHud(true)}>Show instruments <kbd>H</kbd></button>}

    {((!ready && phase === 'sailing') || error) && <section className="loading-screen" aria-live="polite">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>SEA TRIALS</span></div>
      <div className="loading-content"><h1>{selectedShip.name.toUpperCase()}</h1><p className="loading-subtitle">Take the helm.</p><div className="ship-measure"><div/><span>{selectedShip.hull.length} M</span><div/></div>
        {error ? <div className="error-message"><h2>Unable to launch the sea trial</h2><p>{error}</p><p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p><button className="primary-button" onClick={() => setGeneration(value => value + 1)}>Try again <Icon name="arrow" size={18}/></button></div> : <><div className="loading-progress" role="progressbar" aria-label="Loading sea trial" aria-valuenow={Math.round(loading.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${loading.progress * 100}%` }}/></div><div className="loading-status"><span>{loading.label}</span><span>{Math.round(loading.progress * 100)}%</span></div><p className="compile-note">The first launch prepares the ocean and cloud shaders.</p></>}
      </div><div className="loading-bottom"><span>SINGLEPLAYER · OPEN OCEAN</span><span>{selectedShip.name.toUpperCase()} / {selectedShip.configuration.match(/19\d{2}/)?.[0]}</span></div>
    </section>}

    <dialog ref={dialog} className="pause-menu" onCancel={e => { e.preventDefault(); game.current?.setPaused(false); }}>
      <div className="menu-heading"><h2>{phase === 'garage' ? 'Port settings.' : 'At your command.'}</h2><button className="icon-button" aria-label={phase === 'garage' ? 'Close port settings' : 'Resume sailing'} onClick={() => game.current?.setPaused(false)}><Icon name="close"/></button></div>
      <p className="menu-description">{phase === 'garage' ? 'Prepare the sea conditions for your next voyage.' : 'Sea trial paused. Your engine order is held.'}</p>
      <button autoFocus className="primary-button" onClick={() => game.current?.setPaused(false)}>{phase === 'garage' ? 'Back to port' : 'Resume sailing'} <Icon name={phase === 'garage' ? 'anchor' : 'play'} size={18}/></button>
      {phase === 'sailing' && <button className="secondary-button restart-button" onClick={returnToPort}>Return to port <Icon name="anchor" size={18}/></button>}
      <div className="settings-heading">SEA TRIAL SETTINGS</div>
      <label className="setting-row">Ocean detail<select value={draft.quality} onChange={e => setDraft({ ...draft, quality: e.target.value as GameSettings['quality'] })}><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
      <label className="setting-row">Render scale<select value={draft.resolution} onChange={e => setDraft({ ...draft, resolution: Number(e.target.value) })}><option value={0.65}>65%</option><option value={0.8}>80%</option><option value={1}>100%</option></select></label>
      <label className="setting-row">Sea conditions<select value={draft.sea} onChange={e => setDraft({ ...draft, sea: e.target.value as GameSettings['sea'] })}><option>Fair</option><option>Atlantic</option><option>Heavy</option></select></label>
      <button className="secondary-button restart-button" onClick={applySettings}>Apply & reload port <Icon name="arrow" size={17}/></button>
      <p className="settings-note">Reloads the scene in port. Lower detail or render scale can improve performance.</p>
      {phase === 'sailing' && <div className="menu-controls"><span><kbd>C</kbd> Change camera</span><span><kbd>R</kbd> Recenter view</span><span><kbd>H</kbd> Hide instruments</span><span><kbd>F</kbd> Fullscreen</span></div>}
      <div className="renderer-status"><span>{data.backend.toUpperCase()} RENDERER</span><span>{data.fps} FPS</span></div>
    </dialog>
  </main></ShipContext>;
}
