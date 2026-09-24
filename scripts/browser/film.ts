/** `bun run film -- <name>`: film a staged battle (`scripts/film/films/<name>.ts`) shot by shot. See docs/film.md.
 *
 * The scout watches the battle once, skipping, and saves what happened (`scout.json`). Each take replays the same battle (same
 * seed, same orders at the same ticks) on the manual clock, skips to a shot's first tick and draws it a tick a frame, every
 * frame captured through CDP and piped to ffmpeg. Shots that overlap in battle time are filmed in further replays. The cut
 * joins the shots in the film's order. Arguments are read before anything is built, so `--help` and a typo cost nothing. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Page } from 'playwright';
import { ROOT, withHarness } from './harness';
import type { Film, FrameEvents, Scout } from '../film/types';
import type {} from '../film/runner';
import { layTrack } from '../film/soundtrack';

const USAGE = `bun run film -- <name> [flags]      films live in scripts/film/films/<name>.ts

  --scout              watch the battle again even if the scout log exists (it is kept otherwise)
  --scout-only         watch and report, film nothing
  --only <a,b>         film only these shots; the cut holds every shot rendered so far
  --stills             draw each shot but capture only its first, middle and last frames as PNGs, to review camera work
  --size WxH           output size (default 1920x1080); the window draws at twice that and is scaled down
  --rate 60|30         output frames per second (default 60); 30 blends each pair of frames, a film camera's shutter blur
  --quality <n>        JPEG capture quality, 1-100 (default 95)
  --out <dir>          default .build/film/<name>
  --sound-only         lay the soundtrack again from the rendered shots and recut, rendering nothing
  --url http://127.0.0.1:5200  reuse a running dev server
  --no-prepare         skip multiplayer:prepare:dev (content and dev WASM already built)
  --help`;

let values, positionals: string[];
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: {
    scout: { type: 'boolean', default: false }, 'scout-only': { type: 'boolean', default: false }, only: { type: 'string' },
    stills: { type: 'boolean', default: false }, size: { type: 'string', default: '1920x1080' }, rate: { type: 'string', default: '60' },
    quality: { type: 'string', default: '95' }, out: { type: 'string' }, url: { type: 'string' },
    'sound-only': { type: 'boolean', default: false }, 'no-prepare': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
  } }));
} catch (error) { console.error(`${(error as Error).message}\n\n${USAGE}`); process.exit(2); }
if (values.help) { console.log(USAGE); process.exit(0); }
const fail = (message: string): never => { console.error(message); process.exit(2); };
const name = positionals[0] ?? fail(`Name a film.\n\n${USAGE}`);
const filmFile = resolve(ROOT, 'scripts/film/films', `${name}.ts`);
if (!existsSync(filmFile)) fail(`No film at ${filmFile}.`);
const [width, height] = values.size!.split('x').map(Number);
if (!(width > 0 && height > 0) || width % 2 || height % 2) fail(`--size takes an even WxH; got "${values.size}".`);
const rate = Number(values.rate), quality = Number(values.quality);
if (![60, 30].includes(rate)) fail(`--rate is 60 or 30; got "${values.rate}".`);
if (!(quality >= 1 && quality <= 100)) fail(`--quality is 1 to 100; got "${values.quality}".`);
if (!Bun.which('ffmpeg')) fail('The film driver encodes with ffmpeg; install it (brew install ffmpeg).');

const film = (await import(filmFile)).default as Film;
if (film.battle.seed === undefined) fail(`${name}: a film's battle needs a fixed seed, or no two runs play out alike.`);
const out = resolve(ROOT, values.out ?? `.build/film/${name}`);
mkdirSync(resolve(out, 'shots'), { recursive: true });
const only = values.only?.split(',').map(entry => entry.trim()).filter(Boolean);
for (const shot of only ?? []) if (!film.shots.some(entry => entry.name === shot)) fail(`${name} has no shot "${shot}"; shots are ${film.shots.map(entry => entry.name).join(', ')}.`);

if (values['sound-only']) {
  const rendered = film.shots.flatMap((shot, index) => existsSync(resolve(out, 'shots', `${String(index + 1).padStart(2, '0')}-${shot.name}.events.json`)) && (!only || only.includes(shot.name)) ? [index] : []);
  if (!rendered.length) fail(`No rendered shots of ${name} in ${out}.`);
  rendered.splice(0, rendered.length, ...rendered.filter(index => existsSync(resolve(out, 'shots', `${String(index + 1).padStart(2, '0')}-${film.shots[index].name}.mp4`))));
  await cut(rendered);
  process.exit(0);
}
if (!values['no-prepare']) {
  const prepared = Bun.spawnSync(['bun', 'run', 'multiplayer:prepare:dev'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (prepared.exitCode) { console.error(`multiplayer:prepare:dev failed:\n${prepared.stdout}${prepared.stderr}`); process.exit(prepared.exitCode ?? 1); }
}

const serverUrl = values.url;
const params = { ...film.battle, clock: 'manual', hud: 'off', graphics: String(film.graphics?.preset ?? 'ultra') };
// The window is laid out at the output size and drawn at twice it (the device scale factor); frames are scaled down, so every
// output pixel averages four drawn ones.
const viewport = { width, height };
const started = performance.now(), elapsed = () => `${((performance.now() - started) / 1000).toFixed(0)} s`;
const say = (line: string) => console.error(`film ${elapsed()}: ${line}`);

/** One replay of the battle: a fresh harness page with the runner loaded. A launch that fails before filming (a loaded machine,
 * a dev server that dropped a request) is tried once more; a film is too long a job to lose to one. */
