"""Original versioned convoy components; see the registered recipe inputs."""
from pathlib import Path
import runpy
recipe=runpy.run_path(str(Path(__file__).resolve().parents[1]/'convoy/geometry-v2.py'),run_name='__main__')

import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(recipe['scene'],recipe['materials'],Path(__file__).with_name('appearance.json'))
recipe['bpy'].ops.wm.save_as_mainfile(filepath=str(recipe['out']/'source.blend'))
