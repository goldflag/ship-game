/** OS resident memory (separate from the native harness's exact live allocations).
 * Fresh native processes; RSS is sampled every 100 ms. Last five samples after
 * one second approximate steady battle residency, not an allocator measurement.
 */
const rows=[];
for(const [label,binary,manifest] of [
 ['before','.build/runtime-size/baseline-bench','.build/runtime-size/baseline-manifest.json'],
 ['after','target/release/examples/runtime_bench','.build/naval-content/manifest.json'],
]) {
 const start=performance.now(), samples:{ms:number;bytes:number}[]=[];
 const child=Bun.spawn([binary,manifest,'2','1','600','resolute'],{stdout:'pipe',stderr:'pipe'});
 let exited=false;void child.exited.then(()=>{exited=true;});
 const output=new Response(child.stdout).text(), errors=new Response(child.stderr).text();
 while(!exited){const ps=Bun.spawn(['ps','-o','rss=','-p',String(child.pid)],{stdout:'pipe',stderr:'ignore'});const rss=Number((await new Response(ps.stdout).text()).trim());await ps.exited;if(rss)samples.push({ms:performance.now()-start,bytes:rss*1024});await new Promise(r=>setTimeout(r,100));}
 if(await child.exited)throw new Error(await errors);
 const tail=samples.filter(s=>s.ms>1000).slice(-5).map(s=>s.bytes).sort((a,b)=>a-b);
 const row={label,samples,steadyRssBytes:tail[Math.floor(tail.length/2)],peakSampledRssBytes:Math.max(...samples.map(s=>s.bytes)),native:JSON.parse(await output)};rows.push(row);console.log(label,row.steadyRssBytes,row.peakSampledRssBytes);
}
await Bun.write('.build/runtime-size/resident.json',JSON.stringify(rows,null,2));
