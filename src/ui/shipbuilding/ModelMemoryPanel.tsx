import { useMemo, useState } from 'react';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from '../../ships/blueprint';
import { jsonBytes, modelMB, SHARED_MODEL, simulationMemory, type VisualMemory } from './modelMemory';
import './ModelMemoryPanel.css';

export function ModelMemoryPanel({ source, catalog, result, visual, onClose }: {
  source: ConstructionSource; catalog: ConstructionCatalog; result?: ConstructionResult;
  visual?: VisualMemory; onClose(): void;
}) {
  const [sort, setSort] = useState<'visual' | 'simulation' | 'name'>('visual');
  const [filter, setFilter] = useState('');
  const current = result?.sourceId === source.id && result.revision === source.revision ? result : undefined;
  const simulationState = useMemo(() => {
    if (!current?.definition) return {};
    try { return { data: simulationMemory(current.definition,
      [...source.construction.primitives, ...source.construction.equipment, ...source.construction.boundaries].map(p => p.id)) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [current, source]);
  const simulation = simulationState.data;
  const sourceBytes = useMemo(() => jsonBytes(source), [source]);
  const measured = visual?.sourceId === source.id && visual.revision === source.revision ? visual : undefined;
  const rows = [
    ...source.construction.primitives.map(p => ({ id: p.id, name: p.kind, kind: 'Hull' })),
    ...source.construction.equipment.map(p => ({ id: p.id, name: catalog.equipment.find(c => c.id === p.partId)?.name ?? p.partId, kind: 'Fitting' })),
    ...source.construction.boundaries.map(p => ({ id: p.id, name: p.id, kind: 'Boundary' })),
    { id: SHARED_MODEL, name: 'Shared ship data / unattributed', kind: 'Shared' },
  ].map(p => ({ ...p, sim: simulation?.parts[p.id] ?? 0, visual: measured?.parts[p.id], missing: measured?.missing.includes(p.id) }))
    .filter(p => `${p.name} ${p.id} ${p.kind}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'simulation' ? b.sim - a.sim : ((b.visual?.geometry ?? 0) + (b.visual?.textures ?? 0)) - ((a.visual?.geometry ?? 0) + (a.visual?.textures ?? 0)));
  const mb = (bytes: number | undefined) => bytes === undefined ? '—' : modelMB(bytes);
  return <aside className="sb-memory" aria-labelledby="sb-memory-title" onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'F8') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) onClose(); }
    else if (event.key !== 'Tab') event.stopPropagation();
  }}>
    <header><h2 id="sb-memory-title">Model memory</h2><button onClick={onClose} aria-label="Close model memory">Close <kbd>F8</kbd></button></header>
    <div className="sb-memory-body">
      <p className="sb-memory-name">{source.name}</p>
      <p>Open another design to inspect its model. All sizes in MB (1,000,000 bytes).</p>
      <dl className="sb-memory-totals">
        <div><dt>Simulation · runtime JSON</dt><dd>{mb(simulation?.json)} MB</dd></div>
        <div><dt>Simulation · indexed encoding</dt><dd>{mb(simulation?.encoded)} MB</dd></div>
        <div><dt>Visual · buffers + textures ≈</dt><dd>{mb(measured ? measured.geometry + measured.textures : undefined)} MB</dd></div>
        <div><dt>Geometry buffers</dt><dd>{mb(measured?.geometry)} MB</dd></div>
        <div><dt>Textures · RGBA8 + mipmaps ≈</dt><dd>{mb(measured?.textures)} MB</dd></div>
        <div><dt>Editable source · JSON</dt><dd>{mb(sourceBytes)} MB</dd></div>
      </dl>
      {!simulation && <p className="sb-memory-status" role="status">{simulationState.error ? `Simulation measurement unavailable: ${simulationState.error}` : 'Simulation unavailable until this revision compiles successfully.'}</p>}
      {(!measured || !measured.hullReady || measured.missing.length > 0) && <p className="sb-memory-status" role="status">Visual measurement incomplete: {!measured ? 'waiting for viewport.' : `${!measured.hullReady ? 'compiled hull unavailable; ' : ''}${measured.missing.length} fittings not loaded.`}</p>}
      {measured && <p>{Math.round(measured.triangles).toLocaleString()} triangles · {Math.round(measured.meshes).toLocaleString()} meshes · {measured.materials} materials</p>}
      <p className="sb-memory-note">Simulation sizes are serialized definitions, not live Rust/WASM heap usage. Visual sizes count one retained geometry copy and estimated GPU textures, excluding driver overhead, materials, editor helpers and unused cached parts. They are not GLB download sizes.</p>
      <div className="sb-memory-controls"><label>Find part<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name or ID"/></label>
        <label>Sort<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="visual">Largest visual</option><option value="simulation">Largest simulation</option><option value="name">Part name</option></select></label></div>
      <p className="sb-memory-note">Shared visual buffers and textures are apportioned across their users; hull batches by triangle count. Simulation columns attribute identified JSON records; anonymous collision geometry and ship-wide records remain shared.</p>
      <div className="sb-memory-table" tabIndex={0} role="region" aria-label="Part memory breakdown">
        <table><thead><tr><th scope="col">Part</th><th scope="col">Sim JSON<br/>MB</th><th scope="col">Geometry<br/>MB</th><th scope="col">Textures ≈<br/>MB</th><th scope="col">Triangles</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}<small>{row.kind} · {row.id === SHARED_MODEL ? 'whole ship' : row.id}{row.missing ? ' · not loaded' : ''}</small></th><td>{mb(simulation ? row.sim : undefined)}</td><td>{mb(measured && !row.missing ? row.visual?.geometry ?? 0 : undefined)}</td><td>{mb(measured && !row.missing ? row.visual?.textures ?? 0 : undefined)}</td><td>{measured && !row.missing ? Math.round(row.visual?.triangles ?? 0).toLocaleString() : '—'}</td></tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <p>No parts match “{filter}”.</p>}
      {simulation && <details><summary>Simulation sections · JSON MB</summary><dl className="sb-memory-totals">{simulation.sections.map(section => <div key={section.name}><dt>{section.name}</dt><dd>{modelMB(section.bytes)}</dd></div>)}</dl><p>Section values exclude the outer object’s keys and punctuation. Indexed encoding shares repeated records across sections.</p></details>}
    </div>
  </aside>;
}
