import { expect, test } from 'bun:test';
import { FOAM_TEXELS, foamTexture } from './foamTexture';

test('every mip level keeps the foam texture\'s coverages: thresholds keep their share, the streak mask its mean', () => {
  const map = foamTexture(), mipmaps = map.mipmaps as { data: Uint8Array; width: number; height: number }[];
  expect(map.generateMipmaps).toBe(false);
  expect(mipmaps.length).toBe(Math.log2(FOAM_TEXELS) + 1);
  const streakMean = map.userData.streakMean as number;
  expect(streakMean).toBeGreaterThan(.01);
  expect(streakMean).toBeLessThan(.2);
  mipmaps.forEach(({ data, width, height }) => {
    const texels = width * height;
    expect(data.length).toBe(texels * 4);
    // Lace (red), patches (green) and churn (alpha) are equalised on every level down to 8 × 8: a threshold at
    // 1 − c keeps a share c of the texels, so foam covers the same share of the sea at any distance.
    if (width >= 8) for (const channel of [0, 1, 3]) for (const coverage of [.05, .25, .5, .8]) {
      let kept = 0;
      for (let i = 0; i < texels; i++) if (data[i * 4 + channel] / 255 > 1 - coverage) kept++;
      expect(Math.abs(kept / texels - coverage)).toBeLessThan(2 / Math.min(width, 255) + 1 / texels);
    }
    // The streak mask is averaged, not equalised: its mean holds (to byte rounding) on every level.
    let sum = 0;
    for (let i = 0; i < texels; i++) sum += data[i * 4 + 2] / 255;
    expect(Math.abs(sum / texels - streakMean)).toBeLessThan(.004);
  });
  map.dispose();
});
