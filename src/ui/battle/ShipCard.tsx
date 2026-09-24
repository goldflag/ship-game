import { useConstructionThumbnail } from '../useConstructionThumbnail';
import { sessionShip } from '../../ships/sessionShips';
import type { ComponentProps, DragEvent, ReactNode } from 'react';
import { assetUrl } from '../../assetUrl';
import { shipClass, shipIdentity } from '../../game/shipModel';
import { localShip, resolveShip } from '../../ships/localShips';
import { constructionPaintColor } from '../../ships/constructionPaints';
import { Icon } from '../Icons';
import { ShipClassIcon } from '../ShipClassIcons';
import { aircraftCount } from '../pveSetup';
import { NationFlag, nationLabel } from './NationFlag';
import { ACCESS_LABEL, type FleetAccess } from './fleetAccess';

export const tonnes = (kg: number) => Math.round(kg / 1000).toLocaleString('en-US');
/** Class silhouette, detailed type, flag and nation on one line; carriers add their embarked aircraft. */
export function ShipMeta({ presetId }: { presetId: string }) {
  const identity = shipIdentity(presetId), aircraft = aircraftCount(presetId);
  const type = identity.type === 'Aircraft carrier' ? 'Carrier' : identity.type;
  return <span className="ship-meta">
    <ShipClassIcon shipClass={shipClass(presetId)} width={22}/><span>{type}</span>
    {identity.nation && <><i aria-hidden="true">·</i><NationFlag nation={identity.nation}/><span>{nationLabel(identity.nation)}</span></>}
    {aircraft > 0 && <span className="ship-aircraft" title={`${aircraft} embarked aircraft`}><Icon name="aircraft" size={12}/>{aircraft}</span>}
  </span>;
}
export const shipDescription = (presetId: string) => { const identity = shipIdentity(presetId); return [identity.type, identity.nation].filter(Boolean).join(', '); };
export function ShipThumbnail({ presetId, width = 72 }: { presetId: string; width?: number }) {
  const local = (localShip(presetId) ?? sessionShip(presetId));
  const thumbnail = useConstructionThumbnail(local);
  if (thumbnail) return <img className="ship-thumbnail" src={thumbnail} width={width} height={Math.round(width * .3)} alt="" loading="lazy" draggable={false}/>;
  if (local) {
    const surfaces = local.result.surfaces.filter(s => !s.open), points = surfaces.flatMap(s => s.vertices);
    const left = Math.min(...points.map(p => p[2])), right = Math.max(...points.map(p => p[2]));
    const bottom = Math.min(...points.map(p => p[1])), top = Math.max(...points.map(p => p[1]));
    const pad = Math.max(1, (right - left) * .03);
    return <svg className="ship-thumbnail" width={width} height={Math.round(width * .3)} viewBox={`${left - pad} ${-top - pad} ${right - left + 2 * pad} ${top - bottom + 2 * pad}`} aria-hidden="true">
      {surfaces.filter(s => s.normal[0] < -.01).map((s, i) => <polygon key={i} points={s.vertices.map(p => `${p[2]},${-p[1]}`).join(' ')} fill={constructionPaintColor(s.paint)}/>)}
    </svg>;
  }
  return <img className="ship-thumbnail" src={assetUrl(`models/${presetId}-thumbnail.png`)} width={width} height={Math.round(width * .3)} alt="" loading="lazy" draggable={false}/>;
}

/** A small padlock, drawn with the class icons' stroke. */
export function LockGlyph({ size = 12 }: { size?: number }) {
  return <svg className="lock-glyph" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="2" y="5.5" width="8" height="5.5" rx="1"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/>
  </svg>;
}
/** Why a ship cannot join the player's own fleet: a padlock for a class still to research, a plain mark for enemy-only ships. */
export function FleetRestriction({ access }: { access: Exclude<FleetAccess, 'open'> }) {
  return <span className="ship-restriction" data-access={access}>{access === 'locked' && <LockGlyph/>}{ACCESS_LABEL[access]}</span>;
}

