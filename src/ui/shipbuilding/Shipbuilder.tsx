import { FreeformToolbar, type FreeformSettings } from './FreeformToolbar';
import { canEditVertices, freeformEdit, replaceVertexPrimitives, selectionCenter, splitVertexPrimitive, VERTEX_UNITS } from '../../ships/constructionVertex';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ConstructionBoundary, ConstructionCatalog, ConstructionEquipment, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_LIMITS, assignConstructionSurfaces, copyConstructionSelection, editableConstructionSurfaces, mirroredFace, mirroredPrimitive, moveConstructionSelection, newConstructionId, removeConstructionSelection, rotateConstructionSelection, surfaceKey, type ConstructionFace } from '../../ships/constructionEditor';
import { removeLocalShip } from '../../ships/localShips';
import { ConstructionClient } from '../../ships/constructionClient';
import { createStarterSource, startingHullBlock, type ConstructionStarter } from '../../ships/constructionStarter';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
import { armorThicknessColor } from '../../ships/inspection';
import { BuilderViewport, type BuilderArc, type BuilderDisplay, type BuilderGesture, type BuilderMoveTargets, type BuilderPick, type BuilderProposal, type BuilderTag, type BuilderView, type ConstructionModelFactory } from './BuilderViewport';
import { BUILDER_LAYERS, BUILDER_RAIL, DEFAULT_TOOL, FAMILY_NAMES, formatTonnes, paletteFor, type BuilderLayer, type BuilderTool, type RailEntry, type SlotItem } from './builderLayers';
import { equipmentMassKg, format, hullBounds, ledgerRows, massGroups, pieceMassKg, surfaceCentroid, warningEntries } from './builderReadings';
import { SlotGlyph, ToolGlyph } from './builderGlyphs';
import { DesignsMenu, downloadConstructionSource } from './DesignsMenu';
import { HelpDialog } from './HelpDialog';
import { NumberField } from './NumberField';
import { SlotImages, useSlotImages } from './slotImages';
import { armorInspectionGroups, describeArmorGroup } from './ArmorInspection';
import { attachmentOffset, mirrorTwin, mirrorTwinEquipment, offCenterline, rotateY, bearingRadians } from './placement';
import type { BuilderPlacement } from './primitiveGeometry';
import { normalizedBearing, snapCoordinate } from './editorNumbers';
import { freshConstruction, useBuilderSource, type BuilderCompiler } from './useBuilderSource';
import './Shipbuilder.css';

export interface ShipbuilderProps {
  catalog: ConstructionCatalog;
  starterSource?: ConstructionSource;
  compileClient?: BuilderCompiler;
  initialSource?: ConstructionSource;
  initialDesignId?: string;
  onClose(source: ConstructionSource, result?: ConstructionResult): void | Promise<void>;
  onLaunch(source: ConstructionSource, result: ConstructionResult): void | Promise<void>;
  onSave?(source: ConstructionSource): void;
  onDelete?(designId: string): void;
  createModel?: ConstructionModelFactory;
  suggestLayout?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
}

