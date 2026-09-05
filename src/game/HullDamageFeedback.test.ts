import { expect, test } from 'bun:test';
import { HullDamageFeedback } from './HullDamageFeedback';

test('salvo losses combine, hold their original gold span, then fade in simulation time', () => {
  const feedback = new HullDamageFeedback();
  expect(feedback.update(1000, 0).amount).toBe(0);
  expect(feedback.update(960, 1)).toEqual({ amount: 40, fromHp: 1000, opacity: 1 });
  expect(feedback.update(900, 1.2)).toEqual({ amount: 100, fromHp: 1000, opacity: 1 });
  const paused = feedback.update(900, 2.5);
  expect(paused.opacity).toBeCloseTo(.5);
  for (let i = 0; i < 100; i++) expect(feedback.update(900, 2.5)).toEqual(paused);
  expect(feedback.update(900, 2.9)).toEqual({ amount: 0, fromHp: 900, opacity: 0 });
  expect(feedback.update(870, 3)).toEqual({ amount: 30, fromHp: 900, opacity: 1 });
});

test('reset, healed hulls and a replacement fleet do not carry an old hit cue', () => {
  const feedback = new HullDamageFeedback();
  feedback.update(600, 10);
  expect(feedback.update(1000, 0).amount).toBe(0);
  feedback.update(700, 2);
  expect(feedback.update(800, 3).amount).toBe(0);
  expect(new HullDamageFeedback(700).update(700, 0).amount).toBe(0);
  expect(feedback.update(0, 4).amount).toBe(800);
  expect(feedback.update(0, 6).amount).toBe(0);
});
