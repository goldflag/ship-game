import { wallMount, installedWallPart, withWallTurn, mirroredWall } from '../../ships/constructionWallFittings';
import { DEFAULT_SNAPPING, type SnapSettings } from './snapping';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface } from '../../ships/blueprint';
import { editableConstructionSurfaces, mirroredPrimitive, projectConstructionSurfaces, surfaceSelectionKey } from '../../ships/constructionEditor';
import { BUILDER_RAIL, paletteFor, type BuilderLayer, type BuilderTab, type BuilderToolId, type RailEntry, type SlotItem } from './builderLayers';
import { FITTING_GROUPS, fittingCategory, fittingGroup, shelfNations, type FittingFilter, type FittingNation } from './fittingCategories';
import type { HullCategory } from './hullCategories';
import { mirrorTwin } from './placement';
import { mirrorTwins } from './mirrorEditing';
import { internalSelectionIds } from './internalSelection';
import { installedTurretThicknesses } from './turretArmor';
import { normalizedBearing } from './editorNumbers';
import type { BuilderArc, BuilderGesture, BuilderMoveTargets, BuilderPlacement, BuilderProposal, BuilderScene } from './builderScene';
import type { ArmorScale } from '../../ships/inspection';
import { type BuilderToolState, type BuilderRevisionDoor, type BuilderToolContext, BUILDER_DISPLAY, ARC_RADIUS, NO_TWINS } from './builderToolState';

/** Everything the builder derives from its state, the open source and the catalog: palette, selection, cursor piece,
 * faces, gestures and targets. Getters only read; the caches keep identities stable between renders. `BuilderTool`
 * extends this class with the state changes and edits. */
export class BuilderSelectors {
  /** The tool state. Read it through `getSnapshot()`; only the builder modules assign it. */
  state: BuilderToolState;
  private paletteCache?: { layer: BuilderLayer; catalog: ConstructionCatalog; thicknesses: string; filter: FittingFilter; hullCategory: HullCategory; palette: ReturnType<typeof paletteFor> };
  private surfaceCache?: { source: ConstructionSource; catalog: ConstructionCatalog; compiled?: ConstructionResult; retained?: ConstructionResult; surfaces: ConstructionSurface[]; keys: Set<string>; thicknesses: number[]; armorScale: ArmorScale };
  private pieceCache?: { key: string; piece?: BuilderPlacement };
  private internalCache?: { source: ConstructionSource; catalog: ConstructionCatalog; ids: Set<string> };
  private mirrorCache?: { key: string; piece?: BuilderPlacement };
  private twinCache?: { source: ConstructionSource; selected: ReadonlySet<string>; twins: ReadonlyMap<string, string> };

  constructor(readonly door: BuilderRevisionDoor, readonly context: BuilderToolContext, initial: Partial<BuilderToolState> = {}) {
    this.state = {
      layer: 'hull', tool: 'select', slots: { hull: 'cube', armor: 'armor', internals: 'deck', fittings: '', paint: 'naval-gray' }, fittingFilter: { category: 'main-battery', nation: 'all' },
      groupShelves: { machinery: 'running-gear', armament: 'main-battery', outfit: 'mooring' },
      hullCategory: 'all', windowRow: false, windowSpacing: 1.5, customMm: 10, bearing: 0, wallTurn: 0, pathPoints: [], pathBearing: 0, ropeSlack: .15, railingHeight: 1.1, mirror: true, showArcs: false, showCenters: false, snapSteps: { hull: 1, equipment: .25 },
      snapping: { ...DEFAULT_SNAPPING }, snapOverride: false, rotationAxis: 1, rotationSnap: true,
      freeformSettings: { axes: [true, false, false], unit: .2, snap: false, splitAxis: 2, count: 4, selection: { mode: 'face', index: 5 } },
      view: 'orbit', perspective: true, fitRequest: 0,
      selected: new Set<string>(), surfaces: new Set(), notice: '', ...initial,
    };
  }

