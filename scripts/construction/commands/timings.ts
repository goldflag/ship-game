import type { CliCommand } from '../command';

const ms = (from: number) => Math.round((performance.now() - from) * 10) / 10;
async function timed<T>(into: Record<string, number | null>, key: string, work: () => Promise<T>): Promise<T> {
  const from = performance.now();
  try { return await work(); } finally { into[key] = ms(from); }
}

/** Phase timings of the authoring loop. Measures the primitives directly, so numbers stay comparable across CLI changes. */
export default {
  summary: '[--skip-browser] [--skip-cargo] — time native compile (cargo run, direct binary, warm process), Vite, Chromium, page load, composition and one capture',
  switches: ['--skip-browser', '--skip-cargo'],
  async run({ root, id, has }) {
    const { spawn } = await import('node:child_process');
    const { join } = await import('node:path');
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const { readSource, readCatalog } = await import('../files');
    const compiler = await import('../compiler');
    const session = await import('../session');
    const { source } = await readSource(root, id);
    const catalog = await readCatalog(root, source.construction.catalogRevision);
    const directory = join(root, '.build/construction/timings', crypto.randomUUID());
    await mkdir(directory, { recursive: true });
    const compile: Record<string, number | null> = {}, browser: Record<string, number | null> = {}, warm: Record<string, number | null> = {};
    const run = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-2000))));
    });
    let live = false, outputs = 'not compared';
    try {
      await timed(compile, 'writeInputsMs', async () => { await writeFile(join(directory, 'source.json'), JSON.stringify(source)); await writeFile(join(directory, 'catalog.json'), JSON.stringify(catalog)); });
      const files = [join(directory, 'source.json'), join(directory, 'catalog.json')];
      const cargo = compiler.cargoCommand(), build = ['--quiet', '--locked', '--profile', 'wasm-dev', '-p', 'naval-sim', '--example', 'compile_construction'];
      let reference = '';
      // Builds and stamps first, so every later step runs one build unless another writer edits Rust meanwhile.
      const identity = await compiler.freshCompilerBinary(root).then(binary => binary ? compiler.compilerBinaryIdentity(binary) : '');
      if (!has('--skip-cargo')) {
        await timed(compile, 'cargoUpToDateCheckMs', () => run(cargo, ['build', ...build]));
        reference = await timed(compile, 'cargoRunMs', () => run(cargo, ['run', ...build, '--', ...files]));
      }
      const binary = await timed(compile, 'freshnessCheckMs', () => compiler.freshCompilerBinary(root, false));
      if (binary) {
        const direct = await timed(compile, 'directBinaryMs', () => run(binary, files));
        const served = new compiler.CompilerProcess(binary, root);
        try {
          const request = { source: JSON.stringify(source), catalog: JSON.stringify(catalog) };
          const first = await timed(compile, 'servedFirstMs', () => served.request(request));
          const second = await timed(compile, 'servedRepeatMs', () => served.request(request));
          compile.servedRepeatReusedOperations = second.reused;
          // Other writers may rebuild the compiler mid-measurement; outputs are comparable only within one build.
          const stable = identity === await compiler.compilerBinaryIdentity(binary).catch(() => '') && !!(await compiler.freshCompilerBinary(root, false));
          outputs = !stable ? 'not compared: compiler inputs changed during measurement' : (reference && direct !== reference) || first.result + '\n' !== direct || second.result + '\n' !== direct ? 'DIFFERENT' : 'identical';
          if (outputs === 'DIFFERENT') process.exitCode = 1;
        } finally { served.close(); }
      }
      live = !!(await session.liveSession(root));
      const uncached = { paths: ['session', 'binary', 'cargo'] as import('../compiler').CompilerPath[] };
      if (live) {
        await timed(warm, 'compileMs', () => compiler.compileConstructionJson(root, source, undefined, uncached));
        await timed(warm, 'compileRepeatMs', () => compiler.compileConstructionJson(root, source, undefined, uncached));
      }
      // Whole library calls, including JSON.parse of the result: a miss that stores, then a hit.
      let path = '';
      await compiler.compileConstruction(root, source);
      await timed(compile, 'libraryCacheHitMs', async () => { JSON.parse(await compiler.compileConstructionJson(root, source, undefined, { used: value => { path = value; } })); });
      if (path !== 'cache') compile.libraryCacheHitMs = null;
      await timed(compile, 'libraryUncachedMs', async () => { JSON.parse(await compiler.compileConstructionJson(root, source, undefined, { paths: ['binary', 'cargo'] })); });
      if (!has('--skip-browser')) {
        const result = await compiler.compileConstruction(root, source);
        const input = { source, result };
        const { authoringServer, serverUrl, withConstructionBrowser } = await import('../browser');
        const { chromium } = await import('playwright');
        const previous = process.env.CONSTRUCTION_SESSION; process.env.CONSTRUCTION_SESSION = 'off';
        try {
          const total = performance.now();
          const server = await timed(browser, 'viteStartMs', () => authoringServer(root, 0, false, input));
          let chrome: import('playwright').Browser | undefined;
          try {
            chrome = await timed(browser, 'chromiumLaunchMs', () => chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], ...(process.env.CONSTRUCTION_CHROME ? { executablePath: process.env.CONSTRUCTION_CHROME } : {}) }));
            const page = await chrome.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(120_000);
            await timed(browser, 'pageLoadMs', async () => { await page.goto(serverUrl(server) + '/tools/construction/review.html', { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!window.constructionReviewModule); });
            await timed(browser, 'composeModelMs', () => page.evaluate(async () => { window.constructionReviewInput = await (await fetch('/__review_input.json')).json(); window.constructionReview = await window.constructionReviewModule!.openReview(window.constructionReviewInput!); }));
            await timed(browser, 'firstViewMs', () => page.evaluate(() => window.constructionReview!.render('profile', {}).then(frame => frame.png.length)));
            await timed(browser, 'secondViewMs', () => page.evaluate(() => window.constructionReview!.render('quarter', {}).then(frame => frame.png.length)));
            await timed(browser, 'inspectMs', () => page.evaluate(() => { window.constructionReview!.inspect(); }));
          } finally { await timed(browser, 'closeMs', async () => { await chrome?.close(); (server.httpServer as import('node:http').Server | null)?.closeAllConnections(); await server.close(); }); }
          browser.coldTotalMs = ms(total);
        } finally { if (previous === undefined) delete process.env.CONSTRUCTION_SESSION; else process.env.CONSTRUCTION_SESSION = previous; }
        if (live) for (const key of ['browserOneViewMs', 'browserOneViewRepeatMs'])
          await timed(warm, key, () => withConstructionBrowser(root, input, page => page.evaluate(() => window.constructionReview!.render('profile', {}).then(frame => frame.png.length))));
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
    const sum = (...values: (number | null | undefined)[]) => values.some(v => v == null) ? null : Math.round(values.reduce<number>((a, v) => a + v!, 0));
    // One bun start plus source decoding is common to every command and excluded.
    const fourMoreViews = browser.secondViewMs == null ? null : browser.secondViewMs * 4;
    const views = sum(browser.firstViewMs, fourMoreViews, browser.inspectMs);
    return {
      id, primitives: source.construction.primitives.length, equipment: source.construction.equipment.length, session: live, cargoRunVsBinaryVsServedOutputs: outputs,
      compile, browser, warm,
      equivalents: {
        note: 'inspect and apply --dry-run are one compile; render --quick is one compile, the browser phases and five views.',
        inspectViaCargoRunMs: sum(compile.writeInputsMs, compile.cargoRunMs),
        inspectViaDirectBinaryMs: sum(compile.writeInputsMs, compile.freshnessCheckMs, compile.directBinaryMs),
        inspectViaSessionMs: warm.compileRepeatMs ?? null,
        inspectRepeatedRevisionMs: compile.libraryCacheHitMs ?? null,
        renderQuickViaCargoRunMs: sum(compile.writeInputsMs, compile.cargoRunMs, browser.viteStartMs, browser.chromiumLaunchMs, browser.pageLoadMs, browser.composeModelMs, views, browser.closeMs),
        renderQuickViaDirectBinaryMs: sum(compile.writeInputsMs, compile.freshnessCheckMs, compile.directBinaryMs, browser.viteStartMs, browser.chromiumLaunchMs, browser.pageLoadMs, browser.composeModelMs, views, browser.closeMs),
        renderQuickRepeatedRevisionViaSessionMs: sum(compile.libraryCacheHitMs, warm.browserOneViewRepeatMs, fourMoreViews, browser.inspectMs),
        renderQuickViaSessionMs: sum(warm.compileRepeatMs, warm.browserOneViewRepeatMs, fourMoreViews, browser.inspectMs),
      },
    };
  },
} satisfies CliCommand;
