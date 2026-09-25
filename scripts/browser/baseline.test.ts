import { describe, expect, test } from 'bun:test';
import { baselineDir, compareSamples, comparisonTable, interleave, median } from './baseline';

describe('baseline A/B helpers', () => {
  test('interleave alternates the targets round by round: A B A B A B', () => {
    expect(interleave(['A', 'B'], 3).map(step => `${step.target}${step.round}`)).toEqual(['A0', 'B0', 'A1', 'B1', 'A2', 'B2']);
    expect(interleave(['only'], 2).map(step => step.target)).toEqual(['only', 'only']);
    expect(interleave(['A', 'B'], 0)).toEqual([]);
  });

  test('median takes the middle run, or the mean of the middle two', () => {
    expect(median([11.3, 8.8, 9.1])).toBe(9.1);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  test('compareSamples reports medians and the branch change, and ignores one outlying run', () => {
    const comparison = compareSamples([8.8, 11.3, 9.0], [9.4, 9.6, 30]);
    expect(comparison.baseline).toBe(9.0);
    expect(comparison.branch).toBe(9.6);
    expect(comparison.delta).toBeCloseTo(0.6);
    expect(comparison.percent).toBeCloseTo(6.667, 2);
    expect(comparison.baselineRuns).toEqual([8.8, 11.3, 9.0]);
  });

  test('comparisonTable lines up a row per measurement with every run', () => {
    const table = comparisonTable([
      { label: 'near stepping', comparison: compareSamples([8.8, 11.3, 9.0], [9.4, 9.6, 9.5]) },
      { label: 'near paused', comparison: compareSamples([4, 4.2, 4.1], [3.9, 4.1, 4]) },
    ]).split('\n');
    expect(table).toHaveLength(3);
    expect(table[0]).toStartWith('measurement');
    expect(table[1]).toContain('9.00 [8.80 11.30 9.00]');
    expect(table[1]).toContain('+0.50 ms (+5.6%)');
    expect(table[2]).toContain('-0.10 ms (-2.4%)');
    expect(table[1].indexOf('9.00 [')).toBe(table[2].indexOf('4.10 ['));
  });

  test('a baseline worktree is keyed by its commit under .build/baseline', () => {
    expect(baselineDir('/repo', '0123456789abcdef0123')).toBe('/repo/.build/baseline/0123456789ab');
  });
});
