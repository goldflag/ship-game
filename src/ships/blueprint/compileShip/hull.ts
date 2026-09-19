/** Identity, hull form, rig, structures and handling. */
import { fail, record, text, numeric, list, literal, id, vector, unique, validateTriangle, type Rec } from '../validators';

export function validateIdentity(b: Rec, catalog: Rec): void {
  literal(b.schemaVersion, [1], 'blueprint.schemaVersion');
  literal(catalog.schemaVersion, [1], 'catalog.schemaVersion');
  id(b.id, 'blueprint.id');
  ['name', 'configuration'].forEach((k) => text(b[k], k));
  literal(b.coordinates, ['meters-y-up-bow-negative-z'], 'coordinates');
  const url = text(b.modelUrl, 'modelUrl');
  if (!/^\/models\/[a-z0-9-]+\.glb$/.test(url)) fail('modelUrl', 'expected a local /models/<id>.glb URL');
  if (b.stability !== undefined) {
    const s = record(b.stability, 'stability');
    literal(s.version, [1], 'stability.version');
    vector(s.dryCenterOfGravity, 'stability.dryCenterOfGravity');
    numeric(s.buoyancyScale, 'stability.buoyancyScale', 0.1, 10);
    numeric(s.shellThicknessMm, 'stability.shellThicknessMm', 0.001, 200);
    text(s.basis, 'stability.basis');
  }
}

export function validateHullDimensions(b: Rec): Rec {
  const h = record(b.hull, 'hull');
  literal(h.kind, ['authored-stations-v1'], 'hull.kind');
  ['length', 'beam', 'draft', 'depth', 'massKg', 'waterplaneAreaM2', 'reserveBuoyancyM3'].forEach((k) => numeric(h[k], `hull.${k}`, 0.001));
  return h;
}

export function validateRig(b: Rec, h: Rec): void {
  if (b.rig !== undefined) {
    const rig = record(b.rig, 'rig');
    literal(rig.version, [1], 'rig.version');
    const flags = list(rig.ensigns, 'rig.ensigns', 8).map((f) => record(f, 'ensign'));
    const radars = list(rig.radars, 'rig.radars', 16).map((r) => record(r, 'radar'));
    unique([...flags, ...radars], 'rig');
    flags.forEach((f) => {
      literal(f.design, ['us-48', 'white-ensign', 'ijn', 'kriegsmarine'], 'ensign.design');
      const p = vector(f.position, 'ensign.position');
      if (Math.abs(p[0]) > Number(h.beam) || Math.abs(p[2]) > Number(h.length) / 2 + 2 || p[1] < 0 || p[1] > 100)
        fail('ensign.position', 'outside the ship envelope');
      numeric(f.width, 'ensign.width', 0.3, 12);
      numeric(f.staffHeight, 'ensign.staffHeight', 0, p[1]);
    });
    const nodes = new Set<string>();
    radars.forEach((r) => {
      const joint = text(r.nodeId, 'radar.nodeId');
      if (!/^[a-z][a-z0-9.-]{0,95}$/.test(joint) || nodes.has(joint)) fail('radar.nodeId', 'requires distinct stable joint IDs');
      nodes.add(joint);
      numeric(r.rpm, 'radar.rpm', 0.1, 60);
      if (r.sweepDeg !== undefined) numeric(r.sweepDeg, 'radar.sweepDeg', 1, 180);
      if (r.phaseDeg !== undefined) numeric(r.phaseDeg, 'radar.phaseDeg', -360, 360);
    });
  }
}

export function validateHullForm(b: Rec, h: Rec): void {
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
    const counts = sections.map((value) => (record(value, 'section').points as unknown[]).length);
    if (counts.some((count) => count !== counts[0])) fail('hull.sections', 'hull sections require matching point counts');
  }
  if (b.mountEnvelope !== undefined) {
    const envelope = record(b.mountEnvelope, 'mountEnvelope');
    numeric(envelope.beam, 'mountEnvelope.beam', h.beam as number, (h.beam as number) * 2);
    numeric(envelope.length, 'mountEnvelope.length', h.length as number, (h.length as number) * 1.2);
  }
}

export function validateStructures(b: Rec, h: Rec): void {
  if (b.structures !== undefined) {
    const structures = list(b.structures, 'structures').map((s, i) => record(s, `structures[${i}]`));
    unique(structures, 'structures');
    structures.forEach((s) => {
      text(s.name, `${s.id}.name`);
      text(s.material, `${s.id}.material`);
      numeric(s.baseY, `${s.id}.baseY`, -(h.draft as number), 200);
      numeric(s.height, `${s.id}.height`, 0.001, 100);
      if (s.exhaust !== undefined) {
        const exhaust = record(s.exhaust, `${s.id}.exhaust`);
        vector(exhaust.position, `${s.id}.exhaust.position`);
        numeric(exhaust.width, `${s.id}.exhaust.width`, 0.01, 100);
        numeric(exhaust.length, `${s.id}.exhaust.length`, 0.01, 100);
      }
      const points = list(s.footprint, `${s.id}.footprint`, 256);
      if (points.length < 3) fail(String(s.id), 'footprint needs at least three points');
      points.forEach((p) => {
        const pair = list(p, 'footprint point', 2);
        if (pair.length !== 2) fail(String(s.id), 'expected [x, z]');
        pair.forEach((n) => numeric(n, 'footprint coordinate', -1000, 1000));
      });
      if (s.surface !== undefined) {
        const surface = record(s.surface, `${s.id}.surface`);
        const vertices = list(surface.vertices, 'surface.vertices', 2048).map((v) => vector(v, 'surface vertex'));
        list(surface.triangles, 'surface.triangles', 4096).forEach((face) => validateTriangle(face, vertices, 'surface triangle'));
      }
    });
  }
  if (b.structuralPlating !== undefined) {
    const plating = record(b.structuralPlating, 'structuralPlating');
    numeric(plating.hullMm, 'structuralPlating.hullMm', 0.1, 100);
    numeric(plating.superstructureMm, 'structuralPlating.superstructureMm', 0.1, 100);
    text(plating.note, 'structuralPlating.note');
    if (!h.sections) fail('structuralPlating', 'requires authored hull sections');
  }
  if (b.viewpoints !== undefined) {
    const viewpoints = record(b.viewpoints, 'viewpoints');
    const bridge = vector(viewpoints.bridge, 'viewpoints.bridge');
    if (Math.abs(bridge[0]) > (h.beam as number) || Math.abs(bridge[2]) > (h.length as number) / 2 || bridge[1] < 0 || bridge[1] > 200)
      fail('viewpoints.bridge', 'crew-eye position lies outside the ship envelope');
  }
}

export function validateHandling(b: Rec): void {
  const handling = record(b.handling, 'handling');
  ['forwardSpeed', 'reverseSpeed', 'acceleration', 'braking', 'rudderRate', 'maxYawRate'].forEach((k) =>
    numeric(handling[k], `handling.${k}`, 0.00001, 100),
  );
}
