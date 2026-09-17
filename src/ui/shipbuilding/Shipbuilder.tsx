import { integrateConstructionMagazines } from '../../ships/constructionArmament';
import { FreeformToolbar } from './FreeformToolbar';
import CustomHullEditor from './CustomHullEditor';
import { createPortal } from 'react-dom';
import { customHullPrimitive, editableCustomHull } from '../../ships/customHullModel';
import { NewDesignDialog } from './NewDesignDialog';
import { canEditVertices } from '../../ships/constructionVertex';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, Vec3 } from '../../ships/blueprint';
import { newConstructionId, surfaceSelectionKey } from '../../ships/constructionEditor';
import { removeLocalShip } from '../../ships/localShips';
import { ConstructionClient } from '../../ships/constructionClient';
import { CONSTRUCTION_SHAPE_NAMES as SHAPE_NAMES } from '../../ships/constructionShapes';
import { createStarterSource, startingHullBlock, type ConstructionStarter } from '../../ships/constructionStarter';
import { constructionCatalogUpdate, updateConstructionCatalog } from '../../ships/constructionEquipment';
import { constructionDiffCommands, type ConstructionBatch } from '../../ships/constructionCommands';
import { armorThicknessColor } from '../../ships/inspection';
import { BuilderViewport, type BuilderTag, type ConstructionModelFactory } from './BuilderViewport';
import { BUILDER_LAYERS, FAMILY_NAMES, formatTonnes, type BuilderLayer, type SlotItem } from './builderLayers';
import { BOUNDARY_NAMES } from './builderTool';
import { equipmentMassKg, format, hullBounds, ledgerRows, massGroups, pieceMassKg, surfaceCentroid, warningEntries } from './builderReadings';
import { SlotGlyph, ToolGlyph } from './builderGlyphs';
import { DesignsMenu, downloadConstructionSource } from './DesignsMenu';
import { HelpDialog } from './HelpDialog';
import { ViewBar } from './ViewBar';
import { pathSlackLimit, equipmentPathBounds } from '../../ships/constructionPaths';
import { PathPointEditor } from './PathPointEditor';
import { NumberField } from './NumberField';
import { SlotImages, useSlotImages } from './slotImages';
import { armorInspectionGroups, describeArmorGroup } from './ArmorInspection';
import { attachmentOffset, rotateY, bearingRadians } from './placement';
import type { BuilderView } from './builderScene';
import { snapCoordinate, normalizedBearing } from './editorNumbers';
import { freshConstruction, useBuilderSource, type BuilderCompiler } from './useBuilderSource';
import type { ConstructionStore } from '../../ships/constructionStore';
import { openConstructionStore } from '../../ships/constructionStore';
import './Shipbuilder.css';

export interface ConstructionEditorHandle {
  source(): ConstructionSource;
  result(): ConstructionResult | undefined;
  apply(batch: ConstructionBatch): ConstructionSource;
  flush(): Promise<void>;
  launch(): Promise<void>;
  undo(): void;
  redo(): void;
}


export interface ShipbuilderProps {
  catalog: ConstructionCatalog;
  starterSource?: ConstructionSource;
  compileClient?: BuilderCompiler;
  initialSource?: ConstructionSource;
  initialDesignId?: string;
  repositoryId?: string;
  openStore?(): Promise<ConstructionStore>;
  onEditorReady?(editor: ConstructionEditorHandle | undefined): void;
  onClose(source: ConstructionSource, result?: ConstructionResult): void | Promise<void>;
  onLaunch(source: ConstructionSource, result: ConstructionResult): void | Promise<void>;
  onSave?(source: ConstructionSource): void;
  onDelete?(designId: string): void;
  createModel?: ConstructionModelFactory;
  suggestLayout?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
}

