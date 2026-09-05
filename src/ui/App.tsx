import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import { createShipState } from '../simulation/ship';
import { DEFAULT_SETTINGS, type GameSettings, type Telemetry } from '../game/types';
import { Icon } from './Icons';
import { FleetHud } from './FleetHud';
import { Garage } from './Garage';
import { selectedShip as initialShip, shipPreset } from '../ships/presets';
import { ShipContext } from './ShipContext';
import { bindingLabel, KEYBINDING_STORAGE_KEY, loadKeybindings, type Keybindings } from '../game/keybindings';
import { SettingsDialog } from './SettingsDialog';

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
  const [bindings, setBindings] = useState(loadKeybindings);
  const bindingsRef = useRef(bindings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState(INITIAL_TELEMETRY);
  const [loading, setLoading] = useState({ label: 'Preparing your sea trial', progress: 0 });
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(true);
  const [phase, setPhase] = useState<'garage' | 'sailing'>('garage');

  useEffect(() => {
    if (closed) return;
    let active = true;
    setSwitching(false); setSwitchError(''); switchPending.current = false;
    setReady(false); setError(''); setPaused(false); setSettingsOpen(false); setData(INITIAL_TELEMETRY); setPhase('garage');
    const session = new Game(host.current!, settings, {
      progress: (label, progress) => active && setLoading({ label, progress }),
      ready: () => active && setReady(true),
      telemetry: value => active && setData(value),
      pause: value => active && setPaused(value),
      hud: () => active && setHud(value => !value),
      error: message => active && setError(message),
    }, selectedRef.current);
    session.input.setBindings(bindingsRef.current);
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
  }, [generation, settings, closed]);

  useEffect(() => {
    if (paused && ready && !error && !closed) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error, closed]);

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
  const resume = () => {
    dialog.current?.close();
    game.current?.setPaused(false);
    if (phase === 'sailing') game.current?.capturePointer();
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

  const applySettings = (draft: GameSettings) => {
    setSettingsOpen(false);
    try { localStorage.setItem('bismarck-settings', JSON.stringify(draft)); } catch { /* Storage is optional. */ }
    if (JSON.stringify(settings) === JSON.stringify(draft)) setGeneration(value => value + 1);
    else setSettings({ ...draft });
  };

  const changeBindings = (next: Keybindings): boolean => {
    bindingsRef.current = next;
    setBindings(next);
    game.current?.input.setBindings(next);
    try { localStorage.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(next)); return true; }
    catch { return false; }
  };
  const closeGame = () => {
    game.current?.setPaused(true);
    setSettingsOpen(false);
    setClosed(true);
    // Browsers may refuse to close a tab they did not open. The closed state
    // still unmounts the session and releases its renderer and input listeners.
    try { window.close(); } catch { /* The exit screen remains available. */ }
  };

  if (closed) return <main className="game-exit">
    <Icon name="anchor" size={36}/><h1>Game closed</h1>
    <p>You can close this tab. Your settings and keybindings are kept in this browser.</p>
    <button className="primary-button" onClick={() => window.location.reload()}>Launch game <Icon name="play" size={18}/></button>
  </main>;

  return <ShipContext value={selectedShip}><main className="game-shell">
    <div ref={host} className="ocean-viewport" />
    {phase === 'garage' && !error && <Garage key={selectedShip.id} switching={switching} switchError={switchError} onSelectShip={switchShip} game={game.current} ready={ready} progress={loading.progress} fps={data.fps} onLaunch={launch} onSettings={() => game.current?.setPaused(true)}/>}
    {phase === 'sailing' && ready && !error && <FleetHud data={data} game={game.current} visible={hud} bindings={bindings}/>}

    {phase === 'sailing' && ready && !hud && <button className="restore-hud" onClick={() => setHud(true)}>Show instruments <kbd>{bindingLabel(bindings, 'hud')}</kbd></button>}

    {((!ready && phase === 'sailing') || error) && <section className="loading-screen" aria-live="polite">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>SEA TRIALS</span></div>
      <div className="loading-content"><h1>{selectedShip.name.toUpperCase()}</h1><p className="loading-subtitle">Take the helm.</p><div className="ship-measure"><div/><span>{selectedShip.hull.length} M</span><div/></div>
        {error ? <div className="error-message"><h2>Unable to launch the sea trial</h2><p>{error}</p><p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p><button className="primary-button" onClick={() => setGeneration(value => value + 1)}>Try again <Icon name="arrow" size={18}/></button></div> : <><div className="loading-progress" role="progressbar" aria-label="Loading sea trial" aria-valuenow={Math.round(loading.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${loading.progress * 100}%` }}/></div><div className="loading-status"><span>{loading.label}</span><span>{Math.round(loading.progress * 100)}%</span></div><p className="compile-note">The first launch prepares the ocean and cloud shaders.</p></>}
      </div><div className="loading-bottom"><span>SINGLEPLAYER · OPEN OCEAN</span><span>{selectedShip.name.toUpperCase()} / {selectedShip.configuration.match(/19\d{2}/)?.[0]}</span></div>
    </section>}

    <dialog ref={dialog} className={`pause-menu ${settingsOpen ? 'pause-menu-covered' : ''}`} aria-labelledby="pause-title" onCancel={e => { e.preventDefault(); resume(); }}>
      <div className="menu-heading"><h2 id="pause-title">{phase === 'garage' ? 'In port.' : 'At your command.'}</h2><button className="icon-button" aria-label={phase === 'garage' ? 'Close menu' : 'Resume sailing'} onClick={resume}><Icon name="close"/></button></div>
      <p className="menu-description">{phase === 'garage' ? 'Prepare the sea conditions for your next voyage.' : 'Sea trial paused. Your engine order is held.'}</p>
      <button autoFocus className="primary-button" onClick={resume}>{phase === 'garage' ? 'Back to port' : 'Resume sailing'} <Icon name={phase === 'garage' ? 'anchor' : 'play'} size={18}/></button>
      {phase === 'sailing' && <button className="secondary-button restart-button" onClick={returnToPort}>Return to port <Icon name="anchor" size={18}/></button>}
      <button className="secondary-button menu-action" onClick={() => setSettingsOpen(true)}>Settings <Icon name="settings" size={18}/></button>
      <button className="secondary-button menu-action close-game-button" onClick={closeGame}>Close game <Icon name="power" size={18}/></button>
      {phase === 'sailing' && <div className="menu-controls">
        <span><kbd>{bindingLabel(bindings, 'camera')}</kbd> Change camera</span>
        <span><kbd>{bindingLabel(bindings, 'recenter')}</kbd> Recenter view</span>
        <span><kbd>{bindingLabel(bindings, 'hud')}</kbd> Hide instruments</span>
        <span><kbd>{bindingLabel(bindings, 'fullscreen')}</kbd> Fullscreen</span>
      </div>}
    </dialog>
    {settingsOpen && paused && ready && !error && <SettingsDialog settings={settings} bindings={bindings} onBindingsChange={changeBindings} onApply={applySettings} onClose={() => setSettingsOpen(false)}/>}
  </main></ShipContext>;
}
