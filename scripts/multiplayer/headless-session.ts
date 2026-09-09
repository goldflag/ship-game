/** Test adapter: actual WASM authority, with synchronous scheduling instead of a
 * browser worker. GPU scene tests can bind the exact production snapshots. */
import init, { LocalRuntime } from '../../src/generated/naval-wasm/naval_wasm';
import { SnapshotSession, decodeSnapshot } from '../../src/game/session/SnapshotSession';
import { runtimeSetup } from '../../src/game/session/LocalBattleSession';
import type { BattleSetup } from '../../src/simulation/battle';
import type { Command } from '../../src/multiplayer/generated/Command';
import type { CombatIntent } from '../../src/simulation/combat';
import type { HelmCommand } from '../../src/simulation/ship';
import type { AirRules } from '../../src/multiplayer/generated/AirRules';
let initialized: Promise<unknown> | undefined;
export class HeadlessSession extends SnapshotSession {
  readonly networked = false; private sequence = 0;
  private constructor(setup: ReturnType<typeof runtimeSetup>, readonly runtime: LocalRuntime) { super(setup); this.apply(decodeSnapshot(runtime.snapshot())); }
  static async create(setup: BattleSetup, fixture?: { manifest: Uint8Array; airRules: AirRules }) {
    await (initialized ??= Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer().then(module_or_path => init({ module_or_path })));
    const manifest = fixture?.manifest ?? new Uint8Array(await Bun.file(new URL('../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
    const runtime = runtimeSetup(setup, 12345);
    if (fixture) runtime.airRules = fixture.airRules;
    return new HeadlessSession(runtime, new LocalRuntime(manifest, JSON.stringify(runtime)));
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
