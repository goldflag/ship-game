/** Run after drain and backup, before starting the PostgreSQL-backed battle server. */
import { Database } from 'bun:sqlite';
import { Pool } from 'pg';
import { isDeepStrictEqual } from 'node:util';
const file=process.argv[2]; if(!file) throw new Error('Usage: bun services/db/import-sqlite.ts /backup/matches.sqlite');
const source=new Database(file,{readonly:true});
const integrity=source.query('PRAGMA integrity_check').get() as Record<string,string>;
if(Object.values(integrity)[0]!=='ok') throw new Error('SQLite integrity check failed');
const records=source.query('SELECT id,record,finished FROM matches ORDER BY id').all() as {id:string;record:string;finished:number}[];
const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL}),client=await db.connect();
try {
  await client.query('BEGIN');await client.query('LOCK TABLE results.matches IN EXCLUSIVE MODE');
  for(const row of records) {
    await client.query('INSERT INTO results.matches(id,record,finished) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[row.id,JSON.parse(row.record),!!row.finished]);
    const target=(await client.query('SELECT * FROM results.matches WHERE id=$1',[row.id])).rows[0];
    if(target.finished!==!!row.finished || !isDeepStrictEqual(target.record,JSON.parse(row.record)) || target.account_a!==null || target.account_b!==null) throw new Error(`Import mismatch: ${row.id}`);
  }
  await client.query('COMMIT');console.log(`Verified ${records.length} match IDs, terminal flags and JSON records. Legacy account ownership remains unknown.`);
} catch(error) {await client.query('ROLLBACK');throw error;}finally{client.release();await db.end();source.close();}
