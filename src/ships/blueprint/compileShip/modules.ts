/** Internal modules, maneuvering fittings, propulsion groups and launcher damage owners. */
import { fail, record, text, numeric, list, literal, unique, volumes, type Rec } from '../validators';

export function validateModules(b: Rec, h: Rec, mounts: Rec[], compartments: Rec[]): Rec[] {
  const modules = volumes(b.modules, 'modules');
  if (b.maneuvering !== undefined) {
    const profile = record(b.maneuvering, 'maneuvering');
    literal(profile.version, [1], 'maneuvering.version');
    const seen = new Set<string>();
    for (const family of ['propellers', 'rudders'] as const) {
      for (const raw of list(profile[family], `maneuvering.${family}`, 128)) {
        const fitting = record(raw, `maneuvering.${family}`);
        const id = text(fitting.moduleId, 'maneuvering.moduleId');
        const module = modules.find((m) => m.id === id);
        if (seen.has(id) || !module || (family === 'propellers' ? module.role !== 'shaft' : module.kind !== 'steering'))
          fail('maneuvering.moduleId', 'expected a unique matching machinery module');
        seen.add(id);
        numeric(fitting.bearingDeg, 'maneuvering.bearingDeg', -360, 360);
        const size = family === 'propellers' ? 'diameterM' : 'areaM2';
        numeric(fitting[size], `maneuvering.${size}`, 0.00001, 10000);
      }
    }
  }

  modules.forEach((m) => {
    text(m.name, `${m.id}.name`);
    literal(m.kind, ['engine', 'steering', 'magazine', 'generator', 'fire-control', 'launcher'], `${m.id}.kind`);
    numeric(m.hp, `${m.id}.hp`, 0.001);
    if (m.role !== undefined) {
      literal(m.role, ['boiler', 'turbine', 'shaft', 'combined-drive'], `${m.id}.role`);
      if (m.kind !== 'engine') fail(String(m.id), 'only propulsion equipment has a machinery role');
    }
    if (m.immersionToleranceM !== undefined) numeric(m.immersionToleranceM, `${m.id}.immersionToleranceM`, 0, (m.size as number[])[1]);
    if (m.placement !== undefined) {
      literal(m.placement, ['fixed'], `${m.id}.placement`);
      if (m.kind !== 'fire-control' && m.kind !== 'launcher')
        fail(String(m.id), 'only directors and launchers support exposed fixed placement');
    }
    if (m.compartmentId !== undefined || m.placement !== 'fixed') {
      if (!compartments.some((c) => c.id === m.compartmentId)) fail(String(m.id), 'unknown compartment');
      const c = compartments.find((c) => c.id === m.compartmentId)!;
      if (
        (m.center as number[]).some(
          (n, i) => Math.abs(n - (c.center as number[])[i]) + (m.size as number[])[i] / 2 > (c.size as number[])[i] / 2 + 1e-6,
        )
      )
        fail(String(m.id), 'module must fit its assigned compartment');
    } else if (
      (m.center as number[]).some(
        (n, i) => Math.abs(n) + (m.size as number[])[i] / 2 > (i === 0 ? (h.beam as number) : i === 1 ? 200 : (h.length as number)),
      )
    )
      fail(String(m.id), 'fixed equipment outside ship envelope');
    if (m.protectionMm !== undefined) numeric(m.protectionMm, `${m.id}.protectionMm`, 0, 1000);
    if (
      m.torpedoLauncherId !== undefined &&
      (m.kind !== 'launcher' ||
        m.placement !== 'fixed' ||
        m.compartmentId !== undefined ||
        !Array.isArray(b.torpedoLaunchers) ||
        !b.torpedoLaunchers.some((l: any) => l.id === m.torpedoLauncherId))
    )
      fail(String(m.id), 'unknown torpedo launcher pose');
    if (m.servesMountIds !== undefined) {
      if (m.kind !== 'fire-control') fail(String(m.id), 'only directors declare mount coverage');
      const ids = list(m.servesMountIds, `${m.id}.servesMountIds`, 256);
      if (new Set(ids).size !== ids.length || ids.some((id) => !mounts.some((mount) => mount.id === id)))
        fail(String(m.id), 'invalid director mount coverage');
    }
  });
  if (modules.some((m) => m.kind === 'fire-control' && m.servesMountIds === undefined))
    fail('modules', 'every director must declare served mounts');
  return modules;
}

