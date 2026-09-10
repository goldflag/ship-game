import { assetUrl } from '../assetUrl';
// Fleet harbor. Commander, daily orders and currency are illustrative local state.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InspectionTooltip } from "./InspectionTooltip";
import { Icon } from "./Icons";
import "./Garage.css";
import type { Game } from "../game/Game";
import { shipModel, shipIdentity, shipClass, SHIP_CLASSES, type ShipClass } from "../game/shipModel";
import { useShip } from "./ShipContext";
import { shipPresets } from "../ships/presets";
import type { InspectionMode } from "../ships/inspection";
import { ModelViewControls, PortInspection } from "./PortInspection";
import { ShipStatistics } from "./ShipStatistics";
import { ShipClassIcon } from "./ShipClassIcons";

const SHIPS = Object.values(shipPresets);
const NATIONS = Array.from(new Set(SHIPS.map((ship) => shipIdentity(ship.id).nation).filter(Boolean))).sort();
const NATION_LABELS: Record<string, string> = { "United States": "USA", "United Kingdom": "UK" };
type GarageGlyph = "credits" | "star" | "check" | "wreath";
function Glyph({ name, size = 20 }: { name: GarageGlyph; size?: number }) {
  const paths: Record<GarageGlyph, ReactNode> = {
    credits: <path d="m12 3 8 5v8l-8 5-8-5V8ZM4 8l8 5 8-5M12 13v8" />,
    star: <path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.3-.9Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    wreath: (
      <>
        <path d="M8 3C-2 9 2 19 10 21M16 3c10 6 6 16-2 18M4 8l4 2M3 13l5 1M5 18l4-1M20 8l-4 2m5 3-5 1m3 4-4-1" />
        <path d="m12 6 1.5 3 3.5.5-2.5 2.5.6 3.5-3.1-1.7L8.9 15.5l.6-3.5L7 9.5l3.5-.5Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
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
  return failed ? (
    <ShipProfile />
  ) : (
    <img
      className="garage-ship-thumbnail"
      src={assetUrl(`models/${shipId}-thumbnail.png`)}
      width={600}
      height={180}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
function ResourceWallet() {
  return (
    <div className="garage-wallet" aria-label="Illustrative currency balances">
      <span>
        <Glyph name="credits" size={17} />
        2,450,000
      </span>
      <span>
        <Glyph name="star" size={17} />
        12,400
      </span>
      <b>CAPTAIN 08</b>
    </div>
  );
}
type GarageState = {
  inspection: InspectionMode;
  selectedVolume?: string;
  inspect: (mode: InspectionMode) => void;
  selectVolume: (id?: string) => void;
  selectShip: (id: string) => void;
  launch: () => void;
  multiplayer?: () => void;
  pve?: () => void;
  ready: boolean;
  settings: () => void;
  fps: number;
};
function SetSail({ state }: { state: GarageState }) {
  return (
    <div className="garage-battle-buttons"><button
      className="garage-set-sail"
      title="Choose ships for a custom battle"
      aria-haspopup="dialog"
      onClick={state.launch}
      disabled={!state.ready}
    >
      <Icon name="anchor" size={20} />
      <strong>{state.ready ? "CUSTOM BATTLE" : "PREPARING"}</strong>
      <Icon name="arrow" size={20} />
    </button>
    {state.pve && <button className="garage-online-battle" disabled={!state.ready} aria-haspopup="dialog" onClick={state.pve}>PvE FLEET COMMAND</button>}
    {state.multiplayer && <button className="garage-online-battle" disabled={!state.ready} aria-haspopup="dialog" onClick={state.multiplayer}>1V1 MULTIPLAYER</button>}</div>
  );
}
function Commander() {
  return (
    <div className="garage-commander">
      <div className="garage-officer-badge">
        <Icon name="anchor" size={35} />
        <i />
        <i />
        <i />
      </div>
      <div>
        <strong>OTTO REIMANN</strong>
        <span>Commander · Level 8</span>
        <small>2 skill points available</small>
      </div>
    </div>
  );
}
function StatisticsPanel() {
  const selectedShip = useShip();
  return (
    <>
      <div className="garage-panel-title">
        <h2>Statistics</h2>
        <span>VIII</span>
      </div>
      <ShipStatistics key={selectedShip.id} definition={selectedShip} />
    </>
  );
}
function FleetCarousel({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  const [classFilter, setClassFilter] = useState<"All" | ShipClass>("All");
  const [nationFilter, setNationFilter] = useState("All");
  const ships = useMemo(
    () =>
      SHIPS.filter(
        (ship) =>
          (classFilter === "All" || shipClass(ship.id) === classFilter) &&
          (nationFilter === "All" || shipIdentity(ship.id).nation === nationFilter),
      ),
    [classFilter, nationFilter],
  );
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
  useEffect(updateScrollState, [ships]);
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
        <div role="group" aria-label="Filter fleet by nation">
          {["All", ...NATIONS].map((nation) => (
            <button
              key={nation}
              aria-pressed={nationFilter === nation}
              aria-label={nation === "All" ? "All nations" : nation}
              onClick={() => setNationFilter(nation)}
            >
              {nation === "All" ? "All nations" : NATION_LABELS[nation] ?? nation}
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
                  {selected && <Glyph name="check" size={14} />}
                </div>
                <ShipThumbnail shipId={ship.id} />
                <strong>{ship.name}</strong>
              </button>
            );
          })}
          {!ships.length && <p className="garage-fleet-empty">No ships match these filters.</p>}
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
        <div className="garage-brand">
          <Icon name="anchor" size={26} />
          <strong>FLEET COMMAND</strong>
        </div>
        <div
          className="garage-preview-meta"
          aria-label={`${state.fps || 0} frames per second`}
        >
          {state.fps || "—"} FPS
        </div>
        <div className="garage-classic-deploy">
          <SetSail state={state} />
        </div>
        <ResourceWallet />
        <button
          className="garage-settings"
          aria-label="Port settings"
          disabled={!state.ready}
          onClick={state.settings}
        >
          <Icon name="compass" size={20} />
        </button>
      </header>
      <section className="garage-classic-identity">
        <h1>{selectedShip.name.toUpperCase()}</h1>
        <div>
          <span>VIII</span>
          <span>{SHIP_MODEL.type}</span>
          <span>
            {SHIP_MODEL.nation} · {SHIP_MODEL.year}
          </span>
        </div>
      </section>
      <div className="garage-classic-left">
        <div className="garage-commander-link">
          <Commander />
        </div>
        <section className="garage-daily-orders">
          <div>
            <Glyph name="wreath" size={22} />
            <h2>Daily orders</h2>
          </div>
          <strong>A captain’s first command</strong>
          <p>Get underway and put your ship through her paces.</p>
          <div>
            <span>Battles completed</span>
            <b>0 / 1</b>
          </div>
          <i />
          <small>
            <Glyph name="credits" size={13} /> 25,000 credits
          </small>
        </section>
      </div>
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
  game: Game | null;
  ready: boolean;
  switching: boolean;
  switchError: string;
  onSelectShip: (id: string) => void;
  fps: number;
  onLaunch: () => void;
  onMultiplayer?: () => void;
  onPve?: () => void;
  onSettings: () => void;
}

export function Garage({
  game,
  ready,
  fps,
  onLaunch,
  onMultiplayer,
  onPve,
  onSettings,
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
    launch: onLaunch,
    pve: onPve,
    multiplayer: onMultiplayer,
    ready: ready && !switching,
    settings: onSettings,
    fps,
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
