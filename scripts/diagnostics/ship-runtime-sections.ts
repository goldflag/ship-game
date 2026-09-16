/** Attribute NSD DAG bytes once; shared nodes are separate from exclusive sections. */
const [input, output] = process.argv.slice(2);
if (!input || !output?.startsWith('.build/')) throw Error('Pass input.nsd .build/output.json');
const bytes = new Uint8Array(await Bun.file(input).arrayBuffer());
if ([78, 83, 68, 1].some((b, i) => bytes[i] !== b)) throw Error('Expected NSD1');
let at=4;
function uint(){let n=0,s=1;while(true){const b=bytes[at++];n+=(b&127)*s;if(!(b&128))return n;s*=128;}}
const count=uint(),root=uint(),header=at;
const offset=new Uint32Array(count),size=new Uint32Array(count),start=new Uint32Array(count),length=new Uint32Array(count),mask=new Uint32Array(count),tags=new Uint8Array(count),refs=new Uint32Array(bytes.length);
let edge=0;
for(let i=0;i<count;i++){
 offset[i]=at;start[i]=edge;const tag=tags[i]=bytes[at++];
 if(tag===3)at+=8;
 else if(tag===4){const n=uint();at+=n;}
 else if(tag===5){const n=uint();for(let j=0;j<n;j++)refs[edge++]=uint();}
 else if(tag===6){const schema=uint();refs[edge++]=schema;const n=length[schema];for(let j=0;j<n;j++)refs[edge++]=uint();}
 length[i]=edge-start[i];size[i]=at-offset[i];
}
if(at!==bytes.length)throw Error('Invalid size');
function string(id:number){at=offset[id]+1;const n=uint();return new TextDecoder().decode(bytes.subarray(at,at+n));}
const schema=refs[start[root]],keys=Array.from(refs.subarray(start[schema],start[schema]+length[schema]),string);
if(keys.length>32)throw Error('Too many sections');
keys.forEach((k,i)=>mask[refs[start[root]+1+i]]|=2**i);
for(let i=count-1;i>=0;i--)if(mask[i])for(let j=start[i];j<start[i]+length[i];j++)mask[refs[j]]|=mask[i];
const sections=keys.map(section=>({section,exclusiveBytes:0,reachableBytes:0,nodes:0}));
let sharedBytes=0,overhead=header;
const groups=new Map<number,number>();
const types=['null','false','true','f64','string','array references','object references'];
const byType=types.map(type=>({type,bytes:0,nodes:0}));
for(let i=0;i<count;i++){
 const m=mask[i];byType[tags[i]].bytes+=size[i];byType[tags[i]].nodes++;
 if(!m){overhead+=size[i];continue;}
 const exclusive=(m&(m-1))===0;
 if(!exclusive){sharedBytes+=size[i];groups.set(m,(groups.get(m)??0)+size[i]);}
 for(let j=0;j<keys.length;j++)if(m&(2**j)){sections[j].reachableBytes+=size[i];sections[j].nodes++;if(exclusive)sections[j].exclusiveBytes+=size[i];}
}
const result={totalBytes:bytes.length,count,header,overhead,sharedBytes,sections:sections.sort((a,b)=>b.exclusiveBytes-a.exclusiveBytes),sharedGroups:[...groups].map(([m,bytes])=>({sections:keys.filter((_,j)=>m&2**j),bytes})).sort((a,b)=>b.bytes-a.bytes).slice(0,20),byType};
if(sections.reduce((n,s)=>n+s.exclusiveBytes,0)+sharedBytes+overhead!==bytes.length)throw Error('Attribution mismatch');
await Bun.write(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
