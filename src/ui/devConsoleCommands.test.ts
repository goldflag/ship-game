import { expect, test } from 'bun:test';
import { clampSetting, currentValue, isDeveloperConsoleKey, matchCommands, readingLabel, WEATHER_SETTINGS } from './devConsoleCommands';

const labels = (query: string, locked = false) => matchCommands(query, locked).map(({ command, value }) => [command.label, value]);
const setting = (key: string) => WEATHER_SETTINGS.find(s => s.key === key)!;

test('a typed word and number pick settings and set their values', () => {
  expect(labels('wind 14')).toEqual([['Wind speed', 14], ['Wind from', 14]]);
  expect(labels('wind from 200')).toEqual([['Wind from', 200]]);
  expect(labels('time 6:30')).toEqual([['Time of day', 6.5]]);
  expect(labels('clouds 140%')).toEqual([['Cloud cover', 100]]);
  expect(labels('fog 12km')).toEqual([['Visibility', 12]]);
  expect(labels('storm')).toEqual([['Storm', undefined]]);
  expect(labels('storm 3')).toEqual([]);
  expect(labels('copy')).toEqual([['Copy scene diagnostics', undefined]]);
  expect(labels('bow')).toEqual([['Toggle bow waves', undefined]]);
  expect(matchCommands('').length).toBe(15);
});

test('online battles offer only the visual diagnostics', () => {
  expect(labels('', true)).toEqual([['Copy scene diagnostics', undefined], ['Toggle bow waves', undefined]]);
  expect(labels('wind 14', true)).toEqual([]);
});

test('time and bearings wrap; other values clamp to their range', () => {
  expect(clampSetting(setting('timeHours'), 25)).toBe(1);
  expect(clampSetting(setting('timeHours'), -1)).toBe(23);
  expect(clampSetting(setting('windDirection'), 370)).toBe(10);
  expect(clampSetting(setting('windSpeed'), -4)).toBe(0);
  expect(clampSetting(setting('visibilityKm'), 0)).toBe(.5);
});

test('sheltered port light reads as a sun angle and scrubs from the matching hour', () => {
  const reading = { sunElevation: 35, cloudCover: 38, windSpeed: 9, windDirection: 35, visibilityKm: 5.6 };
  expect(readingLabel('timeHours', reading)).toBe('sun 35°');
  expect(currentValue('timeHours', reading)).toBeCloseTo(8);
  expect(readingLabel('timeHours', { ...reading, timeHours: 18.5, sunElevation: -18 })).toBe('18:30 · sun -18°');
  expect(readingLabel('windDirection', reading)).toBe('035°');
});

test('only a plain Shift-D opens the console', () => {
  const key = (over = {}) => ({ code: 'KeyD', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, ...over });
  expect(isDeveloperConsoleKey(key())).toBe(true);
  expect(isDeveloperConsoleKey(key({ shiftKey: false }))).toBe(false);
  expect(isDeveloperConsoleKey(key({ metaKey: true }))).toBe(false);
  expect(isDeveloperConsoleKey(key({ code: 'KeyS' }))).toBe(false);
});
