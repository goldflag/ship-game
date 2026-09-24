// Home port: the ships the player owns lie alongside one at a time, grouped by nation, then their own designs.
// The tech tree unlocks historical ships with XP; the plan chest holds the whole design library.
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
import type { HullPresetChoice } from '../ships/constructionHullPresets';
import { PORT_STATUS_LABEL, editedLabel, filterDesigns, portDesigns, sortDesigns, type PortDesign, type PortFilter, type PortSort } from './portDesigns';
import { fallbackBerth, portFleet, rememberBerth, type FleetEntry } from './portFleet';
import { PortIcon } from './PortIcon';
import { TechTree, formatXp, nodeType, research, useUnlock, type Research } from './TechTree';
import { useProgress } from './useProgress';
import { canCommandPreset, type ProgressSnapshot } from '../progression/store';
import { TECH_TREE, presetNation, presetPlace, type TechNation } from '../progression/techTree';
import { NationFlag } from './battle/NationFlag';
import { ShipThumbnail } from './battle/ShipCard';

const SCORE_SHORT: Record<StatScoreId, string> = {
  survivability: 'Surv',
  artillery: 'Art',
  airDefense: 'AA',
  maneuverability: 'Man',
  concealment: 'Con',
};

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
  /** A locked tree ship alongside for inspection: the command unlocks her instead of sailing. */
  locked?: Research;
  /** Progress has loaded, so XP can be spent. */
  unlockable: boolean;
  unlock(nodeId: string): Promise<void>;
};

/** Where an unlock's XP comes from, in the few words the top bar has room for. */
const shortSpend = ({ spend, nation }: Research) =>
  [spend.nation && `${formatXp(spend.nation)} ${nation.short} XP`, spend.free && `${formatXp(spend.free)} free XP`].filter(Boolean).join(' + ');

/** BATTLE's place while a locked ship is alongside: the unlock, with the reason when it cannot be had yet. */
function UnlockCommand({ view, ready, unlockable, onUnlock }: { view: Research; ready: boolean; unlockable: boolean; onUnlock(nodeId: string): Promise<void> }) {
  const unlock = useUnlock(view.node.id, onUnlock);
  const can = unlockable && view.state === 'available';
  const reason = unlock.error
    ? unlock.error
    : unlock.confirming
      ? `Spends ${shortSpend(view)} for good · Esc cancels`
      : view.state === 'available'
        ? `Paid from ${shortSpend(view)}`
        : view.state === 'short'
          ? `${view.status} · earn it in battle`
          : view.state === 'blocked'
            ? view.detail.replace(/\.$/, '')
            : 'Research progress is offline';
  return (
    <div
      className="garage-battle"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && unlock.confirming) {
          event.stopPropagation();
          unlock.cancel();
        }
      }}
    >
      <div className="garage-battle-split">
        <button
          className="garage-set-sail garage-unlock"
          data-confirming={unlock.confirming}
          data-held={!can}
          aria-describedby="garage-unlock-reason"
          disabled={!ready || !can || unlock.busy}
          onClick={unlock.confirming ? () => void unlock.confirm() : unlock.offer}
        >
          <PortIcon name={can ? 'tree' : 'lock'} size={20} />
          <strong>{unlock.busy ? 'UNLOCKING…' : unlock.confirming ? 'CONFIRM UNLOCK' : `UNLOCK · ${formatXp(view.node.cost)} XP`}</strong>
        </button>
        {unlock.confirming && (
          <button className="garage-battle-caret" aria-label="Cancel the unlock" title="Cancel" disabled={unlock.busy} onClick={unlock.cancel}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <small className="garage-battle-last" id="garage-unlock-reason" data-state={unlock.error ? 'error' : view.state} role={unlock.error ? 'alert' : undefined}>
        {reason}
      </small>
    </div>
  );
}

