/** Torpedo and depth-charge catalog parts, launchers and tubes. */
import { fail, record, text, numeric, list, literal, id, vector, unique, type Rec } from '../validators';

export function validateUnderwaterWeapons(
  b: Rec,
  catalog: Rec,
  h: Rec,
  parts: Rec[],
  mounts: Rec[],
  modules: Rec[],
): { torpedoes: Rec[]; depthCharges: Rec[] } {
  const torpedoes = list(catalog.torpedoes ?? [], 'torpedoes', 64).map((p) => record(p, 'torpedo part'));
  unique(torpedoes, 'torpedoes');
  torpedoes.forEach((p) => {
    literal(p.kind, ['torpedo'], `${p.id}.kind`);
    text(p.name, `${p.id}.name`);
    for (const key of [
      'diameterM',
      'lengthM',
      'speed',
      'rangeM',
      'armingDistanceM',
      'runningDepthM',
      'reloadSeconds',
      'launchIntervalSeconds',
      'damage',
      'breachAreaM2',
    ])
      numeric(p[key], `${p.id}.${key}`, 0.001, 100000);
    if ((p.armingDistanceM as number) >= (p.rangeM as number)) fail(String(p.id), 'arming distance must be less than range');
    if (parts.some((g) => g.id === p.id)) fail(String(p.id), 'part ID already used by a gun');
  });
  const launchers = list(b.torpedoLaunchers ?? [], 'torpedoLaunchers', 16).map((t) => record(t, 'torpedo launcher'));
  unique(launchers, 'torpedoLaunchers');
  const deckPosition = (value: unknown, path: string) => {
    const pos = vector(value, path);
    if (
      Math.abs(pos[0]) > (h.beam as number) / 2 ||
      Math.abs(pos[2]) > (h.length as number) / 2 ||
      pos[1] < -(h.draft as number) ||
      pos[1] > (h.depth as number) + 10
    )
      fail(path, 'weapon lies outside the hull envelope');
    return pos;
  };
  launchers.forEach((l) => {
    text(l.name, `${l.id}.name`);
    deckPosition(l.position, `${l.id}.position`);
    numeric(l.traverseRateDeg, `${l.id}.traverseRateDeg`, 0.1, 90);
    if (l.traverseLimitsDeg !== undefined) {
      const limits = list(l.traverseLimitsDeg, 'traverseLimitsDeg', 2);
      if (limits.length !== 2 || numeric(limits[0], 'traverse minimum', -180, 0) >= numeric(limits[1], 'traverse maximum', 0, 180))
        fail(String(l.id), 'expected travel limits containing neutral');
    }
    const arcs = list(l.launchArcsDeg, 'launchArcsDeg', 8);
    if (!arcs.length) fail(String(l.id), 'launcher needs a firing arc');
    if (l.traverseLimitsDeg !== undefined) {
      const [lo, hi] = l.traverseLimitsDeg as [number, number];
      if (arcs.some((a) => Array.isArray(a) && (a[0] < lo || a[1] > hi))) fail(String(l.id), 'launch arc exceeds mechanical travel');
    }
    arcs.forEach((a) => {
      const arc = list(a, 'launch arc', 2);
      if (arc.length !== 2 || numeric(arc[0], 'arc start', -180, 180) >= numeric(arc[1], 'arc end', -180, 180))
        fail(String(l.id), 'expected ordered launch arc');
    });
  });
  const tubes = list(b.torpedoTubes ?? [], 'torpedoTubes', 32).map((t) => record(t, 'torpedo tube'));
  unique(tubes, 'torpedoTubes');
  tubes.forEach((t) => {
    text(t.name, `${t.id}.name`);
    id(t.partId, `${t.id}.partId`);
    if (!torpedoes.some((p) => p.id === t.partId)) fail(String(t.id), 'unknown torpedo part');
    if (mounts.some((m) => m.id === t.id)) fail(String(t.id), 'tube ID already used by a gun mount');
    const pos = vector(t.position, `${t.id}.position`);
    if (t.launcherId !== undefined) {
      if (!launchers.some((l) => l.id === t.launcherId)) fail(String(t.id), 'unknown torpedo launcher');
      deckPosition(pos, `${t.id}.position`);
      if (t.bearingDeg !== 0) fail(String(t.id), 'trainable tube must use zero-bearing coordinates');
    } else if (
      Math.abs(pos[0]) > (h.beam as number) / 2 ||
      Math.abs(pos[2]) > (h.length as number) / 2 ||
      pos[1] > 0 ||
      pos[1] < -(h.draft as number)
    )
      fail(String(t.id), 'tube muzzle must be within the submerged hull envelope');
    numeric(t.bearingDeg, `${t.id}.bearingDeg`, -360, 360);
    numeric(t.arcDeg, `${t.id}.arcDeg`, 0, 45);
    numeric(t.ammo, `${t.id}.ammo`, 0, 100);
    if (!Number.isInteger(t.ammo)) fail(String(t.id), 'ammunition must be an integer');
    if (!modules.some((m) => m.id === t.magazineId && m.kind === 'magazine')) fail(String(t.id), 'unknown magazine connection');
  });
  launchers.forEach((l) => {
    if (!tubes.some((t) => t.launcherId === l.id)) fail(String(l.id), 'launcher needs at least one tube');
  });
  const depthCharges = list(catalog.depthCharges ?? [], 'depthCharges', 64).map((p) => record(p, 'depth charge part'));
  unique([...parts, ...torpedoes, ...depthCharges], 'part catalog');
  depthCharges.forEach((p) => {
    literal(p.kind, ['depth-charge'], `${p.id}.kind`);
    text(p.name, `${p.id}.name`);
    for (const key of [
      'diameterM',
      'lengthM',
      'sinkSpeed',
      'detonationDepthM',
      'blastRadiusM',
      'reloadSeconds',
      'launchIntervalSeconds',
      'damage',
      'breachAreaM2',
    ])
      numeric(p[key], `${p.id}.${key}`, 0.001, 10000);
    numeric(p.detonationDepthM, 'detonationDepthM', 1, 300);
    numeric(p.sinkSpeed, 'sinkSpeed', 0.1, 20);
    numeric(p.blastRadiusM, 'blastRadiusM', 1, 200);
  });
  const depthLaunchers = list(b.depthChargeLaunchers ?? [], 'depthChargeLaunchers', 32).map((l) => record(l, 'depth charge launcher'));
  unique([...mounts, ...launchers, ...tubes, ...depthLaunchers], 'weapon assemblies');
  depthLaunchers.forEach((l) => {
    text(l.name, `${l.id}.name`);
    id(l.partId, `${l.id}.partId`);
    if (!depthCharges.some((p) => p.id === l.partId)) fail(String(l.id), 'unknown depth charge part');
    const pos = deckPosition(l.position, `${l.id}.position`);
    if (pos[1] < 0) fail(String(l.id), 'depth charge release must be above water');
    const velocity = vector(l.velocity, `${l.id}.velocity`);
    if (Math.hypot(...velocity) > 50 || velocity[1] < 0) fail(String(l.id), 'invalid depth charge launch velocity');
    numeric(l.ammo, `${l.id}.ammo`, 0, 100);
    if (!Number.isInteger(l.ammo)) fail(String(l.id), 'ammunition must be an integer');
    if (!modules.some((m) => m.id === l.magazineId && m.kind === 'magazine')) fail(String(l.id), 'unknown magazine connection');
  });
  return { torpedoes, depthCharges };
}
