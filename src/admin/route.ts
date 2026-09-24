/** The admin page lives at the base path plus `admin` (`/admin`, or `/naval/admin` under a base path). The server
 * and the dev server answer every unknown path with index.html, so `src/main.tsx` picks the page from the path. */
export const ADMIN_PATH = 'admin';
export function isAdminPath(pathname: string, base = '/') {
  const root = base.endsWith('/') ? base : `${base}/`;
  return pathname.replace(/\/+$/, '') === root + ADMIN_PATH;
}
