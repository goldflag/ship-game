"""Render the saved model; also used to finish the studio lighting."""
import bpy
from pathlib import Path
OUT=Path(__file__).resolve().parent
scene=bpy.context.scene
for name,energy in [('Key • large softbox',336000),('Fill • sky',204000),('Rim • aft',408000)]:
    bpy.data.lights[name].energy=energy
source=bpy.data.texts.get('build_bismarck.py')
source.clear();source.write((OUT/'build_bismarck.py').read_text())
scene.cycles.samples=64
views=[('01 • Three-quarter • orthographic','Bismarck_hero.png',2400,1400),('02 • Starboard profile • orthographic','Bismarck_profile.png',2600,850),('03 • Deck plan • orthographic','Bismarck_deck_plan.png',2600,900)]
for name,filename,w,h in views:
    scene.camera=bpy.data.objects[name]
    scene.render.resolution_x=w;scene.render.resolution_y=h
    scene.render.filepath=str(OUT/'renders'/filename)
    bpy.ops.render.render(write_still=True)
scene.camera=bpy.data.objects[views[0][0]]
scene.render.resolution_x=2400;scene.render.resolution_y=1400
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Bismarck_1941.blend'))