interface DragProps { draggable?: boolean; onDragStart?(event: DragEvent<HTMLElement>): void; onDragEnd?(event: DragEvent<HTMLElement>): void; }
interface CatalogCardProps extends DragProps { presetId: string; picked?: boolean; commanded?: boolean; unavailable?: string; disabled?: boolean; onPick?(): void;
  /** The ship may not join the player's own fleet. Custom battles still take it into the enemy lane. */
  restriction?: Exclude<FleetAccess, 'open'>; }
/** Catalog row: the grip promises a drag; the button also picks the ship for a keyboard placement. */
export function ShipCatalogCard({ presetId, picked, commanded, unavailable, disabled, onPick, draggable, onDragStart, onDragEnd, restriction }: CatalogCardProps) {
  const ship = resolveShip(presetId), blocked = !!unavailable || !!disabled;
  const title = unavailable || (restriction ? `${ship.name} · ${ACCESS_LABEL[restriction]} · the enemy lane takes it`
    : `${ship.name} · ${Math.round(ship.hull.length)} m · drag into a lane, or choose it and then choose a lane`);
  return <li className={`ship-card ${commanded ? 'is-commanded' : ''} ${unavailable ? 'is-unavailable' : ''} ${restriction ? 'is-restricted' : ''}`}>
    <button type="button" className="ship-card-pick" draggable={!!draggable && !blocked} disabled={blocked} aria-pressed={picked}
      aria-label={`Choose ${ship.name}, ${shipDescription(presetId)}${restriction ? `, ${ACCESS_LABEL[restriction].toLocaleLowerCase()}` : ''}`}
      title={title} onClick={onPick} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <i className="ship-grip" aria-hidden="true"/><ShipThumbnail presetId={presetId} width={64}/>
      <span className="ship-card-text"><strong>{ship.name}</strong><small>{tonnes(ship.hull.massKg)} t</small><ShipMeta presetId={presetId}/></span>
      {restriction ? <span className="ship-card-reason"><FleetRestriction access={restriction}/></span> : unavailable && <span className="ship-card-reason">{unavailable}</span>}
    </button>
  </li>;
}

interface ChipProps extends DragProps { presetId: string; name?: string; picked?: boolean; commanded?: boolean; onPick?(): void; pickLabel?: string; onRemove?(): void; removeLabel?: string; children?: ReactNode; className?: string; disabled?: boolean;
  /** A ship in the player's own fleet that may not sail there. */
  restriction?: Exclude<FleetAccess, 'open'>; }
/** A ship in a lane. The right slot holds per-ship controls (an AI level, a command mark). */
export function ShipChip({ presetId, name, picked, commanded, onPick, pickLabel, onRemove, removeLabel, children, className = '', disabled, draggable, onDragStart, onDragEnd, restriction }: ChipProps) {
  const ship = resolveShip(presetId);
  return <li className={`ship-chip ${commanded ? 'is-commanded' : ''} ${picked ? 'is-picked' : ''} ${restriction ? 'is-restricted' : ''} ${className}`} draggable={!!draggable && !disabled} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <button type="button" className="ship-chip-pick" disabled={disabled || !onPick} aria-pressed={picked} aria-label={pickLabel ?? `Move ${name ?? ship.name}`} onClick={onPick}>
      <i className="ship-grip" aria-hidden="true"/><ShipThumbnail presetId={presetId} width={56}/>
      <span className="ship-card-text"><strong>{name ?? ship.name}</strong>{restriction ? <FleetRestriction access={restriction}/> : <ShipMeta presetId={presetId}/>}</span>
    </button>
    {children}
    {onRemove && <button type="button" className="ship-chip-remove" disabled={disabled} aria-label={removeLabel ?? `Remove ${name ?? ship.name}`} title="Remove" onClick={onRemove}><Icon name="close" size={14}/></button>}
  </li>;
}
export function Berth({ label, ...props }: { label: string } & ComponentProps<'li'>) {
  return <li {...props} className={`ship-berth ${props.className ?? ''}`}>{label}</li>;
}
