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
import { BattleSetupDialog } from './BattleSetupDialog';
import { BATTLE_SPAWN_DISTANCE, type BattleSetup } from '../simulation/battle';
import { SettingsDialog } from './SettingsDialog';
import { GameAudio } from '../game/GameAudio';
import { AUDIO_STORAGE_KEY, loadAudioSettings, type AudioSettings } from '../game/audio';
import './ShipLabels.css';
import './GunAimIndicators.css';
import './HitDirectionIndicators.css';

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
  const [audioSettings, setAudioSettings] = useState(loadAudioSettings);
  const audioSettingsRef = useRef(audioSettings);
  const bindingsRef = useRef(bindings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState(INITIAL_TELEMETRY);
  const [loading, setLoading] = useState({ label: 'Preparing the harbor', progress: 0 });
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(true);
  const [battleSetupOpen, setBattleSetupOpen] = useState(false);
  const [battleSetup, setBattleSetup] = useState<BattleSetup>({ playerShipId: initialShip.id, friendlyBots: [], enemies: ['bismarck'], spawnDistance: BATTLE_SPAWN_DISTANCE });
  const [battleLoading, setBattleLoading] = useState(false);
  const [battleError, setBattleError] = useState('');
  const battlePending = useRef(false);
  const [phase, setPhase] = useState<'garage' | 'sailing'>('garage');

  useEffect(() => {
    let active = true;
    setBattleSetupOpen(false); setBattleLoading(false); battlePending.current = false;
    setSwitching(false); setSwitchError(''); switchPending.current = false;
    setReady(false); setError(''); setPaused(false); setSettingsOpen(false); setData(INITIAL_TELEMETRY); setPhase('garage');
    const session = new Game(host.current!, settings, {
      progress: (label, progress) => active && setLoading({ label, progress }),
      ready: () => active && setReady(true),
      telemetry: value => active && setData(value),
      pause: value => active && setPaused(value),
      hud: () => active && setHud(value => !value),
      error: message => active && setError(message),
    }, selectedRef.current, new GameAudio(audioSettingsRef.current));
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
  }, [generation, settings]);

  useEffect(() => {
    if (paused && ready && !error) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error]);

  // Let React unmount the setup dialog before the scene takes focus for aiming.
  useEffect(() => { if (phase === 'sailing') game.current?.setInPort(false); }, [phase]);

  const openBattleSetup = () => {
    if (!ready || switchPending.current) return;
    setBattleSetup(value => ({ ...value, playerShipId: selectedShip.id }));
    setBattleError(''); setBattleSetupOpen(true);
  };
  const launch = async () => {
    const session = game.current;
    if (!ready || !session || switchPending.current || battlePending.current) return;
    battlePending.current = true; setBattleLoading(true); setBattleError('');
    try {
      await session.prepareBattle(battleSetup);
      if (game.current !== session) return;
      const definition = shipPreset(battleSetup.playerShipId);
      selectedRef.current = definition; setSelectedShip(definition);
      const url = new URL(window.location.href); url.searchParams.set('ship', definition.id);
      window.history.replaceState(null, '', url);
      setBattleSetupOpen(false); setHud(true); setPhase('sailing');
    } catch (error) {
      if (game.current === session) setBattleError(error instanceof Error ? error.message : String(error));
    } finally {
      if (game.current === session) { battlePending.current = false; setBattleLoading(false); }
    }
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

  useEffect(() => { document.title = `${selectedShip.name} — Custom Battle`; }, [selectedShip]);

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
  const changeAudio = (next: AudioSettings): boolean => {
    audioSettingsRef.current = next; setAudioSettings(next);
    game.current?.audio?.applySettings(next);
    try { localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(next)); return true; }
    catch { return false; }
  };
  const closeGame = () => {
    window.close();
  };

  return <ShipContext value={selectedShip}><main className="game-shell">
    <div ref={host} className="ocean-viewport" inert={!ready || !!error} data-ship-labels={phase === 'sailing' && hud && ready && !error} />
    {phase === 'garage' && ready && !error && <Garage key={selectedShip.id} switching={switching} switchError={switchError} onSelectShip={switchShip} game={game.current} ready={ready} fps={data.fps} onLaunch={openBattleSetup} onSettings={() => game.current?.setPaused(true)}/>}
    {battleSetupOpen && <BattleSetupDialog setup={battleSetup} onChange={setBattleSetup} onLaunch={launch} onClose={() => setBattleSetupOpen(false)} loading={battleLoading} error={battleError}/>}
    {phase === 'sailing' && ready && !error && <FleetHud data={data} game={game.current} visible={hud} bindings={bindings}/>}

    {phase === 'sailing' && ready && !hud && <button className="restore-hud" onClick={() => setHud(true)}>Show instruments <kbd>{bindingLabel(bindings, 'hud')}</kbd></button>}

    {!ready && !error && <section className="loading-screen loading-screen-minimal">
      <div className="loading-progress" role="progressbar" aria-label="Loading port" aria-valuetext={loading.label} aria-valuenow={Math.round(loading.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${loading.progress * 100}%` }}/></div>
    </section>}

    {error && <section className="loading-screen" aria-live="polite">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>FLEET COMMAND</span></div>
      <div className="loading-content"><h1>{selectedShip.name.toUpperCase()}</h1><p className="loading-subtitle">Take the helm.</p><div className="ship-measure"><div/><span>{selectedShip.hull.length} M</span><div/></div>
        <div className="error-message"><h2>Unable to launch the battle</h2><p>{error}</p><p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p><button className="primary-button" onClick={() => setGeneration(value => value + 1)}>Try again <Icon name="arrow" size={18}/></button></div>
      </div><div className="loading-bottom"><span>SINGLEPLAYER · OPEN OCEAN</span><span>{selectedShip.name.toUpperCase()} / {selectedShip.configuration.match(/19\d{2}/)?.[0]}</span></div>
    </section>}

    <dialog ref={dialog} className={`pause-menu ${settingsOpen ? 'pause-menu-covered' : ''}`} aria-labelledby="pause-title" onCancel={e => { e.preventDefault(); resume(); }}>
      <div className="menu-heading"><h2 id="pause-title">{phase === 'garage' ? 'In port.' : 'At your command.'}</h2><button className="icon-button" aria-label={phase === 'garage' ? 'Close menu' : 'Resume battle'} onClick={resume}><Icon name="close"/></button></div>
      <p className="menu-description">{phase === 'garage' ? 'Prepare the sea conditions for your next voyage.' : 'Battle paused. Your engine order is held.'}</p>
      <button autoFocus className="primary-button" onClick={resume}>{phase === 'garage' ? 'Back to port' : 'Resume battle'} <Icon name={phase === 'garage' ? 'anchor' : 'play'} size={18}/></button>
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
    {settingsOpen && paused && ready && !error && <SettingsDialog settings={settings} bindings={bindings} audioSettings={audioSettings} onAudioChange={changeAudio} onPreviewSound={id => game.current?.audio?.preview(id)} onBindingsChange={changeBindings} onApply={applySettings} onClose={() => setSettingsOpen(false)}/>}
  </main></ShipContext>;
}