/** The tech tree command, with the berthed ship's nation XP and the free XP; every nation on hover or focus. */
function ResearchButton({ snapshot, nation, open, onOpen }: { snapshot: ProgressSnapshot; nation?: TechNation; open: boolean; onOpen(): void }) {
  const { profile, status } = snapshot;
  return (
    <div className="port-research">
      <button className="port-quiet port-research-open" aria-haspopup="dialog" aria-expanded={open} aria-describedby="port-xp-ledger" onClick={onOpen}>
        <PortIcon name="tree" size={18} />
        <span className="port-research-text">
          <span>Tech tree</span>
          <small>
            {status !== 'ready' ? (
              status === 'loading' ? (
                'Loading XP…'
              ) : (
                'XP offline'
              )
            ) : (
              <>
                {nation && (
                  <>
                    <NationFlag nation={nation.name} width={13} />
                    <b>{formatXp(profile.xp[nation.id])}</b>
                    <i aria-hidden="true">·</i>
                  </>
                )}
                <b>{formatXp(profile.freeXp)}</b> free
              </>
            )}
          </small>
        </span>
      </button>
      <div className="port-xp-ledger" id="port-xp-ledger" role="tooltip">
        <strong>Research XP</strong>
        <dl>
          {TECH_TREE.map((entry) => (
            <div key={entry.id} data-current={entry.id === nation?.id}>
              <dt>
                <NationFlag nation={entry.name} width={14} />
                {entry.name}
              </dt>
              <dd>{formatXp(profile.xp[entry.id])}</dd>
            </div>
          ))}
          <div className="port-xp-free">
            <dt>Free XP, any nation</dt>
            <dd>{formatXp(profile.freeXp)}</dd>
          </div>
        </dl>
        <small>Battles earn XP for the nations you field; a tenth, and all that player designs earn, is free XP.</small>
      </div>
    </div>
  );
}

