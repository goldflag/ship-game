// Fleet harbor. Progression, research, commander and refits are illustrative local state.
import { useEffect, useState, type ReactNode } from "react";
import { InspectionTooltip } from "./InspectionTooltip";
import { Icon } from "./Icons";
import { SchematicDialog } from "./SchematicDialog";
import "./Garage.css";
import type { Game } from "../game/Game";
import { shipModel, shipIdentity } from "../game/shipModel";
import { useShip } from "./ShipContext";
import type { ShipDefinition } from "../ships/blueprint";
import { shipPresets, shipReviewUrls } from "../ships/presets";
import type { InspectionMode } from "../ships/inspection";
import { ModelViewControls, PortInspection } from "./PortInspection";
import { HULL_REFIT_SURVIVABILITY_BONUS, ShipScores, ShipStatistics } from "./ShipStatistics";
import { shipScores } from "../ships/statistics";

type Section = "overview" | "equipment" | "commander" | "research";
type ModuleId = "battery" | "hull" | "propulsion" | "director";
const modulesFor = (selectedShip: ShipDefinition) => {
  const survivability = shipScores(selectedShip).find((s) => s.id === "survivability")!.score;
  const main = selectedShip.mounts.find(m => m.battery === 'main');
  const drives = selectedShip.propulsion?.groups.flatMap(g => g.driveIds) ?? [];
  const machinery = selectedShip.modules.find(m => drives.includes(m.id));
  const shafts = new Set(selectedShip.propulsion?.groups.flatMap(g => g.shaftIds) ?? []).size;
  const armored = selectedShip.armor.some(a => !a.plate?.mountId && a.thicknessMm >= 50);
  return {
    battery: {
      name: "Main battery",
      model: main?.weapon.name ?? "No deck gun",
      icon: "turret",
      detail: `${selectedShip.mounts.filter((m) => m.battery === "main").length} main battery mounts.${selectedShip.torpedoTubes?.length ? " Deck gun for surface engagements; torpedoes are the primary striking arm." : " Train the guns into arc for surface fire."}`,
      upgrade: "Improved loading system",
      stat: "Reload time",
      standard: `${(main?.weapon.reloadSeconds ?? 0).toFixed(1)} s`,
      improved: `${((main?.weapon.reloadSeconds ?? 0) * .9).toFixed(1)} s`,
      cost: 125000,
    },
    hull: {
      name: "Hull",
      model: `${selectedShip.name} · ${selectedShip.configuration.match(/19\d{2}/)?.[0]}`,
      icon: "ship",
      detail:
        selectedShip.torpedoTubes?.length ? "An unarmored outer casing surrounds the pressure hull. Ballast and dive planes control depth; flooding remains a separate threat." : armored ? "Armor protects vital compartments. Inspect the protection and internal layout in port." : "Ordinary steel plating surrounds the watertight spaces. Inspect machinery, ammunition and flooding compartments in port.",
      upgrade: "Reinforced compartmentation",
      stat: "Survivability",
      standard: String(survivability),
      improved: String(Math.min(100, survivability + HULL_REFIT_SURVIVABILITY_BONUS)),
      cost: 180000,
    },
    propulsion: {
      name: "Propulsion",
      model: machinery?.name ?? (selectedShip.torpedoTubes?.length ? "Diesels and electric motors" : "Steam propulsion"),
      icon: "propeller",
      detail: selectedShip.torpedoTubes?.length ? "Twin shafts use diesels on the surface and electric motors underwater." : shafts ? `${shafts} ${shafts === 1 ? 'shaft supplies' : 'shafts supply'} propulsion. Machinery damage and flooding reduce available power.` : "Machinery damage and flooding reduce available propulsion power.",
      upgrade: "Engine calibration",
      stat: "Engine response",
      standard: "34.0 s",
      improved: "30.6 s",
      cost: 90000,
    },
    director: {
      name: "Fire control",
      model: "Optical rangefinder",
      icon: "target",
      detail:
        "Keep the battery on target as range, bearing and conditions change.",
      upgrade: "Rangefinder calibration",
      stat: "Accuracy",
      standard: "72",
      improved: "80",
      cost: 110000,
    },
  } as const;
};
const SHIPS = Object.values(shipPresets);
type GarageGlyph =
  | "credits"
  | "star"
  | "lock"
  | "person"
  | "shield"
  | "propeller"
  | "check"
  | "chevron"
  | "wreath"
  | "plus";
