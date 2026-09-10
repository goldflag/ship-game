import { PveResults } from './PveResults';
import type { PveRequest } from '../multiplayer/generated/PveRequest';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import { PveSetupDialog } from './PveSetupDialog';
import type { PveDraft } from '../game/session/PveDraft';
import type { Placement } from '../multiplayer/generated/Placement';
import { battleExitLabel } from '../game/session/BattleSession';
import { MultiplayerDialog } from './MultiplayerDialog';
import { RemoteBattleSession } from '../game/session/RemoteBattleSession';
import { Button } from './components';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Game } from '../game/Game';
import { createShipState } from '../simulation/ship';
import { DEFAULT_SETTINGS, type GameSettings, type Telemetry } from '../game/types';
import { Icon } from './Icons';
import { FleetHud } from './FleetHud';
import { BinocularOverlay } from './BinocularOverlay';
import { Garage } from './Garage';
import { selectedShip as initialShip, shipPreset } from '../ships/presets';
import { ShipContext } from './ShipContext';
import { bindingLabel, KEYBINDING_STORAGE_KEY, loadKeybindings, type Keybindings } from '../game/keybindings';
import { BattleSetupDialog } from './BattleSetupDialog';
import { BattleLoadingScreen, type BattleLoadingState } from './BattleLoadingScreen';
import { BATTLE_SPAWN_DISTANCE, type BattleSetup } from '../simulation/battle';
import { SettingsDialog } from './SettingsDialog';
import { GameAudio } from '../game/GameAudio';
import { AUDIO_STORAGE_KEY, loadAudioSettings, type AudioSettings } from '../game/audio';
import { HUD_STORAGE_KEY, loadHudSettings, type HudSettings } from '../game/hudSettings';
import { useHudScale } from './useHudScale';
import './ShipLabels.css';
import './GunAimIndicators.css';
import './HitDirectionIndicators.css';

