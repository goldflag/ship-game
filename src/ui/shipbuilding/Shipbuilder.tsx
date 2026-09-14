import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConstructionCatalog, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { assignConstructionSurfaces, CONSTRUCTION_FACES, copyConstructionSelection, editableConstructionSurfaces, moveConstructionSelection, newConstructionId, removeConstructionSelection, rotateConstructionSelection, surfaceKey } from '../../ships/constructionEditor';
import { Button, Input, Select, SelectOption } from '../components';
import { Icon } from '../Icons';
import { BuilderViewport, type BuilderDisplay, type BuilderPick, type BuilderView, type ConstructionModelFactory } from './BuilderViewport';
import { NumberField } from './NumberField';
import { ArmorInspection } from './ArmorInspection';
import type { BuilderPlacement } from './primitiveGeometry';
import { BuilderLibrary, downloadConstructionSource } from './BuilderLibrary';
import { CONSTRUCTION_PAINTS } from './paints';
import { normalizedBearing, snapCoordinate } from './editorNumbers';
import { freshConstruction, useBuilderSource, type BuilderCompiler } from './useBuilderSource';
import { ConstructionClient } from '../../ships/constructionClient';
import { createStarterSource, type ConstructionStarter } from '../../ships/constructionStarter';
import { createConstructionModel } from '../../game/constructionModel';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
import './Shipbuilder.css';

export interface ShipbuilderProps {
  catalog: ConstructionCatalog;
  starterSource?: ConstructionSource;
  compileClient?: BuilderCompiler;
  initialSource?: ConstructionSource;
  initialDesignId?: string;
  onClose(): void;
  onLaunch(source: ConstructionSource, result: ConstructionResult): void | Promise<void>;
  onSave?(source: ConstructionSource): void;
  createModel?: ConstructionModelFactory;
  suggestLayout?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
}
type Workbench = 'hull' | 'surfaces' | 'equipment' | 'rooms' | 'library';
type Tool = 'select' | 'place' | 'brush' | 'erase';
const SHAPES: { id: string; name: string; kind: ConstructionPrimitive['kind']; size: Vec3 }[] = [
  { id: 'cube', name: 'Cube', kind: 'box', size: [1, 1, 1] }, { id: 'slab', name: 'Slab', kind: 'box', size: [4, 1, 4] },
  { id: 'wedge', name: 'Wedge', kind: 'wedge', size: [4, 4, 4] }, { id: 'corner', name: 'Outside corner', kind: 'corner', size: [4, 4, 4] },
  { id: 'inverse-corner', name: 'Inside corner', kind: 'inverse-corner', size: [4, 4, 4] },
  { id: 'shallow', name: 'Shallow slope', kind: 'wedge', size: [4, 1, 4] }, { id: 'long', name: 'Long slope', kind: 'wedge', size: [4, 2, 8] },
];
const axisNames = ['X', 'Y', 'Z'];
const ARMOR_PRESETS = [
  { id: 'skin', name: 'Structural skin', thicknessMm: 0, material: 'steel' },
  { id: '25', name: '25 mm armor steel', thicknessMm: 25, material: 'armor-steel' },
  { id: '100', name: '100 mm armor steel', thicknessMm: 100, material: 'armor-steel' },
  { id: '300', name: '300 mm armor steel', thicknessMm: 300, material: 'armor-steel' },
] as const;
const format = (number: number | undefined, digits = 1) => number === undefined || !Number.isFinite(number) ? '—' : number.toLocaleString(undefined, { maximumFractionDigits: digits });

