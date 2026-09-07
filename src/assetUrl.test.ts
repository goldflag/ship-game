import { expect, test } from 'bun:test';
import { assetUrl } from './assetUrl';

test('asset paths resolve under the configured base', () => {
  expect(assetUrl('/models/bismarck.glb')).toBe('/models/bismarck.glb');
  expect(assetUrl('models/bismarck.glb')).toBe('/models/bismarck.glb');
});