async function replay<T>(scout: Scout | undefined, work: (page: Page) => Promise<T>, attempt = 1): Promise<T> {
  let filming = false;
  try { return await launch(); } catch (error) {
    if (filming || attempt > 1) throw error;
    say(`the replay did not launch (${(error as Error).message.split('\n')[0]}); trying once more`);
    return replay(scout, work, attempt + 1);
  }
  function launch() {
  return withHarness({ params, viewport, url: serverUrl, hmr: false, deadline: 6 * 3600, exit: false, args: ['--force-device-scale-factor=2'], deadlines: { ready: 600 } }, async ({ page }) => {
    filming = true;
    await page.evaluate(async ({ runner, film, name, scout, rows }) => {
      const game = window.review.game!;
      if (Object.keys(rows).length) game.applyGraphics({ ...game.graphics, ...rows });
      const { createRunner } = await import(/* @vite-ignore */ runner) as typeof import('../film/runner');
      window.filmRunner = await createRunner(film, name, scout);
    }, { runner: '/scripts/film/runner.ts', film: `/scripts/film/films/${name}.ts`, name, scout, rows: Object.fromEntries(Object.entries(film.graphics ?? {}).filter(([key]) => key !== 'preset')) });
    return work(page);
  });
  }
}

// The scout: once, unless asked again.
const scoutFile = resolve(out, 'scout.json');
let scout: Scout;
if (values.scout || values['scout-only'] || !existsSync(scoutFile)) {
  say(`scouting ${film.seconds} s of battle`);
  scout = await replay(undefined, page => page.evaluate(seconds => window.filmRunner!.scout(seconds), film.seconds));
  writeFileSync(scoutFile, JSON.stringify(scout));
  say(`scouted to ${(scout.ticks / 60).toFixed(0)} s: ${scout.events.length} events, ${scout.samples.length} samples → ${scoutFile}`);
} else scout = JSON.parse(readFileSync(scoutFile, 'utf8')) as Scout;
report(scout);
if (values['scout-only']) process.exit(0);

// When each shot happens, and how many replays filming them takes.
interface Planned { index: number; name: string; start: number; end: number; frames: number }
const planned: Planned[] = [];
film.shots.forEach((shot, index) => {
  if (only && !only.includes(shot.name)) return;
  const seconds = typeof shot.start === 'number' ? shot.start : shot.start(scout);
  if (seconds === undefined) { say(`${shot.name}: the scout did not see its moment; dropped`); return; }
  const start = Math.round(seconds * 60), frames = Math.round(shot.seconds * 60);
  planned.push({ index, name: shot.name, start, end: start + Math.ceil(frames * (shot.speed ?? 1)) + 2, frames });
});
const passes: Planned[][] = [];
for (const shot of [...planned].sort((a, b) => a.start - b.start)) {
  const pass = passes.find(entries => entries[entries.length - 1].end <= shot.start);
  if (pass) pass.push(shot); else passes.push([shot]);
}
say(`${planned.length} shots in ${passes.length} replay${passes.length === 1 ? '' : 's'}: ${passes.map(pass => pass.map(shot => `${shot.name}@${(shot.start / 60).toFixed(1)}s`).join(' → ')).join(' | ')}`);

