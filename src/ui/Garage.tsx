// Home port: the player's own designs. One ship lies alongside under its builder's plate;
// the plan chest holds the whole library. Historical ships are offered in Battle setup.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useConstructionThumbnail } from './useConstructionThumbnail';
import { InspectionTooltip, type InspectionHoverSource } from './InspectionTooltip';
import { Icon } from './Icons';
import { PerformanceCounter } from './PerformanceCounter';
import type { PerformanceReadout } from '../game/types';
import './Garage.css';
import { shipModel } from '../game/shipModel';
import { useShip } from './ShipContext';
import type { InspectionMode } from '../ships/inspection';
import { PortPanel, type PortSelection } from './PortPanel';
import { ShipClassIcon } from './ShipClassIcons';
import { battleModeName, type BattleMode } from './battle/battleModes';
import { localShips, shipTitle, subscribeLocalShips } from '../ships/localShips';
import { usePortDesigns } from './usePortDesigns';
import { CloneDesignButton, DeleteDesignButton } from './DeleteDesignButton';
import { cloneConstructionDesign, openConstructionStore } from '../ships/constructionStore';
import { restoreLocalShips } from '../ships/constructionLibrary';
import { shipScores, shipSpec, type StatScoreId } from '../ships/statistics';
import { HULL_PRESETS, type HullPresetChoice } from '../ships/constructionHullPresets';
import { HullPresetPlan } from './shipbuilding/NewDesignDialog';
import {
  PORT_STATUS_LABEL,
  editedLabel,
  filterDesigns,
  fleetLineWindow,
  portDesigns,
  rememberDesign,
  rememberedDesign,
  sortDesigns,
  type PortDesign,
  type PortFilter,
  type PortSort,
} from './portDesigns';

const SCORE_SHORT: Record<StatScoreId, string> = {
  survivability: 'Surv',
  artillery: 'Art',
  airDefense: 'AA',
  maneuverability: 'Man',
  concealment: 'Con',
};

function PortIcon({ name, size = 16 }: { name: 'pencil' | 'grid' | 'search' | 'back' | 'left' | 'right'; size?: number }) {
  const paths = {
    pencil: <path d="M4 20h4L19 9l-4-4L4 16ZM13 7l4 4" />,
    grid: <path d="M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </>
    ),
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    left: <path d="m15 6-6 6 6 6" />,
    right: <path d="m9 6 6 6-6 6" />,
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

function DesignThumbnail({ design }: { design: PortDesign }) {
  const thumbnail = useConstructionThumbnail(design.ship);
  return thumbnail ? (
    <img className="port-thumbnail" src={thumbnail} width={600} height={180} alt="" />
  ) : (
    <ShipClassIcon shipClass="Other" className="port-thumbnail-pending" width={96} />
  );
}
function StatusMark({ status }: { status: PortDesign['status'] }) {
  return (
    <span className="port-status" data-status={status}>
      <i aria-hidden="true" />
      {PORT_STATUS_LABEL[status]}
    </span>
  );
}

type GarageState = {
  /** The Battle button: the sortie board, or the last mode when the player chose to skip it. */
  battle: () => void;
  /** The caret: always the sortie board. */
  chooseBattle: () => void;
  lastMode: BattleMode;
  ready: boolean;
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
          <strong>{state.ready ? 'BATTLE' : 'PREPARING'}</strong>
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
      <small className="garage-battle-last">
        Last: <b>{battleModeName(state.lastMode)}</b>
      </small>
    </div>
  );
}

function specLine(design: PortDesign): string {
  if (!design.ship)
    return design.status === 'recovery' ? 'Open it in the shipbuilder to recover a revision.' : 'Open it in the shipbuilder to finish it.';
  const spec = Object.fromEntries(shipSpec(design.ship.definition).map((figure) => [figure.label, figure]));
  const guns = spec['Main battery'];
  return [
    `${Math.round(design.ship.definition.hull.length)} m`,
    `${spec.Displacement.value} t`,
    guns.unit ? `${guns.value} ${guns.unit}` : 'unarmed',
    `${spec.Speed.value} kn`,
  ].join(' · ');
}