const INITIAL_TELEMETRY: Telemetry = { ship: createShipState(), order: 1, camera: 'Chase', fps: 0, backend: 'webgpu', trail: [] };
function loadSettings(): GameSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('bismarck-settings') ?? '{}');
    return {
      quality: ['medium', 'high', 'ultra'].includes(saved.quality) ? saved.quality : DEFAULT_SETTINGS.quality,
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
  const [hudSettings, setHudSettings] = useState(loadHudSettings);
  const preferredHudScale = useHudScale(hudSettings);
  const hudScaleRef = useRef(preferredHudScale);
  const audioSettingsRef = useRef(audioSettings);
  const bindingsRef = useRef(bindings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState(INITIAL_TELEMETRY);
  // Fleet command uses responsive panels; keep automatic text at its authored
  // size instead of shrinking an RTS interface to the ship instrument baseline.
  const hudScale = data.fleetCommandMode && hudSettings.mode === 'auto' ? Math.max(hudSettings.scale, preferredHudScale) : preferredHudScale;
  hudScaleRef.current = hudScale;
  const [loading, setLoading] = useState({ label: 'Preparing the harbor', progress: 0 });
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(true);
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const [pveRestarting, setPveRestarting] = useState(false);
  const [pveRequest, setPveRequest] = useState<PveRequest>();
  const [pveBriefing, setPveBriefing] = useState<PveBriefing>();
  const [pveOpen, setPveOpen] = useState(false);
  const [battleSetupOpen, setBattleSetupOpen] = useState(false);
  const [battleSetup, setBattleSetup] = useState<BattleSetup>({ playerShipId: initialShip.id, friendlyBots: [], enemies: [], spawnDistance: BATTLE_SPAWN_DISTANCE, mapId: 'north-atlantic', timeHours: 12, cloudCover: 38, windSpeed: 9 });
  const [battleLoading, setBattleLoading] = useState<BattleLoadingState | null>(null);
  const [battleError, setBattleError] = useState('');
  const battlePending = useRef(false);
  const [phase, setPhase] = useState<'garage' | 'sailing'>('garage');

  useEffect(() => {
    let active = true;
    setPveBriefing(undefined); setPveOpen(false); setBattleSetupOpen(false); setBattleLoading(null); battlePending.current = false;
    setSwitching(false); setSwitchError(''); switchPending.current = false;
    setReady(false); setError(''); setPaused(false); setSettingsOpen(false); setData(INITIAL_TELEMETRY); setPhase('garage');
    const session = new Game(host.current!, settings, {
      progress: (label, progress) => active && setLoading({ label, progress }),
      ready: () => active && setReady(true),
      telemetry: value => {
        if (!active) return;
        setData(value);
        if (session.definition.id !== selectedRef.current.id) { selectedRef.current = session.definition; setSelectedShip(session.definition); }
      },
      pause: value => active && setPaused(value),
      hud: () => active && setHud(value => !value),
      error: message => active && setError(message),
    }, selectedRef.current, new GameAudio(audioSettingsRef.current));
    session.input.setBindings(bindingsRef.current);
    game.current = session;
    session.setHudScale(hudScaleRef.current);
    session.setInPort(true);
    const reviewWindow = window as unknown as {
      shipTrialDiagnostics?: () => unknown;
      shipTrialArticulation?: (pose: Parameters<Game['previewArticulation']>[0]) => unknown;
      shipTrialAdvance?: (seconds: number) => void;
    };
    if (import.meta.env.DEV) {
      reviewWindow.shipTrialDiagnostics = () => session.diagnostics();
      reviewWindow.shipTrialArticulation = pose => session.previewArticulation(pose);
      reviewWindow.shipTrialAdvance = seconds => session.previewAdvance(seconds);
    }
    session.start();
    return () => {
      active = false; game.current = null;
      if (import.meta.env.DEV) { delete reviewWindow.shipTrialDiagnostics; delete reviewWindow.shipTrialArticulation; delete reviewWindow.shipTrialAdvance; }
      void session.dispose();
    };
  }, [generation, settings]);

  useEffect(() => { game.current?.setHudScale(hudScale); }, [hudScale]);

  useEffect(() => {
    if (paused && ready && !error) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error]);

  // Let React unmount the setup dialog before the scene takes focus for aiming.
  // Keep loading visible through the battle's actual render-pass warmup.
  useEffect(() => {
    const session = game.current;
    if (phase !== 'sailing' || !session) return;
    let active = true;
    void session.beginBattle((label, progress) => { if (active && game.current === session) setBattleLoading({ label, progress, leaving: false }); }).then(() => {
      if (active && game.current === session) {
        if (session.simulation instanceof RemoteBattleSession) session.simulation.loadedAssets();
        setBattleLoading(value => value && { label: 'Underway', progress: 1, leaving: true });
      }
    }).catch(error => { if (active && game.current === session) setError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [phase]);

  const openBattleSetup = () => {
    if (!ready || switchPending.current) return;
    setBattleSetup(value => ({ ...value, playerShipId: selectedShip.id }));
    setPveBriefing(undefined); setBattleError(''); setBattleSetupOpen(true);
  };
  const launch = async () => {
    const session = game.current;
    if (!ready || !session || switchPending.current || battlePending.current) return;
    battlePending.current = true; setBattleError('');
    setBattleLoading({ label: 'Preparing the fleets', progress: 0, leaving: false });
    try {
      await session.prepareBattle(battleSetup, (label, progress) => { if (game.current === session) setBattleLoading({ label, progress, leaving: false }); });
      if (game.current !== session) return;
      const definition = shipPreset(battleSetup.playerShipId);
      selectedRef.current = definition; setSelectedShip(definition);
      const url = new URL(window.location.href); url.searchParams.set('ship', definition.id);
      window.history.replaceState(null, '', url);
      setBattleLoading({ label: 'Getting underway', progress: 0.95, leaving: false });
      setBattleSetupOpen(false); setHud(true); setPhase('sailing');
    } catch (error) {
      if (game.current === session) { setBattleLoading(null); setBattleError(error instanceof Error ? error.message : String(error)); }
    } finally {
      if (game.current === session) battlePending.current = false;
    }
  };
  const launchPve = async (draft: PveDraft, placements: Placement[]) => {
    const session = game.current;
    if (!ready || !session || switchPending.current || battlePending.current) throw new Error('The port is still preparing.');
    battlePending.current = true;
    setBattleSetup(value => ({ ...value, mapId: draft.briefing.setup.mapId as BattleSetup['mapId'] }));
    setPveBriefing(draft.briefing); setPveRequest(draft.request);
    setBattleLoading({ label: 'Preparing mission waters', progress: 0, leaving: false });
    try {
      await session.preparePveBattle(draft, placements, (label, progress) => { if (game.current === session) setBattleLoading({ label, progress, leaving: false }); });
      if (game.current !== session) return;
      selectedRef.current = session.definition; setSelectedShip(session.definition);
      setPveOpen(false); setHud(true); setPhase('sailing');
    } catch (error) {
      if (game.current === session) setBattleLoading(null);
      throw error;
    } finally { if (game.current === session) battlePending.current = false; }
  };
  const returnToPort = async () => {
    try { await game.current?.returnToPort(); setPhase('garage'); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const restartPve = async () => {
    const session = game.current;
    if (!session || pveRestarting) return;
    setPveRestarting(true);
    try { await session.restartPveBattle(); }
    finally { setPveRestarting(false); }
  };
  const newPveBattle = async () => {
    const session = game.current;
    if (!session || !pveRequest) throw new Error('The previous mission is unavailable.');
    await session.returnToPort();
    setPveRequest({ ...pveRequest, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    setPhase('garage'); setPveOpen(true);
  };
  const onlineBattle = async (remote: RemoteBattleSession) => {
    const current = game.current;
    if (!current) { remote.surrender(); return; }
    setPveBriefing(undefined);
    const friendly = remote.setup.ships.filter(s => s.team === remote.ownTeam);
    const player = friendly.find(s => s.id === remote.ship.id)!;
    setBattleSetup({ playerShipId: player.presetId, friendlyBots: friendly.filter(s => s !== player).map(s => s.presetId), enemies: remote.setup.ships.filter(s => s.team !== remote.ownTeam).map(s => s.presetId), mapId: remote.mapId, spawnDistance: remote.spawnDistance, ...remote.metadata.environment });
    setBattleLoading({ label: 'Loading the fleets', progress: 0, leaving: false });
    try {
      await current.prepareOnlineBattle(remote, (label, progress) => setBattleLoading({ label, progress, leaving: false }));
      if (current !== game.current) { remote.dispose(); return; }
      selectedRef.current = current.definition; setSelectedShip(current.definition);
      setMultiplayerOpen(false); setHud(true); setPhase('sailing');
    } catch (error) { setBattleLoading(null); remote.surrender(); throw error; }
  };
  const resume = () => {
    dialog.current?.close();
    game.current?.setPaused(false);
    if (phase === 'sailing') game.current?.capturePointer();
  };

  useEffect(() => { document.title = phase === 'sailing' && pveBriefing ? 'Fleet Command — PvE' : `${selectedShip.name} — Custom Battle`; }, [selectedShip, phase, pveBriefing]);

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
  const changeHud = (next: HudSettings): boolean => {
    setHudSettings(next);
    try { localStorage.setItem(HUD_STORAGE_KEY, JSON.stringify(next)); return true; }
    catch { return false; }
  };

  return <ShipContext value={selectedShip}><main className="game-shell" style={{ '--hud-scale': hudScale } as CSSProperties}
    onContextMenu={event => {
      const target = event.target;
      if (!(target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) event.preventDefault();
    }}
    onDragStart={event => {
      const target = event.target;
      if (!(target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) event.preventDefault();
    }}>
    <div ref={host} className="ocean-viewport" inert={!ready || !!error} data-ship-labels={phase === 'sailing' && hud && ready && !error && !data.airOperationsOpen} />
    {phase === 'garage' && ready && !error && !pveOpen && <Garage key={selectedShip.id} switching={switching} switchError={switchError} onSelectShip={switchShip} game={game.current} ready={ready} fps={data.fps} onLaunch={openBattleSetup} onPve={() => { if (pveRequest) setPveRequest({ ...pveRequest, seed: crypto.getRandomValues(new Uint32Array(1))[0] }); setPveOpen(true); }} onMultiplayer={() => setMultiplayerOpen(true)} onSettings={() => game.current?.setPaused(true)}/>}
    {pveOpen && <PveSetupDialog initialRequest={pveRequest} initialShipId={selectedShip.id} loading={!!battleLoading} onLaunch={launchPve} onClose={() => setPveOpen(false)}/>}
    {multiplayerOpen && <MultiplayerDialog loading={!!battleLoading} initialShipId={selectedShip.id} onBattle={onlineBattle} onClose={() => setMultiplayerOpen(false)}/>}
    {battleSetupOpen && !battleLoading && <BattleSetupDialog setup={battleSetup} onChange={setBattleSetup} onLaunch={launch} onClose={() => setBattleSetupOpen(false)} error={battleError}/>}
    {phase === 'sailing' && ready && !error && <><BinocularOverlay data={data}/><div className="hud-viewport">
      <FleetHud key={game.current?.battleRevision} data={data} game={game.current} visible={hud} bindings={bindings}/>
      {!hud && <button className="restore-hud" onClick={() => setHud(true)}>Show instruments <kbd>{bindingLabel(bindings, 'hud')}</kbd></button>}
    </div></>}
    {phase === 'sailing' && ready && !error && game.current?.simulation.missionRules && game.current.simulation.outcome && game.current.simulation.debrief && game.current.simulation.result !== 'active' && <PveResults result={game.current.simulation.result} outcome={game.current.simulation.outcome} debrief={game.current.simulation.debrief} onRestart={restartPve} onNewBattle={newPveBattle} onPort={returnToPort}/>}
    {battleLoading && ready && !error && <BattleLoadingScreen briefing={pveBriefing} setup={battleSetup} state={battleLoading} multiplayer={!!game.current?.simulation.networked} onLeft={() => setBattleLoading(null)}/>}

    {!ready && !error && <section className="startup-screen" aria-labelledby="startup-title">
      <div className="startup-content">
        <h1 id="startup-title">Opening the harbor</h1>
        <p className="startup-status" role="status">{loading.label}…</p>
        <div className="loading-progress" role="progressbar" aria-label="Preparing the harbor" aria-valuetext={loading.label} aria-valuenow={Math.round(loading.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${loading.progress * 100}%` }}/></div>
        <p className="startup-note">The first visit can take a little longer while ship models, ocean effects and lighting are prepared.</p>
      </div>
    </section>}

    {error && <section className="loading-screen" aria-live="polite">
      <div className="loading-brand"><Icon name="anchor" size={36}/><span>FLEET COMMAND</span></div>
      <div className="loading-content"><h1>{selectedShip.name.toUpperCase()}</h1><p className="loading-subtitle">Take the helm.</p><div className="ship-measure"><div/><span>{selectedShip.hull.length} M</span><div/></div>
        <div className="error-message"><h2>Unable to launch the battle</h2><p>{error}</p><p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p><Button variant="primary" onClick={() => setGeneration(value => value + 1)}>Try again <Icon name="arrow" size={18}/></Button></div>
      </div><div className="loading-bottom"><span>SINGLEPLAYER · OPEN OCEAN</span><span>{selectedShip.name.toUpperCase()} / {selectedShip.configuration.match(/19\d{2}/)?.[0]}</span></div>
    </section>}

    <dialog ref={dialog} className={`pause-menu ${settingsOpen ? 'pause-menu-covered' : ''}`} aria-labelledby="pause-title" onCancel={e => { e.preventDefault(); resume(); }}>
      <div className="menu-heading"><h2 id="pause-title">{phase === 'garage' ? 'In port.' : 'Paused'}</h2><Button variant="icon" aria-label={phase === 'garage' ? 'Close menu' : 'Resume battle'} onClick={resume}><Icon name="close"/></Button></div>
      {phase === 'garage' && <p className="menu-description">Prepare for your next voyage.</p>}
      <Button autoFocus variant="primary" onClick={resume}>{phase === 'garage' ? 'Back to port' : 'Resume battle'} <Icon name={phase === 'garage' ? 'anchor' : 'play'} size={18}/></Button>
      {phase === 'sailing' && game.current?.simulation.missionRules && <Button disabled={pveRestarting} variant="secondary" onClick={() => void restartPve().catch(e => setError(e instanceof Error ? e.message : String(e)))}>{pveRestarting ? 'Restarting…' : 'Restart this battle'}</Button>}
      {phase === 'sailing' && <Button variant="secondary" className="restart-button" onClick={() => void returnToPort()}>{battleExitLabel(game.current?.simulation)} <Icon name="anchor" size={18}/></Button>}
      <Button variant="secondary" className="menu-action" onClick={() => setSettingsOpen(true)}>Settings <Icon name="settings" size={18}/></Button>
      <Button variant="secondary" className="menu-action close-game-button" onClick={closeGame}>Close game <Icon name="power" size={18}/></Button>
      {phase === 'sailing' && <div className="menu-controls">
        <span><kbd>{bindingLabel(bindings, 'camera')}</kbd> Change camera</span>
        <span><kbd>{bindingLabel(bindings, 'recenter')}</kbd> Recenter view</span>
        <span><kbd>{bindingLabel(bindings, 'hud')}</kbd> Hide instruments</span>
        <span><kbd>{bindingLabel(bindings, 'fullscreen')}</kbd> Fullscreen</span>
      </div>}
    </dialog>
    {settingsOpen && paused && ready && !error && <SettingsDialog settings={settings} bindings={bindings} audioSettings={audioSettings} hudSettings={hudSettings} hudScale={hudScale} onHudChange={changeHud} onAudioChange={changeAudio} onPreviewSound={id => game.current?.audio?.preview(id)} onBindingsChange={changeBindings} onApply={applySettings} onClose={() => setSettingsOpen(false)}/>}
  </main></ShipContext>;
}
