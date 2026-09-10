/** Worker-side throughput ceiling, not rendered FPS or achieved browser speed.
 * bun scripts/diagnostics/pve-speed.ts --scenario surface --seconds 600 --batch 12
 * Optional --wasm and --output support old/new runs with exact final-state checks.
 */
import { parseArgs } from 'node:util';
import init, { PvePlanner } from '../../src/generated/naval-wasm/naval_wasm';
import { decodeSnapshot } from '../../src/game/session/snapshotCodec';
import { localDelta } from '../../src/game/session/localSnapshotDelta';
import { airborne } from '../../src/simulation/aircraft';
import type { PveBriefing } from '../../src/multiplayer/generated/PveBriefing';
import { pveSpeedScenario } from './pve-speed-scenario';

const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
  scenario: { type: 'string', default: 'surface' }, seconds: { type: 'string', default: '600' },
  batch: { type: 'string', default: '12' }, wasm: { type: 'string' }, output: { type: 'string' },
} });
const seconds = Number(values.seconds), batch = Number(values.batch);
if (!['surface', 'carrier'].includes(values.scenario!) || !Number.isInteger(seconds) || seconds < 60 || seconds > 3600 || seconds % 60
  || ![1, 2, 3, 4, 6, 12, 24].includes(batch)) throw new Error('Use scenario surface/carrier, seconds 60..3600 in whole minutes, batch 1/2/3/4/6/12/24.');
await init({ module_or_path: await Bun.file(values.wasm ?? 'src/generated/naval-wasm/naval_wasm_bg.wasm').arrayBuffer() });
const planner = new PvePlanner(await Bun.file('.build/naval-content/manifest.json').bytes(), JSON.stringify(pveSpeedScenario(values.scenario as 'surface' | 'carrier')));
const { setup } = JSON.parse(planner.briefing()) as PveBriefing;
const runtime = planner.start(JSON.stringify(setup.ships.map(s => ({ id: s.id, spawn: s.spawn }))));
planner.free();
try {
  let previous = decodeSnapshot(runtime.snapshot());
  for (let window = 0; window < seconds; window += 60) {
    const ms = { step: 0, serialize: 0, decode: 0, transferPreparation: 0 };
    let bytes = 0, peakOwnedAirborne = 0, peakVisibleShells = 0;
    const startTick = previous.tick, start = performance.now();
    for (let tick = 0; tick < 3600; tick += batch) {
      let t = performance.now();
      for (let left = batch; left > 0; left -= 6) runtime.step(Math.min(left, 6));
      ms.step += performance.now() - t;
      t = performance.now(); const json = runtime.snapshot(); ms.serialize += performance.now() - t; bytes += json.length;
      t = performance.now(); const next = decodeSnapshot(json); ms.decode += performance.now() - t;
      t = performance.now(); structuredClone(localDelta(previous, next)); ms.transferPreparation += performance.now() - t;
      previous = next;
      peakOwnedAirborne = Math.max(peakOwnedAirborne, next.wings.reduce((n, wing) => n + wing.state.planes.filter(airborne).length, 0));
      peakVisibleShells = Math.max(peakVisibleShells, next.shells.length);
      if (next.outcome) break;
    }
    const wallSeconds = (performance.now() - start) / 1000, simulatedSeconds = (previous.tick - startTick) / 60;
    console.log(JSON.stringify({ scenario: values.scenario, batch, tick: previous.tick, simulatedSeconds, wallSeconds,
      throughput: simulatedSeconds / wallSeconds, ms, snapshotBytesTotal: bytes, peakOwnedAirborne, peakVisibleShells }));
    if (previous.outcome) break;
  }
  if (values.output) await Bun.write(values.output, runtime.snapshot());
} finally { runtime.free(); }
