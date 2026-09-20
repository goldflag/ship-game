import { resolve } from 'node:path';
import { runSession } from './session';

// Detached entry of `ship:session start`. Output goes to .build/construction/session.log.
const [rootArgument, ...flags] = process.argv.slice(2);
if (!rootArgument) { console.error('usage: session-daemon.ts <root> [--idle-ms n] [--no-browser]'); process.exit(2); }
// Library calls inside the daemon, such as the review server's compile endpoint, must not call back into it.
process.env.CONSTRUCTION_SESSION = 'off';
const idle = flags.indexOf('--idle-ms');
const stamp = () => new Date().toISOString() + ' [' + process.pid + '] ';
console.error(stamp() + 'starting');
const reason = await runSession(resolve(rootArgument), { idleTimeoutMs: idle >= 0 ? Number(flags[idle + 1]) : undefined, browser: !flags.includes('--no-browser') }).catch(error => 'Failed: ' + (error?.stack ?? error));
console.error(stamp() + reason);
process.exit(reason.startsWith('Failed') ? 1 : 0);
