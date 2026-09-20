/** `bun run ui:shot -- [--state port|editor|battle] [--design <name>] [--battle "<player>;<friends>;<enemies>"] [--out file.png] ...`
 * One command, one image: the real App in a headed Chromium, no account, saved designs seeded.
 * `--settle` (editor only) waits for the in-browser design check and prints its status and ledger first. */
import { parseArgs } from 'node:util';
import { designs, designCheck, launchHarness, openEditor, berth, settle, shot } from './harness';

const { values } = parseArgs({ options: {
  state: { type: 'string', default: 'port' }, design: { type: 'string' }, battle: { type: 'string' }, range: { type: 'string' },
  out: { type: 'string' }, viewport: { type: 'string', default: '1728x1030' }, wait: { type: 'string', default: '2' },
  param: { type: 'string', multiple: true, default: [] }, url: { type: 'string' }, eval: { type: 'string' }, list: { type: 'boolean', default: false },
  settle: { type: 'boolean', default: false },
} });
if (values.settle && values.state !== 'editor') throw new Error('--settle waits for the ship editor’s design check; use it with --state editor.');
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
    // The image is worth little while the design check is still running: the ledger then shows the
    // previous revision's readings and the chip says "Checking design…".
    if (values.settle) console.log(JSON.stringify(await designCheck(harness.page), null, 1));
    await settle(harness.page, Number(values.wait));
    console.log(await shot(harness.page, values.out ?? `.build/shots/${values.state}.png`));
  }
  if (harness.errors.length) { console.error(harness.errors.join('\n')); process.exitCode = 1; }
} finally { await harness.close(); }
