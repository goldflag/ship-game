import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction, LocalRuntime } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { freezeLocalFleet, registerLocalShip, removeLocalShip, resolveShip } from './localShips';
import { runtimeSetup } from '../game/session/LocalBattleSession';
import type { Snapshot } from '../game/session/SnapshotSession';
import { transferCustomShip, transferDuelShip } from '../ui/battle/fleetTransfer';
import { carryToDuel } from '../ui/battle/battleModes';
const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
function fixture() {
  const source = createStarterSource(catalog, 'blank'); source.name = 'Local test vessel';
  source.construction.primitives = [{ id: 'hull', kind: 'box', size: [10, 6, 40], position: [0, 0, 0], rotationDeg: 0 }];
  const result = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]); return { source, result };
}
test('custom selection supports duplicates and online fleet selection without changing the historical roster', () => {
  const { source, result } = fixture();
  try {
    const entry = registerLocalShip(source, result), id = entry.definition.id, frozen = freezeLocalFleet([id, id, 'fletcher']);
    expect(frozen).toHaveLength(1); expect(resolveShip(id).name).toBe(source.name);
    expect(transferDuelShip([], { kind: 'catalog', id }, 'fleet').fleet).toEqual([id]);
    expect(carryToDuel([id], id, [id])).toEqual([id]);
    const setup = { playerShipId: 'fletcher', friendlyBots: [], enemies: [], spawnDistance: 5000 };
    const first = transferCustomShip(setup, { kind: 'catalog', id }, 'enemy');
    const second = transferCustomShip(first.setup, { kind: 'catalog', id }, 'enemy');
    expect(second.setup.enemies).toHaveLength(2);
    source.name = 'Edited in port'; source.revision = 'new-revision';
    const updated = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
    registerLocalShip(source, updated);
    expect(frozen[0].definition.name).toBe('Local test vessel'); expect(Object.isFrozen(frozen[0].source.construction)).toBe(true);
    expect(() => resolveShip(id)).toThrow('unavailable'); expect(() => resolveShip('local-missing')).toThrow('unavailable');
  } finally { removeLocalShip(source.id); }
});
test('real local WASM recompiles sources, preserves independent damage, and confines trial controls', async () => {
  const { source, result } = fixture(), id = result.definition!.id;
  const manifest = new Uint8Array(await Bun.file(new URL('../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
  const setup = runtimeSetup({ playerShipId: id, friendlyBots: [id], enemies: ['liberty-cargo'], spawnDistance: 5000 }, 42);
  const args = [manifest, JSON.stringify(setup), JSON.stringify([source]), JSON.stringify(catalog)] as const;
  const battle = LocalRuntime.with_construction(...args, false);
  try { expect(Object.keys(JSON.parse(battle.construction_definitions()))).toEqual([id]); expect(() => battle.trial_action(JSON.stringify({ kind: 'damage', actorId: 'player', amount: 10 }))).toThrow(); }
  finally { battle.free(); }
  const trial = LocalRuntime.with_construction(...args, true);
  try {
    const before = JSON.parse(trial.snapshot());
    trial.trial_action(JSON.stringify({ kind: 'damage', actorId: 'player', amount: 10 }));
    const after = JSON.parse(trial.snapshot());
    expect(after.actors[0].damage.integrity).toBe(before.actors[0].damage.integrity - 10);
    expect(after.actors[1].damage.integrity).toBe(before.actors[1].damage.integrity);
    expect(source.construction.primitives).toHaveLength(1);
  } finally { trial.free(); }
});

