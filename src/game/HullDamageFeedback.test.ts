import { expect, test } from 'bun:test';
import { HullDamageFeedback } from './HullDamageFeedback';

test('mixed salvos retain only the local player share and clear it on new salvos, healing and reset', () => {
  const feedback = new HullDamageFeedback(1000);
  expect(feedback.update(900, 1, 40).amount).toBe(100);
  expect(feedback.playerAmount).toBe(40);
  expect(feedback.update(850, 1.2, 30).amount).toBe(150);
  expect(feedback.playerAmount).toBe(70);
  feedback.update(850, 1.2, 30);
  expect(feedback.playerAmount).toBe(70);
  feedback.update(800, 2, 100);
  expect(feedback.playerAmount).toBe(50);
  feedback.update(850, 3);
  expect(feedback.playerAmount).toBe(0);
  feedback.update(800, 4, 50);
  feedback.update(1000, 0);
  expect(feedback.playerAmount).toBe(0);
});

test('salvo losses combine, hold their original gold span, then fade in simulation time', () => {
  const feedback = new HullDamageFeedback(1000);
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
  const feedback = new HullDamageFeedback(1000);
  feedback.update(600, 10);
  expect(feedback.update(1000, 0).amount).toBe(0);
  feedback.update(700, 2);
  expect(feedback.update(800, 3).amount).toBe(0);
  expect(new HullDamageFeedback(700).update(700, 0).amount).toBe(0);
  expect(feedback.update(0, 4).amount).toBe(800);
  expect(feedback.update(0, 6).amount).toBe(0);
});

test('damage feedback preserves absolute losses above and below the former 1,000 HP cap', () => {
  for (const maxHp of [1750, 440]) {
    const feedback = new HullDamageFeedback(maxHp);
    expect(feedback.update(maxHp, 0).amount).toBe(0);
    expect(feedback.update(maxHp - 50, 1)).toEqual({ amount: 50, fromHp: maxHp, opacity: 1 });
    expect(feedback.update(maxHp - 100, 1.2).amount).toBe(100);
    expect(feedback.update(maxHp, 0).amount).toBe(0);
  }
});
