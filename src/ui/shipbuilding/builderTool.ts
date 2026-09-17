import { integrateConstructionMagazines, setBarbetteHeight } from '../../ships/constructionArmament';
import type { ConstructionBoundary, ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, ConstructionSurface, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_FACES, CONSTRUCTION_LIMITS, copyConstructionSelection, editableConstructionSurfaces, mirroredEquipment, mirroredFace, mirroredPrimitive, newConstructionId, surfaceKey, type ConstructionFace } from '../../ships/constructionEditor';
import { constructionDiffCommands, type ConstructionCommand } from '../../ships/constructionCommands';
import type { ConstructionRevisionOwner, ConstructionSubmission } from '../../ships/constructionRevisionOwner';
import { canEditVertices, freeformEdit, selectionCenter, splitVertexPrimitive, VERTEX_UNITS, type HullSelection, type MirrorAxes } from '../../ships/constructionVertex';
import { pathProblem } from '../../ships/constructionPaths';
import { BUILDER_RAIL, DEFAULT_TOOL, paletteFor, type BuilderLayer, type BuilderToolId, type RailEntry, type SlotItem } from './builderLayers';
import { appendPathPoint, pathEquipment } from './pathDrawing';
import { mirrorTwin, offCenterline } from './placement';
import { blockMoveConstraint } from './blockMovement';
import { internalSelectionIds } from './internalSelection';
import { customHullPrimitive, makeHull } from '../../ships/customHullModel';
import { normalizedBearing, snapCoordinate } from './editorNumbers';
import type { BuilderArc, BuilderDisplay, BuilderGesture, BuilderMoveTargets, BuilderPick, BuilderPlacement, BuilderPointerEvent, BuilderProposal, BuilderScene, BuilderView } from './builderScene';

/** Freeform hull editing options: mirror planes, move step, snapping to nearby corners and the split controls. */
export interface FreeformSettings { axes: MirrorAxes; unit: number; snap: boolean; splitAxis: number; count: number; selection: HullSelection }

/** The tool's own state: which layer and tool are active, what is selected, what the cursor carries. */
export interface BuilderToolState {
  layer: BuilderLayer; tool: BuilderToolId;
  slots: Record<BuilderLayer, string>;
  customMm: number; sizeOverride?: Vec3; bearing: number;
  pathPoints: Vec3[]; ropeSlack: number;
  mirror: boolean; showArcs: boolean; showCenters: boolean;
  /** Placement and movement steps in metres, remembered separately for hull pieces and fittings. */
  snapSteps: { hull: number; equipment: number };
  freeform?: { designId: string; baseline: ConstructionPrimitive };
  freeformSettings: FreeformSettings;
  view: BuilderView; perspective: boolean; slice: { on: boolean; y: number; auto: boolean }; fitRequest: number;
  selected: ReadonlySet<string>; surfaces: ReadonlySet<string>;
  measure?: { from: Vec3; to?: Vec3 };
  notice: string;
  suggestion?: { proposal: ConstructionSuggestion; revision: string };
}

/** The revision door the tool submits to; `ConstructionRevisionOwner` is the adapter. */
export type BuilderRevisionDoor = Pick<ConstructionRevisionOwner, 'source' | 'refusal' | 'locked' | 'submit' | 'undo' | 'redo' | 'setError' | 'setBusy' | 'subscribe'>;
export interface BuilderToolContext {
  /** The design's exact retained catalog; empty equipment while it loads. */
  catalog(): ConstructionCatalog;
  /** The compile of exactly the current revision, or undefined. */
  compiled(): ConstructionResult | undefined;
  suggest?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
  /** Stable ID generator; tests inject a counter. */
  newId?(prefix: string): string;
}
/** Chrome the tool does not own but its keys reach: the drawer, menus and the warnings strip. */
export interface BuilderChrome {
  /** Escape closes an open drawer or menu before the tool acts; true when something closed. */
  dismiss(): boolean;
  toggleDrawer(): void;
  toggleWarnings(): void;
  /** A card chosen by key closes the drawer and its tooltip. */
  slotChosen(): void;
}
export interface BuilderKey { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat: boolean; preventDefault(): void }

