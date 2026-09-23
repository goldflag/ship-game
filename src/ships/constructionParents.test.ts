import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructionEquipment, ConstructionSource, Vec3 } from './blueprint';
import { applyConstructionBatch, ConstructionCommandError, type ConstructionCommand } from './constructionCommands';
import { copyConstructionSelection, decodeConstructionSource } from './constructionEditor';
import { parseConstructionCatalog } from './constructionEquipment';
import { carriedIds, carriedPoses, carrierOf, mayRideTrainable, parentCandidates, parentChain } from './constructionParents';
import { placementItems, reseatCommands, reseatItems, type Placement } from './constructionPlacement';
import { constructionSummary } from './constructionQuery';
import { createStarterSource } from './constructionStarter';
import { withMirroredEdits } from '../ui/shipbuilding/mirrorEditing';

const catalog = parseConstructionCatalog(
  JSON.parse(readFileSync(join(import.meta.dir, '../../public/models/components/catalog.json'), 'utf8')),
);
const row = (id: string, partId: string, position: Vec3, parent?: string, bearingDeg = 0): ConstructionEquipment => ({
  id,
  partId,
  position,
  bearingDeg,
  ...(parent ? { parent } : {}),
});
/** A mast carrying a light that carries a lamp, a post on the hull, an off-centre post with a cap, and a gun. */
function rigged(): ConstructionSource {
  const source = createStarterSource(catalog, 'fletcher-hull');
  source.construction.equipment = [
    row('mast', 'fletcher-aft-mast', [0, 8, 10]),
    row('light', 'generic-single-bollard', [0, 20, 10], 'mast'),
    row('lamp', 'generic-single-bollard', [1, 21, 10], 'light'),
    row('side', 'generic-single-bollard', [3, 5, -10], 'hull'),
    row('post', 'generic-single-bollard', [4, 5, 0]),
    row('cap', 'generic-single-bollard', [4, 6, 0], 'post'),
    row('gun', 'us-5in38-mk30-mod0-single', [0, 6, -30]),
  ];
  return source;
}
const apply = (source: ConstructionSource, ...commands: ConstructionCommand[]) =>
  applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Test', commands });
const at = (source: ConstructionSource, id: string) => source.construction.equipment.find((e) => e.id === id);
const pose = (source: ConstructionSource, id: string) => {
  const e = at(source, id)!;
  return [e.position, e.bearingDeg];
};

