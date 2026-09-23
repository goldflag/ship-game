/** Editable authoring data. JSON only; no renderer or browser dependencies. */
import type { ConstructionData, ConstructionGeometry, ConstructionLoading, ConstructionOpening, ConvexVolume } from './constructionTypes';
export type Vec3 = [number, number, number];
export type Battery = 'main' | 'secondary' | 'torpedo' | 'depth-charge';
export interface TorpedoLauncher {
  id: string;
  name: string;
  position: Vec3;
  traverseRateDeg: number;
  /** Allowed ship-relative launch bearings; training can cross the excluded sectors. */
  launchArcsDeg: [number, number][];
  /** Optional mechanical travel interval containing neutral; never crossed during training. */
  traverseLimitsDeg?: [number, number];
}
export interface DepthChargePart {
  id: string;
  name: string;
  kind: 'depth-charge';
  diameterM: number;
  lengthM: number;
  sinkSpeed: number;
  detonationDepthM: number;
  blastRadiusM: number;
  reloadSeconds: number;
  launchIntervalSeconds: number;
  damage: number;
  breachAreaM2: number;
}
export interface DepthChargeLauncher {
  id: string;
  name: string;
  partId: string;
  position: Vec3;
  velocity: Vec3;
  ammo: number;
  magazineId: string;
  launcherModuleId?: string;
}
export type Ammunition = 'ap' | 'he';
export interface HEProjectile {
  explosiveKg: number;
  fragmentPenetrationMm: number;
  damage: number;
  stockFraction: number;
  basis: string;
}
export interface APProjectile {
  armingResistanceMm: number;
  fuzeDelaySeconds: number;
  explosiveKg: number;
  fragmentPenetrationMm: number;
  basis: string;
}
/** Fixed tubes with a preset gyro course; no homing or render dependencies. */
export interface TorpedoPart {
  id: string;
  name: string;
  kind: 'torpedo';
  diameterM: number;
  lengthM: number;
  speed: number;
  rangeM: number;
  armingDistanceM: number;
  runningDepthM: number;
  reloadSeconds: number;
  launchIntervalSeconds: number;
  damage: number;
  breachAreaM2: number;
}
export interface TorpedoTube {
  id: string;
  name: string;
  partId: string;
  position: Vec3;
  bearingDeg: number;
  /** Allowed gyro offset either side of the tube, in degrees. */
  arcDeg: number;
  ammo: number;
  magazineId: string;
  launcherModuleId?: string;
  /** Position is the muzzle in the launcher's zero-bearing ship frame. */
  launcherId?: string;
}
export interface Volume {
  id: string;
  center: Vec3;
  size: Vec3;
}
export interface AuthoredSurface {
  vertices: Vec3[];
  triangles: [number, number, number][];
}
/** Physical movement stops derived from original geometry, independent of firing arcs. */
export interface MountClearanceProfile {
  /** Exterior hull meshes also reject barrel centers inside structural solids,
   * except the mount's installed working bore. */
  hullInteriorGuard?: boolean;
  version: 1;
  marginM: number;
  basis: string;
  /** Select exactly one geometry encoding: triangle bodies or installation envelopes. */
  mountIds?: string[];
  /** Fixed bodies use hull coordinates; mounted fittings use yaw-local coordinates. */
  bodies?: { id: string; mountId?: string; surface: AuthoredSurface }[];
  /** Conservative envelopes for reviewed hull-mounted installations. */
  mounts?: {
    mountId: string;
    barrelRadiusM: number;
    body?: { center: Vec3; size: Vec3 };
    /** Original fitting envelopes. Elevating points are trunnion-relative;
     * yaw points are mount-relative. Include full recoil travel in endpoints. */
    fittings?: { joint: 'yaw' | 'elevation'; a: Vec3; b: Vec3; radiusM: number }[];
  }[];
  structures?: { structureId: string; topExtensionM: number }[];
  neighbors?: [string, string][];
}
export interface GunPart {
  id: string;
  name: string;
  kind: 'gun';
  massKg: number;
  barbetteRadius: number;
  gunhouseSize: Vec3;
  pivotHeight: number;
  trunnionForward: number;
  muzzleForward: number;
  barrelSpacing: number;
  caliberM: number;
  traverseDeg: number;
  traverseRateDeg: number;
  elevationMinDeg: number;
  elevationMaxDeg: number;
  elevationRateDeg: number;
  /** Compiler-retained catalog capability for grouping an installation-limited gun. */
  catalogElevationMinDeg?: number;
  catalogElevationMaxDeg?: number;
  reloadSeconds: number;
  muzzleSpeed: number;
  projectileMassKg: number;
  penetrationMm: number;
  damage: number;
  recoilM: number;
  ammoPerBarrel: number;
  armorMm: number;
  /** Calibrated flight model; every catalog part declares one. */
  ballistics: {
    dragPerSecond: number;
    dispersionRad: number;
    muzzleSpeedSigmaFraction?: number;
    penetrationReferenceSpeedMps?: number;
    basis: string;
  };
  /** Omitted original v1 parts remain inert/contact-only projectiles. */
  ap?: APProjectile;
  he?: HEProjectile;
  /** Spacing is between adjacent barrel axes. */
  barrelCount: 1 | 2 | 3 | 4 | 8;
  /** Vertical bore-axis spacing for an octuple two-row mount. */
  barrelVerticalSpacing?: number;
  mountingStyle?: 'enclosed' | 'open-pedestal' | 'open-quad' | 'oerlikon' | 'pom-pom';
  barrelBaseRadius?: number;
  rangefinderWidth?: number;
  rangefinderForward?: number;
  gunhouseBaseHeight?: number;
  rollerRadius?: number;
  /** Original authored gunhouse vertices in the mount's forward/port/up frame. */
  gunhouseShape?: { footprint: [number, number][]; roof: Vec3[] };
  /** Versioned original facets shared by the visual enclosure and physical armor. */
  gunhouseMesh?: {
    version: 1;
    vertices: Vec3[];
    faces: {
      id: string;
      indices: [number, number, number];
      thicknessMm: number;
      material: 'KC' | 'Wh' | 'steel';
      finish: 'naval' | 'roof';
    }[];
    apertures?: { id: string; indices: number[] }[];
    provenance?: Armor['provenance'];
  };
}
export const barrelIds = (weapon: GunPart): readonly string[] => {
  switch (weapon.barrelCount) {
    case 1:
      return ['center'];
    case 3:
      return ['left', 'center', 'right'];
    case 4:
      return ['left-outer', 'left', 'right', 'right-outer'];
    case 8:
      return [
        'lower-left-outer',
        'lower-left',
        'lower-right',
        'lower-right-outer',
        'upper-left-outer',
        'upper-left',
        'upper-right',
        'upper-right-outer',
      ];
    default:
      return ['left', 'right'];
  }
};
export const barrelOffset = (weapon: GunPart, index: number): number =>
  (weapon.barrelCount === 8 ? (index % 4) - 1.5 : index - (weapon.barrelCount - 1) / 2) * weapon.barrelSpacing;
