import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isGlazing } from '../../src/game/ShipMaterialPalette';
import { shipPresets } from '../../src/ships/presets';

/** A recipe call whose object is a pane (its first string names a scuttle, porthole, window or glass), not the frame,
 * rim or opening around one. */
const PANE = /scuttle|porthole|portlight|window|glass|glazing/i;
const NOT_PANE = /rim|frame|collar|flange|sill|mullion|hood|eyebrow|visor|ledge|shutter|slit|aperture|opening|wiper|recess/i;
/** A call with at most one level of nested parentheses, and its arguments. */
const CALL = /\b\w+\(((?:[^()]|\([^()]*\))*)\)/g;

function recipes(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return /^(baseline|authoring|attachment-audit)$/.test(name) ? [] : recipes(path);
    return name.endsWith('.py') && !/review/.test(name) ? [path] : [];
  });
}

describe('glazing', () => {
  test('recipes model window panes, scuttles and rangefinder windows in glass, not the matte dark paint', () => {
    const offenders: string[] = [];
    for (const path of recipes('assets/ships')) readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      for (const [, args] of line.matchAll(CALL)) {
        const name = /['"]([^'"]*)['"]/.exec(args)?.[1] ?? '';
        if (PANE.test(name) && !NOT_PANE.test(name) && /(['"]dark['"]|\bdark\b)/.test(args.slice(args.indexOf(name) + name.length)))
          offenders.push(`${path}:${index + 1} ${name}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  test('every published glass material is drawn as glazing', () => {
    for (const id of Object.keys(shipPresets)) {
      const bytes = readFileSync(`public/models/${id}.glb`);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      for (const material of gltf.materials ?? []) {
        const name = String(material.name ?? '');
        if (!/glass|glazing|optic|lens/i.test(name) || material.extras?.componentMaterialRole) continue;
        expect(isGlazing({ name, userData: {} } as never), `${id}: ${name}`).toBe(true);
      }
    }
  });
});
