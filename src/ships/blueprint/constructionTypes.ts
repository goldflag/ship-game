import type { PartCatalog, ShipBlueprint, ShipDefinition, Vec3, Volume } from './blueprintTypes';

/** Same versioned blueprint family, before Rust derives hull/loading/system fields. */
export interface ConstructionSource extends Pick<ShipBlueprint, 'schemaVersion' | 'id' | 'name' | 'coordinates'> {
  revision: string;
  construction: ConstructionData;
}
export interface ConstructionPrimitive {
  id: string;
  kind:
    | 'box'
    | 'wedge'
    | 'corner'
    | 'inverse-corner'
    | 'vertex'
    | 'custom-hull'
    | 'balcony'
    | 'ballast'
    | 'pyramid'
    | 'cylinder'
    | 'half-cylinder'
    | 'quarter-cylinder'
    | 'quarter-cylinder-wall'
    | 'prism'
    | 'half-hemisphere'
    | 'quarter-hemisphere'
    | 'sphere'
    | 'hemisphere'
    | 'sphere-octant'
    | 'hemisphere-shell'
    | 'half-hemisphere-shell'
    | 'quarter-hemisphere-shell'
    | 'parabolic-shell'
    | 'cone'
    | 'hollow-cube'
    | 'concave-corner'
    | 'bridge'
    | 'diagonal-bridge'
    | 'rounded-bridge'
    | 'bridge-panel'
    | 'diagonal-bridge-panel'
    | 'rounded-bridge-panel'
    | 'breakwater';
  /** Envelope centered at position. Shapes occupy normalized [-.5,.5]^3, then scale and rotate (YXZ). */
  size: Vec3;
  position: Vec3;
  rotationDeg: number;
  /** Optional v1 pitch and roll in degrees. rotationDeg remains yaw; absent tilt is level. */
  tilt?: { version: 1; pitchDeg: number; rollDeg: number };
  /** Vertex hull v1: eight normalized local corners, ordered around bow then stern.
   * Missing corners on a vertex hull mean the unit cube. Size scales this edit frame.
   * Rust samples the trilinear solid; generated cells remain the physical authority. */
  vertices?: Vec3[];
  /** Versioned editable topology for prisms, curved solids and wedges. */
  mesh?: ConstructionFreeformMesh;
  /** Reversible round/chamfer on the same eight-corner block; Rust derives the solid. */
  shaping?: ConstructionFreeformShape;
  /** Optional shared lighting seam group; physical surfaces remain unchanged. */
  smoothGroup?: string;
  /** Section-authored whole hull; size is [beam, depth, length]. Native compilation
   * derives its closed cells and surfaces; source sections remain editable. */
  customHull?: ConstructionCustomHull;
  /** Open platform: size Y is deck thickness; outline X/Z scale with size X/Z. */
  balcony?: ConstructionBalcony;
}
export interface ConstructionFreeformMesh {
  version: 1;
  label: string;
  family: 'prism' | 'rings' | 'polyhedron';
  vertices: Vec3[];
  /** Undeformed positions retain mirror partners through asymmetric edits. */
  reference: Vec3[];
  faces: ConstructionFreeformFace[];
  /** Ordered horizontal control rings, including singleton crowns. */
  rings: number[][];
}
export interface ConstructionFreeformFace {
  id: string;
  name: 'port' | 'starboard' | 'bottom' | 'top' | 'bow' | 'stern' | 'slope';
  corners: number[];
}
export interface ConstructionBalconyPoint {
  id: string;
  x: number;
  z: number;
  /** Treatment of the edge from this point to the next, wrapping at the end. */
  edge: 'open' | 'railing' | 'triple-railing' | 'wall';
}
export interface ConstructionBalcony {
  version: 1;
  points: ConstructionBalconyPoint[];
  heightM: number;
  wallThicknessM: number;
}
export interface ConstructionFreeformShape {
  version: 1;
  edges: number[];
  radius: number;
  style: 'round' | 'chamfer';
}
export interface ConstructionHullPoint {
  x: number;
  y: number;
  /** Stable position along the original 0–8 outline (keel 4). Omitted on legacy nine-point sections. */
  contour?: number;
}
export interface ConstructionHullStation {
  id: string;
  t: number;
  points: ConstructionHullPoint[];
}
export interface ConstructionHullPaintBand {
  id: string;
  /** Upper edge in hull-local metres. Bands are ordered from bottom to top. */
  upperY: number;
  paint: string;
}
export interface ConstructionHullPaintBands {
  version: 1;
  /** Each band starts at the previous upper edge; the first extends to the base.
   * Existing face paint remains above the final edge. Empty disables the coating. */
  bands: ConstructionHullPaintBand[];
}
export interface ConstructionCustomHull {
  /** Optional symmetric visual fins. Omission preserves older hulls without keels. */
  bilgeKeels?: ConstructionBilgeKeels;
  /** Red lower-hull coating below this hull-local Y in meters; omission uses face paint. */
  redPaintY?: number;
  /** Height coatings; when present, supersedes the legacy redPaintY setting. */
  paintBands?: ConstructionHullPaintBands;
  version: 1;
  stations: ConstructionHullStation[];
  rake: number;
  bulb: number;
}
export interface ConstructionBilgeKeels {
  version: 1;
  enabled: boolean;
  /** Fractions of hull length, measured from bow to stern. */
  start: number;
  end: number;
  widthM: number;
  thicknessM: number;
  /** Fraction of the section outline from center keel (0) toward deck edge (1). */
  placement: number;
}
export interface ConstructionSurfaceAssignment {
  /** Optional custom-hull panel override; omission assigns the whole named side. */
  panelId?: string;
  primitiveId: string;
  face: 'port' | 'starboard' | 'bottom' | 'top' | 'bow' | 'stern' | 'slope';
  thicknessMm: number;
  material: 'steel' | 'armor-steel';
  paint: string;
  open?: boolean;
}
export interface ConstructionAccessSettings {
  widthM: number;
  standOffM: number;
  handrails: 'both' | 'left' | 'right' | 'none';
  grabHeightM: number;
}
export interface ConstructionEquipment {
  /** Wall fitting installation, in metres; linked partners reflect across ship X=0.
   * `turnDeg` is a quarter turn about the wall's outward normal, counter-clockwise seen from outside; omission is upright. */
  wall?: { version: 1; widthM: number; heightM: number; mirrorId?: string; turnDeg?: 90 | 180 | 270 };
  /** Named coating for this installation and its barbette; omission follows the ship paint. */
  paint?: string;
  id: string;
  partId: string;
  position: Vec3;
  bearingDeg: number;
  magazineId?: string;
  powerSourceId?: string;
  /** Installation settings retain canonical part dimensions/capability. */
  gun?: {
    /** Added height above the deck attachment; position remains the turret datum. */
    barbetteHeightM?: number;
    battery?: 'main' | 'secondary';
    initialElevationDeg?: number;
    traverseDeg?: number;
    traverseLimitsDeg?: [number, number];
    elevationMinDeg?: number;
    elevationMaxDeg?: number;
  };
  /** Absolute ship-relative arcs for an installed trainable torpedo bank. */
  launcher?: { traverseLimitsDeg: [number, number]; launchArcsDeg: [number, number][] };
  /** Connected local-space points, transformed by position and bearing like fixed equipment.
   * Rope/chain slack is the vertical midspan sag on each segment, sampled at 16 equal intervals. */
  path?: {
    points: Vec3[];
    slackM?: number;
    access?: ConstructionAccessSettings;
    /** Railing overrides; omitted values retain the catalog height and three rails. */ heightM?: number;
    railCount?: 2 | 3;
  };
}
/** A shape of a design-local fitting, in fitting-local metres. The hull-piece shape vocabulary without
 * armor, surfaces or structure: never part of the hull union, buoyancy, rooms or hit geometry. */
