import { expect, test } from 'bun:test';
import { parseLog } from './master-ci';

const line = (text: string) => `validate\tUNKNOWN STEP\t2026-09-24T21:28:53.3557311Z ${text}`;

test('a failed-step log yields the TypeScript summary, cargo test binaries and failed check steps', () => {
  const log = [
    '     Running tests/bomb_structure.rs (target/release/deps/bomb_structure-5b5908829d2ed1b4)',
    'test a_single_region ... FAILED',
    'test passes_anyway ... ok',
    '     Running unittests src/lib.rs (target/release/deps/naval_sim-0123abcd)',
    'test weapons::tests::a_unit ... FAILED',
    '<== cargo test --release: FAILED (2205.1 s, exit 101)',
    '<== cargo fmt --check: FAILED (1.0 s, exit 1)',
    'Known failures, already red on master and listed in scripts/tests/known-failures.json (not counted):',
    '  src/game/FleetShipDraws.test.ts > fleet instances preserve separate poses',
    '',
    'New failures, not in scripts/tests/known-failures.json:',
    '  scripts/construction/hull-presets.test.ts > Fletcher retains its original ship dimensions',
    '',
    '325 test files: 1 new failures, 1 known (scripts/tests/known-failures.json); 180 s (4 workers)',
    '  indented output > outside a summary is not a failure',
  ].map(line).join('\n');
  expect(parseLog(log)).toEqual({
    tests: [
      'scripts/construction/hull-presets.test.ts > Fletcher retains its original ship dimensions',
      'src/game/FleetShipDraws.test.ts > fleet instances preserve separate poses',
    ],
    cargo: ['bomb_structure > a_single_region', 'naval_sim > weapons::tests::a_unit'],
    checks: ['cargo fmt --check', 'cargo test --release'],
  });
});
