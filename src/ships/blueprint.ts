/** Editable authoring data. JSON only; no renderer or browser dependencies. */
export type Vec3 = [number, number, number];
export type Battery = 'main' | 'secondary' | 'torpedo';
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
export interface PartCatalog { schemaVersion: 1; parts: GunPart[]; torpedoes?: TorpedoPart[]; }
export interface Mount {
  id: string; name: string; partId: string; battery: Exclude<Battery, 'torpedo'>; position: Vec3;
  bearingDeg: number; rangefinder: boolean;
  magazineId?: string;
}
export interface Handling {
  forwardSpeed: number; reverseSpeed: number; acceleration: number;
  braking: number; rudderRate: number; maxYawRate: number;
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
}
export interface Compartment extends Volume { name: string; capacityM3: number; pumpM3PerSecond: number; }
export interface Armor extends Volume {
  name: string; thicknessMm: number;
  /** A convex, planar physical plate. Legacy volumes remain closed box shells. */
  plate?: { vertices: Vec3[]; material: 'KC' | 'Wh' | 'Ww' | 'steel' | 'teak'; mountId?: string; exterior?: boolean };
  provenance?: { sourceId: string; basis: 'documented' | 'plan-measured' | 'estimated' | 'inferred'; note: string };
}
export interface ShipBlueprint {
  schemaVersion: 1; id: string; name: string; configuration: string;
  coordinates: 'meters-y-up-bow-negative-z'; modelUrl: string;
  hull: Hull; handling: Handling; mounts: Mount[]; armor: Armor[];
  torpedoTubes?: TorpedoTube[];
  modules: Module[]; compartments: Compartment[];
  connections: { fromId: string; toId: string; areaM2: number }[];
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
export interface ShipDefinition extends Omit<ShipBlueprint, 'mounts' | 'torpedoTubes'> {
  compilerVersion: 1;
  mounts: (Mount & { weapon: GunPart })[];
  torpedoTubes?: (TorpedoTube & { weapon: TorpedoPart })[];
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
  });
  const modules = volumes(b.modules, 'modules');
  modules.forEach(m => {
    text(m.name, `${m.id}.name`); literal(m.kind, ['engine', 'steering', 'magazine'], `${m.id}.kind`);
    numeric(m.hp, `${m.id}.hp`, .001);
    if (!compartments.some(c => c.id === m.compartmentId)) fail(String(m.id), 'unknown compartment');
    const c = compartments.find(c => c.id === m.compartmentId)!;
    if ((m.center as number[]).some((n, i) => Math.abs(n - (c.center as number[])[i]) + (m.size as number[])[i] / 2 > (c.size as number[])[i] / 2 + 1e-6)) fail(String(m.id), 'module must fit its assigned compartment');
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
  const tubes = list(b.torpedoTubes ?? [], 'torpedoTubes', 32).map(t => record(t, 'torpedo tube'));
  unique(tubes, 'torpedoTubes');
  tubes.forEach(t => {
    text(t.name, `${t.id}.name`); id(t.partId, `${t.id}.partId`);
    if (!torpedoes.some(p => p.id === t.partId)) fail(String(t.id), 'unknown torpedo part');
    if (mounts.some(m => m.id === t.id)) fail(String(t.id), 'tube ID already used by a gun mount');
    const pos = vector(t.position, `${t.id}.position`);
    if (Math.abs(pos[0]) > (h.beam as number) / 2 || Math.abs(pos[2]) > (h.length as number) / 2 || pos[1] > 0 || pos[1] < -(h.draft as number)) fail(String(t.id), 'tube muzzle must be within the submerged hull envelope');
    numeric(t.bearingDeg, `${t.id}.bearingDeg`, -360, 360); numeric(t.arcDeg, `${t.id}.arcDeg`, 0, 45);
    numeric(t.ammo, `${t.id}.ammo`, 0, 100);
    if (!Number.isInteger(t.ammo)) fail(String(t.id), 'ammunition must be an integer');
    if (!modules.some(m => m.id === t.magazineId && m.kind === 'magazine')) fail(String(t.id), 'unknown magazine connection');
  });
  const compiledArmor=[...list(b.armor,'armor',512),...mounts.flatMap(m=>{
    const part=parts.find(p=>p.id===m.partId) as unknown as GunPart;
    if (!part.gunhouseMesh) return [];
    return part.gunhouseMesh.faces.map(face=>{
      const vertices=face.indices.map(i=>{const [x,y,z]=part.gunhouseMesh!.vertices[i];return [-y,z,-x] as Vec3;});
      const low=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))), high=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
      return {id:`${m.id}-turret-${face.id}`,name:`${m.name} · ${face.id.replace(/-/g,' ')}`,center:low.map((v,i)=>(v+high[i])/2),size:low.map((v,i)=>Math.max(.001,high[i]-v)),thicknessMm:face.thicknessMm,
        plate:{vertices,material:face.material,mountId:m.id},...(part.gunhouseMesh!.provenance?{provenance:part.gunhouseMesh!.provenance}:{})};
    });
  })];
  volumes(compiledArmor, 'armor', 512).forEach(a => {
    text(a.name, `${a.id}.name`); numeric(a.thicknessMm, `${a.id}.thicknessMm`, .001, 2000);
    if (a.provenance !== undefined) {
      const p = record(a.provenance, `${a.id}.provenance`);
      id(p.sourceId, 'sourceId'); text(p.note, 'provenance.note');
      literal(p.basis, ['documented', 'plan-measured', 'estimated', 'inferred'], 'provenance.basis');
    }
    if (a.plate !== undefined) {
      const p = record(a.plate, `${a.id}.plate`);
      literal(p.material, ['KC', 'Wh', 'Ww', 'steel', 'teak'], 'plate.material');
      if (p.exterior !== undefined) literal(p.exterior, [true, false], 'plate.exterior');
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
    if (c.fromId === c.toId || !compartments.some(p => p.id === c.fromId) || !compartments.some(p => p.id === c.toId)) fail('connections', 'invalid compartment connection');
    const key = [c.fromId, c.toId].sort().join(':');
    if (connectionIds.has(key)) fail('connections', 'duplicate compartment connection');
    connectionIds.add(key);
  });
  const accuracy = record(b.accuracy, 'accuracy');
  ['exterior', 'internals', 'weapons'].forEach(k => text(accuracy[k], `accuracy.${k}`));
  const blueprint = structuredClone(input) as ShipBlueprint;
  const result: ShipDefinition = { ...blueprint, torpedoTubes: undefined, armor:structuredClone(compiledArmor) as Armor[], compilerVersion: 1, mounts: blueprint.mounts.map(m => ({ ...m, weapon: structuredClone(parts.find(p => p.id === m.partId)) as unknown as GunPart })) };
  if (blueprint.torpedoTubes) result.torpedoTubes = blueprint.torpedoTubes.map(t => ({ ...t, weapon: structuredClone(torpedoes.find(p => p.id === t.partId)) as unknown as TorpedoPart }));
  else delete result.torpedoTubes;
  return result;
}

function validateTriangle(value: unknown, vertices: Vec3[], path: string): void {
  const ids=list(value,path,3).map(i=>numeric(i,path,0,vertices.length-1));
  if (ids.length!==3 || ids.some(i=>!Number.isInteger(i))) fail(path,'expected three vertex indices');
  const [a,b,c]=ids.map(i=>vertices[i]), u=b.map((v,i)=>v-a[i]), v=c.map((n,i)=>n-a[i]);
  if (Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-8) fail(path,'degenerate triangle');
}