export const barrelHeightOffset = (weapon: GunPart, index: number): number =>
  weapon.barrelCount === 8 ? (index < 4 ? -0.5 : 0.5) * weapon.barrelVerticalSpacing! : 0;
export interface PartCatalog {
  schemaVersion: 1;
  parts: GunPart[];
  torpedoes?: TorpedoPart[];
  depthCharges?: DepthChargePart[];
}
export interface Mount {
  id: string;
  name: string;
  partId: string;
  battery: 'main' | 'secondary';
  position: Vec3;
  bearingDeg: number;
  rangefinder: boolean;
  /** Seated starting/stow angle; does not narrow the mechanical travel. */
  initialElevationDeg?: number;
  /** Riding on another mount's yaw assembly. Position/bearing remain the
   * ship-space neutral datums; the carrier must precede this mount. */
  parentMountId?: string;
  /** Installed half-sector about bearingDeg, at most the catalog capability. */
  traverseDeg?: number;
  /** Installed depression stop, between the catalog minimum and level. */
  elevationMinDeg?: number;
  /** Installed elevation stop, between level and the catalog maximum. */
  elevationMaxDeg?: number;
  /** Optional asymmetric travel relative to bearingDeg, containing neutral and
   * bounded by the installed/catalog half-sector. */
  traverseLimitsDeg?: [number, number];
  magazineId?: string;
  fire?: FireProfile;
}
export interface Handling {
  /** Top speed in calm water, m/s (physical). A seaway adds wave resistance, so in the port's 9 m/s wind or any
   * battle sea above calm a ship plateaus below it. */
  forwardSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  braking: number;
  rudderRate: number;
  maxYawRate: number;
}
/** Optional diving equipment; all depths are below the surfaced waterline datum. */
export interface SubmarineDefinition {
  submergedHandling: Handling;
  ballastCapacityM3: number;
  neutralBallastFraction: number;
  floodRateM3PerSecond: number;
  blowRateM3PerSecond: number;
  emergencyBlowRateM3PerSecond: number;
  maxDiveSpeed: number;
  maxRiseSpeed: number;
  periscopeDepthM: number;
  maxDepthM: number;
  maxTorpedoDepthM: number;
  periscopeEye: Vec3;
  surfaceEngineIds: string[];
  submergedEngineIds: string[];
  appendages: { bowPlanes: string[]; sternPlanes: string[]; rudders: string[]; propellers: string[] };
}
export interface BuoyancyCell {
  center: Vec3;
  size: Vec3;
  volumeM3: number;
}
export interface Hull {
  kind: 'authored-stations-v1' | 'constructed-volume-v1';
  length: number;
  beam: number;
  draft: number;
  depth: number;
  massKg: number;
  waterplaneAreaM2: number;
  reserveBuoyancyM3: number;
  halfBreadths: [number, number][];
  deckHeights: [number, number][];
  keelHeights: [number, number][];
  /** Station is measured from the stern; points are [half breadth, height above waterline], keel to deck. */
  sections?: { station: number; points: [number, number][] }[];
  /** Authoritative disjoint partial volumes. Station tables are broad bounds only for this variant. */
  volume?: ConstructionGeometry;
  /** Explicit experimental combat approximation; absent retains exact flotation.
   * Collision still uses volume. Source geometry and loading remain independent. */
  buoyancy?: { version: 1; cells: BuoyancyCell[] };
}
export interface AuthoredStructure {
  id: string;
  name: string;
  footprint: [number, number][];
  baseY: number;
  height: number;
  material: string;
  /** Explicit mouth for side-discharging uptakes; otherwise the upper rim is used. */
  exhaust?: { position: Vec3; width: number; length: number };
  /** Optional original surface for tapered towers and funnel jackets, in runtime coordinates. */
  surface?: AuthoredSurface;
}
export interface Module extends Volume {
  name: string;
  kind: 'engine' | 'steering' | 'magazine' | 'generator' | 'fire-control' | 'launcher';
  hp: number;
  compartmentId?: string;
  /** Explicit exposed fixed equipment; absent retains room containment. */
  placement?: 'fixed';
  /** A launcher box is authored in the zero-bearing ship frame. */
  torpedoLauncherId?: string;
  protectionMm?: number;
  /** Directors declare the mounts they serve. */
  servesMountIds?: string[];
  /** Water above the equipment's lower face disables it. Omit for sealed equipment. */
  immersionToleranceM?: number;
  role?: 'boiler' | 'turbine' | 'shaft' | 'combined-drive';
}
export interface Compartment extends Volume {
  name: string;
  capacityM3: number;
  pumpM3PerSecond: number;
  fire?: FireProfile;
  /** Optional disjoint conservative cells, in ship coordinates, for compound voids. */
  cells?: { center: Vec3; size: Vec3; volumeM3?: number }[];
  /** Exact disjoint usable voids after inward plating and equipment occupancy. */
  volumes?: ConvexVolume[];
}
/** Finite combustible load and heat response; values are game calibration. */
export interface FireProfile {
  fuelSeconds: number;
  ignitionHeat: number;
  heatPerDamage: number;
  /** Visible smoke outlet in ship coordinates; does not affect combat geometry. */
  ventPosition?: Vec3;
}
export interface DamageRegion extends Volume {
  name: string;
  kind: 'hull' | 'superstructure' | 'mount' | 'launcher';
  durabilityFraction: number;
  mountId?: string;
  moduleId?: string;
}
export interface FloodConnection {
  id?: string;
  fromId: string;
  toId: string;
  areaM2: number;
  /** Omitted v1 connections preserve the original open-connection behavior. */
  state?: 'open' | 'closed' | 'damaged';
  position?: Vec3;
  /** A hit on this protection surface can breach this boundary, within bounds. */
  armorId?: string;
  bounds?: { center: Vec3; size: Vec3 };
  thicknessMm?: number;
  /** Compiled boundary fragments share topology, retaining their individual
   * damage footprints and heights for local breaches and tilted waterplanes. */
  patches?: FloodConnectionPatch[];
  /** Original fragment order for conservative sequential water transfers. */
  transferOrder?: number;
}
export interface FloodConnectionPatch {
  areaM2: number;
  position: Vec3;
  bounds: { center: Vec3; size: Vec3 };
  transferOrder: number;
}
/** Installed catalog ratings for ship-wide exhaust allocation and damage. */
export interface MachineryRating {
  id: string;
  kw: number;
}
export interface SharedExhaust {
  engines: MachineryRating[];
  funnels: MachineryRating[];
}
export interface PropulsionGroup {
  id: string;
  share: number;
  boilerIds: string[];
  driveIds: string[];
  shaftIds: string[];
}
export interface Armor extends Volume {
  name: string;
  thicknessMm: number;
  /** Exterior closed-box protection: both entry and exit can open the shell. */
  exterior?: boolean;
  /** A convex, planar physical plate. Legacy volumes remain closed box shells. With `mountId` it is a gunhouse
   * plate: `vertices` and this volume's `center` are mount-local (origin at the mount, turned by its bearing and
   * train), not hull-frame. */
  plate?: { vertices: Vec3[]; material: 'KC' | 'Wh' | 'Ww' | 'steel' | 'teak'; mountId?: string; exterior?: boolean; surfaceId?: string };
  provenance?: { sourceId: string; basis: 'documented' | 'plan-measured' | 'estimated' | 'inferred'; note: string };
}
/** Versioned game calibration, not historical crew or thermal engineering data. */
export interface DamageControlProfile {
  version: 1;
  teams: number;
  setupSeconds: number;
  repairPoints: number;
  roomFuelSeconds: number;
  mountFuelSeconds: number;
  suppressionPerSecond: number;
  portablePumpM3PerSecond: number;
  repairHpPerSecond: number;
  repairCeiling: number;
  patchM2PerSecond: number;
  maxPatchM2: number;
  flashProtection: number;
  basis: string;
}
export type AircraftRole = 'fighter' | 'dive-bomber' | 'torpedo-bomber';
/** Aircraft with published LODs, authored ground poses and CPU role support. */
export const GAMEPLAY_AIRCRAFT: Readonly<Record<string, AircraftRole>> = {
  'f4f-4-wildcat': 'fighter',
  'sbd-3-dauntless': 'dive-bomber',
  'tbd-1-devastator': 'torpedo-bomber',
  'a6m2-zero': 'fighter',
  'd3a1-val': 'dive-bomber',
  'b5n2-kate': 'torpedo-bomber',
};
/** Physical flight-deck geometry, shared by every operating profile. Positions
 * are tyre datums in ship-local coordinates; aircraft clearance is added by the sim. */
