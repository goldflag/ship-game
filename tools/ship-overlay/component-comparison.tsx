import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer, zeroPose, type Dimensions } from './viewer';
import { views, type ViewName, type ComparisonMode } from './comparison';
import type { ReferencePack } from './reference';
import './component-comparison.css';
import beforeModels from './component-before.json';

type Kind = 'gun' | 'torpedo-launcher' | 'mast' | 'funnel';
type Match = 'exact' | 'close' | 'family' | 'missing';
type Source = { sourceUrl?: string; sourceName?: string; sourceVehicle?: string; match: Match; notes: string; referenceGlb?: string; scale?: number; yaw?: number };
type Item = { id: string; name: string; kind: Kind; modelUrl: string; reference: Source | null };
type Measurements = { ours: Dimensions; reference?: Dimensions };
const kinds: { id: Kind | 'all'; name: string }[] = [{ id: 'all', name: 'All parts' }, { id: 'gun', name: 'Guns' }, { id: 'torpedo-launcher', name: 'Torpedoes' }, { id: 'mast', name: 'Masts' }, { id: 'funnel', name: 'Funnels' }];
const matchNames: Record<Match, string> = { exact: 'Same variant', close: 'Related variant', family: 'Family reference', missing: 'No equivalent' };
const kindName = (kind: Kind) => kinds.find(k => k.id === kind)!.name;
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}
function App() {
  const host = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null);
  const [items, setItems] = useState<Item[]>([]), [catalogError, setCatalogError] = useState('');
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('part') ?? 'sk-c34-380-twin');
  const [query, setQuery] = useState(''), [kind, setKind] = useState<Kind | 'all'>('all'), [match, setMatch] = useState('all');
  const [mode, setMode] = useState<ComparisonMode>('side-by-side'), [view, setView] = useState<ViewName>('quarter'), [wireframe, setWireframe] = useState(false);
  const [revision, setRevision] = useState<'updated' | 'before'>('updated');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [readyPart, setReadyPart] = useState('');
  const [dimensions, setDimensions] = useState<Measurements>(), [triangles, setTriangles] = useState<{ ours: number; reference?: number }>();
  const item = items.find(i => i.id === selected), source = item?.reference;
  const before = beforeModels[selected as keyof typeof beforeModels];
  const showingBefore = revision === 'before' && !!before;
  const missing = !source || source.match === 'missing';
  const filtered = useMemo(() => items.filter(i => (kind === 'all' || i.kind === kind) && (match === 'all' || (i.reference?.match ?? 'missing') === match) && `${i.name} ${i.id} ${i.reference?.sourceName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [items, kind, match, query]);
  const choose = (id: string) => { setSelected(id); const url = new URL(location.href); url.searchParams.set('part', id); history.replaceState(null, '', url); };
  useEffect(() => {
    const abort = new AbortController();
    json<{ items: Item[] }>('/api/component-comparison', abort.signal).then(data => { setItems(data.items); if (!data.items.some(i => i.id === selected) && data.items.length) choose(data.items[0].id); }).catch(e => { if (!abort.signal.aborted) setCatalogError(String(e.message)); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    try { const instance = new Viewer(host.current!); viewer.current = instance; instance.style({ native: false }); return () => { viewer.current = null; instance.dispose(); }; }
    catch (e) { setError(`The 3D viewer could not start. ${String(e)}`); }
  }, []);
  useEffect(() => {
    const instance = viewer.current;
    if (!instance || !item) return;
    const abort = new AbortController();
    instance.clearModel(); instance.clearReference();
    setLoading(true); setReadyPart(''); setError(''); setDimensions(undefined); setTriangles(undefined);
    const update = () => { setDimensions(instance.dimensions()); setTriangles(instance.triangles()); instance.fit(); };
    (async () => {
      await instance.loadShip(showingBefore ? before.modelUrl : item.modelUrl, undefined, 1);
      if (abort.signal.aborted) return;
      update();
      if (source && source.match !== 'missing') {
        if (source.referenceGlb) {
          const response = await fetch(`/api/component-comparison/${item.id}/model.glb`, { signal: abort.signal });
          if (!response.ok) throw new Error((await response.json()).error ?? 'Reference extraction is unavailable.');
          const blob = await response.blob();
          if (abort.signal.aborted) return;
          await instance.loadGlb(new File([blob], `${item.id}.glb`));
        } else {
          const pack = await json<ReferencePack>(`/api/component-comparison/${item.id}/reference`, abort.signal);
          if (abort.signal.aborted) return;
          instance.loadGame(pack, 'HullDefault', []);
        }
        if (abort.signal.aborted) return;
        const pose = { ...zeroPose, scale: source.scale ?? (source.referenceGlb ? 1 : 15), yaw: source.yaw ?? 0 };
        instance.pose(pose); instance.pose(instance.alignComponent(pose));
      }
      update(); setReadyPart(item.id);
    })().catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [item, retry, showingBefore]);
  useEffect(() => { viewer.current?.comparison(missing ? 'inspect' : mode); }, [mode, missing]);
  useEffect(() => { viewer.current?.view(view); }, [view]);
  useEffect(() => { viewer.current?.style({ native: false, wireframe, oursOpacity: mode === 'overlay' ? .68 : 1, referenceOpacity: mode === 'overlay' ? .68 : 1 }); }, [wireframe, mode]);
  const stacked = view === 'port' || view === 'starboard';
  const clear = () => { setQuery(''); setKind('all'); setMatch('all'); };
  const metric = (value: number | undefined) => value === undefined ? '—' : `${value.toFixed(2)} m`;
  return <div className="comparison-app">
    <header className="page-header"><h1>Component comparisons</h1><p>Shipbuilder catalog · geometry only</p><a href="/">Model library</a></header>
    <div className="comparison-body">
      <aside className="catalog" aria-label="Shipbuilder components">
        <label className="search-label" htmlFor="part-search">Find a component</label>
        <input id="part-search" type="search" placeholder="Name, caliber or part ID" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="category-filters" aria-label="Component category">{kinds.map(k => <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.name}<span>{items.filter(i => k.id === 'all' || i.kind === k.id).length}</span></button>)}</div>
        <label className="match-filter">Reference match<select aria-label="Reference match" value={match} onChange={e => setMatch(e.target.value)}><option value="all">All matches</option>{Object.entries(matchNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <div className="list-summary"><span>{filtered.length} of {items.length} parts</span><button onClick={clear} disabled={!query && kind === 'all' && match === 'all'}>Clear filters</button></div>
        <div className="part-list">{catalogError ? <p role="alert">{catalogError} Reload the page to retry.</p> : !items.length ? <p role="status">Loading catalog…</p> : !filtered.length ? <p>No matching components. Clear the filters to see the catalog.</p> : filtered.map(i => <button className="part-row" key={i.id} aria-pressed={i.id === selected} onClick={() => choose(i.id)}><strong>{i.name}</strong><span>{kindName(i.kind)}<span className={`match-${i.reference?.match ?? 'missing'}`}>{matchNames[i.reference?.match ?? 'missing']}</span></span></button>)}</div>
      </aside>
      <main className="comparison-main" data-ready-part={readyPart} data-revision={showingBefore ? 'before' : 'updated'} aria-busy={loading}>
        <div className="selection-heading"><div><h2>{item?.name ?? 'Select a component'}</h2><p>{item?.id}</p></div><span className={`match-label match-${source?.match ?? 'missing'}`}>{item ? matchNames[source?.match ?? 'missing'] : ''}</span></div>
        <div className="viewer-toolbar">
          {before && <label>Our model<select aria-label="Our model revision" value={revision} onChange={e => setRevision(e.target.value as 'updated' | 'before')}><option value="updated">Updated</option><option value="before">Before</option></select></label>}
          <div className="mode-buttons" aria-label="Comparison mode"><button aria-pressed={mode === 'side-by-side'} onClick={() => setMode('side-by-side')} disabled={missing}>Side by side</button><button aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')} disabled={missing}>Overlay</button></div>
          <label>View<select aria-label="Camera view" value={view} onChange={e => setView(e.target.value as ViewName)}>{views.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}</select></label>
          <button onClick={() => viewer.current?.fit()}>Fit both</button>
          <label className="check-label"><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)} />Wireframe</label>
          <button className="save-image" onClick={() => viewer.current?.screenshot()} disabled={loading || !dimensions}>Save image</button>
        </div>
        <div className={`compare-stage ${stacked ? 'stacked' : ''} ${mode === 'overlay' || missing ? 'single' : ''}`}>
          <div className="comparison-viewport" ref={host} />
          <div className="model-labels" aria-hidden="true"><span className="ours-label">{showingBefore ? 'Before' : 'Updated'} · Shipbuilder</span>{!missing && <span className="reference-label">Reference · GameModels3D</span>}</div>
          {loading && <div className="stage-message" role="status">Loading component geometry…</div>}
          {error && <div className="stage-message error" role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Retry loading</button></div>}
          {!loading && !error && item && missing && <p className="missing-reference">No equivalent source model identified for this part.</p>}
          <p className="orbit-help">Drag to orbit · scroll to zoom · right-drag to pan</p>
        </div>
        <div className="comparison-details">
          <section className="source-details" aria-label="Reference details"><h3>{missing ? 'Reference unavailable' : 'Source & variant'}</h3><p>{source?.notes ?? 'This catalog entry has no verified GameModels3D equivalent yet.'}</p>{source?.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open GameModels3D source</a>}{source?.sourceName && <p className="resource-name">{source.sourceName}</p>}<p className="comparison-method">Same camera and scale. Bounds centered; bases aligned. “Same variant” identifies the source, not a fidelity score. Some AA barrels retain the source’s elevated pose.</p></section>
          <table className="measurements"><caption>Model geometry at actual scale{before && !showingBefore && triangles && <small className="triangle-change">{before.triangles.toLocaleString()} triangles before · {Math.abs((1-triangles.ours/before.triangles)*100).toFixed(1)}% {triangles.ours <= before.triangles ? 'fewer' : 'more'}</small>}</caption><thead><tr><th scope="col">Measurement</th><th scope="col" className="ours-label">{showingBefore ? 'Before' : 'Updated'}</th><th scope="col" className="reference-label">Reference</th></tr></thead><tbody>{(['length', 'beam', 'height'] as const).map(axis => <tr key={axis}><th scope="row">{axis === 'beam' ? 'Width' : axis[0].toUpperCase() + axis.slice(1)}</th><td>{metric(dimensions?.ours[axis])}</td><td>{metric(dimensions?.reference?.[axis])}</td></tr>)}<tr><th scope="row">Triangles</th><td>{triangles?.ours.toLocaleString() ?? '—'}</td><td>{triangles?.reference?.toLocaleString() ?? '—'}</td></tr></tbody></table>
        </div>
      </main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
