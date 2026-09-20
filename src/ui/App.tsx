import { savedReference } from '../ships/constructionCloud';
import { BattleEndNotice } from './BattleEndNotice';
import { AfterActionReport, type ReportAction } from './report/AfterActionReport';
import type { PveRequest } from '../multiplayer/generated/PveRequest';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import type { PveDraft } from '../game/session/PveDraft';
import type { Placement } from '../multiplayer/generated/Placement';
import { battleExitLabel } from '../game/session/BattleSession';
import { RemoteBattleSession } from '../game/session/RemoteBattleSession';
import { Button } from './components';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Game } from '../game/Game';
import { createShipState } from '../game/session/motion';
import type { Telemetry } from '../game/types';
import { GRAPHICS_STORAGE_KEY, launchMatches, loadGraphicsSettings, type GraphicsSettings } from '../game/graphicsSettings';
import { Icon } from './Icons';
import { FleetHud } from './FleetHud';
import { fleetDesk, type FleetDesk } from './fleet/fleetDesk';
import { BinocularOverlay } from './BinocularOverlay';
import { Garage } from './Garage';
import type { AccountSession } from './AccountGate';
import { STARTUP_INITIAL, StartupScreen, type StartupReporter } from './StartupScreen';
import { selectedShip as initialShip, loadShipPresets } from '../ships/presets';
import { ShipContext } from './ShipContext';
import { bindingLabel, KEYBINDING_STORAGE_KEY, loadKeybindings, type Keybindings } from '../game/keybindings';
import { BattleDialog } from './battle/BattleDialog';
import { loadBattleMode, loadSkipSortieBoard, type BattleMode } from './battle/battleModes';
import { SortieBoard } from './battle/SortieBoard';
import { BattleLoadingScreen, type BattleLoadingState } from './BattleLoadingScreen';
import { SettingsDialog } from './SettingsDialog';
import { GameAudio } from '../game/GameAudio';
import { AUDIO_STORAGE_KEY, loadAudioSettings, type AudioSettings } from '../game/audio';
import { HUD_STORAGE_KEY, loadHudSettings, type HudSettings } from '../game/hudSettings';
import { useHudScale } from './useHudScale';
import './ShipLabels.css';
import './GunAimIndicators.css';
import './TorpedoIndicators.css';
import './HitDirectionIndicators.css';
import { Shipbuilder, type ConstructionEditorHandle } from './shipbuilding/Shipbuilder';
import { openConstructionRepository } from '../ships/constructionRepository';
declare global {
  interface Window {
    constructionEditor?: ConstructionEditorHandle;
  }
}
import { TrialControls } from './shipbuilding/TrialControls';
import { DevConsole } from './DevConsole';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ConstructionSuggestion } from '../ships/blueprint';
import { loadConstructionCatalog } from '../ships/constructionEquipment';
import { isLocalShipId, localShips, registerLocalShip, removeLocalShip, resolveShip, shipTitle } from '../ships/localShips';
import { restoreLocalShips } from '../ships/constructionLibrary';
import { ConstructionClient } from '../ships/constructionClient';
import { openConstructionStore } from '../ships/constructionStore';
import { decodeConstructionSource, loadSavedConstructionWithCatalog } from '../ships/constructionEditor';
import { createStarterSource } from '../ships/constructionStarter';
import { BATTLE_SPAWN_DISTANCE, type BattleSetup } from '../game/session/battleSetup';
import { NewDesignDialog } from './shipbuilding/NewDesignDialog';
import type { HullPresetChoice } from '../ships/constructionHullPresets';

/** The port berths only the player's designs. A `?ship=` link keeps a historical preset alongside for review and diagnostics. */
const PINNED_SHIP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ship');

const INITIAL_TELEMETRY: Telemetry = { ship: createShipState(), order: 1, camera: 'Chase', fps: 0, backend: 'webgpu', trail: [] };

