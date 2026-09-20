import type { CliCommand } from '../command';

/** `session start|stop|status`. Opt-in: nothing starts a daemon implicitly. */
export default {
  summary: 'start|stop|status [--idle-minutes 30] [--no-browser] — opt-in warm daemon (native compiler process, review server, Chromium) for this worktree; every command falls back to the cold path without it',
  ship: false, positionals: 1, values: ['--idle-minutes'], switches: ['--no-browser'],
  async run({ root, positionals, option, has }) {
    const session = await import('../session');
    const action = positionals[0] ?? 'status';
    const describe = async () => {
      const probe = await session.probeSession(root, 2_000);
      return probe.live
        ? { live: true, pid: probe.record.pid, port: probe.record.port, file: session.sessionPath(root), log: session.sessionLogPath(root), status: probe.status }
        : { live: false, reason: probe.reason, ...(probe.record ? { stalePid: probe.record.pid } : {}) };
    };
    if (action === 'status') return describe();
    if (action === 'start') {
      const { started } = await session.startSession(root, { idleMinutes: option('--idle-minutes') === undefined ? undefined : Number(option('--idle-minutes')), browser: !has('--no-browser') });
      return { started, ...(await describe()) };
    }
    if (action === 'stop') return session.stopSession(root);
    throw new Error('Expected session start, stop or status.');
  },
} satisfies CliCommand;
