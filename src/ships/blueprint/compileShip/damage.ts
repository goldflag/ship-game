/** Damage control, underwater protection and local damage regions. */
import { fail, record, text, numeric, literal, volumes, type Rec } from '../validators';

export function validateDamageControl(b: Rec): void {
  {
    const d = record(b.damageControl, 'damageControl');
    literal(d.version, [1], 'damageControl.version'); text(d.basis, 'damageControl.basis');
    const teams = numeric(d.teams, 'damageControl.teams', 0, 16);
    if (!Number.isInteger(teams)) fail('damageControl.teams', 'expected integer');
    for (const k of ['setupSeconds', 'roomFuelSeconds', 'mountFuelSeconds']) numeric(d[k], `damageControl.${k}`, .1, 3600);
    numeric(d.repairPoints, 'damageControl.repairPoints', 0, 10000);
    for (const k of ['suppressionPerSecond', 'portablePumpM3PerSecond', 'repairHpPerSecond', 'patchM2PerSecond', 'maxPatchM2']) numeric(d[k], `damageControl.${k}`, .000001, 10);
    for (const k of ['repairCeiling', 'flashProtection']) numeric(d[k], `damageControl.${k}`, 0, 1);
  }
}

export function validateUnderwaterProtection(b: Rec, h: Rec): void {
  if (b.underwaterProtection !== undefined) {
    const protection = record(b.underwaterProtection, 'underwaterProtection');
    literal(protection.version, [1], 'underwaterProtection.version');
    text(protection.basis, 'underwaterProtection.basis');
    const zones = volumes(protection.zones, 'underwaterProtection.zones');
    if (!zones.length) fail('underwaterProtection.zones', 'at least one zone required');
    zones.forEach(z => {
      text(z.name, `${z.id}.name`);
      numeric(z.damageReduction, `${z.id}.damageReduction`, 0, .9);
      numeric(z.breachReduction, `${z.id}.breachReduction`, 0, .9);
      const center = z.center as number[], size = z.size as number[];
      if (center[1] + size[1] / 2 > 0 || center[1] - size[1] / 2 < -(h.draft as number)
        || Math.abs(center[0]) + size[0] / 2 > (h.beam as number) / 2 + 1e-6
        || Math.abs(center[2]) + size[2] / 2 > (h.length as number) / 2)
        fail(String(z.id), 'underwater protection outside submerged hull envelope');
    });
  }
}

export function validateLocalDamage(b: Rec, h: Rec, mounts: Rec[], modules: Rec[]): void {
  {
    const local = record(b.localDamage, 'localDamage');
    literal(local.version, [1], 'localDamage.version'); text(local.basis, 'localDamage.basis');
    const regions = volumes(local.regions, 'localDamage.regions');
    if (!regions.length) fail('localDamage.regions', 'at least one damage region required');
    regions.forEach(r => {
      text(r.name, `${r.id}.name`); literal(r.kind, ['hull', 'superstructure', 'mount', 'launcher'], `${r.id}.kind`);
      numeric(r.durabilityFraction, `${r.id}.durabilityFraction`, .001, 2);
      if (r.mountId !== undefined && !mounts.some(m => m.id === r.mountId)) fail(String(r.id), 'unknown mount');
      if ((r.kind === 'launcher') !== (r.moduleId !== undefined) || r.moduleId !== undefined && !modules.some(m => m.kind === 'launcher' && m.id === r.moduleId)) fail(String(r.id), 'launcher region requires a launcher module ID');
      if (r.moduleId !== undefined && regions.filter(other=>other.moduleId===r.moduleId).length > 1) fail(String(r.id), 'launcher requires one structural region owner');
      if ((r.kind === 'mount') !== (r.mountId !== undefined)) fail(String(r.id), 'mount regions require a mount ID');
      if ((r.center as number[]).some((v, i) => Math.abs(v) > (i === 0 ? (h.beam as number) * 2 : i === 1 ? 200 : (h.length as number)))) fail(String(r.id), 'damage region outside ship envelope');
    });
  }
}