function SetSail({ state }: { state: GarageState }) {
  if (state.locked)
    return <UnlockCommand key={state.locked.node.id} view={state.locked} ready={state.ready} unlockable={state.unlockable} onUnlock={state.unlock} />;
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


/** How a fleet entry is named on the quay: historical names in capitals, designs as typed. */
const entryTitle = (entry: FleetEntry) => shipTitle({ id: entry.shipId, name: entry.name });

type Overlay = 'chest' | 'tree';

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
  /** A `?ship=` link keeps its preset alongside for review, whether or not the player owns her, and enemy-only presets too. */
  pinned: boolean;
  /** The design this browser last berthed, still compiling: the quay waits for her instead of showing the opening preset. */
  opening?: string;
  /** The opening design is alongside, or gone: the quay may show whatever is berthed. */
  onOpened?: () => void;
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
  opening,
  onOpened,
}: Props) {
  const selectedShip = useShip();
  const { store, snapshot } = useProgress();
  const local = useSyncExternalStore(subscribeLocalShips, localShips, localShips);
  const library = usePortDesigns();
  const loading = library.loading || libraryLoading;
  const designs = useMemo(() => portDesigns(library.designs, local, loading), [library.designs, local, loading]);

  // A locked tree ship stays alongside only when the player chose her from the tree, or a `?ship=` link named her.
  const [previewId, setPreviewId] = useState<string>();
  const place = presetPlace(selectedShip.id);
  const lockedHere = !!place && !canCommandPreset(snapshot, selectedShip.id);
  const previewing = lockedHere && (pinned || previewId === selectedShip.id);
  const groups = useMemo(() => portFleet(snapshot, designs, previewing ? selectedShip.id : undefined), [snapshot, designs, previewing, selectedShip.id]);
  const order = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const berthedIndex = order.findIndex((entry) => entry.shipId === selectedShip.id);
  const berthed = berthedIndex >= 0 ? order[berthedIndex] : undefined;
  const berthedDesign = berthed?.kind === 'design' ? berthed.design : undefined;
  const alongside = !opening && (!!berthed || pinned);
  const locked = previewing ? research(snapshot, selectedShip.id) : undefined;

  const [inspection, setInspection] = useState<InspectionMode>('exterior');
  const [selection, setSelection] = useState<PortSelection>();
  const [overlay, setOverlay] = useState<Overlay>(),
    [query, setQuery] = useState('');
  const chestOpen = overlay === 'chest';
  const search = useRef<HTMLInputElement>(null);
  const line = useRef<HTMLDivElement>(null);
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

  const berth = (entry: FleetEntry) => {
    setOverlay(undefined);
    if (entry.shipId === selectedShip.id) inspect('exterior');
    else onSelectShip(entry.shipId);
  };
  /** From the tree: any modelled ship, owned or not, comes alongside. */
  const viewPreset = (presetId: string) => {
    setOverlay(undefined);
    setPreviewId(canCommandPreset(snapshot, presetId) ? undefined : presetId);
    if (presetId === selectedShip.id) inspect('exterior');
    else onSelectShip(presetId);
  };

  // The design last berthed here comes alongside once she has compiled; if she is gone, the opening preset stays.
  const openingTried = useRef(false);
  useEffect(() => {
    if (!opening || !usable) return;
    const design = order.find((entry) => entry.kind === 'design' && entry.design.ship!.source.id === opening);
    if (design && design.shipId !== selectedShip.id && !openingTried.current) {
      openingTried.current = true;
      onSelectShip(design.shipId);
    } else if (design || !loading || switchError) onOpened?.();
  }, [opening, usable, order, loading, selectedShip.id, switchError]);
  // A ship that is not the player's (locked once progress loads, or a deleted design) gives way to one that is.
  useEffect(() => {
    if (pinned || opening || !usable || berthed || previewing || switchError) return;
    const target = fallbackBerth(order);
    if (target && target.shipId !== selectedShip.id) onSelectShip(target.shipId);
  }, [pinned, opening, usable, berthed, previewing, order, selectedShip.id, switchError]);
  useEffect(() => {
    if (berthed && !opening) rememberBerth(berthed);
  }, [berthed?.key, opening]);
  // The fleet line scrolls the ship alongside into view.
  useEffect(() => {
    const scroller = line.current,
      item = scroller?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (scroller && item) scroller.scrollTo({ left: item.offsetLeft - (scroller.clientWidth - item.offsetWidth) / 2, behavior: 'smooth' });
  }, [berthed?.key, order.length]);

  const previous = berthed && order.length > 1 ? order[(berthedIndex - 1 + order.length) % order.length] : undefined;
  const next = berthed && order.length > 1 ? order[(berthedIndex + 1) % order.length] : undefined;
  const keys = useRef({ previous, next, overlay, berth, selection });
  keys.current = { previous, next, overlay, berth, selection };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const { previous, next, overlay, berth, selection } = keys.current;
      if (event.key === 'Escape') {
        // Back out one step: the chest or the tree, then an isolated volume, then the model view.
        if (overlay) setOverlay(undefined);
        else if (selection) setSelection(undefined);
        else setInspection('exterior');
        return;
      }
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      if (typing || overlay || event.metaKey || event.ctrlKey || event.altKey) return;
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
    const constructions = await openConstructionStore();
    let cloneId: string;
    try {
      cloneId = (await cloneConstructionDesign(constructions, design.head!.id)).sourceId;
    } finally {
      constructions.close();
    }
    library.refresh();
    await restoreLocalShips();
    const ship = localShips().find((ship) => ship.source.id === cloneId);
    if (ship) {
      setOverlay(undefined);
      onSelectShip(ship.definition.id);
    }
  };
  const edit = (design: PortDesign) => onEditDesign(design.id);
  const unlock = (nodeId: string) => store.unlock(nodeId);

  const state: GarageState = {
    battle: onBattle,
    chooseBattle: onChooseBattle,
    lastMode,
    ready: usable,
    locked,
    unlockable: snapshot.status === 'ready',
    unlock,
  };
  const model = shipModel(selectedShip);
  const berthedNation = presetNation(selectedShip.id);

  return (
    <div className={`garage ${overlay ? 'port-overlay-open' : ''} ${chestOpen ? 'port-chest-open' : ''} ${alongside ? '' : 'port-berth-empty'}`}>
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
            <ResearchButton
              snapshot={snapshot}
              nation={berthedNation ? TECH_TREE.find((nation) => nation.id === berthedNation) : undefined}
              open={overlay === 'tree'}
              onOpen={() => setOverlay(overlay === 'tree' ? undefined : 'tree')}
            />
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
                <button className="port-quiet" aria-haspopup="dialog" onClick={() => setOverlay('chest')}>
                  <PortIcon name="grid" />
                  <span>All designs</span>
                  <b>{designs.length}</b>
                </button>
              </>
            )}
          </div>
        </header>

        <div className="port-quay" inert={!!overlay}>
          {alongside && (
            <>
              <div className="port-panel-shade" aria-hidden="true" />
              <section className="port-identity" aria-label={shipTitle(selectedShip)}>
                <div className="port-identity-status">
                  {berthedDesign ? (
                    <>
                      <StatusMark status="ready" />
                      {berthedDesign.head && <span>{editedLabel(berthedDesign.updatedAt)}</span>}
                    </>
                  ) : place ? (
                    <>
                      {locked && (
                        <span className="port-locked-mark">
                          <PortIcon name="lock" size={13} />
                          Locked
                        </span>
                      )}
                      <span className="port-identity-type">{nodeType(place.node)}</span>
                      <span className="port-identity-nation">
                        <NationFlag nation={place.nation.name} width={16} />
                        {place.nation.name} · {place.node.year}
                      </span>
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
                {berthedDesign && (
                  <div className="port-actions">
                    <button className="port-command" disabled={!usable} onClick={() => edit(berthedDesign)}>
                      <PortIcon name="pencil" size={17} />
                      <strong>EDIT DESIGN</strong>
                    </button>
                    {berthedDesign.head && <CloneDesignButton name={berthedDesign.name} disabled={!usable} onClone={() => clone(berthedDesign)} />}
                    {berthedDesign.head && (
                      <DeleteDesignButton key={berthedDesign.id} name={berthedDesign.name} disabled={!usable} onDelete={() => remove(berthedDesign)} />
                    )}
                  </div>
                )}
                {locked && (
                  <div className="port-locked" data-state={locked.state}>
                    <p>
                      <b>{formatXp(locked.node.cost)} XP</b>
                      <span>{locked.state === 'available' ? 'Ready to unlock. ' : ''}{locked.detail}</span>
                    </p>
                    <button className="port-quiet" onClick={() => setOverlay('tree')}>
                      <PortIcon name="tree" size={16} />
                      See her line in the tech tree
                    </button>
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
                  aria-label={`Previous ship: ${previous.name}`}
                  onClick={() => berth(previous)}
                >
                  <span>
                    <PortIcon name="left" size={22} />
                  </span>
                  <small>{entryTitle(previous)}</small>
                </button>
              )}
              {next && (
                <button className="port-neighbour port-neighbour-next" disabled={!usable} aria-label={`Next ship: ${next.name}`} onClick={() => berth(next)}>
                  <span>
                    <PortIcon name="right" size={22} />
                  </span>
                  <small>{entryTitle(next)}</small>
                </button>
              )}
            </>
          )}
          {!alongside && !switching && (loading || opening) && (
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

          <nav className="port-fleet-line" aria-label="Fleet line">
            {order.length > 1 && <kbd aria-hidden="true">←</kbd>}
            <div className="port-fleet-scroll" ref={line} onWheel={(event) => {
              // A vertical wheel walks the line sideways; the camera keeps the wheel everywhere else.
              if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
            }}>
              {groups.map((group) => (
                <div key={group.id} className="port-fleet-group" role="group" aria-label={group.label} data-group={group.id}>
                  <span className="port-fleet-label" aria-hidden="true">
                    {group.nation && <NationFlag nation={group.nation.name} width={13} />}
                    {group.label}
                  </span>
                  <div className="port-fleet-ships">
                    {group.entries.map((entry) => {
                      const lockedEntry = entry.kind === 'preset' && !!entry.locked;
                      return (
                        <button
                          key={entry.key}
                          disabled={!usable}
                          data-locked={lockedEntry || undefined}
                          title={entry.kind === 'preset' ? `${entryTitle(entry)} · ${nodeType(entry.node)}${lockedEntry ? ' · locked' : ''}` : entry.name}
                          aria-label={lockedEntry ? `${entry.name}, locked` : entry.name}
                          aria-pressed={entry === berthed}
                          onClick={() => berth(entry)}
                        >
                          {entry.kind === 'preset' ? <ShipThumbnail presetId={entry.shipId} width={88} /> : <DesignThumbnail design={entry.design} />}
                          {lockedEntry && <PortIcon name="lock" size={11} />}
                        </button>
                      );
                    })}
                    {group.id === 'designs' && (
                      <>
                        <button className="port-quiet port-fleet-new" disabled={!usable} aria-label="New design" title="New design" onClick={() => onBuild()}>
                          <Icon name="plus" size={15} />
                        </button>
                        <button className="port-quiet port-fleet-all" aria-haspopup="dialog" aria-label="Open all designs" onClick={() => setOverlay('chest')}>
                          <PortIcon name="grid" size={15} />
                          All {designs.length}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {order.length > 1 && <kbd aria-hidden="true">→</kbd>}
          </nav>
        </div>

        {chestOpen && (
          <PlanChest
            designs={designs}
            berthedId={berthedDesign?.ship!.definition.id}
            berthedName={alongside ? shipTitle(selectedShip) : undefined}
            ready={usable}
            query={query}
            onClose={() => setOverlay(undefined)}
            onView={(design) => {
              const entry = order.find((item) => item.kind === 'design' && item.design.id === design.id);
              if (entry) berth(entry);
              else setOverlay(undefined);
            }}
            onEdit={edit}
            onBuild={() => onBuild()}
            onClone={clone}
            onDelete={remove}
          />
        )}
        {overlay === 'tree' && (
          <TechTree
            snapshot={snapshot}
            berthedId={alongside ? selectedShip.id : undefined}
            berthedName={alongside ? shipTitle(selectedShip) : undefined}
            initialNation={berthedNation ?? 'usa'}
            initialNode={place?.node.id}
            ready={usable}
            onClose={() => setOverlay(undefined)}
            onView={viewPreset}
            onUnlock={unlock}
            onRetry={() => void store.refresh()}
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