function Glyph({ name, size = 20 }: { name: GarageGlyph; size?: number }) {
  const paths: Record<GarageGlyph, ReactNode> = {
    plus: <path d="M5 12h14M12 5v14" />,
    credits: (
      <>
        <path d="m12 3 8 5v8l-8 5-8-5V8ZM4 8l8 5 8-5M12 13v8" />
      </>
    ),
    star: (
      <path d="m12 3 2.7 5.7 6.3.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.3-.9Z" />
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 22v-4a8 8 0 0 1 16 0v4M8 17l4 3 4-3" />
      </>
    ),
    shield: <path d="m12 2 8 4v7c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6" />,
    propeller: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M11 10C4 2 13-1 15 4c1 3-2 6-2 6M14 12c11-2 10 8 4 8-3 0-5-6-5-6M11 14C7 23-1 17 3 12c2-2 7-1 7-1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
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
function ModuleIcon({ id, size = 22 }: { id: ModuleId; size?: number }) {
  const name = modulesFor(useShip())[id].icon;
  return name === "propeller" ? (
    <Glyph name="propeller" size={size} />
  ) : (
    <Icon name={name} size={size} />
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
      src={`/models/${shipId}-thumbnail.png`}
      width={600}
      height={180}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
function ResourceWallet({ credits }: { credits: number }) {
  return (
    <div className="garage-wallet" aria-label="Illustrative currency balances">
      <span>
        <Glyph name="credits" size={17} />
        {credits.toLocaleString()}
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
  section: Section;
  setSection: (value: Section) => void;
  module: ModuleId;
  setModule: (value: ModuleId) => void;
  fitted: Record<ModuleId, boolean>;
  fit: () => void;
  credits: number;
  selectShip: (id: string) => void;
  launch: () => void;
  ready: boolean;
  settings: () => void;
  schematic: () => void;
};
function SetSail({ state }: { state: GarageState }) {
  return (
    <button
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
  );
}
function ModuleList({ state }: { state: GarageState }) {
  const MODULES = modulesFor(useShip());
  return (
    <div className="garage-module-list">
      {(Object.keys(MODULES) as ModuleId[]).map((id) => (
        <button
          key={id}
          aria-pressed={state.module === id}
          onClick={() => {
            state.setModule(id);
            state.setSection("equipment");
          }}
        >
          <ModuleIcon id={id} />
          <span>
            <strong>{MODULES[id].name}</strong>
            <small>{state.fitted[id] ? "UPGRADED" : MODULES[id].model}</small>
          </span>
          {state.fitted[id] ? (
            <Glyph name="check" size={16} />
          ) : (
            <Glyph name="chevron" size={15} />
          )}
        </button>
      ))}
    </div>
  );
}
function RefitDetail({ state }: { state: GarageState }) {
  const MODULES = modulesFor(useShip());
  const item = MODULES[state.module];
  const fitted = state.fitted[state.module];
  return (
    <div className="garage-refit-content">
      <div className="garage-module-art">
        <ModuleIcon id={state.module} size={70} />
        <div>
          <span>STANDARD ISSUE</span>
          <strong>{item.model}</strong>
        </div>
      </div>
      <p>{item.detail}</p>
      <div className="garage-upgrade-choice">
        <div>
          <Glyph name={fitted ? "check" : "plus"} size={18} />
          <strong>{item.upgrade}</strong>
        </div>
        <p>
          {fitted
            ? "Fitted to your preview configuration."
            : "An available refit for this ship."}
        </p>
        <dl>
          <dt>{item.stat}</dt>
          <dd>
            <span>{item.standard}</span>
            <Icon name="arrow" size={14} />
            <strong>{item.improved}</strong>
          </dd>
        </dl>
      </div>
      <button
        className={`garage-fit-button ${fitted ? "garage-is-fitted" : ""}`}
        onClick={state.fit}
      >
        {fitted ? (
          <Glyph name="check" size={17} />
        ) : (
          <Icon name="repair" size={17} />
        )}
        <strong>{fitted ? "RESTORE STANDARD" : "FIT UPGRADE"}</strong>
        <span>{fitted ? "Refund" : item.cost.toLocaleString()}</span>
      </button>
      <small className="garage-mock-note">
        Refits are illustrative and do not change sailing.
      </small>
    </div>
  );
}
function Commander({ extended = false }: { extended?: boolean }) {
  const [skill, setSkill] = useState("Damage control");
  return (
    <div
      className={`garage-commander ${extended ? "garage-commander-extended" : ""}`}
    >
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
      {extended && (
        <>
          <p>
            A steady hand in open water. Choose a specialty for your command.
          </p>
          <div className="garage-skill-options">
            {["Damage control", "Expert marksman", "Ship handling"].map(
              (item) => (
                <button
                  key={item}
                  aria-pressed={skill === item}
                  onClick={() => setSkill(item)}
                >
                  {skill === item ? (
                    <Glyph name="check" size={15} />
                  ) : (
                    <Glyph name="star" size={15} />
                  )}{" "}
                  {item}
                </button>
              ),
            )}
          </div>
          <small className="garage-mock-note">
            Commander and skills are a progression preview.
          </small>
        </>
      )}
    </div>
  );
}
function SideContent({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  if (state.section === "equipment")
    return (
      <>
        <h2>Equipment</h2>
        <ShipScores definition={selectedShip} hullRefit={state.fitted.hull} />
        <ModuleList state={state} />
        <RefitDetail state={state} />
      </>
    );
  if (state.section === "commander")
    return (
      <>
        <h2>Command</h2>
        <Commander extended />
      </>
    );
  if (state.section === "research")
    return (
      <>
        <h2>Your fleet</h2>
        <p className="garage-subtle">Select a ship to inspect and sail.</p>
        <div className="garage-research-list">
          {SHIPS.map((ship) => (
            <button
              key={ship.id}
              aria-pressed={ship.id === selectedShip.id}
              disabled={!state.ready}
              onClick={() => state.selectShip(ship.id)}
            >
              <ShipProfile />
              <strong>{ship.name}</strong>
              <small>{ship.configuration}</small>
            </button>
          ))}
        </div>
      </>
    );
  return (
    <>
      <div className="garage-panel-title">
        <h2>Statistics</h2>
        <span>VIII</span>
      </div>
      <ShipStatistics
        key={selectedShip.id}
        definition={selectedShip}
        hullRefit={state.fitted.hull}
      />
      <button
        className="garage-text-button"
        onClick={() => state.setSection("equipment")}
      >
        Configure ship <Icon name="arrow" size={16} />
      </button>
    </>
  );
}
function FleetCarousel({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  return (
    <section className="garage-fleet-carousel" aria-label="Your fleet">
      <div className="garage-ship-cards">
        {SHIPS.map((ship) => {
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
                <span>{shipIdentity(ship.id).type}</span>
                {selected && <Glyph name="check" size={14} />}
              </div>
              <ShipThumbnail shipId={ship.id} />
              <strong>{ship.name}</strong>
              <small>
                {selected
                  ? state.ready
                    ? "IN PORT"
                    : "PREPARING"
                  : "AVAILABLE"}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PortLayout({ state }: { state: GarageState }) {
  const selectedShip = useShip();
  const SHIP_MODEL = shipModel(selectedShip);
  return (
    <div
      className={`garage-layout garage-fleet-harbor ${state.inspection !== "exterior" ? "port-inspection-active" : state.section === "overview" ? "port-statistics-active" : ""}`}
    >
      <header className="garage-classic-header">
        <div className="garage-brand">
          <Icon name="anchor" size={26} />
          <strong>FLEET COMMAND</strong>
        </div>
        <nav aria-label="Port sections">
          {(
            [
              ["overview", "Port"],
              ["equipment", "Equipment"],
              ["commander", "Commander"],
              ["research", "Fleet"],
            ] as [Section, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={state.section === id}
              onClick={() => state.setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="garage-classic-deploy">
          <SetSail state={state} />
        </div>
        <ResourceWallet credits={state.credits} />
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
        <p className="garage-ready">
          <i /> {state.ready ? "READY FOR BATTLE" : "PREPARING SHIP"}
        </p>
        <button
          className="garage-schematic-button"
          onClick={state.schematic}
          disabled={!state.ready}
          aria-haspopup="dialog"
        >
          <Icon name="schematic" size={16} />
          Create schematic
        </button>
        {shipReviewUrls[selectedShip.id] && (
          <a
            className="garage-schematic-button"
            href={shipReviewUrls[selectedShip.id]}
            target="_blank"
            rel="noreferrer"
          >
            Reference review
          </a>
        )}
      </section>
      <div className="garage-classic-left">
        <button
          className="garage-commander-link"
          onClick={() => state.setSection("commander")}
        >
          <Commander />
          <Glyph name="chevron" size={16} />
        </button>
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
      <aside className="garage-classic-details" data-section={state.section}>
        <ModelViewControls
          mode={state.inspection}
          onChange={state.inspect}
          ready={state.ready}
        />
        {state.inspection === "exterior" ? (
          <SideContent state={state} />
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
  onSettings: () => void;
}

export function Garage({
  game,
  ready,
  fps,
  onLaunch,
  onSettings,
  switching,
  switchError,
  onSelectShip,
}: Props) {
  const selectedShip = useShip();
  const MODULES = modulesFor(selectedShip);
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
  const [section, setSection] = useState<Section>("overview");
  const [module, setModule] = useState<ModuleId>("battery");
  const [fitted, setFitted] = useState<Record<ModuleId, boolean>>({
    battery: false,
    hull: false,
    propulsion: false,
    director: false,
  });
  const [schematic, setSchematic] = useState(false);
  const credits =
    2450000 -
    (Object.keys(MODULES) as ModuleId[]).reduce(
      (total, id) => total + (fitted[id] ? MODULES[id].cost : 0),
      0,
    );

  useEffect(() => {
    const closeDetails = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      setSection("overview");
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
    section,
    setSection: (value) => {
      setSection(value);
      inspect("exterior");
    },
    module,
    setModule,
    fitted,
    fit: () => setFitted((value) => ({ ...value, [module]: !value[module] })),
    credits,
    selectShip: (id) => {
      if (id === selectedShip.id) {
        setSection("overview");
        inspect("exterior");
        return;
      }
      onSelectShip(id);
    },
    launch: onLaunch,
    ready: ready && !switching,
    settings: onSettings,
    schematic: () => setSchematic(true),
  };

  return (
    <div className="garage">
      <div className="garage-scene-shade" />
      <PortLayout state={state} />
      <InspectionTooltip game={game} />
      {schematic && <SchematicDialog onClose={() => setSchematic(false)} />}
      {(switching || switchError) && (
        <div className="garage-loading" role={switchError ? "alert" : "status"}>
          <span>{switchError || "Preparing ship…"}</span>
        </div>
      )}
      <div
        className="garage-preview-meta"
        aria-label={`${fps || 0} frames per second`}
      >
        {fps || "—"} FPS
      </div>
    </div>
  );
}
