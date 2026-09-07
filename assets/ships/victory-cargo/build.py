"""Original versioned convoy components; see the registered recipe inputs."""
from pathlib import Path
import runpy
recipe=runpy.run_path(str(Path(__file__).resolve().parents[1]/'convoy/geometry-v2.py'),run_name='__main__')
# Victory's two after bridge sponsons stand beyond the accommodation wall.
# Their transverse beams and diagonal knees meet the wall at Y=4.0 m.
deck=next(s for s in recipe['definition']['structures'] if s['id']=='aft-bridge-platform-port')['baseY']
for side in [-1,1]:
    for x in [-9.3,-11.5]:
        recipe['rod']('aft-bridge-sponsons.beam',(x,side*3.9,deck),(x,side*6.8,deck),.07,recipe['materials']['naval'])
        recipe['rod']('aft-bridge-sponsons.knee',(x,side*3.9,deck-1.35),(x,side*6.65,deck),.065,recipe['materials']['naval'])
recipe['bpy'].ops.wm.save_as_mainfile(filepath=str(recipe['out']/'source.blend'))
