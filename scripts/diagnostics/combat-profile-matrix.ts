/** Sequential, reproducible exact/candidate battles. See docs/compartment-runtime.md. */
import { mkdir } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
const [manifest, label, binary = 'target/release/examples/runtime_bench', tickArg = '600'] = process.argv.slice(2);
const ticks = Number(tickArg);
if (!manifest || !label || !/^[\w-]+$/.test(label) || !Number.isInteger(ticks) || ticks < 100) throw Error('Usage: ... manifest label [binary] [ticks>=100]');
const directory = `.build/combat-profile/${label}`; await mkdir(directory, { recursive: true });
const hipper = 'admiral-hipper-construction';
const cases = [
  { id:'two', ships:2, matches:1, designs:hipper, wet:false },
  { id:'eight', ships:8, matches:1, designs:hipper, wet:false },
  { id:'sixteen', ships:16, matches:1, designs:hipper, wet:false },
  { id:'matches-4x8', ships:8, matches:4, designs:hipper, wet:false },
  { id:'mixed-eight', ships:8, matches:1, designs:`${hipper},bismarck,fletcher,enterprise-cv6`, wet:false },
  { id:'wet-two', ships:2, matches:1, designs:hipper, wet:true },
  { id:'wet-eight', ships:8, matches:1, designs:hipper, wet:true },
  { id:'wet-matches-4x8', ships:8, matches:4, designs:hipper, wet:true },
];
const results=[];
for(const c of cases){
 const child=Bun.spawn(['/usr/bin/time','-l',binary,manifest,String(c.ships),String(c.matches),String(ticks),c.designs,...(c.wet?['wet']:[])],{stdout:'pipe',stderr:'pipe',env:{...process.env,NAVAL_BENCH_SNAPSHOT:`${directory}/${c.id}.snapshot.json`}});
 const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 await Bun.write(`${directory}/${c.id}.stderr`,err);if(code)throw Error(err);
 const result={id:c.id,...JSON.parse(out),peakRssBytes:Number(err.match(/(\d+)\s+maximum resident set size/)?.[1])||null};results.push(result);
 await Bun.write(`${directory}/${c.id}.json`,JSON.stringify(result,null,2));console.log(c.id,result.tickMsAllMatches);
}
await Bun.write(`${directory}/matrix.json`,JSON.stringify({conditions:{cpu:cpus()[0]?.model,memoryBytes:totalmem(),os:platform(),arch:arch(),seed:12345,map:'north-atlantic',weather:'overcast',separationM:5000,note:'Release native, tracked allocator, shared machine. All resident matches stepped serially. Timings exclude snapshots; tails include first tick, hydro solves and gunfire. Wet means 30% water in the three largest rooms.'},results},null,2));
