import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { shipIdentity } from '../../game/shipModel';
import { Button, Input, Select, SelectOption } from '../components';
import { FORMATIONS, type Formation } from '../formationStations';
import { moveFormation } from '../pveSetup';
import { NationFlag } from './NationFlag';
import { ShipThumbnail } from './ShipCard';
import { DEPLOYMENT_DRAG, DeploymentChart, selectedUnits, type ChartScope, type ChartSelection } from './DeploymentChart';
import { arrangeFormation, fitRadius, formatHeading, headingDegrees, unitsCenter, type ChartUnit, type Deployment } from './deploymentModel';

interface Props {
  deployment: Deployment; onChange(units: ChartUnit[]): void; onReset(): void; disabled: boolean;
  /** Mode-specific tools shown beside undo/reset, such as the custom battle formation preset. */
  tools?: ReactNode;
  /** Changing this refits the chart, for example when a formation preset rearranges everything. */
  fitKey: string;
  /** Present only where a group can sail a cruising formation (PvE). Choosing one arranges
   * the selected group on its stations here and starts the group in that formation in the sim. */
  onFormation?(groupId: string, formation: Formation): void;
}
const Turn = ({ direction }: { direction: 'port' | 'starboard' }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={direction === 'starboard' ? { transform: 'scaleX(-1)' } : undefined}><path d="M9 4 5 8l4 4M5 8h9a5 5 0 0 1 0 10h-3"/></svg>;
const UndoIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3"/></svg>;
/** Heading dial: the same tick ring as the chart, at rail size. */
export function HeadingDial({ heading, size = 72 }: { heading: number; size?: number }) {
  const c = size / 2, r = c - 9;
  return <svg className="deploy-dial" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
    <circle cx={c} cy={c} r={r}/>
    {Array.from({ length: 12 }, (_, i) => i * 30).map(angle => { const rad = angle * Math.PI / 180, major = angle % 90 === 0; return <line key={angle} className={major ? 'major' : ''} x1={c + Math.sin(rad) * r} y1={c - Math.cos(rad) * r} x2={c + Math.sin(rad) * (r + (major ? 6 : 3))} y2={c - Math.cos(rad) * (r + (major ? 6 : 3))}/>; })}
    <g transform={`rotate(${headingDegrees(heading)} ${c} ${c})`}><path d={`M${c} ${c - r + 2} L${c + 5} ${c - r + 12} L${c} ${c - r + 9} L${c - 5} ${c - r + 12}Z`}/><line x1={c} y1={c} x2={c} y2={c - r + 10}/></g>
    <circle className="deploy-dial-center" cx={c} cy={c} r="2"/>
  </svg>;
}

/** Place the fleet: group and ship list on the left, the chart beside it. */
export function DeployScreen({ deployment, onChange, onReset, disabled, tools, fitKey, onFormation }: Props) {
  const firstGroup = deployment.groups.find(group => deployment.units.some(unit => unit.groupId === group.id));
  const [selection, setSelection] = useState<ChartSelection>(firstGroup ? { kind: 'group', id: firstGroup.id } : undefined);
  const [scope, setScope] = useState<ChartScope>('group');
  // Pointing at a row lights its marker on the chart and pointing at a marker lights its row.
  const [hover, setHover] = useState<ChartSelection>();
  const [history, setHistory] = useState<ChartUnit[][]>([]);
  const fit = useMemo(() => fitRadius(deployment), [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHistory([]); }, [fitKey]);
  const units = deployment.units, active = selectedUnits(deployment, selection);
  // A selection that no longer exists falls back to the first group.
  useEffect(() => { if (selection && !active.length) setSelection(firstGroup ? { kind: 'group', id: firstGroup.id } : undefined); }, [selection, active.length, firstGroup]);
  const commit = (before: ChartUnit[]) => setHistory(list => [...list.slice(-29), before]);
  const change = (next: ChartUnit[]) => { if (!disabled) { commit(units); onChange(next); } };
  const center = active.length ? unitsCenter(active) : undefined, heading = active[0]?.spawn.heading ?? 0;
  const turn = (angle: number) => { if (center) change(moveFormation(units, active.map(unit => unit.id), center.x, center.z, angle)); };
  // The formation picker works on whichever group owns the selection, ship scope included.
  const selectedGroupId = selection?.kind === 'group' ? selection.id : units.find(unit => unit.id === selection?.id)?.groupId;
  const selectedGroup = deployment.groups.find(group => group.id === selectedGroupId);
  const formation = selectedGroup?.formation ?? 'column';
  const chooseFormation = (next: Formation) => {
    if (!onFormation || !selectedGroup) return;
    onFormation(selectedGroup.id, next);
    // Arranging goes through `change`, so an unwanted formation is one Undo away, and an
    // illegal arrangement still lands on the chart with the usual placement error under it.
    change(arrangeFormation(units, selectedGroup.id, next));
  };
  const rosterDrag = (event: DragEvent<HTMLElement>, ids: string[], next: ChartSelection) => {
    event.stopPropagation();
    if (disabled) { event.preventDefault(); return; }
    setSelection(next); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DEPLOYMENT_DRAG, JSON.stringify(ids));
  };
  const scopeChange = (next: ChartScope) => {
    setScope(next);
    if (next === 'group' && selection?.kind === 'ship') setSelection({ kind: 'group', id: units.find(unit => unit.id === selection.id)?.groupId ?? selection.id });
    if (next === 'ship' && selection?.kind === 'group') { const first = units.find(unit => unit.groupId === selection.id); if (first) setSelection({ kind: 'ship', id: first.id }); }
  };
  let number = 0;
  return <div className="deploy-body">
    <aside className="deploy-side" aria-label="Deployment">
      <header className="deploy-head"><h3>Place the fleet</h3><span>North up</span></header>
      <div className="deploy-scope" role="group" aria-label="Selection scope">
        <div className="battle-segmented"><button type="button" aria-pressed={scope === 'group'} onClick={() => scopeChange('group')}>Group <kbd>G</kbd></button><button type="button" aria-pressed={scope === 'ship'} onClick={() => scopeChange('ship')}>Ship <kbd>S</kbd></button></div>
        <p>{scope === 'group' ? 'Selecting a ship selects its whole group. Drag a frame or its tag to move the group.' : 'Selecting a ship selects only that ship. Drag it to move it alone.'} Drag the ring or the heading knob to rotate.</p>
      </div>
      <div className="deploy-list">
        {deployment.groups.map(group => {
          const members = units.filter(unit => unit.groupId === group.id), ids = members.map(unit => unit.id);
          if (!members.length) return null;
          const groupSelected = selection?.kind === 'group' && selection.id === group.id, groupHovered = hover?.kind === 'group' && hover.id === group.id;
          return <div key={group.id} className={`deploy-group ${group.side}`}>
            <button type="button" className={`deploy-group-row ${groupHovered ? 'is-hovered' : ''}`} draggable={!disabled} disabled={disabled} aria-pressed={groupSelected} onDragStart={event => rosterDrag(event, ids, { kind: 'group', id: group.id })} onClick={() => setSelection({ kind: 'group', id: group.id })}
              onPointerEnter={() => setHover({ kind: 'group', id: group.id })} onPointerLeave={() => setHover(undefined)}>
              <strong>{group.name}</strong><span>{members.length} {members.length === 1 ? 'ship' : 'ships'}</span><em>{formatHeading(members[0].spawn.heading)}</em>
            </button>
            <ul>{members.map(unit => { number++; const own = selection?.kind === 'ship' && selection.id === unit.id, hovered = hover?.kind === 'ship' && hover.id === unit.id;
              return <li key={unit.id}><button type="button" className={`deploy-ship-row ${hovered ? 'is-hovered' : ''}`} draggable={!disabled} disabled={disabled} aria-pressed={own} onDragStart={event => rosterDrag(event, [unit.id], { kind: 'ship', id: unit.id })} onClick={() => setSelection({ kind: 'ship', id: unit.id })}
                onPointerEnter={() => setHover({ kind: 'ship', id: unit.id })} onPointerLeave={() => setHover(undefined)}>
                <span className="deploy-ship-number">{number}</span><ShipThumbnail presetId={unit.presetId} width={56}/><span className="deploy-ship-name">{unit.name}</span><NationFlag nation={shipIdentity(unit.presetId).nation}/>
              </button></li>; })}</ul>
          </div>;
        })}
      </div>
      <div className="deploy-tools">
        {onFormation && <div className="deploy-formation">
          <label className="rail-field"><span>Formation{selectedGroup ? ` · ${selectedGroup.name}` : ''}</span>
            <Select aria-label="Cruising formation" value={formation} disabled={disabled || !selectedGroup} onValueChange={value => chooseFormation(value as Formation)}>
              {FORMATIONS.map(entry => <SelectOption key={entry.id} value={entry.id}>{entry.label}</SelectOption>)}
            </Select></label>
          <p className="rail-note">{FORMATIONS.find(entry => entry.id === formation)?.hint}</p>
        </div>}
        <div className="deploy-heading"><HeadingDial heading={heading}/>
          <div className="rail-field"><label htmlFor="deploy-heading">Heading{active.length > 1 ? ' · lead ship' : ''}</label>
            <div className="rail-row"><Input id="deploy-heading" type="number" min="0" max="359" step="5" value={headingDegrees(heading)} disabled={disabled || !active.length} onChange={event => { if (event.target.value !== '') turn(Number(event.target.value) * Math.PI / 180 - heading); }}/>
              <Button disabled={disabled || !active.length} aria-label="Rotate 15 degrees to port" title="Rotate 15° to port (Q)" onClick={() => turn(-Math.PI / 12)}><Turn direction="port"/>15°</Button><Button disabled={disabled || !active.length} aria-label="Rotate 15 degrees to starboard" title="Rotate 15° to starboard (E)" onClick={() => turn(Math.PI / 12)}><Turn direction="starboard"/>15°</Button></div></div>
        </div>
        <div className="rail-row deploy-actions">
          <Button disabled={disabled || !history.length} onClick={() => { const previous = history.at(-1)!; setHistory(list => list.slice(0, -1)); onChange(previous); }}><UndoIcon/> Undo</Button>
          <Button disabled={disabled} onClick={() => { commit(units); onReset(); }}>Reset positions</Button>
          {tools}
        </div>
        <p className="deploy-help">{center ? `${active.length} selected · ${(center.x / 1000).toFixed(1)} km E, ${(center.z / 1000).toFixed(1)} km S` : 'Nothing selected'} · arrows move 500 m, Shift 100 m · <kbd>Q</kbd> <kbd>E</kbd> rotate 15°</p>
      </div>
    </aside>
    <div className="deploy-chart-wrap">
      <DeploymentChart deployment={deployment} fit={fit} onChange={onChange} onCommit={commit} selection={selection} onSelect={setSelection} hover={hover} onHover={setHover} scope={scope} onScopeChange={scopeChange} disabled={disabled}/>
      <div className="deploy-legend" aria-hidden="true"><span className="selected">Selected</span><span className="friendly">Friendly</span>{deployment.groups.some(group => group.side === 'enemy') && <span className="enemy">Enemy</span>}{deployment.friendlyMinZ !== undefined && <span className="sector">Friendly sector</span>}</div>
      <p className={`deploy-status ${deployment.error ? 'is-error' : ''}`} role="status">{deployment.error || 'Placement clear.'}<span>Scroll to zoom · drag water to pan · click water to deselect · <kbd>Home</kbd> shows everything</span></p>
    </div>
  </div>;
}
