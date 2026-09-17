import { expect, test } from 'bun:test';
import init, { ballistic_step_json, mount_carriers_json, solve_drag_arc_json } from '../generated/naval-wasm/naval_wasm';
import { ballisticStep, solveDragArc } from './ballistics';
import { updateMountCarriers } from './mountFrames';
import { shipPreset } from '../ships/presets';
import type { Vec3 } from '../ships/blueprint';

// The client keeps its own copies of two pieces of the authority's arithmetic
// for presentation that cannot wait for a round trip: the ballistic step
// behind aim arcs and tracers, and the yaw frames of carried mounts. The
// Rust originals are the reference; these keep the copies from drifting.
await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
const close = (a: readonly number[], b: readonly number[], label: string) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v)) + 1e-12));

test('the ballistic step matches the authority across drag, speed and flight time', () => {
  const velocities: Vec3[] = [[820, 0, 0], [500, 300, -400], [0, 900, 0], [120, -40, 260], [0, 0, 0]];
  for (const drag of [0, 1e-9, 1e-4, .0025, .02, .11]) for (const seconds of [0, 1 / 60, .25, 1, 4.5, 30, 120]) for (const velocity of velocities) {
    const position: Vec3 = [1234.5, 8.25, -987.75];
    const ours = ballisticStep(position, velocity, seconds, drag);
    const [p, v] = JSON.parse(ballistic_step_json(JSON.stringify(position), JSON.stringify(velocity), seconds, drag)) as [Vec3, Vec3];
    close(ours.position, p, `position drag ${drag} t ${seconds}`); close(ours.velocity, v, `velocity drag ${drag} t ${seconds}`);
  }
});

test('the low drag arc matches the authority, including unreachable shots', () => {
  const from: Vec3 = [0, 12, 0];
  for (const drag of [0, .001, .02, .06]) for (const speed of [300, 820, 1000]) for (const target of [[3000, 0, 0], [0, 40, -14000], [22000, 0, 3000], [500, 800, 500], [60000, 0, 0]] as Vec3[]) {
    const ours = solveDragArc(from, target, speed, drag);
    const theirs = JSON.parse(solve_drag_arc_json(JSON.stringify(from), JSON.stringify(target), speed, drag)) as [Vec3, number] | null;
    expect(ours === null).toBe(theirs === null);
    if (ours && theirs) { close(ours.direction, theirs[0], 'direction'); close([ours.time], [theirs[1]], 'time'); }
  }
});

test('carried-mount frames match the authority at random trains', () => {
  let seed = 0x6e617661;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (const id of ['iowa', 'yamato', 'bismarck', 'enterprise-cv6', 'fletcher']) {
    const definition = shipPreset(id);
    for (let round = 0; round < 4; round++) {
      const states = definition.mounts.map(() => ({ train: random() * Math.PI, carrier: undefined as { position: Vec3; heading: number } | undefined }));
      updateMountCarriers(definition, states);
      const theirs = JSON.parse(mount_carriers_json(JSON.stringify(definition), JSON.stringify(states.map(s => s.train)))) as ([Vec3, number] | null)[];
      expect(theirs).toHaveLength(states.length);
      states.forEach((state, i) => {
        expect(!!state.carrier).toBe(theirs[i] !== null);
        if (state.carrier && theirs[i]) { close(state.carrier.position, theirs[i]![0], `${id} mount ${i} position`); close([state.carrier.heading], [theirs[i]![1]], `${id} mount ${i} heading`); }
      });
    }
  }
});