  get source() { return this.door.source; }
  get data() { return this.door.source.construction; }
  get catalog() { return this.context.catalog(); }
  get compiled() { return this.context.compiled(); }
  get retained() { return this.context.retained?.(); }
  get locked() { return this.door.locked; }
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
  get active(): SlotItem | undefined { return this.palette.drawer.find(item => item.id === this.state.slots[this.state.layer]) ?? this.palette.drawer[0]; }
  /** The dock tab: the layer, or on Fittings the group of the open shelf. */
  get tab(): BuilderTab { return this.state.layer === 'fittings' ? fittingGroup(this.state.fittingFilter.category) : this.state.layer; }
  get drawerName() { return this.state.layer === 'fittings' ? FITTING_GROUPS.find(group => group.id === this.tab)!.name.toLowerCase() : this.state.layer === 'hull' ? 'shapes' : 'items'; }
  get hasDrawer() { return this.palette.drawer.length > this.palette.bar.filter(item => item.kind !== 'empty').length || this.state.layer === 'fittings' || this.state.layer === 'hull'; }
  protected pathPartOf(state: BuilderToolState): ConstructionEquipmentPart | undefined {
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
  get freeformPrimitive(): ConstructionPrimitive | undefined {
    const { freeform, layer, tool, selected } = this.state;
    if (!freeform || freeform.designId !== this.source.id || layer !== 'hull' || tool !== 'select' || selected.size !== 1 || !selected.has(freeform.baseline.id)) return undefined;
    return this.data.primitives.find(part => part.id === freeform.baseline.id && (part.kind==='box'||part.kind==='vertex'));
  }
  get freeformMode() { return !!this.freeformPrimitive; }
  /** The twins that follow the selection's edits; the viewport outlines them in mint. */
  get selectionTwins(): ReadonlyMap<string, string> {
    const { selected, mirror } = this.state, source = this.source;
    if (!mirror || !selected.size) return NO_TWINS;
    if (!this.twinCache || this.twinCache.source !== source || this.twinCache.selected !== selected) this.twinCache = { source, selected, twins: mirrorTwins(source, selected) };
    return this.twinCache.twins;
  }
  /** The block that mirrors the one being shaped, whether or not Mirror is on. */
  get freeformTwin(): ConstructionPrimitive | undefined {
    const primitive = this.freeformPrimitive, twin = primitive && mirrorTwin(this.source, primitive);
    return twin && twin.id !== primitive!.id ? twin : undefined;
  }
  partOf = (instance: ConstructionEquipment) => { const part = this.catalog.equipment.find(part => part.id === instance.partId); return part && installedWallPart(part, instance); };
  /** Faces from the current compile, or from the last one with this source's assignments over them while a compile is pending. */
  private get surfaceState() {
    const source = this.source, compiled = this.compiled, retained = compiled ? undefined : this.retained;
    if (!this.surfaceCache || this.surfaceCache.source !== source || this.surfaceCache.catalog !== this.catalog || this.surfaceCache.compiled !== compiled || this.surfaceCache.retained !== retained) {
      const surfaces = editableConstructionSurfaces(source, compiled?.surfaces ?? (retained ? projectConstructionSurfaces(source, retained.surfaces) : []));
      const thicknesses = [...new Set(surfaces.filter(surface => !surface.open).map(surface => surface.thicknessMm))].sort((a, b) => b - a);
      // Turret plates are fixed catalog armor, not value cards, but they share the colour scale so the whole ship reads alike.
      const scaled = [...thicknesses, ...installedTurretThicknesses(source, this.catalog)];
      this.surfaceCache = { source, catalog: this.catalog, compiled, retained, surfaces, keys: new Set(surfaces.map(surface => surfaceSelectionKey(surface))), thicknesses, armorScale: { fromMm: scaled.length ? Math.min(...scaled) : 0, toMm: scaled.length ? Math.max(...scaled) : 0 } };
    }
    return this.surfaceCache;
  }
  /** Native hull faces that accept armor, paint and openings: fixed equipment supports are excluded. */
  get editableSurfaces() { return this.surfaceState.surfaces; }
  get editableKeys(): ReadonlySet<string> { return this.surfaceState.keys; }
  /** Every thickness on the ship, thickest first; the Armor layer's value cards. */
  get thicknesses(): readonly number[] { return this.surfaceState.thicknesses; }
  /** The ship's thinnest and thickest plates, turrets included: the ends of the Armor layer's relative colour scale. */
  get armorScale(): ArmorScale { return this.surfaceState.armorScale; }
  /** Fittings and modules snap on the equipment step; everything else on the hull step. */
  get snapKind(): 'hull' | 'equipment' { const { layer, tool } = this.state; return layer === 'fittings' || (layer === 'internals' && tool === 'module') ? 'equipment' : 'hull'; }
  get effectiveSnapping(): SnapSettings { return { ...this.state.snapping, enabled: this.state.snapping.enabled !== this.state.snapOverride }; }
  get gridStep() { return this.state.snapSteps[this.snapKind]; }
  get display() { return BUILDER_DISPLAY[this.state.layer]; }
  get faceLayer() { return this.state.layer === 'armor' || this.state.layer === 'paint'; }
  /** The cursor piece: the shape, fitting or boundary a click would place. Identity is stable while its description is. */
  get piece(): BuilderPlacement | undefined {
    const { layer, tool, sizeOverride, bearing, tilt } = this.state, active = this.active, catalog = this.catalog;
    let piece: BuilderPlacement | undefined;
    if (layer === 'hull' && (tool === 'place' || tool === 'fill') && active?.kind === 'shape') piece = { kind: 'hull', shape: active.shape.kind, size: sizeOverride ?? active.shape.size, rotationDeg: normalizedBearing(Math.round(bearing / 90) * 90), ...(tilt && active.shape.kind !== 'balcony' ? { tilt } : {}) };
    else if (((layer === 'fittings' && tool === 'place') || (layer === 'internals' && tool === 'module')) && active?.kind === 'part' && !active.part.path) {
      const gun = active.part.gunPartId ? catalog.weapons.parts.find(gun => gun.id === active.part.gunPartId) : undefined;
      const mount = wallMount(active.part), wall = mount ? withWallTurn({ version: 1 as const, widthM: sizeOverride?.[0] ?? active.part.size[0], heightM: sizeOverride?.[1] ?? active.part.size[1] }, this.state.wallTurn) : undefined;
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
      if (piece.kind === 'hull') { const mirrored = mirroredPrimitive({ id: '', kind: piece.shape, size: piece.size, position: [1, 0, 0], rotationDeg: piece.rotationDeg, ...(piece.tilt ? { tilt: piece.tilt } : {}) }); twin = { kind: 'hull', shape: mirrored.kind, size: mirrored.size, rotationDeg: mirrored.rotationDeg, ...(mirrored.tilt ? { tilt: mirrored.tilt } : {}) }; }
      else if (piece.kind === 'equipment') twin = { ...piece, bearingDeg: normalizedBearing(-piece.bearingDeg), arc: undefined, ...(piece.wall ? { wall: mirroredWall(piece.wall) } : {}) };
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
  /** Where Escape and a toggled-off card return: Select, or on Armor, which has no selection, the Paint brush. */
  get restTool(): BuilderToolId { return this.state.layer === 'armor' ? 'apply' : 'select'; }
}
