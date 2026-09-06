/** Editable authoring data. JSON only; no renderer or browser dependencies. */
export type Vec3 = [number, number, number];
export type Battery = 'main' | 'secondary' | 'torpedo' | 'depth-charge';
export interface TorpedoLauncher {
  id: string; name: string; position: Vec3; traverseRateDeg: number;
  /** Allowed ship-relative launch bearings; training can cross the excluded sectors. */
  launchArcsDeg: [number, number][];
}
export interface DepthChargePart {
  id: string; name: string; kind: 'depth-charge'; diameterM: number; lengthM: number;
  sinkSpeed: number; detonationDepthM: number; blastRadiusM: number;
  reloadSeconds: number; launchIntervalSeconds: number; damage: number; breachAreaM2: number;
}
export interface DepthChargeLauncher {
  id: string; name: string; partId: string; position: Vec3; velocity: Vec3;
  ammo: number; magazineId: string;
}
export type Ammunition = 'ap' | 'he';
export interface HEProjectile {
  explosiveKg: number; fragmentPenetrationMm: number; damage: number; stockFraction: number; basis: string;
}
export interface APProjectile {
  armingResistanceMm: number; fuzeDelaySeconds: number; explosiveKg: number;
  fragmentPenetrationMm: number; basis: string;
}
/** Fixed tubes with a preset gyro course; no homing or render dependencies. */
export interface TorpedoPart {
  id: string; name: string; kind: 'torpedo'; diameterM: number; lengthM: number;
  speed: number; rangeM: number; armingDistanceM: number; runningDepthM: number;
  reloadSeconds: number; launchIntervalSeconds: number; damage: number; breachAreaM2: number;
}
export interface TorpedoTube {
  id: string; name: string; partId: string; position: Vec3; bearingDeg: number;
  /** Allowed gyro offset either side of the tube, in degrees. */
  arcDeg: number; ammo: number; magazineId: string;
  /** Position is the muzzle in the launcher's zero-bearing ship frame. */
  launcherId?: string;
}
export interface Volume { id: string; center: Vec3; size: Vec3; }
export interface AuthoredSurface { vertices: Vec3[]; triangles: [number, number, number][]; }
export interface GunPart {
  id: string; name: string; kind: 'gun'; massKg: number; barbetteRadius: number;
  gunhouseSize: Vec3; pivotHeight: number; trunnionForward: number; muzzleForward: number;
  barrelSpacing: number; caliberM: number; traverseDeg: number; traverseRateDeg: number;
  elevationMinDeg: number; elevationMaxDeg: number; elevationRateDeg: number;
  reloadSeconds: number; muzzleSpeed: number; projectileMassKg: number;
  penetrationMm: number; damage: number; recoilM: number; ammoPerBarrel: number; armorMm: number;
  /** Optional calibrated flight model; omitted v1 parts retain vacuum/no spread. */
  ballistics?: { dragPerSecond: number; dispersionRad: number; muzzleSpeedSigmaFraction?: number; penetrationReferenceSpeedMps?: number; basis: string };
  /** Omitted original v1 parts remain inert/contact-only projectiles. */
  ap?: APProjectile;
  he?: HEProjectile;
  /** Omitted in original v1 twin parts. Spacing is between adjacent barrel axes. */
  barrelCount?: 1 | 2 | 3 | 4;
  mountingStyle?: 'enclosed' | 'open-pedestal' | 'open-quad' | 'oerlikon';
  barrelBaseRadius?: number;
  rangefinderWidth?: number;
  rangefinderForward?: number;
  gunhouseBaseHeight?: number;
  rollerRadius?: number;
  /** Original authored gunhouse vertices in the mount's forward/port/up frame. */
  gunhouseShape?: { footprint: [number, number][]; roof: Vec3[] };
  /** Versioned original facets shared by the visual enclosure and physical armor. */
  gunhouseMesh?: { version: 1; vertices: Vec3[]; faces: { id: string; indices: [number, number, number]; thicknessMm: number; material: 'KC' | 'Wh' | 'steel'; finish: 'naval' | 'roof' }[]; provenance?: Armor['provenance'] };
}
export const barrelIds = (weapon: GunPart): readonly string[] => {
  switch (weapon.barrelCount ?? 2) {
    case 1: return ['center'];
    case 3: return ['left', 'center', 'right'];
    case 4: return ['left-outer', 'left', 'right', 'right-outer'];
    default: return ['left', 'right'];
  }
};
export const barrelOffset = (weapon: GunPart, index: number): number => (index - ((weapon.barrelCount ?? 2) - 1) / 2) * weapon.barrelSpacing;
export interface PartCatalog { schemaVersion: 1; parts: GunPart[]; torpedoes?: TorpedoPart[]; depthCharges?: DepthChargePart[]; }
export interface Mount {
  id: string; name: string; partId: string; battery: 'main' | 'secondary'; position: Vec3;
  bearingDeg: number; rangefinder: boolean;
  magazineId?: string;
}
export interface Handling {
  forwardSpeed: number; reverseSpeed: number; acceleration: number;
  braking: number; rudderRate: number; maxYawRate: number;
}
/** Optional diving equipment; all depths are below the surfaced waterline datum. */
export interface SubmarineDefinition {
  submergedHandling: Handling;
  ballastCapacityM3: number; neutralBallastFraction: number;
  floodRateM3PerSecond: number; blowRateM3PerSecond: number; emergencyBlowRateM3PerSecond: number;
  maxDiveSpeed: number; maxRiseSpeed: number;
  periscopeDepthM: number; maxDepthM: number; maxTorpedoDepthM: number;
  periscopeEye: Vec3;
  surfaceEngineIds: string[]; submergedEngineIds: string[];
  appendages: { bowPlanes: string[]; sternPlanes: string[]; rudders: string[]; propellers: string[] };
}
export interface Hull {
  kind: 'authored-stations-v1'; length: number; beam: number; draft: number; depth: number;
  massKg: number; waterplaneAreaM2: number; reserveBuoyancyM3: number;
  halfBreadths: [number, number][]; deckHeights: [number, number][]; keelHeights: [number, number][];
  /** Station is measured from the stern; points are [half breadth, height above waterline], keel to deck. */
  sections?: { station: number; points: [number, number][] }[];
}
export interface AuthoredStructure {
  id: string; name: string; footprint: [number, number][];
  baseY: number; height: number; material: string;
  /** Optional original surface for tapered towers and funnel jackets, in runtime coordinates. */
  surface?: AuthoredSurface;
}
export interface Module extends Volume {
  name: string; kind: 'engine' | 'steering' | 'magazine'; hp: number; compartmentId: string;
  /** Water above the equipment's lower face disables it. Omit for sealed equipment. */
  immersionToleranceM?: number;
  role?: 'boiler' | 'turbine' | 'shaft' | 'combined-drive';
}
export interface Compartment extends Volume {
  name: string; capacityM3: number; pumpM3PerSecond: number;
  /** Optional disjoint conservative cells, in ship coordinates, for compound voids. */
  cells?: { center: Vec3; size: Vec3 }[];
}
export interface FloodConnection {
  id?: string; fromId: string; toId: string; areaM2: number;
  /** Omitted v1 connections preserve the original open-connection behavior. */
  state?: 'open' | 'closed' | 'damaged'; position?: Vec3;
  /** A hit on this protection surface can breach this boundary, within bounds. */
  armorId?: string; bounds?: { center: Vec3; size: Vec3 }; thicknessMm?: number;
}
export interface PropulsionGroup {
  id: string; share: number; boilerIds: string[]; driveIds: string[]; shaftIds: string[];
}
export interface Armor extends Volume {
  name: string; thicknessMm: number;
  /** Exterior closed-box protection: both entry and exit can open the shell. */
  exterior?: boolean;
  /** A convex, planar physical plate. Legacy volumes remain closed box shells. */
  plate?: { vertices: Vec3[]; material: 'KC' | 'Wh' | 'Ww' | 'steel' | 'teak'; mountId?: string; exterior?: boolean; surfaceId?: string };
  provenance?: { sourceId: string; basis: 'documented' | 'plan-measured' | 'estimated' | 'inferred'; note: string };
}
/** Versioned game calibration, not historical crew or thermal engineering data. */
export interface DamageControlProfile {
  version: 1; teams: number; setupSeconds: number; repairPoints: number;
  roomFuelSeconds: number; mountFuelSeconds: number; suppressionPerSecond: number;
  portablePumpM3PerSecond: number; repairHpPerSecond: number; repairCeiling: number;
  patchM2PerSecond: number; maxPatchM2: number; flashProtection: number; basis: string;
}
export type AircraftRole = 'fighter' | 'dive-bomber' | 'torpedo-bomber';
export interface AirWingDefinition {
  version: 1; launchPosition: Vec3; recoveryPosition: Vec3; serviceModuleId: string;
  launchIntervalSeconds: number; rearmSeconds: number;
  squadrons: { id: string; name: string; modelId: string; role: AircraftRole; count: number }[];
}
export interface ShipBlueprint {
  schemaVersion: 1; id: string; name: string; configuration: string;
  coordinates: 'meters-y-up-bow-negative-z'; modelUrl: string;
  damageControl?: DamageControlProfile;
  stability?: { version: 1; dryCenterOfGravity: Vec3; buoyancyScale: number; shellThicknessMm: number; basis: string };
  hull: Hull; handling: Handling; mounts: Mount[]; armor: Armor[];
  torpedoTubes?: TorpedoTube[];
  torpedoLaunchers?: TorpedoLauncher[];
  depthChargeLaunchers?: DepthChargeLauncher[];
  submarine?: SubmarineDefinition;
  airWing?: AirWingDefinition;
  modules: Module[]; compartments: Compartment[];
  connections: FloodConnection[];
  /** Additive v1 mechanics. Older definitions retain their provisional averages. */
  propulsion?: { groups: PropulsionGroup[]; basis: string };
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
}
export interface ShipDefinition extends Omit<ShipBlueprint, 'mounts' | 'torpedoTubes' | 'depthChargeLaunchers'> {
  compilerVersion: 1;
  mounts: (Mount & { weapon: GunPart })[];
  torpedoTubes?: (TorpedoTube & { weapon: TorpedoPart })[];
  depthChargeLaunchers?: (DepthChargeLauncher & { weapon: DepthChargePart })[];
}

