import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentItem } from '../../scripts/parts/library';
import { SHIP_CLASSES, type ShipClass } from '../../src/game/shipModel';
import { ShipClassIcon } from '../../src/ui/ShipClassIcons';
import { ComponentThumbnails } from './thumbnails';
import type { Aircraft } from './aircraft';

export type Ship = { id: string; name: string; modelUrl: string; length: number; configuration: string; nation: string; type: string; shipClass: ShipClass; thumbnailUrl: string };
export type LibraryKind = 'ship' | 'aircraft' | 'component';
export const caliberMm = (part: ComponentItem) => Number((part.weapon.caliberM * 1000).toFixed(3));
const mountingShips = (part: ComponentItem) => [...new Map(part.installations.map(i => [i.shipId, i.shipName])).values()].sort();
const caliberBandStart = (part: ComponentItem) => Math.floor(caliberMm(part) / 50) * 50;
const NATION_LABELS: Record<string, string> = { 'United States': 'USA', 'United Kingdom': 'UK' };
const nationLabel = (nation: string) => NATION_LABELS[nation] ?? nation;

function Pills<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label}>{options.map(o => <button key={o.value} className="pill" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>)}</div>;
}
function ShipCard({ ship, selected, onSelect }: { ship: Ship; selected: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false);
  return <li><button className="card" aria-pressed={selected} data-id={ship.id} aria-label={`Inspect ${ship.name}`} title={ship.configuration} onClick={onSelect}>
    <span className="card-top"><ShipClassIcon shipClass={ship.shipClass} width={22}/>{ship.type}</span>
    {failed ? <ShipClassIcon className="card-fallback" shipClass={ship.shipClass} width={120}/> : <img className="card-image" src={ship.thumbnailUrl} alt="" width={600} height={180} onError={() => setFailed(true)}/>}
    <strong>{ship.name}</strong>
  </button></li>;
}
function ComponentCard({ part, selected, thumbnails, onSelect }: { part: ComponentItem; selected: boolean; thumbnails: ComponentThumbnails; onSelect: () => void }) {
  const ships = mountingShips(part);
  const mountedOn = ships.length ? `Mounted on: ${ships.join(', ')}` : 'Not mounted in the current fleet';
  const button = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      thumbnails.get(part).then(url => { if (active) setImage(url); }).catch(() => { if (active) setFailed(true); });
    }, { root: button.current!.closest('.cards'), rootMargin: '0px 180px' });
    observer.observe(button.current!);
    return () => { active = false; observer.disconnect(); };
  }, [part, thumbnails]);
  return <li><button ref={button} className="card component-card" aria-pressed={selected} data-id={part.partId}
    aria-label={`${part.name}, ${caliberMm(part)} mm, ${part.nation}, ${part.partId}. ${mountedOn}`} title={`${part.name}\n${part.partId}\n${part.builder ? 'Reusable source' : 'Installed preview'} · ${part.review}`} onClick={onSelect}>
    <span className="card-top">{nationLabel(part.nation)} · {caliberMm(part)} mm</span>
    {image ? <img className="card-image" src={image} alt="" width="320" height="180"/> : <span className="card-placeholder">{failed ? 'No preview' : part.modelUrl || part.installations.length ? 'Rendering…' : 'No preview'}</span>}
    <strong>{part.name}</strong>
    <span className="card-subtle">{mountedOn}</span>
  </button></li>;
}

function AircraftCard({ aircraft, selected, thumbnails, onSelect }: { aircraft: Aircraft; selected: boolean; thumbnails: ComponentThumbnails; onSelect: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      thumbnails.getAircraft(aircraft).then(url => { if (active) setImage(url); }).catch(() => { if (active) setFailed(true); });
    }, { root: button.current!.closest('.cards'), rootMargin: '0px 180px' });
    observer.observe(button.current!);
    return () => { active = false; observer.disconnect(); };
  }, [aircraft, thumbnails]);
  return <li><button ref={button} className="card" aria-pressed={selected} data-id={aircraft.id} aria-label={`Inspect ${aircraft.name}`} title={`${aircraft.name} · ${aircraft.year} · ${aircraft.nation}`} onClick={onSelect}>
    <span className="card-top">{nationLabel(aircraft.nation)} · {aircraft.role}</span>
    {image ? <img className="card-image" src={image} alt="" width="320" height="180"/> : <span className="card-placeholder">{failed ? 'No preview' : 'Rendering…'}</span>}
    <strong>{aircraft.name}</strong>
  </button></li>;
}

