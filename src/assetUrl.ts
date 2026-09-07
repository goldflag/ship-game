/** Resolves a public/ asset path against Vite's base URL so a build can be served from a sub-path such as /naval/. */
const base = ((import.meta.env?.BASE_URL as string | undefined) ?? '/').replace(/\/?$/, '/');
export const assetUrl = (path: string) => base + path.replace(/^\/+/, '');
