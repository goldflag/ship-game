/** The builder tool's state, its collaborators and shared constants. `builderTool.ts` re-exports everything here. */
import type { SnapSettings } from './snapping';
import type { ConstructionBoundary, ConstructionCatalog, ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSuggestion, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_LIMITS } from '../../ships/constructionEditor';
import type { ConstructionRevisionOwner } from '../../ships/constructionRevisionOwner';
import { topology, type HullSelection, type HullSelectionMode, type MirrorAxes } from '../../ships/constructionVertex';
import type { BuilderLayer, BuilderToolId } from './builderLayers';
import type { FittingCategory, FittingFilter, FittingGroup } from './fittingCategories';
import type { HullCategory } from './hullCategories';
import type { BuilderDisplay, BuilderView } from './builderScene';

/** Freeform hull editing options: mirror planes, move step, snapping to nearby corners and the split controls. */
export interface FreeformSettings { axes: MirrorAxes; unit: number; snap: boolean; splitAxis: number; count: number; selection: HullSelection }

/** The tool's own state: which layer and tool are active, what is selected, what the cursor carries. */
export interface BuilderToolState {
  layer: BuilderLayer; tool: BuilderToolId;
  slots: Record<BuilderLayer, string>;
  /** The Fittings shelf on the bar and the nation it is narrowed to. */
  fittingFilter: FittingFilter;
  /** The shelf each fitting tab last showed, so a tab reopens where it was left. */
  groupShelves: Record<FittingGroup, FittingCategory>;
  hullCategory: HullCategory;
  windowRow: boolean; windowSpacing: number;
  customMm: number; sizeOverride?: Vec3; bearing: number;
  /** Quarter turn of the wall fitting about to be placed, about its wall's normal. */
  wallTurn: number;
  /** Pitch and roll of the hull block about to be placed; yaw is `bearing`. */
  tilt?: ConstructionPrimitive['tilt'];
  pathPoints: Vec3[]; pathBearing: number; ropeSlack: number; railingHeight: number;
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
export const ARC_RADIUS = 12;
export const LIMITS = CONSTRUCTION_LIMITS;
export const AXIS = { x: 0, y: 1, z: 2 } as const;
export type SurfaceValues = Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>;
export const NO_TWINS: ReadonlyMap<string, string> = new Map();
export const FREEFORM_MODES: readonly HullSelectionMode[] = ['vertex', 'edge', 'face', 'ring'];
/** Freeform editing opens on faces: the top of an eight-corner cage, the first face of other topology. */
export function freeformSelection(p: ConstructionPrimitive | undefined, mode: HullSelectionMode = 'face'): HullSelection {
  if (mode === 'ring' && !topology(p).rings.length) mode = 'face';
  return { mode, index: mode === 'face' && !p?.mesh ? 5 : 0 };
}
