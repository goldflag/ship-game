import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer, zeroPose, type Pose } from './viewer';
import { defaultComponents, vehicleId, type ReferencePack } from './reference';
import { isSideView, views, type ComparisonMode, type ViewName } from './comparison';
import './style.css';

type Ship = { id: string; name: string; modelUrl: string; length: number; configuration: string };
const matches: Record<string, string> = { bismarck: 'pgsb708', 'king-george-v': 'pbsb107', fletcher: 'pasd021' };
function App() {
  const canvas = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null), request = useRef<AbortController | null>(null);
  const [ships, setShips] = useState<Ship[]>([]), [shipId, setShipId] = useState('bismarck');
  const [input, setInput] = useState(matches.bismarck), [pack, setPack] = useState<ReferencePack | null>(null);
  const [hull, setHull] = useState(''), [components, setComponents] = useState<string[]>([]);
  const [pose, setPose] = useState<Pose>(zeroPose), [referenceName, setReferenceName] = useState('');
  const [busy, setBusy] = useState(false), [modelBusy, setModelBusy] = useState(true), [error, setError] = useState('');
  const [dimensions, setDimensions] = useState<ReturnType<Viewer['dimensions']> | null>(null);
  const [ours, setOurs] = useState(true), [reference, setReference] = useState(true);
  const [ourOpacity, setOurOpacity] = useState(.72), [refOpacity, setRefOpacity] = useState(.48);
  const [wireframe, setWireframe] = useState(false), [xray, setXray] = useState(false), [camera, setCamera] = useState<ViewName>('quarter');
  const [mode, setMode] = useState<ComparisonMode>('overlay');
  const selected = ships.find(s => s.id === shipId);
  useEffect(() => {
    try { viewer.current = new Viewer(canvas.current!); } catch (e) { setError(`Cannot start the 3D viewer: ${String(e)}. Enable browser hardware acceleration and reload.`); setModelBusy(false); }
    const controller = new AbortController();
    fetch('/api/ships', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Could not load the fleet. Restart bun run ship:overlay.'); return r.json(); }).then(setShips).catch(e => { if (!controller.signal.aborted) { setError(e.message); setModelBusy(false); } });
    return () => { controller.abort(); request.current?.abort(); viewer.current?.dispose(); };
  }, []);
  useEffect(() => {
    if (!selected || !viewer.current) return;
    let cancelled = false; setModelBusy(true);
    viewer.current.loadShip(selected.modelUrl).then(() => { if (!cancelled) { setDimensions(viewer.current!.dimensions()); setModelBusy(false); } }).catch(e => { if (!cancelled) { setError(`Our model could not load: ${e.message}`); setModelBusy(false); } });
    return () => { cancelled = true; };
  }, [selected]);
  useEffect(() => {
    if (!pack || !viewer.current) return;
    try { viewer.current.loadGame(pack, hull, components); setDimensions(viewer.current.pose(pose)); viewer.current.fit(); }
    catch (e) { setError(String(e)); }
  }, [pack, hull, components]);
  useEffect(() => { if (viewer.current) setDimensions(viewer.current.pose(pose)); }, [pose]);
  useEffect(() => { viewer.current?.style({ ours, reference, oursOpacity: ourOpacity, referenceOpacity: refOpacity, wireframe, xray }); }, [ours, reference, ourOpacity, refOpacity, wireframe, xray]);
  useEffect(() => { viewer.current?.comparison(mode); }, [mode]);
  function chooseShip(id: string) {
    request.current?.abort(); request.current = null; setBusy(false); setError(''); setNotice('');
    viewer.current?.clearReference(); setPack(null); setReferenceName(''); setDimensions(null); setShipId(id); setInput(matches[id] ?? ''); setPose(zeroPose);
  }
  async function loadGame() {
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setError('');
    try {
      const id = vehicleId(input);
      const response = await fetch(`/api/reference/${id}`, { signal: controller.signal }); const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Reference download failed.');
      if (controller.signal.aborted) return;
      const p = data as ReferencePack;
      let configuration = { hull: Object.keys(p.scheme).find(k => k === 'A_Hull') ?? Object.keys(p.scheme).find(k => k.endsWith('_Hull'))!, components: defaultComponents(p.scheme), pose: { ...zeroPose } };
      try {
        const saved = JSON.parse(localStorage.getItem(`ship-overlay:${shipId}:${id}`) ?? 'null');
        if (saved && p.scheme[saved.hull] && Array.isArray(saved.components) && Object.keys(zeroPose).every(k => Number.isFinite(saved.pose?.[k])) && saved.pose.scale > 0 && saved.pose.scale <= 1000) configuration = saved;
      } catch {}
      setHull(configuration.hull); setComponents(configuration.components); setPose(configuration.pose); setPack(p); setReferenceName(p.name.replace(/&#0*39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (request.current === controller) setBusy(false); }
  }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    request.current?.abort(); request.current = null; setBusy(false); setError('');
    if (!file.name.toLowerCase().endsWith('.glb')) { setError('Choose a self-contained .glb reference model.'); return; }
    try { if (await viewer.current!.loadGlb(file)) { setPack(null); setReferenceName(file.name); const initial = { ...zeroPose, scale: 1 }; setPose(initial); setDimensions(viewer.current!.pose(initial)); viewer.current!.fit(); } }
    catch (e) { setError(`Could not load that GLB: ${String(e)}`); }
  }
  function updatePose(key: keyof Pose, value: string) {
    const n = Number(value); if (!Number.isFinite(n) || (key === 'scale' && (n <= 0 || n > 1000))) return;
    setPose(p => ({ ...p, [key]: n }));
  }
  function save() {
    if (!pack) return;
    try { localStorage.setItem(`ship-overlay:${shipId}:${pack.vehicle}`, JSON.stringify({ pose, hull, components })); setNotice('Alignment saved in this browser.'); }
    catch { setError('Browser storage is unavailable. Keep this tab open to retain the alignment.'); }
  }
  const [notice, setNotice] = useState('');
  return <div className="app">
    <header><h1>Ship overlay</h1><p>Fleet Command · model inspection</p><button onClick={() => viewer.current?.screenshot()} disabled={modelBusy}>Save image</button></header>
    <main>
      <section className="stage" aria-label="Model comparison">
        <div className="stage-toolbar">
          <div className="comparison-mode" role="group" aria-label="Comparison mode">{(['overlay', 'side-by-side'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'overlay' ? 'Overlay' : 'Side by side'}</button>)}</div>
          <div className="stage-title"><h2>{selected?.name ?? 'Loading fleet…'}</h2><p>{referenceName ? `Compared with ${referenceName}` : 'Load a reference to compare silhouettes and fittings.'}</p></div>
          <nav className="views" aria-label="Camera views">{views.map(v => <button key={v.name} aria-pressed={camera === v.name} onClick={() => { setCamera(v.name); viewer.current?.view(v.name); }}>{v.label}</button>)}</nav>
        </div>
        <div className={`scene-area ${mode} ${isSideView(camera) ? 'profile-view' : ''}`}>
        <div className="viewport" ref={canvas} />
        {mode === 'side-by-side' && <div className="pane-labels" aria-label="Synchronized comparison panels"><span className="our-key">Our ship{ours ? '' : ' · hidden'}</span><span className="ref-key">Reference{referenceName ? reference ? '' : ' · hidden' : ' · not loaded'}</span></div>}
        {modelBusy && <div className="loading" role="status">Loading our ship…</div>}
        {mode === 'overlay' && <div className="legend"><span className="our-key">Our ship</span><span className="ref-key">Reference {referenceName ? '' : '· not loaded'}</span></div>}
        </div>
        <div className="stage-footer"><div className="actions"><button onClick={() => viewer.current?.fit()}>Fit both</button><button onClick={() => viewer.current?.zoomBy(1.25)}>Zoom in</button><button onClick={() => viewer.current?.zoomBy(.8)}>Zoom out</button></div>
        <p className="navigation">Drag to orbit · Right-drag to pan · Scroll to zoom<br />Keyboard: arrows pan · +/− zoom · Home fits both<br />Same camera & scale · Orthographic · Grid 10 m · Waterline Y = 0</p></div>
      </section>
      <aside aria-label="Comparison controls">
        <section><label htmlFor="ship">Our ship</label><select id="ship" value={shipId} onChange={e => chooseShip(e.target.value)}>{ships.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><p className="subtle">{selected?.configuration}</p></section>
        <section><h2>Reference model</h2><form onSubmit={e => { e.preventDefault(); void loadGame(); }}><label htmlFor="source">GameModels3D URL or vehicle ID</label><input id="source" value={input} onChange={e => setInput(e.target.value)} placeholder="Paste a WoWS vehicle page URL" spellCheck={false}/><button className="primary" type="submit" disabled={busy || !input.trim()}>{busy ? 'Downloading reference…' : 'Load from GameModels3D'}</button></form>
          <label className="file-button">Open a local GLB<input type="file" accept=".glb" onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }}/></label>
          <p className="subtle">Downloads stay on this computer. WoWS references start at 15 m per viewer unit; verify scale and waterline before judging accuracy.</p>
          {error && <div className="error" role="alert"><p>{error}</p><button onClick={() => location.reload()}>Reload viewer</button></div>}
          {pack && <><a href={pack.url} target="_blank" rel="noreferrer">Open source: {pack.vehicle}</a><p className="subtle">Cached {new Date(pack.fetchedAt).toLocaleDateString()}{pack.omitted.length ? ` · ${pack.omitted.length} empty source components omitted` : ''}</p><details><summary>Hull and equipment configuration</summary><label htmlFor="hull">Hull</label><select id="hull" value={hull} onChange={e => { setHull(e.target.value); setComponents(defaultComponents(pack.scheme, e.target.value)); }}>{Object.keys(pack.scheme).filter(k => k.endsWith('_Hull')).map(k => <option key={k}>{k}</option>)}</select><div className="equipment">{Object.keys(pack.scheme).filter(k => !k.endsWith('_Hull')).map(k => <label key={k}><input type="checkbox" checked={components.includes(k)} onChange={e => setComponents(c => e.target.checked ? [...c, k] : c.filter(x => x !== k))}/>{k}</label>)}</div></details></>}
        </section>
        <section><h2>Display</h2><label className="check our-key"><input type="checkbox" checked={ours} onChange={e => setOurs(e.target.checked)}/>Our ship <output>{Math.round(ourOpacity * 100)}%</output></label><input aria-label="Our ship opacity" type="range" min="0" max="1" step="0.01" value={ourOpacity} onChange={e => setOurOpacity(+e.target.value)}/><label className="check ref-key"><input type="checkbox" checked={reference} onChange={e => setReference(e.target.checked)}/>Reference <output>{Math.round(refOpacity * 100)}%</output></label><input aria-label="Reference opacity" type="range" min="0" max="1" step="0.01" value={refOpacity} onChange={e => setRefOpacity(+e.target.value)}/><div className="checks"><label><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)}/>Wireframe</label><label><input type="checkbox" checked={xray} onChange={e => setXray(e.target.checked)}/>X-ray</label></div></section>
        <section><h2>Reference alignment</h2><fieldset disabled={!referenceName}><div className="fields">{([['x', 'X · starboard (m)'], ['y', 'Y · height (m)'], ['z', 'Z · aft (m)'], ['yaw', 'Yaw (°)'], ['pitch', 'Pitch (°)'], ['roll', 'Roll (°)'], ['scale', 'Uniform scale']] as [keyof Pose, string][]).map(([key, label]) => <label key={key}>{label}<input type="number" step={key === 'scale' ? '.01' : '.1'} min={key === 'scale' ? '.0001' : undefined} value={pose[key]} onChange={e => updatePose(key, e.target.value)}/></label>)}</div><div className="actions"><button onClick={() => setPose(p => viewer.current!.center(p))}>Center X/Z</button><button onClick={() => setPose({ ...zeroPose, scale: pack ? 15 : 1 })}>Reset</button></div><button className="wide" disabled={!pack} onClick={save}>Save alignment for this pair</button></fieldset><p className="subtle">Centering preserves vertical position. Use uniform scale only; matching length alone can hide a proportion error.</p><p role="status" className="subtle">{notice}</p></section>
        <section><h2>Visible model bounds</h2><table><thead><tr><th scope="col">Metres</th><th scope="col" className="our-key">Ours</th><th scope="col" className="ref-key">Reference</th></tr></thead><tbody>{(['length', 'beam', 'height'] as const).map(k => <tr key={k}><th scope="row">{k}</th><td>{dimensions?.ours[k].toFixed(2) ?? '—'}</td><td>{dimensions?.reference?.[k].toFixed(2) ?? '—'}</td></tr>)}</tbody></table><p className="subtle">Whole-model axis-aligned bounds, including fittings. This is a visual comparison, not a historical accuracy score.</p></section>
      </aside>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