/** Glyphs the layer tabs show once the dock is too narrow for their names. */
const LAYER_GLYPHS: Record<BuilderLayer, string> = { hull: 'Hull', armor: 'Armor', internals: 'Split', fittings: 'Fitting', paint: 'Paint' };
const VIEW_NAMES: Record<BuilderView, string> = { orbit: 'Orbit', top: 'Plan', side: 'Profile', bow: 'Bow' };
interface KeyHint { keys: string[]; label: string }
const metres = (value: number) => Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** The card's corner label: whole metres stay bare, quarter and half plates read as fractions. */
const dimensions = (size: Vec3) => size.map(value => value === .25 ? '¼' : value === .5 ? '½' : value === .75 ? '¾' : metres(value)).join('×');
const signed = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${metres(Math.abs(value))}`;

/** The shipbuilder's markup. Layer, tool, selection and gestures live in `BuilderTool`; history,
 * autosave and the edit door in `ConstructionRevisionOwner`; the compile in `CompiledRevision`.
 * What remains here is chrome (drawer, menus, tips, dialogs) and the async flows over those modules. */
export function Shipbuilder(props: ShipbuilderProps) {
  const [compiler] = useState<BuilderCompiler>(() => props.compileClient ?? new ConstructionClient());
  const [starterSource] = useState(() => props.starterSource ?? createStarterSource(props.catalog, 'blank'));
  const suggestLayout = props.suggestLayout ?? (compiler.suggest ? (source: ConstructionSource, ids: string[], signal?: AbortSignal) => compiler.suggest!(source, ids, signal) : undefined);
  const editor = useBuilderSource({ ...props, starterSource, compiler, suggest: suggestLayout });
  const { owner, revision, compiled, compile, tool, toolState: s, source, catalog, activeCatalog, latestCatalog, setActiveCatalog } = editor, data = source.construction;
  const { layer, tool: activeTool, selected, surfaces, measure, pathPoints, customMm, mirror, showArcs, showCenters, freeformSettings, perspective, view, slice, notice, suggestion } = s;
  const compiledResult = compile.current;
  const convertedDesigns = useRef(new Set<string>());
  useEffect(() => {
    if (!revision.ready || owner.locked || !catalog.equipment.length || data.version !== 1 || convertedDesigns.current.has(source.id)) return;
    const next = structuredClone(source);
    integrateConstructionMagazines(next, catalog);
    const outcome = tool.run('Build ammunition into weapons', constructionDiffCommands(source, next));
    if (outcome.accepted) convertedDesigns.current.add(source.id);
  }, [revision.ready, owner.locked, source, catalog, tool]);

  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  // The open drawer keeps the size of its full, unfiltered card set while a search narrows it, so the panel does not jump about under the pointer; the search clears when the drawer closes.
  const drawerRef = useRef<HTMLDivElement>(null);
  // The card row fades at whichever edge hides more cards.
  const hotbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = hotbarRef.current; if (!row) return;
    const update = () => { const end = row.scrollWidth - row.clientWidth - row.scrollLeft > 1, start = row.scrollLeft > 1; row.dataset.overflow = end && start ? 'both' : end ? 'end' : start ? 'start' : ''; };
    update(); const observer = new ResizeObserver(update); observer.observe(row); row.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); row.removeEventListener('scroll', update); };
  }, [layer]);
  const [drawerSize, setDrawerSize] = useState<{ width: number; height: number }>();
  useLayoutEffect(() => {
    if (!drawer) { setDrawerSize(undefined); setQuery(''); return; }
    const measure = () => { setDrawerSize(undefined); requestAnimationFrame(() => { const box = drawerRef.current; if (box) setDrawerSize({ width: box.offsetWidth, height: box.offsetHeight }); }); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [drawer, layer]);
  const [hoveredPart, setHoveredPart] = useState<string>();
  const [warningsOpen, setWarningsOpen] = useState(true);
  const [designsOpen, setDesignsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [customHullSession, setCustomHullSession] = useState<{ designId: string; primitive: ConstructionPrimitive }>();
  const [newDesignOpen, setNewDesignOpen] = useState(false);
  const [tip, setTip] = useState<{ title: string; detail: string; x: number; y: number; key?: string; below?: boolean; right?: number }>();
  const [slotImages] = useState(() => new SlotImages());
  useEffect(() => () => slotImages.dispose(), [slotImages]);

  const palette = tool.palette;
  const imageFor = useSlotImages(slotImages, palette.drawer, catalog);
  const active = tool.active;
  const drawerName = tool.drawerName, hasDrawer = tool.hasDrawer;
  const pathPart = tool.pathPart;
  const rail = tool.rail;
  const locked = owner.locked, busy = revision.busy;
  const selectedPrimitives = tool.selectedPrimitives, selectedEquipment = tool.selectedEquipment;
  const freeformPrimitive = tool.freeformPrimitive, freeformMode = !!freeformPrimitive;
  const selectedBoundary = tool.selectedBoundary;
  const partOf = tool.partOf;
  const editableSurfaces = tool.editableSurfaces;
  const gridStep = tool.gridStep, piece = tool.piece;
  const fail = (cause: unknown) => owner.setError(cause instanceof Error ? cause.message : String(cause));
  const run = tool.run;
  const switchLayer = (next: BuilderLayer) => { tool.switchLayer(next); setDrawer(false); setQuery(''); setTip(undefined); };
  const selectSlot = (item: SlotItem) => { if (tool.selectSlot(item)) { setDrawer(false); setTip(undefined); } };
  const enterFreeform = () => { if (tool.enterFreeform()) setDrawer(false); };
  const suggestionChanged = tool.suggestionChanged;

  const newDesign = async (kind: ConstructionStarter) => {
    setDesignsOpen(false);
    await owner.replace(freshConstruction(createStarterSource(props.catalog, kind), kind === 'blank'), null, false);
    switchLayer('hull'); tool.setTool('select'); tool.selectOnly(['hull']); tool.fit(); setNewDesignOpen(false);
  };
  const deleteDesign = async (designId: string, revisionId: string) => {
    const current = designId === source.id;
    owner.setBusy('Deleting');
    try {
      await owner.removeDesign(designId, revisionId, createStarterSource(props.catalog, 'blank'));
      props.onDelete?.(designId); removeLocalShip(designId);
      if (current) { switchLayer('hull'); tool.fit(); setDesignsOpen(false); }
      tool.notify('Design deleted.');
    } finally { owner.setBusy(''); }
  };
  const partsUpdate = activeCatalog.revision === data.catalogRevision && latestCatalog.revision !== data.catalogRevision ? {
    ...constructionCatalogUpdate(source, activeCatalog, latestCatalog),
    onApply: () => {
      try {
        const next = structuredClone(source); updateConstructionCatalog(next, activeCatalog, latestCatalog);
        run('Update parts library', constructionDiffCommands(source, next)); setActiveCatalog(latestCatalog); setDesignsOpen(false); tool.clearPath(); tool.notify('Parts library updated. Undo restores the previous library.');
      } catch (cause) { fail(cause); }
    },
  } : undefined;
  const saveCopy = async () => {
    setDesignsOpen(false);
    const copy = structuredClone(source); copy.id = newConstructionId('design'); copy.revision = newConstructionId('revision'); copy.name = `${copy.name.slice(0, 150)} copy`;
    try { await owner.replace(copy, null, false, true); tool.notify('A new design now holds this draft.'); } catch (cause) { fail(cause); }
  };
  const saveLocalCopy = async () => {
    let storage: ConstructionStore | undefined;
    try { storage = await openConstructionStore(); const copy = freshConstruction(source); await storage.save({ designId: copy.id, name: copy.name, source: copy, schemaVersion: 1, catalogRevision: copy.construction.catalogRevision, expectedRevisionId: null }); tool.notify('A saved copy is available in the port Ship designs list.'); setDesignsOpen(false); } catch (cause) { fail(cause); } finally { storage?.close(); }
  };
  const close = async () => { owner.setBusy('Saving'); try { await owner.flush(); await props.onClose(structuredClone(source), compiledResult); } catch (cause) { fail(cause); } finally { owner.setBusy(''); } };
  const launch = async () => {
    const source = structuredClone(owner.source), compiled = editor.compiled.read();
    if (!compiled?.definition || compiled.diagnostics.some(item => item.severity === 'error')) return;
    owner.setBusy('Launching');
    try { try { await owner.flush(); } catch { /* App receives the immutable source even if local storage is unavailable. */ } await props.onLaunch(structuredClone(source), structuredClone(compiled)); }
    catch (cause) { fail(cause); } finally { owner.setBusy(''); }
  };
  useEffect(() => {
    if (!revision.ready) return;
    props.onEditorReady?.({ source: () => structuredClone(owner.source), result: compiled.read, apply: owner.applyBatch, flush: owner.flush, launch, undo: owner.undo, redo: owner.redo });
    return () => props.onEditorReady?.(undefined);
  }, [source, compiledResult, revision.ready, revision.saveState]);

  // The latest render's closure handles keys, so a key right after a click sees the click's selection.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
      if (customHullSession || newDesignOpen) return;
      if ((event.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable=true]')) return;
      if (helpOpen) { if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); setHelpOpen(false); } return; }
      if (event.key === '?') { event.preventDefault(); setHelpOpen(true); return; }
      if (locked) return;
      tool.key(event, {
        dismiss: () => { if (drawer) setDrawer(false); else if (designsOpen) setDesignsOpen(false); else return false; return true; },
        toggleDrawer: () => { setDrawer(value => !value); setTip(undefined); },
        toggleWarnings: () => setWarningsOpen(value => !value),
        slotChosen: () => { setDrawer(false); setTip(undefined); },
      });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  // ---- derived display
  const warnings = warningEntries(compiledResult?.diagnostics);
  const blocks = warnings.filter(entry => entry.tone === 'block'), warns = warnings.filter(entry => entry.tone === 'warn');
  const rows = useMemo(() => ledgerRows(source, compiledResult, layer), [source, compiledResult, layer]);
  const masses = useMemo(() => massGroups(compiledResult), [compiledResult]);
  const totalMass = masses.reduce((sum, group) => sum + group.massKg, 0);
  const canLaunch = !pathPoints.length && !!compiledResult?.definition && !blocks.length && !busy && revision.ready;
  const launchTitle = busy ? busy : compile.compiling ? 'Compiling this revision…' : blocks.length ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} to fix before a trial` : compiledResult?.definition ? 'Launch a sea trial with this design' : 'Waiting for a compiled design';
  const saveTone = revision.saveState.status === 'saved' ? 'ok' : revision.saveState.status === 'error' ? 'bad' : 'saving';
  const saveText = revision.saveState.status === 'saved' ? (props.repositoryId ? 'Saved to repository' : 'Saved to account') : revision.saveState.status === 'error' ? 'Not saved · keep a backup' : 'Saving…';
  const drawerItems = query ? palette.drawer.filter(item => `${item.name} ${item.note} ${item.kind === 'part' ? `${item.part.name} ${FAMILY_NAMES[item.part.kind]} ${item.part.placement}` : ''}`.toLowerCase().includes(query.toLowerCase())) : palette.drawer;

  const tags: BuilderTag[] = [];
  const equipmentAnchor = (item: ConstructionEquipment): Vec3 => { const part = partOf(item), center = part ? rotateY(equipmentPathBounds(part, item).center, bearingRadians(item.bearingDeg)) : [0, 0, 0]; return item.position.map((value, index) => value + center[index]) as Vec3; };
  // The cursor piece reads out above the palette instead of following the ghost; its size fields stay editable there.
  // The Armor layer keeps its millimetre field here, above the bar: a new value also assigns the selected faces.
  const status: ReactNode = locked ? null : pathPart ? <>
    <b>{pathPart.name}</b><span>{pathPoints.length ? `${pathPoints.length} points · click to extend` : 'Click the first point on the ship'}</span>
    {pathPart.path?.kind === 'rope' && <NumberField label="Rope slack" value={s.ropeSlack} min={0} max={pathSlackLimit(pathPoints)} step={.05} unit="m" onChange={tool.setRopeSlack}/>}
    <button disabled={pathPoints.length < 2} onClick={tool.finishPath}>Finish <kbd>Enter</kbd></button><button onClick={() => tool.cancelPath(false)}>Cancel <kbd>Esc</kbd></button>
    <span className="sb-path-hint">{pathPart.path?.kind === 'railing' ? 'Deck supports every post' : 'Hull or fitting support sockets'} · double-click finishes</span>
  </> : layer === 'armor' ? <>
    <b>Armor</b><NumberField value={customMm} min={0} max={1000} step={5} unit="mm" onChange={tool.setThickness}/><span>{customMm > 0 ? 'armor steel' : 'structural skin, no armor'} · <kbd>1</kbd> assigns the selected faces</span>
  </> : !piece ? null : piece.kind === 'hull' && active?.kind === 'shape' ? <>
    <b>{active.name}</b><NumberField value={piece.size[0]} min={.25} max={500} step={1} onChange={value => tool.setSizeOverride([value, piece.size[1], piece.size[2]])}/> × <NumberField value={piece.size[1]} min={.25} max={500} step={1} onChange={value => tool.setSizeOverride([piece.size[0], value, piece.size[2]])}/> × <NumberField value={piece.size[2]} min={.25} max={500} step={1} onChange={value => tool.setSizeOverride([piece.size[0], piece.size[1], value])}/> m<span>{piece.rotationDeg}°</span>
  </> : piece.kind === 'equipment' && active?.kind === 'part' ? <>
    <b>{active.part.name}</b><span>{active.part.placement} · bearing {piece.bearingDeg}°</span>
  </> : piece.kind === 'boundary' ? <><b>{BOUNDARY_NAMES[piece.axis]}</b><span>on the {gridStep} m grid</span></> : null;
  if (!freeformMode && selectedPrimitives.length === 1 && !selectedEquipment.length) {
    const primitive = selectedPrimitives[0], mass = pieceMassKg(compiledResult, primitive.id);
    const size = (axis: number, value: number) => { const next = structuredClone(primitive); next.size[axis] = value; run('Resize hull piece', [{ op: 'primitive', value: next }]); };
    const move = (axis: number, value: number) => { const delta: Vec3 = [0, 0, 0]; delta[axis] = snapCoordinate(value, gridStep) - primitive.position[axis]; tool.nudge(delta); };
    tags.push({ key: `piece-${primitive.id}`, anchor: primitive.position, dx: 70, dy: -78, tone: 'mint', content: <>
      <b>{SHAPE_NAMES[primitive.kind]} <NumberField value={primitive.size[0]} min={.25} max={500} onChange={value => size(0, value)}/> × <NumberField value={primitive.size[1]} min={.25} max={500} onChange={value => size(1, value)}/> × <NumberField value={primitive.size[2]} min={.25} max={500} onChange={value => size(2, value)}/> m</b>
      {canEditVertices(primitive) && <button className="sb-edit-freeform" onClick={enterFreeform}>Freeform hull</button>}
      {primitive.kind === 'custom-hull' && <button className="sb-edit-freeform" onClick={() => setCustomHullSession({ designId: source.id, primitive: structuredClone(primitive) })}>Edit hull sections</button>}
      {mass !== undefined ? `plating ${formatTonnes(mass)} · ` : ''}<NumberField label="x" value={primitive.position[0]} min={-1000} max={1000} step={gridStep} onChange={value => move(0, value)}/> <NumberField label="y" value={primitive.position[1]} min={-1000} max={1000} step={gridStep} onChange={value => move(1, value)}/> <NumberField label="z" value={primitive.position[2]} min={-1000} max={1000} step={gridStep} onChange={value => move(2, value)}/> · {primitive.rotationDeg}° <kbd>R</kbd> · <kbd>⌫</kbd> remove · <kbd>⌘C</kbd> copy
    </> });
  } else if (selectedEquipment.length === 1 && !selectedPrimitives.length) {
    const item = selectedEquipment[0], part = partOf(item), mass = equipmentMassKg(compiledResult, item.id);
    const edit = (label: string, change: (target: ConstructionEquipment) => void) => { const target = structuredClone(item); change(target); run(label, [{ op: 'equipment', value: target }]); };
    const link = (field: 'powerSourceId', kind: 'engine', label: string) => <label> {label} <select className="sb-link" value={item[field] ?? ''} onChange={event => edit('Connect equipment', target => { if (event.target.value) target[field] = event.target.value; else delete target[field]; })}>
      <option value="">automatic</option>{data.equipment.filter(entry => partOf(entry)?.kind === kind).map(entry => <option key={entry.id} value={entry.id}>{partOf(entry)?.name} · {entry.id.slice(-4)}</option>)}</select></label>;
    const move = (axis: number, value: number) => { const delta: Vec3 = [0, 0, 0]; delta[axis] = snapCoordinate(value, gridStep) - item.position[axis]; tool.nudge(delta); };
    tags.push({ key: `part-${item.id}`, anchor: equipmentAnchor(item), dx: 82, dy: -92, tone: 'mint', content: <>
      <b>{part?.name ?? item.partId}</b>
      {mass !== undefined ? `${formatTonnes(mass)} · ` : ''}bearing <NumberField value={item.bearingDeg} min={0} max={360} step={15} unit="°" onChange={value => edit('Set bearing', target => { target.bearingDeg = normalizedBearing(value); })}/> · <NumberField label="x" value={item.position[0]} min={-1000} max={1000} step={gridStep} onChange={value => move(0, value)}/> <NumberField label="y" value={item.position[1]} min={-1000} max={1000} step={gridStep} onChange={value => move(1, value)}/> <NumberField label="z" value={item.position[2]} min={-1000} max={1000} step={gridStep} onChange={value => move(2, value)}/>
      {part?.path && item.path && <PathPointEditor key={item.id} item={item} part={part} onChange={path => edit('Edit fitting path', target => { target.path = path; })}/>}
      {part?.kind === 'gun' && <> · <NumberField label="Turret rise" description="Extend the barbette above its deck attachment; the magazine stays at its lower end." value={item.gun?.barbetteHeightM ?? 0} min={0} max={30} step={.25} unit="m" onChange={value => tool.raiseTurrets([item.id], () => value)}/></>}{data.version === 2 && (part?.kind === 'gun' || part?.kind === 'torpedo-launcher') && <span> · built-in ammunition</span>}{(part?.kind === 'funnel' || part?.kind === 'propeller') && link('powerSourceId', 'engine', '· power')} · <kbd>R</kbd> rotate · <kbd>⌫</kbd> remove
    </> });
  } else if (selected.size > 1) {
    const anchors = [...selectedPrimitives.map(part => part.position), ...selectedEquipment.map(equipmentAnchor)];
    const center = anchors.reduce((sum, point) => sum.map((value, index) => value + point[index] / anchors.length) as Vec3, [0, 0, 0] as Vec3);
    const mass = [...selectedPrimitives.map(part => pieceMassKg(compiledResult, part.id) ?? 0), ...selectedEquipment.map(part => equipmentMassKg(compiledResult, part.id) ?? 0)].reduce((sum, value) => sum + value, 0);
    tags.push({ key: 'group', anchor: center, dx: 70, dy: -78, tone: 'mint', content: <><b>{selected.size} selected</b>{mass ? `${formatTonnes(mass)} · ` : ''}<kbd>R</kbd> rotate · <kbd>⌘C</kbd> copy · <kbd>⇧⌘C</kbd> mirror copy · <kbd>⌫</kbd> remove</> });
  } else if (selectedBoundary) {
    const wall = selectedBoundary, axis = { x: 0, y: 1, z: 2 }[wall.axis], bounds = hullBounds(source);
    const anchor = (bounds ? bounds.min.map((value, index) => (value + bounds.max[index]) / 2) : [0, 0, 0]) as Vec3; anchor[axis] = wall.offset;
    tags.push({ key: `wall-${wall.id}`, anchor, dx: 70, dy: -70, tone: 'mint', content: <>
      <b>{BOUNDARY_NAMES[wall.axis]} at <NumberField value={wall.offset} min={-1000} max={1000} step={gridStep} unit="m" onChange={value => run('Move boundary', [{ op: 'boundary', value: { ...wall, offset: snapCoordinate(value, gridStep) } }])}/></b>
      plating <NumberField value={wall.thicknessMm} min={.1} max={1000} unit="mm" onChange={value => run('Armor boundary', [{ op: 'boundary', value: { ...wall, thicknessMm: value } }])}/> · <kbd>⌫</kbd> remove and merge rooms
    </> });
  }
  if (surfaces.size && (layer === 'armor' || layer === 'paint')) {
    const chosen = editableSurfaces.filter(surface => surfaces.has(surfaceSelectionKey(surface)));
    const first = chosen[0], groups = armorInspectionGroups(chosen), area = chosen.reduce((sum, surface) => sum + surface.areaM2, 0);
    if (first) tags.push({ key: 'faces', anchor: surfaceCentroid(first), dx: 80, dy: -96, tone: 'mint', content: <>
      <b>{surfaces.size} face{surfaces.size === 1 ? '' : 's'} · {groups.length === 1 ? (layer === 'paint' ? `${groups[0].surface.paint.replace('-', ' ')}` : describeArmorGroup(groups[0].surface)) : `${groups.length} different ${layer === 'paint' ? 'paints' : 'thicknesses'}`}</b>
      {layer === 'armor' && <div className="sb-face-armor"><NumberField label="Face armor" description="Armor thickness for the selected faces" value={groups.length === 1 ? first.thicknessMm : customMm} min={0} max={1000} unit="mm" onChange={tool.setThickness}/>{mirror && <span>· mirror on</span>}</div>}
      {format(area, 0)} m² · {layer === 'paint' ? <><kbd>1</kbd>–<kbd>9</kbd> paint</> : <><kbd>1</kbd> assign {customMm} mm · <kbd>2</kbd> open</>} · <kbd>⇧</kbd>click adds · <kbd>Esc</kbd> clear
    </> });
  }
  const hoveredBlock = blocks.find(entry => entry.sourceId && entry.sourceId === hoveredPart);
  if (hoveredBlock) {
    const target = data.primitives.find(part => part.id === hoveredBlock.sourceId) ?? data.equipment.find(part => part.id === hoveredBlock.sourceId);
    const boundary = data.boundaries.find(wall => wall.id === hoveredBlock.sourceId);
    let anchor = target ? ('partId' in target ? equipmentAnchor(target) : target.position) : undefined;
    if (boundary) {
      const bounds = hullBounds(source);
      anchor = (bounds ? bounds.min.map((value, index) => (value + bounds.max[index]) / 2) : [0, 0, 0]) as Vec3;
      anchor[{ x: 0, y: 1, z: 2 }[boundary.axis]] = boundary.offset;
    }
    if (anchor) tags.push({ key: `block-${hoveredBlock.sourceId}`, anchor, dx: -262, dy: -80, tone: 'bad', passive: true, content: <><b>Blocks launch</b><span>{hoveredBlock.message}</span></> });
  }

  // Cards carry the piece, and hull cards its metre dimensions in the corner; the name and reading appear as a tooltip.
  const describe = (item: SlotItem): { title: string; detail: string } => {
    switch (item.kind) {
      case 'shape': return { title: item.name, detail: item.shape.note };
      case 'armor': return { title: 'Armor', detail: `${customMm > 0 ? `${customMm} mm armor steel` : 'structural skin without armor'} · set the thickness above the bar` };
      case 'opening': return { title: 'Opening', detail: 'removes the skin so the face admits water' };
      case 'part': return { title: item.part.name, detail: item.part.path ? `${item.note} · draw connected points` : `${item.note} · ${item.part.placement} · ${item.part.size.map(metres).join(' × ')} m` };
      case 'tool': case 'scheme': return { title: item.name, detail: item.note };
      case 'paint': return { title: item.name, detail: 'paint' };
      default: return { title: '', detail: '' };
    }
  };
  // Palette tips stand above the bar, clear of the readout over the cards (below the bar they would run off the screen); drawer tips stay above their card. Each names the card's key.
  const tipTop = (rect: DOMRect) => { const readout = document.querySelector('.sb-cursor'); return readout ? Math.min(rect.top, readout.getBoundingClientRect().top) : rect.top; };
  const showTip = (item: SlotItem, target: HTMLElement) => {
    if (item.kind === 'empty') return;
    const rect = target.getBoundingClientRect(), inDrawer = !!target.closest('.sb-drawer'), index = palette.bar.findIndex(entry => entry.id === item.id);
    setTip({ ...describe(item), x: rect.left + rect.width / 2, y: inDrawer ? rect.top : tipTop(rect), key: index >= 0 ? String(index + 1) : undefined });
  };
  const hideTip = () => setTip(undefined);
  const face = (item: SlotItem) => {
    const image = imageFor(item);
    const picture = image ? <img src={image} alt="" draggable={false}/> : null;
    if (item.kind === 'shape') return <>{picture ?? <SlotGlyph item={item} customMm={customMm}/>}<i className="sb-dims">{dimensions(item.shape.size)}</i>{item.shape.kind === 'ballast' && <small className="sb-slot-weight">100 t</small>}</>;
    if (picture) return picture;
    switch (item.kind) {
      case 'armor': return <i className="sb-swatch" style={{ background: armorThicknessColor(customMm) }}><span>{customMm} mm</span></i>;
      case 'paint': return <i className="sb-swatch" style={{ background: item.color }}/>;
      case 'scheme': return <i className="sb-swatch" style={{ background: item.id === 'two-tone' ? 'linear-gradient(#64716f 50%, #7c8c91 50%)' : 'repeating-linear-gradient(90deg, #405d70 0 25%, #b5bfbc 25% 50%)' }}/>;
      case 'empty': return null;
      default: return <SlotGlyph item={item} customMm={customMm}/>;
    }
  };
  const slot = (item: SlotItem) => {
    const pressed = item.kind !== 'empty' && active?.id === item.id;
    return <button key={item.id} className={`sb-slot ${item.kind === 'empty' ? 'empty' : ''}`} aria-pressed={pressed} aria-label={item.kind === 'part' ? item.part.name : item.name || undefined} disabled={item.kind === 'empty' || locked}
      onPointerEnter={event => showTip(item, event.currentTarget)} onPointerLeave={hideTip} onFocus={event => showTip(item, event.currentTarget)} onBlur={hideTip} onClick={() => selectSlot(item)}>{face(item)}</button>;
  };

  // ---- hotkey legend above the compass: the standing keys on the bottom row; the keys acting on the cursor piece, the selection or the picked faces on a row above.
  // Keys already printed elsewhere (rail tools and modifiers, the view strip's Q P S C A Home, W on the warnings lead, ⌘Z on undo, ? on Keys) stay off it.
  const faceLayer = layer === 'armor' || layer === 'paint';
  const movable = selectedPrimitives.length + selectedEquipment.length > 0;
  const standing: KeyHint[] = [
    { keys: palette.bar.length < 4 ? palette.bar.map((_, index) => String(index + 1)) : ['1', '…', '9'], label: surfaces.size && faceLayer ? (layer === 'paint' ? 'Paint faces' : 'Assign armor') : 'Card' },
    ...(hasDrawer ? [{ keys: ['0'], label: `All ${drawerName}` }] : []),
    ...(slice.on ? [{ keys: selected.size ? ['⇧PgUp', '⇧PgDn'] : ['PgUp', 'PgDn'], label: 'Slice height' }] : []),
  ];
  const acting: KeyHint[] = [];
  if (!locked && piece && piece.kind !== 'boundary') acting.push({ keys: ['R'], label: piece.kind === 'hull' ? 'Rotate 90°' : 'Rotate 15°' });
  else if (movable && !freeformMode) acting.push({ keys: ['R'], label: selectedPrimitives.length ? 'Rotate 90°' : 'Rotate 15°' });
  if (movable && !freeformMode) acting.push({ keys: ['←→', '↑↓'], label: 'Nudge' }, { keys: ['PgUp', 'PgDn'], label: 'Raise · lower' }, { keys: ['⌘C'], label: 'Copy' }, { keys: ['⇧⌘C'], label: 'Mirror copy' });
  if (selected.size) acting.push({ keys: ['⌫', '⌘X'], label: movable ? 'Remove' : 'Remove · merge rooms' });
  if (surfaces.size && faceLayer) acting.push({ keys: ['⇧'], label: 'Click adds a face' });
  const escape = pathPart ? 'Cancel path' : drawer || designsOpen ? 'Close' : suggestion ? 'Dismiss layout' : measure ? 'End measure' : activeTool !== 'select' ? 'Select tool' : selected.size || surfaces.size ? 'Clear' : '';
  if (escape) acting.push({ keys: ['Esc'], label: escape });
  const chip = (hint: KeyHint) => <span key={hint.label} className="sb-key">{hint.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}{hint.label}</span>;

  const viewBar = <ViewBar viewName={VIEW_NAMES[view]} perspective={perspective} sliceLabel={slice.on ? `${signed(slice.y)} m` : 'Off'} sliceOn={slice.on} showCenters={showCenters} showArcs={layer === 'fittings' ? showArcs : undefined}
      onView={tool.cycleView} onProjection={tool.toggleProjection} onSlice={tool.toggleSlice} onCenters={tool.toggleCenters} onArcs={tool.toggleArcs} onFit={tool.fit}
      onTip={entry => { if (!entry) { setTip(undefined); return; } const rect = entry.target.getBoundingClientRect(); setTip({ title: entry.title, detail: entry.detail, key: entry.key, x: rect.left + rect.width / 2, y: rect.top, right: Math.max(12, window.innerWidth - rect.right) }); }}/>;
  return <main className={`shipbuilder ${freeformMode ? 'sb-freeform-mode' : ''}`} aria-label="Shipbuilder" data-path-drawing={!!pathPart || undefined} data-layer={layer} data-drawer={drawer || undefined} aria-busy={!!busy}>
    {newDesignOpen && <NewDesignDialog onClose={() => setNewDesignOpen(false)} onCreate={newDesign}/>}
    {customHullSession?.designId === source.id && createPortal(<CustomHullEditor integration={{ hull: editableCustomHull(customHullSession.primitive), onClose: () => setCustomHullSession(undefined), onApply: hull => {
      const existing = data.primitives.find(part => part.id === customHullSession.primitive.id);
      if (existing) run('Shape custom hull', [{ op: 'primitive', value: customHullPrimitive(hull, existing) }]);
      setCustomHullSession(undefined); tool.fit();
    } }}/>, document.body)}
    <BuilderViewport scene={tool.scene(compile.retained)} tags={tags} coords={tool.coords} status={status} onPointer={tool.pointer} onHover={setHoveredPart} createModel={props.createModel}/>
    {freeformPrimitive && <FreeformToolbar settings={freeformSettings} onChange={tool.changeFreeformSettings} cycleUnit={tool.cycleUnit}
      onReset={tool.resetFreeform} onSplit={tool.splitFreeform} onExit={tool.exitFreeform}/>}
    <header className="sb-top">
      <button className="sb-port" disabled={!!busy || !!pathPoints.length} onClick={() => void close()} title="Save and return to port"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1.5 3.5 6 8 10.5"/></svg>Port</button>
      <div className="sb-ship">
        <input disabled={locked} className="sb-name" aria-label="Design name" maxLength={160} value={source.name} onChange={event => run('Rename design', [{ op: 'name', name: event.target.value }])}/>
        <button className="sb-meta" disabled={!!pathPoints.length} aria-haspopup="menu" aria-expanded={designsOpen} onClick={() => setDesignsOpen(value => !value)}>{data.primitives.length} pieces · {data.equipment.length} fittings <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m2 3.5 3 3 3-3"/></svg></button>
        <i className={`sb-save ${saveTone}`} role="status">{saveText}</i>
        {designsOpen && !props.repositoryId && <DesignsMenu partsUpdate={partsUpdate} disabled={locked} store={editor.store} currentId={source.id} refresh={revision.saveState.revision?.id} onClose={() => setDesignsOpen(false)} onNew={kind => { if (kind) void newDesign(kind).catch(fail); else { setDesignsOpen(false); setNewDesignOpen(true); } }} onSaveCopy={() => void saveCopy()} onDelete={deleteDesign}
          onDownload={() => { downloadConstructionSource(JSON.stringify(source, null, 2), source.name); setDesignsOpen(false); }}
          onOpen={async (next, revision) => { setDesignsOpen(false); await owner.replace(next, revision, true); switchLayer('hull'); }} onRecover={async next => { setDesignsOpen(false); await owner.replace(next, null, false); switchLayer('hull'); }}/>}
        {designsOpen && props.repositoryId && <div className="sb-menu" role="menu" aria-label="Repository source">
          <div className="sb-menu-row"><span className="sb-lead">Source</span><span>{props.repositoryId}/blueprint.json</span></div>
          <div className="sb-menu-row"><button role="menuitem" onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download backup</button></div>
          <div className="sb-menu-row"><button role="menuitem" disabled={locked} onClick={() => void editor.reloadRepository().then(() => setDesignsOpen(false)).catch(fail)}>Reload repository</button><button role="menuitem" disabled={locked} onClick={() => void saveLocalCopy()}>Save local copy</button><button role="menuitem" onClick={() => setDesignsOpen(false)}>Close</button></div>
        </div>}
      </div>
      <div className="sb-actions">
        <button className="sb-undo" disabled={locked || !!pathPoints.length || !revision.history.past.length} onClick={owner.undo} title={revision.history.past.length ? `Undo ${revision.history.lastAction}` : 'Nothing to undo'}><kbd>⌘Z</kbd>{revision.history.past.length}</button>
        <button className="sb-undo" disabled={locked || !!pathPoints.length || !revision.history.future.length} onClick={owner.redo} title="Redo (⇧⌘Z)"><kbd>⇧⌘Z</kbd>{revision.history.future.length}</button>
        <button className="sb-cmd" disabled={!canLaunch} title={launchTitle} onClick={() => void launch()}>{busy ? `${busy.toUpperCase()}…` : revision.saveState.status === 'error' ? 'TRIAL DRAFT' : 'SEA TRIALS'}<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"/></svg></button>
      </div>
    </header>
    <div className="sb-left">
      <div className="sb-warn">
        <button className={`lead ${blocks.length ? 'bad' : ''}`} aria-expanded={warningsOpen} onClick={() => setWarningsOpen(value => !value)}>
          {compile.compiling ? 'Compiling · ' : !compiledResult ? 'Draft · ' : ''}{blocks.length} block{blocks.length === 1 ? '' : 's'} · {warns.length} warning{warns.length === 1 ? '' : 's'} <kbd>W</kbd>
        </button>
        {compile.error && <div className="row bad"><i className="sb-dot block"/><span>{compile.error}</span><button onClick={compiled.retry}>Retry</button></div>}
        {revision.error && <div className={`row bad ${props.repositoryId ? 'sb-repository-error' : ''}`} role="alert"><i className="sb-dot block"/><span>{revision.error}</span>
          <button onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download</button><button onClick={() => void owner.retrySave()?.catch(fail)}>Retry save</button>
          {props.repositoryId && <button onClick={() => void editor.reloadRepository().catch(fail)}>Reload repository</button>}
          <button onClick={() => void (props.repositoryId ? saveLocalCopy() : saveCopy())}>{props.repositoryId ? 'Save local copy' : 'Save a copy'}</button><button onClick={() => owner.setError('')}>Dismiss</button></div>}
        {warningsOpen && <div className="rows">{warnings.map((entry, index) => <button key={`${entry.code}-${index}`} className={`row ${entry.tone === 'note' ? 'note' : ''}`} title={entry.sourceId ? 'Select the affected part' : entry.code} onClick={() => { if (entry.sourceId) { tool.choose(entry.sourceId); if (data.equipment.some(part => part.id === entry.sourceId) && layer !== 'fittings' && layer !== 'internals') switchLayer(partOf(data.equipment.find(part => part.id === entry.sourceId)!)?.placement === 'internal' ? 'internals' : 'fittings'); } }}><i className={`sb-dot ${entry.tone}`}/><span>{entry.message}</span></button>)}</div>}
        {suggestion && <div className="row" role="status"><i className={`sb-dot ${suggestion.proposal.diagnostics.some(item => item.severity === 'error') ? 'block' : 'ok'}`}/>
          <span>{suggestion.proposal.diagnostics.map(item => item.message).join(' · ') || (suggestionChanged ? 'A layout is ready; the dashed outlines show where it adds equipment.' : 'The requested equipment is already fitted.')}</span>
          {suggestionChanged && !suggestion.proposal.diagnostics.some(item => item.severity === 'error') && <button disabled={source.revision !== suggestion.revision} onClick={tool.applySuggestion}>Apply <kbd>⏎</kbd></button>}<button onClick={tool.dismissSuggestion}>Dismiss</button></div>}
        {notice && <div className="row note" role="status"><i className="sb-dot note"/><span>{notice}</span></div>}
      </div>
      <div className="sb-rail" role="toolbar" aria-label="Tools"><span className="sb-rail-cap">Tools</span>
        {rail.map(entry => <button key={entry.id} className={entry.kind} disabled={locked} aria-pressed={entry.kind === 'tool' ? activeTool === entry.id : undefined} title={`${entry.name} (${entry.key})`} onClick={() => tool.activateRail(entry)}><ToolGlyph name={entry.glyph}/><span>{entry.name}</span><kbd>{entry.key}</kbd></button>)}
        {layer==='hull' && <button aria-pressed={freeformMode} disabled={locked || selected.size!==1 || !selectedPrimitives[0] || !canEditVertices(selectedPrimitives[0])} onClick={freeformMode?tool.exitFreeform:enterFreeform} title="Select one cube or freeform hull to edit vertices, edges and faces"><ToolGlyph name="Select"/><span>Freeform</span></button>}
        {/* Modifiers change where a click lands rather than what it does; freeform mode carries its own local mirror axes and unit. */}
        {!freeformMode && <><span className="sb-rail-cap foot">Modifiers</span>
          <button className="toggle" disabled={locked} aria-pressed={mirror} title="Mirror (M) · place, move and paint the twin across the centerline" onClick={tool.toggleMirror}><ToolGlyph name="Mirror"/><span>Mirror</span><kbd>M</kbd></button>
          <button className="value" disabled={locked} title={`Snap · ${gridStep} m · click to cycle 0.25, 0.5, 1, 2 and 5 m for placement and movement`} onClick={tool.cycleSnap}><b>{gridStep} m</b><span>Snap</span></button></>}
        <button className="help" aria-haspopup="dialog" aria-expanded={helpOpen} title="Controls and hotkeys (?)" onClick={() => setHelpOpen(value => !value)}><ToolGlyph name="Keys"/><span>Keys</span><kbd>?</kbd></button></div>
    </div>
    <aside className="sb-ledger" aria-label="Ledger">
      <h4>Ledger{compile.compiling && <span>compiling…</span>}</h4>
      {rows.map(row => <div key={row.label} className={`row ${row.tone ?? ''}`}><span>{row.label}</span><b>{row.value}</b></div>)}
      {totalMass > 0 && <><div className="sb-massbar" aria-hidden="true">{masses.filter(group => group.massKg > 0).map(group => <i key={group.name} style={{ width: `${(100 * group.massKg / totalMass).toFixed(1)}%`, background: group.color }}/>)}</div>
        <div className="sb-masskey">{masses.filter(group => group.massKg > 0).map(group => <span key={group.name} style={{ display: 'contents' }}><i style={{ background: group.color }}/><span>{group.name}</span><b>{formatTonnes(group.massKg, group.massKg < 1e5 ? 1 : 0)}</b></span>)}</div></>}
      {layer === 'armor' && <div className="sb-armor-groups" aria-label="Hull armor coverage">{armorInspectionGroups(editableSurfaces).sort((a, b) => b.areaM2 - a.areaM2).slice(0, 6).map(group => <p key={group.id}>{describeArmorGroup(group.surface)}<small>{format(group.areaM2, 0)} m² · {group.faces.size} face{group.faces.size === 1 ? '' : 's'}</small></p>)}</div>}
    </aside>
    {drawer && <div className="sb-drawer" ref={drawerRef} style={drawerSize} aria-label={`All ${drawerName}`}>
      <div className="sb-drawer-head"><span className="sb-lead">All {drawerName}</span>
        {(layer === 'fittings' || layer === 'hull') && <label className="sb-search">Find <input autoFocus type="search" aria-label={layer === 'hull' ? 'Find a shape' : 'Find a fitting'} placeholder={layer === 'hull' ? 'bridge, cylinder, shell…' : 'gun, screw, funnel…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' || (event.key === '0' && !event.currentTarget.value)) { event.preventDefault(); event.stopPropagation(); setDrawer(false); setTip(undefined); } }}/></label>}
        <button className="sb-drawer-close" aria-label="Close" onClick={() => { setDrawer(false); setTip(undefined); }}>×</button></div>
      <div className="sb-drawer-grid" role="listbox">{drawerItems.map(item => slot(item))}{!drawerItems.length && <span className="sb-lead">No {layer === 'hull' ? 'shape' : 'fitting'} matches</span>}</div>
    </div>}
    <div className="sb-dock">
      <div className="sb-dock-tabs">
        <nav className="sb-tabs" role="tablist" aria-label="Layers">{BUILDER_LAYERS.map(entry => <button key={entry.id} role="tab" aria-selected={layer === entry.id} title={entry.name} onClick={() => switchLayer(entry.id)}><ToolGlyph name={LAYER_GLYPHS[entry.id]}/><span>{entry.name}</span></button>)}</nav>
        <div className="sb-keys" aria-label="Hotkeys">
          {acting.length > 0 && <div className="sb-keys-row acting">{acting.map(chip)}</div>}
          <div className="sb-keys-row">{standing.map(chip)}</div>
        </div>
      </div>
      <div className="sb-dock-body">
        <div className="sb-hotbar" role="toolbar" aria-label="Palette">
          <div className="sb-hotbar-cards" ref={hotbarRef}>{palette.drawer.map(item => slot(item))}</div>
          {hasDrawer ? <button className="sb-slot more" aria-expanded={drawer} aria-label={`All ${drawerName}`} onPointerEnter={event => { const rect = event.currentTarget.getBoundingClientRect(); setTip({ title: `All ${drawerName}`, detail: drawer ? 'close the full selection' : 'open the full selection', x: rect.left + rect.width / 2, y: tipTop(rect), key: '0' }); }} onPointerLeave={hideTip} onClick={() => { setDrawer(value => !value); setTip(undefined); }}>…</button> : null}
        </div>
        {viewBar}
      </div>
    </div>
    {tip && <div className={`sb-tip ${tip.below ? 'below' : ''} ${tip.right !== undefined ? 'right' : ''}`} role="tooltip" style={tip.right !== undefined ? { right: tip.right, top: tip.y } : { left: tip.x, top: tip.y }}><b>{tip.title}</b>{tip.detail}{tip.key && <kbd>{tip.key}</kbd>}</div>}
    {!data.primitives.length && <div className="sb-empty"><b>This design needs a starting block</b><button disabled={locked} onClick={() => run('Add starting block', [{ op: 'primitive', value: startingHullBlock() }])}>Add a hull block</button> to keep building.</div>}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)}/>}
  </main>;
}

export { attachmentOffset };
