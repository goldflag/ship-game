/** `bun run ui:shot -- [--state port|editor|battle] [--design <name>] [--battle "<player>;<friends>;<enemies>"] [--out file.png] ...`
 * One command, one image: the real App in a headed Chromium, no account, saved designs seeded. */
import { parseArgs } from 'node:util';
import { designs, launchHarness, openEditor, berth, settle, shot } from './harness';

const { values } = parseArgs({ options: {
  state: { type: 'string', default: 'port' }, design: { type: 'string' }, battle: { type: 'string' }, range: { type: 'string' },
  out: { type: 'string' }, viewport: { type: 'string', default: '1728x1030' }, wait: { type: 'string', default: '2' },
  param: { type: 'string', multiple: true, default: [] }, url: { type: 'string' }, eval: { type: 'string' }, list: { type: 'boolean', default: false },
} });
const [width, height] = values.viewport!.split('x').map(Number);
const params: Record<string, string> = Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2) as [string, string]));
if (values.state === 'battle') params.battle = values.battle ?? 'fletcher;;bismarck';
if (values.range) params.range = values.range;
if (values.state === 'editor' && !values.design) throw new Error('--state editor needs --design <name>; run with --list to see the saved designs.');

const harness = await launchHarness({ params, viewport: { width, height }, url: values.url });
try {
  if (values.list) { for (const design of await designs(harness.page)) console.log(`${design.name}\t${design.shipId ?? design.issue}`); }
  else {
    if (values.state === 'editor') await openEditor(harness.page, values.design!);
    else if (values.state === 'port' && values.design) await berth(harness.page, values.design);
    // Runs in the page with `review.game` in reach, for poses a parameter cannot express.
    if (values.eval) console.log(JSON.stringify(await harness.page.evaluate(values.eval)));
    await settle(harness.page, Number(values.wait));
    console.log(await shot(harness.page, values.out ?? `.build/shots/${values.state}.png`));
  }
  if (harness.errors.length) { console.error(harness.errors.join('\n')); process.exitCode = 1; }
} finally { await harness.close(); }
