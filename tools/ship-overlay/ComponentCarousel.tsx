import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentItem } from '../../scripts/parts/library';
import { ComponentThumbnails } from './thumbnails';

export const caliberMm = (part: ComponentItem) => Number((part.weapon.caliberM * 1000).toFixed(3));

function ComponentCard({ part, selected, thumbnails, onSelect }: {
  part: ComponentItem; selected: boolean; thumbnails: ComponentThumbnails; onSelect: () => void;
}) {
  const ships = [...new Map(part.installations.map(i => [i.shipId, i.shipName])).values()].sort();
  const mountedOn = ships.length ? `Mounted on: ${ships.join(', ')}` : 'Not mounted in the current fleet';
  const button = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      thumbnails.get(part).then(url => { if (active) setImage(url); }).catch(() => { if (active) setFailed(true); });
    }, { root: button.current!.closest('.component-track'), rootMargin: '0px 180px' });
    observer.observe(button.current!);
    return () => { active = false; observer.disconnect(); };
  }, [part, thumbnails]);
  return <li><button ref={button} className="component-card" aria-pressed={selected} data-part-id={part.partId}
    aria-label={`${part.name}, ${caliberMm(part)} mm, ${part.nation}, ${part.partId}. ${mountedOn}`} title={`${part.name}\n${part.partId}\n${part.builder ? 'Reusable source' : 'Installed preview'} · ${part.review}`} onClick={onSelect}>
    <span className="component-image">{image ? <img src={image} alt="" width="320" height="180"/> : <span>{failed ? 'Preview unavailable' : 'Rendering preview…'}</span>}</span>
    <span className="component-card-name">{part.name}</span>
    <span className="component-card-meta">{part.nation} · {caliberMm(part)} mm</span>
    <span className="component-card-ships">{mountedOn}</span>
    <span className="component-card-source">{part.modelUrl ? 'Shared recipe' : part.installations.length ? 'Installed preview' : 'Preview unavailable'}</span>
  </button></li>;
}

export function ComponentCarousel({ parts, selectedId, onSelect }: {
  parts: ComponentItem[]; selectedId: string; onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState(''), [nation, setNation] = useState(''), [caliber, setCaliber] = useState('');
  const [thumbnails, setThumbnails] = useState<ComponentThumbnails | null>(null);
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const nations = useMemo(() => [...new Set(parts.map(p => p.nation))].sort(), [parts]);
  const calibers = useMemo(() => Array.from({ length: Math.floor(Math.max(0, ...parts.map(caliberMm)) / 50) + 1 }, (_, i) => i * 50), [parts]);
  const filtered = useMemo(() => parts.filter(p => (!nation || p.nation === nation) && (!caliber || (caliberMm(p) >= Number(caliber) && caliberMm(p) < Number(caliber) + 50)) &&
    `${p.name} ${p.partId} ${p.family} ${p.nation}`.toLowerCase().includes(search.trim().toLowerCase())), [parts, search, nation, caliber]);
  const outsideFilters = filtered.length > 0 && !filtered.some(p => p.partId === selectedId);
  useEffect(() => { const renderer = new ComponentThumbnails(); setThumbnails(renderer); return () => renderer.dispose(); }, []);
  useEffect(() => {
    const list = track.current!;
    const update = () => setEdges({ start: list.scrollLeft < 2, end: list.scrollLeft + list.clientWidth >= list.scrollWidth - 2 });
    list.addEventListener('scroll', update, { passive: true }); const observer = new ResizeObserver(update); observer.observe(list); update();
    return () => { observer.disconnect(); list.removeEventListener('scroll', update); };
  }, [filtered, thumbnails]);
  useEffect(() => {
    const list = track.current!;
    const card = [...list.querySelectorAll<HTMLButtonElement>('button[data-part-id]')].find(b => b.dataset.partId === selectedId);
    list.scrollLeft = card ? list.scrollLeft + card.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - card.clientWidth) / 2 : 0;
  }, [selectedId, filtered, thumbnails]);
  const reset = () => { setSearch(''); setNation(''); setCaliber(''); };
  const scroll = (direction: number) => { const list = track.current!; list.scrollBy({ left: direction * list.clientWidth * .8, behavior: 'auto' }); };
  return <section className="component-carousel" aria-label="Component library" aria-roledescription="carousel">
    <div className="component-filters">
      <div className="component-count"><h2>Components</h2><p role="status">{filtered.length} of {parts.length} variants{outsideFilters ? ' · selection outside filters' : ''}</p></div>
      <label className="component-search" htmlFor="component-search">Find equipment<input id="component-search" type="search" placeholder="Name, family or part ID" value={search} onChange={e => setSearch(e.target.value)}/></label>
      <label htmlFor="component-nation">Nation<select id="component-nation" value={nation} onChange={e => setNation(e.target.value)}><option value="">All nations</option>{nations.map(n => <option key={n}>{n}</option>)}</select></label>
      <label htmlFor="component-caliber">Caliber<select title="Lower bound included; upper bound excluded" id="component-caliber" value={caliber} onChange={e => setCaliber(e.target.value)}><option value="">All calibers</option>{calibers.map(c => <option key={c} value={c}>{c}–{c + 50} mm</option>)}</select></label>
      <button onClick={reset} disabled={!search && !nation && !caliber}>Clear filters</button>
      <div className="carousel-arrows"><button aria-label="Previous components" disabled={edges.start} onClick={() => scroll(-1)}>Previous</button><button aria-label="Next components" disabled={edges.end} onClick={() => scroll(1)}>Next</button></div>
    </div>
    <ul className="component-track" ref={track} aria-label="Component variants" onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const buttons = [...track.current!.querySelectorAll<HTMLButtonElement>('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1))); buttons[next]?.focus();
    }}>
      {thumbnails && filtered.map(p => <ComponentCard key={p.partId} part={p} selected={selectedId === p.partId} thumbnails={thumbnails} onSelect={() => onSelect(p.partId)}/>)}
    </ul>
    {!filtered.length && <div className="component-empty"><p>No components match these filters.</p><button onClick={reset}>Show all components</button></div>}
  </section>;
}
