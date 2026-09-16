import { Pool } from 'pg';
import { readdir } from 'node:fs/promises';
const db = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const client = await db.connect();
try {
  await client.query('SELECT pg_advisory_lock(764122)');
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, digest text NOT NULL)');
  for (const name of (await readdir(new URL('./migrations', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
    const sql = await Bun.file(new URL('./migrations/' + name, import.meta.url)).text();
    const digest = new Bun.CryptoHasher('sha256').update(sql).digest('hex');
    const old = await client.query('SELECT digest FROM public.schema_migrations WHERE name=$1', [name]);
    if (old.rowCount) { if (old.rows[0].digest !== digest) throw new Error(`Migration changed: ${name}`); continue; }
    await client.query('BEGIN');
    try { await client.query(sql); await client.query('INSERT INTO public.schema_migrations VALUES ($1,$2)', [name, digest]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    console.log(`Migrated ${name}`);
  }
} finally { await client.query('SELECT pg_advisory_unlock(764122)'); client.release(); await db.end(); }
