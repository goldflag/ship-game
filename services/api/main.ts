import { Pool } from 'pg';
import { makeAuth } from './auth';
import { createApp } from './app';
import { ShipStorage } from './storage';
function required(name:string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
const secret=required('SERVICE_SECRET'),authSecret=required('BETTER_AUTH_SECRET'),origin=required('AUTH_ORIGIN');
if (secret.length < 32 || authSecret.length < 32) throw new Error('Service and auth secrets must be at least 32 characters');
const database = new Pool({connectionString:required('API_DATABASE_URL'),max:10,options:'-c search_path=auth',connectionTimeoutMillis:3000,statement_timeout:10_000});
await database.query('SELECT 1 FROM auth."user" LIMIT 1');
const limits = [Number(process.env.SHIP_MAX_DESIGNS ?? 100),Number(process.env.SHIP_MAX_BYTES ?? 100*1024*1024)];
if (limits.some(n=>!Number.isSafeInteger(n)||n<=0)) throw new Error('Invalid account storage limits');
const app = createApp(makeAuth(database,origin,authSecret),new ShipStorage(database,...limits as [number,number]),secret,origin,process.env.COMPILER_URL ?? 'http://127.0.0.1:8790');
export default {port:Number(process.env.PORT ?? 8788),hostname:process.env.BIND ?? '127.0.0.1',fetch:app.fetch,idleTimeout:120};
