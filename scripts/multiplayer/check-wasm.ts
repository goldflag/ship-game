import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rustTool } from './toolchain';
import fixture from '../../assets/gameplay/migration/reference.v1.json';
// Built explicitly by multiplayer:wasm; do not silently skip a missing WASM build.
const modulePath = '../../src/generated/naval-wasm/naval_wasm.js';
const wasm = await import(modulePath);
await wasm.default({ module_or_path: await readFile(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)) });
let checkpoints = 0;
const started = performance.now();
for (const trace of fixture.motion) {
  const { id, handling, inputs } = trace;
  const actual = JSON.parse(wasm.motion_trace_json(JSON.stringify({ id, handling, inputs })));
  actual.checkpoints.forEach((state: Record<string, unknown>, i: number) => {
    for (const [key, value] of Object.entries(trace.checkpoints[i])) {
      if (typeof value === 'number') assert.ok(Math.abs(Number(state[key]) - value) <= 1e-7, `${id} ${key}: ${state[key]} / ${value}`);
      else assert.equal(state[key], value);
    }
    checkpoints++;
  });
}
for (const { seed, selection } of fixture.environments) assert.deepEqual(JSON.parse(wasm.environment_json(seed, JSON.stringify(['open-ocean', 'islands']), JSON.stringify(['map', 'clear', 'storm']))), selection);
const ships = [{ team: 'a', displacementKg: 100, physicalLoss: null }, { team: 'b', displacementKg: 100, physicalLoss: null }];
assert.equal(JSON.parse(wasm.evaluate_outcome_json(107999, JSON.stringify(ships))), null);
assert.deepEqual(JSON.parse(wasm.evaluate_outcome_json(108000, JSON.stringify(ships))), { winnerTeamId: null, reason: 'time-limit', finalTick: 108000, afloatKg: [100, 100] });
assert.throws(() => wasm.motion_trace_json(JSON.stringify({ id: 'oversized', handling: fixture.motion[0].handling, inputs: [{ ticks: 108001, command: { throttle: 0, rudder: 0 } }] })));
console.log(`WASM verified ${checkpoints} motion checkpoints, seeded conditions and end-of-tick rules in ${(performance.now() - started).toFixed(1)} ms. This is a migration check, not server capacity evidence.`);
const projectiles = JSON.parse(await readFile(new URL('../../assets/gameplay/migration/projectiles.v1.json', import.meta.url), 'utf8'));
function compare(actual: unknown, expected: unknown, path: string): void {
 if (typeof expected === 'number') { assert.ok(typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6, `${path}: ${actual} / ${expected}`); return; }
 if (Array.isArray(expected)) { assert.ok(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path); expected.forEach((value, i) => compare(actual[i], value, `${path}[${i}]`)); return; }
 if (expected && typeof expected === 'object') { for (const [key,value] of Object.entries(expected)) compare((actual as Record<string,unknown>)?.[key], value, `${path}.${key}`); return; }
 assert.equal(actual, expected, path);
}
const migration = new wasm.ProjectileMigration(await readFile(new URL('../../.build/naval-content/manifest.json', import.meta.url)));
let flights = 0;
try {
 for (const c of projectiles.cases) for (const shot of c.shots) {
  const actual = JSON.parse(migration.run(JSON.stringify({ presetId: c.id, actorId: c.id, shell: shot.initial, ticks: 360 })));
  for (const key of ['ticks','end','shell','events']) compare(actual[key], shot[key], `${c.id}.${key}`);
  const expected = structuredClone(c.baseline);
  for (const patch of shot.patches) { let target = expected; for (const key of patch.path.slice(0,-1)) target = target[key]; target[patch.path.at(-1)] = patch.value; }
  compare(actual.damage, expected.damage, `${c.id}.damage`); compare(actual.mounts, expected.mounts, `${c.id}.mounts`); flights++;
 }
} finally { migration.free(); }
console.log(`WASM verified ${flights} complete shell trajectories, damage records, bursts and water entries against the TypeScript reference.`);
const battles = JSON.parse(await readFile(new URL('../../assets/gameplay/migration/battles.v1.json', import.meta.url), 'utf8'));
// Airframe performance has intentionally superseded the frozen TS flight model.
// Compare complete carrier snapshots against the current native engine instead.
const native = Bun.spawn([rustTool('cargo'), 'run', '--release', '--locked', '-p', 'naval-sim', '--example', 'carrier_checkpoints'], {
 cwd: fileURLToPath(new URL('../..', import.meta.url)), stdout: 'pipe', stderr: 'inherit',
});
const nativeOutput = await new Response(native.stdout).text();
assert.equal(await native.exited, 0, 'native carrier checkpoint generation');
const carrierCheckpoints = JSON.parse(nativeOutput);
let battleTicks = 0;
for (const c of battles.cases) {
 const runtime = new wasm.BattleRuntime(await readFile(new URL('../../.build/naval-content/manifest.json', import.meta.url)), JSON.stringify(c.setup));
 try {
  if (c.baseline.wings.some((w: {ownerId:string}) => w.ownerId === 'player')) {
   const initial = JSON.parse(runtime.migration_snapshot());
   const wing = initial.wings.find((w: {ownerId:string}) => w.ownerId === 'player');
   for (const squadron of [...new Set(wing.state.planes.map((p: {squadronId:string}) => p.squadronId))]) {
    const p = wing.state.planes.find((p: {squadronId:string}) => p.squadronId === squadron);
    assert.equal(runtime.command_air('player', `player/${squadron}/squadron-1`, JSON.stringify(p.role === 'fighter' ? {kind:'defend'} : {kind:'attack',targetId:'enemy-1'})), true);
   }
  }
  for (let tick = 1; tick <= c.duration * 60; tick++) {
   runtime.step(JSON.stringify({player:{helm:{throttle:.6,rudder:tick<900?.4:0},guns:{battery:c.battery,aim:c.aims[tick-1],fire:true,ammunition:{[c.battery]:tick<1200?'ap':'he'}},movement:{type:'autonomous'}}}), 1);
   const checkpoint = c.checkpoints.find((p: {tick:number}) => p.tick === tick);
   if (checkpoint) {
    const expected = structuredClone(c.baseline);
    for (const patch of checkpoint.patches) {let parent = expected; for (const key of patch.path.slice(0,-1)) parent = parent[key]; parent[patch.path.at(-1)] = patch.value;}
    const actual = JSON.parse(runtime.migration_snapshot());
    actual.score = actual.records.scores.player; actual.shellHistory = actual.records.shellHistory;
    if (carrierCheckpoints[c.id]) {
     compare(actual, carrierCheckpoints[c.id][tick], `${c.id}.native/WASM@${tick}`);
     // Launch admission and deck roll still match the frozen migration model.
     if (tick <= 60) compare(actual, expected, `${c.id}.battle@${tick}`);
    } else compare(actual, expected, `${c.id}.battle@${tick}`);
   }
   battleTicks++;
  }
 } finally { runtime.free(); }
}
console.log(`WASM verified ${battleTicks} battle ticks: frozen surface parity and current native carrier parity, including sorties, AA, underwater weapons, damage records and shell history.`);