export function validatePropulsion(b: Rec, modules: Rec[]): void {
  if (b.propulsion !== undefined) {
    const propulsion = record(b.propulsion, 'propulsion');
    text(propulsion.basis, 'propulsion.basis');
    if (propulsion.sharedExhaust !== undefined) {
      const pool = record(propulsion.sharedExhaust, 'propulsion.sharedExhaust');
      for (const [key, role] of [
        ['engines', 'combined-drive'],
        ['funnels', 'boiler'],
      ]) {
        const ratings = list(pool[key], `sharedExhaust.${key}`, 128).map((r) => record(r, 'machinery rating'));
        unique(ratings, `sharedExhaust.${key}`);
        ratings.forEach((r) => {
          numeric(r.kw, `${r.id}.kw`, 0, 1e9);
          if (!modules.some((m) => m.id === r.id && m.role === role)) fail(String(r.id), 'unknown shared exhaust equipment');
        });
      }
    }
    const groups = list(propulsion.groups, 'propulsion.groups', 16).map((g) => record(g, 'propulsion group'));
    if (!groups.length) fail('propulsion.groups', 'at least one drive group required');
    unique(groups, 'propulsion.groups');
    groups.forEach((g) => {
      numeric(g.share, `${g.id}.share`, 0.001, 1);
      for (const key of ['boilerIds', 'driveIds', 'shaftIds']) {
        const ids = list(g[key], `${g.id}.${key}`, 64);
        if (key === 'driveIds' && !ids.length) fail(String(g.id), 'at least one drive required');
        if (new Set(ids).size !== ids.length) fail(String(g.id), 'duplicate equipment dependency');
        ids.forEach((id) => {
          if (!modules.some((m) => m.id === id && m.kind === 'engine')) fail(String(g.id), 'unknown propulsion equipment');
        });
      }
    });
    if (Math.abs(groups.reduce((n, g) => n + (g.share as number), 0) - 1) > 1e-6) fail('propulsion.groups', 'power shares must sum to one');
  }
}

export function validateMountMagazines(mounts: Rec[], modules: Rec[]): void {
  mounts.forEach((m) => {
    if (m.magazineId !== undefined && !modules.some((module) => module.id === m.magazineId && module.kind === 'magazine'))
      fail(String(m.id), 'unknown magazine connection');
  });
}

export function validateLauncherOwners(b: Rec, modules: Rec[]): void {
  const launcherWeapons = [
    ...(Array.isArray(b.torpedoTubes) ? b.torpedoTubes : []),
    ...(Array.isArray(b.depthChargeLaunchers) ? b.depthChargeLaunchers : []),
  ] as Record<string, unknown>[];
  for (const module of modules.filter((m) => m.kind === 'launcher')) {
    if (!launcherWeapons.some((w) => w.launcherModuleId === module.id))
      fail(String(module.id), 'launcher damage owner needs a connected weapon');
    if (module.torpedoLauncherId !== undefined && modules.filter((m) => m.torpedoLauncherId === module.torpedoLauncherId).length > 1)
      fail(String(module.id), 'shared launcher requires one damage owner');
  }
  for (const weapon of launcherWeapons) {
    if (weapon.launcherModuleId === undefined) continue;
    const owner = modules.find((m) => m.id === weapon.launcherModuleId && m.kind === 'launcher');
    if (!owner || owner.torpedoLauncherId !== weapon.launcherId) fail(String(weapon.id), 'invalid launcher damage owner');
  }
  for (const launcher of (Array.isArray(b.torpedoLaunchers) ? b.torpedoLaunchers : []) as Record<string, unknown>[]) {
    const tubes = (b.torpedoTubes as Record<string, unknown>[]).filter((t) => t.launcherId === launcher.id);
    if (new Set(tubes.map((t) => t.launcherModuleId)).size > 1) fail(String(launcher.id), 'shared launcher requires one damage owner');
  }
}
