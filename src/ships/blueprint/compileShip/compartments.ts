/** Fire profiles, compartments, flood regions, obstructions and flood connections. */
import type { Vec3 } from '../blueprintTypes';
import { fail, record, text, numeric, list, literal, id, vector, unique, volumes, type Rec } from '../validators';

export function validateCompartments(mounts: Rec[], compartments: Rec[]): void {
  const validateFire = (value: unknown, path: string) => {
    if (value === undefined) return;
    const f = record(value, path);
    numeric(f.fuelSeconds, `${path}.fuelSeconds`, 0, 3600);
    numeric(f.ignitionHeat, `${path}.ignitionHeat`, 0.1, 2);
    numeric(f.heatPerDamage, `${path}.heatPerDamage`, 0, 0.1);
    if (f.ventPosition !== undefined) vector(f.ventPosition, `${path}.ventPosition`);
  };
  mounts.forEach((m) => validateFire(m.fire, `${m.id}.fire`));
  compartments.forEach((c) => {
    validateFire(c.fire, `${c.id}.fire`);
    text(c.name, `${c.id}.name`);
    numeric(
      c.capacityM3,
      `${c.id}.capacityM3`,
      0.001,
      (c.size as number[]).reduce((a, v) => a * v, 1),
    );
    numeric(c.pumpM3PerSecond, `${c.id}.pumpM3PerSecond`, 0, 100);
    if (c.cells !== undefined) {
      const cells = list(c.cells, `${c.id}.cells`, 2048);
      if (!cells.length) fail(String(c.id), 'compound space requires cells');
      let volume = 0;
      cells.forEach((value) => {
        const cell = record(value, 'cell'),
          center = vector(cell.center, 'cell.center'),
          size = vector(cell.size, 'cell.size', 0.001);
        if (center.some((n, axis) => Math.abs(n - (c.center as number[])[axis]) + size[axis] / 2 > (c.size as number[])[axis] / 2 + 1e-6))
          fail(String(c.id), 'cell outside compartment bounds');
        volume += size[0] * size[1] * size[2];
      });
      if ((c.capacityM3 as number) > volume + 1e-6) fail(String(c.id), 'capacity exceeds compound volume');
      const boxes = cells
        .map((value) => value as { center: Vec3; size: Vec3 })
        .sort((a, b) => a.center[0] - a.size[0] / 2 - (b.center[0] - b.size[0] / 2));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          if (b.center[0] - b.size[0] / 2 >= a.center[0] + a.size[0] / 2 - 1e-6) break;
          if (a.center.every((n, axis) => Math.abs(n - b.center[axis]) < (a.size[axis] + b.size[axis]) / 2 - 1e-6))
            fail(String(c.id), 'compound cells overlap');
        }
    }
  });
}

export function validateFloodRegions(b: Rec, compartments: Rec[]): void {
  if (b.floodRegions !== undefined)
    volumes(b.floodRegions, 'floodRegions', 512).forEach((r) => {
      if (!compartments.some((c) => c.id === r.compartmentId)) fail(String(r.id), 'unknown flooding compartment');
      if (r.face !== undefined) literal(r.face, ['port', 'starboard', 'bow', 'stern'], `${r.id}.face`);
    });
}

export function validateObstructionsAndConnections(b: Rec, compartments: Rec[]): void {
  volumes(b.obstructions, 'obstructions');
  const connectionIds = new Set<string>();
  list(b.connections, 'connections', 16384).forEach((v, i) => {
    const c = record(v, `connections[${i}]`);
    numeric(c.areaM2, `connections[${i}].areaM2`, 0, 100);
    if (c.id !== undefined) id(c.id, `connections[${i}].id`);
    if (c.state !== undefined) literal(c.state, ['open', 'closed', 'damaged'], `connections[${i}].state`);
    if (c.position !== undefined) vector(c.position, `connections[${i}].position`);
    if (c.thicknessMm !== undefined) {
      numeric(c.thicknessMm, 'connection.thicknessMm', 0.001, 2000);
      if (c.bounds === undefined || c.armorId !== undefined)
        fail('connections', 'standalone boundary thickness requires bounds and no armor link');
    }
    if (c.armorId !== undefined && !list(b.armor, 'armor', 1024).some((a) => record(a, 'armor').id === c.armorId))
      fail('connections', 'unknown boundary protection');
    if (c.bounds !== undefined) {
      const bounds = record(c.bounds, 'connection.bounds');
      vector(bounds.center, 'connection center');
      vector(bounds.size, 'connection size', 0.001);
    }
    if (c.fromId === c.toId || !compartments.some((p) => p.id === c.fromId) || !compartments.some((p) => p.id === c.toId))
      fail('connections', 'invalid compartment connection');
    const key = [c.fromId, c.toId].sort().join(':');
    if (connectionIds.has(key)) fail('connections', 'duplicate compartment connection');
    connectionIds.add(key);
  });
  const namedConnections = list(b.connections, 'connections', 16384)
    .map((c) => record(c, 'connection'))
    .filter((c) => c.id !== undefined);
  unique(namedConnections, 'connections');
}
