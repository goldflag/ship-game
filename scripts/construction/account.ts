/** The accounts service as `ship:account` uses it: sign in, read the saved library, save one design.
 *
 * Credentials come from `.env.local` and never leave this module: nothing here returns, logs or puts
 * an email or a password into an error message, because everything it prints is destined for a
 * transcript. The session cookie lives only for the length of one command. */

export interface AccountSession {
  cookie: string;
  userId: string;
  close(): Promise<void>;
}
export interface DesignHead {
  sourceId: string;
  name: string;
  revisionId: string;
  catalogRevision: string;
  updatedAt: number | string;
  schemaVersion?: number;
}
export interface AccountCredentials {
  email: string;
  password: string;
}

/** Reads only the two test-account keys, so an unrelated secret in the same file is never parsed. */
export function readCredentials(envFile: string): AccountCredentials {
  const found: Record<string, string> = {};
  for (const line of envFile.split('\n')) {
    const match = /^\s*(NAVAL_TEST_EMAIL|NAVAL_TEST_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) found[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!found.NAVAL_TEST_EMAIL || !found.NAVAL_TEST_PASSWORD)
    throw new Error(
      'Set NAVAL_TEST_EMAIL and NAVAL_TEST_PASSWORD in .env.local (the main checkout has them; bootstrap copies the file into a worktree).',
    );
  return { email: found.NAVAL_TEST_EMAIL, password: found.NAVAL_TEST_PASSWORD };
}

const trimmed = (base: string) => base.replace(/\/$/, '');

export async function signIn(base: string, credentials: AccountCredentials, fetcher: typeof fetch = fetch): Promise<AccountSession> {
  const origin = new URL(trimmed(base)).origin;
  const response = await fetcher(trimmed(base) + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(credentials),
  });
  // The body can echo the address that failed, so only the status is ever reported.
  if (!response.ok)
    throw new Error(
      'Sign-in to the accounts service failed with status ' + response.status + '. Check NAVAL_TEST_EMAIL and NAVAL_TEST_PASSWORD.',
    );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const user = ((await response.json()) as { user?: { id?: string } }).user;
  if (!cookie || !user?.id) throw new Error('The accounts service accepted the sign-in but returned no session.');
  return {
    cookie,
    userId: user.id,
    close: async () => {
      await fetcher(trimmed(base) + '/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin },
        body: '{}',
      }).catch(() => undefined);
    },
  };
}

const ships = async (base: string, session: AccountSession, path: string, init: RequestInit, fetcher: typeof fetch) =>
  fetcher(trimmed(base) + '/api/ships' + path, {
    ...init,
    headers: {
      cookie: session.cookie,
      origin: new URL(trimmed(base)).origin,
      'x-account-id': session.userId,
      ...((init.headers ?? {}) as Record<string, string>),
    },
  });

export async function listDesigns(base: string, session: AccountSession, fetcher: typeof fetch = fetch): Promise<DesignHead[]> {
  const response = await ships(base, session, '', {}, fetcher);
  if (!response.ok) throw new Error('Reading the saved library failed with status ' + response.status + '.');
  const heads = (await response.json()) as DesignHead[];
  if (!Array.isArray(heads)) throw new Error('The accounts service returned no design list.');
  return heads;
}

export interface SaveRequest {
  /** The account-side design ID. A new one is minted when the source has none of the account's own. */
  designId: string;
  name: string;
  source: Record<string, unknown>;
  catalogRevision: string;
  schemaVersion: number;
  /** The revision this save replaces, or null for a design the account does not have yet. */
  expectedRevisionId: string | null;
}
export async function saveDesign(
  base: string,
  session: AccountSession,
  request: SaveRequest,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; bytes: number }> {
  const response = await ships(
    base,
    session,
    '/' + encodeURIComponent(request.designId),
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(request),
    },
    fetcher,
  );
  if (!response.ok)
    throw new Error('Saving to the account failed with status ' + response.status + ': ' + (await response.text()).slice(0, 400));
  const revision = (await response.json()) as { id?: string; sourceJson?: string };
  if (!revision.id) throw new Error('The accounts service accepted the save but returned no revision.');
  return { id: revision.id, bytes: revision.sourceJson?.length ?? 0 };
}
