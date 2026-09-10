import type { ReactNode } from 'react';
import { assetUrl } from '../../assetUrl';
import { OCEAN_MAPS, type OceanMapId } from '../../maps/catalog';
import { Input } from '../components';
import { Icon } from '../Icons';

export function RailBlock({ title, aside, children, className = '' }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rail-block ${className}`}><h3>{title}{aside && <small>{aside}</small>}</h3>{children}</section>;
}
/** Map tiles: the same waters picker for every mode that chooses its own map. */
export function MapTiles({ value, onChange, disabled, locked, name }: { value?: string; onChange?(id: OceanMapId): void; disabled?: boolean; locked?: boolean; name: string }) {
  return <div className={`map-tiles ${locked ? 'is-locked' : ''}`} role={locked ? undefined : 'radiogroup'} aria-label="Battle waters">
    {OCEAN_MAPS.map(map => <label key={map.id} className={`map-tile ${!locked && value === map.id ? 'is-selected' : ''}`} title={map.description}>
      {!locked && <Input type="radio" name={name} value={map.id} checked={value === map.id} disabled={disabled} onChange={() => onChange?.(map.id)}/>}
      <img src={assetUrl(`maps/${map.id}.webp`)} alt="" width="320" height="180" loading="lazy"/>
      <span>{map.name}</span><small>{map.region}</small>
    </label>)}
  </div>;
}
interface SliderProps { id: string; label: string; value: number; min?: number; max: number; step: number; reading: string; ends: [string, string]; description?: string; disabled?: boolean; onChange(value: number): void; }
export function RailSlider({ id, label, value, min = 0, max, step, reading, ends, description, disabled, onChange }: SliderProps) {
  return <div className="rail-slider">
    <label htmlFor={id}>{label}</label><output htmlFor={id}>{reading}</output>
    <Input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-valuetext={reading} aria-describedby={description ? `${id}-description` : undefined} onChange={event => onChange(Number(event.target.value))}/>
    <div className="rail-slider-scale" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div>
    {description && <p id={`${id}-description`}>{description}</p>}
  </div>;
}
export function RailLock({ children }: { children: ReactNode }) {
  return <p className="rail-lock"><Icon name="target" size={16}/><span>{children}</span></p>;
}
