import type { Plugin } from 'vite';

/** Asset names for each vendored library whose bundle inlines images. Water Pro is loaded only by the
 * developer ocean comparison (src/game/comparison), so its images are fetched only when that chunk runs. */
const LIBRARIES = { 'threejs-sky-pro': 'sky-texture', 'threejs-water-pro': 'water-texture' } as const;

/** Keep the vendored Sky Pro and Water Pro bundles intact, but let browsers fetch/cache their images
 * separately instead of downloading every texture before executing game code. */
export function vendorTextures(): Plugin {
  return {
    name: 'external-vendor-textures',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const library = /\/vendor\/(threejs-(?:sky|water)-pro)\/build\/index\.js$/.exec(id)?.[1] as keyof typeof LIBRARIES | undefined;
      if (!library) return;
      const transformed = code.replace(/(["'])data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\1/g,
        (_literal, _quote, format: string, encoded: string) => {
          const reference = this.emitFile({
            type: 'asset',
            name: `${LIBRARIES[library]}.${format === 'jpeg' ? 'jpg' : format}`,
            source: Buffer.from(encoded, 'base64'),
          });
          return `import.meta.ROLLUP_FILE_URL_${reference}`;
        });
      return transformed === code ? undefined : { code: transformed, map: null };
    },
  };
}