export interface ConstructionFittingSolid {
  id: string;
  kind: Exclude<ConstructionPrimitive['kind'], 'custom-hull' | 'balcony' | 'ballast'>;
  /** Envelope centered at position; shapes scale and rotate (YXZ) exactly as hull pieces do. */
  size: Vec3;
  position: Vec3;
  rotationDeg: number;
  tilt?: ConstructionPrimitive['tilt'];
  vertices?: Vec3[];
  mesh?: ConstructionFreeformMesh;
  shaping?: ConstructionFreeformShape;
  /** Named coating; omission follows the instance paint, then the ship paint. */
  paint?: string;
}
/** Round tube swept along a polyline in fitting-local metres: pipes, davit arms, stays, light masts. */
export interface ConstructionFittingTube {
  id: string;
  points: Vec3[];
  diameterM: number;
  paint?: string;
}
/** Design-local fitting definition. Instances are ordinary equipment rows whose `partId` is
 * `design:<id>`; the datum is the local origin, seated on a deck like a catalog deck fitting.
 * Non-structural: mass, CG and inertia only. Shells, armor, modules and flooding ignore it. */
export interface ConstructionFittingDefinition {
  id: string;
  name: string;
  version: 1;
  /** `wall` and `internal` are reserved; version 1 compiles deck fittings only. */
  attach: 'deck';
  solids: ConstructionFittingSolid[];
  tubes: ConstructionFittingTube[];
  /** Density basis; omission is steel. */
  material?: 'steel' | 'aluminium' | 'brass' | 'wood';
  /** Solid fraction of the shape volume, 0.01–1; omission is 1. */
  fill?: number;
  /** Explicit mass; overrides volume × density × fill. */
  massKg?: number;
}
export interface ConstructionBoundary {
  id: string;
  axis: 'x' | 'y' | 'z';
  offset: number;
  thicknessMm: number;
}
export interface ConstructionLoad extends Volume {
  name: string;
  massKg: number;
}
export type ConstructionSurfaceFinish = 'matte' | 'satin' | 'semi-gloss' | 'gloss';
export interface ConstructionData {
  /** Ship-wide painted-surface sheen; omission preserves original material finishes. */
  finish?: ConstructionSurfaceFinish;
  /** Ship paint for unassigned faces, unpainted fittings and their barbettes; omission keeps
   * naval gray faces and original component finishes. */
  paint?: string;
  version: 1 | 2;
  catalogRevision: string;
  defaultThicknessMm: number;
  primitives: ConstructionPrimitive[];
  surfaces: ConstructionSurfaceAssignment[];
  equipment: ConstructionEquipment[];
  boundaries: ConstructionBoundary[];
  loads: ConstructionLoad[];
  /** Design-local fitting definitions, fitted through `equipment` rows with `partId: "design:<id>"`. */
  fittings?: ConstructionFittingDefinition[];
}
/** Convex closed outward-facing polygons; generated, never accepted as local source input. */
export interface ConvexVolume {
  faces: { vertices: Vec3[] }[];
}
export interface ConstructionSurface {
  panelId?: string;
  id: string;
  primitiveId: string;
  face: string;
  vertices: Vec3[];
  normal: Vec3;
  areaM2: number;
  thicknessMm: number;
  material: string;
  paint: string;
  open: boolean;
}
export interface ConstructionGeometry {
  version: 1;
  cells: ConvexVolume[];
  surfaces: ConstructionSurface[];
}
export interface ConstructionMass {
  id: string;
  kind: string;
  massKg: number;
  center: Vec3;
  inertiaKgM2: Vec3;
}
export interface ConstructionLoading {
  massKg: number;
  centerOfGravity: Vec3;
  /** Principal-axis diagonal in ship coordinates about dry CG, [pitch, yaw, roll]. */
  inertiaKgM2: Vec3;
  contributions: ConstructionMass[];
  envelopeVolumeM3: number;
  materialVolumeM3: number;
  usableVolumeM3: number;
  waterlineY: number;
  buoyancyCenter: Vec3;
  rollMetacentricHeightM: number;
  powerKw: number;
  estimatedSpeedMps: number;
  basis: string;
}
export interface ConstructionOpening {
  id: string;
  compartmentId: string;
  position: Vec3;
  normal: Vec3;
  areaM2: number;
  /** Catalog installation well remains sealed while its fitted enclosure survives. */
  sealedByMountId?: string;
  sealedByModuleId?: string;
}
export interface ConstructionDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  sourceId?: string;
  /** Other source instances involved: the overlapped fitting, a duplicate ID, the wall or engine named by a link. */
  relatedSourceIds?: string[];
  /** Measurements of a failed support, attachment or clearance check. */
  fit?: ConstructionDiagnosticFit;
}
export interface ConstructionDiagnosticFit {
  /** Hull piece that could carry the failed attachment datum; absent for internal structure, which has no source ID. */
  nearestSupportId?: string;
  /** Metres from the attachment datum to that support, signed along the socket direction:
   * positive floats clear of it, negative is buried in it. */
  gapM?: number;
  /** Attachment tolerance the gap was tested against, metres. */
  toleranceM?: number;
  /** Equipment `position` that closes the gap; the other checks still apply there. */
  seatPosition?: Vec3;
  /** Depth of the overlap with the hull or with `relatedSourceIds[0]`, metres. */
  penetrationM?: number;
}
export interface ConstructionResult {
  /** Native visual bilge-keel faces; excluded from buoyancy, armor and loading. */
  bilgeKeelSurfaces?: ConstructionSurface[];
  sourceId: string;
  revision: string;
  contentHash: string;
  definition?: ShipDefinition;
  surfaces: ConstructionSurface[];
  diagnostics: ConstructionDiagnostic[];
  loading?: ConstructionLoading;
  /** Native fitted shaft/support members in ship coordinates; no added buoyancy. */
  propellerSupports?: ConstructionPropellerSupport[];
  /** Native resolved engine/propeller pairs; automatic propellers may have multiple engines. */
  propellerAssignments?: ConstructionPropellerAssignment[];
}
export interface ConstructionPropellerAssignment {
  propellerId: string;
  engineId: string;
}
export interface ConstructionPropellerSupport {
  equipmentId: string;
  members: {
    start: Vec3;
    end: Vec3;
    radiusM: number;
    kind: 'shaft' | 'strut' | 'bearing' | 'fairing';
    /** Native loft sections in ship coordinates; identical visual and clearance geometry. */
    rings?: Vec3[][];
    /** Closed hull seat; only the final 4 cm may enter this supporting skin. */
    hullContact?: { point: Vec3; normal: Vec3 };
  }[];
}
export interface ConstructionEquipmentPart {
  id: string;
  name: string;
  kind: 'gun' | 'torpedo-launcher' | 'engine' | 'magazine' | 'funnel' | 'propeller' | 'rudder' | 'mast' | 'director' | 'deck-fitting';
  size: Vec3;
  boundsCenter: Vec3;
  centerOfGravity: Vec3;
  /** Required for non-guns; guns use the mass of the referenced canonical GunPart. */
  massKg?: number;
  placement: 'internal' | 'deck' | 'underwater';
  /** Closed surface detail; attachment socket faces into a vertical wall. */
  wallMount?: 'door' | 'porthole' | 'window' | 'vent' | 'hardware';
  /** Porthole proportions, including relief depth, use one overall scale. */
  wallSizing?: 'uniform';
  /** Intrinsic working spaces. For v2 guns, [] declares a deck mount; omitted light guns (<100 mm) also default to deck mounts. */
  occupancy?: { center: Vec3; size: Vec3 }[];
  /** Conservative physical fitting boxes for sparse original equipment; absent uses the full visual bounds. */
  fitting?: { center: Vec3; size: Vec3 }[];
  /** Published component-local triangle surface for rope/chain support and clearance.
   * Base64 zlib: u32 vertex/triangle counts, xyz f32 vertices, u32 triangle indices (little endian). */
  riggingSurface?: { encoding: 'deflate-f32-u32-v1'; data: string };
  sockets?: { id: string; kind: string; position: Vec3; direction: Vec3 }[];
  gunPartId?: string;
  torpedoPartId?: string;
  tubeOffsets?: Vec3[];
  powerKw?: number;
  exhaustKw?: number;
  thrustEfficiency?: number;
  rudderAreaM2?: number;
  serviceMassKg?: number;
  ammunitionCapacity?: number;
  /** Procedural path profile. massKg is the fixed end/base hardware allowance;
   * massKgPerM follows the sampled line length, plus postMassKg for each railing post.
   * Railings use square bars, the catalog rail count and deck-level source points. */
  path?: {
    kind: 'railing' | 'rope' | 'chain' | 'ladder' | 'inclined-ladder' | 'framed-ladder';
    diameterM: number;
    heightM?: number;
    railCount?: 2 | 3;
    widthM?: number;
    standOffM?: number;
    postSpacingM?: number;
    massKgPerM: number;
    postMassKg?: number;
  };
  modelUrl: string;
  contentHash: string;
}
export interface ConstructionCatalog {
  schemaVersion: 1;
  revision: string;
  weapons: PartCatalog;
  equipment: ConstructionEquipmentPart[];
}
export interface ConstructionSuggestion {
  source: ConstructionSource;
  diagnostics: ConstructionDiagnostic[];
}
