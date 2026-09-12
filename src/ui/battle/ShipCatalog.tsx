import { useState, type DragEvent } from 'react';
import { shipClass, shipIdentity, SHIP_CLASSES, type ShipClass } from '../../game/shipModel';
import { shipPreset } from '../../ships/presets';
import { Input } from '../components';
import { ShipClassIcon } from '../ShipClassIcons';
import { NationFlag, nationLabel } from './NationFlag';
import { ShipCatalogCard } from './ShipCard';

interface Props {
  ships: readonly string[]; hint: string; picked?: string; commanded?: string; disabled?: boolean;
  unavailable(id: string): string; onPick(id: string): void; onDragStart(id: string, event: DragEvent<HTMLElement>): void; onDragEnd(): void;
}
/** Shared catalog column: search, class and nation chips, one draggable card per hull. */
export function ShipCatalog({ ships, hint, picked, commanded, disabled, unavailable, onPick, onDragStart, onDragEnd }: Props) {
  const [query, setQuery] = useState(''), [classFilter, setClassFilter] = useState<'All' | ShipClass>('All'), [nation, setNation] = useState('All');
  const nations = Array.from(new Set(ships.map(id => shipIdentity(id).nation).filter(Boolean))).sort();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = ships.filter(id => (classFilter === 'All' || shipClass(id) === classFilter) && (nation === 'All' || shipIdentity(id).nation === nation)
    && terms.every(term => `${shipPreset(id).name} ${id} ${shipIdentity(id).type} ${shipIdentity(id).nation}`.toLocaleLowerCase().includes(term)));
  const classes = SHIP_CLASSES.filter(entry => ships.some(id => shipClass(id) === entry));
  return <section className="battle-catalog" aria-labelledby="battle-catalog-title">
    <header className="catalog-head"><h3 id="battle-catalog-title">Ships</h3><span role="status" className="catalog-count">{shown.length} / {ships.length} hulls</span><span className="catalog-hint">{hint}</span></header>
    <label className="catalog-search"><span className="battle-sr-only">Search hulls</span><Input type="search" placeholder="Search hulls…" value={query} onChange={event => setQuery(event.target.value)} aria-controls="battle-catalog-results"/></label>
    <div className="catalog-filters" role="group" aria-label="Filter by class">
      <button type="button" aria-pressed={classFilter === 'All'} onClick={() => setClassFilter('All')}>All</button>
      {classes.map(entry => <button type="button" key={entry} aria-pressed={classFilter === entry} onClick={() => setClassFilter(entry)}><ShipClassIcon shipClass={entry} width={20}/>{entry}</button>)}
    </div>
    <div className="catalog-filters" role="group" aria-label="Filter by nation">
      <button type="button" aria-pressed={nation === 'All'} onClick={() => setNation('All')}>All nations</button>
      {nations.map(entry => <button type="button" key={entry} aria-pressed={nation === entry} aria-label={entry} onClick={() => setNation(entry)}><NationFlag nation={entry}/>{nationLabel(entry)}</button>)}
    </div>
    <ul id="battle-catalog-results" className="catalog-list">
      {shown.map(id => <ShipCatalogCard key={id} presetId={id} picked={picked === id} commanded={commanded === id} disabled={disabled} unavailable={disabled ? '' : unavailable(id)}
        onPick={() => onPick(id)} draggable onDragStart={event => onDragStart(id, event)} onDragEnd={onDragEnd}/>)}
      {!shown.length && <li className="catalog-empty">No ships match. Clear the search or the filters.</li>}
    </ul>
  </section>;
}