const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
const record = (value: unknown, path: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(path, 'expected an object');
const text = (value: unknown, path: string): string =>
  typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : fail(path, 'expected nonempty text (at most 500 characters)');
const numeric = (value: unknown, path: string, min = -1e9, max = 1e9): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail(path, `expected a finite number in [${min}, ${max}]`);
const list = (value: unknown, path: string, max = 256): unknown[] =>
  Array.isArray(value) && value.length <= max ? value : fail(path, `expected an array with at most ${max} entries`);
const literal = (value: unknown, choices: unknown[], path: string) => { if (!choices.includes(value)) fail(path, `expected ${choices.join(' or ')}`); };
const id = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(result) || ['constructor', 'prototype', '__proto__'].includes(result)) fail(path, 'expected a stable lowercase kebab-case ID');
  return result;
};
const vector = (value: unknown, path: string, min = -10000): Vec3 => {
  const v = list(value, path, 3);
  if (v.length !== 3) fail(path, 'expected three coordinates');
  return v.map((n, i) => numeric(n, `${path}[${i}]`, min, 10000)) as Vec3;
};
function unique(values: Record<string, unknown>[], path: string): void {
  const ids = new Set<string>();
  values.forEach((v, i) => { const key = id(v.id, `${path}[${i}].id`); if (ids.has(key)) fail(path, `duplicate ID ${key}`); ids.add(key); });
}
function volumes(value: unknown, path: string, max = 256): Record<string, unknown>[] {
  const values = list(value, path, max).map((v, i) => record(v, `${path}[${i}]`));
  unique(values, path);
  values.forEach((v, i) => { vector(v.center, `${path}[${i}].center`); vector(v.size, `${path}[${i}].size`, .001); });
  return values;
}

