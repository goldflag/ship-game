/** `bun run dev`: prepares simulation content and the dev WASM, then serves this checkout with Vite (arguments go to
 * Vite). `.build/dev-server.json` appears at once with `status: "preparing"`, since preparation can take minutes after a
 * Rust change; the dev-port plugin rewrites it with `status: "ready"` and the URL once Vite listens. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..'), file = resolve(root, '.build/dev-server.json');
const read = (): { status?: string; url?: string; pid?: number } | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };
const alive = (pid?: number) => { try { return !!pid && process.kill(pid, 0); } catch { return false; } };
const running = read();
// A live server keeps its record; the new one rewrites it only if it starts listening.
if (running?.status !== 'preparing' && alive(running?.pid)) console.log(`A dev server for this checkout is already running at ${running?.url} (pid ${running?.pid}).`);
else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify({ status: 'preparing', pid: process.pid, started: new Date().toISOString() }, null, 2)}\n`); }
const forget = () => { const record = read(); if (record?.status === 'preparing' && record.pid === process.pid) rmSync(file, { force: true }); };

// Signals reach the child even when only this process is killed; a stop during preparation never starts Vite.
let child: ReturnType<typeof Bun.spawn> | undefined, stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => { stopping = true; if (child) child.kill(signal); else { forget(); process.exit(130); } });
child = Bun.spawn([process.execPath, resolve(root, 'scripts/multiplayer/prepare.ts'), '--dev'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] });
const prepared = await child.exited;
if (prepared || stopping) { forget(); process.exit(prepared || 130); }
child = Bun.spawn([resolve(root, 'node_modules/.bin/vite'), '--host', '0.0.0.0', ...process.argv.slice(2).filter(arg => arg !== '--')], { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] });
const code = await child.exited;
forget();
process.exit(code ?? 1);
