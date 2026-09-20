/** Saved custom designs for the account-free harness (`scripts/diagnostics/app.html`).
 *
 * `bun run harness:designs` signs in to the accounts API once with the test account, downloads the
 * latest revision of every design it owns and caches them under the durable checkout's ignored
 * `.build/harness/`, so every worktree shares one copy and browser runs never touch the accounts
 * service. The dev server then serves that cache at `/__harness/designs.json`. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { ConstructionDesignHead, ConstructionRevision } from '../../src/ships/constructionStore';

export interface HarnessDesigns {
  fetchedAt: number;
  account: string;
  designs: { head: ConstructionDesignHead; revision: ConstructionRevision }[];
}
export const HARNESS_DESIGNS_ROUTE = '/__harness/designs.json';

/** The durable checkout owns `.env.local` and the shared cache; linked worktrees come and go. */
export function mainCheckout(root: string): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  return dirname(common);
}
export const designsCache = (root: string) => join(mainCheckout(root), '.build/harness/designs.json');

function credentials(root: string): { email: string; password: string } {
  const values: Record<string, string | undefined> = { NAVAL_TEST_EMAIL: process.env.NAVAL_TEST_EMAIL, NAVAL_TEST_PASSWORD: process.env.NAVAL_TEST_PASSWORD };
  for (const dir of [root, mainCheckout(root)]) {
    const file = join(dir, '.env.local');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*(NAVAL_TEST_EMAIL|NAVAL_TEST_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] ??= match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!values.NAVAL_TEST_EMAIL || !values.NAVAL_TEST_PASSWORD) throw new Error('Set NAVAL_TEST_EMAIL and NAVAL_TEST_PASSWORD in the main checkout\'s .env.local (see AGENTS.md).');
  return { email: values.NAVAL_TEST_EMAIL, password: values.NAVAL_TEST_PASSWORD };
}

export async function syncHarnessDesigns(root: string, log: (line: string) => void = console.log): Promise<HarnessDesigns> {
  const base = (process.env.ACCOUNTS_URL ?? 'https://ships.tomato.gg').replace(/\/$/, ''), origin = new URL(base).origin;
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(credentials(root)) });
  if (!signIn.ok) throw new Error(`Test account sign-in failed (${signIn.status}). Check the credentials, or wait out the shared rate limit.`);
  const cookie = signIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const account = ((await signIn.json()) as { user?: { id?: string } }).user?.id ?? '';
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}/api/ships${path}`, { headers: { cookie, origin } });
    if (!response.ok) throw new Error(`GET /api/ships${path} failed (${response.status}).`);
    return response.json() as Promise<T>;
  };
  try {
    const heads = await get<ConstructionDesignHead[]>('');
    const designs: HarnessDesigns['designs'] = [];
    for (const head of heads) designs.push(await get(`/${encodeURIComponent(head.id)}`));
    const result: HarnessDesigns = { fetchedAt: Date.now(), account, designs };
    const file = designsCache(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(result)); renameSync(`${file}.tmp`, file);
    log(`${designs.length} designs cached at ${file}`);
    for (const { head } of designs) log(`  ${head.name}  (${head.sourceId ?? head.id})`);
    return result;
  } finally {
    await fetch(`${base}/api/auth/sign-out`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, origin }, body: '{}' }).catch(() => undefined);
  }
}

/** Serve the shared cache to the harness page. A missing cache is an empty library, not an error. */
export function harnessDesigns(root: string): Plugin {
  return {
    name: 'harness-designs', apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== HARNESS_DESIGNS_ROUTE) return next();
        const file = designsCache(root);
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        response.end(existsSync(file) ? readFileSync(file) : JSON.stringify({ fetchedAt: 0, account: '', designs: [] } satisfies HarnessDesigns));
      });
    },
  };
}

if (import.meta.main) await syncHarnessDesigns(resolve(import.meta.dir, '../..'));