/** Validate unknown input before compiling. Limits are authoring safeguards, not a PvP ruleset. */
export function compileShip(input: unknown, catalogInput: unknown): ShipDefinition {
  const b = record(input, 'blueprint'), catalog = record(catalogInput, 'catalog');
  literal(b.schemaVersion, [1], 'blueprint.schemaVersion');
  literal(catalog.schemaVersion, [1], 'catalog.schemaVersion');
  id(b.id, 'blueprint.id');
  ['name', 'configuration'].forEach(k => text(b[k], k));
  literal(b.coordinates, ['meters-y-up-bow-negative-z'], 'coordinates');
  const url = text(b.modelUrl, 'modelUrl');
  if (!/^\/models\/[a-z0-9-]+\.glb$/.test(url)) fail('modelUrl', 'expected a local /models/<id>.glb URL');
  if (b.stability !== undefined) {
    const s = record(b.stability, 'stability'); literal(s.version, [1], 'stability.version');
    vector(s.dryCenterOfGravity, 'stability.dryCenterOfGravity');
    numeric(s.buoyancyScale, 'stability.buoyancyScale', .1, 10);
    numeric(s.shellThicknessMm, 'stability.shellThicknessMm', .001, 200);
    text(s.basis, 'stability.basis');
  }
  const h = record(b.hull, 'hull');
  literal(h.kind, ['authored-stations-v1'], 'hull.kind');
  ['length', 'beam', 'draft', 'depth', 'massKg', 'waterplaneAreaM2', 'reserveBuoyancyM3'].forEach(k => numeric(h[k], `hull.${k}`, .001));
  for (const key of ['halfBreadths', 'deckHeights', 'keelHeights']) {
    const stations = list(h[key], `hull.${key}`, 512);
    if (stations.length < 2) fail(key, 'at least two stations required');
    let previous = -1;
    stations.forEach((v, i) => {
      const pair = list(v, `${key}[${i}]`, 2);
      if (pair.length !== 2) fail(key, 'expected [station, value] pairs');
      const station = numeric(pair[0], `${key}[${i}].station`, 0, h.length as number);
      numeric(pair[1], `${key}[${i}].value`, key === 'halfBreadths' ? 0 : -10000, key === 'halfBreadths' ? (h.beam as number) / 2 : 10000);
      if (station <= previous) fail(key, 'stations must be strictly increasing');
      previous = station;
    });
    if ((stations[0] as number[])[0] !== 0 || previous !== h.length) fail(key, 'stations must span the hull length');
  }
  if (h.sections !== undefined) {
    const sections = list(h.sections, 'hull.sections', 512);
    if (sections.length < 2) fail('hull.sections', 'at least two sections required');
    let previous = -1;
    sections.forEach((value, i) => {
      const s = record(value, `hull.sections[${i}]`);
      const station = numeric(s.station, `hull.sections[${i}].station`, 0, h.length as number);
      if (station <= previous) fail('hull.sections', 'stations must be strictly increasing');
      previous = station;
      const points = list(s.points, `hull.sections[${i}].points`, 128);
      if (points.length < 3) fail('hull.sections', 'at least three section points required');
      let height = -(h.draft as number) - 1e-6;
      points.forEach((p, j) => {
        const pair = list(p, `section point ${j}`, 2);
        if (pair.length !== 2) fail('hull.sections', 'expected [half breadth, height]');
        numeric(pair[0], 'section half breadth', 0, (h.beam as number) / 2 + 1e-6);
        height = numeric(pair[1], 'section height', height, h.depth as number);
      });
    });
    if (record(sections[0], 'section').station !== 0 || previous !== h.length) fail('hull.sections', 'sections must span the hull length');
  }
  if (b.mountEnvelope !== undefined) {
    const envelope = record(b.mountEnvelope, 'mountEnvelope');
    numeric(envelope.beam, 'mountEnvelope.beam', h.beam as number, (h.beam as number) * 2);
    numeric(envelope.length, 'mountEnvelope.length', h.length as number, (h.length as number) * 1.2);
  }
  if (b.structures !== undefined) {
    const structures = list(b.structures, 'structures').map((s, i) => record(s, `structures[${i}]`));
    unique(structures, 'structures');
    structures.forEach(s => {
      text(s.name, `${s.id}.name`); text(s.material, `${s.id}.material`);
      numeric(s.baseY, `${s.id}.baseY`, -(h.draft as number), 200);
      numeric(s.height, `${s.id}.height`, .001, 100);
      const points = list(s.footprint, `${s.id}.footprint`, 256);
      if (points.length < 3) fail(String(s.id), 'footprint needs at least three points');
      points.forEach(p => { const pair = list(p, 'footprint point', 2); if (pair.length !== 2) fail(String(s.id), 'expected [x, z]'); pair.forEach(n => numeric(n, 'footprint coordinate', -1000, 1000)); });
      if (s.surface !== undefined) {
        const surface=record(s.surface, `${s.id}.surface`);
        const vertices=list(surface.vertices,'surface.vertices',2048).map(v=>vector(v,'surface vertex'));
        list(surface.triangles,'surface.triangles',4096).forEach(face=>validateTriangle(face,vertices,'surface triangle'));
      }
    });
  }
  if (b.structuralPlating !== undefined) {
    const plating=record(b.structuralPlating,'structuralPlating');
    numeric(plating.hullMm,'structuralPlating.hullMm',.1,100);numeric(plating.superstructureMm,'structuralPlating.superstructureMm',.1,100);
    text(plating.note,'structuralPlating.note');
    if (!h.sections) fail('structuralPlating','requires authored hull sections');
    const sections=h.sections as {points:unknown[]}[];
    if (sections.some(s=>s.points.length!==sections[0].points.length)) fail('structuralPlating','hull sections require matching point counts');
  }
  if (b.viewpoints !== undefined) {
    const viewpoints = record(b.viewpoints, 'viewpoints');
    const bridge = vector(viewpoints.bridge, 'viewpoints.bridge');
    if (Math.abs(bridge[0]) > (h.beam as number) || Math.abs(bridge[2]) > (h.length as number) / 2 || bridge[1] < 0 || bridge[1] > 200) fail('viewpoints.bridge', 'crew-eye position lies outside the ship envelope');
  }
  const handling = record(b.handling, 'handling');
  ['forwardSpeed', 'reverseSpeed', 'acceleration', 'braking', 'rudderRate', 'maxYawRate'].forEach(k => numeric(handling[k], `handling.${k}`, .00001, 100));
  const parts = list(catalog.parts, 'parts').map((p, i) => record(p, `parts[${i}]`));
  unique(parts, 'parts');
  const requiredNumbers = ['massKg', 'barbetteRadius', 'pivotHeight', 'trunnionForward', 'muzzleForward', 'barrelSpacing', 'caliberM', 'traverseDeg', 'traverseRateDeg', 'elevationRateDeg', 'reloadSeconds', 'muzzleSpeed', 'projectileMassKg', 'penetrationMm', 'damage', 'recoilM', 'ammoPerBarrel', 'armorMm'];
  parts.forEach(p => {
    literal(p.kind, ['gun'], `${p.id}.kind`); text(p.name, `${p.id}.name`);
    requiredNumbers.forEach(k => numeric(p[k], `${p.id}.${k}`, .00001));
    vector(p.gunhouseSize, `${p.id}.gunhouseSize`, .001);
    numeric(p.traverseDeg, `${p.id}.traverseDeg`, 0, 180);
    numeric(p.elevationMinDeg, `${p.id}.elevationMinDeg`, -15, 0);
    numeric(p.elevationMaxDeg, `${p.id}.elevationMaxDeg`, 0, 85);
    if ((p.muzzleForward as number) <= (p.trunnionForward as number)) fail(String(p.id), 'muzzle must be forward of the trunnion');
    if (!Number.isInteger(p.ammoPerBarrel)) fail(String(p.id), 'ammunition must be an integer');
    if (p.ballistics !== undefined) {
      const flight = record(p.ballistics, `${p.id}.ballistics`);
      numeric(flight.dragPerSecond, 'ballistics.dragPerSecond', 0, .5);
      numeric(flight.dispersionRad, 'ballistics.dispersionRad', 0, .02);
      if (flight.muzzleSpeedSigmaFraction !== undefined) numeric(flight.muzzleSpeedSigmaFraction, 'ballistics.muzzleSpeedSigmaFraction', 0, .05);
      if (flight.penetrationReferenceSpeedMps !== undefined) numeric(flight.penetrationReferenceSpeedMps, 'ballistics.penetrationReferenceSpeedMps', 1, 10000);
      text(flight.basis, 'ballistics.basis');
    }
    if (p.ap !== undefined) {
      const ap = record(p.ap, `${p.id}.ap`);
      numeric(ap.armingResistanceMm, 'ap.armingResistanceMm', .001, 2000);
      numeric(ap.fuzeDelaySeconds, 'ap.fuzeDelaySeconds', .001, .2);
      numeric(ap.explosiveKg, 'ap.explosiveKg', .00001, 200);
      numeric(ap.fragmentPenetrationMm, 'ap.fragmentPenetrationMm', .001, 200);
      text(ap.basis, 'ap.basis');
      if ((ap.explosiveKg as number) >= (p.projectileMassKg as number)) fail(`${p.id}.ap`, 'explosive filling must be less than projectile mass');
    }
    if (p.he !== undefined) {
      const he = record(p.he, `${p.id}.he`);
      numeric(he.explosiveKg, 'he.explosiveKg', .00001, 200);
      numeric(he.fragmentPenetrationMm, 'he.fragmentPenetrationMm', .001, 200);
      numeric(he.damage, 'he.damage', .00001, 10000);
      numeric(he.stockFraction, 'he.stockFraction', 0, 1);
      text(he.basis, 'he.basis');
      if ((he.explosiveKg as number) >= (p.projectileMassKg as number)) fail(`${p.id}.he`, 'explosive filling must be less than projectile mass');
    }
    if (p.barrelCount !== undefined) literal(p.barrelCount, [1, 2, 3, 4], `${p.id}.barrelCount`);
    if (p.mountingStyle !== undefined) literal(p.mountingStyle, ['enclosed', 'open-pedestal', 'open-quad', 'oerlikon'], `${p.id}.mountingStyle`);
    for (const k of ['barrelBaseRadius', 'rangefinderWidth', 'gunhouseBaseHeight', 'rollerRadius']) if (p[k] !== undefined) numeric(p[k], `${p.id}.${k}`, .001, 100);
    if(p.rangefinderForward!==undefined)numeric(p.rangefinderForward,`${p.id}.rangefinderForward`,-100,100);
    if (p.gunhouseShape !== undefined) {
      const shape = record(p.gunhouseShape, `${p.id}.gunhouseShape`);
      const footprint = list(shape.footprint, 'gunhouseShape.footprint', 32), roof = list(shape.roof, 'gunhouseShape.roof', 32);
      if (footprint.length < 3 || roof.length !== footprint.length) fail(String(p.id), 'gunhouse footprint and roof require matching polygons');
      footprint.forEach(v => { const point = list(v, 'footprint point', 2); if (point.length !== 2) fail(String(p.id), 'expected a 2D footprint point'); point.forEach(n => numeric(n, 'footprint coordinate', -100, 100)); });
      roof.forEach(v => vector(v, 'roof point'));
    }
    if (p.gunhouseMesh !== undefined) {
      if (p.gunhouseShape !== undefined) fail(String(p.id),'choose one gunhouse geometry format');
      const mesh=record(p.gunhouseMesh,`${p.id}.gunhouseMesh`);literal(mesh.version,[1],'gunhouseMesh.version');
      const vertices=list(mesh.vertices,'gunhouseMesh.vertices',128).map(v=>vector(v,'gunhouse vertex'));
      const faces=list(mesh.faces,'gunhouseMesh.faces',128).map(f=>record(f,'gunhouse face'));unique(faces,'gunhouse faces');
      faces.forEach(f=>{validateTriangle(f.indices,vertices,'gunhouse face');numeric(f.thicknessMm,'gunhouse thickness',.1,2000);literal(f.material,['KC','Wh','steel'],'gunhouse material');literal(f.finish,['naval','roof'],'gunhouse finish');});
      const edges=new Map<string,{count:number;winding:number}>();
      faces.forEach(f=>{const ids=f.indices as number[];ids.forEach((a,i)=>{const c=ids[(i+1)%3],key=[a,c].sort((a,b)=>a-b).join(':');const edge=edges.get(key)??{count:0,winding:0};edge.count++;edge.winding+=a<c?1:-1;edges.set(key,edge);});});
      if (!faces.length || [...edges.values()].some(e=>e.count!==2||e.winding!==0)) fail(String(p.id),'gunhouse facets must form a closed consistently wound enclosure');
    }
  });
  if (b.damageControl !== undefined) {
    const d = record(b.damageControl, 'damageControl');
    literal(d.version, [1], 'damageControl.version'); text(d.basis, 'damageControl.basis');
    const teams = numeric(d.teams, 'damageControl.teams', 0, 16);
    if (!Number.isInteger(teams)) fail('damageControl.teams', 'expected integer');
    for (const k of ['setupSeconds', 'roomFuelSeconds', 'mountFuelSeconds']) numeric(d[k], `damageControl.${k}`, .1, 3600);
    numeric(d.repairPoints, 'damageControl.repairPoints', 0, 10000);
    for (const k of ['suppressionPerSecond', 'portablePumpM3PerSecond', 'repairHpPerSecond', 'patchM2PerSecond', 'maxPatchM2']) numeric(d[k], `damageControl.${k}`, .000001, 10);
    for (const k of ['repairCeiling', 'flashProtection']) numeric(d[k], `damageControl.${k}`, 0, 1);
  }
  const mounts = list(b.mounts, 'mounts', 64).map((m, i) => record(m, `mounts[${i}]`));
  unique(mounts, 'mounts');
  mounts.forEach(m => {
    text(m.name, `${m.id}.name`); id(m.partId, `${m.id}.partId`);
    if (!parts.some(p => p.id === m.partId)) fail(String(m.id), `unknown part ${m.partId}`);
    literal(m.battery, ['main', 'secondary'], `${m.id}.battery`);
    literal(m.rangefinder, [true, false], `${m.id}.rangefinder`);
    const pos = vector(m.position, `${m.id}.position`);
    const envelope = b.mountEnvelope === undefined ? h : record(b.mountEnvelope, 'mountEnvelope');
    if (Math.abs(pos[0]) > (envelope.beam as number) / 2 || Math.abs(pos[2]) > (envelope.length as number) / 2) fail(String(m.id), 'mount lies outside the hull envelope');
    numeric(m.bearingDeg, `${m.id}.bearingDeg`, -360, 360);
  });
  const compartments = volumes(b.compartments, 'compartments');
  compartments.forEach(c => {
    text(c.name, `${c.id}.name`);
    numeric(c.capacityM3, `${c.id}.capacityM3`, .001, (c.size as number[]).reduce((a, v) => a * v, 1));
    numeric(c.pumpM3PerSecond, `${c.id}.pumpM3PerSecond`, 0, 100);
    if (c.cells !== undefined) {
      const cells = list(c.cells, `${c.id}.cells`, 2048);
      if (!cells.length) fail(String(c.id), 'compound space requires cells');
      let volume = 0;
      cells.forEach(value => {
        const cell = record(value, 'cell'), center = vector(cell.center, 'cell.center'), size = vector(cell.size, 'cell.size', .001);
        if (center.some((n, axis) => Math.abs(n - (c.center as number[])[axis]) + size[axis] / 2 > (c.size as number[])[axis] / 2 + 1e-6)) fail(String(c.id), 'cell outside compartment bounds');
        volume += size[0] * size[1] * size[2];
      });
      if ((c.capacityM3 as number) > volume + 1e-6) fail(String(c.id), 'capacity exceeds compound volume');
      const boxes = cells.map(value => value as { center: Vec3; size: Vec3 }).sort((a,b) => a.center[0]-a.size[0]/2-(b.center[0]-b.size[0]/2));
      for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
        const a=boxes[i], b=boxes[j]; if(b.center[0]-b.size[0]/2 >= a.center[0]+a.size[0]/2-1e-6) break;
        if(a.center.every((n,axis)=>Math.abs(n-b.center[axis])<(a.size[axis]+b.size[axis])/2-1e-6)) fail(String(c.id), 'compound cells overlap');
      }
    }
  });
  const modules = volumes(b.modules, 'modules');
  modules.forEach(m => {
    text(m.name, `${m.id}.name`); literal(m.kind, ['engine', 'steering', 'magazine'], `${m.id}.kind`);
    numeric(m.hp, `${m.id}.hp`, .001);
    if (m.role !== undefined) {
      literal(m.role, ['boiler', 'turbine', 'shaft', 'combined-drive'], `${m.id}.role`);
      if (m.kind !== 'engine') fail(String(m.id), 'only propulsion equipment has a machinery role');
    }
    if (m.immersionToleranceM !== undefined) numeric(m.immersionToleranceM, `${m.id}.immersionToleranceM`, 0, (m.size as number[])[1]);
    if (!compartments.some(c => c.id === m.compartmentId)) fail(String(m.id), 'unknown compartment');
    const c = compartments.find(c => c.id === m.compartmentId)!;
    if ((m.center as number[]).some((n, i) => Math.abs(n - (c.center as number[])[i]) + (m.size as number[])[i] / 2 > (c.size as number[])[i] / 2 + 1e-6)) fail(String(m.id), 'module must fit its assigned compartment');
  });
  if (b.propulsion !== undefined) {
    const propulsion = record(b.propulsion, 'propulsion');
    text(propulsion.basis, 'propulsion.basis');
    const groups = list(propulsion.groups, 'propulsion.groups', 16).map(g => record(g, 'propulsion group'));
    if (!groups.length) fail('propulsion.groups', 'at least one drive group required');
    unique(groups, 'propulsion.groups');
    groups.forEach(g => {
      numeric(g.share, `${g.id}.share`, .001, 1);
      for (const key of ['boilerIds', 'driveIds', 'shaftIds']) {
        const ids = list(g[key], `${g.id}.${key}`, 64);
        if (key === 'driveIds' && !ids.length) fail(String(g.id), 'at least one drive required');
        if (new Set(ids).size !== ids.length) fail(String(g.id), 'duplicate equipment dependency');
        ids.forEach(id => { if (!modules.some(m => m.id === id && m.kind === 'engine')) fail(String(g.id), 'unknown propulsion equipment'); });
      }
    });
    if (Math.abs(groups.reduce((n, g) => n + (g.share as number), 0) - 1) > 1e-6) fail('propulsion.groups', 'power shares must sum to one');
  }
  if (b.floodRegions !== undefined) volumes(b.floodRegions, 'floodRegions', 512).forEach(r => {
    if (!compartments.some(c => c.id === r.compartmentId)) fail(String(r.id), 'unknown flooding compartment');
    if (r.face !== undefined) literal(r.face, ['port', 'starboard', 'bow', 'stern'], `${r.id}.face`);
  });
  mounts.forEach(m => { if (m.magazineId !== undefined && !modules.some(module => module.id === m.magazineId && module.kind === 'magazine')) fail(String(m.id), 'unknown magazine connection'); });
  const torpedoes = list(catalog.torpedoes ?? [], 'torpedoes', 64).map(p => record(p, 'torpedo part'));
  unique(torpedoes, 'torpedoes');
  torpedoes.forEach(p => {
    literal(p.kind, ['torpedo'], `${p.id}.kind`); text(p.name, `${p.id}.name`);
    for (const key of ['diameterM', 'lengthM', 'speed', 'rangeM', 'armingDistanceM', 'runningDepthM', 'reloadSeconds', 'launchIntervalSeconds', 'damage', 'breachAreaM2']) numeric(p[key], `${p.id}.${key}`, .001, 100000);
    if ((p.armingDistanceM as number) >= (p.rangeM as number)) fail(String(p.id), 'arming distance must be less than range');
    if (parts.some(g => g.id === p.id)) fail(String(p.id), 'part ID already used by a gun');
  });
  const launchers = list(b.torpedoLaunchers ?? [], 'torpedoLaunchers', 16).map(t => record(t, 'torpedo launcher'));
  unique(launchers, 'torpedoLaunchers');
  const deckPosition = (value: unknown, path: string) => {
    const pos = vector(value, path);
    if (Math.abs(pos[0]) > (h.beam as number) / 2 || Math.abs(pos[2]) > (h.length as number) / 2 || pos[1] < -(h.draft as number) || pos[1] > (h.depth as number) + 10) fail(path, 'weapon lies outside the hull envelope');
    return pos;
  };
  launchers.forEach(l => {
    text(l.name, `${l.id}.name`); deckPosition(l.position, `${l.id}.position`);
    numeric(l.traverseRateDeg, `${l.id}.traverseRateDeg`, .1, 90);
    const arcs = list(l.launchArcsDeg, 'launchArcsDeg', 8);
    if (!arcs.length) fail(String(l.id), 'launcher needs a firing arc');
    arcs.forEach(a => { const arc = list(a, 'launch arc', 2); if (arc.length !== 2 || numeric(arc[0], 'arc start', -180, 180) >= numeric(arc[1], 'arc end', -180, 180)) fail(String(l.id), 'expected ordered launch arc'); });
  });
  const tubes = list(b.torpedoTubes ?? [], 'torpedoTubes', 32).map(t => record(t, 'torpedo tube'));
  unique(tubes, 'torpedoTubes');
  tubes.forEach(t => {
    text(t.name, `${t.id}.name`); id(t.partId, `${t.id}.partId`);
    if (!torpedoes.some(p => p.id === t.partId)) fail(String(t.id), 'unknown torpedo part');
    if (mounts.some(m => m.id === t.id)) fail(String(t.id), 'tube ID already used by a gun mount');
    const pos = vector(t.position, `${t.id}.position`);
    if (t.launcherId !== undefined) {
      if (!launchers.some(l => l.id === t.launcherId)) fail(String(t.id), 'unknown torpedo launcher');
      deckPosition(pos, `${t.id}.position`);
      if (t.bearingDeg !== 0) fail(String(t.id), 'trainable tube must use zero-bearing coordinates');
    } else if (Math.abs(pos[0]) > (h.beam as number) / 2 || Math.abs(pos[2]) > (h.length as number) / 2 || pos[1] > 0 || pos[1] < -(h.draft as number)) fail(String(t.id), 'tube muzzle must be within the submerged hull envelope');
    numeric(t.bearingDeg, `${t.id}.bearingDeg`, -360, 360); numeric(t.arcDeg, `${t.id}.arcDeg`, 0, 45);
    numeric(t.ammo, `${t.id}.ammo`, 0, 100);
    if (!Number.isInteger(t.ammo)) fail(String(t.id), 'ammunition must be an integer');
    if (!modules.some(m => m.id === t.magazineId && m.kind === 'magazine')) fail(String(t.id), 'unknown magazine connection');
  });
  launchers.forEach(l => { if (!tubes.some(t => t.launcherId === l.id)) fail(String(l.id), 'launcher needs at least one tube'); });
  const depthCharges = list(catalog.depthCharges ?? [], 'depthCharges', 64).map(p => record(p, 'depth charge part'));
  unique([...parts, ...torpedoes, ...depthCharges], 'part catalog');
  depthCharges.forEach(p => {
    literal(p.kind, ['depth-charge'], `${p.id}.kind`); text(p.name, `${p.id}.name`);
    for (const key of ['diameterM', 'lengthM', 'sinkSpeed', 'detonationDepthM', 'blastRadiusM', 'reloadSeconds', 'launchIntervalSeconds', 'damage', 'breachAreaM2']) numeric(p[key], `${p.id}.${key}`, .001, 10000);
    numeric(p.detonationDepthM, 'detonationDepthM', 1, 300); numeric(p.sinkSpeed, 'sinkSpeed', .1, 20); numeric(p.blastRadiusM, 'blastRadiusM', 1, 200);
  });
  const depthLaunchers = list(b.depthChargeLaunchers ?? [], 'depthChargeLaunchers', 32).map(l => record(l, 'depth charge launcher'));
  unique([...mounts, ...launchers, ...tubes, ...depthLaunchers], 'weapon assemblies');
  depthLaunchers.forEach(l => {
    text(l.name, `${l.id}.name`); id(l.partId, `${l.id}.partId`);
    if (!depthCharges.some(p => p.id === l.partId)) fail(String(l.id), 'unknown depth charge part');
    const pos = deckPosition(l.position, `${l.id}.position`);
    if (pos[1] < 0) fail(String(l.id), 'depth charge release must be above water');
    const velocity = vector(l.velocity, `${l.id}.velocity`);
    if (Math.hypot(...velocity) > 50 || velocity[1] < 0) fail(String(l.id), 'invalid depth charge launch velocity');
    numeric(l.ammo, `${l.id}.ammo`, 0, 100);
    if (!Number.isInteger(l.ammo)) fail(String(l.id), 'ammunition must be an integer');
    if (!modules.some(m => m.id === l.magazineId && m.kind === 'magazine')) fail(String(l.id), 'unknown magazine connection');
  });
  const compiledArmor=[...list(b.armor,'armor',1024),...mounts.flatMap(m=>{
    const part=parts.find(p=>p.id===m.partId) as unknown as GunPart;
    if (!part.gunhouseMesh) return [];
    return part.gunhouseMesh.faces.map(face=>{
      const vertices=face.indices.map(i=>{const [x,y,z]=part.gunhouseMesh!.vertices[i];return [-y,z,-x] as Vec3;});
      const low=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))), high=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
      return {id:`${m.id}-turret-${face.id}`,name:`${m.name} · ${face.id.replace(/-/g,' ')}`,center:low.map((v,i)=>(v+high[i])/2),size:low.map((v,i)=>Math.max(.001,high[i]-v)),thicknessMm:face.thicknessMm,
        plate:{vertices,material:face.material,mountId:m.id},...(part.gunhouseMesh!.provenance?{provenance:part.gunhouseMesh!.provenance}:{})};
    });
  })];
  volumes(compiledArmor, 'armor', 2048).forEach(a => {
    text(a.name, `${a.id}.name`); numeric(a.thicknessMm, `${a.id}.thicknessMm`, .001, 2000);
    if (a.exterior !== undefined) literal(a.exterior, [true, false], `${a.id}.exterior`);
    if (a.provenance !== undefined) {
      const p = record(a.provenance, `${a.id}.provenance`);
      id(p.sourceId, 'sourceId'); text(p.note, 'provenance.note');
      literal(p.basis, ['documented', 'plan-measured', 'estimated', 'inferred'], 'provenance.basis');
    }
    if (a.plate !== undefined) {
      const p = record(a.plate, `${a.id}.plate`);
      literal(p.material, ['KC', 'Wh', 'Ww', 'steel', 'teak'], 'plate.material');
      if (p.exterior !== undefined) literal(p.exterior, [true, false], 'plate.exterior');
      if (p.surfaceId !== undefined) id(p.surfaceId, 'plate.surfaceId');
      if (p.mountId !== undefined && !mounts.some(m => m.id === p.mountId)) fail(String(a.id), 'unknown plate mount');
      const points = list(p.vertices, 'plate.vertices', 16).map(v => vector(v, 'plate vertex'));
      if (points.length < 3) fail(String(a.id), 'plate needs at least three vertices');
      const delta = (u: Vec3, v: Vec3) => u.map((n, i) => n - v[i]) as Vec3;
      const cross = (u: Vec3, v: Vec3) => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]] as Vec3;
      const dot = (u: Vec3, v: Vec3) => u.reduce((n, x, i) => n+x*v[i], 0);
      const raw = cross(delta(points[1], points[0]), delta(points[2], points[0]));
      const area = Math.hypot(...raw);
      if (area < 1e-8) fail(String(a.id), 'degenerate plate');
      const normal = raw.map(n => n / area) as Vec3;
      points.forEach((v, i) => {
        if (Math.abs(dot(delta(v, points[0]), normal)) > 1e-5) fail(String(a.id), 'nonplanar plate');
        if (dot(cross(delta(points[(i+1)%points.length], v), delta(points[(i+2)%points.length], points[(i+1)%points.length])), normal) <= 1e-8) fail(String(a.id), 'plate must be strictly convex and consistently wound');
        if (v.some((n, axis) => Math.abs(n-(a.center as number[])[axis]) > (a.size as number[])[axis]/2 + 1e-5)) fail(String(a.id), 'plate lies outside inspection bounds');
      });
    }
  });
  volumes(b.obstructions, 'obstructions');
  const connectionIds = new Set<string>();
  list(b.connections, 'connections', 512).forEach((v, i) => {
    const c = record(v, `connections[${i}]`);
    numeric(c.areaM2, `connections[${i}].areaM2`, 0, 100);
    if (c.id !== undefined) id(c.id, `connections[${i}].id`);
    if (c.state !== undefined) literal(c.state, ['open', 'closed', 'damaged'], `connections[${i}].state`);
    if (c.position !== undefined) vector(c.position, `connections[${i}].position`);
    if (c.thicknessMm !== undefined) {
      numeric(c.thicknessMm, 'connection.thicknessMm', .001, 2000);
      if (c.bounds === undefined || c.armorId !== undefined) fail('connections', 'standalone boundary thickness requires bounds and no armor link');
    }
    if (c.armorId !== undefined && !list(b.armor, 'armor', 1024).some(a => record(a, 'armor').id === c.armorId)) fail('connections', 'unknown boundary protection');
    if (c.bounds !== undefined) { const bounds = record(c.bounds, 'connection.bounds'); vector(bounds.center, 'connection center'); vector(bounds.size, 'connection size', .001); }
    if (c.fromId === c.toId || !compartments.some(p => p.id === c.fromId) || !compartments.some(p => p.id === c.toId)) fail('connections', 'invalid compartment connection');
    const key = [c.fromId, c.toId].sort().join(':');
    if (connectionIds.has(key)) fail('connections', 'duplicate compartment connection');
    connectionIds.add(key);
  });
  const namedConnections = list(b.connections, 'connections', 512).map(c => record(c, 'connection')).filter(c => c.id !== undefined);
  unique(namedConnections, 'connections');
  const accuracy = record(b.accuracy, 'accuracy');
  if (b.airWing !== undefined) {
    const wing = record(b.airWing, 'airWing');
    if (wing.version !== 1) fail('airWing.version', 'expected version 1');
    for (const key of ['launchPosition', 'recoveryPosition']) {
      const p = vector(wing[key], `airWing.${key}`);
      if (Math.abs(p[0]) > (h.beam as number) / 2 || Math.abs(p[2]) > (h.length as number) / 2 || p[1] < 0 || p[1] > 40) fail(`airWing.${key}`, 'must be over the flight deck');
    }
    if (!modules.some(m => m.id === wing.serviceModuleId)) fail('airWing.serviceModuleId', 'unknown service module');
    numeric(wing.launchIntervalSeconds, 'airWing.launchIntervalSeconds', 1, 60);
    numeric(wing.rearmSeconds, 'airWing.rearmSeconds', 5, 600);
    const squadrons = list(wing.squadrons, 'airWing.squadrons', 3).map(s => record(s, 'squadron'));
    if (!squadrons.length) fail('airWing.squadrons', 'requires aircraft');
    unique(squadrons, 'airWing.squadrons');
    const models: Record<string, string> = { 'f4f-4-wildcat': 'fighter', 'sbd-3-dauntless': 'dive-bomber', 'tbd-1-devastator': 'torpedo-bomber' };
    for (const squadron of squadrons) {
      id(squadron.id, 'squadron.id'); text(squadron.name, 'squadron.name');
      if (models[String(squadron.modelId)] !== squadron.role || !squadron.role) fail('squadron.modelId', 'unknown aircraft or incompatible role');
      numeric(squadron.count, 'squadron.count', 1, 6);
      if (!Number.isInteger(squadron.count)) fail('squadron.count', 'expected an integer');
    }
  }
  if (b.submarine !== undefined) {
    const s = record(b.submarine, 'submarine');
    const handling = record(s.submergedHandling, 'submarine.submergedHandling');
    ['forwardSpeed', 'reverseSpeed', 'acceleration', 'braking', 'rudderRate', 'maxYawRate'].forEach(k => numeric(handling[k], `submarine.submergedHandling.${k}`, .00001, 100));
    ['ballastCapacityM3', 'floodRateM3PerSecond', 'blowRateM3PerSecond', 'emergencyBlowRateM3PerSecond'].forEach(k => numeric(s[k], `submarine.${k}`, .01, 10000));
    numeric(s.neutralBallastFraction, 'submarine.neutralBallastFraction', .1, .95);
    ['maxDiveSpeed', 'maxRiseSpeed'].forEach(k => numeric(s[k], `submarine.${k}`, .1, 10));
    numeric(s.maxDepthM, 'submarine.maxDepthM', 10, 1000);
    numeric(s.periscopeDepthM, 'submarine.periscopeDepthM', 1, s.maxDepthM as number);
    numeric(s.maxTorpedoDepthM, 'submarine.maxTorpedoDepthM', s.periscopeDepthM as number, s.maxDepthM as number);
    const eye = vector(s.periscopeEye, 'submarine.periscopeEye');
    if (eye[1] <= (s.periscopeDepthM as number) || eye[1] > 30 || Math.abs(eye[0]) > (h.beam as number) / 2 || Math.abs(eye[2]) > (h.length as number) / 2) fail('submarine.periscopeEye', 'must lie over the hull and above water at periscope depth');
    for (const key of ['surfaceEngineIds', 'submergedEngineIds']) {
      const ids = list(s[key], `submarine.${key}`, 16);
      if (!ids.length || new Set(ids).size !== ids.length) fail(`submarine.${key}`, 'requires distinct engine IDs');
      ids.forEach(value => { id(value, key); if (!modules.some(m => m.id === value && m.kind === 'engine')) fail(`submarine.${key}`, 'unknown engine module'); });
    }
    const appendages = record(s.appendages, 'submarine.appendages'), joints = new Set<string>();
    for (const key of ['bowPlanes', 'sternPlanes', 'rudders', 'propellers']) list(appendages[key], `submarine.appendages.${key}`, 8).forEach(value => {
      const joint = text(value, 'appendage joint');
      if (!/^[a-z][a-z0-9.-]{0,95}$/.test(joint) || joints.has(joint)) fail('submarine.appendages', 'requires distinct stable joint IDs');
      joints.add(joint);
    });
  }
  ['exterior', 'internals', 'weapons'].forEach(k => text(accuracy[k], `accuracy.${k}`));
  const blueprint = structuredClone(input) as ShipBlueprint;
  const result: ShipDefinition = { ...blueprint, torpedoTubes: undefined, depthChargeLaunchers: undefined, armor:structuredClone(compiledArmor) as Armor[], compilerVersion: 1, mounts: blueprint.mounts.map(m => ({ ...m, weapon: structuredClone(parts.find(p => p.id === m.partId)) as unknown as GunPart })) };
  if (blueprint.torpedoTubes) result.torpedoTubes = blueprint.torpedoTubes.map(t => ({ ...t, weapon: structuredClone(torpedoes.find(p => p.id === t.partId)) as unknown as TorpedoPart }));
  else delete result.torpedoTubes;
  if (blueprint.depthChargeLaunchers) result.depthChargeLaunchers = blueprint.depthChargeLaunchers.map(l => ({ ...l, weapon: structuredClone(depthCharges.find(p => p.id === l.partId)) as unknown as DepthChargePart }));
  else delete result.depthChargeLaunchers;
  return result;
}

function validateTriangle(value: unknown, vertices: Vec3[], path: string): void {
  const ids=list(value,path,3).map(i=>numeric(i,path,0,vertices.length-1));
  if (ids.length!==3 || ids.some(i=>!Number.isInteger(i))) fail(path,'expected three vertex indices');
  const [a,b,c]=ids.map(i=>vertices[i]), u=b.map((v,i)=>v-a[i]), v=c.map((n,i)=>n-a[i]);
  if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-8) fail(path,'degenerate triangle');
}
