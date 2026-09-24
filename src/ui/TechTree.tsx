// The research tree over the dimmed quay: one tab per nation, one column per line, each line's classes running down
// oldest first. Modelled ships can be viewed in port whatever their state and unlocked with XP; placeholders mark
// classes not in the game yet and never gate progress.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ShipClass } from '../game/shipModel';
import { nodeState, unlockSpend, type NodeState } from '../progression/rules';
import type { ProgressSnapshot } from '../progression/store';
import { TECH_TREE, nodePlace, prerequisite, techNation, type LineId, type NationId, type NodePlace, type TechNation, type TechNode } from '../progression/techTree';
import { NationFlag } from './battle/NationFlag';
import { ShipThumbnail } from './battle/ShipCard';
import { Icon } from './Icons';
import { PortIcon } from './PortIcon';
import { ShipClassIcon } from './ShipClassIcons';
import './TechTree.css';

export const formatXp = (value: number) => value.toLocaleString('en-US');
/** Every tree name is historical, so it is set in capitals as `shipTitle` sets presets. */
export const treeName = (node: Pick<TechNode, 'name'>) => node.name.toUpperCase();
/** "Destroyer · Kagerō class" when the modelled ship is not the class leader. */
export const nodeType = (node: TechNode) => (node.className !== node.name ? `${node.type} · ${node.className} class` : node.type);

/** A node as the tree shows it. `open`: progress has not loaded or cannot load, so the ship stays available and
 * nothing can be unlocked meanwhile. */
export type TreeState = NodeState | 'open';
export function treeState(snapshot: ProgressSnapshot, id: string): TreeState {
  const state = nodeState(snapshot.profile, id);
  return state === 'owned' || state === 'placeholder' || snapshot.status === 'ready' ? state : 'open';
}

export interface Research {
  node: TechNode;
  nation: TechNation;
  state: TreeState;
  /** A few words for the node itself. */
  status: string;
  /** One sentence for the selection line and the port's locked plate. */
  detail: string;
  /** How much of each pool an unlock would draw. */
  spend: { nation: number; free: number };
}
const paidFrom = (spend: { nation: number; free: number }, nation: TechNation) =>
  [spend.nation && `${formatXp(spend.nation)} ${nation.name} XP`, spend.free && `${formatXp(spend.free)} free XP`].filter(Boolean).join(' and ');
export function research(snapshot: ProgressSnapshot, id: string): Research | undefined {
  const place = nodePlace(id);
  return place && describeResearch(snapshot, place, treeState(snapshot, id));
}
/** The words for a node in a given state (split from `research` so every state can be checked). */
export function describeResearch(snapshot: ProgressSnapshot, place: NodePlace, state: TreeState): Research {
  const { node, nation } = place,
    { profile } = snapshot;
  const spend = unlockSpend(profile, node, nation.id);
  const missing = Math.max(0, node.cost - profile.xp[nation.id] - profile.freeXp),
    before = prerequisite(node.id);
  const text: Record<TreeState, [string, string]> = {
    owned: [node.starter ? 'Starter' : 'Owned', node.starter ? 'In your fleet from the start.' : 'In your fleet.'],
    available: ['Ready to unlock', `Paid from ${paidFrom(spend, nation)}.`],
    short: [
      `${formatXp(missing)} XP short`,
      `Needs ${formatXp(missing)} more XP: you have ${formatXp(profile.xp[nation.id])} ${nation.name} XP and ${formatXp(profile.freeXp)} free XP.`,
    ],
    blocked: [`After ${before ? treeName(before) : 'the ship above'}`, `Unlock ${before ? treeName(before) : 'the ship above'} first.`],
    open: [
      'Open for now',
      snapshot.status === 'loading' ? 'Research progress is loading.' : 'Research progress is unavailable, so every ship stays open for now.',
    ],
    placeholder: ['Not in the game yet', `${node.className} is not in the game yet.`],
  };
  return { node, nation, state, status: text[state][0], detail: text[state][1], spend: { nation: spend.nation, free: spend.free } };
}

