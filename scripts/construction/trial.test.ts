import { expect, test } from 'bun:test';
import { FLAGS } from './builtins';
import { parseFlags } from './command';
import { HANDLING_GATE, compareMetrics, formatComparison, formatTrial, trialMetrics, type TrialReport } from './trial';

const KNOT = 1852 / 3600;
/** A report shaped like one line of maneuvering_trial's output; turn speed and yaw rate vary. */
function report(turnSpeed: number, yawRate: number, secondsTo90: number | null): TrialReport {
  const run = (scenario: TrialReport['trials'][number]['scenario'], speed: number, extra = {}) => ({
    scenario,
    speed,
    yawRate: 0,
    secondsToHalfSpeed: null,
    secondsTo90PercentSpeed: null,
    secondsTo90DegreeTurn: null,
    secondsToStop: null,
    ...extra,
  });
  return {
    ship: 'test',
    estimatedSpeed: 28 * KNOT,
    powerKw: 100_000,
    wettedAreaM2: 8000,
    fullness: 0.59,
    trials: [
      run('ahead', 28 * KNOT, { secondsTo90PercentSpeed: 29.8 }),
      run('half', 15 * KNOT),
      run('turn', turnSpeed, { yawRate, secondsTo90DegreeTurn: secondsTo90 }),
      run('coast', 2),
      run('crash-stop', -4, { secondsToStop: 30.4 }),
    ],
  };
}
const definition = { hull: { massKg: 45_272_000, draft: 10.56 }, handling: { forwardSpeed: 14.4, maxYawRate: 0.028 }, maneuvering: undefined } as never;
const byId = (metrics: ReturnType<typeof trialMetrics>) => Object.fromEntries(metrics.map((m) => [m.id, m.value]));

test('trial metrics read speeds in knots, the turn as a share of top speed and the port circle from handling', () => {
  const m = byId(trialMetrics(report(0.69 * 28 * KNOT, (1.48 * Math.PI) / 180, 37.9), definition));
  expect(m.topSpeed).toBeCloseTo(28, 6);
  expect(m.turnShare).toBeCloseTo(69, 6);
  expect(m.yawRate).toBeCloseTo(1.48, 6);
  expect(m.turn90).toBe(37.9);
  expect(m.circle).toBeCloseTo((2 * 0.69 * 28 * KNOT) / ((1.48 * Math.PI) / 180), 6);
  expect(m.astern).toBeCloseTo(4 / KNOT, 6);
  // Legacy ships (no maneuvering profile) show the ×1.1 gameplay yaw rate in port.
  expect(m.portCircle).toBeCloseTo((2 * 14.4) / (0.028 * 1.1), 6);
  expect(m.displacement).toBeCloseTo(45_272, 6);
});

test('the comparison fails a gated row that got worse beyond the gate and notes a gain', () => {
  // King George V's re-seat: 71% of top speed in a turn fell to 27%, while the stalled hull turned tighter.
  const before = trialMetrics(report(0.71 * 28 * KNOT, (1.51 * Math.PI) / 180, 37.3), definition);
  const after = trialMetrics(report(0.27 * 28 * KNOT, (2.5 * Math.PI) / 180, 26), definition);
  const rows = Object.fromEntries(compareMetrics(before, after).map((r) => [r.metric.id, r]));
  expect(rows.turnShare.verdict).toBe('worse');
  expect(rows.turnShare.change).toBeCloseTo(27 / 71 - 1, 6);
  expect(rows.yawRate.verdict).toBe('better');
  expect(rows.turn90.verdict).toBe('better');
  expect(rows.topSpeed.verdict).toBe('same');
  // Context rows never fail the gate, however far they move.
  expect(rows.circle.verdict).toBe('changed');
  expect(rows.turnSpeed.verdict).toBe('changed');
  const text = formatComparison('KGV', 'master', 'working tree', Object.values(rows));
  expect(text).toContain('FAIL: Hard-turn speed, share of top got worse');
  expect(text).toContain('never through handling.maxYawRate');
  expect(text).toContain('Gains beyond the gate (Hard-turn rate; Time to turn 90° (world pace))');
  expect(text).toMatch(/Hard-turn speed, share of top +71 +27 +% +-62% +<< WORSE beyond gate/);
});

test('changes within the gate pass, and a missed 90° turn counts as worse', () => {
  const before = trialMetrics(report(0.71 * 28 * KNOT, (1.51 * Math.PI) / 180, 37.3), definition);
  const near = trialMetrics(report(0.69 * 28 * KNOT, (1.48 * Math.PI) / 180, 37.9), definition);
  const rows = compareMetrics(before, near);
  expect(rows.filter((r) => r.metric.gated).map((r) => r.verdict)).toEqual(['same', 'within', 'within', 'within']);
  expect(formatComparison('KGV', 'a', 'b', rows)).toContain('PASS');
  // Exactly at the gate still passes.
  const edge = trialMetrics(report(0.71 * 28 * KNOT, (1.51 * (1 - HANDLING_GATE) * Math.PI) / 180, 37.3), definition);
  expect(compareMetrics(before, edge).find((r) => r.metric.id === 'yawRate')!.verdict).toBe('within');
  const never = compareMetrics(before, trialMetrics(report(0.71 * 28 * KNOT, 0.001, null), definition));
  expect(never.find((r) => r.metric.id === 'turn90')!.verdict).toBe('worse');
  expect(formatComparison('x', 'a', 'b', never)).toContain('never');
});

test('a single trial prints one aligned value column and marks the gate rows', () => {
  const text = formatTrial('KGV', 'Definition: test', trialMetrics(report(0.69 * 28 * KNOT, (1.48 * Math.PI) / 180, 37.9), definition));
  const lines = text.split('\n');
  expect(lines.find((l) => l.startsWith('* Top speed'))).toMatch(/28\.0 +kn$/);
  expect(lines.find((l) => l.startsWith('* Time to turn 90°'))).toMatch(/37\.9 +s$/);
  expect(lines.find((l) => l.startsWith('  Displacement'))).toMatch(/45,272 +t$/);
});

test('--vs without a value compares with origin/master', () => {
  expect(parseFlags(['king-george-v', '--vs'], FLAGS.trial).option('--vs')).toBe('origin/master');
  expect(parseFlags(['king-george-v', '--vs', '--json'], FLAGS.trial).option('--vs')).toBe('origin/master');
  expect(parseFlags(['king-george-v', '--vs', 'abc123'], FLAGS.trial).option('--vs')).toBe('abc123');
  expect(parseFlags(['king-george-v'], FLAGS.trial).option('--vs')).toBeUndefined();
  expect(() => parseFlags(['valiant', '--seconds'], FLAGS.trial)).toThrow('requires a value');
});
