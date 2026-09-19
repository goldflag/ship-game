import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

/** Review evidence, reports and reference downloads are local output (AGENTS.md): they go in ignored `.build/`. */
const EVIDENCE = /^assets\/(?:reviews\/|(?:.+\/)?(?:reports|references|review)\/)/;

/** Tracked paths under those names that a pipeline reads. Add an entry only for something a command verifies or
 * hashes, and say which. */
const KEPT: [pattern: RegExp, why: string][] = [
  [/^assets\/ships\/[^/]+\/generated\/review\//, 'fixed views hashed in each ship manifest and verified by ship:check'],
  [/^assets\/aircraft\/[^/]+\/generated\/review\//, 'fixed views and manifest verified by aircraft:check'],
  [/^assets\/aircraft\/[^/]+\/reports\/export\.json$/, 'export report compared by aircraft:check'],
  [/^assets\/aircraft\/references\//, 'measured schematics hashed into the aircraft content hash'],
  [/^assets\/ships\/fletcher\/baseline\//, 'archived Fletcher revisions with their own fixed views'],
];

export const strayEvidence = (paths: string[]) => paths.filter(path => EVIDENCE.test(path) && !KEPT.some(([pattern]) => pattern.test(path)));

test('the evidence patterns catch review folders and spare pipeline inputs', () => {
  expect(strayEvidence([
    'assets/reviews/water/README.md', 'assets/effects/naval/reports/validation.md', 'assets/maps/review/index.html',
    'assets/aircraft/reports/sheets.json', 'assets/hud/references/helm.png', 'assets/ships/iowa/generated/review/notes/extra.md',
    'assets/ships/iowa/generated/review/plan.png', 'assets/aircraft/a6m2-zero/reports/export.json', 'assets/aircraft/a6m2-zero/reports/notes.md',
    'assets/aircraft/references/schematics/a6m2-zero/three-view.png', 'assets/ships/iowa/review-details.py', 'src/ui/review/Panel.tsx',
  ])).toEqual([
    'assets/reviews/water/README.md', 'assets/effects/naval/reports/validation.md', 'assets/maps/review/index.html',
    'assets/aircraft/reports/sheets.json', 'assets/hud/references/helm.png', 'assets/aircraft/a6m2-zero/reports/notes.md',
  ]);
});

test('no review evidence, report or reference download is tracked', async () => {
  const root = resolve(import.meta.dir, '../..');
  const listing = Bun.spawn(['git', 'ls-files', '-z', '--', 'assets'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [output, status] = await Promise.all([new Response(listing.stdout).text(), listing.exited]);
  if (status !== 0) return; // A source archive without Git metadata has nothing to check.
  const stray = strayEvidence(output.split('\0').filter(Boolean));
  if (stray.length) throw new Error(`${stray.length} tracked evidence file(s), for example:\n  ${stray.slice(0, 12).join('\n  ')}\n`
    + 'AGENTS.md: review captures, reports, reference downloads, logs and diagnostic output belong in ignored .build/ '
    + '(scripts write to .build/reviews/<task>/). Remove them with `git rm --cached`, or, if a pipeline command really reads them, '
    + 'add a justified entry to KEPT in scripts/tests/tracked-evidence.test.ts.');
});
