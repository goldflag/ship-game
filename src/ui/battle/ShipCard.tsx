import type { ComponentProps, DragEvent, ReactNode } from 'react';
import { assetUrl } from '../../assetUrl';
import { shipClass, shipIdentity } from '../../game/shipModel';
import { shipPreset } from '../../ships/presets';
import { Icon } from '../Icons';
import { ShipClassIcon } from '../ShipClassIcons';
import { aircraftCount } from '../pveSetup';
import { NationFlag, nationLabel } from './NationFlag';

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
  return <img className="ship-thumbnail" src={assetUrl(`models/${presetId}-thumbnail.png`)} width={width} height={Math.round(width * .3)} alt="" loading="lazy" draggable={false}/>;
}

interface DragProps { draggable?: boolean; onDragStart?(event: DragEvent<HTMLElement>): void; onDragEnd?(event: DragEvent<HTMLElement>): void; }
interface CatalogCardProps extends DragProps { presetId: string; picked?: boolean; commanded?: boolean; unavailable?: string; disabled?: boolean; onPick?(): void; }
/** Catalog row: the grip promises a drag; the button also picks the ship for a keyboard placement. */
export function ShipCatalogCard({ presetId, picked, commanded, unavailable, disabled, onPick, draggable, onDragStart, onDragEnd }: CatalogCardProps) {
  const ship = shipPreset(presetId), blocked = !!unavailable || !!disabled;
  return <li className={`ship-card ${commanded ? 'is-commanded' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
    <button type="button" className="ship-card-pick" draggable={!!draggable && !blocked} disabled={blocked} aria-pressed={picked} aria-label={`Choose ${ship.name}, ${shipDescription(presetId)}`}
      title={unavailable || `${ship.name} · ${Math.round(ship.hull.length)} m · drag into a lane, or choose it and then choose a lane`} onClick={onPick} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <i className="ship-grip" aria-hidden="true"/><ShipThumbnail presetId={presetId} width={64}/>
      <span className="ship-card-text"><strong>{ship.name}</strong><small>{tonnes(ship.hull.massKg)} t</small><ShipMeta presetId={presetId}/></span>
      {unavailable && <span className="ship-card-reason">{unavailable}</span>}
    </button>
  </li>;
}

interface ChipProps extends DragProps { presetId: string; name?: string; picked?: boolean; commanded?: boolean; onPick?(): void; pickLabel?: string; onRemove?(): void; removeLabel?: string; children?: ReactNode; className?: string; disabled?: boolean; }
/** A ship in a lane. The right slot holds per-ship controls (an AI level, a command mark). */
export function ShipChip({ presetId, name, picked, commanded, onPick, pickLabel, onRemove, removeLabel, children, className = '', disabled, draggable, onDragStart, onDragEnd }: ChipProps) {
  const ship = shipPreset(presetId);
  return <li className={`ship-chip ${commanded ? 'is-commanded' : ''} ${picked ? 'is-picked' : ''} ${className}`} draggable={!!draggable && !disabled} onDragStart={onDragStart} onDragEnd={onDragEnd}>
    <button type="button" className="ship-chip-pick" disabled={disabled || !onPick} aria-pressed={picked} aria-label={pickLabel ?? `Move ${name ?? ship.name}`} onClick={onPick}>
      <i className="ship-grip" aria-hidden="true"/><ShipThumbnail presetId={presetId} width={56}/>
      <span className="ship-card-text"><strong>{name ?? ship.name}</strong><ShipMeta presetId={presetId}/></span>
    </button>
    {children}
    {onRemove && <button type="button" className="ship-chip-remove" disabled={disabled} aria-label={removeLabel ?? `Remove ${name ?? ship.name}`} title="Remove" onClick={onRemove}><Icon name="close" size={14}/></button>}
  </li>;
}
export function Berth({ label, ...props }: { label: string } & ComponentProps<'li'>) {
  return <li {...props} className={`ship-berth ${props.className ?? ''}`}>{label}</li>;
}
