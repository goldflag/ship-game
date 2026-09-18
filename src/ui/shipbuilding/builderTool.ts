import { blockAngles, rotateBlock, withBlockAngles } from '../../ships/constructionOrientation';
import { reseatBalcony } from './balconyPlacement';
import { editableMesh } from '../../ships/constructionMesh';
import { fittedLadder } from '../../ships/constructionLadders';
import { wallMount, installedWallPart, wallNormal, wallFittingSupported, seatWallFitting } from '../../ships/constructionWallFittings';
import { DEFAULT_SNAPPING, constructionSnapFeatures, type SnapSettings } from './snapping';
import { CONSTRUCTION_PAINTS, isConstructionSurfaceFinish } from '../../ships/constructionPaints';
import { mirroredPanelId } from '../../ships/constructionPanels';
import { integrateConstructionMagazines, setBarbetteHeight } from '../../ships/constructionArmament';
import type { ConstructionBoundary, ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, ConstructionSurface, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { assignConstructionSurfaces, CONSTRUCTION_LIMITS, copyConstructionSelection, editableConstructionSurfaces, mirroredEquipment, mirroredFace, mirroredPrimitive, newConstructionId, projectConstructionSurfaces, surfaceKey, surfaceSelectionKey, type ConstructionFace } from '../../ships/constructionEditor';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionCommand } from '../../ships/constructionCommands';
import type { ConstructionRevisionOwner, ConstructionSubmission } from '../../ships/constructionRevisionOwner';
import { canEditVertices, selectionCorners, splitVertexPrimitive, VERTEX_UNITS, type HullSelection, type MirrorAxes } from '../../ships/constructionVertex';
import { pathSlackLimit, pathProblem } from '../../ships/constructionPaths';
import { BUILDER_RAIL, DEFAULT_TOOL, paletteFor, type BuilderLayer, type BuilderToolId, type RailEntry, type SlotItem } from './builderLayers';
import { fittingCategory, fittingNation, shelfNations, type FittingFilter, type FittingNation } from './fittingCategories';
import type { HullCategory } from './hullCategories';
import { appendPathPoint, pathEquipment } from './pathDrawing';
import { mirrorTwin, mirrorTwinEquipment, offCenterline } from './placement';
import { blockMoveConstraint, blockPlacementAllowed, placementBlocks, OVERLAP_NOTICE } from './blockMovement';
import { internalSelectionIds } from './internalSelection';
import { normalizedBearing } from './editorNumbers';
import type { BuilderArc, BuilderDisplay, BuilderGesture, BuilderMoveTargets, BuilderPick, BuilderPlacement, BuilderPointerEvent, BuilderProposal, BuilderScene, BuilderView } from './builderScene';
import type { ArmorScale } from '../../ships/inspection';

/** Freeform hull editing options: mirror planes, move step, snapping to nearby corners and the split controls. */
export interface FreeformSettings { axes: MirrorAxes; unit: number; snap: boolean; splitAxis: number; count: number; selection: HullSelection }

/** The tool's own state: which layer and tool are active, what is selected, what the cursor carries. */
export interface BuilderToolState {
  layer: BuilderLayer; tool: BuilderToolId;
  slots: Record<BuilderLayer, string>;
  /** The Fittings shelf on the bar and the nation it is narrowed to. */
  fittingFilter: FittingFilter;
  hullCategory: HullCategory;
  windowRow: boolean; windowSpacing: number;
  customMm: number; sizeOverride?: Vec3; bearing: number;
  pathPoints: Vec3[]; pathBearing: number; ropeSlack: number; railingHeight: number; railingRails: 2 | 3;
  /** Last successfully applied fitting paint, retained while the editor stays open. */
  fittingPaint?: string;
  mirror: boolean; showArcs: boolean; showCenters: boolean;
  /** Placement and movement steps in metres, remembered separately for hull pieces and fittings. */
  snapSteps: { hull: number; equipment: number };
  snapping: SnapSettings; snapOverride: boolean;
  freeform?: { designId: string; baseline: ConstructionPrimitive };
  freeformSettings: FreeformSettings;
  rotationAxis: number; rotationSnap: boolean;
  view: BuilderView; perspective: boolean; fitRequest: number;
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
  /** The last accepted compile, kept through recompiles so face edits continue while the current one is pending. */
  retained?(): ConstructionResult | undefined;
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
  private paletteCache?: { layer: BuilderLayer; catalog: ConstructionCatalog; thicknesses: string; filter: FittingFilter; hullCategory: HullCategory; palette: ReturnType<typeof paletteFor> };
  private surfaceCache?: { source: ConstructionSource; compiled?: ConstructionResult; retained?: ConstructionResult; surfaces: ConstructionSurface[]; keys: Set<string>; thicknesses: number[]; armorScale: ArmorScale };
  private pieceCache?: { key: string; piece?: BuilderPlacement };
  private internalCache?: { source: ConstructionSource; catalog: ConstructionCatalog; ids: Set<string> };
  private mirrorCache?: { key: string; piece?: BuilderPlacement };

