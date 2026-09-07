import type { Plugin } from 'vite';

/** Keep the supplied libraries intact, but let browsers fetch/cache their images
 * separately instead of downloading every texture before executing game code. */
export function vendorTextures(): Plugin {
  return {
    name: 'external-vendor-textures',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/vendor\/threejs-(?:water|sky)-pro\/build\/index\.js$/.test(id)) return;
      const transformed = code.replace(/(["'])data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\1/g,
        (_literal, _quote, format: string, encoded: string) => {
          const reference = this.emitFile({
            type: 'asset',
            name: `ocean-texture.${format === 'jpeg' ? 'jpg' : format}`,
            source: Buffer.from(encoded, 'base64'),
          });
          return `import.meta.ROLLUP_FILE_URL_${reference}`;
        });
      return transformed === code ? undefined : { code: transformed, map: null };
    },
  };
}
