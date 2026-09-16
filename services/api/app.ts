import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import type { Auth } from './auth';
import { ApiError, ShipStorage } from './storage';
import { allowsOrigin } from './origins';
export function createApp(auth: Auth, storage: ShipStorage, secret: string, origin: string, compilerURL: string) {
  const app = new Hono<{ Variables: { account: string } }>();
  app.use('*', async (c,next) => { c.header('Cache-Control','no-store'); await next(); });
  app.use('*', bodyLimit({maxSize:17*1024*1024,onError:c=>c.json({code:'quota',error:'Source exceeds 16 MiB'},413)}));
  app.onError((error,c) => {
    if (error instanceof ApiError) return c.json({code:error.code,error:error.message},error.status as 400);
    console.error('API request failed',error instanceof Error ? error.name : 'unknown');
    return c.json({code:'unavailable',error:'Account storage is unavailable. Your draft is retained; retry shortly.'},503);
  });
  app.get('/health', async c => { await storage.db.query('SELECT 1'); return c.json({ready:true}); });
  app.use('/api/auth/*',bodyLimit({maxSize:16*1024,onError:c=>c.json({message:'Authentication request is too large'},413)}));
  app.on(['GET','POST'],'/api/auth/*',c=>auth.handler(c.req.raw));
  app.use('/internal/*', async (c,next) => {
    const supplied = c.req.header('x-service-secret') ?? '';
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))) return c.json({error:'Forbidden'},403);
    await next();
  });
  const account = async (c: any,next: () => Promise<void>) => {
    const session = await auth.api.getSession({headers:c.req.raw.headers,query:{disableCookieCache:true,disableRefresh:true}});
    if (!session) return c.json({code:'unauthorized',error:'Sign in to continue.'},401);
    // Bind long-lived browser adapters to the account that created their draft.
    const expected = c.req.header('x-account-id');
    if (expected && expected !== session.user.id) return c.json({code:'unauthorized',error:'The account changed. This draft belongs to the previous account.'},401);
    c.set('account',session.user.id); await next();
  };
  app.use('/api/ships/*',async (c,next) => {
    if (c.req.method !== 'GET' && !allowsOrigin(origin,c.req.header('origin'))) return c.json({error:'Origin not allowed'},403);
    return account(c,next);
  });
  app.use('/internal/*',account);
  app.get('/internal/session',c=>c.json({accountId:c.get('account')}));
  app.get('/api/ships', async c=>c.json(await storage.list(c.get('account'))));
  app.get('/api/ships/:id',async c=>c.json(await storage.load(c.get('account'),c.req.param('id'))));
  app.get('/api/ships/:id/revisions',async c=>c.json(await storage.revisions(c.get('account'),c.req.param('id'))));
  app.put('/api/ships/:id',async c=>{
    const input = await c.req.json(); if (input.designId !== c.req.param('id')) throw new ApiError(400,'corrupt','Design identity mismatch');
    return c.json(await storage.save(c.get('account'),c.req.header('idempotency-key') ?? '',input));
  });
  app.delete('/api/ships/:id',async c=>{ await storage.remove(c.get('account'),c.req.param('id'),c.req.header('if-match') ?? ''); return c.body(null,204); });
  const preparing = new Set<string>();
  app.post('/internal/prepare',async c=>{
    const owner = c.get('account'), {fleet} = await c.req.json();
    if (!Array.isArray(fleet) || !fleet.length || fleet.length > 8) throw new ApiError(400,'invalid','Choose one to eight ships');
    if (preparing.has(owner)) throw new ApiError(429,'busy','A fleet is already being prepared for this account');
    preparing.add(owner);
    try {
      const artifacts = new Map<string,unknown>(), ids: string[] = [];
      for (const entry of fleet) {
        if (entry.kind === 'historical' && typeof entry.presetId === 'string') { ids.push(entry.presetId); continue; }
        if (entry.kind !== 'custom' || typeof entry.designId !== 'string' || typeof entry.revisionId !== 'string') throw new ApiError(400,'invalid','Invalid fleet reference');
        const saved = await storage.revision(owner,entry.designId,entry.revisionId);
        const key = saved.id;
        if (!artifacts.has(key)) {
          const source=JSON.parse(saved.sourceJson); source.id=saved.designId; source.revision=saved.id;
          const response = await fetch(compilerURL + '/compile',{method:'POST',headers:{'Content-Type':'application/json','x-service-secret':secret},body:JSON.stringify({accountId:owner,sourceJson:JSON.stringify(source)}),signal:AbortSignal.timeout(100_000)});
          if (!response.ok) throw new ApiError(response.status,'compile',(await response.json() as {error:string}).error);
          artifacts.set(key,await response.json());
        }
        ids.push((artifacts.get(key) as any).result.definition.id);
      }
      return c.json({ids,artifacts:[...artifacts.values()]});
    } finally { preparing.delete(owner); }
  });
  return app;
}