describe('equipment parents in commands', () => {
  test('moving a parent moves everything it carries once; the hull carries its riders', () => {
    const next = apply(rigged(), { op: 'move', ids: ['mast', 'lamp'], delta: [1, 2, 3] });
    expect(pose(next, 'mast')).toEqual([[1, 10, 13], 0]);
    expect(pose(next, 'light')).toEqual([[1, 22, 13], 0]);
    expect(pose(next, 'lamp')).toEqual([[2, 23, 13], 0]);
    expect(pose(next, 'side')).toEqual([[3, 5, -10], 0]);
    const hull = apply(rigged(), { op: 'move', ids: ['hull'], delta: [0, 0, 5] });
    expect(pose(hull, 'side')).toEqual([[3, 5, -5], 0]);
    expect(pose(hull, 'mast')).toEqual([[0, 8, 10], 0]);
  });

  test('turning a parent swings its riders about its datum and keeps their pose on it', () => {
    const next = apply(rigged(), { op: 'rotate', ids: ['mast', 'light'], degrees: 90 });
    expect(pose(next, 'mast')).toEqual([[0, 8, 10], 90]);
    // Carried, not turned twice: a clockwise quarter turn takes starboard to stern.
    expect(pose(next, 'light')).toEqual([[0, 20, 10], 90]);
    expect(pose(next, 'lamp')).toEqual([[0, 21, 11], 90]);
    // A hull piece's rotationDeg is counter-clockwise: its rider swings bow to port and turns by −90.
    const hull = apply(rigged(), { op: 'rotate', ids: ['hull'], degrees: 90 });
    expect(hull.construction.primitives[0].rotationDeg).toBe(90);
    expect(pose(hull, 'side')).toEqual([[-10, 5, -3], 270]);
    expect(pose(hull, 'mast')).toEqual([[0, 8, 10], 0]);
  });

  test('removing a parent removes what it carries; removing a child removes only it', () => {
    const next = apply(rigged(), { op: 'remove', ids: ['mast'] });
    expect(next.construction.equipment.map((e) => e.id)).toEqual(['side', 'post', 'cap', 'gun']);
    const child = apply(rigged(), { op: 'remove', ids: ['light'] });
    expect(child.construction.equipment.map((e) => e.id)).toEqual(['mast', 'side', 'post', 'cap', 'gun']);
    const leaf = apply(rigged(), { op: 'remove', ids: ['lamp'] });
    expect(leaf.construction.equipment.map((e) => e.id)).toEqual(['mast', 'light', 'side', 'post', 'cap', 'gun']);
  });

  test('copying a parent needs a copy of each rider and remaps them; a child copied alone keeps its parent', () => {
    let error: unknown;
    try {
      apply(rigged(), { op: 'copy', copies: [{ from: 'mast', to: 'mast-2' }] });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ConstructionCommandError);
    expect((error as Error).message).toContain('add copies for "light", "lamp"');
    const next = apply(rigged(), {
      op: 'copy',
      copies: [
        { from: 'mast', to: 'mast-2' },
        { from: 'light', to: 'light-2' },
        { from: 'lamp', to: 'lamp-2' },
      ],
      offset: [0, 0, 10],
    });
    expect(at(next, 'mast-2')!.parent).toBeUndefined();
    expect(at(next, 'light-2')).toMatchObject({ parent: 'mast-2', position: [0, 20, 20] });
    expect(at(next, 'lamp-2')!.parent).toBe('light-2');
    const alone = apply(rigged(), { op: 'copy', copies: [{ from: 'lamp', to: 'lamp-2' }] });
    expect(at(alone, 'lamp-2')!.parent).toBe('light');
  });

  test('a mirrored copy rides the mirrored parent, keeps a centreline parent and drops one off the centreline', () => {
    const pair = apply(rigged(), {
      op: 'copy',
      copies: [
        { from: 'post', to: 'post-port' },
        { from: 'cap', to: 'cap-port' },
      ],
      mirror: true,
    });
    expect(at(pair, 'cap-port')).toMatchObject({ parent: 'post-port', position: [-4, 6, 0] });
    const centreline = apply(rigged(), {
      op: 'copy',
      copies: [
        { from: 'lamp', to: 'lamp-port' },
        { from: 'side', to: 'side-port' },
      ],
      mirror: true,
    });
    expect(at(centreline, 'lamp-port')!.parent).toBe('light');
    expect(at(centreline, 'side-port')!.parent).toBe('hull');
    const offside = apply(rigged(), { op: 'copy', copies: [{ from: 'cap', to: 'cap-port' }], mirror: true });
    expect(at(offside, 'cap-port')).not.toHaveProperty('parent');
  });

  test('the editor copy brings riders along with fresh IDs', () => {
    const source = rigged();
    const copied = copyConstructionSelection(source, new Set(['post']));
    expect(copied).toHaveLength(2);
    const [post, cap] = copied.map((id) => at(source, id)!);
    expect(post.partId).toBe('generic-single-bollard');
    expect(cap.parent).toBe(post.id);
  });

  test('parent is an optional source field: shape-checked by the decoder, patchable and removable', () => {
    const source = rigged();
    const bad = structuredClone(source) as unknown as { construction: { equipment: Record<string, unknown>[] } };
    bad.construction.equipment[1].parent = 7;
    expect(() => decodeConstructionSource(bad)).toThrow(/Equipment parent must be text/);
    bad.construction.equipment[1].parent = '';
    expect(() => decodeConstructionSource(bad)).toThrow(/Equipment parent must name/);
    const patched = apply(source, { op: 'equipment-patch', id: 'post', changes: { parent: 'hull' } });
    expect(at(patched, 'post')!.parent).toBe('hull');
    const cleared = apply(patched, { op: 'equipment-patch', id: 'post', changes: { parent: null } } as unknown as ConstructionCommand);
    expect(at(cleared, 'post')).not.toHaveProperty('parent');
    expect(JSON.stringify(createStarterSource(catalog, 'fletcher-hull'))).not.toContain('"parent"');
  });

  test('graph helpers survive loops and report chains nearest first', () => {
    const source = rigged();
    expect(parentChain(source.construction, 'lamp')).toEqual(['light', 'mast']);
    expect([...carriedIds(source.construction, ['mast'])]).toEqual(['light', 'lamp']);
    at(source, 'mast')!.parent = 'lamp';
    expect(parentChain(source.construction, 'lamp')).toEqual(['light', 'mast']);
    expect([...carriedIds(source.construction, ['light'])].sort()).toEqual(['lamp', 'mast']);
    expect(carriedPoses(rigged().construction, 'post', [4, 5, 0], [4, 5, 0], 180)).toEqual([
      row('cap', 'generic-single-bollard', [4, 6, 0], 'post', 180),
    ]);
  });

  test('candidates are nearby pieces and carriers, never the row or its riders; a gun only for what may ride one', () => {
    const source = rigged();
    const options = parentCandidates(source, catalog, at(source, 'light')!, 100);
    const ids = options.map((c) => c.id);
    expect(ids).toContain('mast');
    expect(ids).toContain('hull');
    expect(ids).not.toContain('light');
    expect(ids).not.toContain('lamp');
    expect(options.find((c) => c.id === 'gun')?.label).toEndWith(' · trains');
    expect(parentCandidates(source, catalog, at(source, 'cap')!)[0].id).toBe('post');
    // A mast cannot ride a gun, nor anything a gun carries; neither can a fitting that carries a mast.
    source.construction.equipment.push(row('roof', 'generic-single-bollard', [0, 9, -30], 'gun'));
    const forMast = parentCandidates(source, catalog, at(source, 'mast')!, 100).map((c) => c.id);
    expect(forMast).not.toContain('gun');
    expect(forMast).not.toContain('roof');
    expect(forMast).toContain('post');
    source.construction.equipment.find((e) => e.id === 'mast')!.parent = 'post';
    expect(parentCandidates(source, catalog, at(source, 'post')!, 100).map((c) => c.id)).not.toContain('gun');
  });

  test('a row trains with the nearest gun up its chain', () => {
    const source = rigged();
    source.construction.equipment.push(
      row('roof', 'generic-single-bollard', [0, 9, -30], 'gun'),
      row('lantern', 'generic-single-bollard', [0, 10, -30], 'roof'),
    );
    const data = source.construction;
    expect(carrierOf(data, catalog, 'roof')).toBe('gun');
    expect(carrierOf(data, catalog, 'lantern')).toBe('gun');
    expect(carrierOf(data, catalog, 'lamp')).toBeUndefined();
    expect(carrierOf(data, catalog, 'gun')).toBeUndefined();
    const part = (id: string) => catalog.equipment.find((p) => p.id === id);
    expect(mayRideTrainable(source, catalog, at(source, 'light')!, part('generic-single-bollard'))).toBe(true);
    expect(mayRideTrainable(source, catalog, at(source, 'mast')!, part('fletcher-aft-mast'))).toBe(false);
    const flak = row('flak', 'flak38-20-vierling', [0, 9, -30], 'gun');
    expect(mayRideTrainable(source, catalog, flak, part('flak38-20-vierling'))).toBe(true);
    expect(mayRideTrainable(source, catalog, { ...flak, gun: { barbetteHeightM: 1 } }, part('flak38-20-vierling'))).toBe(false);
  });
});

