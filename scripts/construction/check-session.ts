import { resolve } from 'node:path';
import { readSource, digest } from './files';
import { compileConstructionJson, compilerBinaryIdentity, freshCompilerBinary, type CompilerPath } from './compiler';
import { withConstructionBrowser } from './browser';
import { probeSession, startSession, stopSession } from './session';

// Smoke check of the warm path: bun scripts/construction/check-session.ts [ship-id] [--skip-browser]
// Cold and warm must agree byte for byte, and a killed daemon must cost one short probe, not a hang.
const root = resolve(import.meta.dir, '../..'),
  id = process.argv.slice(2).find((word) => !word.startsWith('--')) ?? 'valiant';
const { source } = await readSource(root, id);
const report: Record<string, unknown> = { id };
const compile = async (paths: CompilerPath[]) => {
  let used = '';
  const from = performance.now();
  const text = await compileConstructionJson(root, source, undefined, {
    paths,
    used: (path) => {
      used = path;
    },
  });
  return { text, used, ms: Math.round(performance.now() - from) };
};
const identity = async () => {
  const binary = await freshCompilerBinary(root);
  return binary ? compilerBinaryIdentity(binary) : '';
};
const render = (session: boolean) => {
  process.env.CONSTRUCTION_SESSION = session ? 'on' : 'off';
  return withConstructionBrowser(root, { source, result: JSON.parse(cold.text) }, async (page) => ({
    frame: await page.evaluate(() => window.constructionReview!.render('profile', {})),
    inspection: await page.evaluate(() => window.constructionReview!.inspect()),
  })).finally(() => {
    delete process.env.CONSTRUCTION_SESSION;
  });
};
const started = (await startSession(root)).started;
let cold!: Awaited<ReturnType<typeof compile>>,
  failed = false;
try {
  for (let attempt = 1; ; attempt++) {
    // Another writer editing Rust mid-check changes the compiler legitimately; compare within one build only.
    const before = await identity();
    cold = await compile(['binary', 'cargo']);
    const first = await compile(['session']),
      repeat = await compile(['session']);
    // A default call stores on a miss; the next one must be served from the cache.
    await compile(['cache', 'session']);
    const cached = await compile(['cache']).catch(() => undefined);
    if (before && before === (await identity())) {
      report.compile = {
        coldPath: cold.used,
        coldMs: cold.ms,
        warmMs: first.ms,
        warmRepeatMs: repeat.ms,
        cacheMs: cached?.ms ?? null,
        bytes: cold.text.length,
        sha256: digest(cold.text),
        warmIdentical: first.text === cold.text && repeat.text === cold.text && first.used === 'session',
        cacheIdentical: cached ? cached.text === cold.text : null,
      };
      break;
    }
    if (attempt === 3) throw new Error('Compiler inputs kept changing; rerun when no one is editing Rust.');
  }
  if (!process.argv.includes('--skip-browser')) {
    const from = performance.now(),
      coldRender = await render(false),
      mid = performance.now(),
      warmRender = await render(true),
      end = performance.now();
    const probe = await probeSession(root);
    report.render = {
      coldMs: Math.round(mid - from),
      warmMs: Math.round(end - mid),
      pngSha256: digest(coldRender.frame.png),
      sessionBrowserRequests: probe.live ? probe.status.browser.requests : null,
      pngIdentical: coldRender.frame.png === warmRender.frame.png,
      cameraIdentical: JSON.stringify(coldRender.frame.camera) === JSON.stringify(warmRender.frame.camera),
      inspectionIdentical: JSON.stringify(coldRender.inspection) === JSON.stringify(warmRender.inspection),
    };
  }
  if (started) {
    const probe = await probeSession(root);
    if (probe.live) process.kill(probe.record.pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await compile(['session', 'binary', 'cargo']);
    report.killedDaemon = {
      fellBackTo: after.used,
      ms: after.ms,
      identical: after.text === cold.text,
      probe: (await probeSession(root)).live ? 'still live' : 'not live',
    };
  } else report.killedDaemon = 'skipped: the session was already running and is left alone';
  const flags = JSON.stringify(report);
  failed = flags.includes('Identical":false') || flags.includes('"identical":false') || flags.includes('"fellBackTo":"session"');
} finally {
  if (started) await stopSession(root);
}
console.log(JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