export function LibraryCarousel({ kind, onKind, ships, parts, aircraft, shipId, partId, aircraftId, onShip, onPart, onAircraft }: {
  kind: LibraryKind; onKind: (kind: LibraryKind) => void; ships: Ship[]; parts: ComponentItem[]; aircraft: Aircraft[]; shipId: string; partId: string; aircraftId: string; onShip: (id: string) => void; onPart: (id: string) => void; onAircraft: (id: string) => void;
}) {
  const [shipClass, setShipClass] = useState<'All' | ShipClass>('All'), [shipNation, setShipNation] = useState('All');
  const [partNation, setPartNation] = useState('All'), [caliber, setCaliber] = useState(''), [search, setSearch] = useState('');
  const [aircraftNation, setAircraftNation] = useState('All'), [role, setRole] = useState('All'), [aircraftSearch, setAircraftSearch] = useState('');
  const [thumbnails, setThumbnails] = useState<ComponentThumbnails | null>(null);
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const shipNations = useMemo(() => [...new Set(ships.map(s => s.nation).filter(Boolean))].sort(), [ships]);
  const partNations = useMemo(() => [...new Set(parts.map(p => p.nation))].sort(), [parts]);
  const aircraftNations = useMemo(() => [...new Set(aircraft.map(a => a.nation))].sort(), [aircraft]);
  const roles = useMemo(() => [...new Set(aircraft.map(a => a.role))].sort(), [aircraft]);
  const filteredAircraft = useMemo(() => aircraft.filter(a => (aircraftNation === 'All' || a.nation === aircraftNation) && (role === 'All' || a.role === role) && `${a.name} ${a.id} ${a.year}`.toLowerCase().includes(aircraftSearch.trim().toLowerCase())), [aircraft, aircraftNation, role, aircraftSearch]);
  const calibers = useMemo(() => Array.from({ length: Math.floor(Math.max(0, ...parts.map(caliberMm)) / 50) + 1 }, (_, i) => i * 50), [parts]);
  const filteredShips = useMemo(() => ships.filter(s => (shipClass === 'All' || s.shipClass === shipClass) && (shipNation === 'All' || s.nation === shipNation)), [ships, shipClass, shipNation]);
  const filteredParts = useMemo(() => parts.filter(p => (partNation === 'All' || p.nation === partNation) && (!caliber || caliberBandStart(p) === Number(caliber)) &&
    `${p.name} ${p.partId} ${p.family} ${p.nation}`.toLowerCase().includes(search.trim().toLowerCase())), [parts, search, partNation, caliber]);
  const selectedId = kind === 'ship' ? shipId : kind === 'aircraft' ? aircraftId : partId;
  const count = kind === 'ship' ? filteredShips.length : kind === 'aircraft' ? filteredAircraft.length : filteredParts.length, total = kind === 'ship' ? ships.length : kind === 'aircraft' ? aircraft.length : parts.length;
  const filtered = kind === 'ship' ? shipClass !== 'All' || shipNation !== 'All' : kind === 'aircraft' ? !!(aircraftSearch || aircraftNation !== 'All' || role !== 'All') : !!(search || partNation !== 'All' || caliber);
  const selectionVisible = kind === 'ship' ? filteredShips.some(s => s.id === shipId) : kind === 'aircraft' ? filteredAircraft.some(a => a.id === aircraftId) : filteredParts.some(p => p.partId === partId);
  useEffect(() => { if (kind === 'ship') return; const renderer = new ComponentThumbnails(); setThumbnails(renderer); return () => { renderer.dispose(); setThumbnails(null); }; }, [kind]);
  useEffect(() => {
    const list = track.current!;
    const update = () => setEdges({ start: list.scrollLeft < 2, end: list.scrollLeft + list.clientWidth >= list.scrollWidth - 2 });
    list.addEventListener('scroll', update, { passive: true }); const observer = new ResizeObserver(update); observer.observe(list); update();
    return () => { observer.disconnect(); list.removeEventListener('scroll', update); };
  }, [kind, count, thumbnails]);
  useEffect(() => {
    const list = track.current!;
    const card = [...list.querySelectorAll<HTMLButtonElement>('button[data-id]')].find(b => b.dataset.id === selectedId);
    list.scrollLeft = card ? list.scrollLeft + card.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - card.clientWidth) / 2 : 0;
  }, [selectedId, kind, count, thumbnails]);
  const reset = () => { setShipClass('All'); setShipNation('All'); setPartNation('All'); setCaliber(''); setSearch(''); setAircraftNation('All'); setRole('All'); setAircraftSearch(''); };
  const scroll = (direction: number) => { const list = track.current!; list.scrollBy({ left: direction * list.clientWidth * .8, behavior: 'auto' }); };
  return <section className="carousel" aria-label="Model library" aria-roledescription="carousel">
    <div className="carousel-bar">
      <Pills label="Library" value={kind} options={[{ value: 'ship', label: 'Ships' }, { value: 'aircraft', label: 'Planes' }, { value: 'component', label: 'Components' }]} onChange={onKind}/>
      <i aria-hidden="true"/>
      {kind === 'ship' ? <>
        <Pills label="Filter by class" value={shipClass} options={(['All', ...SHIP_CLASSES] as const).map(c => ({ value: c, label: c, icon: c === 'All' ? undefined : <ShipClassIcon shipClass={c} width={22}/> }))} onChange={setShipClass}/>
        <i aria-hidden="true"/>
        <Pills label="Filter by nation" value={shipNation} options={[{ value: 'All', label: 'All nations' }, ...shipNations.map(n => ({ value: n, label: nationLabel(n) }))]} onChange={setShipNation}/>
      </> : kind === 'aircraft' ? <>
        <Pills label="Filter by role" value={role} options={[{ value: 'All', label: 'All roles' }, ...roles.map(r => ({ value: r, label: r }))]} onChange={setRole}/>
        <i aria-hidden="true"/>
        <Pills label="Filter by nation" value={aircraftNation} options={[{ value: 'All', label: 'All nations' }, ...aircraftNations.map(n => ({ value: n, label: nationLabel(n) }))]} onChange={setAircraftNation}/>
        <input type="search" aria-label="Find aircraft" placeholder="Name, year or aircraft ID" value={aircraftSearch} onChange={e => setAircraftSearch(e.target.value)}/>
      </> : <>
        <Pills label="Filter by nation" value={partNation} options={[{ value: 'All', label: 'All nations' }, ...partNations.map(n => ({ value: n, label: nationLabel(n) }))]} onChange={setPartNation}/>
        <i aria-hidden="true"/>
        <select aria-label="Caliber" title="Lower bound included; upper bound excluded" value={caliber} onChange={e => setCaliber(e.target.value)}><option value="">All calibers</option>{calibers.map(c => <option key={c} value={c}>{c}–{c + 50} mm</option>)}</select>
        <input type="search" aria-label="Find equipment" placeholder="Name, family or part ID" value={search} onChange={e => setSearch(e.target.value)}/>
      </>}
      <p className="carousel-count" role="status">{count} of {total}{filtered && count > 0 && !selectionVisible ? ' · selection outside filters' : ''}</p>
      {filtered && <button className="pill" onClick={reset}>Clear</button>}
    </div>
    <div className="carousel-track">
      <button className="carousel-nav" aria-label="Previous" disabled={edges.start} onClick={() => scroll(-1)}>‹</button>
      <ul className="cards" ref={track} aria-label={kind === 'ship' ? 'Ships' : kind === 'aircraft' ? 'Planes' : 'Component variants'} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...track.current!.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1))); buttons[next]?.focus();
      }}>
        {kind === 'ship' ? filteredShips.map(s => <ShipCard key={s.id} ship={s} selected={s.id === shipId} onSelect={() => onShip(s.id)}/>)
          : kind === 'aircraft' ? thumbnails && filteredAircraft.map(a => <AircraftCard key={a.id} aircraft={a} selected={a.id === aircraftId} thumbnails={thumbnails} onSelect={() => onAircraft(a.id)}/>)
          : thumbnails && filteredParts.map(p => <ComponentCard key={p.partId} part={p} selected={p.partId === partId} thumbnails={thumbnails} onSelect={() => onPart(p.partId)}/>)}
        {!count && <li className="carousel-empty"><span>Nothing matches these filters.</span><button className="pill" onClick={reset}>Show all</button></li>}
      </ul>
      <button className="carousel-nav" aria-label="Next" disabled={edges.end} onClick={() => scroll(1)}>›</button>
    </div>
  </section>;
}
