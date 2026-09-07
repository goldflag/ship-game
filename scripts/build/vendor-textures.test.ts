import { expect, test } from 'bun:test';
import { rollup, type Plugin } from 'rollup';
import { vendorTextures } from './vendor-textures';

test('vendor images become separate, byte-identical assets with relative runtime URLs', async () => {
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
  const input = '/project/vendor/threejs-water-pro/build/index.js';
  const bundle = await rollup({
    input,
    plugins: [{
      name: 'fixture',
      resolveId: id => id,
      load: () => `export const image = "data:image/png;base64,${bytes.toString('base64')}";`,
    }, vendorTextures() as Plugin],
  });
  try {
    const { output } = await bundle.generate({ format: 'es', assetFileNames: 'assets/[name]-[hash][extname]' });
    const asset = output.find(item => item.type === 'asset');
    const code = output.find(item => item.type === 'chunk')!.code;
    expect(asset?.type).toBe('asset');
    expect(Buffer.from(asset!.source)).toEqual(bytes);
    expect(code).not.toContain('data:image');
    expect(code).toContain(asset!.fileName);
    expect(code).toContain('import.meta.url');
  } finally { await bundle.close(); }
});

test('unrelated application image literals are untouched', async () => {
  const source = 'export default "data:image/png;base64,AAEC";';
  const bundle = await rollup({
    input: '/project/src/example.js',
    plugins: [{ name: 'fixture', resolveId: id => id, load: () => source }, vendorTextures() as Plugin],
  });
  try {
    const { output } = await bundle.generate({ format: 'es' });
    expect(output).toHaveLength(1);
    expect(output[0].type === 'chunk' && output[0].code).toContain('data:image/png;base64,AAEC');
  } finally { await bundle.close(); }
});
