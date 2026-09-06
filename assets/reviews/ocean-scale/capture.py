import subprocess,json,base64,pathlib
root=pathlib.Path('assets/reviews/ocean-scale')
def evaluate(js):
 r=json.loads(subprocess.check_output(['orca','eval','--expression',js,'--json'],text=True))
 if not r['ok']: raise RuntimeError(r)
 value=r['result']['result']
 try: return json.loads(value)
 except json.JSONDecodeError: return value
def capture(name):
 data=evaluate('window.captureHarbor()')
 (root/(name+'.png')).write_bytes(base64.b64decode(data.split(',')[1]))
 print(name,flush=True)
evaluate('game.scheduleFrame=()=>{};game.setPaused(true);document.querySelector("#scene").style.cssText="width:1600px;height:900px";game.settings.resolution=1/Math.min(devicePixelRatio,1.5); game.resize(); true')
for scene in ['port','sea']:
 evaluate('game.setInPort('+str(scene=='port').lower()+');game.setPaused(true);game.rig.update(game.simulation.ship,0,0,true);true')
 for variant in ['before','after']:
  amp=('.18' if scene=='port' else '.75') if variant=='before' else ('.12' if scene=='port' else '.45')
  wavelength='65' if variant=='before' else ('14' if scene=='port' else '28')
  chop='1.05' if variant=='before' else '.8'
  evaluate(f'game.water.waves.amplitude.value={amp};game.water.waves.peakWavelength.value={wavelength};game.water.waves.choppiness.value={chop};game.water.waves.dirty=true;true')
  evaluate('(async()=>{game.water.deterministic=true;game.water.syncToTick(3600);await game.water.update(1/60);for(let i=0;i<32;i++)await game.frame(performance.now());return true})()')
  data=evaluate('(async()=>{const capture=window.captureHarbor();await game.frame(performance.now());return capture})()')
  (root/(scene+'-'+variant+'.png')).write_bytes(base64.b64decode(data.split(',')[1]))
  print(scene,variant,flush=True)
print(evaluate('({errors:window.errors,camera:game.camera.position.toArray(),width:game.renderer.domElement.width,height:game.renderer.domElement.height})'))
