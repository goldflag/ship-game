const [command,arg,out]=process.argv.slice(2);
// Connect only to a separately launched local review browser.
const port=process.env.SHOKAKU_REVIEW_PORT ?? '52324';
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target=targets.find(t=>t.type==='page'&&t.url.includes('ship=shokaku')) ?? targets.find(t=>t.type==='page');
if(!target)throw new Error('No review page; open the development game in the isolated browser first');
const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
try {
  await send('Runtime.enable');await send('Page.enable');let result;
  if(command==='goto')result=await send('Page.navigate',{url:arg});
  else if(command==='screenshot'){
    const r=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    await Bun.write(arg,Buffer.from(r.data,'base64'));result={saved:arg};
  } else {
    const expression=command==='file'?await Bun.file(arg).text():arg;
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:180000});
    if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,4000));
    result=r.result.value;
  }
  if(out){await Bun.write(out,JSON.stringify(result,null,2)+'\n');console.log('Saved',out);}
  else console.log(JSON.stringify(result).slice(0,4500));
} finally {socket.close();}
