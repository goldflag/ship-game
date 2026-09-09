import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer, zeroPose, type Pose } from './viewer';
import { isHullConfiguration, defaultComponents, vehicleId, type ReferencePack } from './reference';
import { isSideView, views, type ComparisonMode, type ViewName } from './comparison';
import type { ComponentItem } from '../../scripts/parts/library';
import { ComponentCarousel } from './ComponentCarousel';
import './style.css';

type Ship = { id: string; name: string; modelUrl: string; length: number; configuration: string };
const matches: Record<string, string> = { bismarck: 'pgsb708', 'king-george-v': 'pbsb107', fletcher: 'pasd021' };
function App() {
  const canvas = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null), request = useRef<AbortController | null>(null);
  const initialPart = new URLSearchParams(location.search).get('part');
  const [kind, setKind] = useState<'ship' | 'component'>(initialPart ? 'component' : 'ship');
  const [parts, setParts] = useState<ComponentItem[]>([]), [partId, setPartId] = useState(initialPart ?? 'type96-25-triple');
  const [installation, setInstallation] = useState('recipe');
  const [native, setNative] = useState(true);
  const [jointPose, setJointPose] = useState({ yaw: 0, elevation: 1, recoil: 0 });
  const [ships, setShips] = useState<Ship[]>([]), [shipId, setShipId] = useState(new URLSearchParams(location.search).get('ship') ?? 'bismarck');
  const [input, setInput] = useState(matches.bismarck), [pack, setPack] = useState<ReferencePack | null>(null);
  const [hull, setHull] = useState(''), [components, setComponents] = useState<string[]>([]);
  const [pose, setPose] = useState<Pose>(zeroPose), [referenceName, setReferenceName] = useState('');
  const [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false), [modelBusy, setModelBusy] = useState(true), [error, setError] = useState('');
  const [dimensions, setDimensions] = useState<ReturnType<Viewer['dimensions']> | null>(null);
  const [ours, setOurs] = useState(true), [reference, setReference] = useState(true);
  const [ourOpacity, setOurOpacity] = useState(1), [refOpacity, setRefOpacity] = useState(.48);
  const [wireframe, setWireframe] = useState(false), [xray, setXray] = useState(false), [camera, setCamera] = useState<ViewName>('quarter');
  const [mode, setMode] = useState<ComparisonMode>('inspect');
  const selected = ships.find(s => s.id === shipId);
  const part = parts.find(p => p.partId === partId);
  const installed = part?.installations.find(i => `${i.shipId}:${i.mountId}` === installation) ?? part?.installations[0];
  const standalone = installation === 'recipe' && !!part?.modelUrl;
  const title = kind === 'ship' ? selected?.name : part?.name;
  useEffect(() => {
    try { viewer.current = new Viewer(canvas.current!); } catch (e) { setError(`Cannot start the 3D viewer: ${String(e)}. Enable browser hardware acceleration and reload.`); setModelBusy(false); }
    const controller = new AbortController();
    fetch('/api/ships', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Could not load the fleet. Restart bun run ship:overlay.'); return r.json(); }).then((data: Ship[]) => { setShips(data); if (!data.some(s => s.id === shipId)) { setShipId(data[0]?.id ?? 'bismarck'); setNotice('Unknown ship link; showing the first available ship.'); } }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setModelBusy(false); } });
    fetch('/api/components', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('Could not load the component library.'); return r.json(); }).then((data: ComponentItem[]) => { setParts(data); if (!data.some(p => p.partId === partId)) { setPartId(data[0]?.partId ?? ''); setNotice('Unknown component link; showing the first available component.'); } }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setModelBusy(false); } });
    return () => { controller.abort(); request.current?.abort(); viewer.current?.dispose(); };
  }, []);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (kind === 'ship' && !selected || kind === 'component' && !part) return;
    let cancelled = false; setModelBusy(true); setModelReady(false); setDimensions(null); setError(''); v.clearModel();
    const url = kind === 'ship' ? selected?.modelUrl : standalone ? part?.modelUrl : installed?.modelUrl;
    setJointPose({ yaw: 0, elevation: 1, recoil: 0 });
    if (!url) { setModelBusy(false); setDimensions(null); return; }
    const options = kind === 'component' && part ? { assemblyId: standalone ? 'component' : installed!.mountId, weapon: part.weapon, installed: !standalone } : undefined;
    v.loadShip(url, options).then(loaded => { if (!cancelled && loaded) { setModelReady(true); setDimensions(kind === 'component' ? v.componentPose(0, 1, 0) : v.dimensions()); setModelBusy(false); } }).catch(e => { if (!cancelled) { setError(`Model could not load: ${e.message}`); setModelBusy(false); } });
    const params = new URLSearchParams(); params.set(kind === 'ship' ? 'ship' : 'part', kind === 'ship' ? shipId : partId); history.replaceState(null, '', `?${params}`);
    return () => { cancelled = true; };
  }, [selected, kind, part, standalone, installed, shipId, partId]);
  useEffect(() => { if (modelReady && kind === 'component' && viewer.current) setDimensions(viewer.current.componentPose(jointPose.yaw, jointPose.elevation, jointPose.recoil)); }, [jointPose, kind, modelReady]);
  useEffect(() => {
    if (!pack || !viewer.current) return;
    try { viewer.current.loadGame(pack, hull, components); const bounds = viewer.current.pose(pose); if (modelReady) setDimensions(bounds); viewer.current.fit(); }
    catch (e) { setError(String(e)); }
  }, [pack, hull, components]);
  useEffect(() => { if (viewer.current) { const bounds = viewer.current.pose(pose); if (modelReady) setDimensions(bounds); } }, [pose, modelReady]);
  useEffect(() => { viewer.current?.style({ ours, reference, oursOpacity: ourOpacity, referenceOpacity: refOpacity, wireframe, xray, native }); }, [ours, reference, ourOpacity, refOpacity, wireframe, xray, native]);
  useEffect(() => { viewer.current?.comparison(mode); }, [mode]);
  function clearComparison() {
    request.current?.abort(); request.current = null; setBusy(false); setError(''); setNotice(''); viewer.current?.clearReference(); setPack(null); setReferenceName(''); setPose(zeroPose);
  }
  function choosePart(id: string) { clearComparison(); setPartId(id); setInstallation('recipe'); setInput(''); }
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
      let configuration = { hull: Object.keys(p.scheme).find(k => k === 'A_Hull') ?? Object.keys(p.scheme).find(k => isHullConfiguration(k))!, components: defaultComponents(p.scheme), pose: { ...zeroPose } };
      try {
        const saved = JSON.parse(localStorage.getItem(`ship-overlay:${kind === 'ship' ? shipId : `part:${partId}`}:${id}`) ?? 'null');
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
    try { if (await viewer.current!.loadGlb(file)) { setPack(null); setReferenceName(file.name); const initial = { ...zeroPose, scale: 1 }; setPose(initial); const bounds = viewer.current!.pose(initial); if (modelReady) setDimensions(bounds); viewer.current!.fit(); } }
    catch (e) { setError(`Could not load that GLB: ${String(e)}`); }
  }
  function updatePose(key: keyof Pose, value: string) {
    const n = Number(value); if (!Number.isFinite(n) || (key === 'scale' && (n <= 0 || n > 1000))) return;
    setPose(p => ({ ...p, [key]: n }));
  }
  function save() {
    if (!pack) return;
    try { localStorage.setItem(`ship-overlay:${kind === 'ship' ? shipId : `part:${partId}`}:${pack.vehicle}`, JSON.stringify({ pose, hull, components })); setNotice('Alignment saved in this browser.'); }
    catch { setError('Browser storage is unavailable. Keep this tab open to retain the alignment.'); }
  }
  const [notice, setNotice] = useState('');
  return <div className="app">
    <header><h1>Model library</h1><p>Fleet Command · model inspection</p><button onClick={() => viewer.current?.screenshot()} disabled={!modelReady}>Save image</button></header>
    <main>
      <section className="stage" aria-label="Model comparison">
        <div className="stage-toolbar">
          <div className="comparison-mode" role="group" aria-label="Comparison mode">{(['inspect', 'overlay', 'side-by-side'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setNative(m === 'inspect'); setOurOpacity(m === 'inspect' ? 1 : .72); }}>{m === 'inspect' ? 'Inspect' : m === 'overlay' ? 'Overlay' : 'Side by side'}</button>)}</div>
          <div className="stage-title"><h2>{title ?? 'Loading library…'}</h2><p>{kind === 'component' ? `${part?.family ?? ''} · ${standalone ? 'Shared recipe' : 'Installed model preview'}` : referenceName && mode !== 'inspect' ? `Compared with ${referenceName}` : selected?.configuration}</p></div>
          <nav className="views" aria-label="Camera views">{views.map(v => <button key={v.name} aria-pressed={camera === v.name} onClick={() => { setCamera(v.name); viewer.current?.view(v.name); }}>{v.label}</button>)}</nav>
        </div>
        <div className={`scene-area ${mode} ${isSideView(camera) ? 'profile-view' : ''}`}>
        <div className="viewport" ref={canvas} />
        {mode === 'side-by-side' && <div className="pane-labels" aria-label="Synchronized comparison panels"><span className="our-key">Our model{ours ? '' : ' · hidden'}</span><span className="ref-key">Reference{referenceName ? reference ? '' : ' · hidden' : ' · not loaded'}</span></div>}
        {!modelBusy && kind === 'component' && part && !standalone && !installed && <div className="loading" role="status">No preview yet. Build the registered component to inspect it.</div>}
        {modelBusy && <div className="loading" role="status">Loading model…</div>}
        {mode === 'overlay' && <div className="legend"><span className="our-key">Our model</span><span className="ref-key">Reference {referenceName ? '' : '· not loaded'}</span></div>}
        </div>
        <div className="stage-footer"><div className="actions"><button onClick={() => viewer.current?.fit()}>{mode === 'inspect' ? 'Fit model' : 'Fit both'}</button><button onClick={() => viewer.current?.zoomBy(1.25)}>Zoom in</button><button onClick={() => viewer.current?.zoomBy(.8)}>Zoom out</button></div>
        <p className="navigation">Drag to orbit · Right-drag to pan · Scroll to zoom<br />Keyboard: arrows pan · +/− zoom · Home fits the view<br />Orthographic · Grid {kind === 'component' ? '1 m · Mount datum Y = 0' : '10 m · Waterline Y = 0'}</p></div>
      </section>
      <aside aria-label="Model controls">
        {notice && <p className="subtle" role="status">{notice}</p>}
        {error && <div className="error" role="alert"><p>{error}</p><button onClick={() => location.reload()}>Reload viewer</button></div>}
        <section className="library-picker"><h2>Browse library</h2>
          <div className="comparison-mode" role="group" aria-label="Library category">{(['ship', 'component'] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => { clearComparison(); setKind(k); }}>{k === 'ship' ? 'Ships' : 'Components'}</button>)}</div>
          {kind === 'ship' ? <><label htmlFor="ship">Ship</label><select id="ship" value={shipId} onChange={e => chooseShip(e.target.value)}>{ships.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></> : <>
            {part && <><p className="part-identity">{part.nation} · {part.builder ? 'Reusable source' : 'Awaiting source extraction'}</p><code className="part-id">{part.partId}</code>
              <label htmlFor="installation">Preview source</label><select id="installation" value={standalone ? 'recipe' : installed ? `${installed.shipId}:${installed.mountId}` : 'none'} onChange={e => setInstallation(e.target.value)}>
                {part.modelUrl && <option value="recipe">Standalone shared component</option>}{part.installations.map(i => <option key={`${i.shipId}:${i.mountId}`} value={`${i.shipId}:${i.mountId}`}>{i.shipName} · {i.mountId}</option>)}{!part.modelUrl && !installed && <option value="none">No preview available</option>}
              </select>
              {part.builder && part.previewStatus !== 'current' && <p className="subtle">Shared preview {part.previewStatus}. Build it with <code>bun run part:build {part.partId}</code>, then reload.</p>}
              <p className="subtle">Review: {part.review}. {part.limitations}</p>
              <p className="subtle">Mounting radius {part.weapon.barbetteRadius.toFixed(2)} m · {part.weapon.barrelCount ?? 2} barrels. Surrounding platforms and ship clearance require installation review.</p>
              {!standalone && <p className="subtle">Isolated from a published ship. Includes its attached fittings; this preview is not reusable authoring source.</p>}
              {part.builder && <details><summary>Use in a ship recipe</summary><p className="subtle">Set blueprint <code>partId</code> to the ID above. Call <code>library.create_mount</code> with the compiled mount, helpers and materials. Declare dependencies from <code>bun run part:inputs {part.partId}</code>.</p></details>}
            </>}
          </>}
        </section>
        {kind === 'component' && part && <section><h2>Articulation</h2><fieldset disabled={!modelReady}>{([
          ['yaw', 'Traverse', -part.weapon.traverseDeg, part.weapon.traverseDeg, 1],
          ['elevation', 'Elevation', part.weapon.elevationMinDeg, part.weapon.elevationMaxDeg, 1],
          ['recoil', 'Recoil', 0, 1, .01],
        ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<output className="joint-value">{key === 'recoil' ? `${Math.round(jointPose[key] * 100)}%` : `${jointPose[key]}°`}</output><input aria-label={label} type="range" min={min} max={max} step={step} value={jointPose[key]} onChange={e => setJointPose(p => ({ ...p, [key]: +e.target.value }))}/></label>)}<button onClick={() => setJointPose({ yaw: 0, elevation: 1, recoil: 0 })}>Reset pose</button></fieldset><p className="subtle">Catalog travel only. This does not certify clearance against a ship or neighboring mounts.</p></section>}
        {mode !== 'inspect' && <section><h2>Reference model</h2><form onSubmit={e => { e.preventDefault(); void loadGame(); }}><label htmlFor="source">GameModels3D URL or vehicle ID</label><input id="source" value={input} onChange={e => setInput(e.target.value)} placeholder="Paste a WoWS vehicle page URL" spellCheck={false}/><button className="primary" type="submit" disabled={busy || !input.trim()}>{busy ? 'Downloading reference…' : 'Load from GameModels3D'}</button></form>
          <label className="file-button">Open a local GLB<input type="file" accept=".glb" onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }}/></label>
          <p className="subtle">Downloads stay on this computer. WoWS references start at 15 m per viewer unit; verify scale and waterline before judging accuracy.</p>

          {pack && <><a href={pack.url} target="_blank" rel="noreferrer">Open source: {pack.vehicle}</a><p className="subtle">Cached {new Date(pack.fetchedAt).toLocaleDateString()}{pack.omitted.length ? ` · ${pack.omitted.length} empty source components omitted` : ''}</p><details><summary>Hull and equipment configuration</summary><label htmlFor="hull">Hull</label><select id="hull" value={hull} onChange={e => { setHull(e.target.value); setComponents(defaultComponents(pack.scheme, e.target.value)); }}>{Object.keys(pack.scheme).filter(k => isHullConfiguration(k)).map(k => <option key={k}>{k}</option>)}</select><div className="equipment">{Object.keys(pack.scheme).filter(k => !isHullConfiguration(k)).map(k => <label key={k}><input type="checkbox" checked={components.includes(k)} onChange={e => setComponents(c => e.target.checked ? [...c, k] : c.filter(x => x !== k))}/>{k}</label>)}</div></details></>}
        </section>}
        <section><h2>Display</h2><label className="check"><input type="checkbox" checked={native} onChange={e => setNative(e.target.checked)}/>Original materials</label><label className="check our-key"><input type="checkbox" checked={ours} onChange={e => setOurs(e.target.checked)}/>Our model <output>{Math.round(ourOpacity * 100)}%</output></label><input aria-label="Our model opacity" type="range" min="0" max="1" step="0.01" value={ourOpacity} onChange={e => setOurOpacity(+e.target.value)}/>{mode !== 'inspect' && <><label className="check ref-key"><input type="checkbox" checked={reference} onChange={e => setReference(e.target.checked)}/>Reference <output>{Math.round(refOpacity * 100)}%</output></label><input aria-label="Reference opacity" type="range" min="0" max="1" step="0.01" value={refOpacity} onChange={e => setRefOpacity(+e.target.value)}/></>}<div className="checks"><label><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)}/>Wireframe</label><label><input type="checkbox" checked={xray} onChange={e => setXray(e.target.checked)}/>X-ray</label></div></section>
        {mode !== 'inspect' && <section><h2>Reference alignment</h2><fieldset disabled={!referenceName}><div className="fields">{([['x', 'X · starboard (m)'], ['y', 'Y · height (m)'], ['z', 'Z · aft (m)'], ['yaw', 'Yaw (°)'], ['pitch', 'Pitch (°)'], ['roll', 'Roll (°)'], ['scale', 'Uniform scale']] as [keyof Pose, string][]).map(([key, label]) => <label key={key}>{label}<input type="number" step={key === 'scale' ? '.01' : '.1'} min={key === 'scale' ? '.0001' : undefined} value={pose[key]} onChange={e => updatePose(key, e.target.value)}/></label>)}</div><div className="actions"><button onClick={() => setPose(p => viewer.current!.center(p))}>Center X/Z</button><button onClick={() => setPose({ ...zeroPose, scale: pack ? 15 : 1 })}>Reset</button></div><button className="wide" disabled={!pack} onClick={save}>Save alignment for this pair</button></fieldset><p className="subtle">Centering preserves vertical position. Use uniform scale only; matching length alone can hide a proportion error.</p></section>}
        <section><h2>Visible model bounds</h2><table><thead><tr><th scope="col">Metres</th><th scope="col" className="our-key">Ours</th><th scope="col" className="ref-key">Reference</th></tr></thead><tbody>{(['length', 'beam', 'height'] as const).map(k => <tr key={k}><th scope="row">{k}</th><td>{(modelReady ? dimensions : null)?.ours[k].toFixed(2) ?? '—'}</td><td>{(modelReady ? dimensions : null)?.reference?.[k].toFixed(2) ?? '—'}</td></tr>)}</tbody></table><p className="subtle">Whole-model axis-aligned bounds, including fittings. This is a visual comparison, not a historical accuracy score.</p></section>
      </aside>
    </main>
    {kind === 'component' && <ComponentCarousel parts={parts} selectedId={partId} onSelect={choosePart}/>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
