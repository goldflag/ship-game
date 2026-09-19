import { resizedWallDimensions } from './wallDimensions';
import { rotateBlock } from '../../ships/constructionOrientation';
import { editableMesh } from '../../ships/constructionMesh';
import { wallMount, wallFittingSupported } from '../../ships/constructionWallFittings';
import type { SnapSettings } from './snapping';
import type { ConstructionResult, Vec3 } from '../../ships/blueprint';
import { newConstructionId } from '../../ships/constructionEditor';
import { applyConstructionBatch, type ConstructionCommand } from '../../ships/constructionCommands';
import type { ConstructionSubmission } from '../../ships/constructionRevisionOwner';
import { selectionCorners, VERTEX_UNITS } from '../../ships/constructionVertex';
import { pathSlackLimit } from '../../ships/constructionPaths';
import { DEFAULT_TOOL, type BuilderLayer, type BuilderTab, type BuilderToolId } from './builderLayers';
import { FITTING_GROUPS, fittingGroup, type FittingFilter, type FittingGroup } from './fittingCategories';
import type { HullCategory } from './hullCategories';
import type { BuilderPointerEvent, BuilderScene } from './builderScene';
import { type FreeformSettings, type BuilderToolState, type BuilderRevisionDoor, type BuilderToolContext, type BuilderChrome, type BuilderKey, BUILDER_VIEWS, SNAP_STEPS, NO_TWINS, FREEFORM_MODES, freeformSelection } from './builderToolState';
import { BuilderSelectors } from './builderSelectors';
import * as rotation from './builderActions/rotation';
import * as mirror from './builderActions/mirror';
import * as editing from './builderActions/editing';
import * as surfaces from './builderActions/surfaces';
import * as cards from './builderActions/cards';
import * as placement from './builderActions/placement';
import * as paths from './builderActions/paths';
import * as picking from './builderActions/picking';
import * as suggestions from './builderActions/suggestions';
import * as freeform from './builderActions/freeform';

export * from './builderToolState';

/** The shipbuilder's tool: layer, tool, selection, cursor piece, gestures and readiness in one
 * plain module. Pointer events arrive with their targets already raycast; every edit leaves as a
 * command batch through the revision door, which answers with an accepted or refused submission.
 * Nothing here imports React or three.js. `scene()` is the render description the viewport draws.
 *
 * Derived getters live in `builderSelectors.ts` (the base class); the larger actions live in
 * `builderActions/*` as functions bound here under the same names. Members the UI never calls
 * (`state`, `door`, `context`, `update`, `command`, `refused`, `fail`, `newId`, `twinsOf`, `mirrored`,
 * `surfaceCommands`, `suggestionRequest`) are open only so those modules can reach them. */
export class BuilderTool extends BuilderSelectors {
  private listeners = new Set<() => void>();
  private lastSourceId: string;
  private lastRevision: string;
  suggestionRequest?: AbortController;
  private readonly unsubscribe: () => void;

