/** Test adapter: actual WASM authority, with synchronous scheduling instead of a
 * browser worker. GPU scene tests can bind the exact production snapshots. */
import init, { LocalRuntime, PvePlanner } from '../../src/generated/naval-wasm/naval_wasm';
import { SnapshotSession } from '../../src/game/session/SnapshotSession';
import { decodeSnapshot } from '../../src/game/session/snapshotCodec';
import { portSetup, runtimeSetup } from '../../src/game/session/LocalBattleSession';
import type { ShipDefinition } from '../../src/ships/blueprint';
import type { LocalShipRevision } from '../../src/ships/localShips';
import type { BattleSetup } from '../../src/game/session/battleSetup';
import type { Command } from '../../src/multiplayer/generated/Command';
import type { CombatIntent } from '../../src/game/session/telemetry';
import type { HelmCommand } from '../../src/game/session/motion';
import type { AirRules } from '../../src/multiplayer/generated/AirRules';
let initialized: Promise<unknown> | undefined;
export class HeadlessSession extends SnapshotSession {
  readonly networked = false; private sequence = 0;
  private constructor(setup: ReturnType<typeof runtimeSetup>, readonly runtime: LocalRuntime, port = false, definitions: ReadonlyMap<string, ShipDefinition> = new Map()) { super(setup, 'a', 0, definitions, port); this.apply(decodeSnapshot(runtime.snapshot())); }
  static async create(setup: BattleSetup, fixture?: { manifest: Uint8Array; airRules: AirRules }) {
    await (initialized ??= Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer().then(module_or_path => init({ module_or_path })));
    const manifest = fixture?.manifest ?? new Uint8Array(await Bun.file(new URL('../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
    const runtime = runtimeSetup(setup, 12345);
    if (fixture) runtime.airRules = fixture.airRules;
    return new HeadlessSession(runtime, new LocalRuntime(manifest, JSON.stringify(runtime)));
  }
  /** The port's session (see `LocalBattleSession.port`), on the test thread. */
  static async port(definition: ShipDefinition, revision?: LocalShipRevision): Promise<HeadlessSession> {
    await (initialized ??= Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer().then(module_or_path => init({ module_or_path })));
    const manifest = new Uint8Array(await Bun.file(new URL('../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
    const setup = portSetup(definition, 12345);
    if (!revision) return new HeadlessSession(setup, new LocalRuntime(manifest, JSON.stringify(setup)), true);
    // A player-built hull compiles from its frozen source against the published catalog.
    const catalog = await Bun.file(new URL('../../public/models/components/catalog.json', import.meta.url)).text();
    return new HeadlessSession(setup, LocalRuntime.with_construction(manifest, JSON.stringify(setup), JSON.stringify([revision.source]), `[${catalog}]`, false), true, new Map([[revision.definition.id, revision.definition]]));
  }
  static async createPve(request: import('../../src/multiplayer/generated/PveRequest').PveRequest): Promise<HeadlessSession> {
    await (initialized ??= Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer().then(module_or_path => init({ module_or_path })));
    const manifest = await Bun.file(new URL('../../.build/naval-content/manifest.json', import.meta.url)).bytes();
    const planner = new PvePlanner(manifest, JSON.stringify(request));
    try {
      const { setup } = JSON.parse(planner.briefing()) as import('../../src/multiplayer/generated/PveBriefing').PveBriefing;
      return new HeadlessSession(setup, planner.start(JSON.stringify(setup.ships.map(s => ({ id: s.id, spawn: s.spawn })))));
    } finally { planner.free(); }
  }
  protected send(shipId: string, command: Command) { this.runtime.command(JSON.stringify({ shipId, command, sequence: ++this.sequence, connectionEpoch: 1 })); }
  advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void) {
    if (dt <= 0) { this.consume(dt, beforeStep); return; }
    this.input(helm, intent, true); this.runtime.step(Math.min(6, Math.floor(dt * 60)));
    this.pending = decodeSnapshot(this.runtime.snapshot()); this.consume(dt, beforeStep);
  }
  applyRaw(json: string) { this.apply(decodeSnapshot(json)); }
  dispose() { this.runtime.free(); }
}
