"""Original Bismarck exterior, 24 May 1941 fit at the separately stated standard draft, in launch-era plain paint.

The current refinement follows the approved GameModels3D pgsb708 A fit.
Reference geometry is inspection-only; all shapes below are original constructions. Blueprint polygons own major
placements; this original recipe owns construction/detail primitives. No source mesh or extracted transforms enter.
Regions live in bismarck_<region>.py and run in dependency order: support queries sample what earlier regions made.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from bismarck_kit import *
import bismarck_hull as hull, bismarck_armament as armament, bismarck_forward as forward, bismarck_aft as aft, bismarck_midships as midships
hull.loft()
for s in DEF['structures']:structure_drawers.get(s['id'],draw_structure)(s)
armament.batteries()
# Each region owns its module; run order matters only where a support query samples earlier work.
forward.build()
midships.build()
aft.build()
hull.build()
armament.aa_mounts()
forward.after_mounts()
midships.after_mounts()
aft.after_mounts()
hull.after_mounts(armament.aa_support)
for ob in scene.objects:
 if ob.type=='MESH' and not ob.get('assemblyId'):ob['assemblyId']='superstructure' if ob.users_collection[0] in [supercol,detailcol] else 'hull-underwater' if ob.users_collection[0]==undercol else 'hull'
# Inspectable volumes are omitted from the playable export; the game reads the
# identical definition. Existing armor and compartment IDs remain stable.
for a in DEF['armor']:
 if a.get('plate',{}).get('mountId'):continue
 v=[(-z,-x,y) for x,y,z in a['plate']['vertices']]
 ob=mesh(a['name'],v,[tuple(range(len(v)))],materials['oxide'],simcol);ob['exportRole']='simulation';ob.hide_render=True
for c in DEF['compartments']:
 x,y,z=c['center'];sx,sy,sz=c['size'];ob=box(c['name'],(-z,-x,y),(sz,sx,sy),materials['edge'],simcol);ob['exportRole']='simulation';ob.hide_render=True
simcol.hide_render=True;simcol.hide_viewport=True
for name,loc in landmarks.items():
 ob=bpy.data.objects.new('landmark.'+name,None);scene.collection.objects.link(ob);ob.location=loc;ob['nodeId']='landmark.'+name
OUT.mkdir(parents=True,exist_ok=True)
from blender_rig import create_flagstaffs
create_flagstaffs(DEF)
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/ships'))
from blender_wall_fittings import seat_wall_fittings
seat_wall_fittings(scene)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
consolidate_finish_uvs(scene)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('INDEPENDENT BISMARCK SOURCE 1941-05 launch paint',len(scene.objects),'objects',flush=True)