/** A second press sooner than this after the offer is a double-click, not a decision. */
const CONFIRM_GUARD_MS = 400;
/** Unlocking spends XP for good, so it takes two presses: the offer, then Confirm. */
export function useUnlock(nodeId: string, onUnlock: (nodeId: string) => Promise<void>) {
  const [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setConfirming(false);
    setError('');
  }, [nodeId]);
  const pending = useRef(false),
    offered = useRef(0);
  return {
    confirming,
    busy,
    error,
    offer: () => {
      offered.current = performance.now();
      setError('');
      setConfirming(true);
    },
    cancel: () => {
      if (!pending.current) setConfirming(false);
    },
    async confirm() {
      if (pending.current || performance.now() - offered.current < CONFIRM_GUARD_MS) return;
      pending.current = true;
      setBusy(true);
      setError('');
      try {
        await onUnlock(nodeId);
        setConfirming(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
  };
}

const LINE_CLASS: Record<LineId, ShipClass> = {
  destroyers: 'Destroyer',
  cruisers: 'Cruiser',
  battleships: 'Battleship',
  carriers: 'Carrier',
  submarines: 'Submarine',
  escorts: 'Other',
};

type LinkState = 'owned' | 'next' | 'far' | 'unbuilt';
function linkState(above: TreeState, below: TreeState): LinkState {
  if (above === 'placeholder' || below === 'placeholder') return 'unbuilt';
  if ((above === 'owned' || above === 'open') && (below === 'owned' || below === 'open')) return 'owned';
  return above === 'owned' ? 'next' : 'far';
}

function StateMark({ view }: { view: Research }) {
  const { node, state } = view;
  return (
    <span className="tech-node-state">
      {state === 'owned' ? <PortIcon name="check" size={14} /> : state === 'blocked' ? <PortIcon name="lock" size={13} /> : null}
      {state !== 'owned' && <b>{formatXp(node.cost)} XP</b>}
      <span>{view.status}</span>
    </span>
  );
}

function NodePlate({
  view,
  lineClass,
  selected,
  berthed,
  column,
  row,
  onSelect,
}: {
  view: Research;
  lineClass: ShipClass;
  selected: boolean;
  berthed: boolean;
  column: number;
  row: number;
  onSelect(): void;
}) {
  const { node, state } = view;
  const body = (
    <>
      <span className="tech-node-thumb">
        {node.presetId ? <ShipThumbnail presetId={node.presetId} width={120} /> : <ShipClassIcon shipClass={lineClass} width={56} />}
      </span>
      <span className="tech-node-text">
        <span className="tech-node-title">
          <strong>{treeName(node)}</strong>
          <small>{node.year}</small>
        </span>
        <span className="tech-node-type">{nodeType(node)}</span>
        <StateMark view={view} />
      </span>
      {berthed && (
        <span className="tech-node-berthed">
          <Icon name="anchor" size={12} />
          Alongside
        </span>
      )}
    </>
  );
  if (!node.presetId)
    return (
      <div className="tech-node" data-state={state}>
        {body}
      </div>
    );
  return (
    <button
      className="tech-node"
      data-state={state}
      data-column={column}
      data-row={row}
      aria-pressed={selected}
      aria-label={`${treeName(node)}, ${nodeType(node)}, ${node.year}. ${view.detail}`}
      onClick={onSelect}
    >
      {body}
    </button>
  );
}

/** Arrow keys walk the modelled nodes: up and down a line, across to the nearest node of the next line. */
function walk(event: KeyboardEvent<HTMLElement>) {
  const from = (event.target as HTMLElement).closest<HTMLElement>('button.tech-node');
  if (!from || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button.tech-node')];
  const at = (element: HTMLElement) => [Number(element.dataset.column), Number(element.dataset.row)];
  const [column, row] = at(from);
  let target: HTMLElement | undefined;
  if (event.key === 'Home' || event.key === 'End') target = event.key === 'Home' ? nodes[0] : nodes[nodes.length - 1];
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const line = nodes.filter((node) => at(node)[0] === column);
    target = event.key === 'ArrowUp' ? line.filter((node) => at(node)[1] < row).pop() : line.find((node) => at(node)[1] > row);
  } else {
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    const columns = [...new Set(nodes.map((node) => at(node)[0]))].sort((a, b) => a - b);
    const next = columns[columns.indexOf(column) + step];
    const line = nodes.filter((node) => at(node)[0] === next);
    target = line.sort((a, b) => Math.abs(at(a)[1] - row) - Math.abs(at(b)[1] - row))[0];
  }
  if (!target) return;
  event.preventDefault();
  target.focus();
}

function Selection({
  view,
  berthed,
  ready,
  unlockable,
  onView,
  onUnlock,
}: {
  view: Research;
  berthed: boolean;
  ready: boolean;
  unlockable: boolean;
  onView(): void;
  onUnlock(nodeId: string): Promise<void>;
}) {
  const { node, nation, state } = view;
  const unlock = useUnlock(node.id, onUnlock);
  const canUnlock = unlockable && state === 'available';
  return (
    <>
      <span className="tech-selection-thumb">{node.presetId && <ShipThumbnail presetId={node.presetId} width={168} />}</span>
      <div className="tech-selection-name">
        <strong>{treeName(node)}</strong>
        <span>
          <NationFlag nation={nation.name} /> {nodeType(node)} · {node.year}
        </span>
      </div>
      <p className="tech-selection-detail" data-state={state}>
        {unlock.confirming ? `This spends ${paidFrom(view.spend, nation)} and cannot be undone.` : view.detail}
        {unlock.error && (
          <span className="tech-selection-error" role="alert">
            {unlock.error}
          </span>
        )}
      </p>
      <div
        className="tech-selection-actions"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && unlock.confirming) {
            event.stopPropagation();
            unlock.cancel();
          }
        }}
      >
        {unlock.confirming ? (
          <>
            <button className="port-quiet" disabled={unlock.busy} onClick={unlock.cancel}>
              Cancel
            </button>
            <button autoFocus className="port-command tech-confirm" disabled={unlock.busy} onClick={() => void unlock.confirm()}>
              <strong>{unlock.busy ? 'UNLOCKING…' : `CONFIRM · ${formatXp(node.cost)} XP`}</strong>
            </button>
          </>
        ) : (
          <>
            <button className={state === 'owned' ? 'port-command' : 'port-quiet'} disabled={!ready} onClick={onView}>
              {state === 'owned' ? <strong>{berthed ? 'BACK TO THE QUAY' : 'VIEW IN PORT'}</strong> : berthed ? 'Back to the quay' : 'View in port'}
              <Icon name="arrow" size={16} />
            </button>
            {state !== 'owned' && (
              <button className="port-command tech-unlock" disabled={!canUnlock} onClick={unlock.offer}>
                <PortIcon name={canUnlock ? 'tree' : 'lock'} size={16} />
                <strong>UNLOCK · {formatXp(node.cost)} XP</strong>
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

export interface TechTreeProps {
  snapshot: ProgressSnapshot;
  /** The ship alongside, so her node is marked and the back button can name her. */
  berthedId?: string;
  berthedName?: string;
  initialNation: NationId;
  initialNode?: string;
  ready: boolean;
  onClose(): void;
  /** Berth a modelled ship, owned or not, and return to the quay. */
  onView(presetId: string): void;
  onUnlock(nodeId: string): Promise<void>;
  onRetry?(): void;
}

export function TechTree({ snapshot, berthedId, berthedName, initialNation, initialNode, ready, onClose, onView, onUnlock, onRetry }: TechTreeProps) {
  const [nationId, setNationId] = useState(initialNation),
    [selectedId, setSelectedId] = useState(initialNode);
  const nation = techNation(nationId),
    { profile } = snapshot;
  const selected = selectedId && nodePlace(selectedId)?.nation.id === nationId && nodePlace(selectedId)?.node.presetId ? research(snapshot, selectedId) : undefined;
  const unlockable = snapshot.status === 'ready';
  const tabs = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null);
  // Another nation starts from the top of her tree.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }, [nationId]);
  // Opening the tree puts focus on the ship it opened for, scrolled into view, else on the nation's tab.
  useEffect(() => {
    const node = scroller.current?.querySelector<HTMLElement>('button.tech-node[aria-pressed="true"]');
    if (node && scroller.current) scroller.current.scrollTop = Math.max(0, node.offsetTop - scroller.current.clientHeight / 3);
    (node ?? tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]'))?.focus({ preventScroll: true });
  }, []);
  const tabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = (TECH_TREE.findIndex((entry) => entry.id === nationId) + step + TECH_TREE.length) % TECH_TREE.length;
    setNationId(TECH_TREE[index].id);
    tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  };

  return (
    <section className="tech-tree" aria-label="Tech tree">
      <div className="tech-tree-bar">
        <button className="port-quiet plan-chest-back" onClick={onClose}>
          <PortIcon name="back" size={18} />
          {berthedName ?? 'Port'}
        </button>
        <h1>Tech tree</h1>
        <div className="tech-tree-nations" role="tablist" aria-label="Nations" ref={tabs} onKeyDown={tabKey}>
          {TECH_TREE.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              id={`tech-tab-${entry.id}`}
              aria-selected={entry.id === nationId}
              aria-label={`${entry.name}, ${formatXp(profile.xp[entry.id])} XP`}
              aria-controls="tech-tree-panel"
              tabIndex={entry.id === nationId ? 0 : -1}
              onClick={() => setNationId(entry.id)}
            >
              <NationFlag nation={entry.name} width={20} />
              <span>{entry.name}</span>
              <b>
                {formatXp(profile.xp[entry.id])}
                <small>XP</small>
              </b>
            </button>
          ))}
        </div>
        <div className="tech-tree-free">
          <span>Free XP</span>
          <b>{formatXp(profile.freeXp)}</b>
        </div>
      </div>
      {snapshot.status !== 'ready' && (
        <p className="tech-tree-notice" role="status">
          <Icon name="warning" size={15} />
          {snapshot.status === 'loading'
            ? 'Loading research progress…'
            : `${snapshot.error ?? 'Research progress is unavailable.'} Every ship stays open meanwhile; unlocking waits until it returns.`}
          {snapshot.status === 'unavailable' && onRetry && (
            <button className="port-link" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      )}
      <div className="tech-tree-scroll" ref={scroller} role="tabpanel" id="tech-tree-panel" aria-labelledby={`tech-tab-${nationId}`}>
        <div className="tech-tree-lines" style={{ '--lines': nation.lines.length } as CSSProperties} onKeyDown={walk}>
          {nation.lines.map((line, column) => {
            const views = line.nodes.map((node) => research(snapshot, node.id)!);
            return (
              <section key={line.id} className="tech-line" aria-label={line.label}>
                <h2>
                  <ShipClassIcon shipClass={LINE_CLASS[line.id]} width={26} />
                  {line.label}
                </h2>
                <ol>
                  {views.map((view, row) => (
                    <li key={view.node.id}>
                      {row > 0 && <i className="tech-link" data-state={linkState(views[row - 1].state, view.state)} aria-hidden="true" />}
                      <NodePlate
                        view={view}
                        lineClass={LINE_CLASS[line.id]}
                        selected={view.node.id === selected?.node.id}
                        berthed={!!view.node.presetId && view.node.presetId === berthedId}
                        column={column}
                        row={row}
                        onSelect={() => setSelectedId(view.node.id)}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
      <footer className="tech-tree-selection" aria-live="polite">
        {selected ? (
          <Selection
            key={selected.node.id}
            view={selected}
            berthed={selected.node.presetId === berthedId}
            ready={ready}
            unlockable={unlockable}
            onView={() => onView(selected.node.presetId!)}
            onUnlock={onUnlock}
          />
        ) : (
          <p className="tech-selection-hint">
            Select a ship to see what she costs and where the XP comes from. <kbd>Esc</kbd> Back to the quay
          </p>
        )}
      </footer>
    </section>
  );
}