export interface FlightDeckLayout {
  version: 1;
  surfaceId: string;
  spots: { id: string; position: Vec3; preferredRole: AircraftRole }[];
  launchStart: Vec3;
  launchEnd: Vec3;
  recoveryTouchdown: Vec3;
  recoveryStop: Vec3;
  elevators: { id: string; position: Vec3; hangarY: number; widthM: number; lengthM: number }[];
}
export interface AirWingDefinition {
  version: 1;
  launchPosition: Vec3;
  recoveryPosition: Vec3;
  serviceModuleId: string;
  launchIntervalSeconds: number;
  rearmSeconds: number;
  flightSize: number;
  deckCapacity: number;
  maxActiveFlights: number;
  deckLayout?: FlightDeckLayout;
  squadrons: { id: string; name: string; modelId: string; role: AircraftRole; count: number }[];
}
/** Physical appendages. Missing profiles on older presets use module-envelope estimates. */
export interface ManeuveringProfile {
  version: 1;
  propellers: { moduleId: string; bearingDeg: number; diameterM: number }[];
  rudders: { moduleId: string; bearingDeg: number; areaM2: number }[];
}
export interface ShipBlueprint {
  schemaVersion: 1;
  id: string;
  name: string;
  configuration: string;
  coordinates: 'meters-y-up-bow-negative-z';
  modelUrl: string;
  damageControl: DamageControlProfile;
  /** Optional CPU motion interlocks, fitted to reviewed installation geometry.
   * These are explicit game clearance envelopes, not historical firing sectors. */
  mountClearance?: MountClearanceProfile;
  /** Ship-local underwater defense coverage; reductions are gameplay calibration. */
  underwaterProtection?: {
    version: 1;
    basis: string;
    zones: (Volume & { name: string; damageReduction: number; breachReduction: number })[];
  };
  localDamage: { version: 1; regions: DamageRegion[]; basis: string };
  stability?: { version: 1; dryCenterOfGravity: Vec3; buoyancyScale: number; shellThicknessMm: number; basis: string };
  maneuvering?: ManeuveringProfile;
  hull: Hull;
  handling: Handling;
  mounts: Mount[];
  armor: Armor[];
  torpedoTubes?: TorpedoTube[];
  torpedoLaunchers?: TorpedoLauncher[];
  depthChargeLaunchers?: DepthChargeLauncher[];
  submarine?: SubmarineDefinition;
  airWing?: AirWingDefinition;
  rig?: import('../rig').ShipRig;
  modules: Module[];
  compartments: Compartment[];
  connections: FloodConnection[];
  /** Additive v1 mechanics. Older definitions retain their provisional averages. */
  propulsion?: { groups: PropulsionGroup[]; basis: string; sharedExhaust?: SharedExhaust };
  /** Explicit shell-to-space assignment; regions cover local shell surfaces. */
  floodRegions?: (Volume & { compartmentId: string; face?: 'port' | 'starboard' | 'bow' | 'stern' })[];
  obstructions: Volume[];
  /** Gun sponsons can extend beyond the bare hull. */
  mountEnvelope?: { beam: number; length: number };
  structures?: AuthoredStructure[];
  /** Provisional ordinary steel, separate from the documented armor schedule. */
  structuralPlating?: { hullMm: number; superstructureMm: number; note: string };
  /** Optional crew-eye position in the shared ship coordinate frame. */
  viewpoints?: { bridge: Vec3 };
  accuracy: { exterior: string; internals: string; weapons: string };
  /** Additive source extension; omitted historical blueprints retain their authoring path. */
  construction?: ConstructionData;
}
export interface ShipDefinition extends Omit<ShipBlueprint, 'mounts' | 'torpedoTubes' | 'depthChargeLaunchers'> {
  compilerVersion: 1;
  mounts: (Mount & { weapon: GunPart })[];
  torpedoTubes?: (TorpedoTube & { weapon: TorpedoPart })[];
  depthChargeLaunchers?: (DepthChargeLauncher & { weapon: DepthChargePart })[];
  contentHash?: string;
  constructionRevision?: string;
  loading?: ConstructionLoading;
  openings?: ConstructionOpening[];
}