for (const [number, pass] of passes.entries()) {
  say(`replay ${number + 1} of ${passes.length}`);
  await replay(scout, async page => {
    const cdp = await page.context().newCDPSession(page);
    for (const shot of pass) {
      await page.evaluate(({ index, start }) => window.filmRunner!.cue(index, start), { index: shot.index, start: shot.start });
      // The first capture after frames drawn without one returns the compositor's stale frame; take it and throw it away.
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10, optimizeForSpeed: true });
      const stem = resolve(out, 'shots', `${String(shot.index + 1).padStart(2, '0')}-${shot.name}`), definition = film.shots[shot.index];
      const encoder = values.stills ? undefined : encode(`${stem}.mp4`, definition.fade, shot.frames);
      const log: FrameEvents[] = [], wanted = new Set([0, Math.floor(shot.frames / 2), shot.frames - 1]);
      let reported = performance.now();
      for (let frame = 0; frame < shot.frames; frame++) {
        log.push(await page.evaluate(() => window.filmRunner!.frame()));
        if (encoder) {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
          if (!encoder.stdin.write(Buffer.from(data, 'base64'))) await once(encoder.stdin, 'drain');
        } else if (wanted.has(frame)) {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(`${stem}-${String(frame).padStart(4, '0')}.png`, Buffer.from(data, 'base64'));
        }
        if (performance.now() - reported > 10_000) { reported = performance.now(); say(`${shot.name}: frame ${frame + 1} of ${shot.frames}`); }
      }
      await page.evaluate(() => window.filmRunner!.cut());
      writeFileSync(`${stem}.events.json`, JSON.stringify(log));
      if (encoder) { encoder.stdin.end(); await encoder.done; }
      say(`${shot.name}: ${shot.frames} frames from ${(shot.start / 60).toFixed(1)} s → ${values.stills ? `${stem}-*.png` : `${stem}.mp4`}`);
    }
    await cdp.detach();
  });
}

// The cut holds every shot rendered so far, so a shot filmed again with `--only` takes its place in the whole film.
if (!values.stills) await cut(film.shots.flatMap((shot, index) => existsSync(resolve(out, 'shots', `${String(index + 1).padStart(2, '0')}-${shot.name}.mp4`)) ? [index] : []));
process.exit(0);

/** Join the shots' pictures in the film's order, lay the soundtrack from their frames, and put the two together. */
async function cut(indexes: number[]): Promise<void> {
  const shots = [...indexes].sort((a, b) => a - b).map(index => ({ index, stem: resolve(out, 'shots', `${String(index + 1).padStart(2, '0')}-${film.shots[index].name}`) }));
  const list = resolve(out, 'cut.txt'), picture = resolve(out, 'picture.mp4'), sound = resolve(out, `${name}.wav`), finished = resolve(out, `${name}.mp4`);
  writeFileSync(list, shots.map(shot => `file '${shot.stem}.mp4'`).join('\n'));
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', picture]);
  layTrack(ROOT, shots.map(shot => ({ events: `${shot.stem}.events.json`, frames: Math.round(film.shots[shot.index].seconds * 60), fade: film.shots[shot.index].fade })), sound);
  await run(['-y', '-i', picture, '-i', sound, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', finished]);
  say(`cut → ${finished}`);
}
process.exit(0);

/** A shot's encoder: JPEG frames in on stdin at 60 per second, the output size, fades, and at 30 fps each pair of frames blended. */
function encode(file: string, fade: { in?: number; out?: number } | undefined, frames: number) {
  const seconds = frames / 60, filters = [`scale=${width}:${height}:flags=lanczos`];
  if (rate === 30) filters.push('tmix=frames=2', 'fps=30');
  if (fade?.in) filters.push(`fade=t=in:st=0:d=${fade.in}`);
  if (fade?.out) filters.push(`fade=t=out:st=${Math.max(0, seconds - fade.out)}:d=${fade.out}`);
  filters.push('format=yuv420p');
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'mjpeg', '-i', '-',
    '-vf', filters.join(','), '-r', String(rate), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<void>((resolveDone, reject) => child.on('close', code => code ? reject(new Error(`ffmpeg exited ${code} for ${file}`)) : resolveDone()));
  return { stdin: child.stdin, done };
}
function run(args: string[]): Promise<void> {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  return new Promise((resolveDone, reject) => child.on('close', code => code ? reject(new Error(`ffmpeg exited ${code}`)) : resolveDone()));
}

/** What the scout saw, in the terms shots are cued by. */
function report(log: Scout): void {
  const counts = new Map<string, number>();
  for (const event of log.events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  say(`events: ${[...counts].map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
  for (const event of log.events.filter(event => ['sunk', 'torpedo-hit', 'bomb-release', 'aircraft-launch'].includes(event.kind)).slice(0, 40))
    console.error(`  ${(event.tick / 60).toFixed(1).padStart(6)} s  ${event.kind.padEnd(16)} ${event.shipId} ${event.aircraftId ?? event.sourceId ?? ''} ${event.message}`);
}
