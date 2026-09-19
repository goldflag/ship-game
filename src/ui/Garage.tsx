import { assetUrl } from '../assetUrl';
import { useConstructionThumbnail } from './useConstructionThumbnail';
// Fleet harbor: historical ships and saved local designs.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { InspectionTooltip, type InspectionHoverSource } from "./InspectionTooltip";
import { Icon } from "./Icons";
import { PerformanceCounter } from "./PerformanceCounter";
import type { PerformanceReadout } from "../game/types";
import "./Garage.css";
import { shipModel, shipIdentity, shipClass, SHIP_CLASSES, type ShipClass } from "../game/shipModel";
import { useShip } from "./ShipContext";
import { shipPresets } from "../ships/presets";
import type { InspectionMode } from "../ships/inspection";
import { ModelViewControls, PortInspection } from "./PortInspection";
import { ShipStatistics } from "./ShipStatistics";
import { ShipClassIcon } from "./ShipClassIcons";
import { battleModeName, type BattleMode } from "./battle/battleModes";
import { localShip, localShips, subscribeLocalShips } from '../ships/localShips';
import { usePortDesigns } from './usePortDesigns';
import { Button } from './components';
import { DeleteDesignButton } from './DeleteDesignButton';
import { openConstructionStore } from '../ships/constructionStore';

