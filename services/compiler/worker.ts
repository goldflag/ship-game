import { enforceDerivedLimits, enforceSourceLimits } from './limits';
import { OUTPUT_LIMIT,runCompiler,JobQueue } from './runner';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const secret = process.env.SERVICE_SECRET;
if (!secret || secret.length < 32) throw new Error('SERVICE_SECRET must contain at least 32 characters');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const version = JSON.parse(await readFile(process.env.NAVAL_VERSION ?? 'src/generated/naval-version.json','utf8'));
const jobs=new JobQueue();
const cache = new Map<string,string>(); let cacheBytes = 0;
async function compile(sourceJson: string) {
  const source = JSON.parse(sourceJson), revision = source.construction?.catalogRevision;
  if (Object.keys(source).some(key=>!['schemaVersion','id','name','coordinates','revision','construction'].includes(key))) throw new Error('Online sources must not contain derived definitions, mass or catalogs');
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid catalog revision');
  enforceSourceLimits(source);
  const catalogFile = join(process.env.CATALOG_ROOT ?? 'public/models/components/catalogs',revision,'catalog.json');
  const catalog = await readFile(catalogFile,'utf8');
  if (JSON.parse(catalog).revision !== revision) throw new Error('Retained catalog mismatch');
  const key = hash(sourceJson + '\0' + hash(catalog) + '\0' + version.simulationBuild);
  const cached = cache.get(key); if (cached) return cached;
  const dir = await mkdtemp(join(tmpdir(),'naval-compile-'));
  try {
    const path = join(dir,'source.json'); await Bun.write(path,sourceJson);
    const output=await runCompiler([process.env.COMPILER_BINARY ?? 'target/release/examples/compile_construction',path,catalogFile]);
      const result = JSON.parse(output);
      if (!result.definition || result.diagnostics?.some((d: any) => d.severity === 'error')) throw new Error('Finish this design before joining an online battle');
      enforceDerivedLimits(result.definition);
      const artifact = JSON.stringify({ key, source, result });
      if (Buffer.byteLength(artifact) > OUTPUT_LIMIT) throw new Error('Construction artifact exceeds 64 MiB');
      while (cacheBytes + Buffer.byteLength(artifact) > 96 * 1024 * 1024 && cache.size) {
        const first = cache.keys().next().value!; cacheBytes -= Buffer.byteLength(cache.get(first)!); cache.delete(first);
      }
      cache.set(key,artifact); cacheBytes += Buffer.byteLength(artifact); return artifact;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
const app = new Hono();
app.get('/health', c => c.json({ready:true,...jobs.status}));
app.use('*', bodyLimit({maxSize: 17*1024*1024}));
app.post('/compile', async c => {
  const supplied = c.req.header('x-service-secret') ?? '';
  if (Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))) return c.json({error:'Forbidden'},403);
  const {accountId,sourceJson} = await c.req.json();
  if (typeof accountId !== 'string' || accountId.length > 160 || typeof sourceJson !== 'string' || Buffer.byteLength(sourceJson) > 16*1024*1024) return c.json({error:'Invalid job'},400);
  try { return new Response(await jobs.submit(accountId,()=>compile(sourceJson)),{headers:{'Content-Type':'application/json'}}); }
  catch(error) {const message=error instanceof Error?error.message:'Compilation failed';return c.json({error:message},message.includes('queue is full')?429:422);}
});
export default {port:Number(process.env.PORT ?? 8790),hostname:process.env.BIND ?? '127.0.0.1',fetch:app.fetch,idleTimeout:120};
