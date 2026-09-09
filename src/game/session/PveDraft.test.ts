import { beforeAll, expect, test } from 'bun:test';
import init, { PvePlanner } from '../../generated/naval-wasm/naval_wasm';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
let manifest: Uint8Array;
beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
  manifest = new Uint8Array(await Bun.file(new URL('../../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
});
const request: PveRequest = { version: 1, seed: 8171, mapId: 'pacific-islands', weather: 'clear', difficulty: 'normal',
  ships: [{ id: 'own-destroyer', presetId: 'fletcher', groupId: 'front' }], groups: [{ id: 'front', name: 'Vanguard', station: 'front' }] };
test('real WASM planner exposes owned deployment only and remains usable after an invalid placement', () => {
  const planner = new PvePlanner(manifest, JSON.stringify(request));
  try {
    const initial = planner.briefing();
    const briefing = JSON.parse(initial) as PveBriefing;
    expect(briefing.setup.ships.map(s => s.id)).toEqual(['own-destroyer']);
    expect(briefing.setup.ships.every(s => s.team === 'a')).toBe(true);
    expect(initial).not.toContain('opponent-');
    expect(briefing.totals).toEqual({ aircraft: 0, displacementKg: 2924000, ships: 1 });
    expect(() => planner.start(JSON.stringify([{ id: 'own-destroyer', spawn: { x: 0, z: -8000, heading: 0 } }]))).toThrow();
    expect(planner.briefing()).toBe(initial);
    const runtime = planner.start(JSON.stringify(briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn }))));
    try {
      const frame = JSON.parse(runtime.snapshot());
      expect(frame.actors.map((a: { motion: { id: string } }) => a.motion.id)).toEqual(['own-destroyer']);
      expect(frame.view).toBe('team'); expect(frame.debrief).toBeUndefined();
      expect(frame.afloatKg[1]).toBeNull(); expect(frame.remainingSeconds).toBeNull();
      expect(frame.contacts).toEqual([]); expect(frame.selectedShipIds[0]).toBeNull();
    } finally { runtime.free(); }
  } finally { planner.free(); }
});
test('restart restores the exact accepted mission and clears helm, orders, reports and battle time', () => {
  const planner = new PvePlanner(manifest, JSON.stringify(request));
  const briefing = JSON.parse(planner.briefing()) as PveBriefing;
  const runtime = planner.start(JSON.stringify([{ id: 'own-destroyer', spawn: { x: 0, z: 10000, heading: 0.2 } }]));
  planner.free();
  try {
    const initial = runtime.snapshot();
    runtime.command(JSON.stringify({ shipId: 'own-destroyer', sequence: 1, connectionEpoch: 1, command: { type: 'select', shipId: 'own-destroyer' } }));
    for (let i = 0; i < 20; i++) runtime.step(6);
    expect(JSON.parse(runtime.snapshot()).tick).toBe(120);
    runtime.restart_pve();
    expect(runtime.snapshot()).toBe(initial);
    expect(briefing.setup.seed).toBe(request.seed);
  } finally { runtime.free(); }
});
test('briefing options and placement preflight expose public content and preserve a rejected draft', () => {
  const options = JSON.parse(PvePlanner.options(manifest));
  expect(options.rules.budget).toEqual({ maxDisplacementKg: 200000000, maxShips: 15, maxAircraft: 100 });
  expect(options.eligiblePresets).toContain('shokaku');
  expect(options.eligiblePresets).not.toContain('type-viic');
  expect(options.ships).toBeUndefined();
  const planner = new PvePlanner(manifest, JSON.stringify(request));
  try {
    const before = planner.briefing();
    expect(() => planner.validate_placement(JSON.stringify([{ id: 'own-destroyer', spawn: { x: 0, z: -1000, heading: 0 } }]))).toThrow();
    expect(planner.briefing()).toBe(before);
    planner.validate_placement(JSON.stringify([{ id: 'own-destroyer', spawn: { x: 0, z: 11000, heading: .3 } }]));
    expect(JSON.parse(planner.briefing()).setup.ships[0].spawn).toEqual({ x: 0, z: 11000, heading: .3 });
  } finally { planner.free(); }
});
