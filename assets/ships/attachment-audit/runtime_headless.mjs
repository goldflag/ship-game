// Fallback for an unavailable Orca embedded browser. Requires playwright-core.
// ATTACHMENT_BROWSER_DRIVER=/path/to/playwright-core node runtime_headless.mjs SHIP ...
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.ATTACHMENT_BROWSER_DRIVER || 'playwright-core');
import {readFile,writeFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('.',import.meta.url));
const browser=await chromium.launch({executablePath:process.env.ATTACHMENT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1486,height:1144}});
page.on('pageerror',e=>console.error('PAGE',e.message));
const views={
'bismarck':[['aa',[0,0,18],[24,36,18]],['bridge',[20,0,23],[12,-33,12]]],
'baltimore':[['battery',[22,0,11],[30,34,17]],['stern',[-65,0,7],[-14,28,13]]],
'enterprise-cv6':[['aircraft',[60,10,17],[0,24,2]],['boats',[-38,11,11],[-10,33,5]],['aa',[45,12,17],[5,24,5]]],
'king-george-v':[['forward-battery',[50,0,12],[40,50,22]]],
'liberty-cargo':[['midships',[0,0,9],[22,38,17]]],
'liberty-collier':[['machinery',[-40,0,10],[-23,32,17]],['bow',[53,0,8],[15,25,12]]],
'victory-cargo':[['midships',[0,0,10],[25,40,19]],['aft-platform',[-10.5,5.5,10.4],[-10,15,3]]],
'flower-corvette':[['bridge',[4,0,6],[10,17,8]],['stern',[-21,0,4],[-9,15,8]]]
};
try{
for(const ship of process.argv.slice(2)){
 await page.goto('http://localhost:5187/?ship='+ship+'&review=attachment',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Armor',exact:true}).waitFor({timeout:120000});
 const ready=await page.evaluate(await readFile(root+'/runtime-review.js','utf8'));console.log('READY',ready);
 const poses=await page.evaluate(()=>window.attachmentReview.poses());
 poses.browser='Isolated headless Chrome / Metal; fallback after Orca tab closures';
 await writeFile(root+'/runtime/'+ship+'-articulation.json',JSON.stringify(poses,null,2)+'\n');
 for(const [name,target,offset]of views[ship]){
  const detail=await page.evaluate(({target,offset})=>window.attachmentReview.detail(target,offset,{trainFraction:1,elevationFraction:1,recoilFraction:1}),{target,offset});
  const image=detail.image;delete detail.image;detail.browser=poses.browser;
  await writeFile(root+'/runtime/'+ship+'-'+name+'.png',Buffer.from(image.split(',')[1],'base64'));
  await writeFile(root+'/runtime/'+ship+'-'+name+'.json',JSON.stringify(detail,null,2)+'\n');
 }
 console.log('PASS',ship,poses.poses.length,Math.max(...poses.poses.map(p=>p.maxMuzzleErrorM)));
}
}finally{await browser.close();}