const DISPLAY: Record<BuilderLayer, BuilderDisplay> = { hull: 'paint', armor: 'armor', internals: 'internals', fittings: 'paint', paint: 'paint' };
const SHAPE_NAMES: Record<ConstructionPrimitive['kind'], string> = { box: 'Box', wedge: 'Wedge', corner: 'Corner out', 'inverse-corner': 'Corner in', vertex: 'Freeform hull' };
const BOUNDARY_NAMES: Record<ConstructionBoundary['axis'], string> = { y: 'Deck', z: 'Bulkhead', x: 'Split' };
const VIEWS: BuilderView[] = ['orbit', 'top', 'side', 'bow'];
const VIEW_NAMES: Record<BuilderView, string> = { orbit: 'Orbit', top: 'Plan', side: 'Profile', bow: 'Bow' };
const ARC_RADIUS = 12;
const LIMITS = CONSTRUCTION_LIMITS;
interface KeyHint { keys: string[]; label: string }
const metres = (value: number) => Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** The card's corner label: whole metres stay bare, quarter and half plates read as fractions. */
const dimensions = (size: Vec3) => size.map(value => value === .25 ? '¼' : value === .5 ? '½' : value === .75 ? '¾' : metres(value)).join('×');
const signed = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${metres(Math.abs(value))}`;

export function Shipbuilder(props: ShipbuilderProps) {
  const [compiler] = useState<BuilderCompiler>(() => props.compileClient ?? new ConstructionClient());
  const [starterSource] = useState(() => props.starterSource ?? createStarterSource(props.catalog, 'blank'));
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

  const [layer, setLayer] = useState<BuilderLayer>('hull');
  const [tool, setTool] = useState<BuilderTool>('place');
  const [slots, setSlots] = useState<Record<BuilderLayer, string>>({ hull: 'cube', armor: 'armor', internals: 'deck', fittings: '', paint: 'naval-gray' });
  const [customMm, setCustomMm] = useState(50);
  const [sizeOverride, setSizeOverride] = useState<Vec3>();
  const [bearing, setBearing] = useState(0);
  const [mirror, setMirror] = useState(true);
  const [showArcs, setShowArcs] = useState(false);
  const [showCenters, setShowCenters] = useState(true);
  const [freeformSession, setFreeformSession] = useState<{designId:string;baseline:ConstructionPrimitive}>();
  const [freeformSettings, setFreeformSettings] = useState<FreeformSettings>({axes:[true,false,false],unit:.2,snap:false,splitAxis:2,count:4,selection:{mode:'vertex',index:1}});
  const [perspective,setPerspective] = useState(false);
  const [view, setView] = useState<BuilderView>('orbit');
  const [slice, setSlice] = useState<{ on: boolean; y: number; auto: boolean }>({ on: false, y: 0, auto: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [surfaces, setSurfaces] = useState<Set<string>>(new Set());
  const [measure, setMeasure] = useState<{ from: Vec3; to?: Vec3 }>();
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [warningsOpen, setWarningsOpen] = useState(true);
  const [designsOpen, setDesignsOpen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [suggestion, setSuggestion] = useState<ConstructionSuggestion>();
  const [suggestionRevision, setSuggestionRevision] = useState('');
  const suggestionRequest = useRef<AbortController | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tip, setTip] = useState<{ title: string; detail: string; x: number; y: number; key?: string; below?: boolean }>();
  const [slotImages] = useState(() => new SlotImages());
  useEffect(() => () => slotImages.dispose(), [slotImages]);

  const palette = useMemo(() => paletteFor(layer, catalog), [layer, catalog]);
  const imageFor = useSlotImages(slotImages, palette.drawer, catalog);
  const active = palette.drawer.find(item => item.id === slots[layer]) ?? palette.drawer[0];
  const drawerName = layer === 'fittings' ? 'fittings' : layer === 'hull' ? 'shapes' : 'items';
  const hasDrawer = palette.drawer.length > palette.bar.filter(item => item.kind !== 'empty').length || layer === 'fittings';
  const rail = BUILDER_RAIL[layer];
  const locked = !editor.ready || !!busy;
  const compiled = editor.currentResult;
  const selectedPrimitives = data.primitives.filter(part => selected.has(part.id));
  const selectedEquipment = data.equipment.filter(part => selected.has(part.id));
  const freeformPrimitive = freeformSession?.designId === source.id && layer === 'hull' && tool === 'select' && selected.size === 1 && selected.has(freeformSession.baseline.id) ? data.primitives.find(p=>p.id===freeformSession.baseline.id && canEditVertices(p)) : undefined;
  const freeformMode = !!freeformPrimitive;
  const selectedBoundary = data.boundaries.find(wall => selected.has(wall.id));
  const partOf = (instance: ConstructionEquipment) => catalog.equipment.find(part => part.id === instance.partId);
  const editableSurfaces = useMemo(() => editableConstructionSurfaces(source, compiled?.surfaces ?? []), [source, compiled]);
  const editableKeys = useMemo(() => new Set(editableSurfaces.map(surface => surfaceKey(surface.primitiveId, surface.face))), [editableSurfaces]);
  const gridStep = layer === 'fittings' || (layer === 'internals' && tool === 'module') ? .25 : 1;
  const fail = (cause: unknown) => editor.setError(cause instanceof Error ? cause.message : String(cause));
  const run = (label: string, command: (draft: ConstructionSource) => void) => { if (locked) return; editor.setError(''); setNotice(''); editor.edit(label, command); };
  const changeFreeformSettings = (patch:Partial<FreeformSettings>) => setFreeformSettings(current => ({...current,...patch}));
  const cycleUnit = () => changeFreeformSettings({unit:VERTEX_UNITS[(VERTEX_UNITS.findIndex(n=>n===freeformSettings.unit)+1)%VERTEX_UNITS.length]});
  const enterFreeform = () => {
    const p=selectedPrimitives[0];if(!p || selected.size!==1 || !canEditVertices(p))return;
    setTool('select');setLayer('hull');setSlice(current=>({...current,on:false}));setDrawer(false);setSurfaces(new Set());setFreeformSession({designId:source.id,baseline:structuredClone(p)});
  };
  const commitFreeform = (replacements:ConstructionPrimitive[]) => { if(replacements.length) run('Shape freeform hull',draft=>replaceVertexPrimitives(draft,replacements)); };
  const setSelectionCoordinate = (axis:number,value:number) => {
    if(!freeformPrimitive)return;const delta:Vec3=[0,0,0];
    const original=selectionCenter(freeformPrimitive,freeformSettings.selection)[axis];
    delta[axis]=Math.round((value-original)/freeformSettings.unit)*freeformSettings.unit;
    commitFreeform(freeformEdit(source,freeformPrimitive.id,freeformSettings.selection,delta,freeformSettings.axes,freeformSettings.snap));
  };
  const splitFreeform = () => {
    if(!freeformPrimitive)return;
    try {const next=structuredClone(source),ids=splitVertexPrimitive(next,freeformPrimitive.id,freeformSettings.splitAxis,freeformSettings.count);
      run('Split hull block',draft=>{draft.construction=next.construction;});setSelected(new Set([ids[0]]));setFreeformSession(undefined);
    }catch(cause){fail(cause);}
  };
  useEffect(()=>{if(freeformSession&&!freeformMode)setFreeformSession(undefined);},[freeformMode,source.id]);
  const requestSuggestion = props.suggestLayout ?? (compiler.suggest ? (source: ConstructionSource, ids: string[], signal?: AbortSignal) => compiler.suggest!(source, ids, signal) : undefined);
  const suggestionChanged = suggestion && JSON.stringify([data.equipment, data.boundaries, data.loads]) !== JSON.stringify([suggestion.source.construction.equipment, suggestion.source.construction.boundaries, suggestion.source.construction.loads]);

  useEffect(() => { setSelected(new Set()); setSurfaces(new Set()); setSuggestion(undefined); setMeasure(undefined); }, [source.id]);
  useEffect(() => () => { suggestionRequest.current?.abort(); suggestionRequest.current = undefined; }, [source.revision]);

  // ---- the cursor piece
  const piece = useMemo((): BuilderPlacement | undefined => {
    if (layer === 'hull' && (tool === 'place' || tool === 'fill') && active?.kind === 'shape') return { kind: 'hull', shape: active.shape.kind, size: sizeOverride ?? active.shape.size, rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90) };
    if (((layer === 'fittings' && tool === 'place') || (layer === 'internals' && tool === 'module')) && active?.kind === 'part') {
      const gun = active.part.gunPartId ? catalog.weapons.parts.find(gun => gun.id === active.part.gunPartId) : undefined;
      return { kind: 'equipment', partId: active.part.id, size: active.part.size, boundsCenter: active.part.boundsCenter, bearingDeg: normalizedBearing(bearing), sockets: active.part.sockets, arc: gun ? { traverseDeg: gun.traverseDeg, radius: ARC_RADIUS } : undefined, inset: active.part.placement === 'internal' ? data.defaultThicknessMm / 1000 : undefined };
    }
    if (layer === 'internals' && (tool === 'deck' || tool === 'bulkhead' || tool === 'longitudinal')) return { kind: 'boundary', axis: tool === 'deck' ? 'y' : tool === 'bulkhead' ? 'z' : 'x', thicknessMm: 10 };
    return undefined;
  }, [layer, tool, active, sizeOverride, bearing, catalog, data.defaultThicknessMm]);
  const mirrorPiece = useMemo((): BuilderPlacement | undefined => {
    if (!mirror || !piece) return undefined;
    if (piece.kind === 'hull') { const twin = mirroredPrimitive({ id: '', kind: piece.shape, size: piece.size, position: [1, 0, 0], rotationDeg: piece.rotationDeg }); return { kind: 'hull', shape: twin.kind, size: twin.size, rotationDeg: twin.rotationDeg }; }
    if (piece.kind === 'equipment') return { ...piece, bearingDeg: normalizedBearing(-piece.bearingDeg), arc: undefined };
    return undefined;
  }, [mirror, piece]);
  const gesture: BuilderGesture = tool === 'fill' ? 'fill' : tool === 'place' || tool === 'module' ? 'stroke' : 'none';

  // ---- selection and editing
  const choose = (id: string, additive = false) => {
    if(freeformSession && !additive && id!==freeformSession.baseline.id) {
      const p=data.primitives.find(p=>p.id===id && canEditVertices(p));
      setFreeformSession(p?{designId:source.id,baseline:structuredClone(p)}:undefined);
    }
    setSelected(current => {
      if (!additive) return new Set([id]);
      const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
  };
  const clearSelection = () => { setSelected(new Set()); setSurfaces(new Set()); };
  const removePieces = (ids: ReadonlySet<string>, label = 'Remove selection') => {
    if (locked || !ids.size) return;
    const keep = data.primitives.every(part => ids.has(part.id)) ? data.primitives[0]?.id : undefined;
    run(label, draft => removeConstructionSelection(draft, ids));
    setSelected(current => new Set([...current].filter(id => !ids.has(id) || id === keep)));
    setSurfaces(current => new Set([...current].filter(key => ![...ids].some(id => id !== keep && key.startsWith(`${id}:`)))));
    if (keep) setNotice('Kept the last hull block. Add another block before removing it.');
  };
  const remove = () => removePieces(selected);
  const copy = (mirrorCopy = false) => {
    if (!selected.size) return;
    if (data.primitives.length + selectedPrimitives.length > LIMITS.primitives || data.equipment.length + selectedEquipment.length > LIMITS.equipment) { editor.setError('This copy would exceed the design limit. Select fewer pieces or remove a section first.'); return; }
    const next = structuredClone(source);
    const copied = copyConstructionSelection(next, selected, { mirror: mirrorCopy });
    if (!copied.length) return;
    run(mirrorCopy ? 'Mirror selection' : 'Copy selection', draft => { draft.construction = next.construction; });
    setSelected(new Set(copied)); setSurfaces(new Set());
    setNotice(mirrorCopy ? 'Mirrored a copy across the centerline.' : 'Copied the selection 1 m to starboard.');
  };
  const nudge = (delta: Vec3) => { if (selected.size) run('Move selection', draft => moveConstructionSelection(draft, selected, delta)); };
  /** Select drags any piece, fitting or wall; placing fittings or modules still drags the ones already fitted. Face layers never move geometry. */
  const moveTargets: BuilderMoveTargets = layer === 'armor' || layer === 'paint' ? 'none' : tool === 'select' ? 'all' : (layer === 'fittings' && tool === 'place') || tool === 'module' ? 'equipment' : 'none';
  const movePieces = (ids: string[], delta: Vec3) => {
    if (locked || !ids.length) return;
    const moving = new Set(ids);
    run('Move selection', draft => {
      moveConstructionSelection(draft, moving, delta);
      for (const wall of draft.construction.boundaries) if (moving.has(wall.id)) wall.offset = snapCoordinate(wall.offset + delta[{ x: 0, y: 1, z: 2 }[wall.axis]], 1);
    });
    setSelected(moving); setSurfaces(new Set());
  };
  const rotate = () => {
    if (piece && piece.kind !== 'boundary') { setBearing(value => normalizedBearing(value + (piece.kind === 'hull' ? 90 : 15))); return; }
    if (selected.size) run('Rotate selection', draft => rotateConstructionSelection(draft, selected, selectedPrimitives.length ? 90 : 15));
  };
  const placeAt = (points: Vec3[]) => {
    if (!piece || locked) return;
    if (piece.kind === 'hull' && active?.kind === 'shape') {
      const pieces: ConstructionPrimitive[] = [];
      for (const point of points) {
        pieces.push({ id: newConstructionId('hull'), kind: piece.shape, size: [...piece.size], position: point, rotationDeg: piece.rotationDeg });
        if (mirror && offCenterline(point)) pieces.push({ ...mirroredPrimitive(pieces.at(-1)!), id: newConstructionId('hull') });
      }
      if (data.primitives.length + pieces.length > LIMITS.primitives) { editor.setError(`A design supports up to ${LIMITS.primitives} hull pieces. Use larger pieces or remove a section before adding more.`); return; }
      run(pieces.length > 1 ? 'Lay hull pieces' : 'Place hull piece', draft => { draft.construction.primitives.push(...pieces); });
    } else if (piece.kind === 'equipment' && active?.kind === 'part') {
      const parts: ConstructionEquipment[] = [];
      for (const point of points) {
        // The viewport already snaps the face plane; retain the exact socket height.
        parts.push({ id: newConstructionId('equipment'), partId: active.id, position: [...point], bearingDeg: piece.bearingDeg });
        if (mirror && offCenterline(point)) parts.push({ ...parts.at(-1)!, id: newConstructionId('equipment'), position: [-point[0], point[1], point[2]], bearingDeg: normalizedBearing(-piece.bearingDeg) });
      }
      if (data.equipment.length + parts.length > LIMITS.equipment) { editor.setError(`A design supports up to ${LIMITS.equipment} fittings. Remove a fitting before adding more.`); return; }
      run(parts.length > 1 ? 'Place fittings' : `Place ${active.name}`, draft => { draft.construction.equipment.push(...parts); });
    }
  };
  const addBoundary = (axis: ConstructionBoundary['axis'], offset: number) => {
    if (data.boundaries.length >= LIMITS.boundaries) { editor.setError(`A design supports up to ${LIMITS.boundaries} decks and bulkheads. Merge rooms before adding more.`); return; }
    if (data.boundaries.some(wall => wall.axis === axis && Math.abs(wall.offset - offset) < 1e-6)) { setNotice(`A ${BOUNDARY_NAMES[axis].toLowerCase()} already sits at ${signed(offset)} m.`); return; }
    run(`Add ${BOUNDARY_NAMES[axis].toLowerCase()}`, draft => { draft.construction.boundaries.push({ id: newConstructionId('boundary'), axis, offset, thicknessMm: 10 }); });
  };
  const withMirrorFaces = (keys: ReadonlySet<string>) => {
    if (!mirror) return new Set(keys);
    const out = new Set(keys);
    for (const key of keys) {
      const [primitiveId, face] = key.split(':') as [string, ConstructionFace];
      const primitive = data.primitives.find(part => part.id === primitiveId), twin = primitive && mirrorTwin(source, primitive);
      if (twin && editableKeys.has(surfaceKey(twin.id, mirroredFace(face, primitive.kind)))) out.add(surfaceKey(twin.id, mirroredFace(face, primitive.kind)));
    }
    return out;
  };
  const applyItem = (item: SlotItem, keys: ReadonlySet<string>, thickness = customMm) => {
    if (!keys.size) return;
    const target = withMirrorFaces(keys);
    const assign = (label: string, values: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>) => run(label, draft => assignConstructionSurfaces(draft, target, values));
    switch (item.kind) {
      case 'armor': assign(`Assign ${thickness} mm armor`, { thicknessMm: thickness, material: thickness > 0 ? 'armor-steel' : 'steel', open: false }); break;
      case 'opening': assign('Open faces to sea', { open: true }); break;
      case 'paint': assign(`Paint ${item.name.toLowerCase()}`, { paint: item.id }); break;
    }
  };
  const applyScheme = (id: 'two-tone' | 'disruptive') => {
    const keys = [...editableKeys];
    if (id === 'two-tone') run('Apply two-tone paint', draft => { for (const face of ['top', 'bottom'] as const) assignConstructionSurfaces(draft, new Set(keys.filter(key => key.endsWith(`:${face}`))), { paint: face === 'top' ? 'deck-gray' : 'red-oxide' }); assignConstructionSurfaces(draft, new Set(keys.filter(key => !key.endsWith(':top') && !key.endsWith(':bottom'))), { paint: 'naval-gray' }); });
    else run('Apply disruptive paint', draft => { for (const primitive of draft.construction.primitives) assignConstructionSurfaces(draft, new Set(keys.filter(key => key.startsWith(`${primitive.id}:`) && !key.endsWith(':bottom'))), { paint: Math.abs(Math.floor(primitive.position[2] / 12)) % 2 ? 'sea-blue' : 'light-gray' }); });
  };
  const selectSlot = (item: SlotItem) => {
    if (item.kind === 'empty' || locked) return;
    setSlots(current => ({ ...current, [layer]: item.id })); setSizeOverride(undefined); setTip(undefined);
    const faceTools: BuilderTool[] = ['apply', 'area', 'eyedrop', 'opening', 'select'];
    switch (item.kind) {
      case 'shape': if (tool !== 'place' && tool !== 'fill') setTool('place'); break;
      case 'armor': case 'opening': case 'paint':
        if (surfaces.size) applyItem(item, surfaces); else if (!faceTools.includes(tool)) setTool('apply');
        break;
      case 'scheme': applyScheme(item.id); break;
      case 'tool': setTool(item.tool); break;
      case 'part': setTool(layer === 'internals' ? 'module' : 'place'); break;
    }
    setDrawer(false);
  };
  const pick = (hit?: BuilderPick) => {
    if (locked) return;
    if (!hit) { clearSelection(); return; }
    if (tool === 'measure') { setMeasure(current => !current || current.to ? { from: hit.point } : { ...current, to: hit.point }); return; }
    if (layer === 'armor' || layer === 'paint') {
      if (!hit.surface) { if (!hit.additive) setSurfaces(new Set()); if (hit.id && tool === 'select') choose(hit.id, hit.additive); else if (!hit.additive) setSelected(new Set()); return; }
      if (!compiled) { setNotice('Face editing resumes when this source has a compiled preview.'); return; }
      if (!editableKeys.has(hit.surface)) { setNotice('This fixed equipment support follows its fitting. Choose a hull face to edit.'); return; }
      const surface = editableSurfaces.find(entry => surfaceKey(entry.primitiveId, entry.face) === hit.surface)!;
      switch (tool) {
        case 'apply': if (active) applyItem(active, new Set([hit.surface])); break;
        case 'area': setSurfaces(current => { const next = hit.additive ? new Set(current) : new Set<string>(); for (const entry of editableSurfaces) if (entry.face === surface.face) next.add(surfaceKey(entry.primitiveId, entry.face)); return next; }); break;
        case 'eyedrop':
          if (layer === 'armor') { setCustomMm(surface.thicknessMm); setSlots(current => ({ ...current, armor: 'armor' })); setNotice(`Armor thickness set to ${surface.thicknessMm} mm from the picked face.`); }
          else { setSlots(current => ({ ...current, paint: surface.paint })); setNotice(`Paint slot set from the picked face.`); }
          setTool('apply'); break;
        case 'opening': run(surface.open ? 'Close skin' : 'Open faces to sea', draft => assignConstructionSurfaces(draft, withMirrorFaces(new Set([hit.surface!])), { open: !surface.open })); break;
        default: setSurfaces(current => { const next = hit.additive ? new Set(current) : new Set<string>(); if (next.has(hit.surface!)) next.delete(hit.surface!); else next.add(hit.surface!); return next; });
      }
      return;
    }
    if (layer === 'internals' && (tool === 'deck' || tool === 'bulkhead' || tool === 'longitudinal')) { const axis = tool === 'deck' ? 'y' : tool === 'bulkhead' ? 'z' : 'x'; addBoundary(axis, hit.placement[{ x: 0, y: 1, z: 2 }[axis]]); return; }
    if (layer === 'internals' && tool === 'merge') { if (hit.id && data.boundaries.some(wall => wall.id === hit.id)) run('Merge rooms', draft => removeConstructionSelection(draft, new Set([hit.id!]))); else setNotice('Click a deck or bulkhead to merge the rooms on either side.'); return; }
    if (tool === 'erase') { if (hit.id) erase(hit.id); return; }
    if (hit.id) choose(hit.id, hit.additive); else if (!hit.additive) clearSelection();
  };
  const boxSelect = (ids: string[], additive: boolean) => {
    if (locked) return;
    setTool('select'); setSurfaces(new Set());
    setSelected(current => new Set(additive ? [...current, ...ids] : ids));
  };
  const erase = (id: string) => removePieces(new Set([id]), 'Remove piece');
  const newDesign = async (kind: ConstructionStarter) => {
    setDesignsOpen(false);
    try { await editor.replace(freshConstruction(createStarterSource(props.catalog, kind), kind === 'blank'), null, false); switchLayer('hull'); setFitRequest(value => value + 1); }
    catch (cause) { fail(cause); }
  };
  const deleteDesign = async (designId: string, revisionId: string) => {
    const current = designId === source.id;
    setBusy('Deleting');
    try {
      await editor.removeDesign(designId, revisionId, createStarterSource(props.catalog, 'blank'));
      props.onDelete?.(designId); removeLocalShip(designId);
      if (current) { switchLayer('hull'); setFitRequest(value => value + 1); setDesignsOpen(false); }
      setNotice('Design deleted.');
    } finally { setBusy(''); }
  };
  const saveCopy = async () => {
    setDesignsOpen(false);
    const copy = structuredClone(source); copy.id = newConstructionId('design'); copy.revision = newConstructionId('revision'); copy.name = `${copy.name.slice(0, 150)} copy`;
    try { await editor.replace(copy, null, false, true); setNotice('A new local design now holds this draft.'); } catch (cause) { fail(cause); }
  };
  const close = async () => { setBusy('Saving'); try { await editor.flush(); await props.onClose(structuredClone(source), compiled); } catch (cause) { fail(cause); } finally { setBusy(''); } };
  const launch = async () => {
    if (!compiled?.definition || compiled.diagnostics.some(item => item.severity === 'error')) return;
    setBusy('Launching');
    try { try { await editor.flush(); } catch { /* App receives the immutable source even if local storage is unavailable. */ } await props.onLaunch(structuredClone(source), structuredClone(compiled)); }
    catch (cause) { fail(cause); } finally { setBusy(''); }
  };
  const suggest = async (selectedPart = false) => {
    if (!requestSuggestion || locked) return;
    const fittedKinds = new Set(data.equipment.map(instance => partOf(instance)?.kind));
    const ids = selectedPart ? (active?.kind === 'part' ? [active.id] : []) : catalog.equipment.filter(part => {
      if (part.placement !== 'internal' || fittedKinds.has(part.kind)) return false;
      fittedKinds.add(part.kind); return true;
    }).map(part => part.id).slice(0, 16);
    if (!ids.length) { setNotice(selectedPart ? 'Choose a fitting slot to place by suggestion.' : 'Every internal family is already fitted.'); return; }
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
  const applySuggestion = () => {
    if (!suggestion || source.revision !== suggestionRevision) return;
    run('Apply suggested layout', draft => { draft.construction.equipment = structuredClone(suggestion.source.construction.equipment); draft.construction.boundaries = structuredClone(suggestion.source.construction.boundaries); draft.construction.loads = structuredClone(suggestion.source.construction.loads); });
    setSuggestion(undefined);
  };
  /** Cut just under the main deck: the highest deck boundary, else the top of the largest hull piece. */
  const defaultSlice = () => {
    const decks = data.boundaries.filter(wall => wall.axis === 'y').map(wall => wall.offset);
    if (decks.length) return Math.max(...decks) - .25;
    const main = data.primitives.slice().sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    return main ? main.position[1] + main.size[1] / 2 - .25 : 0;
  };
  const switchLayer = (next: BuilderLayer) => {
    setLayer(next); setTool(DEFAULT_TOOL[next]); setSurfaces(new Set()); setDrawer(false); setQuery(''); setMeasure(undefined); setBearing(0); setTip(undefined);
    setSlice(current => current.auto ? { on: next === 'internals', y: next === 'internals' ? defaultSlice() : current.y, auto: true } : current);
  };
  const activateRail = (entry: RailEntry) => {
    if (locked) return;
    if (entry.kind === 'tool') { setTool(entry.id); if (entry.id === 'measure') { setMeasure(undefined); clearSelection(); } else if (entry.id !== 'select') setSurfaces(new Set()); }
    else if (entry.id === 'mirror') setMirror(value => !value);
    else if (entry.id === 'arc') setShowArcs(value => !value);
    else if (entry.id === 'rotate') rotate();
    else if (entry.id === 'suggest') void suggest(layer === 'fittings');
  };
  const cycleView = () => setView(current => VIEWS[(VIEWS.indexOf(current) + 1) % VIEWS.length]);
  const toggleSlice = () => setSlice(current => ({ on: !current.on, y: current.on ? current.y : defaultSlice(), auto: false }));
  const fit = () => setFitRequest(value => value + 1);

  // The latest render's closure handles keys, so a key right after a click sees the click's selection.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable=true]')) return;
      if (helpOpen) { if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); setHelpOpen(false); } return; }
      if (event.key === '?') { event.preventDefault(); setHelpOpen(true); return; }
      if (locked) return;
      const modifier = event.ctrlKey || event.metaKey, lower = event.key.toLowerCase();
      if (modifier && lower === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); return; }
      if (modifier && lower === 'y') { event.preventDefault(); editor.redo(); return; }
      if (freeformMode && !modifier) {
        if(event.key==='Escape'){setFreeformSession(undefined);event.preventDefault();return;}
        if(lower==='g'){cycleUnit();event.preventDefault();return;}
        if(lower==='o'){setPerspective(p=>!p);event.preventDefault();return;}
        if(lower!=='w' && event.key!=='Home') return;
      }
      // Without a selection, ⌘C and ⌘X stay with the browser so selected text still copies.
      if (modifier && lower === 'c') { if (!selected.size) return; event.preventDefault(); copy(event.shiftKey); return; }
      if (modifier && lower === 'x') { if (!selected.size) return; event.preventDefault(); remove(); return; }
      if (modifier && lower === 'a') { event.preventDefault(); setSelected(new Set([...data.primitives, ...data.equipment].map(part => part.id))); return; }
      if (modifier) return;
      if (event.key === 'Escape') {
        if (drawer) setDrawer(false); else if (designsOpen) setDesignsOpen(false); else if (suggestion) setSuggestion(undefined);
        else if (measure) setMeasure(undefined); else if (tool !== 'select') { setTool('select'); clearSelection(); } else clearSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return; }
      if (event.key === 'Home') { event.preventDefault(); fit(); return; }
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault(); const direction = event.key === 'PageUp' ? 1 : -1;
        if (event.shiftKey || (slice.on && !selected.size)) setSlice(current => ({ on: true, y: current.y + direction * .5, auto: false }));
        else if (selected.size) nudge([0, direction * gridStep, 0]);
        return;
      }
      if (event.key.startsWith('Arrow') && selected.size) {
        event.preventDefault(); const step = selectedPrimitives.length ? 1 : .25;
        nudge(event.key === 'ArrowLeft' ? [-step, 0, 0] : event.key === 'ArrowRight' ? [step, 0, 0] : event.key === 'ArrowUp' ? [0, 0, -step] : [0, 0, step]);
        return;
      }
      if (/^[1-9]$/.test(event.key)) { const item = palette.bar[Number(event.key) - 1]; if (item) selectSlot(item); return; }
      if (event.key === '0') { if (hasDrawer) { setDrawer(value => !value); setTip(undefined); } return; }
      if (lower === 'q') cycleView(); else if (lower === 's') toggleSlice(); else if (lower === 'w') setWarningsOpen(value => !value);
      else if (lower === 'r') rotate(); else if (lower === 'm') setMirror(value => !value); else if (lower === 'c') setShowCenters(value => !value);
      else { const entry = rail.find(entry => entry.key.toLowerCase() === lower); if (entry) activateRail(entry); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  // ---- derived display
  const warnings = warningEntries(compiled?.diagnostics);
  const blocks = warnings.filter(entry => entry.tone === 'block'), warns = warnings.filter(entry => entry.tone === 'warn');
  const rows = useMemo(() => ledgerRows(source, compiled, layer), [source, compiled, layer]);
  const masses = useMemo(() => massGroups(compiled), [compiled]);
  const totalMass = masses.reduce((sum, group) => sum + group.massKg, 0);
  const canLaunch = !!compiled?.definition && !blocks.length && !busy && editor.ready;
  const launchTitle = busy ? busy : editor.compiling ? 'Compiling this revision…' : blocks.length ? `${blocks.length} block${blocks.length === 1 ? '' : 's'} to fix before a trial` : compiled?.definition ? 'Launch a sea trial with this design' : 'Waiting for a compiled design';
  const saveTone = editor.saveState.status === 'saved' ? 'ok' : editor.saveState.status === 'error' ? 'bad' : 'saving';
  const saveText = editor.saveState.status === 'saved' ? 'Saved locally' : editor.saveState.status === 'error' ? 'Not saved · keep a backup' : 'Saving…';
  const arcs: BuilderArc[] = showArcs && layer === 'fittings' && compiled?.definition ? compiled.definition.mounts.map(mount => ({ position: mount.position, bearingDeg: mount.bearingDeg, traverseDeg: mount.traverseDeg ?? mount.weapon.traverseDeg, radius: ARC_RADIUS, color: '#86e4c5' })) : [];
  const proposed: BuilderProposal[] = suggestion && suggestionChanged ? suggestion.source.construction.equipment.filter(item => !data.equipment.some(existing => existing.id === item.id)).flatMap(item => { const part = partOf(item); return part ? [{ position: item.position, bearingDeg: item.bearingDeg, size: part.size, boundsCenter: part.boundsCenter }] : []; }) : [];
  const drawerItems = layer === 'fittings' && query ? palette.drawer.filter(item => item.kind === 'part' && `${item.part.name} ${FAMILY_NAMES[item.part.kind]} ${item.part.placement}`.toLowerCase().includes(query.toLowerCase())) : palette.drawer;
  const coords = useCallback((position: Vec3) => {
    const text = `x ${signed(position[0])} · y ${signed(position[1])} · z ${signed(position[2])}`;
    return piece?.kind === 'equipment' ? `${text} · ${piece.bearingDeg}°` : piece?.kind === 'boundary' ? `${BOUNDARY_NAMES[piece.axis]} at ${signed(position[{ x: 0, y: 1, z: 2 }[piece.axis]])} m` : text;
  }, [piece]);

  const tags: BuilderTag[] = [];
  const equipmentAnchor = (item: ConstructionEquipment): Vec3 => { const part = partOf(item), center = part ? rotateY(part.boundsCenter, bearingRadians(item.bearingDeg)) : [0, 0, 0]; return item.position.map((value, index) => value + center[index]) as Vec3; };
  // The cursor piece reads out above the palette instead of following the ghost; its size fields stay editable there.
  // The Armor layer keeps its millimetre field here, above the bar: a new value also assigns the selected faces.
  const armorItem = palette.drawer.find(item => item.kind === 'armor');
  const setThickness = (value: number) => { setCustomMm(value); setSlots(current => ({ ...current, armor: 'armor' })); if (armorItem && surfaces.size) applyItem(armorItem, surfaces, value); };
  const status: ReactNode = locked ? null : layer === 'armor' ? <>
    <b>Armor</b><NumberField value={customMm} min={0} max={1000} step={5} unit="mm" onChange={setThickness}/><span>{customMm > 0 ? 'armor steel' : 'structural skin, no armor'} · <kbd>1</kbd> assigns the selected faces</span>
  </> : !piece ? null : piece.kind === 'hull' && active?.kind === 'shape' ? <>
    <b>{active.name}</b><NumberField value={piece.size[0]} min={.25} max={500} step={1} onChange={value => setSizeOverride([value, piece.size[1], piece.size[2]])}/> × <NumberField value={piece.size[1]} min={.25} max={500} step={1} onChange={value => setSizeOverride([piece.size[0], value, piece.size[2]])}/> × <NumberField value={piece.size[2]} min={.25} max={500} step={1} onChange={value => setSizeOverride([piece.size[0], piece.size[1], value])}/> m<span>{piece.rotationDeg}°</span>
  </> : piece.kind === 'equipment' && active?.kind === 'part' ? <>
    <b>{active.part.name}</b><span>{active.part.placement} · bearing {piece.bearingDeg}°</span>
  </> : piece.kind === 'boundary' ? <><b>{BOUNDARY_NAMES[piece.axis]}</b><span>on the 1 m grid</span></> : null;
  if (!freeformMode && selectedPrimitives.length === 1 && !selectedEquipment.length) {
    const primitive = selectedPrimitives[0], mass = pieceMassKg(compiled, primitive.id);
    const size = (axis: number, value: number) => run('Resize hull piece', draft => { draft.construction.primitives.find(part => part.id === primitive.id)!.size[axis] = value; });
    const move = (axis: number, value: number) => { const delta: Vec3 = [0, 0, 0]; delta[axis] = snapCoordinate(value, .25) - primitive.position[axis]; nudge(delta); };
    tags.push({ key: `piece-${primitive.id}`, anchor: primitive.position, dx: 70, dy: -78, tone: 'mint', content: <>
      <b>{SHAPE_NAMES[primitive.kind]} <NumberField value={primitive.size[0]} min={.25} max={500} onChange={value => size(0, value)}/> × <NumberField value={primitive.size[1]} min={.25} max={500} onChange={value => size(1, value)}/> × <NumberField value={primitive.size[2]} min={.25} max={500} onChange={value => size(2, value)}/> m</b>
      {canEditVertices(primitive) && <button className="sb-edit-freeform" onClick={enterFreeform}>Freeform hull</button>}
      {mass !== undefined ? `plating ${formatTonnes(mass)} · ` : ''}<NumberField label="x" value={primitive.position[0]} min={-1000} max={1000} onChange={value => move(0, value)}/> <NumberField label="y" value={primitive.position[1]} min={-1000} max={1000} onChange={value => move(1, value)}/> <NumberField label="z" value={primitive.position[2]} min={-1000} max={1000} onChange={value => move(2, value)}/> · {primitive.rotationDeg}° <kbd>R</kbd> · <kbd>⌫</kbd> remove · <kbd>⌘C</kbd> copy
    </> });
  } else if (selectedEquipment.length === 1 && !selectedPrimitives.length) {
    const item = selectedEquipment[0], part = partOf(item), mass = equipmentMassKg(compiled, item.id);
    const link = (field: 'magazineId' | 'powerSourceId', kind: 'magazine' | 'engine', label: string) => <label> {label} <select className="sb-link" value={item[field] ?? ''} onChange={event => run('Connect equipment', draft => { const target = draft.construction.equipment.find(entry => entry.id === item.id)!; if (event.target.value) target[field] = event.target.value; else delete target[field]; })}>
      <option value="">automatic</option>{data.equipment.filter(entry => partOf(entry)?.kind === kind).map(entry => <option key={entry.id} value={entry.id}>{partOf(entry)?.name} · {entry.id.slice(-4)}</option>)}</select></label>;
    const move = (axis: number, value: number) => { const delta: Vec3 = [0, 0, 0]; delta[axis] = snapCoordinate(value, .25) - item.position[axis]; nudge(delta); };
    tags.push({ key: `part-${item.id}`, anchor: equipmentAnchor(item), dx: 82, dy: -92, tone: 'mint', content: <>
      <b>{part?.name ?? item.partId}</b>
      {mass !== undefined ? `${formatTonnes(mass)} · ` : ''}bearing <NumberField value={item.bearingDeg} min={0} max={360} step={15} unit="°" onChange={value => run('Set bearing', draft => { draft.construction.equipment.find(entry => entry.id === item.id)!.bearingDeg = normalizedBearing(value); })}/> · <NumberField label="x" value={item.position[0]} min={-1000} max={1000} step={.25} onChange={value => move(0, value)}/> <NumberField label="y" value={item.position[1]} min={-1000} max={1000} step={.25} onChange={value => move(1, value)}/> <NumberField label="z" value={item.position[2]} min={-1000} max={1000} step={.25} onChange={value => move(2, value)}/>
      {(part?.kind === 'gun' || part?.kind === 'torpedo-launcher') && link('magazineId', 'magazine', '· magazine')}{(part?.kind === 'funnel' || part?.kind === 'propeller') && link('powerSourceId', 'engine', '· power')} · <kbd>R</kbd> rotate · <kbd>⌫</kbd> remove
    </> });
  } else if (selected.size > 1) {
    const anchors = [...selectedPrimitives.map(part => part.position), ...selectedEquipment.map(equipmentAnchor)];
    const center = anchors.reduce((sum, point) => sum.map((value, index) => value + point[index] / anchors.length) as Vec3, [0, 0, 0] as Vec3);
    const mass = [...selectedPrimitives.map(part => pieceMassKg(compiled, part.id) ?? 0), ...selectedEquipment.map(part => equipmentMassKg(compiled, part.id) ?? 0)].reduce((sum, value) => sum + value, 0);
    tags.push({ key: 'group', anchor: center, dx: 70, dy: -78, tone: 'mint', content: <><b>{selected.size} selected</b>{mass ? `${formatTonnes(mass)} · ` : ''}<kbd>R</kbd> rotate · <kbd>⌘C</kbd> copy · <kbd>⇧⌘C</kbd> mirror copy · <kbd>⌫</kbd> remove</> });
  } else if (selectedBoundary) {
    const wall = selectedBoundary, axis = { x: 0, y: 1, z: 2 }[wall.axis], bounds = hullBounds(source);
    const anchor = (bounds ? bounds.min.map((value, index) => (value + bounds.max[index]) / 2) : [0, 0, 0]) as Vec3; anchor[axis] = wall.offset;
    tags.push({ key: `wall-${wall.id}`, anchor, dx: 70, dy: -70, tone: 'mint', content: <>
      <b>{BOUNDARY_NAMES[wall.axis]} at <NumberField value={wall.offset} min={-1000} max={1000} unit="m" onChange={value => run('Move boundary', draft => { draft.construction.boundaries.find(entry => entry.id === wall.id)!.offset = snapCoordinate(value, 1); })}/></b>
      plating <NumberField value={wall.thicknessMm} min={.1} max={1000} unit="mm" onChange={value => run('Armor boundary', draft => { draft.construction.boundaries.find(entry => entry.id === wall.id)!.thicknessMm = value; })}/> · <kbd>⌫</kbd> remove and merge rooms
    </> });
  }
  if (surfaces.size && (layer === 'armor' || layer === 'paint')) {
    const chosen = editableSurfaces.filter(surface => surfaces.has(surfaceKey(surface.primitiveId, surface.face)));
    const first = chosen[0], groups = armorInspectionGroups(chosen), area = chosen.reduce((sum, surface) => sum + surface.areaM2, 0);
    if (first) tags.push({ key: 'faces', anchor: surfaceCentroid(first), dx: 80, dy: -96, tone: 'mint', content: <>
      <b>{surfaces.size} face{surfaces.size === 1 ? '' : 's'} · {groups.length === 1 ? (layer === 'paint' ? `${groups[0].surface.paint.replace('-', ' ')}` : describeArmorGroup(groups[0].surface)) : `${groups.length} different ${layer === 'paint' ? 'paints' : 'thicknesses'}`}</b>
      {format(area, 0)} m² · {layer === 'paint' ? <><kbd>1</kbd>–<kbd>9</kbd> paint</> : <><kbd>1</kbd> assign {customMm} mm · <kbd>2</kbd> open</>} · <kbd>⇧</kbd>click adds · <kbd>Esc</kbd> clear
    </> });
  }
  const firstBlock = blocks.find(entry => entry.sourceId);
  if (firstBlock) {
    const target = data.primitives.find(part => part.id === firstBlock.sourceId) ?? data.equipment.find(part => part.id === firstBlock.sourceId);
    if (target) tags.push({ key: `block-${firstBlock.sourceId}`, anchor: 'partId' in target ? equipmentAnchor(target) : target.position, dx: -262, dy: -80, tone: 'bad', content: <><b>Blocks launch</b><span>{firstBlock.message}</span></> });
  }

  // Cards carry the piece, and hull cards its metre dimensions in the corner; the name and reading appear as a tooltip.
  const describe = (item: SlotItem): { title: string; detail: string } => {
    switch (item.kind) {
      case 'shape': return { title: item.name, detail: `${item.shape.size.map(metres).join(' × ')} m · ${SHAPE_NAMES[item.shape.kind].toLowerCase()}` };
      case 'armor': return { title: 'Armor', detail: `${customMm > 0 ? `${customMm} mm armor steel` : 'structural skin without armor'} · set the thickness above the bar` };
      case 'opening': return { title: 'Opening', detail: 'removes the skin so the face admits water' };
      case 'part': return { title: item.part.name, detail: `${item.note} · ${item.part.placement} · ${item.part.size.map(metres).join(' × ')} m` };
      case 'tool': case 'scheme': return { title: item.name, detail: item.note };
      case 'paint': return { title: item.name, detail: 'paint' };
      default: return { title: '', detail: '' };
    }
  };
  // Palette tips hang under the bar, which the readout above the cards leaves free; drawer tips stay above their card. Each names the card's key.
  const showTip = (item: SlotItem, target: HTMLElement) => {
    if (item.kind === 'empty') return;
    const rect = target.getBoundingClientRect(), below = !target.closest('.sb-drawer'), index = palette.bar.findIndex(entry => entry.id === item.id);
    setTip({ ...describe(item), x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below, key: index >= 0 ? String(index + 1) : undefined });
  };
  const hideTip = () => setTip(undefined);
  const face = (item: SlotItem) => {
    const image = imageFor(item);
    const picture = image ? <img src={image} alt="" draggable={false}/> : null;
    if (item.kind === 'shape') return <>{picture ?? <SlotGlyph item={item} customMm={customMm}/>}<i className="sb-dims">{dimensions(item.shape.size)}</i></>;
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
  // Keys already printed elsewhere (rail tools, the view bar's Q S C M Home, W on the warnings lead, ⌘Z on undo, ? on Keys) stay off it.
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
  const escape = drawer || designsOpen ? 'Close' : suggestion ? 'Dismiss layout' : measure ? 'End measure' : tool !== 'select' ? 'Select tool' : selected.size || surfaces.size ? 'Clear' : '';
  if (escape) acting.push({ keys: ['Esc'], label: escape });
  const chip = (hint: KeyHint) => <span key={hint.label} className="sb-key">{hint.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}{hint.label}</span>;

  return <main className={`shipbuilder ${freeformMode ? 'sb-freeform-mode' : ''}`} aria-label="Shipbuilder" data-layer={layer} data-drawer={drawer || undefined} aria-busy={!!busy}>
    <BuilderViewport perspective={perspective} freeform={freeformPrimitive && !locked ? {...freeformSettings,id:freeformPrimitive.id,onSelect:selection=>changeFreeformSettings({selection}),onCommit:commitFreeform} : undefined} source={source} result={result} catalog={catalog} selected={selected} selectedSurfaces={surfaces} view={view} display={DISPLAY[layer]} slice={slice.on ? slice.y : undefined}
      gridStep={gridStep} gesture={locked ? 'none' : gesture} pickTargets={layer === 'armor' || layer === 'paint' ? 'hull' : 'all'} moveTargets={locked || freeformMode ? 'none' : moveTargets} placementPiece={locked || freeformMode ? undefined : piece} placementMirror={mirrorPiece} highlightFaces={layer === 'armor' || layer === 'paint'} rooms={layer === 'internals'}
      showCenters={showCenters} arcs={arcs} proposed={proposed} measure={measure} tags={tags} coords={coords} status={status} fitRequest={fitRequest} onPick={pick} onStroke={placeAt} onBoxSelect={boxSelect} onErase={erase} onMove={movePieces} createModel={props.createModel}/>
    {freeformPrimitive && <FreeformToolbar primitive={freeformPrimitive} settings={freeformSettings} onChange={changeFreeformSettings} cycleUnit={cycleUnit} onCoordinate={setSelectionCoordinate}
      onView={v=>{setPerspective(false);setView(v);setFitRequest(n=>n+1);}} perspective={perspective} onProjection={()=>{setPerspective(p=>!p);}}
      onReset={()=>run('Reset hull edit',draft=>replaceVertexPrimitives(draft,[freeformSession!.baseline]))} onSplit={splitFreeform} onExit={()=>setFreeformSession(undefined)}/>}
    <header className="sb-top">
      <button className="sb-port" disabled={!!busy} onClick={() => void close()} title="Save and return to port"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1.5 3.5 6 8 10.5"/></svg>Port</button>
      <div className="sb-ship">
        <input disabled={locked} className="sb-name" aria-label="Design name" maxLength={160} value={source.name} onChange={event => run('Rename design', draft => { draft.name = event.target.value; })}/>
        <button className="sb-meta" aria-haspopup="menu" aria-expanded={designsOpen} onClick={() => setDesignsOpen(value => !value)}>{data.primitives.length} pieces · {data.equipment.length} fittings <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m2 3.5 3 3 3-3"/></svg></button>
        <i className={`sb-save ${saveTone}`} role="status">{saveText}</i>
        {designsOpen && <DesignsMenu disabled={locked} store={editor.store} currentId={source.id} refresh={editor.saveState.revision?.id} onClose={() => setDesignsOpen(false)} onNew={kind => void newDesign(kind)} onSaveCopy={() => void saveCopy()} onDelete={deleteDesign}
          onDownload={() => { downloadConstructionSource(JSON.stringify(source, null, 2), source.name); setDesignsOpen(false); }}
          onOpen={async (next, revision) => { setDesignsOpen(false); await editor.replace(next, revision, true); switchLayer('hull'); }} onRecover={async next => { setDesignsOpen(false); await editor.replace(next, null, false); switchLayer('hull'); }}/>}
      </div>
      <nav className="sb-tabs" role="tablist" aria-label="Layers">{BUILDER_LAYERS.map(entry => <button key={entry.id} role="tab" aria-selected={layer === entry.id} onClick={() => switchLayer(entry.id)}>{entry.name}</button>)}</nav>
      <div className="sb-actions">
        <button className="sb-undo" disabled={locked || !editor.history.past.length} onClick={editor.undo} title={editor.history.past.length ? `Undo ${editor.history.lastAction}` : 'Nothing to undo'}><kbd>⌘Z</kbd>{editor.history.past.length}</button>
        <button className="sb-undo" disabled={locked || !editor.history.future.length} onClick={editor.redo} title="Redo (⇧⌘Z)"><kbd>⇧⌘Z</kbd>{editor.history.future.length}</button>
        <button className="sb-cmd" disabled={!canLaunch} title={launchTitle} onClick={() => void launch()}>{busy ? `${busy.toUpperCase()}…` : editor.saveState.status === 'error' ? 'TRIAL DRAFT' : 'SEA TRIALS'}<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5"/></svg></button>
      </div>
    </header>
    <div className="sb-left">
      <div className="sb-warn">
        <button className={`lead ${blocks.length ? 'bad' : ''}`} aria-expanded={warningsOpen} onClick={() => setWarningsOpen(value => !value)}>
          {editor.compiling ? 'Compiling · ' : !compiled ? 'Draft · ' : ''}{blocks.length} block{blocks.length === 1 ? '' : 's'} · {warns.length} warning{warns.length === 1 ? '' : 's'} <kbd>W</kbd>
        </button>
        {editor.compileError && <div className="row bad"><i className="sb-dot block"/><span>{editor.compileError}</span><button onClick={editor.retryCompile}>Retry</button></div>}
        {editor.error && <div className="row bad" role="alert"><i className="sb-dot block"/><span>{editor.error}</span>
          <button onClick={() => downloadConstructionSource(JSON.stringify(source, null, 2), source.name)}>Download</button><button onClick={() => void editor.retrySave()?.catch(fail)}>Retry save</button><button onClick={() => void saveCopy()}>Save a copy</button><button onClick={() => editor.setError('')}>Dismiss</button></div>}
        {warningsOpen && <div className="rows">{warnings.map((entry, index) => <button key={`${entry.code}-${index}`} className={`row ${entry.tone === 'note' ? 'note' : ''}`} title={entry.sourceId ? 'Select the affected part' : entry.code} onClick={() => { if (entry.sourceId) { choose(entry.sourceId); if (data.equipment.some(part => part.id === entry.sourceId) && layer !== 'fittings' && layer !== 'internals') switchLayer(partOf(data.equipment.find(part => part.id === entry.sourceId)!)?.placement === 'internal' ? 'internals' : 'fittings'); } }}><i className={`sb-dot ${entry.tone}`}/><span>{entry.message}</span></button>)}</div>}
        {suggestion && <div className="row" role="status"><i className={`sb-dot ${suggestion.diagnostics.some(item => item.severity === 'error') ? 'block' : 'ok'}`}/>
          <span>{suggestion.diagnostics.map(item => item.message).join(' · ') || (suggestionChanged ? 'A layout is ready; the dashed outlines show where it adds equipment.' : 'The requested equipment is already fitted.')}</span>
          {suggestionChanged && !suggestion.diagnostics.some(item => item.severity === 'error') && <button disabled={source.revision !== suggestionRevision} onClick={applySuggestion}>Apply <kbd>⏎</kbd></button>}<button onClick={() => setSuggestion(undefined)}>Dismiss</button></div>}
        {notice && <div className="row note" role="status"><i className="sb-dot note"/><span>{notice}</span></div>}
      </div>
      <div className="sb-rail" role="toolbar" aria-label="Tools">{rail.filter(entry => !freeformMode || entry.id !== 'mirror').map(entry => <button key={entry.id} className={entry.kind} disabled={locked} aria-pressed={entry.kind === 'tool' ? tool === entry.id : entry.kind === 'toggle' ? (entry.id === 'mirror' ? mirror : showArcs) : undefined} title={`${entry.name} (${entry.key})`} onClick={() => activateRail(entry)}><ToolGlyph name={entry.glyph}/><span>{entry.name}</span><kbd>{entry.key}</kbd></button>)}
        {layer==='hull' && <button aria-pressed={freeformMode} disabled={locked || selected.size!==1 || !selectedPrimitives[0] || !canEditVertices(selectedPrimitives[0])} onClick={freeformMode?()=>setFreeformSession(undefined):enterFreeform} title="Select one cube or freeform hull to edit vertices, edges and faces"><ToolGlyph name="Select"/><span>Freeform</span></button>}
        <button className="help" aria-haspopup="dialog" aria-expanded={helpOpen} title="Controls and hotkeys (?)" onClick={() => setHelpOpen(value => !value)}><ToolGlyph name="Keys"/><span>Keys</span><kbd>?</kbd></button></div>
    </div>
    <aside className="sb-ledger" aria-label="Ledger">
      <h4>Ledger{editor.compiling && <span>compiling…</span>}</h4>
      {rows.map(row => <div key={row.label} className={`row ${row.tone ?? ''}`}><span>{row.label}</span><b>{row.value}</b></div>)}
      {totalMass > 0 && <><div className="sb-massbar" aria-hidden="true">{masses.filter(group => group.massKg > 0).map(group => <i key={group.name} style={{ width: `${(100 * group.massKg / totalMass).toFixed(1)}%`, background: group.color }}/>)}</div>
        <div className="sb-masskey">{masses.filter(group => group.massKg > 0).map(group => <span key={group.name} style={{ display: 'contents' }}><i style={{ background: group.color }}/><span>{group.name}</span><b>{formatTonnes(group.massKg, group.massKg < 1e5 ? 1 : 0)}</b></span>)}</div></>}
      {layer === 'armor' && <div className="sb-armor-groups" aria-label="Hull armor coverage">{armorInspectionGroups(editableSurfaces).sort((a, b) => b.areaM2 - a.areaM2).slice(0, 6).map(group => <p key={group.id}>{describeArmorGroup(group.surface)}<small>{format(group.areaM2, 0)} m² · {group.faces.size} face{group.faces.size === 1 ? '' : 's'}</small></p>)}</div>}
    </aside>
    {drawer && <div className="sb-drawer" aria-label={`All ${drawerName}`}>
      <div className="sb-drawer-head"><span className="sb-lead">All {drawerName}</span>
        {layer === 'fittings' && <label className="sb-search">Find <input autoFocus type="search" aria-label="Find a fitting" placeholder="gun, screw, funnel…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDrawer(false); setTip(undefined); } }}/></label>}
        <button className="sb-drawer-close" aria-label="Close" onClick={() => { setDrawer(false); setTip(undefined); }}>×</button></div>
      <div className="sb-drawer-grid" role="listbox">{drawerItems.map(item => slot(item))}{!drawerItems.length && <span className="sb-lead">No fitting matches</span>}</div>
    </div>}
    <div className="sb-hotbar" role="toolbar" aria-label="Palette">
      {palette.bar.map(item => slot(item))}
      {hasDrawer ? <button className="sb-slot more" aria-expanded={drawer} aria-label={`All ${drawerName}`} onPointerEnter={event => { const rect = event.currentTarget.getBoundingClientRect(); setTip({ title: `All ${drawerName}`, detail: drawer ? 'close the full selection' : 'open the full selection', x: rect.left + rect.width / 2, y: rect.bottom, below: true, key: '0' }); }} onPointerLeave={hideTip} onClick={() => { setDrawer(value => !value); setTip(undefined); }}>…</button> : null}
    </div>
    <div className="sb-keys" aria-label="Hotkeys">
      {acting.length > 0 && <div className="sb-keys-row acting">{acting.map(chip)}</div>}
      <div className="sb-keys-row">{standing.map(chip)}</div>
    </div>
    {tip && <div className={`sb-tip ${tip.below ? 'below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}><b>{tip.title}</b>{tip.detail}{tip.key && <kbd>{tip.key}</kbd>}</div>}
    <div className="sb-viewbar">
      <button onClick={cycleView} title="Cycle the view (Q)">View <b>{VIEW_NAMES[view]}</b><kbd>Q</kbd></button>
      <button onClick={toggleSlice} title="Cut the ship above a height (S)">Slice <b>{slice.on ? `${signed(slice.y)} m` : 'Off'}</b><kbd>S</kbd></button>
      <button aria-pressed={showCenters} onClick={() => setShowCenters(value => !value)} title="Show center of gravity (mass) and center of buoyancy markers (C)">Centers <b>{showCenters ? 'On' : 'Off'}</b><kbd>C</kbd></button>
      <span title="Placement snaps to the face under the pointer">Snap <b>{gridStep === 1 ? '1 m' : '¼ m'}</b></span>
      <button aria-pressed={mirror} onClick={() => setMirror(value => !value)} title="Mirror placements across the centerline (M)">Mirror <b>{mirror ? 'On' : 'Off'}</b><kbd>M</kbd></button>
      <button onClick={fit} title="Frame the ship (Home)">Fit<kbd>Home</kbd></button>
    </div>
    {!data.primitives.length && <div className="sb-empty"><b>This design needs a starting block</b><button disabled={locked} onClick={() => run('Add starting block', draft => { draft.construction.primitives.push(startingHullBlock()); })}>Add a hull block</button> to keep building.</div>}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)}/>}
  </main>;
}

export { attachmentOffset };