type AppProps = { account?: AccountSession; startup?: StartupReporter };
export function App(props: AppProps) {
  const admissionReporter = useRef(props.startup);
  admissionReporter.current = props.startup;
  const [attempt, setAttempt] = useState(0);
  const [admission, setAdmission] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let active = true;
    setAdmission('loading');
    admissionReporter.current?.progress('Loading ship', STARTUP_INITIAL.progress);
    loadShipPresets([initialShip.id]).then(
      () => {
        if (active) setAdmission('ready');
      },
      () => {
        if (active) {
          setAdmission('failed');
          admissionReporter.current?.done();
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (admission === 'ready') return <Harbor {...props} />;
  if (admission === 'loading') return props.startup ? null : <StartupScreen label="Loading ship" progress={STARTUP_INITIAL.progress} />;
  return (
    <main className="account-screen">
      <section className="account-form">
        <h1>Fleet Command</h1>
        <p role="alert">Unable to load the selected ship. Check your connection and retry.</p>
        <button className="account-primary" onClick={() => setAttempt((value) => value + 1)}>
          Retry loading ship
        </button>
      </section>
    </main>
  );
}

function Harbor({ account, startup }: AppProps) {
  const [selectedShip, setSelectedShip] = useState(initialShip);
  const selectedRef = useRef(selectedShip);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const switchPending = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  // The HUD never holds the Game: it reads the frame and issues orders through the desk built over it once.
  const desk = useRef<FleetDesk | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [graphics, setGraphics] = useState(loadGraphicsSettings);
  const graphicsRef = useRef(graphics);
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
  const hudScale =
    data.fleetCommandMode && hudSettings.mode === 'auto' ? Math.max(hudSettings.scale, preferredHudScale) : preferredHudScale;
  hudScaleRef.current = hudScale;
  const [loading, setLoading] = useState(STARTUP_INITIAL);
  // When a parent owns the startup loader, mirror progress to it directly from the game callbacks
  // rather than through an effect, so the bar advances in the same frame the game reports.
  const startupRef = useRef(startup);
  startupRef.current = startup;
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [hud, setHud] = useState(true);
  const [pveRestarting, setPveRestarting] = useState(false);
  const [pveRequest, setPveRequest] = useState<PveRequest>();
  const [pveBriefing, setPveBriefing] = useState<PveBriefing>();
  const [battleOpen, setBattleOpen] = useState(false);
  const [sortieOpen, setSortieOpen] = useState(false);
  const [battleMode, setBattleMode] = useState<BattleMode>(loadBattleMode);
  const [battleSetup, setBattleSetup] = useState<BattleSetup>({
    playerShipId: initialShip.id,
    friendlyBots: [],
    enemies: [],
    spawnDistance: BATTLE_SPAWN_DISTANCE,
    mapId: 'north-atlantic',
    timeHours: 12,
    cloudCover: 38,
    windSpeed: 9,
  });
  const [battleLoading, setBattleLoading] = useState<BattleLoadingState | null>(null);
  const [battleError, setBattleError] = useState('');
  const battlePending = useRef(false);
  const [phase, setPhase] = useState<'garage' | 'sailing'>('garage');
  const [builder, setBuilder] = useState<{ catalog: ConstructionCatalog; source?: ConstructionSource; repositoryId?: string } | null>(null);
  const repositoryId = useRef<string | undefined>(undefined);
  const repositoryOpened = useRef(false);
  const builderSource = useRef<ConstructionSource | undefined>(undefined);
  const [builderError, setBuilderError] = useState('');
  const [builderOpening, setBuilderOpening] = useState(false);
  const builderRequest = useRef<string | undefined>(undefined);
  const builderStarter = useRef<HullPresetChoice>('blank');
  const [newDesignOpen, setNewDesignOpen] = useState(false);
  const [newDesignChoice, setNewDesignChoice] = useState<HullPresetChoice>();
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [trial, setTrial] = useState(false);

  useEffect(() => {
    let active = true;
    setPveBriefing(undefined);
    setBattleOpen(false);
    setSortieOpen(false);
    setBattleLoading(null);
    battlePending.current = false;
    setSwitching(false);
    setSwitchError('');
    switchPending.current = false;
    setReady(false);
    setError('');
    setPaused(false);
    setSettingsOpen(false);
    setData(INITIAL_TELEMETRY);
    setPhase('garage');
    const report = (label: string, progress: number) => {
      setLoading({ label, progress });
      startupRef.current?.progress(label, progress);
    };
    report(STARTUP_INITIAL.label, STARTUP_INITIAL.progress);
    const session = new Game(
      host.current!,
      graphicsRef.current,
      {
        progress: (label, progress) => active && report(label, progress),
        ready: () => {
          if (!active) return;
          setReady(true);
          startupRef.current?.done();
        },
        telemetry: (value) => {
          if (!active) return;
          setData(value);
          if (session.definition.id !== selectedRef.current.id) {
            selectedRef.current = session.definition;
            setSelectedShip(session.definition);
          }
        },
        pause: (value) => active && setPaused(value),
        hud: () => active && setHud((value) => !value),
        error: (message) => {
          if (!active) return;
          setError(message);
          startupRef.current?.done();
        },
      },
      selectedRef.current,
      new GameAudio(audioSettingsRef.current),
    );
    session.input.setBindings(bindingsRef.current);
    game.current = session;
    desk.current = fleetDesk(session);
    session.setHudScale(hudScaleRef.current);
    session.setInPort(true);
    const reviewWindow = window as unknown as {
      shipTrialDiagnostics?: () => unknown;
      shipTrialArticulation?: (pose: Parameters<Game['previewArticulation']>[0]) => unknown;
    };
    if (import.meta.env.DEV) {
      reviewWindow.shipTrialDiagnostics = () => session.diagnostics();
      reviewWindow.shipTrialArticulation = (pose) => session.previewArticulation(pose);
    }
    session.start();
    return () => {
      active = false;
      game.current = null;
      desk.current = null;
      if (import.meta.env.DEV) {
        delete reviewWindow.shipTrialDiagnostics;
        delete reviewWindow.shipTrialArticulation;
      }
      void session.dispose();
    };
  }, [generation]);

  useEffect(() => {
    game.current?.setHudScale(hudScale);
  }, [hudScale]);

  // Until one of the player's own designs is alongside, the quay stands empty rather than showing a preset.
  const berthEmpty = !PINNED_SHIP && !isLocalShipId(selectedShip.id);
  useEffect(() => {
    game.current?.setPortBerthEmpty(berthEmpty);
  }, [berthEmpty, generation]);

  useEffect(() => {
    if (paused && ready && !error && !builder) dialog.current?.showModal();
    else dialog.current?.close();
  }, [paused, ready, error, builder]);

  useEffect(() => {
    if (builder) game.current?.input.setEnabled(false);
  }, [builder]);

  useEffect(() => {
    if (!ready || builder || phase !== 'garage') return;
    const abort = new AbortController();
    setLibraryLoading(true);
    void restoreLocalShips(abort.signal)
      .catch((error) => {
        if (!abort.signal.aborted)
          setBuilderError(`Saved ships could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLibraryLoading(false);
      });
    return () => abort.abort();
  }, [ready, !!builder, phase]);

  // Let React unmount the setup dialog before the scene takes focus for aiming.
  // Keep loading visible through the battle's actual render-pass warmup.
  useEffect(() => {
    const session = game.current;
    if (phase !== 'sailing' || !session) return;
    let active = true;
    void session
      .beginBattle((label, progress) => {
        if (active && game.current === session) setBattleLoading({ label, progress, leaving: false });
      })
      .then(() => {
        if (active && game.current === session) {
          if (session.simulation instanceof RemoteBattleSession) session.simulation.loadedAssets();
          setBattleLoading((value) => value && { label: 'Underway', progress: 1, leaving: true });
        }
      })
      .catch((error) => {
        if (active && game.current === session) setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [phase]);

  const openBattle = (mode: BattleMode = loadBattleMode()) => {
    if (!ready || switchPending.current) return;
    setBattleSetup((value) => ({ ...value, playerShipId: selectedShip.id }));
    if (pveRequest) setPveRequest({ ...pveRequest, seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    setPveBriefing(undefined);
    setBattleError('');
    setBattleMode(mode);
    setSortieOpen(false);
    setBattleOpen(true);
    void restoreLocalShips().catch((error) =>
      setBattleError(`Saved ships could not be loaded: ${error instanceof Error ? error.message : String(error)}`),
    );
  };
  /** The sortie board explains the modes before setup. Players who have made up their mind can skip it. */
  const openSortieBoard = () => {
    if (ready && !switchPending.current) setSortieOpen(true);
  };
  const pressBattle = () => {
    if (loadSkipSortieBoard()) openBattle();
    else openSortieBoard();
  };
  const launch = async () => {
    const session = game.current;
    if (!ready || !session || switchPending.current || battlePending.current) return;
    battlePending.current = true;
    setBattleError('');
    setBattleLoading({ label: 'Preparing the fleets', progress: 0, leaving: false });
    try {
      await session.prepareBattle(battleSetup, (label, progress) => {
        if (game.current === session) setBattleLoading({ label, progress, leaving: false });
      });
      if (game.current !== session) return;
      const definition = resolveShip(battleSetup.playerShipId);
      selectedRef.current = definition;
      setSelectedShip(definition);
      const url = new URL(window.location.href);
      if (PINNED_SHIP && !definition.id.startsWith('local-')) url.searchParams.set('ship', definition.id);
      window.history.replaceState(null, '', url);
      setBattleLoading({ label: 'Getting underway', progress: 0.95, leaving: false });
      setTrial(false);
      setBattleOpen(false);
      setHud(true);
      setPhase('sailing');
    } catch (error) {
      if (game.current === session) {
        setBattleLoading(null);
        setBattleError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (game.current === session) battlePending.current = false;
    }
  };
  const launchPve = async (draft: PveDraft, placements: Placement[]) => {
    const session = game.current;
    if (!ready || !session || switchPending.current || battlePending.current) throw new Error('The port is still preparing.');
    battlePending.current = true;
    setBattleSetup((value) => ({ ...value, mapId: draft.briefing.setup.mapId as BattleSetup['mapId'] }));
    setPveBriefing(draft.briefing);
    setPveRequest(draft.request);
    setBattleLoading({ label: 'Preparing mission waters', progress: 0, leaving: false });
    try {
      await session.preparePveBattle(draft, placements, (label, progress) => {
        if (game.current === session) setBattleLoading({ label, progress, leaving: false });
      });
      if (game.current !== session) return;
      selectedRef.current = session.definition;
      setSelectedShip(session.definition);
      setBattleOpen(false);
      setHud(true);
      setPhase('sailing');
    } catch (error) {
      if (game.current === session) setBattleLoading(null);
      throw error;
    } finally {
      if (game.current === session) battlePending.current = false;
    }
  };
  const returnToPort = async () => {
    try {
      const wasTrial = trial;
      const online = game.current?.simulation.networked;
      await game.current?.returnToPort();
      setPhase('garage');
      setTrial(false);
      if (online && game.current)
        setBattleSetup((previous) => ({ ...previous, playerShipId: game.current!.definition.id, friendlyBots: [], enemies: [] }));
      if (game.current) {
        selectedRef.current = game.current.definition;
        setSelectedShip(game.current.definition);
      }
      if (wasTrial && builderSource.current)
        setBuilder({
          source: builderSource.current,
          catalog: await loadConstructionCatalog(builderSource.current.construction.catalogRevision),
          repositoryId: repositoryId.current,
        });
      // Ocean and terrain rows chosen during the battle need a rebuilt port.
      if (game.current && !launchMatches(game.current.launchedGraphics, graphicsRef.current)) setGeneration((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const openBuilder = async (designId?: string, starter: HullPresetChoice = 'blank', paint?: string) => {
    if (!ready || builderOpening || switchPending.current || phase !== 'garage')
      return 'The port is still preparing. Try again in a moment.';
    builderStarter.current = starter;
    builderRequest.current = designId;
    repositoryId.current = undefined;
    setBuilderOpening(true);
    setBuilderError('');
    try {
      if (designId) {
        const store = await openConstructionStore();
        try {
          const loaded = await loadSavedConstructionWithCatalog(store, designId);
          builderSource.current = loaded.source;
          setBuilder({ source: loaded.source, catalog: loaded.catalog });
        } finally {
          store.close();
        }
      } else {
        const catalog = await loadConstructionCatalog(),
          source = createStarterSource(catalog, starter, paint);
        builderSource.current = source;
        setBuilder({ source, catalog });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBuilderError(message);
      return message;
    } finally {
      setBuilderOpening(false);
    }
  };
  useEffect(() => {
    const id = import.meta.env.DEV ? new URLSearchParams(location.search).get('construction') : null;
    if (!ready || !id || repositoryOpened.current) return;
    repositoryOpened.current = true;
    setBuilderOpening(true);
    void (async () => {
      const store = await openConstructionRepository();
      try {
        const loaded = await loadSavedConstructionWithCatalog(store, id);
        repositoryId.current = id;
        builderSource.current = loaded.source;
        const trialKey = new URLSearchParams(location.search).get('constructionTrial');
        if (trialKey) {
          const savedDraft = sessionStorage.getItem('construction-trial.' + trialKey);
          if (!savedDraft) throw new Error('Trial draft is unavailable. Reopen the repository editor and launch again.');
          const draft = decodeConstructionSource(JSON.parse(savedDraft));
          if (draft.id !== id) throw new Error('Trial draft belongs to another ship.');
          const client = new ConstructionClient();
          try {
            await launchTrial(draft, await client.compile(draft));
            sessionStorage.removeItem('construction-trial.' + trialKey);
            const url = new URL(location.href);
            url.searchParams.delete('constructionTrial');
            history.replaceState(null, '', url);
          } finally {
            client.dispose();
          }
        } else setBuilder({ source: loaded.source, catalog: loaded.catalog, repositoryId: id });
      } finally {
        store.close();
      }
    })()
      .catch((error) => {
        setBuilderError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBuilderOpening(false));
  }, [ready]);
  const launchTrial = async (source: ConstructionSource, result: ConstructionResult) => {
    const session = game.current;
    if (!session || battlePending.current) throw new Error('The harbor is still preparing.');
    const revision = registerLocalShip(source, result);
    const setup: BattleSetup = {
      playerShipId: revision.definition.id,
      friendlyBots: [],
      enemies: [{ shipId: 'liberty-cargo', aiLevel: 'easy' }],
      spawnDistance: 2500,
      mapId: 'north-atlantic',
      timeHours: 12,
      cloudCover: 10,
      windSpeed: 9,
    };
    battlePending.current = true;
    setPveBriefing(undefined);
    setBattleSetup(setup);
    setBattleLoading({ label: 'Preparing sea trial', progress: 0, leaving: false });
    try {
      await session.prepareBattle(setup, (label, progress) => setBattleLoading({ label, progress, leaving: false }), true);
      if (game.current !== session) return;
      builderSource.current = revision.source;
      setBuilder(null);
      setTrial(true);
      selectedRef.current = revision.definition;
      setSelectedShip(revision.definition);
      setHud(true);
      setPhase('sailing');
    } catch (error) {
      setBattleLoading(null);
      throw error;
    } finally {
      battlePending.current = false;
    }
  };
  const suggestLayout = async (source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion> => {
    const client = new ConstructionClient();
    try {
      return await client.suggest(source, partIds, signal);
    } finally {
      client.dispose();
    }
  };
  const restartPve = async () => {
    const session = game.current;
    if (!session || pveRestarting) return;
    setPveRestarting(true);
    try {
      await session.restartPveBattle();
    } finally {
      setPveRestarting(false);
    }
  };
  const onlineBattle = async (remote: RemoteBattleSession) => {
    const current = game.current;
    if (!current) {
      remote.surrender();
      return;
    }
    setPveBriefing(undefined);
    const friendly = remote.setup.ships.filter((s) => s.team === remote.ownTeam);
    const player = friendly.find((s) => s.id === remote.ship.id)!;
    setBattleSetup({
      playerShipId: player.presetId,
      friendlyBots: friendly.filter((s) => s !== player).map((s) => s.presetId),
      enemies: remote.setup.ships.filter((s) => s.team !== remote.ownTeam).map((s) => s.presetId),
      mapId: remote.mapId,
      spawnDistance: remote.spawnDistance,
      ...remote.metadata.environment,
    });
    setBattleLoading({ label: 'Loading the fleets', progress: 0, leaving: false });
    try {
      await current.prepareOnlineBattle(remote, (label, progress) => setBattleLoading({ label, progress, leaving: false }));
      if (current !== game.current) {
        remote.dispose();
        return;
      }
      selectedRef.current = current.definition;
      setSelectedShip(current.definition);
      setBattleOpen(false);
      setHud(true);
      setPhase('sailing');
    } catch (error) {
      setBattleLoading(null);
      remote.surrender();
      throw error;
    }
  };
  const resume = () => {
    dialog.current?.close();
    game.current?.setPaused(false);
    if (phase === 'sailing') game.current?.capturePointer();
  };

  useEffect(() => {
    document.title =
      phase === 'sailing' && pveBriefing
        ? 'Fleet Command — PvE'
        : phase === 'garage' && berthEmpty
          ? 'Home port'
          : `${selectedShip.name} — Custom Battle`;
  }, [selectedShip, phase, pveBriefing, berthEmpty]);

  const switchShip = async (id: string) => {
    const session = game.current;
    if (!ready || phase !== 'garage' || !session || switchPending.current) return;
    switchPending.current = true;
    setSwitching(true);
    setSwitchError('');
    try {
      await loadShipPresets([id]);
      const definition = resolveShip(id);
      await session.switchShip(definition);
      if (game.current !== session) return;
      selectedRef.current = definition;
      setSelectedShip(definition);
      const url = new URL(window.location.href);
      if (PINNED_SHIP && !definition.id.startsWith('local-')) url.searchParams.set('ship', definition.id);
      else url.searchParams.delete('ship');
      window.history.replaceState(null, '', url);
    } catch (error) {
      if (game.current === session) setSwitchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (game.current === session) {
        switchPending.current = false;
        setSwitching(false);
      }
    }
  };

  const deletedDesign = (designId: string) => {
    const ship = localShips().find((ship) => ship.source.id === designId || savedReference(ship.source.id)?.designId === designId);
    removeLocalShip(ship?.source.id ?? designId);
    if (builderSource.current?.id === (ship?.source.id ?? designId)) builderSource.current = undefined;
    if (!ship) return;
    const id = ship.definition.id;
    setBattleSetup((setup) => ({
      ...setup,
      playerShipId: setup.playerShipId === id ? initialShip.id : setup.playerShipId,
      friendlyBots: setup.friendlyBots.filter((bot) => (typeof bot === 'string' ? bot : bot.shipId) !== id),
      enemies: setup.enemies.filter((bot) => (typeof bot === 'string' ? bot : bot.shipId) !== id),
    }));
    if (selectedRef.current.id === id) void switchShip(initialShip.id);
  };

  const closeBuilder = async (source: ConstructionSource, result?: ConstructionResult) => {
    const session = game.current;
    builderSource.current = source;
    if (!result) {
      const compiler = new ConstructionClient();
      try {
        result = await compiler.compile(source);
      } finally {
        compiler.dispose();
      }
    }
    if (!session || game.current !== session) return;
    if (result?.definition && !result.diagnostics.some((item) => item.severity === 'error')) {
      const ship = registerLocalShip(source, result);
      await switchShip(ship.definition.id);
    }
    setBuilder(null);
    game.current?.input.setEnabled(true);
  };

  const changeGraphics = (next: GraphicsSettings): boolean => {
    graphicsRef.current = next;
    setGraphics(next);
    game.current?.applyGraphics(next);
    try {
      localStorage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };
  const reloadPort = () => {
    setSettingsOpen(false);
    setGeneration((value) => value + 1);
  };

  const changeBindings = (next: Keybindings): boolean => {
    bindingsRef.current = next;
    setBindings(next);
    game.current?.input.setBindings(next);
    try {
      localStorage.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };
  const changeAudio = (next: AudioSettings): boolean => {
    audioSettingsRef.current = next;
    setAudioSettings(next);
    game.current?.audio?.applySettings(next);
    try {
      localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };
  const closeGame = () => {
    window.close();
  };
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const signOut = async () => {
    if (!account) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      await account.signOut();
    } catch {
      setSignOutError('Could not sign out. Retry when connected.');
    } finally {
      setSigningOut(false);
    }
  };
  const changeHud = (next: HudSettings): boolean => {
    setHudSettings(next);
    try {
      localStorage.setItem(HUD_STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  };

  const battleOver = phase === 'sailing' && ready && !error && !battleLoading && !pveRestarting && !trial && data.combat && data.combat.result !== 'active' ? data.combat.result : undefined;
  // An interrupted or abandoned battle has nothing to report; it keeps the short notice and its countdown.
  const ended = battleOver ? game.current?.simulation : undefined;
  const report = ended && !['infrastructure', 'abandoned'].includes(data.combat?.outcome?.reason ?? '') ? ended.debrief : undefined;
  const reportActions: ReportAction[] = ended?.networked
    ? [{ label: battleExitLabel(ended), run: returnToPort }]
    : [
        ended?.missionRules
          ? { label: 'Battle again', hint: 'Same fleets and seed', run: restartPve }
          // A custom battle is prepared from an idle port, so go home first; the loading screen covers the turn-round.
          : { label: 'Battle again', hint: 'Same fleets', run: async () => { await returnToPort(); await launch(); } },
        { label: 'New battle', run: async () => { await returnToPort(); openBattle(); } },
        { label: 'Return to port', run: returnToPort },
      ];

  return (
    <ShipContext value={selectedShip}>
      <main
        className="game-shell"
        style={{ '--hud-scale': hudScale } as CSSProperties}
        onContextMenu={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')))
            event.preventDefault();
        }}
        onDragStart={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')))
            event.preventDefault();
        }}
      >
        <div
          ref={host}
          className="ocean-viewport"
          inert={!ready || !!error}
          data-ship-labels={phase === 'sailing' && hud && ready && !error && !data.airOperationsOpen && !report}
        />
        {phase === 'garage' && ready && !error && !battleOpen && !builder && (
          <Garage
            pinned={PINNED_SHIP}
            switching={switching || builderOpening}
            switchError={switchError}
            onSelectShip={switchShip}
            game={game.current}
            ready={ready}
            fps={data.fps}
            performance={data.performance}
            onBattle={pressBattle}
            onBuild={(choice) => {
              setNewDesignChoice(choice);
              setNewDesignOpen(true);
            }}
            onEditDesign={(id) => void openBuilder(id)}
            onDeleteDesign={deletedDesign}
            libraryLoading={libraryLoading}
            onChooseBattle={openSortieBoard}
            lastMode={battleMode}
            accountName={account?.name}
            onSettings={() => game.current?.setPaused(true)}
          />
        )}
        {phase === 'garage' && sortieOpen && !battleOpen && (
          <SortieBoard lastMode={battleMode} onChoose={openBattle} onClose={() => setSortieOpen(false)} />
        )}
        {battleOpen && (
          <BattleDialog
            initialMode={battleMode}
            initialShipId={selectedShip.id}
            loading={!!battleLoading}
            onClose={() => setBattleOpen(false)}
            setup={battleSetup}
            onSetupChange={setBattleSetup}
            onLaunchCustom={() => void launch()}
            customError={battleError}
            pveRequest={pveRequest}
            onLaunchPve={launchPve}
            onOnlineBattle={onlineBattle}
          />
        )}
        {newDesignOpen && phase === 'garage' && (
          <NewDesignDialog
            initialChoice={newDesignChoice}
            onClose={() => setNewDesignOpen(false)}
            onCreate={async (choice, paint) => {
              const failure = await openBuilder(undefined, choice, paint);
              if (failure) throw new Error(failure);
              setNewDesignOpen(false);
            }}
          />
        )}
        {builder && phase === 'garage' && (
          <Shipbuilder
            key={builder.repositoryId ?? builder.source?.id}
            repositoryId={builder.repositoryId}
            initialDesignId={builder.source ? undefined : builder.repositoryId}
            openStore={builder.repositoryId ? openConstructionRepository : undefined}
            onEditorReady={
              import.meta.env.DEV
                ? (handle) => {
                    window.constructionEditor = handle;
                  }
                : undefined
            }
            suggestLayout={suggestLayout}
            catalog={builder.catalog}
            initialSource={builder.source}
            onDelete={deletedDesign}
            onSave={(source) => {
              builderSource.current = source;
            }}
            onLaunch={launchTrial}
            onClose={closeBuilder}
          />
        )}
        {phase === 'garage' && (builderOpening || builderError) && (
          <div className="shipbuilder-entry-status" role={builderError ? 'alert' : 'status'}>
            {builderError || 'Opening shipbuilder…'}
            {builderError && <Button onClick={() => void openBuilder(builderRequest.current, builderStarter.current)}>Retry</Button>}
          </div>
        )}
        {trial && phase === 'sailing' && ready && !error && !battleLoading && game.current && (
          <TrialControls game={game.current} onReturn={returnToPort} />
        )}
        {phase === 'sailing' && ready && !error && (
          <>
            {!report && <BinocularOverlay data={data} />}
            <div className="hud-viewport">
              <FleetHud key={game.current?.battleRevision} data={data} desk={desk.current} visible={hud && !report} bindings={bindings} />
              {!hud && !report && (
                <button className="restore-hud" onClick={() => setHud(true)}>
                  Show instruments <kbd>{bindingLabel(bindings, 'hud')}</kbd>
                </button>
              )}
            </div>
          </>
        )}
        {battleOver && (report && data.combat?.outcome ? (
          <AfterActionReport
            key={game.current?.battleRevision}
            mode={ended?.networked ? 'Online battle' : ended?.missionRules ? 'Fleet command' : 'Custom battle'}
            result={battleOver}
            outcome={data.combat.outcome}
            debrief={report}
            actions={reportActions}
            loadModel={(ship) => game.current!.reviewModel(ship.definition!)}
            releasePointer={() => game.current?.releasePointer()}
          />
        ) : (
          <BattleEndNotice
            key={game.current?.battleRevision}
            result={battleOver}
            outcome={data.combat?.outcome}
            onExit={() => void returnToPort()}
          />
        ))}
        {battleLoading && ready && !error && (
          <BattleLoadingScreen
            briefing={pveBriefing}
            setup={battleSetup}
            state={battleLoading}
            multiplayer={!!game.current?.simulation.networked}
            onLeft={() => setBattleLoading(null)}
          />
        )}

        {ready && !error && !builder && !battleLoading && !pveRestarting && game.current && <DevConsole host={game.current} />}
        {!ready && !error && !startup && <StartupScreen {...loading} />}

        {error && (
          <section className="loading-screen" aria-live="polite">
            <div className="loading-brand">
              <Icon name="anchor" size={36} />
              <span>FLEET COMMAND</span>
            </div>
            <div className="loading-content">
              <h1>{shipTitle(selectedShip)}</h1>
              <p className="loading-subtitle">Take the helm.</p>
              <div className="ship-measure">
                <div />
                <span>{selectedShip.hull.length} M</span>
                <div />
              </div>
              <div className="error-message">
                <h2>Unable to launch the battle</h2>
                <p>{error}</p>
                <p>Try reloading in a current Chrome or Edge browser with hardware acceleration enabled.</p>
                <Button variant="primary" onClick={() => setGeneration((value) => value + 1)}>
                  Try again <Icon name="arrow" size={18} />
                </Button>
              </div>
            </div>
            <div className="loading-bottom">
              <span>SINGLEPLAYER · OPEN OCEAN</span>
              <span>
                {shipTitle(selectedShip)} / {selectedShip.configuration.match(/19\d{2}/)?.[0]}
              </span>
            </div>
          </section>
        )}

        <dialog
          ref={dialog}
          className={`pause-menu ${settingsOpen ? 'pause-menu-covered' : ''}`}
          aria-labelledby="pause-title"
          onCancel={(e) => {
            e.preventDefault();
            resume();
          }}
        >
          <div className="menu-heading">
            <h2 id="pause-title">{phase === 'garage' ? 'In port.' : 'Paused'}</h2>
            <Button variant="icon" aria-label={phase === 'garage' ? 'Close menu' : 'Resume battle'} onClick={resume}>
              <Icon name="close" />
            </Button>
          </div>
          {phase === 'garage' && <p className="menu-description">Prepare for your next voyage.</p>}
          <Button autoFocus variant="primary" onClick={resume}>
            {phase === 'garage' ? 'Back to port' : 'Resume battle'} <Icon name={phase === 'garage' ? 'anchor' : 'play'} size={18} />
          </Button>
          {phase === 'sailing' && game.current?.simulation.missionRules && (
            <Button
              disabled={pveRestarting}
              variant="secondary"
              onClick={() => void restartPve().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
            >
              {pveRestarting ? 'Restarting…' : 'Restart this battle'}
            </Button>
          )}
          {phase === 'sailing' && (
            <Button variant="secondary" className="restart-button" onClick={() => void returnToPort()}>
              {trial ? 'Return to shipbuilder' : battleExitLabel(game.current?.simulation)} <Icon name="anchor" size={18} />
            </Button>
          )}
          <Button variant="secondary" className="menu-action" onClick={() => setSettingsOpen(true)}>
            Settings <Icon name="settings" size={18} />
          </Button>
          <Button variant="secondary" className="menu-action close-game-button" onClick={closeGame}>
            Close game <Icon name="power" size={18} />
          </Button>
          {phase === 'garage' && account && (
            <Button variant="secondary" className="menu-action" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          )}
          {signOutError && (
            <p className="menu-error" role="alert">
              {signOutError}
            </p>
          )}
          {phase === 'sailing' && (
            <div className="menu-controls">
              <span>
                <kbd>{bindingLabel(bindings, 'camera')}</kbd> Change camera
              </span>
              <span>
                <kbd>{bindingLabel(bindings, 'recenter')}</kbd> Recenter view
              </span>
              <span>
                <kbd>{bindingLabel(bindings, 'hud')}</kbd> Hide instruments
              </span>
              <span>
                <kbd>{bindingLabel(bindings, 'fullscreen')}</kbd> Fullscreen
              </span>
            </div>
          )}
        </dialog>
        {settingsOpen && paused && ready && !error && (
          <SettingsDialog
            graphics={graphics}
            launched={game.current?.launchedGraphics}
            performance={data.performance}
            inBattle={phase === 'sailing'}
            onGraphicsChange={changeGraphics}
            onReloadPort={reloadPort}
            bindings={bindings}
            audioSettings={audioSettings}
            hudSettings={hudSettings}
            hudScale={hudScale}
            onHudChange={changeHud}
            onAudioChange={changeAudio}
            onPreviewSound={(id) => game.current?.audio?.preview(id)}
            onBindingsChange={changeBindings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>
    </ShipContext>
  );
}