  constructor(private readonly door: BuilderRevisionDoor, private readonly context: BuilderToolContext, initial: Partial<BuilderToolState> = {}) {
    this.state = {
      layer: 'hull', tool: 'select', slots: { hull: 'cube', armor: 'armor', internals: 'deck', fittings: '', paint: 'naval-gray' }, fittingFilter: { category: 'main-battery', nation: 'all' },
      hullCategory: 'all', windowRow: false, windowSpacing: 1.5, customMm: 10, bearing: 0, pathPoints: [], pathBearing: 0, ropeSlack: .15, railingHeight: 1.1, railingRails: 3, mirror: true, showArcs: false, showCenters: false, snapSteps: { hull: 1, equipment: .25 },
      snapping: { ...DEFAULT_SNAPPING }, snapOverride: false, rotationAxis: 1, rotationSnap: true,
      freeformSettings: { axes: [true, false, false], unit: .2, snap: false, splitAxis: 2, count: 4, selection: { mode: 'vertex', index: 1 } },
      view: 'orbit', perspective: true, fitRequest: 0,
      selected: new Set<string>(), surfaces: new Set(), notice: '', ...initial,
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
  get retained() { return this.context.retained?.(); }
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
    const p=this.freeformPrimitive;
    if(p&&!selectionCorners(this.state.freeformSettings.selection,p).length)this.state={...this.state,freeformSettings:{...this.state.freeformSettings,selection:{mode:'vertex',index:0}}};
  }
  /** The revision owner changed: a new design clears selections and proposals; a new revision retires a pending layout request. */
  private observe = () => {
    const source = this.door.source;
    let patch: Partial<BuilderToolState> | undefined;
    if (source.id !== this.lastSourceId) {
      patch = { selected: new Set(), surfaces: new Set(), suggestion: undefined, measure: undefined, pathPoints: [], tool: 'select' };
    }
    if (source.revision !== this.lastRevision) { this.suggestionRequest?.abort(); this.suggestionRequest = undefined; }
    this.lastSourceId = source.id; this.lastRevision = source.revision;
    if (patch) this.update(patch);
    else { const before = this.state; this.reconcile(); if (this.state !== before) for (const listener of this.listeners) listener(); }
  };

  // ---- derived
  get palette() {
    const layer = this.state.layer, catalog = this.catalog, thicknesses = layer === 'armor' ? this.surfaceState.thicknesses.join(',') : '';
    const filter = this.state.fittingFilter, hullCategory = this.state.hullCategory;
    if (!this.paletteCache || this.paletteCache.layer !== layer || this.paletteCache.catalog !== catalog || this.paletteCache.thicknesses !== thicknesses || this.paletteCache.filter !== filter || this.paletteCache.hullCategory !== hullCategory) this.paletteCache = { layer, catalog, thicknesses, filter, hullCategory, palette: paletteFor(layer, catalog, this.surfaceState.thicknesses, filter, hullCategory) };
    return this.paletteCache.palette;
  }
  /** The nations with parts on the open Fittings shelf; the nation filter offers these and "All". */
  get shelfNations(): FittingNation[] {
    const category = this.state.fittingFilter.category;
    return shelfNations((this.palette.all ?? []).flatMap(item => item.kind === 'part' && fittingCategory(item.part, this.catalog) === category ? [item.part] : []));
  }
  /** The nation the shelf is actually narrowed to: the chosen one when this shelf has it, otherwise all. */
  get shelfNation(): FittingNation | 'all' { const nation = this.state.fittingFilter.nation; return nation !== 'all' && this.shelfNations.includes(nation) ? nation : 'all'; }
  /** Open a shelf or narrow it; the bar's first card is taken up when the held one is no longer on it. */
  setFittingFilter = (patch: Partial<FittingFilter>) => { this.update({ fittingFilter: { ...this.state.fittingFilter, ...patch }, pathPoints: [], sizeOverride: undefined }); };
  setHullCategory = (hullCategory: HullCategory) => { if (hullCategory !== this.state.hullCategory) this.update({ hullCategory, sizeOverride: undefined }); };
  get active(): SlotItem | undefined { return this.palette.drawer.find(item => item.id === this.state.slots[this.state.layer]) ?? this.palette.drawer[0]; }
  get drawerName() { return this.state.layer === 'fittings' ? 'fittings' : this.state.layer === 'hull' ? 'shapes' : 'items'; }
  get hasDrawer() { return this.palette.drawer.length > this.palette.bar.filter(item => item.kind !== 'empty').length || this.state.layer === 'fittings' || this.state.layer === 'hull'; }
  private pathPartOf(state: BuilderToolState): ConstructionEquipmentPart | undefined {
    if (state.layer !== 'fittings' || state.tool !== 'place') return undefined;
    const palette = state.layer === this.state.layer && state.fittingFilter === this.state.fittingFilter ? this.palette : paletteFor(state.layer, this.catalog, [], state.fittingFilter);
    const active = palette.drawer.find(item => item.id === state.slots[state.layer]) ?? palette.drawer[0];
    return active?.kind === 'part' && active.part.path ? active.part : undefined;
  }
  /** The connected-route part being drawn, when the Fittings Place tool holds a railing, rope or chain. */
  get pathPart() { return this.pathPartOf(this.state); }
  get rail(): RailEntry[] { return BUILDER_RAIL[this.state.layer]; }
  get selectedPrimitives() { return this.data.primitives.filter(part => this.state.selected.has(part.id)); }
  get selectedEquipment() { return this.data.equipment.filter(part => this.state.selected.has(part.id)); }
  get selectedBoundary() { return this.data.boundaries.find(wall => this.state.selected.has(wall.id)); }
  get rotationPrimitive() { return this.state.layer === 'hull' && this.state.tool === 'rotate' && this.state.selected.size === 1 ? this.selectedPrimitives[0] : undefined; }
  setRotationAxis = (rotationAxis: number) => { if ([0, 1, 2].includes(rotationAxis)) this.update({ rotationAxis }); };
  toggleRotationSnap = () => this.update({ rotationSnap: !this.state.rotationSnap });
  rotateBlock = (axis: number, degrees: number) => {
    const p = this.rotationPrimitive;
    if (!p || this.locked || ![0, 1, 2].includes(axis) || !Number.isFinite(degrees) || Math.abs(degrees % 360) < 1e-8) return;
    return this.run('Rotate block', [{ op: 'primitive', value: rotateBlock(p, axis, degrees) }]);
  };
  setBlockAngle = (axis: number, degrees: number) => {
    const p = this.rotationPrimitive;
    if (!p || this.locked || ![0, 1, 2].includes(axis) || !Number.isFinite(degrees) || Math.abs(degrees) > 3600) return;
    const angles = blockAngles(p); angles[axis] = degrees;
    return this.run('Set block angle', [{ op: 'primitive', value: withBlockAngles(p, angles) }]);
  };
  resetBlockRotation = () => {
    const p = this.rotationPrimitive;
    if (p && !this.locked && blockAngles(p).some(n => n !== 0)) this.run('Reset block orientation', [{ op: 'primitive', value: withBlockAngles(p, [0, 0, 0]) }]);
  };
  get freeformPrimitive(): ConstructionPrimitive | undefined {
    const { freeform, layer, tool, selected } = this.state;
    if (!freeform || freeform.designId !== this.source.id || layer !== 'hull' || tool !== 'select' || selected.size !== 1 || !selected.has(freeform.baseline.id)) return undefined;
    return this.data.primitives.find(part => part.id === freeform.baseline.id && (part.kind==='box'||part.kind==='vertex'));
  }
  get freeformMode() { return !!this.freeformPrimitive; }
  partOf = (instance: ConstructionEquipment) => { const part = this.catalog.equipment.find(part => part.id === instance.partId); return part && installedWallPart(part, instance); };
  /** Faces from the current compile, or from the last one with this source's assignments over them while a compile is pending. */
  private get surfaceState() {
    const source = this.source, compiled = this.compiled, retained = compiled ? undefined : this.retained;
    if (!this.surfaceCache || this.surfaceCache.source !== source || this.surfaceCache.compiled !== compiled || this.surfaceCache.retained !== retained) {
      const surfaces = editableConstructionSurfaces(source, compiled?.surfaces ?? (retained ? projectConstructionSurfaces(source, retained.surfaces) : []));
      const thicknesses = [...new Set(surfaces.filter(surface => !surface.open).map(surface => surface.thicknessMm))].sort((a, b) => b - a);
      this.surfaceCache = { source, compiled, retained, surfaces, keys: new Set(surfaces.map(surface => surfaceSelectionKey(surface))), thicknesses, armorScale: { fromMm: thicknesses.at(-1) ?? 0, toMm: thicknesses[0] ?? 0 } };
    }
    return this.surfaceCache;
  }
  /** Native hull faces that accept armor, paint and openings: fixed equipment supports are excluded. */
  get editableSurfaces() { return this.surfaceState.surfaces; }
  get editableKeys(): ReadonlySet<string> { return this.surfaceState.keys; }
  /** Every thickness on the ship, thickest first; the Armor layer's value cards. */
  get thicknesses(): readonly number[] { return this.surfaceState.thicknesses; }
  /** The ship's thinnest and thickest plates: the ends of the Armor layer's relative colour scale. */
  get armorScale(): ArmorScale { return this.surfaceState.armorScale; }
  /** Fittings and modules snap on the equipment step; everything else on the hull step. */
  get snapKind(): 'hull' | 'equipment' { const { layer, tool } = this.state; return layer === 'fittings' || (layer === 'internals' && tool === 'module') ? 'equipment' : 'hull'; }
  get effectiveSnapping(): SnapSettings { return { ...this.state.snapping, enabled: this.state.snapping.enabled !== this.state.snapOverride }; }
  toggleSnapping = () => this.changeSnapping({ enabled: !this.state.snapping.enabled });
  changeSnapping = (patch: Partial<SnapSettings>) => this.update({ snapping: { ...this.state.snapping, ...patch } });
  setSnapOverride = (held: boolean) => { if (held !== this.state.snapOverride) this.update({ snapOverride: held }); };
  setSnapStep = (step: number) => { if (SNAP_STEPS.includes(step)) this.update({ snapSteps: { ...this.state.snapSteps, [this.snapKind]: step } }); };
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
      const mount = wallMount(active.part), wall = mount ? { version: 1 as const, widthM: sizeOverride?.[0] ?? active.part.size[0], heightM: sizeOverride?.[1] ?? active.part.size[1] } : undefined;
      const fitted = installedWallPart(active.part, { wall });
      piece = { kind: 'equipment', wall, rowSpacing: wall && (mount === 'window' || mount === 'porthole') && this.state.windowRow ? Math.max(wall.widthM + .05, this.state.windowSpacing) : undefined, partId: active.part.id, propellerDiameterM: active.part.kind === 'propeller' ? Math.max(active.part.size[0], active.part.size[1]) : undefined, size: fitted.size, boundsCenter: fitted.boundsCenter, bearingDeg: normalizedBearing(bearing), sockets: fitted.sockets, arc: gun ? { traverseDeg: gun.traverseDeg, radius: ARC_RADIUS } : undefined, inset: active.part.placement === 'internal' ? this.data.defaultThicknessMm / 1000 : undefined };
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
  get gesture(): BuilderGesture { const { tool } = this.state; return this.pathPart ? 'none' : tool === 'fill' ? 'fill' : tool === 'place' || tool === 'module' ? 'stroke' : this.faceLayer && (tool === 'apply' || tool === 'opening') ? 'faces' : 'none'; }
  /** Select drags any piece, fitting or wall; placing fittings or modules still drags the ones already fitted. Face layers never move geometry. */
  get moveTargets(): BuilderMoveTargets {
    const { layer, tool } = this.state;
    return this.pathPart ? 'none' : layer === 'armor' || layer === 'paint' ? 'none' : tool === 'select' ? 'all' : (layer === 'fittings' && tool === 'place') || tool === 'module' ? 'equipment' : 'none';
  }
  get pickTargets(): BuilderScene['pickTargets'] { return this.state.layer === 'internals' ? 'internals' : this.state.layer === 'armor' ? 'hull' : 'all'; }
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
  /** What the viewport draws. `retained` is the last accepted compile, kept through recompiles. */
  scene(retained: ConstructionResult | undefined): BuilderScene {
    const s = this.state, locked = this.locked, freeformMode = this.freeformMode, pathPart = this.pathPart, freeformPrimitive = this.freeformPrimitive;
    return {
      source: this.source, result: retained, current: this.compiled, catalog: this.catalog,
      selected: s.selected, selectedSurfaces: s.surfaces, view: s.view, perspective: s.perspective, display: this.display, fitRequest: s.fitRequest, armorScale: this.armorScale,
      snapping: this.effectiveSnapping, gridStep: this.gridStep, gesture: locked ? 'none' : this.gesture, pickTargets: this.pickTargets, moveTargets: locked || freeformMode ? 'none' : this.moveTargets,
      placementPiece: locked || freeformMode ? undefined : this.piece, placementMirror: this.mirrorPiece,
      highlightFaces: this.faceLayer, rooms: s.layer === 'internals', showCenters: s.showCenters, arcs: this.arcs, proposed: this.proposed, measure: s.measure, measuring: s.tool === 'measure',
      pathDraft: !locked && pathPart ? { part: pathPart, points: s.pathPoints, bearingDeg: s.pathBearing, heightM: s.railingHeight, railCount: s.railingRails, slackM: pathPart.path?.kind === 'rope' ? Math.min(s.ropeSlack, pathSlackLimit(s.pathPoints)) : 0, mirror: s.mirror } : undefined,
      rotation: this.rotationPrimitive && !locked ? { id: this.rotationPrimitive.id, axis: s.rotationAxis, snap: s.rotationSnap, onAxis: this.setRotationAxis, onCommit: this.rotateBlock } : undefined,
      freeform: freeformPrimitive && !locked ? { ...s.freeformSettings, id: freeformPrimitive.id, onSelect: selection => this.changeFreeformSettings({ selection }), onCommit: this.commitFreeform } : undefined,
    };
  }

  // ---- the edit door
  /** Submit one labelled batch; a fresh edit also clears the last notice. */
  run = (label: string, commands: ConstructionCommand[]): ConstructionSubmission => {
    // Refuse detached edits immediately; native compilation still validates saved/imported sources.
    if (commands.some(c => c.op === 'equipment' && c.value.wall) || this.data.equipment.some(e => e.wall) && commands.some(c => c.op === 'equipment' || c.op === 'move')) {
      try {
        const next = applyConstructionBatch(this.source, { version: 1, expectedRevision: this.source.revision, label, commands });
        for (const item of next.construction.equipment) {
          if (!item.wall || JSON.stringify(item) === JSON.stringify(this.data.equipment.find(e => e.id === item.id))) continue;
          const part = this.catalog.equipment.find(p => p.id === item.partId);
          if (!this.compiled || !part || !wallFittingSupported(item, part, this.compiled.surfaces)) {
            this.door.setError(this.compiled ? 'The full fitting needs a closed hull side or wall on each fitted side. Move away from edges, or turn Mirror off for a single fitting.' : 'Wait for the hull to finish compiling before placing wall fittings.');
            return { accepted: false, reason: 'invalid', message: 'Wall fitting has no matching support.' };
          }
        }
      } catch (error) { this.fail(error); return { accepted: false, reason: 'invalid', message: String(error) }; }
    }
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
  private command(label: string, commands: ConstructionCommand[]): ConstructionSubmission { return this.run(label, commands); }
  private refused(): ConstructionSubmission | undefined { const refusal = this.door.refusal; return refusal && { accepted: false, ...refusal }; }
  private fail = (cause: unknown) => this.door.setError(cause instanceof Error ? cause.message : String(cause));
  notify = (notice: string) => this.update({ notice });
  undo = () => { if (!this.locked) this.door.undo(); };
  redo = () => { if (!this.locked) this.door.redo(); };
  /** Face assignments as complete records, created from the skin default exactly as the editor helpers do. */
  private surfaceCommands(keys: ReadonlySet<string>, values: SurfaceValues): ConstructionCommand[] {
    const draft = { ...this.source, construction: { ...this.data, surfaces: this.data.surfaces.map(surface => ({ ...surface })) } };
    assignConstructionSurfaces(draft, keys, values);
    return draft.construction.surfaces.filter(surface => keys.has(surfaceSelectionKey(surface))).map(value => ({ op: 'surface', value }));
  }

  // ---- layer, tool and cards
  setTool = (tool: BuilderToolId) => this.update({ tool });
  switchLayer = (next: BuilderLayer) => {
    this.update({ layer: next, tool: DEFAULT_TOOL[next], surfaces: new Set(), measure: undefined, bearing: 0,
      ...(next === 'armor' || next === 'paint' ? { selected: new Set<string>() } : next === 'internals' ? { selected: new Set([...this.state.selected].filter(id => this.internalIds.has(id))) } : {}) });
  };
  /** Choose a card: true when it acted, so the caller closes the drawer and its tooltip. */
  toggleSlot = (item: SlotItem): boolean => {
    if (this.locked || item.kind === 'empty') return false;
    if (this.state.tool !== 'select' && this.active?.id === item.id && item.kind !== 'scheme') {
      this.update({ tool: 'select', pathPoints: [] });
      return true;
    }
    const acted = this.selectSlot(item);
    if (acted && this.state.tool === 'select' && !this.state.surfaces.size && ['armor', 'thickness', 'opening', 'paint'].includes(item.kind)) this.setTool('apply');
    return acted;
  };
  selectSlot = (item: SlotItem): boolean => {
    if (item.kind === 'empty' || this.locked) return false;
    const { layer, tool, surfaces } = this.state;
    // A fitting found by search may sit on another shelf or under another nation: the bar follows it there.
    let fittingFilter = this.state.fittingFilter;
    if (layer === 'fittings' && item.kind === 'part' && !this.palette.drawer.includes(item)) {
      const nation = fittingNation(item.part);
      fittingFilter = { category: fittingCategory(item.part, this.catalog), nation: nation && fittingFilter.nation !== 'all' && nation !== fittingFilter.nation ? 'all' : fittingFilter.nation };
    }
    this.update({ pathPoints: [], slots: { ...this.state.slots, [layer]: item.id }, sizeOverride: undefined, fittingFilter });
    const faceTools: BuilderToolId[] = ['apply', 'area', 'eyedrop', 'opening', 'select'];
    switch (item.kind) {
      case 'shape': this.clearSelection(); if (tool !== 'place' && tool !== 'fill') this.setTool('place'); break;
      case 'thickness': this.update({ customMm: item.mm }); // falls through: a value card behaves as the Armor card holding that value
      case 'armor': case 'opening': case 'paint':
        if (item.kind === 'paint' && this.selectedEquipment.length) { this.paintFittings([...this.state.selected], item.id); break; }
        if (surfaces.size) this.applyItem(item, surfaces); else if (!faceTools.includes(tool)) this.setTool('apply');
        break;
      case 'scheme': this.applyScheme(item.id); break;
      case 'tool': this.setTool(item.tool); break;
      case 'part': this.clearSelection(); this.setTool(layer === 'internals' ? 'module' : 'place'); break;
    }
    return true;
  };
  setSizeOverride = (size: Vec3) => this.update({ sizeOverride: size });
  setWindowRow = (windowRow: boolean) => this.update({ windowRow });
  setWindowSpacing = (windowSpacing: number) => this.update({ windowSpacing });
  setWallSize = (axis: 0 | 1, value: number) => {
    if (this.active?.kind !== 'part' || !wallMount(this.active.part)) return;
    const size: Vec3 = [...(this.state.sizeOverride ?? this.active.part.size)]; size[axis] = value;
    if (wallMount(this.active.part) === 'porthole') size[1-axis] = value;
    this.update({ sizeOverride: size });
  };
  setRailingHeight = (railingHeight: number) => this.update({ railingHeight });
  setRailingRails = (railingRails: 2 | 3) => this.update({ railingRails });
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
  toggleProjection = () => this.update({ perspective: !this.state.perspective });
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
    if (this.selectedEquipment.length && this.selectedEquipment.every(e => e.wall) && !this.selectedPrimitives.length) {
      const commands: ConstructionCommand[] = [], copied: string[] = [], handled = new Set<string>();
      for (const original of this.selectedEquipment) {
        if (handled.has(original.id)) continue;
        handled.add(original.id);
        if (original.wall!.mirrorId) handled.add(original.wall!.mirrorId);
        if (mirrorCopy && original.wall!.mirrorId) { this.notify('This fitting already has a linked mirror.'); continue; }
        if (mirrorCopy && !offCenterline(original.position)) { this.notify('A centerline fitting cannot have a separate mirrored partner.'); continue; }
        const a = structuredClone(original), b = mirroredEquipment(original);
        b.id = this.newId('equipment');
        if (mirrorCopy) {
          copied.push(b.id);
          a.wall!.mirrorId = b.id; b.wall!.mirrorId = a.id;
          commands.push({ op: 'equipment', value: a }, { op: 'equipment', value: b });
        } else {
          a.id = this.newId('equipment'); copied.push(a.id);
          const r = a.bearingDeg * Math.PI / 180, spacing = this.partOf(a)!.size[0] + .25;
          a.position[0] += Math.cos(r)*spacing; a.position[2] += Math.sin(r)*spacing;
          if (original.wall!.mirrorId) {
            copied.push(b.id);
            a.wall!.mirrorId = b.id;
            Object.assign(b, mirroredEquipment(a), { id: b.id, wall: { ...a.wall!, mirrorId: a.id } });
            commands.push({ op: 'equipment', value: a }, { op: 'equipment', value: b });
          } else { delete a.wall!.mirrorId; commands.push({ op: 'equipment', value: a }); }
        }
      }
      if (!commands.length) return undefined;
      if (this.data.equipment.length + copied.length > LIMITS.equipment) { this.door.setError('This copy would exceed the fittings limit. Remove a fitting first.'); return undefined; }
      const outcome = this.run(mirrorCopy ? 'Link mirrored fittings' : 'Copy wall fittings', commands);
      if (outcome.accepted) this.update({ selected: new Set(copied), surfaces: new Set() });
      return outcome;
    }
    const copied = copyConstructionSelection(next, selected, { mirror: mirrorCopy });
    if (!copied.length) return undefined;
    if (!blockPlacementAllowed(this.source, next.construction.primitives.filter(p => copied.includes(p.id)))) { this.update({ notice: OVERLAP_NOTICE }); return undefined; }
    const outcome = this.run(mirrorCopy ? 'Mirror selection' : 'Copy selection', constructionDiffCommands(this.source, next));
    if (!outcome.accepted) return outcome;
    this.update({ selected: new Set(copied), surfaces: new Set(), notice: mirrorCopy ? 'Mirrored a copy across the centerline.' : 'Copied the selection 1 m to starboard.' });
    return outcome;
  };
  centerSelection = (): ConstructionSubmission | undefined => {
    const centers = constructionSnapFeatures(this.source, this.catalog).filter(f => this.state.selected.has(f.owner) && f.kind === 'center');
    if (!centers.length) return undefined;
    const x = (Math.min(...centers.map(f => f.point[0])) + Math.max(...centers.map(f => f.point[0]))) / 2;
    return this.nudge([-x, 0, 0]);
  };
  nudge = (delta: Vec3): ConstructionSubmission | undefined => this.state.selected.size ? this.movePieces([...this.state.selected], delta) : undefined;
  /** Keep balcony edits and their physical seating in one undo transaction. */
  editPrimitive = (label: string, value: ConstructionPrimitive) => {
    const before = this.data.primitives.find(p => p.id === value.id);
    return this.run(label, [{ op: 'primitive', value: before ? reseatBalcony(this.source, before, value) : value }]);
  };
  /** A finished move drag or nudge retains the native overlap constraint. */
  movePieces = (ids: string[], requested: Vec3): ConstructionSubmission | undefined => {
    ids = ids.filter(this.selectable);
    if (!ids.length) return undefined;
    const refused = this.refused(); if (refused) return refused;
    const moving = new Set(ids);
    let delta = blockMoveConstraint(this.source, moving)(requested);
    if (delta.some((value, axis) => Math.abs(value - requested[axis]) > 1e-7)) this.update({ notice: OVERLAP_NOTICE });
    const wall = this.data.equipment.find(e => moving.has(e.id) && e.wall);
    if (wall) { const normal = wallNormal(wall.bearingDeg), d = delta.reduce((sum, v, k) => sum + v * normal[k], 0); delta = delta.map((v, k) => v - d * normal[k]) as Vec3; }
    if (delta.every(value => value === 0)) return undefined;
    const commands: ConstructionCommand[] = [{ op: 'move', ids, delta }];
    for (const wall of this.data.boundaries) if (moving.has(wall.id)) commands.push({ op: 'boundary', value: { ...wall, offset: wall.offset + delta[AXIS[wall.axis]] } });
    if (this.data.equipment.some(e=>moving.has(e.id)&&e.wall) && this.compiled) {
      const next=applyConstructionBatch(this.source,{version:1,expectedRevision:this.source.revision,label:'Move fittings',commands});
      for (const item of next.construction.equipment) {
        if (!item.wall || JSON.stringify(item.position)===JSON.stringify(this.data.equipment.find(e=>e.id===item.id)?.position)) continue;
        const part=this.partOf(item); if (part) commands.push({op:'equipment',value:seatWallFitting(item,part,this.compiled.surfaces)});
      }
    }
    const outcome = this.run('Move selection', commands);
    if (!outcome.accepted) return outcome;
    this.update({ selected: moving, surfaces: new Set() });
    return outcome;
  };
  rotate = (fine = false): ConstructionSubmission | undefined => {
    const piece = this.piece;
    if (piece?.kind === 'equipment' && piece.wall) { this.notify('Wall fittings turn automatically to match their wall.'); return undefined; }
    if (piece && piece.kind !== 'boundary') { this.update({ bearing: normalizedBearing(this.state.bearing + (piece.kind === 'hull' ? 90 : fine ? 1 : 15)) }); return undefined; }
    if (this.state.selected.size) return this.command('Rotate selection', [{ op: 'rotate', ids: [...this.state.selected], degrees: this.selectedPrimitives.length ? 90 : fine ? 1 : 15 }]);
    return undefined;
  };
  /** Empty ids rotate the cursor; fitted parts rotate in place as one source edit. */
  rotateFittings = (ids: string[], degrees: number): ConstructionSubmission | undefined => {
    if (!Number.isFinite(degrees) || Math.abs(degrees % 360) < 1e-6 || this.locked) return undefined;
    if (!ids.length) {
      if (this.piece?.kind === 'equipment') this.update({ bearing: normalizedBearing(this.state.bearing + degrees) });
      return undefined;
    }
    ids = ids.filter(id => this.selectable(id) && this.data.equipment.some(item => item.id === id && !item.wall));
    if (!ids.length) return undefined;
    return this.command('Rotate fittings', [{ op: 'rotate', ids, degrees }]);
  };
  /** A click or a finished stroke: one piece per point plus mirrored twins, as one undoable edit. */
  placeAt = (points: Vec3[], bearingDeg?: number, hullPlacement?: Extract<BuilderPlacement, { kind: 'hull' }>): ConstructionSubmission | undefined => {
    const piece = hullPlacement ?? this.piece, active = this.active, { mirror } = this.state;
    if (!piece) return undefined;
    const refused = this.refused(); if (refused) return refused;
    if (piece.kind === 'hull' && active?.kind === 'shape') {
      const pieces = placementBlocks(piece, points, mirror, () => this.newId('hull'));
      if (!blockPlacementAllowed(this.source, pieces)) { this.update({ notice: OVERLAP_NOTICE }); return undefined; }
      if (this.data.primitives.length + pieces.length > LIMITS.primitives) { this.door.setError(`A design supports up to ${LIMITS.primitives} hull pieces. Use larger pieces or remove a section before adding more.`); return undefined; }
      return this.run(pieces.length > 1 ? 'Lay hull pieces' : 'Place hull piece', pieces.map(value => ({ op: 'primitive', value })));
    }
    if (piece.kind === 'equipment' && active?.kind === 'part') {
      const parts: ConstructionEquipment[] = [];
      for (const point of points) {
        // The viewport already snaps the face plane; retain the exact socket height.
        parts.push({ id: this.newId('equipment'), partId: active.id, position: [...point], bearingDeg: bearingDeg ?? piece.bearingDeg, ...(piece.wall ? { wall: { ...piece.wall } } : {}), ...(this.state.layer === 'fittings' && this.state.fittingPaint ? { paint: this.state.fittingPaint } : {}) });
        if (piece.wall && points.length > 1 && this.compiled) parts[parts.length-1]=seatWallFitting(parts.at(-1)!,active.part,this.compiled.surfaces);
        if (mirror && offCenterline(point)) {
          const original = parts.at(-1)!, twin = { ...mirroredEquipment(original), id: this.newId('equipment') };
          if (original.wall) { original.wall.mirrorId = twin.id; twin.wall = { ...original.wall, mirrorId: original.id }; }
          parts.push(twin);
        }
      }
      if (this.data.equipment.length + parts.length > LIMITS.equipment) { this.door.setError(`A design supports up to ${LIMITS.equipment} fittings. Remove a fitting before adding more.`); return undefined; }
      return this.run(parts.length > 1 ? 'Place fittings' : `Place ${active.name}`, parts.map(value => ({ op: 'equipment', value })));
    }
    return undefined;
  };
  drawLadder = (points: Vec3[], bearingDeg: number): ConstructionSubmission | undefined => {
    const part=this.pathPart;
    if(part?.path?.kind !== 'ladder' || this.refused())return;
    const problem=pathProblem(points);
    if(problem){this.door.setError(problem);return;}
    const item=pathEquipment(this.newId('ladder'),part.id,points,0,bearingDeg);
    if(this.state.fittingPaint)item.paint=this.state.fittingPaint;
    const parts=[item];
    if(this.state.mirror && points.some(p=>Math.abs(p[0])>1e-6))parts.push({...mirroredEquipment(item),id:this.newId('ladder')});
    if(!this.compiled || parts.some(e=>!fittedLadder(part,e,this.compiled!.surfaces))){this.door.setError('Every rung needs a closed hull side behind both ends. Move away from edges or turn Mirror off.');return;}
    const outcome=this.run('Draw surface ladder',parts.map(value=>({op:'equipment',value})));
    if(outcome.accepted)this.update({pathPoints:[],selected:new Set(parts.map(p=>p.id)),tool:'select'});
    return outcome;
  };
  addPathPoint = (point: Vec3, bearingDeg = 0) => {
    if (this.locked) return;
    if (this.pathPart?.path?.kind === 'ladder' && this.state.pathPoints.length) {
      const points = appendPathPoint(this.state.pathPoints, point);
      if (points.length === 2) this.drawLadder(points, this.state.pathBearing);
      return;
    }
    if (this.state.pathPoints.length >= 64) { this.update({ notice: '64 points reached. Finish this path before starting another.' }); return; }
    if (!this.locked) this.update({ pathPoints: appendPathPoint(this.state.pathPoints, point), pathBearing: this.state.pathPoints.length ? this.state.pathBearing : bearingDeg, selected: new Set(), surfaces: new Set() });
  };
  popPathPoint = () => this.update({ pathPoints: this.state.pathPoints.slice(0, -1) });
  clearPath = () => this.update({ pathPoints: [] });
  cancelPath = (clearNotice = true) => this.update({ pathPoints: [], tool: 'select', ...(clearNotice ? { notice: '' } : {}) });
  /** The route and its mirrored copy become one undoable edit; the new fittings are then selected. */
  finishPath = (): ConstructionSubmission | undefined => {
    const pathPart = this.pathPart, { pathPoints, ropeSlack, mirror } = this.state;
    if (!pathPart) return undefined;
    const refused = this.refused(); if (refused) return refused;
    if (pathPart.path?.kind === 'ladder') return this.drawLadder(pathPoints, this.state.pathBearing);
    const slackM = pathPart.path?.kind === 'rope' ? Math.min(ropeSlack, pathSlackLimit(pathPoints)) : 0, problem = pathProblem(pathPoints, slackM);
    if (problem) { this.update({ notice: problem }); return undefined; }
    const item = pathEquipment(this.newId('path'), pathPart.id, pathPoints, slackM);
    if (pathPart.path?.kind === 'railing') Object.assign(item.path!, { heightM: this.state.railingHeight, railCount: this.state.railingRails });
    if (this.state.fittingPaint) item.paint = this.state.fittingPaint;
    const parts = [item];
    if (mirror && pathPoints.some(point => Math.abs(point[0]) > 1e-6)) parts.push({ ...mirroredEquipment(item), id: this.newId('path') });
    if (this.data.equipment.length + parts.length > LIMITS.equipment) { this.update({ notice: 'The fittings limit is reached. Remove a fitting before adding this path.' }); return undefined; }
    const outcome = this.run(`Draw ${pathPart.path!.kind} path`, parts.map(value => ({ op: 'equipment', value })));
    this.update({ pathPoints: [], selected: new Set(parts.map(part => part.id)), tool: 'select' });
    return outcome;
  };
  addBoundary = (axis: ConstructionBoundary['axis'], offset: number): ConstructionSubmission | undefined => {
    if (this.data.boundaries.length >= LIMITS.boundaries) { this.door.setError(`A design supports up to ${LIMITS.boundaries} decks and bulkheads. Merge rooms before adding more.`); return undefined; }
    if (this.data.boundaries.some(wall => wall.axis === axis && Math.abs(wall.offset - offset) < 1e-6)) { this.update({ notice: `A ${BOUNDARY_NAMES[axis].toLowerCase()} already sits here.` }); return undefined; }
    return this.run(`Add ${BOUNDARY_NAMES[axis].toLowerCase()}`, [{ op: 'boundary', value: { id: this.newId('boundary'), axis, offset, thicknessMm: 10 } }]);
  };
  /** Mirror placement reaches the twin face across the centerline, including the far side of a straddling piece. */
  withMirrorFaces(keys: ReadonlySet<string>): Set<string> {
    if (!this.state.mirror) return new Set(keys);
    const out = new Set(keys), editableKeys = this.editableKeys;
    for (const key of keys) {
      const surface = this.editableSurfaces.find(surface => surfaceSelectionKey(surface) === key);
      if (!surface) continue;
      const { primitiveId, face, panelId } = surface;
      const primitive = this.data.primitives.find(part => part.id === primitiveId), twin = primitive && mirrorTwin(this.source, primitive);
      const reflected = primitive && twin ? surfaceKey(twin.id, mirroredFace(face as ConstructionFace, primitive.kind), mirroredPanelId(panelId)) : undefined;
      if (reflected && editableKeys.has(reflected)) out.add(reflected);
    }
    return out;
  }
  applyItem = (item: SlotItem, keys: ReadonlySet<string>, thickness = this.state.customMm): ConstructionSubmission | undefined => {
    if (!keys.size) return undefined;
    const target = this.withMirrorFaces(keys);
    const assign = (label: string, values: SurfaceValues) => this.run(label, this.surfaceCommands(target, values));
    switch (item.kind) {
      case 'thickness': thickness = item.mm; // falls through
      case 'armor': return assign(`Assign ${thickness} mm armor`, { thicknessMm: thickness, material: thickness > 0 ? 'armor-steel' : 'steel', open: false });
      case 'opening': return assign('Open faces to sea', { open: true });
      case 'paint': return assign(`Paint ${item.name.toLowerCase()}`, { paint: item.id });
      default: return undefined;
    }
  };
  setFinish = (finish?: ConstructionSource['construction']['finish']): ConstructionSubmission | undefined => {
    if (finish !== undefined && !isConstructionSurfaceFinish(finish)) return undefined;
    return this.run('Set ship surface finish', [{ op: 'finish', finish }]);
  };
  /** Paint whole installations without changing the shared component or other instances. */
  paintFittings = (ids: readonly string[], paint?: string): ConstructionSubmission | undefined => {
    if (paint && !CONSTRUCTION_PAINTS.some(entry => entry.id === paint)) return undefined;
    const targets = new Set(ids);
    const fittings = this.data.equipment.filter(item => this.partOf(item)?.placement !== 'internal');
    if (this.state.mirror) for (const item of fittings) if (targets.has(item.id)) {
      const twin = mirrorTwinEquipment(this.source, item); if (twin) targets.add(twin.id);
    }
    const commands = fittings.filter(item => targets.has(item.id)).map((item): ConstructionCommand => {
      const value = { ...item }; if (paint) value.paint = paint; else delete value.paint;
      return { op: 'equipment', value };
    });
    if (!commands.length) return undefined;
    const outcome = this.run(paint ? 'Paint fittings' : 'Restore original fitting finish', commands);
    if (outcome.accepted) this.update({ fittingPaint: paint });
    return outcome;
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
    if (layer === 'paint' && hit.id) {
      const fitting = this.data.equipment.find(item => item.id === hit.id);
      if (fitting) {
        if (tool === 'apply' && this.active?.kind === 'paint') return this.paintFittings([fitting.id], this.active.id);
        if (tool === 'eyedrop') {
          if (fitting.paint) this.update({ slots: { ...this.state.slots, paint: fitting.paint }, tool: 'apply', notice: 'Paint picked from fitting.' });
          else this.update({ notice: 'This fitting uses its original component finish. Choose a paint to recolor it.' });
        } else { this.update({ surfaces: new Set() }); this.choose(fitting.id, hit.additive); }
        return undefined;
      }
    }
    if (layer === 'armor' || layer === 'paint') {
      if (!hit.additive) this.update({ selected: new Set() });
      if (!hit.surface) { if (!hit.additive) this.update({ surfaces: new Set() }); if (hit.id && tool === 'select') this.choose(hit.id, hit.additive); else if (!hit.additive) this.update({ selected: new Set() }); return undefined; }
      if (!this.compiled && !this.retained) { this.update({ notice: 'Face editing resumes when this source has a compiled preview.' }); return undefined; }
      if (!this.editableKeys.has(hit.surface)) { this.update({ notice: 'This fixed equipment support follows its fitting. Choose a hull face to edit.' }); return undefined; }
      const surface = this.editableSurfaces.find(entry => surfaceSelectionKey(entry) === hit.surface)!;
      switch (tool) {
        case 'apply': return this.applyFaces([hit.surface]);
        case 'area': { const next = hit.additive ? new Set(this.state.surfaces) : new Set<string>(); for (const entry of this.editableSurfaces) if (entry.face === surface.face) next.add(surfaceSelectionKey(entry)); this.update({ surfaces: next }); return undefined; }
        case 'eyedrop':
          if (layer === 'armor') this.update({ customMm: surface.thicknessMm, slots: { ...this.state.slots, armor: 'armor' }, notice: `Armor thickness set to ${surface.thicknessMm} mm from the picked face.`, tool: 'apply' });
          else this.update({ slots: { ...this.state.slots, paint: surface.paint }, notice: 'Paint slot set from the picked face.', tool: 'apply' });
          return undefined;
        case 'opening': return this.applyFaces([hit.surface]);
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
  /** A face sweep: the Paint tool assigns the active card to every face the drag crossed and their mirrors; Opening sets them all to the first face's opposite state. */
  applyFaces = (keys: readonly string[]): ConstructionSubmission | undefined => {
    if (this.locked || !this.faceLayer) return undefined;
    if (!this.compiled && !this.retained) { this.update({ notice: 'Face editing resumes when this source has a compiled preview.' }); return undefined; }
    const editable = keys.filter(key => this.editableKeys.has(key));
    if (!editable.length) { if (keys.length) this.update({ notice: 'This fixed equipment support follows its fitting. Choose a hull face to edit.' }); return undefined; }
    const target = new Set(editable), tool = this.state.tool;
    if (tool === 'opening') {
      const first = this.editableSurfaces.find(entry => surfaceSelectionKey(entry) === editable[0])!;
      return this.run(first.open ? 'Close skin' : 'Open faces to sea', this.surfaceCommands(this.withMirrorFaces(target), { open: !first.open }));
    }
    return tool === 'apply' && this.active ? this.applyItem(this.active, target) : undefined;
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
      case 'lay': return this.placeAt(event.points, event.bearingDeg, event.hullPlacement);
      case 'faces': return this.applyFaces(event.surfaces);
      case 'box': this.boxSelect(event.ids, event.additive); return undefined;
      case 'erase': return this.erase(event.id);
      case 'move': return this.movePieces(event.ids, event.delta);
      case 'rotate': return this.rotateFittings(event.ids, event.degrees);
      case 'ladder-draw': return this.drawLadder(event.points,event.bearingDeg);
      case 'path-point': this.addPathPoint(event.point, event.bearingDeg); return undefined;
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
    for (const item of next.construction.equipment) if (this.state.fittingPaint && !this.data.equipment.some(existing => existing.id === item.id) && this.partOf(item)?.placement !== 'internal') item.paint = this.state.fittingPaint;
    const outcome = this.run('Apply suggested layout', constructionDiffCommands(this.source, next));
    this.update({ suggestion: undefined });
    return outcome;
  };

  // ---- freeform hulls
  changeFreeformSettings = (patch: Partial<FreeformSettings>) => this.update({ freeformSettings: { ...this.state.freeformSettings, ...patch } });
  cycleUnit = () => this.changeFreeformSettings({ unit: VERTEX_UNITS[(VERTEX_UNITS.findIndex(unit => unit === this.state.freeformSettings.unit) + 1) % VERTEX_UNITS.length] });
  cycleGrid = () => this.freeformMode ? this.cycleUnit() : this.cycleSnap();
  /** True when a single editable block entered freeform editing, so the caller closes the drawer. */
  enterFreeform = (): boolean => {
    const part = this.selectedPrimitives[0];
    if (!part || this.state.selected.size !== 1 || !canEditVertices(part)) return false;
    const converted=editableMesh(part);
    if(converted.mesh&&!part.mesh&&!this.commitFreeform([converted])?.accepted)return false;
    this.update({ tool: 'select', layer: 'hull', surfaces: new Set(), freeformSettings:{...this.state.freeformSettings,selection:{mode:'vertex',index:0}}, freeform: { designId: this.source.id, baseline: structuredClone(part) } });
    return true;
  };
  exitFreeform = () => this.update({ freeform: undefined });
  commitFreeform = (replacements: ConstructionPrimitive[]): ConstructionSubmission | undefined =>
    replacements.length ? this.run('Shape freeform hull', replacements.filter(part => this.data.primitives.some(existing => existing.id === part.id)).map(value => ({ op: 'primitive', value }))) : undefined;
  resetFreeform = () => { const freeform = this.state.freeform; return freeform ? this.run('Reset hull edit', [{ op: 'primitive', value: editableMesh(freeform.baseline) }]) : undefined; };
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
    if (s.tool === 'rotate' && !modifier && !event.altKey) {
      if (['x', 'y', 'z'].includes(lower)) { event.preventDefault(); this.setRotationAxis('xyz'.indexOf(lower)); return; }
      if (lower === 'r') { event.preventDefault(); if (!event.repeat) this.rotateBlock(s.rotationAxis, event.shiftKey ? -90 : 90); return; }
      if (event.key === 'Escape') { event.preventDefault(); this.setTool('select'); return; }
    }
    if (!modifier && !event.altKey && lower === 'n') { event.preventDefault(); if (!event.repeat) this.toggleSnapping(); return; }
    if (!modifier && !event.altKey && lower === 's') { event.preventDefault(); if (!event.repeat) this.cycleGrid(); return; }
    if (!modifier && !event.altKey && lower === 'p') { event.preventDefault(); if (!event.repeat) this.toggleProjection(); return; }
    if(!modifier&&!event.altKey&&lower==='d'&&s.layer==='hull'&&!pathPart){
      event.preventDefault();if(!event.repeat){if(this.freeformMode)this.exitFreeform();else if(this.enterFreeform())chrome.slotChosen();}return;
    }
    if (this.freeformMode && !modifier) {
      if (event.key === 'Escape') { this.exitFreeform(); event.preventDefault(); return; }
      if (lower === 'g') { this.cycleUnit(); event.preventDefault(); return; }
      if (lower === 'o') { this.toggleProjection(); event.preventDefault(); return; }
      // The view strip stays visible while shaping, so its keys keep working.
      if (!['w', 'q', 's', 'c'].includes(lower) && event.key !== 'Home') return;
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
      if (s.selected.size && this.selectedEquipment.length === s.selected.size && this.selectedEquipment.every(item => this.partOf(item)?.kind === 'gun')) this.raiseTurrets([...s.selected], current => Math.max(0, Math.min(30, current + direction * this.gridStep)));
      else if (s.selected.size) this.nudge([0, direction * this.gridStep, 0]);
      return;
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && (this.piece?.kind === 'equipment' && this.piece.wall || this.selectedEquipment.length && this.selectedEquipment.length === s.selected.size && this.selectedEquipment.every(e=>e.wall))) {
      event.preventDefault();
      const axis = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 0 : 1;
      const amount = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? .01 : .1);
      const resize = (value: number) => Math.max(.15, Math.min(5, Math.round((value+amount)*100)/100));
      const piece = this.piece;
      if (piece?.kind === 'equipment' && piece.wall) this.setWallSize(axis, resize(axis ? piece.wall.heightM : piece.wall.widthM));
      else {
        const handled = new Set<string>(), commands: ConstructionCommand[] = [];
        for (const item of this.selectedEquipment) {
          if (handled.has(item.id)) continue;
          handled.add(item.id); if (item.wall!.mirrorId) handled.add(item.wall!.mirrorId);
          const value = structuredClone(item), w=value.wall!, size=resize(axis ? w.heightM : w.widthM);
          if (axis === 0 || wallMount(this.partOf(item)!) === 'porthole') w.widthM=size;
          if (axis === 1 || wallMount(this.partOf(item)!) === 'porthole') w.heightM=size;
          commands.push({op:'equipment', value});
        }
        this.run('Resize wall fittings',commands);
      }
      return;
    }
    if (event.key.startsWith('Arrow') && s.selected.size) {
      event.preventDefault(); const step = this.gridStep;
      this.nudge(event.key === 'ArrowLeft' ? [-step, 0, 0] : event.key === 'ArrowRight' ? [step, 0, 0] : event.key === 'ArrowUp' ? [0, 0, -step] : [0, 0, step]);
      return;
    }
    if (/^[1-9]$/.test(event.key)) { const item = this.palette.bar[Number(event.key) - 1]; if (item && this.selectSlot(item)) chrome.slotChosen(); return; }
    if (event.key === '0') { if (this.hasDrawer) { event.preventDefault(); chrome.toggleDrawer(); } return; }
    if (lower === 'q') this.cycleView(); else if (lower === 'w') chrome.toggleWarnings();
    else if (lower === 'r') this.rotate(event.shiftKey); else if (lower === 'm') this.toggleMirror(); else if (lower === 'c') this.toggleCenters();
    else if (lower === 'a' && s.layer === 'fittings') this.toggleArcs();
    else { const entry = this.rail.find(entry => entry.key.toLowerCase() === lower); if (entry) this.activateRail(entry); }
  }
}
