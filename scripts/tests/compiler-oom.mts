import assert from 'node:assert/strict';
import {runCompiler} from '../../services/compiler/runner';
const killed=async()=>Number((await Bun.file('/sys/fs/cgroup/memory.events').text()).match(/^oom_kill (\d+)/m)![1]);
const before=await killed();let failed=false;
try {await runCompiler([process.execPath,'-e','const data=new Uint8Array(600*1024*1024);data.fill(1);setInterval(()=>{},1000)']);}catch(error){failed=/Compiler failed/.test(String(error));}
assert.ok(failed);const after=await killed();assert.ok(after>before,'Expected a real cgroup OOM kill');
assert.equal(await runCompiler([process.execPath,'-e','process.stdout.write("recovered")']),'recovered');
console.log(JSON.stringify({ok:true,oomKills:after-before,nextJob:'recovered',memoryLimitMiB:512}));