export function Shipbuilder(props: ShipbuilderProps) {
  const [compiler] = useState<BuilderCompiler>(() => props.compileClient ?? new ConstructionClient());
  const [starterSource] = useState(() => props.starterSource ?? createStarterSource(props.catalog));
  const [starterKind, setStarterKind] = useState<ConstructionStarter>('patrol');
  const editor = useBuilderSource({ ...props, starterSource, compiler, catalogRevision: props.catalog.revision });
  const { source, result } = editor, data = source.construction;
  const [activeCatalog, setActiveCatalog] = useState(props.catalog);
  const catalog = activeCatalog.revision === data.catalogRevision ? activeCatalog : { ...activeCatalog, equipment: [] };
  useEffect(() => {
    if (activeCatalog.revision === data.catalogRevision) return;
    let active = true;
    void loadConstructionCatalog(data.catalogRevision).then(catalog => { if (active) setActiveCatalog(catalog); }).catch(cause => { if (active) editor.setError(`The saved equipment revision is unavailable. ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { active = false; };
  }, [data.catalogRevision, activeCatalog.revision]);
  const [workbench, setWorkbench] = useState<Workbench>('hull');
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<BuilderView>('orbit');
  const [display, setDisplay] = useState<BuilderDisplay>('paint');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [surfaces, setSurfaces] = useState<Set<string>>(new Set());
  const [shape, setShape] = useState('cube');
  const [size, setSize] = useState<Vec3>([1, 1, 1]);
  const [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const [bearing, setBearing] = useState(0);
  const [count, setCount] = useState(1);
  const [rowAxis, setRowAxis] = useState('z');
  const [slice, setSlice] = useState<number | undefined>();
  const [fitRequest, setFitRequest] = useState(0);
  const [partId, setPartId] = useState(catalog.equipment[0]?.id ?? '');
  const [partQuery, setPartQuery] = useState('');
  const [armor, setArmor] = useState(25);
  const [material, setMaterial] = useState<ConstructionSurfaceAssignment['material']>('steel');
  const [paint, setPaint] = useState('naval-gray');
  const [paintBrush, setPaintBrush] = useState(false);
  const [boundaryAxis, setBoundaryAxis] = useState<'x' | 'y' | 'z'>('z');
  const [boundaryOffset, setBoundaryOffset] = useState(0);
  const [boundaryThickness, setBoundaryThickness] = useState(10);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<ConstructionSuggestion>();
  const [suggestionRevision, setSuggestionRevision] = useState('');
  const suggestionRequest = useRef<AbortController | undefined>(undefined);
  const selectedPrimitive = data.primitives.find(part => selected.has(part.id));
  const selectedEquipment = data.equipment.find(part => selected.has(part.id));
  const selectedBoundary = data.boundaries.find(wall => selected.has(wall.id));
  const equipmentPart = catalog.equipment.find(part => part.id === (selectedEquipment?.partId ?? partId));
  const selectedItem = selectedPrimitive ?? selectedEquipment;
  const gridStep = workbench === 'equipment' ? .25 : 1;
  const placementPart = catalog.equipment.find(part => part.id === partId);
  const placementPiece: BuilderPlacement | undefined = workbench === 'equipment'
    ? placementPart && { kind: 'equipment', size: placementPart.size, boundsCenter: placementPart.boundsCenter, bearingDeg: bearing }
    : { kind: 'hull', shape: SHAPES.find(entry => entry.id === shape)!.kind, size, rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90) };
  const editableSurfaces = useMemo(() => editableConstructionSurfaces(source, editor.currentResult?.surfaces ?? []), [source, editor.currentResult]);
  const allSurfaceKeys = useMemo(() => [...new Set(editableSurfaces.map(surface => surfaceKey(surface.primitiveId, surface.face)))], [editableSurfaces]);
  const fail = (cause: unknown) => editor.setError(cause instanceof Error ? cause.message : String(cause));
  const run = (label: string, command: (draft: ConstructionSource) => void) => { editor.setError(''); setNotice(''); editor.edit(label, command); };
  const requestSuggestion = props.suggestLayout ?? (compiler.suggest ? (source: ConstructionSource, ids: string[], signal?: AbortSignal) => compiler.suggest!(source, ids, signal) : undefined);
  const suggestionChanged = suggestion && JSON.stringify([data.equipment, data.boundaries, data.loads]) !== JSON.stringify([suggestion.source.construction.equipment, suggestion.source.construction.boundaries, suggestion.source.construction.loads]);

  useEffect(() => { setSelected(new Set()); setSurfaces(new Set()); setSuggestion(undefined); }, [source.id]);
  useEffect(() => () => { suggestionRequest.current?.abort(); suggestionRequest.current = undefined; }, [source.revision]);
  const choose = (id: string, additive = false) => setSelected(current => {
    if (!additive) return new Set([id]); const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const remove = () => { if (!selected.size) return; run('Remove selection', draft => removeConstructionSelection(draft, selected)); setSelected(new Set()); setSurfaces(new Set()); };
  const copy = (mirror = false) => {
    if (!selected.size) return;
    if (data.primitives.length + data.primitives.filter(part => selected.has(part.id)).length > 512 || data.equipment.length + data.equipment.filter(part => selected.has(part.id)).length > 128) {
      editor.setError('This copy would exceed the design limit. Select fewer pieces or remove a section first.'); return;
    }
    const next = structuredClone(source);
    const copied = copyConstructionSelection(next, selected, { mirror });
    if (!copied.length) return;
    run(mirror ? 'Mirror selection' : 'Copy selection', draft => { draft.construction = next.construction; });
    setSelected(new Set(copied)); setSurfaces(new Set());
    setNotice(mirror ? 'Mirrored a copy across the centerline.' : 'Copied the selection 1 m to starboard.');
  };
  const place = (points: Vec3[]) => {
    if (workbench === 'equipment') {
      if (!catalog.equipment.some(part => part.id === partId)) return;
      if (data.equipment.length + points.length > 128) { editor.setError('A design supports up to 128 equipment instances. Remove a fitting before adding more.'); return; }
      run('Place equipment', draft => { for (const point of points) draft.construction.equipment.push({ id: newConstructionId('equipment'), partId, position: point.map(v => snapCoordinate(v, .25)) as Vec3, bearingDeg: normalizedBearing(bearing) }); });
    } else {
      if (data.primitives.length + points.length > 512) { editor.setError('A design supports up to 512 hull pieces. Use a larger piece or remove a section before adding more.'); return; }
      const kind = SHAPES.find(entry => entry.id === shape)!.kind;
      run(points.length > 1 ? 'Brush hull pieces' : 'Place hull piece', draft => { for (const point of points) draft.construction.primitives.push({ id: newConstructionId('hull'), kind, size: [...size], position: point.map(v => snapCoordinate(v, 1)) as Vec3, rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90) }); });
    }
  };
  const placeRow = () => {
    const axis = { x: 0, y: 1, z: 2 }[rowAxis]!;
    const spacing = workbench === 'equipment' ? equipmentPart?.size[axis] ?? .25 : size[axis];
    place(Array.from({ length: count }, (_, index) => position.map((value, i) => value + (i === axis ? index * spacing : 0)) as Vec3));
  };
  const pick = (pick: BuilderPick) => {
    if (workbench === 'surfaces' && pick.surface) {
      if (!editor.currentResult) { setNotice('Face editing will resume when this source has a compiled preview.'); return; }
      if (!allSurfaceKeys.includes(pick.surface)) { setNotice('This fixed equipment support follows its fitting. Choose a hull face to edit armor or paint.'); return; }
      if (paintBrush) paintFaces(new Set([pick.surface]));
      else setSurfaces(current => { const next = pick.additive ? new Set(current) : new Set<string>(); if (next.has(pick.surface!)) next.delete(pick.surface!); else next.add(pick.surface!); return next; });
      if (pick.id) choose(pick.id, pick.additive); return;
    }
    if (tool === 'place' || tool === 'brush') { place([pick.position]); setPosition(pick.position); return; }
    if (tool === 'erase' && pick.id) { run('Remove piece', draft => removeConstructionSelection(draft, new Set([pick.id!]))); return; }
    if (pick.id) choose(pick.id, pick.additive); else if (!pick.additive) setSelected(new Set());
  };
  const applySurface = (values: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>, label: string) => run(label, draft => assignConstructionSurfaces(draft, surfaces, values));
  const paintFaces = (keys: ReadonlySet<string>) => run('Paint faces', draft => assignConstructionSurfaces(draft, keys, { paint }));
  const newDesign = async (blank: boolean) => {
    try { await editor.replace(freshConstruction(createStarterSource(props.catalog, blank ? 'blank' : starterKind), blank), null, false); setWorkbench('hull'); setFitRequest(value => value + 1); }
    catch (cause) { fail(cause); }
  };
  const saveCopy = async () => {
    const copy = structuredClone(source); copy.id = newConstructionId('design'); copy.revision = newConstructionId('revision'); copy.name = `${copy.name.slice(0, 150)} copy`;
    await editor.replace(copy, null, false, true); setNotice('A new local design now holds this draft.');
  };
  const close = async () => { setBusy('Saving'); try { await editor.flush(); props.onClose(); } catch (cause) { fail(cause); } finally { setBusy(''); } };
  const launch = async () => {
    const current = editor.currentResult;
    if (!current?.definition || current.diagnostics.some(item => item.severity === 'error')) return;
    setBusy('Launching trial');
    try { try { await editor.flush(); } catch { /* App receives the immutable source even if local storage is unavailable. */ } await props.onLaunch(structuredClone(source), structuredClone(current)); }
    catch (cause) { fail(cause); } finally { setBusy(''); }
  };
  const suggest = async (selectedPart = false) => {
    if (!requestSuggestion) return;
    const fittedKinds = new Set(data.equipment.map(instance => catalog.equipment.find(part => part.id === instance.partId)?.kind));
    const ids = selectedPart ? [partId] : catalog.equipment.filter(part => {
      if (part.placement !== 'internal' || fittedKinds.has(part.kind)) return false;
      fittedKinds.add(part.kind); return true;
    }).map(part => part.id).slice(0, 16);
    setBusy('Finding a layout'); setSuggestion(undefined); const revision = source.revision;
    const abort = new AbortController(); suggestionRequest.current?.abort(); suggestionRequest.current = abort;
    try {
      const proposed = await requestSuggestion(structuredClone(source), ids, abort.signal);
      if (abort.signal.aborted) return;
      if (proposed.source.id !== source.id || proposed.source.construction.catalogRevision !== data.catalogRevision) throw new Error('The layout belongs to a different design or equipment catalog. Request a new suggestion.');
      setSuggestion(proposed); setSuggestionRevision(revision);
    } catch (cause) { if (!abort.signal.aborted) fail(cause); }
    finally { if (suggestionRequest.current === abort) suggestionRequest.current = undefined; setBusy(''); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable=true]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editor.redo() : editor.undo(); }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
      else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); copy(); }
      else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set([...data.primitives, ...data.equipment].map(part => part.id))); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      else if (event.key.toLowerCase() === 'r') {
        if (tool === 'place' || tool === 'brush') setBearing(value => normalizedBearing(value + 90));
        else run('Rotate selection', draft => rotateConstructionSelection(draft, selected));
      }
      else if (event.key === 'Home') { event.preventDefault(); setFitRequest(value => value + 1); }
      else if (event.key === 'Escape') { setTool('select'); setSelected(new Set()); setSurfaces(new Set()); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  const metrics = result?.loading;
  const canLaunch = !!editor.currentResult?.definition && !editor.currentResult.diagnostics.some(item => item.severity === 'error') && !busy;
  const warningCount = editor.currentResult?.diagnostics.filter(item => item.severity === 'warning' && item.code !== 'auxiliary-services').length ?? 0;
  return <main className="shipbuilder" aria-label="Shipbuilder">
    <header className="shipbuilder-header"><div className="shipbuilder-title"><Icon name="anchor"/><h1>Shipbuilder</h1></div>
      <Input className="shipbuilder-name" aria-label="Design name" maxLength={160} value={source.name} onChange={event => run('Rename design', draft => { draft.name = event.target.value; })}/>
      <div className="shipbuilder-actions"><Button disabled={!editor.history.past.length} onClick={editor.undo} title="Undo (Ctrl/⌘ Z)">Undo</Button><Button disabled={!editor.history.future.length} onClick={editor.redo} title="Redo (Ctrl/⌘ Shift Z)">Redo</Button></div>
      <Button variant="primary" disabled={!canLaunch} onClick={() => void launch()}><Icon name="play" size={16}/>{busy || (editor.saveState.status === 'error' ? 'Trial unsaved draft' : 'Sea trial')}</Button>
      <Button variant="icon" aria-label="Save and return to port" disabled={!!busy} onClick={() => void close()}><Icon name="close"/></Button>
    </header>
    <div className={`shipbuilder-workspace ${toolsOpen ? 'tools-open' : ''} ${inspectOpen ? 'inspect-open' : ''}`}>
      <aside className="shipbuilder-tools" aria-label="Build tools">
        <nav className="shipbuilder-tabs" aria-label="Construction tools">{([['hull', 'Hull'], ['surfaces', 'Surfaces'], ['equipment', 'Equipment'], ['rooms', 'Rooms'], ['library', 'Library']] as const).map(([key, title]) => <Button key={key} aria-pressed={workbench === key} onClick={() => { setWorkbench(key); setTool('select'); if (key === 'surfaces') setDisplay('armor'); else if (key === 'rooms') setDisplay('internals'); }}>{title}</Button>)}</nav>
        <div className="shipbuilder-scroll"><fieldset disabled={!editor.ready || !!busy}>
          {workbench === 'hull' && <><h2>Build the envelope</h2><p className="shipbuilder-help">Joined pieces form one hollow hull. Start with a patrol hull or place your first piece on the 1 m grid.</p>
            <label>Starter design<Select value={starterKind} onValueChange={value => setStarterKind(value as ConstructionStarter)}><SelectOption value="patrol">Patrol hull</SelectOption><SelectOption value="catamaran">Connected catamaran</SelectOption></Select></label><div className="shipbuilder-actions"><Button onClick={() => void newDesign(false)}>Starter hull</Button><Button onClick={() => void newDesign(true)}>Blank</Button></div>
            <label>Shape<Select value={shape} onValueChange={value => { setShape(value); setSize([...SHAPES.find(entry => entry.id === value)!.size]); }}>{SHAPES.map(entry => <SelectOption key={entry.id} value={entry.id}>{entry.name}</SelectOption>)}</Select></label>
            <div className="shipbuilder-vector">{size.map((value, axis) => <NumberField key={axis} label={['Width', 'Height', 'Length'][axis]} value={value} min={1} max={500} step={1} onChange={value => setSize(size.map((n, i) => i === axis ? snapCoordinate(value, 1) : n) as Vec3)}/>)}</div>
          </>}
          {workbench === 'equipment' && <><h2>Fit equipment</h2><p className="shipbuilder-help">Fixed variants use their original dimensions. Place on a supporting deck, inside the hull, or underwater as shown.</p>
            <Input type="search" aria-label="Find equipment" placeholder="Find a gun, engine or fitting" value={partQuery} onChange={event => setPartQuery(event.target.value)}/>
            <div className="shipbuilder-list shipbuilder-catalog">{catalog.equipment.filter(part => `${part.name} ${part.kind}`.toLowerCase().includes(partQuery.toLowerCase())).map(part => <Button key={part.id} aria-pressed={partId === part.id} onClick={() => { setPartId(part.id); setTool('place'); }}><span>{part.name}<small>{part.kind} · {part.placement} · {part.size.map(value => format(value, 2)).join(' × ')} m</small></span></Button>)}</div>
            {!catalog.equipment.length && <p>No equipment is available in this catalog.</p>}
            <div className="shipbuilder-actions"><Button disabled={!requestSuggestion || !!busy || editor.compiling} onClick={() => void suggest()}>Suggest internals</Button><Button disabled={!requestSuggestion || !!busy || editor.compiling || !catalog.equipment.some(part => part.id === partId)} onClick={() => void suggest(true)}>Suggest selected fitting</Button></div>
            <p className="shipbuilder-help">Suggestions add missing equipment and keep your fitted pieces in place. Review the proposal before applying it.</p>
            {!requestSuggestion && <p className="shipbuilder-help">Layout suggestions are unavailable in this compiler. Manual placement remains available.</p>}
            {suggestion && <div className="shipbuilder-suggestion" role="status">
              {suggestion.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`} className={diagnostic.severity === 'error' ? 'shipbuilder-error' : undefined}>{diagnostic.message}</p>)}
              {!suggestion.diagnostics.some(diagnostic => diagnostic.severity === 'error') && <><p>{suggestionChanged ? 'A layout is ready. Applying it is one undoable edit.' : 'The requested equipment is already fitted. No source changes are needed.'}</p>{suggestionChanged && <Button disabled={source.revision !== suggestionRevision} onClick={() => { run('Apply suggested internals', draft => { draft.construction.equipment = structuredClone(suggestion.source.construction.equipment); draft.construction.boundaries = structuredClone(suggestion.source.construction.boundaries); draft.construction.loads = structuredClone(suggestion.source.construction.loads); }); setSuggestion(undefined); }}>Apply suggestion</Button>}</>}
              <Button onClick={() => setSuggestion(undefined)}>Dismiss</Button>{source.revision !== suggestionRevision && <p>The source changed. Request a new suggestion.</p>}
            </div>}
          </>}
          {(workbench === 'hull' || workbench === 'equipment') && <>
            <h3>Placement</h3><div className="shipbuilder-tool-grid">{(['select', 'place', 'brush', 'erase'] as const).map(value => <Button key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>{value === 'erase' ? 'Remove' : value[0].toUpperCase() + value.slice(1)}</Button>)}</div>
            <div className="shipbuilder-vector">{position.map((value, axis) => <NumberField key={axis} label={axisNames[axis]} value={value} step={gridStep} onChange={value => setPosition(position.map((n, i) => i === axis ? snapCoordinate(value, gridStep) : n) as Vec3)}/>)}</div>
            <NumberField label="Rotation" value={bearing} min={0} max={360} step={workbench === 'hull' ? 90 : 15} unit="°" onChange={value => setBearing(workbench === 'hull' ? normalizedBearing(Math.round(value / 90) * 90) : normalizedBearing(value))}/>
            <div className="shipbuilder-row"><NumberField label="Repeat" value={count} min={1} max={128} unit="pieces" onChange={value => setCount(Math.round(value))}/><label>Direction<Select value={rowAxis} onValueChange={setRowAxis}><SelectOption value="z">Along length</SelectOption><SelectOption value="x">Across width</SelectOption><SelectOption value="y">Upward</SelectOption></Select></label></div>
            <Button variant="primary" onClick={placeRow}>Place {count > 1 ? `${count} pieces` : 'at coordinates'}</Button><p className="shipbuilder-help">The translucent piece shows where a click will place it. Drag to orbit, right-drag to pan; scroll zooms. Brush drags place one undoable stroke. R rotates the next piece. Placement height sets the grid plane.</p>
          </>}
          {workbench === 'surfaces' && <><h2>Armor & paint</h2><p className="shipbuilder-help">Click a face, then Shift-click to add faces. Assignments follow the source face across every mesh patch.</p>
            <div className="shipbuilder-actions"><Button disabled={!allSurfaceKeys.length} onClick={() => setSurfaces(new Set(allSurfaceKeys))}>All exposed faces</Button><Button onClick={() => setSurfaces(new Set())}>Clear</Button></div>
            <label>Face area<Select value="choose" onValueChange={face => setSurfaces(new Set(editableSurfaces.filter(surface => surface.face === face && (!selected.size || selected.has(surface.primitiveId))).map(surface => surfaceKey(surface.primitiveId, surface.face))))}><SelectOption value="choose">Select a face area…</SelectOption>{CONSTRUCTION_FACES.map(face => <SelectOption key={face} value={face}>{face}</SelectOption>)}</Select></label>
            <p className="shipbuilder-selection-count">{surfaces.size} source faces selected</p>
            <details><summary>Inspect selected faces</summary><ArmorInspection label="Selected face armor" surfaces={(editor.currentResult?.surfaces ?? []).filter(surface => surfaces.has(surfaceKey(surface.primitiveId, surface.face)))}/></details>
            <label>Armor preset<Select aria-label="Armor preset" value={ARMOR_PRESETS.find(preset => preset.thicknessMm === armor && preset.material === material)?.id ?? 'custom'} onValueChange={value => { const preset = ARMOR_PRESETS.find(preset => preset.id === value); if (preset) { setArmor(preset.thicknessMm); setMaterial(preset.material); } }}><SelectOption value="custom">Custom thickness</SelectOption>{ARMOR_PRESETS.map(preset => <SelectOption key={preset.id} value={preset.id}>{preset.name}</SelectOption>)}</Select></label>
            <NumberField label="Thickness" unit="mm" value={armor} min={0} max={1000} step={1} onChange={setArmor}/>
            <label>Material<Select value={material} onValueChange={value => setMaterial(value as typeof material)}><SelectOption value="steel">Structural steel</SelectOption><SelectOption value="armor-steel">Armor steel</SelectOption></Select></label>
            <label>Naval paint<Select value={paint} onValueChange={setPaint}>{CONSTRUCTION_PAINTS.map(paint => <SelectOption key={paint.id} value={paint.id}>{paint.name}</SelectOption>)}</Select></label>
            <div className="shipbuilder-swatches">{CONSTRUCTION_PAINTS.map(entry => <Button key={entry.id} aria-label={entry.name} title={entry.name} aria-pressed={paint === entry.id} style={{ backgroundColor: entry.color }} onClick={() => setPaint(entry.id)}/>)}</div>
            <Button variant="primary" disabled={!surfaces.size} onClick={() => applySurface({ thicknessMm: armor, material, paint }, 'Apply armor and paint')}>Apply to selected faces</Button>
            <Button disabled={!surfaces.size} onClick={() => paintFaces(surfaces)}>Paint selected faces</Button>
            <label className="shipbuilder-check"><Input type="checkbox" checked={paintBrush} onChange={event => setPaintBrush(event.target.checked)}/>Paint clicked faces</label>
            <p className="shipbuilder-help">Painting preserves armor, material and openings. Presets set the next armor assignment; apply it to the selected faces.</p>
            <div className="shipbuilder-actions"><Button disabled={!surfaces.size} onClick={() => applySurface({ open: true }, 'Open selected faces')}>Open to sea</Button><Button disabled={!surfaces.size} onClick={() => applySurface({ open: false }, 'Close selected faces')}>Close skin</Button></div>
            <p className="shipbuilder-help">Thickness grows inward; mint lines show its depth. Zero armor retains structural skin. Openings remove the skin and admit water when submerged.</p>
            <h3>Sandbox schemes</h3><div className="shipbuilder-actions"><Button onClick={() => run('Apply two-tone paint', draft => { for (const face of CONSTRUCTION_FACES) assignConstructionSurfaces(draft, new Set(allSurfaceKeys.filter(key => key.endsWith(`:${face}`))), { paint: face === 'top' ? 'deck-gray' : 'naval-gray' }); })}>Two tone</Button><Button onClick={() => run('Apply disruptive paint', draft => { for (const primitive of draft.construction.primitives) assignConstructionSurfaces(draft, new Set(allSurfaceKeys.filter(key => key.startsWith(`${primitive.id}:`))), { paint: Math.abs(Math.floor(primitive.position[2] / 12)) % 2 ? 'sea-blue' : 'light-gray' }); })}>Disruptive</Button></div>
          </>}
          {workbench === 'rooms' && <><h2>Decks & bulkheads</h2><p className="shipbuilder-help">A boundary splits the enclosed hull into rooms. Remove a boundary to merge the adjacent spaces; use Surfaces to create openings to sea.</p>
            <label>Boundary<Select value={boundaryAxis} onValueChange={value => setBoundaryAxis(value as typeof boundaryAxis)}><SelectOption value="y">Horizontal deck</SelectOption><SelectOption value="z">Transverse bulkhead</SelectOption><SelectOption value="x">Longitudinal bulkhead</SelectOption></Select></label>
            <NumberField label="Position" value={boundaryOffset} onChange={value => setBoundaryOffset(snapCoordinate(value, 1))}/><NumberField label="Thickness" value={boundaryThickness} unit="mm" min={.1} max={1000} onChange={setBoundaryThickness}/>
            <Button variant="primary" disabled={data.boundaries.length >= 24} onClick={() => run('Add internal boundary', draft => { draft.construction.boundaries.push({ id: newConstructionId('boundary'), axis: boundaryAxis, offset: boundaryOffset, thicknessMm: boundaryThickness }); })}>Split with {boundaryAxis === 'y' ? 'deck' : 'bulkhead'}</Button>
            <div className="shipbuilder-list">{data.boundaries.map(wall => <Button key={wall.id} aria-pressed={selected.has(wall.id)} onClick={() => choose(wall.id)}><span>{wall.axis === 'y' ? 'Deck' : 'Bulkhead'} · {wall.axis.toUpperCase()} {format(wall.offset)} m<small>{format(wall.thicknessMm)} mm · {wall.id.slice(-8)}</small></span></Button>)}</div>
            <h3>Compiled rooms</h3>{result?.definition?.compartments.map(room => <p key={room.id}>{room.name}<small className="shipbuilder-help">{room.size.map(value => format(value)).join(' × ')} m</small></p>)}
          </>}
          {workbench === 'library' && <><BuilderLibrary store={editor.store} catalogRevision={props.catalog.revision} refresh={editor.saveState.revision?.id} onOpen={(source, revision) => editor.replace(source, revision, true)} onRecover={source => editor.replace(source, null, false)}/><h3>Current source</h3><Button onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download source backup</Button><Button onClick={() => void saveCopy()}>Save draft as a new design</Button></>}
        </fieldset></div>
      </aside>
      <section className="shipbuilder-scene" aria-label="Design view"><div className="shipbuilder-viewbar"><Button className="shipbuilder-mobile-toggle" aria-expanded={toolsOpen} onClick={() => { setToolsOpen(value => !value); setInspectOpen(false); }}>Tools</Button>
        <div className="shipbuilder-actions" aria-label="View direction">{(['orbit', 'top', 'side', 'bow'] as const).map(value => <Button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}</div><Button onClick={() => setFitRequest(value => value + 1)} title="Fit ship (Home)">Fit</Button>
        <Button className="shipbuilder-inspect-toggle" aria-expanded={inspectOpen} onClick={() => { setInspectOpen(value => !value); setToolsOpen(false); }}>Inspect</Button></div>
        <BuilderViewport source={source} result={result} catalog={catalog} selected={selected} selectedSurfaces={surfaces} view={view} display={display} slice={slice} planePosition={position} gridStep={gridStep} placement={tool === 'place' || tool === 'brush'} placementPiece={placementPiece} brush={tool === 'brush'} fitRequest={fitRequest} onPick={pick} onStroke={place} createModel={props.createModel ?? createConstructionModel}/>
        <div className="shipbuilder-scene-labels"><span>Bow −Z · Starboard +X · Up +Y</span><span><i className="shipbuilder-cg"/>Center of gravity <i className="shipbuilder-buoyancy"/>Buoyancy</span></div>
        {!data.primitives.length && <div className="shipbuilder-empty"><h2>Your ship starts here</h2><p>Place a hull piece on the grid, or start with a fitted patrol hull.</p><Button variant="primary" onClick={() => void newDesign(false)}>Use starter hull</Button></div>}
        <div className="shipbuilder-scene-controls"><Select aria-label="Model display" value={display} onValueChange={value => setDisplay(value as BuilderDisplay)}><SelectOption value="paint">Painted steel</SelectOption><SelectOption value="armor">Armor thickness</SelectOption><SelectOption value="internals">Internals</SelectOption></Select><label className="shipbuilder-check"><Input type="checkbox" checked={slice !== undefined} onChange={event => setSlice(event.target.checked ? position[1] : undefined)}/>Deck slice</label>{slice !== undefined && <NumberField label="Cut height" value={slice} step={.25} onChange={setSlice}/>}</div>
      </section>
      <aside className="shipbuilder-inspector" aria-label="Selection and diagnostics"><div className="shipbuilder-scroll">
        <h2>{selected.size ? `${selected.size} selected` : 'Ship condition'}</h2>
        {selected.size > 0 && <><div className="shipbuilder-actions"><Button disabled={!selectedItem} onClick={() => copy()}>Copy</Button><Button disabled={!selectedItem} onClick={() => copy(true)}>Mirror</Button><Button onClick={remove}>Remove</Button></div>{selectedItem && <Button onClick={() => run('Rotate selection', draft => rotateConstructionSelection(draft, selected))}>Rotate 90°</Button>}</>}
        {selectedItem && <><h3>{selectedPrimitive ? 'Hull piece' : equipmentPart?.name ?? selectedEquipment?.partId}</h3><small className="shipbuilder-help">{selectedItem.id}</small><div className="shipbuilder-vector">{selectedItem.position.map((value, axis) => <NumberField key={axis} label={axisNames[axis]} value={value} step={selectedPrimitive ? 1 : .25} onChange={next => { const delta: Vec3 = [0, 0, 0]; delta[axis] = snapCoordinate(next, selectedPrimitive ? 1 : .25) - value; run('Move selection', draft => moveConstructionSelection(draft, selected, delta)); }}/>)}</div>
          {selectedPrimitive && <div className="shipbuilder-vector">{selectedPrimitive.size.map((value, axis) => <NumberField key={axis} label={['Width', 'Height', 'Length'][axis]} min={1} max={500} value={value} onChange={value => run('Resize hull piece', draft => { draft.construction.primitives.find(part => part.id === selectedPrimitive.id)!.size[axis] = snapCoordinate(value, 1); })}/>)}</div>}
          <NumberField label="Bearing" unit="°" value={selectedPrimitive?.rotationDeg ?? selectedEquipment!.bearingDeg} min={0} max={360} step={selectedPrimitive ? 90 : 15} onChange={value => run('Set bearing', draft => { if (selectedPrimitive) draft.construction.primitives.find(part => part.id === selectedPrimitive.id)!.rotationDeg = normalizedBearing(Math.round(value / 90) * 90); else draft.construction.equipment.find(part => part.id === selectedEquipment!.id)!.bearingDeg = normalizedBearing(value); })}/>
          {selectedEquipment && <>{(['magazineId', 'powerSourceId'] as const).map(link => <label key={link}>{link === 'magazineId' ? 'Magazine' : 'Power source'}<Select value={selectedEquipment[link] ?? ''} onValueChange={value => run('Connect equipment', draft => { const item = draft.construction.equipment.find(part => part.id === selectedEquipment.id)!; if (value) item[link] = value; else delete item[link]; })}><SelectOption value="">Automatic / unassigned</SelectOption>{data.equipment.filter(part => catalog.equipment.find(entry => entry.id === part.partId)?.kind === (link === 'magazineId' ? 'magazine' : 'engine')).map(part => <SelectOption key={part.id} value={part.id}>{catalog.equipment.find(entry => entry.id === part.partId)?.name} · {part.id.slice(-6)}</SelectOption>)}</Select></label>)}</>}
        </>}
        {selectedBoundary && <><NumberField label="Boundary position" value={selectedBoundary.offset} onChange={value => run('Move boundary', draft => { draft.construction.boundaries.find(wall => wall.id === selectedBoundary.id)!.offset = snapCoordinate(value, 1); })}/><NumberField label="Boundary thickness" value={selectedBoundary.thicknessMm} min={.1} max={1000} unit="mm" onChange={value => run('Armor boundary', draft => { draft.construction.boundaries.find(wall => wall.id === selectedBoundary.id)!.thicknessMm = value; })}/><Button onClick={remove}>Merge rooms across boundary</Button></>}
        <h3>Design diagnostics</h3><div className="shipbuilder-compile" role="status">{editor.compiling ? 'Compiling this revision…' : editor.currentResult?.definition ? warningCount ? `Launchable · ${warningCount} warnings` : 'Ready for sea trial' : 'Draft needs attention'}</div>
        {editor.compileError && <><p role="alert" className="shipbuilder-error">{editor.compileError}</p><Button onClick={editor.retryCompile}>Retry compilation</Button></>}
        <div className="shipbuilder-diagnostics">{editor.currentResult?.diagnostics.map((diagnostic, index) => <div key={`${diagnostic.code}-${index}`} className={`shipbuilder-diagnostic ${diagnostic.severity}`}><strong>{diagnostic.severity === 'error' ? 'Fix before launch' : diagnostic.code === 'auxiliary-services' ? 'Design note' : 'Trial warning'}</strong><p>{diagnostic.message}</p>{diagnostic.sourceId && <Button onClick={() => { choose(diagnostic.sourceId!); setDisplay('internals'); }}>Inspect affected part</Button>}</div>)}</div>
        <dl className="shipbuilder-readings"><div><dt>Loaded mass</dt><dd>{format(metrics && metrics.massKg / 1000)} t</dd></div><div><dt>Predicted waterline</dt><dd>{format(metrics?.waterlineY, 2)} m</dd></div><div><dt>Roll stability (GM)</dt><dd>{format(metrics?.rollMetacentricHeightM, 2)} m</dd></div><div><dt>Power</dt><dd>{format(metrics?.powerKw, 0)} kW</dd></div><div><dt>Estimated speed</dt><dd>{format(metrics && metrics.estimatedSpeedMps * 1.943844)} kn</dd></div><div><dt>Usable interior</dt><dd>{format(metrics?.usableVolumeM3)} m³</dd></div><div><dt>CG · X / Y / Z</dt><dd>{metrics?.centerOfGravity.map(value => format(value, 2)).join(' / ') ?? '—'}</dd></div></dl>
        {metrics && <details><summary>Mass breakdown</summary><div className="shipbuilder-mass">{metrics.contributions.slice().sort((a, b) => b.massKg - a.massKg).map(item => <div key={item.id}><span>{item.kind}<small>{item.id}</small></span><b>{format(item.massKg / 1000, 2)} t</b></div>)}</div><p className="shipbuilder-help">{metrics.basis}</p></details>}
        <details><summary>Hull armor coverage</summary><ArmorInspection label="Hull armor coverage" surfaces={editableSurfaces}/></details>
        {result?.definition?.mounts.length ? <details><summary>Gun firing arcs</summary>{result.definition.mounts.map(mount => <p key={mount.id}>{mount.name}<small className="shipbuilder-help">Bearing {format(mount.bearingDeg)}° · traverse ±{format(mount.traverseDeg ?? mount.weapon.traverseDeg)}° · elevation {format(mount.weapon.elevationMinDeg)}° to {format(mount.weapon.elevationMaxDeg)}°</small></p>)}</details> : null}
        <details><summary>All fitted pieces · {data.primitives.length + data.equipment.length}</summary><div className="shipbuilder-list">{[...data.primitives.map(part => ({ id: part.id, name: `${part.kind} · ${part.size.join(' × ')} m` })), ...data.equipment.map(part => ({ id: part.id, name: catalog.equipment.find(entry => entry.id === part.partId)?.name ?? part.partId }))].map(item => <Button key={item.id} aria-pressed={selected.has(item.id)} onClick={event => choose(item.id, event.shiftKey)}>{item.name}</Button>)}</div></details>
      </div></aside>
    </div>
    {(editor.error || notice) && <div className={`shipbuilder-notice ${editor.error ? 'error' : ''}`} role={editor.error ? 'alert' : 'status'}><p>{editor.error || notice}</p>{editor.error && <div className="shipbuilder-actions"><Button onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download source</Button><Button onClick={() => void editor.retrySave()?.catch(fail)}>Retry save</Button><Button onClick={() => void saveCopy().catch(fail)}>Save a copy</Button></div>}<Button variant="icon" aria-label="Dismiss message" onClick={() => { editor.setError(''); setNotice(''); }}><Icon name="close" size={16}/></Button></div>}
    <footer className="shipbuilder-footer"><span className={editor.saveState.status === 'saved' ? 'saved' : ''} role="status">{editor.saveState.status === 'saved' ? 'Saved locally' : editor.saveState.status === 'error' ? 'Not saved — keep a source backup' : 'Saving source…'}</span><span>{data.primitives.length}/512 hull pieces · {gridStep} m grid</span><span>{editor.history.lastAction}</span><span>Shift-click selects more · R rotates · Delete removes</span></footer>
  </main>;
}