export const BUILDER_DISPLAY: Record<BuilderLayer, BuilderDisplay> = { hull: 'paint', armor: 'armor', internals: 'internals', fittings: 'paint', paint: 'paint' };
export const BOUNDARY_NAMES: Record<ConstructionBoundary['axis'], string> = { y: 'Deck', z: 'Bulkhead', x: 'Split' };
export const BUILDER_VIEWS: BuilderView[] = ['orbit', 'top', 'side', 'bow'];
export const SNAP_STEPS = [.25, .5, 1, 2, 5];
const ARC_RADIUS = 12;
const LIMITS = CONSTRUCTION_LIMITS;
const AXIS = { x: 0, y: 1, z: 2 } as const;
const metres = (value: number) => Number(value.toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${metres(Math.abs(value))}`;
type SurfaceValues = Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>;

/** The shipbuilder's tool: layer, tool, selection, cursor piece, gestures and readiness in one
 * plain module. Pointer events arrive with their targets already raycast; every edit leaves as a
 * command batch through the revision door, which answers with an accepted or refused submission.
 * Nothing here imports React or three.js. `scene()` is the render description the viewport draws. */
export class BuilderTool {
  private state: BuilderToolState;
  private listeners = new Set<() => void>();
  private lastSourceId: string;
  private lastRevision: string;
  private suggestionRequest?: AbortController;
  private readonly unsubscribe: () => void;
  private paletteCache?: { layer: BuilderLayer; catalog: ConstructionCatalog; palette: ReturnType<typeof paletteFor> };
  private surfaceCache?: { source: ConstructionSource; compiled?: ConstructionResult; surfaces: ConstructionSurface[]; keys: Set<string> };
  private pieceCache?: { key: string; piece?: BuilderPlacement };
  private internalCache?: { source: ConstructionSource; catalog: ConstructionCatalog; ids: Set<string> };
  private mirrorCache?: { key: string; piece?: BuilderPlacement };

  constructor(private readonly door: BuilderRevisionDoor, private readonly context: BuilderToolContext, initial: Partial<BuilderToolState> = {}) {
    // A design that starts as one custom hull opens with it selected, ready to shape or move.
    const customHull = door.source.construction.primitives.find(part => part.kind === 'custom-hull');
    this.state = {
      layer: 'hull', tool: customHull ? 'select' : 'place', slots: { hull: 'cube', armor: 'armor', internals: 'deck', fittings: '', paint: 'naval-gray' },
      customMm: 50, bearing: 0, pathPoints: [], ropeSlack: 0, mirror: true, showArcs: false, showCenters: true, snapSteps: { hull: 1, equipment: .25 },
      freeformSettings: { axes: [true, false, false], unit: .2, snap: false, splitAxis: 2, count: 4, selection: { mode: 'vertex', index: 1 } },
      view: 'orbit', perspective: true, slice: { on: false, y: 0, auto: true }, fitRequest: 0,
      selected: new Set(customHull ? [customHull.id] : []), surfaces: new Set(), notice: '', ...initial,
    };
    this.lastSourceId = door.source.id; this.lastRevision = door.source.revision;
    this.unsubscribe = door.subscribe(this.observe);
  }
  dispose() { this.unsubscribe(); this.suggestionRequest?.abort(); this.suggestionRequest = undefined; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  // ---- the world the tool reads
  get source() { return this.door.source; }
  private get data() { return this.door.source.construction; }
  get catalog() { return this.context.catalog(); }
  get compiled() { return this.context.compiled(); }
  get locked() { return this.door.locked; }
  private newId(prefix: string) { return this.context.newId ? this.context.newId(prefix) : newConstructionId(prefix); }

  // ---- state changes
  private update(patch: Partial<BuilderToolState>) {
    const previous = this.state, next = { ...previous, ...patch };
    this.state = next;
    // A pending route belongs to one part on one layer and tool of one design.
    if (next.pathPoints.length && (next.layer !== previous.layer || next.tool !== previous.tool || this.pathPartOf(next)?.id !== this.pathPartOf(previous)?.id)) this.state = { ...next, pathPoints: [] };
    this.reconcile();
    for (const listener of this.listeners) listener();
  }
  /** Freeform editing lasts while its block stays the single selection of the Hull layer's Select tool. */
  private reconcile() {
    if (this.state.freeform && !this.freeformPrimitive) this.state = { ...this.state, freeform: undefined };
  }
  /** The revision owner changed: a new design clears selections and proposals; a new revision retires a pending layout request. */
  private observe = () => {
    const source = this.door.source;
    let patch: Partial<BuilderToolState> | undefined;
    if (source.id !== this.lastSourceId) {
      const hull = source.construction.primitives.find(part => part.kind === 'custom-hull');
      patch = { selected: new Set(hull && this.state.layer !== 'internals' ? [hull.id] : []), surfaces: new Set(), suggestion: undefined, measure: undefined, pathPoints: [], ...(hull ? { tool: 'select' as const } : {}) };
    }
    if (source.revision !== this.lastRevision) { this.suggestionRequest?.abort(); this.suggestionRequest = undefined; }
    this.lastSourceId = source.id; this.lastRevision = source.revision;
    if (patch) this.update(patch);
    else { const before = this.state; this.reconcile(); if (this.state !== before) for (const listener of this.listeners) listener(); }
  };

  // ---- derived
  get palette() {
    const layer = this.state.layer, catalog = this.catalog;
    if (!this.paletteCache || this.paletteCache.layer !== layer || this.paletteCache.catalog !== catalog) this.paletteCache = { layer, catalog, palette: paletteFor(layer, catalog) };
    return this.paletteCache.palette;
  }
  get active(): SlotItem | undefined { return this.palette.drawer.find(item => item.id === this.state.slots[this.state.layer]) ?? this.palette.drawer[0]; }
  get drawerName() { return this.state.layer === 'fittings' ? 'fittings' : this.state.layer === 'hull' ? 'shapes' : 'items'; }
  get hasDrawer() { return this.palette.drawer.length > this.palette.bar.filter(item => item.kind !== 'empty').length || this.state.layer === 'fittings'; }
  private pathPartOf(state: BuilderToolState): ConstructionEquipmentPart | undefined {
    if (state.layer !== 'fittings' || state.tool !== 'place') return undefined;
    const palette = state.layer === this.state.layer ? this.palette : paletteFor(state.layer, this.catalog);
    const active = palette.drawer.find(item => item.id === state.slots[state.layer]) ?? palette.drawer[0];
    return active?.kind === 'part' && active.part.path ? active.part : undefined;
  }
  /** The connected-route part being drawn, when the Fittings Place tool holds a railing, rope or chain. */
  get pathPart() { return this.pathPartOf(this.state); }
  get rail(): RailEntry[] { return BUILDER_RAIL[this.state.layer]; }
  get selectedPrimitives() { return this.data.primitives.filter(part => this.state.selected.has(part.id)); }
  get selectedEquipment() { return this.data.equipment.filter(part => this.state.selected.has(part.id)); }
  get selectedBoundary() { return this.data.boundaries.find(wall => this.state.selected.has(wall.id)); }
  get freeformPrimitive(): ConstructionPrimitive | undefined {
    const { freeform, layer, tool, selected } = this.state;
    if (!freeform || freeform.designId !== this.source.id || layer !== 'hull' || tool !== 'select' || selected.size !== 1 || !selected.has(freeform.baseline.id)) return undefined;
    return this.data.primitives.find(part => part.id === freeform.baseline.id && canEditVertices(part));
  }
  get freeformMode() { return !!this.freeformPrimitive; }
  partOf = (instance: ConstructionEquipment) => this.catalog.equipment.find(part => part.id === instance.partId);
  private get surfaceState() {
    const source = this.source, compiled = this.compiled;
    if (!this.surfaceCache || this.surfaceCache.source !== source || this.surfaceCache.compiled !== compiled) {
      const surfaces = editableConstructionSurfaces(source, compiled?.surfaces ?? []);
      this.surfaceCache = { source, compiled, surfaces, keys: new Set(surfaces.map(surface => surfaceKey(surface.primitiveId, surface.face))) };
    }
    return this.surfaceCache;
  }
  /** Native hull faces that accept armor, paint and openings: fixed equipment supports are excluded. */
  get editableSurfaces() { return this.surfaceState.surfaces; }
  get editableKeys(): ReadonlySet<string> { return this.surfaceState.keys; }
  /** Fittings and modules snap on the equipment step; everything else on the hull step. */
  get snapKind(): 'hull' | 'equipment' { const { layer, tool } = this.state; return layer === 'fittings' || (layer === 'internals' && tool === 'module') ? 'equipment' : 'hull'; }
  get gridStep() { return this.state.snapSteps[this.snapKind]; }
  /** The view bar's Snap control: 0.25 → 0.5 → 1 → 2 → 5 m for the current kind. */
  cycleSnap = () => { const kind = this.snapKind, steps = this.state.snapSteps; this.update({ snapSteps: { ...steps, [kind]: SNAP_STEPS[(SNAP_STEPS.indexOf(steps[kind]) + 1) % SNAP_STEPS.length] } }); };
  get display() { return BUILDER_DISPLAY[this.state.layer]; }
  get faceLayer() { return this.state.layer === 'armor' || this.state.layer === 'paint'; }
  /** The cursor piece: the shape, fitting or boundary a click would place. Identity is stable while its description is. */
  get piece(): BuilderPlacement | undefined {
    const { layer, tool, sizeOverride, bearing } = this.state, active = this.active, catalog = this.catalog;
    let piece: BuilderPlacement | undefined;
    if (layer === 'hull' && (tool === 'place' || tool === 'fill') && active?.kind === 'shape') piece = { kind: 'hull', shape: active.shape.kind, size: sizeOverride ?? active.shape.size, rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90) };
    else if (((layer === 'fittings' && tool === 'place') || (layer === 'internals' && tool === 'module')) && active?.kind === 'part' && !active.part.path) {
      const gun = active.part.gunPartId ? catalog.weapons.parts.find(gun => gun.id === active.part.gunPartId) : undefined;
      piece = { kind: 'equipment', partId: active.part.id, size: active.part.size, boundsCenter: active.part.boundsCenter, bearingDeg: normalizedBearing(bearing), sockets: active.part.sockets, arc: gun ? { traverseDeg: gun.traverseDeg, radius: ARC_RADIUS } : undefined, inset: active.part.placement === 'internal' ? this.data.defaultThicknessMm / 1000 : undefined };
    } else if (layer === 'internals' && (tool === 'deck' || tool === 'bulkhead' || tool === 'longitudinal')) piece = { kind: 'boundary', axis: tool === 'deck' ? 'y' : tool === 'bulkhead' ? 'z' : 'x', thicknessMm: 10 };
    const key = JSON.stringify(piece ?? null);
    if (!this.pieceCache || this.pieceCache.key !== key) this.pieceCache = { key, piece };
    return this.pieceCache.piece;
  }
  get mirrorPiece(): BuilderPlacement | undefined {
    const piece = this.piece;
    let twin: BuilderPlacement | undefined;
    if (this.state.mirror && piece) {
      if (piece.kind === 'hull') { const mirrored = mirroredPrimitive({ id: '', kind: piece.shape, size: piece.size, position: [1, 0, 0], rotationDeg: piece.rotationDeg }); twin = { kind: 'hull', shape: mirrored.kind, size: mirrored.size, rotationDeg: mirrored.rotationDeg }; }
      else if (piece.kind === 'equipment') twin = { ...piece, bearingDeg: normalizedBearing(-piece.bearingDeg), arc: undefined };
    }
    const key = JSON.stringify(twin ?? null);
    if (!this.mirrorCache || this.mirrorCache.key !== key) this.mirrorCache = { key, piece: twin };
    return this.mirrorCache.piece;
  }
  get gesture(): BuilderGesture { const { tool } = this.state; return this.pathPart ? 'none' : tool === 'fill' ? 'fill' : tool === 'place' || tool === 'module' ? 'stroke' : 'none'; }
  /** Select drags any piece, fitting or wall; placing fittings or modules still drags the ones already fitted. Face layers never move geometry. */
  get moveTargets(): BuilderMoveTargets {
    const { layer, tool } = this.state;
    return this.pathPart ? 'none' : layer === 'armor' || layer === 'paint' ? 'none' : tool === 'select' ? 'all' : (layer === 'fittings' && tool === 'place') || tool === 'module' ? 'equipment' : 'none';
  }
  get pickTargets(): BuilderScene['pickTargets'] { return this.state.layer === 'internals' ? 'internals' : this.faceLayer ? 'hull' : 'all'; }
  /** Internals edits packages, weapon-owned ammunition through its weapon, and room boundaries. */
  get internalIds(): ReadonlySet<string> {
    const source = this.source, catalog = this.catalog;
    if (!this.internalCache || this.internalCache.source !== source || this.internalCache.catalog !== catalog) this.internalCache = { source, catalog, ids: internalSelectionIds(source, catalog) };
    return this.internalCache.ids;
  }
  selectable = (id: string) => this.state.layer !== 'internals' || this.internalIds.has(id);
  get suggestionChanged() {
    const suggestion = this.state.suggestion?.proposal;
    return !!suggestion && JSON.stringify([this.data.equipment, this.data.boundaries, this.data.loads]) !== JSON.stringify([suggestion.source.construction.equipment, suggestion.source.construction.boundaries, suggestion.source.construction.loads]);
  }
  get proposed(): BuilderProposal[] {
    const suggestion = this.state.suggestion?.proposal;
    if (!suggestion || !this.suggestionChanged) return [];
    return suggestion.source.construction.equipment.filter(item => !this.data.equipment.some(existing => existing.id === item.id)).flatMap(item => { const part = this.partOf(item); return part ? [{ position: item.position, bearingDeg: item.bearingDeg, size: part.size, boundsCenter: part.boundsCenter }] : []; });
  }
  get arcs(): BuilderArc[] {
    const compiled = this.compiled;
    return this.state.showArcs && this.state.layer === 'fittings' && compiled?.definition ? compiled.definition.mounts.map(mount => ({ position: mount.position, bearingDeg: mount.bearingDeg, traverseDeg: mount.traverseDeg ?? mount.weapon.traverseDeg, radius: ARC_RADIUS, color: '#86e4c5' })) : [];
  }
  /** The ghost's readout: its cell, plus a fitting's bearing or a boundary's offset. */
  coords = (position: Vec3): string => {
    const piece = this.piece, text = `x ${signed(position[0])} · y ${signed(position[1])} · z ${signed(position[2])}`;
    return piece?.kind === 'equipment' ? `${text} · ${piece.bearingDeg}°` : piece?.kind === 'boundary' ? `${BOUNDARY_NAMES[piece.axis]} at ${signed(position[AXIS[piece.axis]])} m` : text;
  };
  /** What the viewport draws. `retained` is the last accepted compile, kept through recompiles. */
  scene(retained: ConstructionResult | undefined): BuilderScene {
    const s = this.state, locked = this.locked, freeformMode = this.freeformMode, pathPart = this.pathPart, freeformPrimitive = this.freeformPrimitive;
    return {
      source: this.source, result: retained, current: this.compiled, catalog: this.catalog,
      selected: s.selected, selectedSurfaces: s.surfaces, view: s.view, perspective: s.perspective, display: this.display, slice: s.slice.on ? s.slice.y : undefined, fitRequest: s.fitRequest,
      gridStep: this.gridStep, gesture: locked ? 'none' : this.gesture, pickTargets: this.pickTargets, moveTargets: locked || freeformMode ? 'none' : this.moveTargets,
      placementPiece: locked || freeformMode ? undefined : this.piece, placementMirror: this.mirrorPiece,
      highlightFaces: this.faceLayer, rooms: s.layer === 'internals', showCenters: s.showCenters, arcs: this.arcs, proposed: this.proposed, measure: s.measure,
      pathDraft: !locked && pathPart ? { part: pathPart, points: s.pathPoints, slackM: pathPart.path?.kind === 'rope' ? s.ropeSlack : 0, mirror: s.mirror } : undefined,
      freeform: freeformPrimitive && !locked ? { ...s.freeformSettings, id: freeformPrimitive.id, onSelect: selection => this.changeFreeformSettings({ selection }), onCommit: this.commitFreeform } : undefined,
    };
  }

  // ---- the edit door
  /** Submit one labelled batch; a fresh edit also clears the last notice. */
  run = (label: string, commands: ConstructionCommand[]): ConstructionSubmission => {
    const outcome = this.door.submit(label, commands);
    if (outcome.accepted && this.state.notice) this.update({ notice: '' });
    return outcome;
  };
  /** Raising moves the gunhouse while preserving its deck connection and low magazine. */
  raiseTurrets = (ids: string[], height: (current: number) => number): ConstructionSubmission => {
    const next = structuredClone(this.source);
    if (next.construction.version === 1) integrateConstructionMagazines(next, this.catalog);
    for (const item of next.construction.equipment) {
      if (ids.includes(item.id) && this.partOf(item)?.kind === 'gun') setBarbetteHeight(item, height(item.gun?.barbetteHeightM ?? 0));
    }
    return this.run('Raise turrets', constructionDiffCommands(this.source, next));
  };
  private command(label: string, commands: ConstructionCommand[]): ConstructionSubmission { return this.door.submit(label, commands); }
  private refused(): ConstructionSubmission | undefined { const refusal = this.door.refusal; return refusal && { accepted: false, ...refusal }; }
  private fail = (cause: unknown) => this.door.setError(cause instanceof Error ? cause.message : String(cause));
  notify = (notice: string) => this.update({ notice });
  undo = () => { if (!this.locked) this.door.undo(); };
  redo = () => { if (!this.locked) this.door.redo(); };
  /** Face assignments as complete records, created from the skin default exactly as the editor helpers do. */
  private surfaceCommands(keys: ReadonlySet<string>, values: SurfaceValues): ConstructionCommand[] {
    const commands: ConstructionCommand[] = [];
    for (const primitive of this.data.primitives) for (const face of CONSTRUCTION_FACES) {
      if (!keys.has(surfaceKey(primitive.id, face))) continue;
      const existing = this.data.surfaces.find(surface => surface.primitiveId === primitive.id && surface.face === face);
      commands.push({ op: 'surface', value: { ...(existing ?? { primitiveId: primitive.id, face, thicknessMm: this.data.defaultThicknessMm, material: 'steel', paint: 'naval-gray' }), ...values } });
    }
    return commands;
  }

  // ---- layer, tool and cards
  setTool = (tool: BuilderToolId) => this.update({ tool });
  /** Cut just under the main deck: the highest deck boundary, else the top of the largest hull piece. */
  defaultSlice() {
    const decks = this.data.boundaries.filter(wall => wall.axis === 'y').map(wall => wall.offset);
    if (decks.length) return Math.max(...decks) - .25;
    const main = this.data.primitives.slice().sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
    return main ? main.position[1] + main.size[1] / 2 - .25 : 0;
  }
  switchLayer = (next: BuilderLayer) => {
    const slice = this.state.slice;
    this.update({ layer: next, tool: DEFAULT_TOOL[next], surfaces: new Set(), measure: undefined, bearing: 0,
      ...(next === 'internals' ? { selected: new Set([...this.state.selected].filter(id => this.internalIds.has(id))) } : {}),
      slice: slice.auto ? { on: next === 'internals', y: next === 'internals' ? this.defaultSlice() : slice.y, auto: true } : slice });
  };
  /** Choose a card: true when it acted, so the caller closes the drawer and its tooltip. */
  selectSlot = (item: SlotItem): boolean => {
    if (item.kind === 'empty' || this.locked) return false;
    const { layer, tool, surfaces } = this.state;
    this.update({ pathPoints: [], slots: { ...this.state.slots, [layer]: item.id }, sizeOverride: undefined });
    const faceTools: BuilderToolId[] = ['apply', 'area', 'eyedrop', 'opening', 'select'];
    switch (item.kind) {
      case 'shape': if (tool !== 'place' && tool !== 'fill') this.setTool('place'); break;
      case 'armor': case 'opening': case 'paint':
        if (surfaces.size) this.applyItem(item, surfaces); else if (!faceTools.includes(tool)) this.setTool('apply');
        break;
      case 'scheme': this.applyScheme(item.id); break;
      case 'tool': this.setTool(item.tool); break;
      case 'part': this.setTool(layer === 'internals' ? 'module' : 'place'); if (item.part.path) this.clearSelection(); break;
    }
    return true;
  };
  setSizeOverride = (size: Vec3) => this.update({ sizeOverride: size });
  setRopeSlack = (ropeSlack: number) => this.update({ ropeSlack });
  /** The Armor card's millimetre field; a new value also assigns the selected faces. */
  setThickness = (value: number) => {
    this.update({ customMm: value, slots: { ...this.state.slots, armor: 'armor' } });
    const armorItem = this.palette.drawer.find(item => item.kind === 'armor');
    if (armorItem && this.state.surfaces.size) this.applyItem(armorItem, this.state.surfaces, value);
  };
  toggleMirror = () => this.update({ mirror: !this.state.mirror });
  toggleArcs = () => this.update({ showArcs: !this.state.showArcs });
  toggleCenters = () => this.update({ showCenters: !this.state.showCenters });
  cycleView = () => this.update({ view: BUILDER_VIEWS[(BUILDER_VIEWS.indexOf(this.state.view) + 1) % BUILDER_VIEWS.length] });
  /** The freeform toolbar's orthographic presets: the view plus a fresh fit. */
  setView = (view: BuilderView) => this.update({ perspective: false, view, fitRequest: this.state.fitRequest + 1 });
  toggleProjection = () => this.update({ perspective: !this.state.perspective });
  toggleSlice = () => { const slice = this.state.slice; this.update({ slice: { on: !slice.on, y: slice.on ? slice.y : this.defaultSlice(), auto: false } }); };
  fit = () => this.update({ fitRequest: this.state.fitRequest + 1 });
  activateRail = (entry: RailEntry) => {
    if (this.locked) return;
    if (entry.kind === 'tool') { this.setTool(entry.id); if (entry.id === 'measure') { this.update({ measure: undefined }); this.clearSelection(); } else if (entry.id !== 'select') this.update({ surfaces: new Set() }); }
    else if (entry.id === 'rotate') this.rotate();
    else if (entry.id === 'suggest') void this.suggest(this.state.layer === 'fittings');
  };

  // ---- selection and editing
  choose = (id: string, additive = false) => {
    if (!this.selectable(id)) return;
    const patch: Partial<BuilderToolState> = {};
    const freeform = this.state.freeform;
    if (freeform && !additive && id !== freeform.baseline.id) {
      const part = this.data.primitives.find(part => part.id === id && canEditVertices(part));
      patch.freeform = part ? { designId: this.source.id, baseline: structuredClone(part) } : undefined;
    }
    if (!additive) patch.selected = new Set([id]);
    else { const next = new Set(this.state.selected); if (next.has(id)) next.delete(id); else next.add(id); patch.selected = next; }
    this.update(patch);
  };
  clearSelection = () => this.update({ selected: new Set(), surfaces: new Set() });
  selectAll = () => this.update({ selected: new Set(this.state.layer === 'internals' ? this.internalIds : [...this.data.primitives, ...this.data.equipment].map(part => part.id)) });
  selectOnly = (ids: string[]) => this.update({ selected: new Set(ids) });
  removePieces = (ids: ReadonlySet<string>, label = 'Remove selection'): ConstructionSubmission | undefined => {
    ids = new Set([...ids].filter(this.selectable));
    if (!ids.size) return undefined;
    const refused = this.refused(); if (refused) return refused;
    const keep = this.data.primitives.every(part => ids.has(part.id)) ? this.data.primitives[0]?.id : undefined;
    const outcome = this.command(label, [{ op: 'remove', ids: [...ids] }]);
    this.update({ selected: new Set([...this.state.selected].filter(id => !ids.has(id) || id === keep)),
      surfaces: new Set([...this.state.surfaces].filter(key => ![...ids].some(id => id !== keep && key.startsWith(`${id}:`)))),
      ...(keep ? { notice: 'Kept the last hull block. Add another block before removing it.' } : {}) });
    return outcome;
  };
  remove = () => this.removePieces(this.state.selected);
  erase = (id: string) => this.removePieces(new Set([id]), 'Remove piece');
  copy = (mirrorCopy = false): ConstructionSubmission | undefined => {
    const { selected } = this.state;
    if (!selected.size) return undefined;
    if (this.data.primitives.length + this.selectedPrimitives.length > LIMITS.primitives || this.data.equipment.length + this.selectedEquipment.length > LIMITS.equipment) { this.door.setError('This copy would exceed the design limit. Select fewer pieces or remove a section first.'); return undefined; }
    const next = structuredClone(this.source);
    const copied = copyConstructionSelection(next, selected, { mirror: mirrorCopy });
    if (!copied.length) return undefined;
    const outcome = this.run(mirrorCopy ? 'Mirror selection' : 'Copy selection', constructionDiffCommands(this.source, next));
    if (!outcome.accepted) return outcome;
    this.update({ selected: new Set(copied), surfaces: new Set(), notice: mirrorCopy ? 'Mirrored a copy across the centerline.' : 'Copied the selection 1 m to starboard.' });
    return outcome;
  };
  nudge = (delta: Vec3): ConstructionSubmission | undefined => this.state.selected.size ? this.movePieces([...this.state.selected], delta) : undefined;
  /** A finished move drag or nudge: blocks stop at other blocks' bounds, fittings translate, walls slide to the snap step. */
  movePieces = (ids: string[], requested: Vec3): ConstructionSubmission | undefined => {
    ids = ids.filter(this.selectable);
    if (!ids.length) return undefined;
    const refused = this.refused(); if (refused) return refused;
    const moving = new Set(ids);
    const delta = blockMoveConstraint(this.source, moving)(requested);
    if (delta.some((value, axis) => Math.abs(value - requested[axis]) > 1e-7)) this.update({ notice: 'Movement stopped at another block.' });
    if (delta.every(value => value === 0)) return undefined;
    const commands: ConstructionCommand[] = [{ op: 'move', ids, delta }];
    for (const wall of this.data.boundaries) if (moving.has(wall.id)) commands.push({ op: 'boundary', value: { ...wall, offset: snapCoordinate(wall.offset + delta[AXIS[wall.axis]], this.gridStep) } });
    const outcome = this.run('Move selection', commands);
    if (!outcome.accepted) return outcome;
    this.update({ selected: moving, surfaces: new Set() });
    return outcome;
  };
  rotate = (): ConstructionSubmission | undefined => {
    const piece = this.piece;
    if (piece && piece.kind !== 'boundary') { this.update({ bearing: normalizedBearing(this.state.bearing + (piece.kind === 'hull' ? 90 : 15)) }); return undefined; }
    if (this.state.selected.size) return this.command('Rotate selection', [{ op: 'rotate', ids: [...this.state.selected], degrees: this.selectedPrimitives.length ? 90 : 15 }]);
    return undefined;
  };
  /** A click or a finished stroke: one piece per point plus mirrored twins, as one undoable edit. */
  placeAt = (points: Vec3[]): ConstructionSubmission | undefined => {
    const piece = this.piece, active = this.active, { mirror } = this.state;
    if (!piece) return undefined;
    const refused = this.refused(); if (refused) return refused;
    if (piece.kind === 'hull' && active?.kind === 'shape') {
      const pieces: ConstructionPrimitive[] = [];
      for (const point of points) {
        pieces.push({ id: this.newId('hull'), kind: piece.shape, size: [...piece.size], position: point, rotationDeg: piece.rotationDeg,
          ...(piece.shape === 'custom-hull' ? { customHull: customHullPrimitive(makeHull(0)).customHull } : {}) });
        if (mirror && offCenterline(point)) pieces.push({ ...mirroredPrimitive(pieces.at(-1)!), id: this.newId('hull') });
      }
      if (this.data.primitives.length + pieces.length > LIMITS.primitives) { this.door.setError(`A design supports up to ${LIMITS.primitives} hull pieces. Use larger pieces or remove a section before adding more.`); return undefined; }
      return this.run(pieces.length > 1 ? 'Lay hull pieces' : 'Place hull piece', pieces.map(value => ({ op: 'primitive', value })));
    }
    if (piece.kind === 'equipment' && active?.kind === 'part') {
      const parts: ConstructionEquipment[] = [];
      for (const point of points) {
        // The viewport already snaps the face plane; retain the exact socket height.
        parts.push({ id: this.newId('equipment'), partId: active.id, position: [...point], bearingDeg: piece.bearingDeg });
        if (mirror && offCenterline(point)) parts.push({ ...parts.at(-1)!, id: this.newId('equipment'), position: [-point[0], point[1], point[2]], bearingDeg: normalizedBearing(-piece.bearingDeg) });
      }
      if (this.data.equipment.length + parts.length > LIMITS.equipment) { this.door.setError(`A design supports up to ${LIMITS.equipment} fittings. Remove a fitting before adding more.`); return undefined; }
      return this.run(parts.length > 1 ? 'Place fittings' : `Place ${active.name}`, parts.map(value => ({ op: 'equipment', value })));
    }
    return undefined;
  };
  addPathPoint = (point: Vec3) => {
    if (this.state.pathPoints.length >= 64) { this.update({ notice: '64 points reached. Finish this path before starting another.' }); return; }
    if (!this.locked) this.update({ pathPoints: appendPathPoint(this.state.pathPoints, point), selected: new Set(), surfaces: new Set() });
  };
  popPathPoint = () => this.update({ pathPoints: this.state.pathPoints.slice(0, -1) });
  clearPath = () => this.update({ pathPoints: [] });
  cancelPath = (clearNotice = true) => this.update({ pathPoints: [], tool: 'select', ...(clearNotice ? { notice: '' } : {}) });
  /** The route and its mirrored copy become one undoable edit; the new fittings are then selected. */
  finishPath = (): ConstructionSubmission | undefined => {
    const pathPart = this.pathPart, { pathPoints, ropeSlack, mirror } = this.state;
    if (!pathPart) return undefined;
    const refused = this.refused(); if (refused) return refused;
    const slackM = pathPart.path?.kind === 'rope' ? ropeSlack : 0, problem = pathProblem(pathPoints, slackM);
    if (problem) { this.update({ notice: problem }); return undefined; }
    const item = pathEquipment(this.newId('path'), pathPart.id, pathPoints, slackM);
    const parts = [item];
    if (mirror && pathPoints.some(point => Math.abs(point[0]) > 1e-6)) parts.push({ ...mirroredEquipment(item), id: this.newId('path') });
    if (this.data.equipment.length + parts.length > LIMITS.equipment) { this.update({ notice: 'The fittings limit is reached. Remove a fitting before adding this path.' }); return undefined; }
    const outcome = this.run(`Draw ${pathPart.path!.kind} path`, parts.map(value => ({ op: 'equipment', value })));
    this.update({ pathPoints: [], selected: new Set(parts.map(part => part.id)), tool: 'select' });
    return outcome;
  };
  addBoundary = (axis: ConstructionBoundary['axis'], offset: number): ConstructionSubmission | undefined => {
    if (this.data.boundaries.length >= LIMITS.boundaries) { this.door.setError(`A design supports up to ${LIMITS.boundaries} decks and bulkheads. Merge rooms before adding more.`); return undefined; }
    if (this.data.boundaries.some(wall => wall.axis === axis && Math.abs(wall.offset - offset) < 1e-6)) { this.update({ notice: `A ${BOUNDARY_NAMES[axis].toLowerCase()} already sits at ${signed(offset)} m.` }); return undefined; }
    return this.run(`Add ${BOUNDARY_NAMES[axis].toLowerCase()}`, [{ op: 'boundary', value: { id: this.newId('boundary'), axis, offset, thicknessMm: 10 } }]);
  };
  /** Mirror placement reaches the twin face across the centerline, including the far side of a straddling piece. */
  withMirrorFaces(keys: ReadonlySet<string>): Set<string> {
    if (!this.state.mirror) return new Set(keys);
    const out = new Set(keys), editableKeys = this.editableKeys;
    for (const key of keys) {
      const [primitiveId, face] = key.split(':') as [string, ConstructionFace];
      const primitive = this.data.primitives.find(part => part.id === primitiveId), twin = primitive && mirrorTwin(this.source, primitive);
      if (twin && editableKeys.has(surfaceKey(twin.id, mirroredFace(face, primitive.kind)))) out.add(surfaceKey(twin.id, mirroredFace(face, primitive.kind)));
    }
    return out;
  }
  applyItem = (item: SlotItem, keys: ReadonlySet<string>, thickness = this.state.customMm): ConstructionSubmission | undefined => {
    if (!keys.size) return undefined;
    const target = this.withMirrorFaces(keys);
    const assign = (label: string, values: SurfaceValues) => this.run(label, this.surfaceCommands(target, values));
    switch (item.kind) {
      case 'armor': return assign(`Assign ${thickness} mm armor`, { thicknessMm: thickness, material: thickness > 0 ? 'armor-steel' : 'steel', open: false });
      case 'opening': return assign('Open faces to sea', { open: true });
      case 'paint': return assign(`Paint ${item.name.toLowerCase()}`, { paint: item.id });
      default: return undefined;
    }
  };
  applyScheme = (id: 'two-tone' | 'disruptive'): ConstructionSubmission => {
    const keys = [...this.editableKeys];
    if (id === 'two-tone') return this.run('Apply two-tone paint', [
      ...this.surfaceCommands(new Set(keys.filter(key => key.endsWith(':top'))), { paint: 'deck-gray' }),
      ...this.surfaceCommands(new Set(keys.filter(key => key.endsWith(':bottom'))), { paint: 'red-oxide' }),
      ...this.surfaceCommands(new Set(keys.filter(key => !key.endsWith(':top') && !key.endsWith(':bottom'))), { paint: 'naval-gray' })]);
    return this.run('Apply disruptive paint', this.data.primitives.flatMap(primitive => this.surfaceCommands(new Set(keys.filter(key => key.startsWith(`${primitive.id}:`) && !key.endsWith(':bottom'))), { paint: Math.abs(Math.floor(primitive.position[2] / 12)) % 2 ? 'sea-blue' : 'light-gray' })));
  };
  /** A click resolved by the viewport: measure, face assignment, boundaries, merge, erase or selection by tool. */
  pick = (hit?: BuilderPick): ConstructionSubmission | undefined => {
    if (this.locked) return undefined;
    const { layer, tool } = this.state;
    if (!hit) { this.clearSelection(); return undefined; }
    if (tool === 'measure') { const current = this.state.measure; this.update({ measure: !current || current.to ? { from: hit.point } : { ...current, to: hit.point } }); return undefined; }
    if (layer === 'armor' || layer === 'paint') {
      if (!hit.surface) { if (!hit.additive) this.update({ surfaces: new Set() }); if (hit.id && tool === 'select') this.choose(hit.id, hit.additive); else if (!hit.additive) this.update({ selected: new Set() }); return undefined; }
      if (!this.compiled) { this.update({ notice: 'Face editing resumes when this source has a compiled preview.' }); return undefined; }
      if (!this.editableKeys.has(hit.surface)) { this.update({ notice: 'This fixed equipment support follows its fitting. Choose a hull face to edit.' }); return undefined; }
      const surface = this.editableSurfaces.find(entry => surfaceKey(entry.primitiveId, entry.face) === hit.surface)!;
      switch (tool) {
        case 'apply': return this.active ? this.applyItem(this.active, new Set([hit.surface])) : undefined;
        case 'area': { const next = hit.additive ? new Set(this.state.surfaces) : new Set<string>(); for (const entry of this.editableSurfaces) if (entry.face === surface.face) next.add(surfaceKey(entry.primitiveId, entry.face)); this.update({ surfaces: next }); return undefined; }
        case 'eyedrop':
          if (layer === 'armor') this.update({ customMm: surface.thicknessMm, slots: { ...this.state.slots, armor: 'armor' }, notice: `Armor thickness set to ${surface.thicknessMm} mm from the picked face.`, tool: 'apply' });
          else this.update({ slots: { ...this.state.slots, paint: surface.paint }, notice: 'Paint slot set from the picked face.', tool: 'apply' });
          return undefined;
        case 'opening': return this.run(surface.open ? 'Close skin' : 'Open faces to sea', this.surfaceCommands(this.withMirrorFaces(new Set([hit.surface])), { open: !surface.open }));
        default: { const next = hit.additive ? new Set(this.state.surfaces) : new Set<string>(); if (next.has(hit.surface)) next.delete(hit.surface); else next.add(hit.surface); this.update({ surfaces: next }); return undefined; }
      }
    }
    if (layer === 'internals' && (tool === 'deck' || tool === 'bulkhead' || tool === 'longitudinal')) { const axis = tool === 'deck' ? 'y' : tool === 'bulkhead' ? 'z' : 'x'; return this.addBoundary(axis, hit.placement[AXIS[axis]]); }
    if (layer === 'internals' && tool === 'merge') {
      if (hit.id && this.data.boundaries.some(wall => wall.id === hit.id)) return this.run('Merge rooms', [{ op: 'remove', ids: [hit.id] }]);
      this.update({ notice: 'Click a deck or bulkhead to merge the rooms on either side.' }); return undefined;
    }
    if (tool === 'erase') return hit.id ? this.erase(hit.id) : undefined;
    if (hit.id) this.choose(hit.id, hit.additive); else if (!hit.additive) this.clearSelection();
    return undefined;
  };
  boxSelect = (ids: string[], additive: boolean) => {
    if (this.locked) return;
    ids = ids.filter(this.selectable);
    this.update({ tool: 'select', surfaces: new Set(), selected: new Set(additive ? [...this.state.selected, ...ids] : ids) });
  };
  /** The viewport's finished gestures, targets already raycast. Edits return their submission. */
  pointer = (event: BuilderPointerEvent): ConstructionSubmission | undefined => {
    switch (event.kind) {
      case 'pick': return this.pick(event.hit);
      case 'lay': return this.placeAt(event.points);
      case 'box': this.boxSelect(event.ids, event.additive); return undefined;
      case 'erase': return this.erase(event.id);
      case 'move': return this.movePieces(event.ids, event.delta);
      case 'path-point': this.addPathPoint(event.point); return undefined;
      case 'path-finish': return this.finishPath();
    }
  };

  // ---- layout suggestions
  suggest = async (selectedPart = false) => {
    if (this.pathPart) { this.update({ notice: 'Click connected points on the ship, then press Enter to finish this path.' }); return; }
    const request = this.context.suggest;
    if (!request || this.locked) return;
    const source = this.source, data = this.data, active = this.active;
    const fittedKinds = new Set(data.equipment.map(instance => this.partOf(instance)?.kind));
    const ids = selectedPart ? (active?.kind === 'part' ? [active.id] : []) : this.catalog.equipment.filter(part => {
      if (part.kind === 'magazine' || part.placement !== 'internal' || fittedKinds.has(part.kind)) return false;
      fittedKinds.add(part.kind); return true;
    }).map(part => part.id).slice(0, 16);
    if (!ids.length) { this.update({ notice: selectedPart ? 'Choose a fitting slot to place by suggestion.' : 'Every internal family is already fitted.' }); return; }
    this.door.setBusy('Finding a layout'); this.update({ suggestion: undefined }); const revision = source.revision;
    const abort = new AbortController(); this.suggestionRequest?.abort(); this.suggestionRequest = abort;
    try {
      const proposed = await request(structuredClone(source), ids, abort.signal);
      if (abort.signal.aborted) return;
      if (proposed.source.id !== source.id || proposed.source.construction.catalogRevision !== data.catalogRevision) throw new Error('The layout belongs to a different design or equipment catalog. Request a new suggestion.');
      this.update({ suggestion: { proposal: proposed, revision } });
    } catch (cause) { if (!abort.signal.aborted) this.fail(cause); }
    finally { if (this.suggestionRequest === abort) this.suggestionRequest = undefined; this.door.setBusy(''); }
  };
  dismissSuggestion = () => this.update({ suggestion: undefined });
  applySuggestion = (): ConstructionSubmission | undefined => {
    const suggestion = this.state.suggestion;
    if (!suggestion || this.source.revision !== suggestion.revision) return undefined;
    const next = structuredClone(this.source), proposal = suggestion.proposal.source.construction;
    next.construction.equipment = structuredClone(proposal.equipment); next.construction.boundaries = structuredClone(proposal.boundaries); next.construction.loads = structuredClone(proposal.loads);
    const outcome = this.run('Apply suggested layout', constructionDiffCommands(this.source, next));
    this.update({ suggestion: undefined });
    return outcome;
  };

  // ---- freeform hulls
  changeFreeformSettings = (patch: Partial<FreeformSettings>) => this.update({ freeformSettings: { ...this.state.freeformSettings, ...patch } });
  cycleUnit = () => this.changeFreeformSettings({ unit: VERTEX_UNITS[(VERTEX_UNITS.findIndex(unit => unit === this.state.freeformSettings.unit) + 1) % VERTEX_UNITS.length] });
  /** True when a single editable block entered freeform editing, so the caller closes the drawer. */
  enterFreeform = (): boolean => {
    const part = this.selectedPrimitives[0];
    if (!part || this.state.selected.size !== 1 || !canEditVertices(part)) return false;
    this.update({ tool: 'select', layer: 'hull', slice: { ...this.state.slice, on: false }, surfaces: new Set(), freeform: { designId: this.source.id, baseline: structuredClone(part) } });
    return true;
  };
  exitFreeform = () => this.update({ freeform: undefined });
  commitFreeform = (replacements: ConstructionPrimitive[]): ConstructionSubmission | undefined =>
    replacements.length ? this.run('Shape freeform hull', replacements.filter(part => this.data.primitives.some(existing => existing.id === part.id)).map(value => ({ op: 'primitive', value }))) : undefined;
  resetFreeform = () => { const freeform = this.state.freeform; return freeform ? this.run('Reset hull edit', [{ op: 'primitive', value: freeform.baseline }]) : undefined; };
  setSelectionCoordinate = (axis: number, value: number) => {
    const primitive = this.freeformPrimitive, settings = this.state.freeformSettings;
    if (!primitive) return;
    const delta: Vec3 = [0, 0, 0], original = selectionCenter(primitive, settings.selection)[axis];
    delta[axis] = Math.round((value - original) / settings.unit) * settings.unit;
    this.commitFreeform(freeformEdit(this.source, primitive.id, settings.selection, delta, settings.axes, settings.snap));
  };
  splitFreeform = () => {
    const primitive = this.freeformPrimitive, settings = this.state.freeformSettings;
    if (!primitive) return;
    try {
      const next = structuredClone(this.source), ids = splitVertexPrimitive(next, primitive.id, settings.splitAxis, settings.count);
      this.run('Split hull block', constructionDiffCommands(this.source, next));
      this.update({ selected: new Set([ids[0]]), freeform: undefined });
    } catch (cause) { this.fail(cause); }
  };

  // ---- keys: the caller has already excluded text fields, the help dialog and a locked door.
  key(event: BuilderKey, chrome: BuilderChrome) {
    const modifier = event.ctrlKey || event.metaKey, lower = event.key.toLowerCase(), s = this.state, pathPart = this.pathPart;
    if (pathPart) {
      if (event.key === 'Escape') { event.preventDefault(); this.cancelPath(); return; }
      if (event.key === 'Enter') { event.preventDefault(); this.finishPath(); return; }
      if (s.pathPoints.length && (event.key === 'Backspace' || modifier && lower === 'z')) { event.preventDefault(); this.popPathPoint(); return; }
      if (s.pathPoints.length && (lower === 'r' || event.key === 'Delete')) return;
    }
    if (modifier && lower === 'z') { event.preventDefault(); if (event.shiftKey) this.door.redo(); else this.door.undo(); return; }
    if (modifier && lower === 'y') { event.preventDefault(); this.door.redo(); return; }
    if (!modifier && !event.altKey && lower === 'p') { event.preventDefault(); if (!event.repeat) this.toggleProjection(); return; }
    if (this.freeformMode && !modifier) {
      if (event.key === 'Escape') { this.exitFreeform(); event.preventDefault(); return; }
      if (lower === 'g') { this.cycleUnit(); event.preventDefault(); return; }
      if (lower === 'o') { this.toggleProjection(); event.preventDefault(); return; }
      if (lower !== 'w' && event.key !== 'Home') return;
    }
    // Without a selection, ⌘C and ⌘X stay with the browser so selected text still copies.
    if (modifier && lower === 'c') { if (!s.selected.size) return; event.preventDefault(); this.copy(event.shiftKey); return; }
    if (modifier && lower === 'x') { if (!s.selected.size) return; event.preventDefault(); this.remove(); return; }
    if (modifier && lower === 'a') { event.preventDefault(); this.selectAll(); return; }
    if (modifier) return;
    if (event.key === 'Escape') {
      if (chrome.dismiss()) return;
      if (s.suggestion) this.dismissSuggestion();
      else if (s.measure) this.update({ measure: undefined });
      else if (s.tool !== 'select') { this.setTool('select'); this.clearSelection(); }
      else this.clearSelection();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.remove(); return; }
    if (event.key === 'Home') { event.preventDefault(); this.fit(); return; }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); const direction = event.key === 'PageUp' ? 1 : -1;
      if (event.shiftKey || (s.slice.on && !s.selected.size)) this.update({ slice: { on: true, y: s.slice.y + direction * .5, auto: false } });
      else if (s.selected.size && this.selectedEquipment.length === s.selected.size && this.selectedEquipment.every(item => this.partOf(item)?.kind === 'gun')) this.raiseTurrets([...s.selected], current => Math.max(0, Math.min(30, current + direction * this.gridStep)));
      else if (s.selected.size) this.nudge([0, direction * this.gridStep, 0]);
      return;
    }
    if (event.key.startsWith('Arrow') && s.selected.size) {
      event.preventDefault(); const step = this.gridStep;
      this.nudge(event.key === 'ArrowLeft' ? [-step, 0, 0] : event.key === 'ArrowRight' ? [step, 0, 0] : event.key === 'ArrowUp' ? [0, 0, -step] : [0, 0, step]);
      return;
    }
    if (/^[1-9]$/.test(event.key)) { const item = this.palette.bar[Number(event.key) - 1]; if (item && this.selectSlot(item)) chrome.slotChosen(); return; }
    if (event.key === '0') { if (this.hasDrawer) { event.preventDefault(); chrome.toggleDrawer(); } return; }
    if (lower === 'q') this.cycleView(); else if (lower === 's') this.toggleSlice(); else if (lower === 'w') chrome.toggleWarnings();
    else if (lower === 'r') this.rotate(); else if (lower === 'm') this.toggleMirror(); else if (lower === 'c') this.toggleCenters();
    else if (lower === 'a' && s.layer === 'fittings') this.toggleArcs();
    else { const entry = this.rail.find(entry => entry.key.toLowerCase() === lower); if (entry) this.activateRail(entry); }
  }
}