  constructor(door: BuilderRevisionDoor, context: BuilderToolContext, initial: Partial<BuilderToolState> = {}) {
    super(door, context, initial);
    this.lastSourceId = door.source.id; this.lastRevision = door.source.revision;
    this.unsubscribe = door.subscribe(this.observe);
  }
  dispose() { this.unsubscribe(); this.suggestionRequest?.abort(); this.suggestionRequest = undefined; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  // ---- the world the tool reads
  newId(prefix: string) { return this.context.newId ? this.context.newId(prefix) : newConstructionId(prefix); }

  // ---- state changes
  update(patch: Partial<BuilderToolState>) {
    const previous = this.state, next = { ...previous, ...patch };
    const category = next.fittingFilter.category;
    if (next.groupShelves[fittingGroup(category)] !== category) next.groupShelves = { ...next.groupShelves, [fittingGroup(category)]: category };
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
    if(p&&!selectionCorners(this.state.freeformSettings.selection,p).length)this.state={...this.state,freeformSettings:{...this.state.freeformSettings,selection:freeformSelection(p)}};
  }
  /** The revision owner changed: a new design clears selections and proposals; a new revision retires a pending layout request. */
  private observe = () => {
    const source = this.door.source;
    let patch: Partial<BuilderToolState> | undefined;
    if (source.id !== this.lastSourceId) {
      patch = { selected: new Set(), surfaces: new Set(), suggestion: undefined, measure: undefined, pathPoints: [], tool: this.restTool };
    }
    if (source.revision !== this.lastRevision) { this.suggestionRequest?.abort(); this.suggestionRequest = undefined; }
    this.lastSourceId = source.id; this.lastRevision = source.revision;
    if (patch) this.update(patch);
    else { const before = this.state; this.reconcile(); if (this.state !== before) for (const listener of this.listeners) listener(); }
  };

  /** Open a shelf or narrow it; the bar's first card is taken up when the held one is no longer on it. */
  setFittingFilter = (patch: Partial<FittingFilter>) => { this.update({ fittingFilter: { ...this.state.fittingFilter, ...patch }, pathPoints: [], sizeOverride: undefined }); };
  setHullCategory = (hullCategory: HullCategory) => { if (hullCategory !== this.state.hullCategory) this.update({ hullCategory, sizeOverride: undefined }); };
  setRotationAxis = (rotationAxis: number) => { if ([0, 1, 2].includes(rotationAxis)) this.update({ rotationAxis }); };
  toggleRotationSnap = () => this.update({ rotationSnap: !this.state.rotationSnap });
  rotateBlock = rotation.rotateSelectedBlock.bind(this);
  setBlockAngle = rotation.setBlockAngle.bind(this);
  resetBlockRotation = rotation.resetBlockRotation.bind(this);
  // ---- mirror editing: with Mirror on, an edit also reaches the piece that already mirrors it across the centerline
  twinsOf = mirror.twinsOf.bind(this);
  mirrored = mirror.mirrored.bind(this);
  /** One labelled edit that also reaches the twins of the pieces it changes. */
  edit = (label: string, commands: ConstructionCommand[]) => this.run(label, this.mirrored(commands));
  toggleSnapping = () => this.changeSnapping({ enabled: !this.state.snapping.enabled });
  changeSnapping = (patch: Partial<SnapSettings>) => this.update({ snapping: { ...this.state.snapping, ...patch } });
  setSnapOverride = (held: boolean) => { if (held !== this.state.snapOverride) this.update({ snapOverride: held }); };
  setSnapStep = (step: number) => { if (SNAP_STEPS.includes(step)) this.update({ snapSteps: { ...this.state.snapSteps, [this.snapKind]: step } }); };
  /** The view bar's Snap control: 0.25 → 0.5 → 1 → 2 → 5 m for the current kind. */
  cycleSnap = () => { const kind = this.snapKind, steps = this.state.snapSteps; this.update({ snapSteps: { ...steps, [kind]: SNAP_STEPS[(SNAP_STEPS.indexOf(steps[kind]) + 1) % SNAP_STEPS.length] } }); };
  /** What the viewport draws. `retained` is the last accepted compile, kept through recompiles. */
  scene(retained: ConstructionResult | undefined): BuilderScene {
    const s = this.state, locked = this.locked, freeformMode = this.freeformMode, pathPart = this.pathPart, freeformPrimitive = this.freeformPrimitive;
    return {
      source: this.source, result: retained, current: this.compiled, catalog: this.catalog,
      selected: s.selected, selectedSurfaces: s.surfaces, twins: locked ? NO_TWINS : this.selectionTwins, mirrorEdits: s.mirror && !locked, view: s.view, perspective: s.perspective, display: this.display, fitRequest: s.fitRequest, armorScale: this.armorScale,
      snapping: this.effectiveSnapping, gridStep: this.gridStep, gesture: locked ? 'none' : this.gesture, pickTargets: this.pickTargets, moveTargets: locked || freeformMode ? 'none' : this.moveTargets,
      placementPiece: locked || freeformMode ? undefined : this.piece, placementMirror: this.mirrorPiece,
      highlightFaces: this.faceLayer, rooms: s.layer === 'internals', showCenters: s.showCenters, arcs: this.arcs, proposed: this.proposed, measure: s.measure, measuring: s.tool === 'measure',
      pathDraft: !locked && pathPart ? { part: pathPart, points: s.pathPoints, bearingDeg: s.pathBearing, heightM: s.railingHeight, railCount: pathPart.path?.railCount ?? 3, slackM: pathPart.path?.kind === 'rope' ? Math.min(s.ropeSlack, pathSlackLimit(s.pathPoints)) : 0, mirror: s.mirror } : undefined,
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
  raiseTurrets = editing.raiseTurrets.bind(this);
  command(label: string, commands: ConstructionCommand[]): ConstructionSubmission { return this.run(label, commands); }
  refused(): ConstructionSubmission | undefined { const refusal = this.door.refusal; return refusal && { accepted: false, ...refusal }; }
  fail = (cause: unknown) => this.door.setError(cause instanceof Error ? cause.message : String(cause));
  notify = (notice: string) => this.update({ notice });
  undo = () => { if (!this.locked) this.door.undo(); };
  redo = () => { if (!this.locked) this.door.redo(); };
  surfaceCommands = surfaces.surfaceCommands.bind(this);

  // ---- layer, tool and cards
  setTool = (tool: BuilderToolId) => this.update({ tool });
  switchLayer = (next: BuilderLayer) => {
    this.update({ layer: next, tool: DEFAULT_TOOL[next], surfaces: new Set(), measure: undefined, bearing: 0, tilt: undefined,
      ...(next === 'armor' || next === 'paint' ? { selected: new Set<string>() } : next === 'internals' ? { selected: new Set([...this.state.selected].filter(id => this.internalIds.has(id))) } : {}) });
  };
  /** Open a dock tab; a fitting tab opens the Fittings layer on the shelf it last showed. */
  openTab = (tab: BuilderTab) => {
    const group = FITTING_GROUPS.find(entry => entry.id === tab)?.id;
    if (!group) { this.switchLayer(tab as Exclude<BuilderTab, FittingGroup>); return; }
    if (this.state.layer !== 'fittings') this.switchLayer('fittings');
    if (this.tab !== group) this.setFittingFilter({ category: this.state.groupShelves[group] });
  };
  toggleSlot = cards.toggleSlot.bind(this);
  selectSlot = cards.selectSlot.bind(this);
  setSizeOverride = (size: Vec3) => this.update({ sizeOverride: size });
  setWindowRow = (windowRow: boolean) => this.update({ windowRow });
  setWindowSpacing = (windowSpacing: number) => this.update({ windowSpacing });
  setWallSize = (axis: 0 | 1, value: number) => {
    if (this.active?.kind !== 'part' || !wallMount(this.active.part)) return;
    const size: Vec3 = [...(this.state.sizeOverride ?? this.active.part.size)];
    const dimensions = resizedWallDimensions(this.active.part, { version: 1, widthM: size[0], heightM: size[1] }, axis, value);
    size[0] = dimensions.widthM; size[1] = dimensions.heightM;
    this.update({ sizeOverride: size });
  };
  setRailingHeight = (railingHeight: number) => this.update({ railingHeight });
  setRopeSlack = (ropeSlack: number) => this.update({ ropeSlack });
  /** The Armor card's millimetre field: it loads the bucket and never edits the ship by itself. */
  setThickness = (value: number) => this.update({ customMm: value, slots: { ...this.state.slots, armor: 'armor' }, ...(this.state.layer === 'armor' && this.state.tool !== 'area' ? { tool: 'apply' as const } : {}) });
  toggleMirror = () => this.update({ mirror: !this.state.mirror });
  toggleArcs = () => this.update({ showArcs: !this.state.showArcs });
  toggleCenters = () => this.update({ showCenters: !this.state.showCenters });
  cycleView = () => this.update({ view: BUILDER_VIEWS[(BUILDER_VIEWS.indexOf(this.state.view) + 1) % BUILDER_VIEWS.length] });
  toggleProjection = () => this.update({ perspective: !this.state.perspective });
  fit = () => this.update({ fitRequest: this.state.fitRequest + 1 });
  activateRail = cards.activateRail.bind(this);

  // ---- selection and editing
  choose = picking.choose.bind(this);
  clearSelection = () => this.update({ selected: new Set(), surfaces: new Set() });
  selectAll = () => this.update({ selected: new Set(this.state.layer === 'internals' ? this.internalIds : [...this.data.primitives, ...this.data.equipment].map(part => part.id)) });
  selectOnly = (ids: string[]) => this.update({ selected: new Set(ids) });
  removePieces = editing.removePieces.bind(this);
  remove = () => this.removePieces(this.state.selected);
  erase = (id: string) => this.removePieces(new Set([id]), 'Remove piece');
  copy = editing.copy.bind(this);
  centerSelection = editing.centerSelection.bind(this);
  nudge = (delta: Vec3): ConstructionSubmission | undefined => this.state.selected.size ? this.movePieces([...this.state.selected], delta) : undefined;
  editPrimitive = editing.editPrimitive.bind(this);
  movePieces = editing.movePieces.bind(this);
  rotate = rotation.rotate.bind(this);
  turnWallFittings = rotation.turnWallFittings.bind(this);
  turn = rotation.turn.bind(this);
  rotateFittings = rotation.rotateFittings.bind(this);
  placeAt = placement.placeAt.bind(this);
  drawLadder = paths.drawLadder.bind(this);
  addPathPoint = paths.addPathPoint.bind(this);
  popPathPoint = () => this.update({ pathPoints: this.state.pathPoints.slice(0, -1) });
  clearPath = () => this.update({ pathPoints: [] });
  cancelPath = (clearNotice = true) => this.update({ pathPoints: [], tool: 'select', ...(clearNotice ? { notice: '' } : {}) });
  finishPath = paths.finishPath.bind(this);
  addBoundary = placement.addBoundary.bind(this);
  withMirrorFaces = mirror.withMirrorFaces.bind(this);
  applyItem = surfaces.applyItem.bind(this);
  setFinish = surfaces.setFinish.bind(this);
  setShipPaint = surfaces.setShipPaint.bind(this);
  paintFittings = surfaces.paintFittings.bind(this);
  applyScheme = surfaces.applyScheme.bind(this);
  pick = picking.pick.bind(this);
  applyFaces = surfaces.applyFaces.bind(this);
  boxSelect = picking.boxSelect.bind(this);
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
  suggest = suggestions.suggest.bind(this);
  dismissSuggestion = () => this.update({ suggestion: undefined });
  applySuggestion = suggestions.applySuggestion.bind(this);

  // ---- freeform hulls
  changeFreeformSettings = (patch: Partial<FreeformSettings>) => this.update({ freeformSettings: { ...this.state.freeformSettings, ...patch } });
  cycleUnit = () => this.changeFreeformSettings({ unit: VERTEX_UNITS[(VERTEX_UNITS.findIndex(unit => unit === this.state.freeformSettings.unit) + 1) % VERTEX_UNITS.length] });
  cycleGrid = () => this.freeformMode ? this.cycleUnit() : this.cycleSnap();
  enterFreeform = freeform.enterFreeform.bind(this);
  setFreeformMode = freeform.setFreeformMode.bind(this);
  exitFreeform = () => this.update({ freeform: undefined });
  commitFreeform = freeform.commitFreeform.bind(this);
  resetFreeform = () => { const freeform = this.state.freeform; return freeform ? this.edit('Reset hull edit', [{ op: 'primitive', value: editableMesh(freeform.baseline) }]) : undefined; };
  splitFreeform = freeform.splitFreeform.bind(this);

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
      // The axis keys mean the same quarter turn in every hull tool; here they also aim the gizmo.
      if (['x', 'y', 'z'].includes(lower)) { event.preventDefault(); if (!event.repeat) { this.setRotationAxis('xyz'.indexOf(lower)); this.rotateBlock('xyz'.indexOf(lower), event.shiftKey ? -90 : 90); } return; }
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
      if (/^[1-4]$/.test(event.key) && !event.altKey) { event.preventDefault(); if (!event.repeat) this.setFreeformMode(FREEFORM_MODES[Number(event.key) - 1]); return; }
      // The view strip stays visible while shaping, so its keys keep working; M decides whether the twin follows.
      if (!['w', 'q', 's', 'c', 'm'].includes(lower) && event.key !== 'Home') return;
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
      else if (s.tool !== this.restTool) { this.setTool(this.restTool); this.clearSelection(); }
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
          Object.assign(w, resizedWallDimensions(this.partOf(item)!, w, axis, size));
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
    if (s.layer === 'hull' && ['x', 'y', 'z'].includes(lower)) { event.preventDefault(); if (!event.repeat) this.turn('xyz'.indexOf(lower), event.shiftKey ? -90 : 90); return; }
    if (lower === 'q') this.cycleView(); else if (lower === 'w') chrome.toggleWarnings();
    else if (lower === 'r') this.rotate(event.shiftKey); else if (lower === 'm') this.toggleMirror(); else if (lower === 'c') this.toggleCenters();
    else if (lower === 'a' && s.layer === 'fittings') this.toggleArcs();
    else { const entry = this.rail.find(entry => entry.key.toLowerCase() === lower); if (entry) this.activateRail(entry); }
  }
}
