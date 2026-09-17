import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionResult, ConstructionSource, Vec3 } from '../../ships/blueprint';
import type { HullSelection, MirrorAxes } from '../../ships/constructionVertex';
import type { ArmorScale } from '../../ships/inspection';

/** The seam between the builder tool and the three.js viewport: plain data in both directions.
 * The tool describes what to draw (`BuilderScene`); the viewport raycasts, tracks drags and
 * reports each finished gesture with its targets already resolved (`BuilderPointerEvent`).
 * Nothing here imports React or three.js. */

export type BuilderView = 'orbit' | 'top' | 'side' | 'bow';
export type BuilderDisplay = 'paint' | 'armor' | 'internals';
/** How the primary button behaves: a click picks, a stroke lays a run of pieces, fill covers a rectangle, faces sweeps armor, paint or openings over every face the drag crosses. */
export type BuilderGesture = 'none' | 'stroke' | 'fill' | 'faces';
/** What a primary drag may move: nothing, fittings only (while placing fittings), or pieces, fittings and walls. */
export type BuilderMoveTargets = 'none' | 'equipment' | 'all';
export interface BuilderPick { id?: string; surface?: string; point: Vec3; normal?: Vec3; axis: 0 | 1 | 2; placement: Vec3; additive: boolean }
export interface BuilderArc { position: Vec3; bearingDeg: number; traverseDeg: number; radius: number; color: string }
export interface BuilderProposal { position: Vec3; bearingDeg: number; size: Vec3; boundsCenter: Vec3 }
export type BuilderPlacement =
  | { kind: 'hull'; shape: ConstructionPrimitive['kind']; size: Vec3; rotationDeg: number }
  | { kind: 'equipment'; partId?: string; propellerDiameterM?: number; size: Vec3; boundsCenter: Vec3; bearingDeg: number; sockets?: ConstructionEquipmentPart['sockets']; arc?: { traverseDeg: number; radius: number }; /** Clearance from the hit face, e.g. the inward skin thickness for internal packages. */ inset?: number }
  | { kind: 'boundary'; axis: 'x' | 'y' | 'z'; thicknessMm: number };
export interface BuilderFreeformOptions {
  id: string; selection: HullSelection; axes: MirrorAxes; unit: number; snap: boolean;
  onSelect(selection: HullSelection): void;
  onCommit(replacements: ConstructionPrimitive[]): void;
}
export interface BuilderPathDraft { part: ConstructionEquipmentPart; points: Vec3[]; slackM: number; mirror: boolean }

/** Everything the viewport draws, derived by the tool from its state, the source and the compile. */
export interface BuilderScene {
  source: ConstructionSource;
  /** The last accepted compile of this design; stale after an edit until `current` returns. */
  result?: ConstructionResult;
  /** The compile of exactly this source revision, or undefined while it is pending. */
  current?: ConstructionResult;
  catalog: ConstructionCatalog;
  selected: ReadonlySet<string>; selectedSurfaces: ReadonlySet<string>;
  view: BuilderView; perspective: boolean; display: BuilderDisplay; slice?: number; fitRequest: number;
  /** The ship's thinnest and thickest plates: the green and red ends of the Armor layer's colour scale. */
  armorScale: ArmorScale;
  gridStep: number; gesture: BuilderGesture;
  /** What a click may select: hull faces only (armor, paint), internal packages and walls only (internals), or everything. */
  pickTargets: 'hull' | 'internals' | 'all';
  moveTargets: BuilderMoveTargets;
  placementPiece?: BuilderPlacement; placementMirror?: BuilderPlacement;
  highlightFaces: boolean; rooms: boolean; showCenters: boolean;
  arcs: BuilderArc[]; proposed: BuilderProposal[];
  measure?: { from: Vec3; to?: Vec3 };
  pathDraft?: BuilderPathDraft;
  freeform?: BuilderFreeformOptions;
}

/** A finished pointer gesture with its targets already raycast and snapped by the viewport. */
export type BuilderPointerEvent =
  | { kind: 'pick'; hit?: BuilderPick }
  | { kind: 'lay'; points: Vec3[] }
  | { kind: 'faces'; surfaces: string[] }
  | { kind: 'box'; ids: string[]; additive: boolean }
  | { kind: 'erase'; id: string }
  | { kind: 'move'; ids: string[]; delta: Vec3 }
  | { kind: 'rotate'; ids: string[]; degrees: number }
  | { kind: 'path-point'; point: Vec3 }
  | { kind: 'path-finish' };