function ChestCard({
  design,
  berthed,
  ready,
  onOpen,
  onEdit,
  onClone,
  onDelete,
}: {
  design: PortDesign;
  berthed: boolean;
  ready: boolean;
  onOpen(): void;
  onEdit(): void;
  onClone?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const viewable = !!design.ship;
  return (
    <article className="chest-card" data-berthed={berthed} data-status={design.status}>
      {berthed && (
        <span className="chest-berthed">
          <Icon name="anchor" size={13} />
          Alongside now
        </span>
      )}
      <button
        className="chest-card-open"
        disabled={!ready}
        aria-label={viewable ? `View ${design.name} in port` : `Edit ${design.name}`}
        onClick={viewable ? onOpen : onEdit}
      >
        <span className="chest-thumb">
          <DesignThumbnail design={design} />
        </span>
        <strong>{design.name}</strong>
        <span className="chest-spec">{specLine(design)}</span>
        {design.ship && (
          <span className="chest-scores">
            {shipScores(design.ship.definition).map((score) => (
              <span key={score.id} title={`${score.label} ${score.score}`}>
                <span>
                  {SCORE_SHORT[score.id]}
                  <b>{score.score}</b>
                </span>
                <i>
                  <b style={{ width: `${score.score}%` }} />
                </i>
              </span>
            ))}
          </span>
        )}
      </button>
      <footer>
        <div className="chest-meta">
          <StatusMark status={design.status} />
          {design.head && <span>{editedLabel(design.updatedAt)}</span>}
        </div>
        <div className="chest-actions">
          {viewable && (
            <button className="port-command" disabled={!ready} onClick={onOpen}>
              <strong>{berthed ? 'BACK TO THE QUAY' : 'VIEW IN PORT'}</strong>
              <Icon name="arrow" size={16} />
            </button>
          )}
          <button className={viewable ? 'port-quiet' : 'port-command'} disabled={!ready} onClick={onEdit}>
            <PortIcon name="pencil" size={15} />
            {viewable ? 'Edit' : <strong>EDIT DESIGN</strong>}
          </button>
          {onClone && <CloneDesignButton name={design.name} disabled={!ready} onClone={onClone} />}
          {onDelete && <DeleteDesignButton key={design.id} name={design.name} disabled={!ready} onDelete={onDelete} />}
        </div>
      </footer>
    </article>
  );
}

const FILTERS: { id: PortFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready for sea' },
  { id: 'drafts', label: 'Drafts' },
];
const SORTS: { id: PortSort; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
];

/** Every saved design at once, over the dimmed quay. */
function PlanChest({
  designs,
  berthedId,
  berthedName,
  ready,
  query,
  onClose,
  onView,
  onEdit,
  onBuild,
  onClone,
  onDelete,
}: {
  designs: PortDesign[];
  berthedId?: string;
  berthedName?: string;
  ready: boolean;
  query: string;
  onClose(): void;
  onView(design: PortDesign): void;
  onEdit(design: PortDesign): void;
  onBuild(): void;
  onClone(design: PortDesign): Promise<void>;
  onDelete(design: PortDesign): Promise<void>;
}) {
  const [filter, setFilter] = useState<PortFilter>('all'),
    [sort, setSort] = useState<PortSort>('recent');
  const shown = useMemo(() => sortDesigns(filterDesigns(designs, filter, query), sort), [designs, filter, query, sort]);
  const count = (id: PortFilter) => filterDesigns(designs, id, '').length;
  return (
    <section className="plan-chest" aria-label="Your designs">
      <div className="plan-chest-bar">
        <button className="port-quiet plan-chest-back" onClick={onClose}>
          <PortIcon name="back" size={18} />
          {berthedName ?? 'Port'}
        </button>
        <h1>Your designs</h1>
        <span className="plan-chest-count">{designs.length}</span>
        <div className="plan-chest-filters">
          <div role="group" aria-label="Show designs">
            {FILTERS.map((entry) => (
              <button key={entry.id} className="port-chip" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
                {entry.label} · {count(entry.id)}
              </button>
            ))}
          </div>
          <i aria-hidden="true" />
          <div role="group" aria-label="Sort designs">
            <span>Sort</span>
            {SORTS.map((entry) => (
              <button key={entry.id} className="port-chip" aria-pressed={sort === entry.id} onClick={() => setSort(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="plan-chest-grid">
        <button className="chest-card chest-new" disabled={!ready} onClick={onBuild}>
          <Icon name="plus" size={30} />
          <strong>New design</strong>
          <span>Start from a hull shape or a single block.</span>
        </button>
        {shown.map((design) => (
          <ChestCard
            key={design.id}
            design={design}
            berthed={!!design.ship && design.ship.definition.id === berthedId}
            ready={ready}
            onOpen={() => onView(design)}
            onEdit={() => onEdit(design)}
            onClone={design.head ? () => onClone(design) : undefined}
            onDelete={design.head ? () => onDelete(design) : undefined}
          />
        ))}
        {!shown.length && (
          <p className="plan-chest-empty" role="status">
            {designs.length ? 'No designs match.' : 'No designs yet.'}
          </p>
        )}
      </div>
      <p className="plan-chest-hint">
        <kbd>Esc</kbd>Back to the quay
      </p>
    </section>
  );
}

/** The quay stands empty until the player has a ship that can berth. */
function EmptyPort({
  drafts,
  ready,
  onBuild,
  onChest,
}: {
  drafts: number;
  ready: boolean;
  onBuild(choice?: HullPresetChoice): void;
  onChest(): void;
}) {
  const generic = HULL_PRESETS.filter((preset) => preset.category === 'Generic'),
    historical = HULL_PRESETS.filter((preset) => preset.category !== 'Generic');
  return (
    <section className="port-empty" aria-label="Start a design">
      <p className="port-empty-kicker">{drafts ? 'No ships ready for sea' : 'No ships in port'}</p>
      <h1>{drafts ? 'Finish a draft, or lay down a new ship' : 'Lay down your first ship'}</h1>
      <p>
        {drafts ? (
          <>
            Your {drafts === 1 ? 'draft needs' : `${drafts} drafts need`} finishing in the shipbuilder before {drafts === 1 ? 'it' : 'they'}{' '}
            can berth here.{' '}
            <button className="port-link" onClick={onChest}>
              Open all designs
            </button>
          </>
        ) : (
          'Pick a hull to start from. Every section, fitting and plate stays editable in the shipbuilder.'
        )}
      </p>
      <div className="port-empty-hulls">
        {generic.map((preset) => (
          <button key={preset.id} disabled={!ready} onClick={() => onBuild(preset.id)}>
            <HullPresetPlan preset={preset} />
            <strong>{preset.name}</strong>
            <span>
              {Number(preset.length.toFixed(1))} × {Number(preset.beam.toFixed(1))} m · {preset.note.replace(/^Generic · /, '')}
            </span>
          </button>
        ))}
      </div>
      <div className="port-empty-more">
        <span>Or a historical hull shape</span>
        {historical.map((preset) => (
          <button key={preset.id} className="port-chip" disabled={!ready} onClick={() => onBuild(preset.id)}>
            {preset.name}
          </button>
        ))}
        <i aria-hidden="true" />
        <button className="port-chip" disabled={!ready} onClick={() => onBuild('blank')}>
          Blank 1 m block
        </button>
      </div>
    </section>
  );
}

interface Props {
  /** The port scene: inspection views and the hover feed the tooltip follows. */
  game: (InspectionHoverSource & { setPortInspection(mode: InspectionMode, selected?: readonly string[]): void }) | null;
  ready: boolean;
  switching: boolean;
  switchError: string;
  onSelectShip: (id: string) => void;
  fps: number;
  performance?: PerformanceReadout;
  onBattle: () => void;
  onBuild: (choice?: HullPresetChoice) => void;
  onEditDesign: (id: string) => void;
  onDeleteDesign: (id: string) => void;
  libraryLoading: boolean;
  onChooseBattle: () => void;
  lastMode: BattleMode;
  onSettings: () => void;
  accountName?: string;
  /** A `?ship=` link keeps a historical preset alongside for review; the port otherwise berths only the player's designs. */
  pinned: boolean;
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
  pinned,
}: Props) {
  const selectedShip = useShip();
  const local = useSyncExternalStore(subscribeLocalShips, localShips);
  const library = usePortDesigns();
  const loading = library.loading || libraryLoading;
  const designs = useMemo(() => portDesigns(library.designs, local, loading), [library.designs, local, loading]);
  const fleet = useMemo(() => designs.filter((design) => design.ship), [designs]);
  const berthedIndex = fleet.findIndex((design) => design.ship!.definition.id === selectedShip.id);
  const berthed = berthedIndex >= 0 ? fleet[berthedIndex] : undefined;
  const alongside = !!berthed || pinned;

  const [inspection, setInspection] = useState<InspectionMode>('exterior');
  const [selection, setSelection] = useState<PortSelection>();
  const [chestOpen, setChestOpen] = useState(false),
    [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const inspect = (mode: InspectionMode) => {
    setInspection(mode);
    setSelection(undefined);
  };
  const usable = ready && !switching;
  useEffect(() => {
    if (ready && alongside) game?.setPortInspection(inspection, selection?.ids);
  }, [game, ready, alongside, inspection, selection]);
  useEffect(() => () => game?.setPortInspection('exterior'), [game]);
  // Another ship alongside starts from her exterior, as a fresh visit to the quay would.
  useEffect(() => {
    setInspection('exterior');
    setSelection(undefined);
  }, [selectedShip.id]);

  const berth = (design: PortDesign) => {
    setChestOpen(false);
    if (!design.ship) return;
    rememberDesign(design.ship.source.id);
    if (design.ship.definition.id === selectedShip.id) inspect('exterior');
    else onSelectShip(design.ship.definition.id);
  };
  // With nothing of the player's alongside, berth the design they last looked at, else their newest.
  useEffect(() => {
    if (pinned || berthed || !usable) return;
    const remembered = rememberedDesign();
    const target = fleet.find((design) => design.ship!.source.id === remembered) ?? (loading ? undefined : fleet[0]);
    if (target) onSelectShip(target.ship!.definition.id);
  }, [pinned, berthed, usable, fleet, loading]);
  useEffect(() => {
    if (berthed) rememberDesign(berthed.ship!.source.id);
  }, [berthed?.ship?.source.id]);

  const previous = berthed && fleet.length > 1 ? fleet[(berthedIndex - 1 + fleet.length) % fleet.length] : undefined;
  const next = berthed && fleet.length > 1 ? fleet[(berthedIndex + 1) % fleet.length] : undefined;
  const keys = useRef({ previous, next, chestOpen, berth, selection });
  keys.current = { previous, next, chestOpen, berth, selection };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const { previous, next, chestOpen, berth, selection } = keys.current;
      if (event.key === 'Escape') {
        // Back out one step: the chest, then an isolated volume, then the model view.
        if (chestOpen) setChestOpen(false);
        else if (selection) setSelection(undefined);
        else setInspection('exterior');
        return;
      }
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      if (typing || chestOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' && previous) berth(previous);
      if (event.key === 'ArrowRight' && next) berth(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (chestOpen) search.current?.focus();
    else setQuery('');
  }, [chestOpen]);

  const remove = async (design: PortDesign) => {
    const store = await openConstructionStore();
    try {
      await store.remove(design.head!.id, design.head!.revisionId);
      onDeleteDesign(design.head!.id);
      library.refresh();
    } catch (error) {
      library.refresh();
      throw error;
    } finally {
      store.close();
    }
  };
  /** The clone joins the library as its own design, then comes alongside once she has compiled. */
  const clone = async (design: PortDesign) => {
    const store = await openConstructionStore();
    let cloneId: string;
    try {
      cloneId = (await cloneConstructionDesign(store, design.head!.id)).sourceId;
    } finally {
      store.close();
    }
    library.refresh();
    await restoreLocalShips();
    const ship = localShips().find((ship) => ship.source.id === cloneId);
    if (ship) {
      setChestOpen(false);
      rememberDesign(cloneId);
      onSelectShip(ship.definition.id);
    }
  };
  const edit = (design: PortDesign) => onEditDesign(design.id);

  const state: GarageState = {
    battle: onBattle,
    chooseBattle: onChooseBattle,
    lastMode,
    ready: usable,
  };
  const model = shipModel(selectedShip);
  const underway = !alongside && fleet.length > 0;

  return (
    <div className={`garage ${chestOpen ? 'port-chest-open' : ''} ${alongside ? '' : 'port-berth-empty'}`}>
      <div className="garage-scene-shade" />
      <div className="garage-layout">
        <header className="garage-classic-header">
          <button className="garage-account" title="Open the menu" aria-haspopup="dialog" disabled={!usable} onClick={onSettings}>
            <Icon name="compass" size={18} />
            <strong>{accountName ?? 'Menu'}</strong>
          </button>
          <PerformanceCounter className="garage-preview-meta" fps={fps} performance={performance} />
          <div className="garage-classic-deploy">
            <SetSail state={state} />
          </div>
          <div className="port-header-actions">
            {chestOpen ? (
              <label className="port-search">
                <PortIcon name="search" size={15} />
                <input
                  ref={search}
                  type="search"
                  aria-label="Find a design"
                  placeholder="Find a design"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            ) : (
              <>
                <button className="port-quiet port-new" disabled={!usable} onClick={() => onBuild()}>
                  <Icon name="plus" size={16} />
                  <span>New design</span>
                </button>
                <button className="port-quiet" aria-haspopup="dialog" onClick={() => setChestOpen(true)}>
                  <PortIcon name="grid" />
                  <span>All designs</span>
                  <b>{designs.length}</b>
                </button>
              </>
            )}
          </div>
        </header>

        <div className="port-quay" inert={chestOpen}>
          {alongside && (
            <>
              <div className="port-panel-shade" aria-hidden="true" />
              <section className="port-identity" aria-label={shipTitle(selectedShip)}>
                <div className="port-identity-status">
                  {berthed ? (
                    <>
                      <StatusMark status="ready" />
                      {berthed.head && <span>{editedLabel(berthed.updatedAt)}</span>}
                    </>
                  ) : (
                    <>
                      <span className="port-identity-type">{model.type}</span>
                      {(model.nation || model.year) && <span>{[model.nation, model.year].filter(Boolean).join(' · ')}</span>}
                    </>
                  )}
                </div>
                <h1>{shipTitle(selectedShip)}</h1>
                <dl className="port-spec">
                  {shipSpec(selectedShip).map((figure) => (
                    <div key={figure.label}>
                      <dt>{figure.label}</dt>
                      <dd>
                        {figure.value}
                        {figure.unit && <small>{figure.unit}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {berthed && (
                  <div className="port-actions">
                    <button className="port-command" disabled={!usable} onClick={() => edit(berthed)}>
                      <PortIcon name="pencil" size={17} />
                      <strong>EDIT DESIGN</strong>
                    </button>
                    {berthed.head && <CloneDesignButton name={berthed.name} disabled={!usable} onClone={() => clone(berthed)} />}
                    {berthed.head && (
                      <DeleteDesignButton key={berthed.id} name={berthed.name} disabled={!usable} onDelete={() => remove(berthed)} />
                    )}
                  </div>
                )}
              </section>
              <PortPanel
                definition={selectedShip}
                mode={inspection}
                onMode={inspect}
                ready={usable}
                selection={selection}
                onSelect={setSelection}
              />
              {previous && (
                <button
                  className="port-neighbour port-neighbour-previous"
                  disabled={!usable}
                  aria-label={`Previous design: ${previous.name}`}
                  onClick={() => berth(previous)}
                >
                  <span>
                    <PortIcon name="left" size={22} />
                  </span>
                  <small>{previous.name}</small>
                </button>
              )}
              {next && (
                <button
                  className="port-neighbour port-neighbour-next"
                  disabled={!usable}
                  aria-label={`Next design: ${next.name}`}
                  onClick={() => berth(next)}
                >
                  <span>
                    <PortIcon name="right" size={22} />
                  </span>
                  <small>{next.name}</small>
                </button>
              )}
            </>
          )}
          {!alongside && !underway && !loading && !switching && (
            <EmptyPort drafts={designs.length} ready={usable} onBuild={onBuild} onChest={() => setChestOpen(true)} />
          )}
          {!alongside && (loading || underway) && !switching && (
            <p className="port-loading" role="status">
              Loading your designs…
            </p>
          )}
          {library.error && (
            <p className="port-loading" role="alert">
              {library.error}{' '}
              <button className="port-link" onClick={library.refresh}>
                Retry
              </button>
            </p>
          )}

          {fleet.length > 0 && (
            <nav className="port-fleet-line" aria-label="Fleet line">
              {fleet.length > 1 && <kbd aria-hidden="true">←</kbd>}
              {fleetLineWindow(fleet, Math.max(0, berthedIndex)).map((design) => (
                <button
                  key={design.id}
                  disabled={!usable}
                  title={design.name}
                  aria-label={design.name}
                  aria-pressed={design === berthed}
                  onClick={() => berth(design)}
                >
                  <DesignThumbnail design={design} />
                </button>
              ))}
              {fleet.length > 1 && <kbd aria-hidden="true">→</kbd>}
              <i aria-hidden="true" />
              <button
                className="port-quiet port-fleet-all"
                aria-haspopup="dialog"
                aria-label="Open all designs"
                onClick={() => setChestOpen(true)}
              >
                <PortIcon name="grid" size={15} />
                All {designs.length}
              </button>
            </nav>
          )}
        </div>

        {chestOpen && (
          <PlanChest
            designs={designs}
            berthedId={berthed?.ship!.definition.id}
            berthedName={alongside ? shipTitle(selectedShip) : undefined}
            ready={usable}
            query={query}
            onClose={() => setChestOpen(false)}
            onView={berth}
            onEdit={edit}
            onBuild={() => onBuild()}
            onClone={clone}
            onDelete={remove}
          />
        )}
      </div>
      <InspectionTooltip game={game} />
      {switchError ? (
        <div className="garage-loading" role="alert">
          <span>{switchError}</span>
        </div>
      ) : (
        switching && (
          <svg className="garage-spinner" role="status" aria-label="Preparing ship" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="2.2" />
            <path id="garage-spinner-blade" d="M12 10.2c-.6-3.2.4-6.6 2.6-8.2 1.9 2.2 1.6 5.8-.8 8.2Z" />
            <use href="#garage-spinner-blade" transform="rotate(120 12 12)" />
            <use href="#garage-spinner-blade" transform="rotate(240 12 12)" />
          </svg>
        )
      )}
    </div>
  );
}
