import { expect, test } from 'bun:test';
import { listDesigns, readCredentials, saveDesign, signIn } from './account';

/** A stand-in for the accounts service. Nothing in these tests touches the real one. */
function mockService(options: { accept?: boolean } = {}) {
  const seen: { path: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const library = [
    { sourceId: 'design-1', name: 'Scharnhorst', revisionId: 'rev-1', catalogRevision: 'cat-1', updatedAt: 1_700_000_000_000 },
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);
      seen.push({ path: url.pathname, method: request.method, headers: Object.fromEntries(request.headers), body });
      if (url.pathname === '/api/auth/sign-in/email') {
        if (options.accept === false)
          return new Response(JSON.stringify({ message: 'no such user quartermaster@example.test' }), { status: 401 });
        return new Response(JSON.stringify({ user: { id: 'user-1' } }), {
          status: 200,
          headers: { 'set-cookie': 'session=abc; Path=/; HttpOnly', 'content-type': 'application/json' },
        });
      }
      if (url.pathname === '/api/auth/sign-out') return new Response('{}');
      if (url.pathname === '/api/ships' && request.method === 'GET') return Response.json(library);
      if (url.pathname.startsWith('/api/ships/') && request.method === 'PUT') {
        const request_ = body as { expectedRevisionId: string | null };
        if (request_.expectedRevisionId !== 'rev-1') return new Response('revision conflict', { status: 409 });
        return Response.json({ id: 'rev-2', sourceJson: '{"id":"design-1"}' });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { seen, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

test('credentials are read only from their two keys', () => {
  const parsed = readCredentials('# comment\nOTHER_SECRET=nope\nNAVAL_TEST_EMAIL="a@b.test"\nNAVAL_TEST_PASSWORD=hunter2 \n');
  expect(parsed).toEqual({ email: 'a@b.test', password: 'hunter2' });
  expect(() => readCredentials('NAVAL_TEST_EMAIL=a@b.test\n')).toThrow('NAVAL_TEST_EMAIL and NAVAL_TEST_PASSWORD');
});

test('a failed sign-in reports the status and never the credentials the service echoed', async () => {
  const service = mockService({ accept: false });
  try {
    const error = await signIn(service.url, { email: 'quartermaster@example.test', password: 'hunter2' }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('status 401');
    expect((error as Error).message).not.toContain('quartermaster@example.test');
    expect((error as Error).message).not.toContain('hunter2');
  } finally {
    service.stop();
  }
});

test('list is a read: sign in, one GET, sign out', async () => {
  const service = mockService();
  try {
    const session = await signIn(service.url, { email: 'a@b.test', password: 'hunter2' });
    expect(session.cookie).toBe('session=abc');
    const heads = await listDesigns(service.url, session);
    expect(heads.map((head) => head.name)).toEqual(['Scharnhorst']);
    await session.close();
    expect(service.seen.map((call) => call.method + ' ' + call.path)).toEqual([
      'POST /api/auth/sign-in/email',
      'GET /api/ships',
      'POST /api/auth/sign-out',
    ]);
    expect(service.seen[1].headers.cookie).toBe('session=abc');
    expect(service.seen[1].headers['x-account-id']).toBe('user-1');
  } finally {
    service.stop();
  }
});

test('a save replaces the revision it read and carries an idempotency key', async () => {
  const service = mockService();
  try {
    const session = await signIn(service.url, { email: 'a@b.test', password: 'hunter2' });
    const request = {
      designId: 'design-1',
      name: 'Scharnhorst',
      source: { id: 'design-1' },
      catalogRevision: 'cat-1',
      schemaVersion: 1,
      expectedRevisionId: 'rev-1',
    };
    expect(await saveDesign(service.url, session, request)).toEqual({ id: 'rev-2', bytes: 17 });
    const put = service.seen.find((call) => call.method === 'PUT')!;
    expect(put.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    // A save that does not name the revision it replaces is refused by the service, not merged.
    const stale = await saveDesign(service.url, session, { ...request, expectedRevisionId: null }).catch((error: Error) => error);
    expect((stale as Error).message).toContain('status 409');
    await session.close();
  } finally {
    service.stop();
  }
});