describe('equipment parents in placement and queries', () => {
  test('place --parent sets the link and refuses what the compiler would refuse', () => {
    const source = rigged();
    const [item] = placementItems(source, catalog, { partId: 'generic-twin-bitts', at: [0, 12], parent: 'mast' });
    expect(item.equipment.parent).toBe('mast');
    const twins = placementItems(source, catalog, { partId: 'generic-twin-bitts', at: [2, 12], parent: 'mast', mirror: true });
    expect(twins.map((i) => i.equipment.parent)).toEqual(['mast', 'mast']);
    const bad = (options: Partial<Parameters<typeof placementItems>[2]>, message: RegExp) =>
      expect(() => placementItems(source, catalog, { partId: 'generic-twin-bitts', at: [0, 0], ...options })).toThrow(message);
    bad({ parent: 'nowhere' }, /Unknown parent nowhere/);
    expect(placementItems(source, catalog, { partId: 'generic-twin-bitts', at: [0, -30], parent: 'gun' })[0].equipment.parent).toBe('gun');
    bad({ partId: 'fletcher-aft-mast', parent: 'gun' }, /cannot ride the trainable gun gun/);
    source.construction.equipment.push(row('tubes', 'fletcher-quintuple-533', [0, 6, 20]));
    bad({ parent: 'tubes' }, /launcher yet/);
    bad({ partId: 'us-5in38-mk30-mod0-single', parent: 'mast' }, /needs hull support/);
    bad({ parent: 'post', at: [2, 0], mirror: true }, /its own --parent/);
  });

  test('reseat --all leaves riders to their parent, and a reseated parent carries them', () => {
    const source = rigged();
    const { items, skipped } = reseatItems(source, catalog, 'all');
    expect(items.map((i) => i.equipment.id)).toEqual(['mast', 'post', 'gun']);
    expect(skipped.find((s) => s.id === 'light')?.reason).toContain('rides its parent mast');
    expect(reseatItems(source, catalog, ['light']).items.map((i) => i.equipment.id)).toEqual(['light']);
    const seated: Placement = {
      id: 'mast',
      partId: 'x',
      status: 'seated',
      from: [0, 8, 10],
      position: [0, 7.5, 10],
      bearingDeg: 0,
      attachment: [0, 7.5, 10],
      direction: [0, -1, 0],
    };
    expect(reseatCommands([seated], 1e-3, source)).toEqual([
      { op: 'equipment-patch', id: 'mast', changes: { position: [0, 7.5, 10] } },
      { op: 'move', ids: ['light', 'lamp'], delta: [0, -0.5, 0] },
    ]);
    expect(reseatCommands([seated])).toHaveLength(1);
  });

  test('summary lists who rides what', () => {
    const summary = constructionSummary(rigged(), catalog);
    expect(summary.parents).toEqual({ light: 'mast', lamp: 'light', side: 'hull', cap: 'post' });
    expect(constructionSummary(createStarterSource(catalog, 'fletcher-hull'), catalog)).not.toHaveProperty('parents');
  });

  test('mirror editing carries the riders of a twin that the edit only rewrites', () => {
    const source = rigged();
    source.construction.equipment.push(
      row('post-port', 'generic-single-bollard', [-4, 5, 0]),
      row('cap-port', 'generic-single-bollard', [-4, 6, 1], 'post-port'),
    );
    const commands = withMirroredEdits(source, [{ op: 'move', ids: ['post'], delta: [0, 0, 2] }]);
    const next = apply(source, ...commands);
    expect(pose(next, 'cap')).toEqual([[4, 6, 2], 0]);
    expect(pose(next, 'post-port')).toEqual([[-4, 5, 2], 0]);
    expect(pose(next, 'cap-port')).toEqual([[-4, 6, 3], 0]);
  });
});