const SHIPS = Object.values(shipPresets);
const NATIONS = Array.from(new Set(SHIPS.map((ship) => shipIdentity(ship.id).nation).filter(Boolean))).sort();
const NATION_LABELS: Record<string, string> = { "United States": "USA", "United Kingdom": "UK" };
function SelectedMark() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
}
function ShipProfile({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`garage-ship-profile ${className}`}
      viewBox="0 0 250 65"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m7 47 11 12h208l18-14-40 2-12-5H55l-12 4Z"
        fill="currentColor"
        fillOpacity=".3"
        stroke="currentColor"
      />
      <path
        d="M53 44V35h24v9m-19-9-20-2m25 2-24-1M170 43v-9h22v10m-8-10 28-2m-25 2 23-1M84 43V29h18v14M109 43V19h21v24M141 43V24h15v19M116 19V7m-11 6h25m-16 4h21M85 29l7-10 4 10M121 19l13 5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M101 31h39v12h-39M44 53h172"
        stroke="currentColor"
        strokeOpacity=".45"
      />
    </svg>
  );
}
function ShipThumbnail({ shipId }: { shipId: string }) {
  const [failed, setFailed] = useState(false);
  const local = localShip(shipId), thumbnail = useConstructionThumbnail(local);
  const src = thumbnail ?? assetUrl(`models/${shipId}-thumbnail.png`);
  useEffect(() => setFailed(false), [src]);
  return local && !thumbnail ? <ShipClassIcon shipClass="Other" className="garage-local-thumbnail" width={96} /> : failed ? (
    <ShipProfile />
  ) : (
    <img
      className="garage-ship-thumbnail"
      src={src}
      width={600}
      height={180}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
type GarageState = {
  inspection: InspectionMode;
  selectedVolume?: string;
  inspect: (mode: InspectionMode) => void;
  selectVolume: (id?: string) => void;
  selectShip: (id: string) => void;
  /** The Battle button: the sortie board, or the last mode when the player chose to skip it. */
  battle: () => void;
  build: () => void;
  editDesign: (id: string) => void;
  deleteDesign: (id: string) => void;
  libraryLoading: boolean;
  /** The caret: always the sortie board. */
  chooseBattle: () => void;
  lastMode: BattleMode;
  ready: boolean;
  settings: () => void;
  accountName?: string;
  fps: number;
  performance?: PerformanceReadout;
};
function SetSail({ state }: { state: GarageState }) {
  return (
    <div className="garage-battle">
      <div className="garage-battle-split">
        <button
          className="garage-set-sail"
          title="Prepare a battle"
          aria-haspopup="dialog"
          onClick={() => state.battle()}
          disabled={!state.ready}
        >
          <Icon name="anchor" size={20} />
          <strong>{state.ready ? "BATTLE" : "PREPARING"}</strong>
          <Icon name="arrow" size={20} />
        </button>
        <button
          className="garage-battle-caret"
          title="Choose a battle mode"
          aria-label="Choose a battle mode"
          aria-haspopup="dialog"
          disabled={!state.ready}
          onClick={() => state.chooseBattle()}
        >
          <Icon name="chevron" size={18} />
        </button>
      </div>
      <small className="garage-battle-last">Last: <b>{battleModeName(state.lastMode)}</b></small>
    </div>
  );
}
function StatisticsPanel() {
  const selectedShip = useShip();
  return (
    <>
      <div className="garage-panel-title">
        <h2>Statistics</h2>
      </div>
      <ShipStatistics key={selectedShip.id} definition={selectedShip} />
    </>
  );
}
function FleetCarousel({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  const local = useSyncExternalStore(subscribeLocalShips, localShips);
  const library = usePortDesigns();
  const selectedLocal = local.find(ship => ship.definition.id === selectedShip.id);
  const selectedDesign = library.designs.find(design => (design.sourceId ?? design.id) === selectedLocal?.source.id);
  const drafts = library.designs.filter(design => !local.some(ship => ship.source.id === (design.sourceId ?? design.id)));
  const [classFilter, setClassFilter] = useState<"All" | ShipClass>("All");
  const [nationFilter, setNationFilter] = useState("All");
  const ships = useMemo(
    () =>
      [...local.map(ship => ship.definition), ...SHIPS].filter(
        (ship) =>
          (classFilter === "All" || shipClass(ship.id) === classFilter) &&
          (nationFilter === "All" || (nationFilter === "My designs" ? !!localShip(ship.id) : shipIdentity(ship.id).nation === nationFilter)),
      ),
    [classFilter, nationFilter, local],
  );
  const visibleDrafts = (classFilter === "All" || classFilter === "Other") && (nationFilter === "All" || nationFilter === "My designs") ? drafts : [];
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ atStart: true, atEnd: true });
  const updateScrollState = () => {
    const el = trackRef.current;
    if (!el) return;
    setScrollState({
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    });
  };
  useEffect(updateScrollState, [ships, library.designs]);
  const scrollByPage = (direction: 1 | -1) => {
    trackRef.current?.scrollBy({
      left: direction * trackRef.current.clientWidth * 0.8,
      behavior: "smooth",
    });
  };
  // Ensure the currently sailing ship is still selectable after switching filters.
  useEffect(() => {
    if (!ships.some((ship) => ship.id === selectedShip.id)) {
      setClassFilter("All");
      setNationFilter("All");
    }
  }, [selectedShip.id]);
  return (
    <section className="garage-fleet-carousel" aria-label="Your fleet">
      <div className="garage-design-actions">
        <Button variant="primary" disabled={!state.ready} onClick={state.build}>New design</Button>
        {selectedLocal && <Button disabled={!state.ready} onClick={() => state.editDesign(selectedDesign?.id ?? selectedLocal.source.id)}>Edit design</Button>}
        {selectedDesign && <DeleteDesignButton key={selectedDesign.id} name={selectedDesign.name} disabled={!state.ready} onDelete={async () => {
          const store = await openConstructionStore();
          try { await store.remove(selectedDesign.id, selectedDesign.revisionId); state.deleteDesign(selectedDesign.id); library.refresh(); }
          catch (error) { library.refresh(); throw error; }
          finally { store.close(); }
        }}/>}
        {(library.loading || state.libraryLoading) && <span role="status">Loading your designs…</span>}
        {library.error && <span role="alert">{library.error} <button onClick={library.refresh}>Retry</button></span>}
      </div>
      <div className="garage-fleet-filters">
        <div role="group" aria-label="Filter fleet by class">
          {(["All", ...SHIP_CLASSES] as const).map((type) => (
            <button
              key={type}
              aria-pressed={classFilter === type}
              onClick={() => setClassFilter(type)}
            >
              {type !== "All" && <ShipClassIcon shipClass={type} width={22} />}
              {type}
            </button>
          ))}
        </div>
        <i aria-hidden="true" />
        <div role="group" aria-label="Filter fleet by collection or nation">
          {["All", "My designs", ...NATIONS].map((nation) => (
            <button
              key={nation}
              aria-pressed={nationFilter === nation}
              aria-label={nation === "All" ? "All ships" : nation}
              onClick={() => setNationFilter(nation)}
            >
              {nation === "All" ? "All ships" : NATION_LABELS[nation] ?? nation}
            </button>
          ))}
        </div>
      </div>
      <div className="garage-fleet-track">
        <button
          className="garage-fleet-nav garage-fleet-nav-prev"
          aria-label="Scroll fleet left"
          disabled={scrollState.atStart}
          onClick={() => scrollByPage(-1)}
        >
          <Icon name="arrow" size={16} />
        </button>
        <div
          className="garage-ship-cards"
          ref={trackRef}
          onScroll={updateScrollState}
        >
          {ships.map((ship) => {
            const selected = ship.id === selectedShip.id;
            return (
              <button
                className={selected ? "garage-ship-selected" : ""}
                key={ship.id}
                aria-label={`Inspect ${ship.name}`}
                aria-pressed={selected}
                disabled={!state.ready}
                onClick={() => state.selectShip(ship.id)}
              >
                <div>
                  <span>
                    <ShipClassIcon shipClass={shipClass(ship.id)} width={24} />
                    {shipIdentity(ship.id).type}
                  </span>
                  {selected && <SelectedMark />}
                </div>
                <ShipThumbnail shipId={ship.id} />
                <strong>{ship.name}</strong>
              </button>
            );
          })}
          {visibleDrafts.map(design => <button key={`draft-${design.id}`} disabled={!state.ready}
            aria-label={`Edit ${design.name}`} onClick={() => state.editDesign(design.id)}>
            <div><span>{design.readError ? 'Needs recovery · open to edit' : state.libraryLoading ? 'Preparing preview…' : 'Draft · open to edit'}</span></div>
            <ShipClassIcon shipClass="Other" className="garage-local-thumbnail" width={96}/>
            <strong>{design.name}</strong>
          </button>)}
          {!ships.length && !visibleDrafts.length && <p className="garage-fleet-empty">No ships match these filters.</p>}
        </div>
        <button
          className="garage-fleet-nav garage-fleet-nav-next"
          aria-label="Scroll fleet right"
          disabled={scrollState.atEnd}
          onClick={() => scrollByPage(1)}
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </section>
  );
}

function PortLayout({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  const SHIP_MODEL = shipModel(selectedShip);
  return (
    <div
      className={`garage-layout garage-fleet-harbor ${state.inspection !== "exterior" ? "port-inspection-active" : "port-statistics-active"}`}
    >
      <header className="garage-classic-header">
        <button
          className="garage-account"
          title="Open the menu"
          aria-haspopup="dialog"
          disabled={!state.ready}
          onClick={state.settings}
        >
          <Icon name="compass" size={18} />
          <strong>{state.accountName ?? "Menu"}</strong>
        </button>
        <PerformanceCounter className="garage-preview-meta" fps={state.fps} performance={state.performance} />
        <div className="garage-classic-deploy">
          <SetSail state={state} />
        </div>
      </header>
      <section className="garage-classic-identity">
        <h1>{selectedShip.name.toUpperCase()}</h1>
        <div>
            <span>{SHIP_MODEL.type}</span>
          {(SHIP_MODEL.nation || SHIP_MODEL.year) && <span>{[SHIP_MODEL.nation, SHIP_MODEL.year].filter(Boolean).join(" · ")}</span>}
        </div>
      </section>
      <aside className="garage-classic-details">
        <ModelViewControls
          mode={state.inspection}
          onChange={state.inspect}
          ready={state.ready}
        />
        {state.inspection === "exterior" ? (
          <StatisticsPanel />
        ) : (
          <PortInspection
            key={`${selectedShip.id}:${state.inspection}`}
            definition={selectedShip}
            mode={state.inspection}
            selectedId={state.selectedVolume}
            onSelect={state.selectVolume}
          />
        )}
      </aside>
      <FleetCarousel state={state} />
    </div>
  );
}

interface Props {
  /** The port scene: inspection views and the hover feed the tooltip follows. */
  game: (InspectionHoverSource & { setPortInspection(mode: InspectionMode, selectedId?: string): void }) | null;
  ready: boolean;
  switching: boolean;
  switchError: string;
  onSelectShip: (id: string) => void;
  fps: number;
  performance?: PerformanceReadout;
  onBattle: () => void;
  onBuild: () => void;
  onEditDesign: (id: string) => void;
  onDeleteDesign: (id: string) => void;
  libraryLoading: boolean;
  onChooseBattle: () => void;
  lastMode: BattleMode;
  onSettings: () => void;
  accountName?: string;
}

export function Garage({
  game,
  ready,
  fps,
  performance,
  onBattle,
  onBuild,
  onEditDesign,
  onDeleteDesign,
  libraryLoading,
  onChooseBattle,
  lastMode,
  onSettings,
  accountName,
  switching,
  switchError,
  onSelectShip,
}: Props) {
  const selectedShip = useShip();
  const [inspection, setInspection] = useState<InspectionMode>("exterior");
  const [selectedVolume, setSelectedVolume] = useState<string>();
  const inspect = (mode: InspectionMode) => {
    setInspection(mode);
    setSelectedVolume(undefined);
  };
  useEffect(() => {
    if (ready) game?.setPortInspection(inspection, selectedVolume);
  }, [game, ready, inspection, selectedVolume]);
  useEffect(() => () => game?.setPortInspection("exterior"), [game]);

  useEffect(() => {
    const closeDetails = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      setInspection("exterior");
      setSelectedVolume(undefined);
    };
    window.addEventListener("keydown", closeDetails);
    return () => window.removeEventListener("keydown", closeDetails);
  }, []);

  const state: GarageState = {
    inspection,
    selectedVolume,
    inspect,
    selectVolume: setSelectedVolume,
    selectShip: (id) => {
      if (id === selectedShip.id) {
        inspect("exterior");
        return;
      }
      onSelectShip(id);
    },
    battle: onBattle,
    build: onBuild,
    editDesign: onEditDesign,
    deleteDesign: onDeleteDesign,
    libraryLoading,
    chooseBattle: onChooseBattle,
    lastMode,
    ready: ready && !switching,
    settings: onSettings,
    accountName,
    fps,
    performance,
  };

  return (
    <div className="garage">
      <div className="garage-scene-shade" />
      <PortLayout state={state} />
      <InspectionTooltip game={game} />
      {switchError ? (
        <div className="garage-loading" role="alert"><span>{switchError}</span></div>
      ) : switching && (
        <svg className="garage-spinner" role="status" aria-label="Preparing ship" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="2.2"/>
          <path id="garage-spinner-blade" d="M12 10.2c-.6-3.2.4-6.6 2.6-8.2 1.9 2.2 1.6 5.8-.8 8.2Z"/>
          <use href="#garage-spinner-blade" transform="rotate(120 12 12)"/>
          <use href="#garage-spinner-blade" transform="rotate(240 12 12)"/>
        </svg>
      )}
    </div>
  );
}
