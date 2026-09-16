import { expect, test } from 'bun:test';
import { allowsOrigin } from './origins';

test('local auth supports canonical loopback origins across Vite ports', () => {
  for (const configured of ['http://localhost:5173', 'http://127.0.0.1:8788', 'https://[::1]']) {
    for (const incoming of ['http://localhost:5201', 'http://127.0.0.1:5173', 'http://[::1]:5202', 'https://localhost']) {
      expect(allowsOrigin(configured, incoming)).toBe(true);
    }
    for (const incoming of [undefined, null, '', 'null', 'https://evil.example',
      'http://localhost.evil.example:5173', 'http://localhost:5173@evil.example',
      'http://evil@localhost:5173', 'http://localhost:5173/path',
      'http://localhost:5173/', 'ftp://localhost', 'http://127.1:5173']) {
      expect(allowsOrigin(configured, incoming)).toBe(false);
    }
  }
});

test('deployed auth trusts only the exact configured origin', () => {
  const configured = 'https://ships.tomato.gg';
  expect(allowsOrigin(configured, configured)).toBe(true);
  for (const incoming of ['http://localhost:5173', 'http://127.0.0.1:5200', 'http://[::1]',
    'http://ships.tomato.gg', 'https://ships.tomato.gg:444', 'https://evil.example']) {
    expect(allowsOrigin(configured, incoming)).toBe(false);
  }
});
