"""Fletcher revision 4: original reference-led, blueprint-driven ship authoring.

Axes are metres, +X bow, +Y port, +Z up, waterline Z=0. The July 1942
Bureau of Ships photographs and ONI recognition drawings were interpreted by
hand. GameModels3D is a raster comparison only; this recipe reads no reference
images, external meshes, attachment transforms or textures. See reports/components.md.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
from array import array
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/ships'))
from blender_components import create_gun_mount
from blender_rig import radar_pivot

out = Path(os.environ['SHIP_OUTPUT'])
definition = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'; scene.unit_settings.scale_length = 1
col = bpy.data.collections.new('Fletcher original assemblies'); scene.collection.children.link(col)
materials = {}
colors = {
    'naval': (.38,.415,.44,1), 'hullgray': (.23,.27,.30,1),
    'roof': (.16,.20,.225,1), 'deck': (.125,.16,.19,1),
    'edge': (.18,.215,.24,1), 'canvas': (.43,.45,.42,1),
    'dark': (.025,.033,.038,1), 'glass': (.055,.115,.14,1),
    'underwater': (.23,.055,.038,1), 'bronze': (.34,.235,.105,1),
    'rope': (.30,.27,.21,1), 'white': (.68,.71,.70,1),
    'wood': (.24,.18,.105,1), 'wear': (.30,.32,.33,1),
}
for key, color in colors.items():
    m = bpy.data.materials.new('Fletcher '+key); m.diffuse_color = color; m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = .73 if key not in ['glass','bronze'] else .3
    bsdf.inputs['Metallic'].default_value = .10 if key!='bronze' else .75
    materials[key] = m

def mesh(name, vertices, faces, material, collection=col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); collection.objects.link(obj)
    if material: data.materials.append(material)
    for p in data.polygons: p.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj

def cyl(name, loc, radius, depth, material, collection=col, vertices=24, r2=None):
    r2 = radius if r2 is None else r2; depth = max(.001,depth)
    vs = [(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z)
          for z,r in [(-depth/2,radius),(depth/2,r2)] for i in range(vertices)]
    fs = [(i,(i+1)%vertices,vertices+(i+1)%vertices,vertices+i) for i in range(vertices)]
    fs += [tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]
    o = mesh(name,vs,fs,material,collection,True); o.location=loc
    o.data.polygons[-1].use_smooth=False; o.data.polygons[-2].use_smooth=False
    return o

def rod(name, a, b, r, material, collection=col, r2=None, vertices=10):
    a,b = Vector(a),Vector(b)
    o = cyl(name,(a+b)/2,r,(b-a).length,material,collection,vertices,r2)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o

def box(name, loc, dim, material, collection=col, bev=.035):
    x,y,z = (d/2 for d in dim)
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    o=mesh(name,vs,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,collection)
    o.location=loc
    if bev:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=min(bev,min(dim)*.24); mod.segments=2
    return o

def empty(name,loc):
    o=bpy.data.objects.new(name,None);col.objects.link(o);o.location=loc
    o['nodeId']=name;o['assemblyId']=name.split('.')[0];return o

def attach(obj,parent):
    bpy.context.view_layer.update(); world=obj.matrix_world.copy()
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world

def local(obj,parent,assembly=None):
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
    if assembly:obj['assemblyId']=assembly
    return obj

def tube_path(name,points,r,mat,sides=8,closed=False):
    pts=[Vector(p) for p in points];verts=[];n=len(pts)
    for i,p in enumerate(pts):
        delta=pts[(i+1)%n]-pts[(i-1)%n] if closed else pts[min(i+1,n-1)]-pts[max(i-1,0)]
        q=delta.to_track_quat('Z','Y')
        verts += [p+q@Vector((r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),0)) for j in range(sides)]
    faces=[]
    for i in range(n if closed else n-1):
        k=(i+1)%n
        faces += [(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
    if not closed:faces += [tuple(reversed(range(sides))),tuple((n-1)*sides+j for j in range(sides))]
    return mesh(name,verts,faces,mat,smooth=True)

def outline_oval(cx,cy,rx,ry,n=48):return [(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)]
def outline_rect(x0,x1,y0,y1,c=.18):return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]

def prism(name,outline,z0,z1,mat=materials['naval'],roof=True):
    n=len(outline);vs=[(x,y,z) for z in [z0,z1] for x,y in outline]
    faces=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n)))]
    if roof:faces += [tuple(range(n,2*n))]
    o=mesh(name,vs,faces,mat)
    if roof:
        o.data.materials.append(materials['deck']);o.data.polygons[-1].material_index=1
    return o

def bulwark(name,outline,z,height=.85,thick=.065,closed=True):
    # Visible shell thickness and a rolled upper edge, with openings left as real openings.
    n=len(outline);center=Vector((sum(p[0] for p in outline)/n,sum(p[1] for p in outline)/n))
    inside=[]
    for p in outline:
        p=Vector(p);inside.append(tuple(p+(center-p).normalized()*thick))
    verts=[(x,y,zz) for shape,zz in [(outline,z),(outline,z+height),(inside,z+height),(inside,z)] for x,y in shape]
    faces=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),(2*n+i,2*n+j,3*n+j,3*n+i)])
    mesh(name+'.plating',verts,faces,materials['naval'])
    tube_path(name+'.cap',[(x,y,z+height+.01) for x,y in outline],.034,materials['edge'],closed=closed)
    for i in range(0,n,max(1,n//12)):
        x,y=inside[i];rod(name+'.stiffener',(x,y,z+.07),(x,y,z+height-.035),.028,materials['edge'],vertices=6)

def rails(name,points,height=.94,closed=False,spacing=1.8):
    dense=[]
    count=len(points) if closed else len(points)-1
    for i in range(count):
        a,b=Vector(points[i]),Vector(points[(i+1)%len(points)]);steps=max(1,math.ceil((b-a).length/spacing))
        dense += [tuple(a.lerp(b,j/steps)) for j in range(steps)]
    if not closed:dense.append(points[-1])
    for p in dense:rod(name+'.stanchion',p,(p[0],p[1],p[2]+height),.024,materials['edge'],vertices=6)
    for dz in [.31,.63,height]:tube_path(name+'.lifeline',[(x,y,z+dz) for x,y,z in dense],.010 if dz<height else .017,materials['edge'],sides=6,closed=closed)

def ladder(name,a,b,w=.55):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.29))
    for side in [-1,1]:rod(name+'.rail',a+Vector((0,side*w/2,0)),b+Vector((0,side*w/2,0))+(b-a).normalized()*.65,.026,materials['edge'],vertices=8)
    for i in range(n+1):
        p=a.lerp(b,i/n);rod(name+'.rung',p+Vector((0,-w/2,0)),p+Vector((0,w/2,0)),.023,materials['naval'],vertices=8)

def stairs(name,a,b,w=.70):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b.z-a.z)/.23))
    for side in [-1,1]:
        offset=Vector((0,side*w/2,0));rod(name+'.stringer',a+offset,b+offset,.06,materials['edge'])
        rod(name+'.handrail',a+offset+Vector((0,0,.8)),b+offset+Vector((0,0,.8)),.026,materials['naval'])
        for t in [0,.5,1]:
            p=a.lerp(b,t)+offset;rod(name+'.post',p,p+Vector((0,0,.8)),.025,materials['naval'])
    for i in range(n+1):
        p=a.lerp(b,i/n);box(name+'.tread',p,(abs(b.x-a.x)/n+.06,w,.055),materials['roof'],bev=.006)

def portlight(name,center,normal,r=.18):
    p=Vector(center);v=Vector(normal)
    rod(name+'.rim',p-v*.012,p+v*.045,r,materials['edge'],vertices=20)
    rod(name+'.glass',p+v*.046,p+v*.055,r*.76,materials['glass'],vertices=20)
    # Rain eyebrow remains visible in close views.
    tangent=Vector((-v.y,v.x,0));up=Vector((0,0,1))
    tube_path(name+'.eyebrow',[p+v*.075+tangent*(r*1.08*math.cos(i*math.pi/10))+up*(r*1.08*math.sin(i*math.pi/10)) for i in range(11)],.018,materials['naval'],sides=6)

def door(name,x,y,z,side=1,w=.66,h=1.55):
    box(name+'.frame',(x,y-side*.035,z+h/2),(w,.12,h),materials['edge'],bev=.025)
    outline=[(x-w/2,z+.12),(x-w/2+.12,z),(x+w/2-.12,z),(x+w/2,z+.12),(x+w/2,z+h-.12),(x+w/2-.12,z+h),(x-w/2+.12,z+h),(x-w/2,z+h-.12)]
    o=mesh(name+'.gasket',[(a,y,b) for a,b in outline],[tuple(range(8))],materials['dark'])
    mesh(name+'.leaf',[(x+(a-x)*.92,y+side*.028,z+h/2+(b-z-h/2)*.97) for a,b in outline],[tuple(range(8))],materials['naval'])
    for dz in [.35,1.15]:
        rod(name+'.hinge',(x-w/2+.06,y+side*.075,z+dz-.1),(x-w/2+.06,y+side*.075,z+dz+.1),.028,materials['edge'])
        box(name+'.dog',(x+w*.33,y+side*.065,z+dz),(.14,.06,.035),materials['edge'],bev=.005)
    rod(name+'.handle',(x+w*.28,y+side*.12,z+.72),(x+w*.28,y+side*.12,z+.9),.021,materials['edge'])
    for dz in [.72,.90]:rod(name+'.handle-foot',(x+w*.28,y+side*.025,z+dz),(x+w*.28,y+side*.12,z+dz),.020,materials['edge'])

def locker(name,loc,dim=(.62,.5,.72)):
    x,y,z=loc;box(name+'.box',loc,dim,materials['naval'])
    box(name+'.lid',(x,y,z+dim[2]/2+.024),(dim[0]+.035,dim[1]+.035,.045),materials['roof'],bev=.012)
    for xx in [-.18,.18]:box(name+'.latch',(x+xx,y-dim[1]/2-.018,z+.1),(.045,.04,.11),materials['edge'],bev=.006)

h=definition['hull'];half=h['length']/2

def interp(table,s):
    for (a,u),(b,v) in zip(table,table[1:]):
        if a<=s<=b:return u+(v-u)*(s-a)/(b-a)
    return table[0][1] if s<table[0][0] else table[-1][1]
width=lambda x:interp(h['halfBreadths'],x+half)
deckz=lambda x:interp(h['deckHeights'],x+half)

def hull_breadth_at(x,z):
    station=x+half
    for a,b in zip(h['sections'],h['sections'][1:]):
        if a['station']<=station<=b['station']:
            t=(station-a['station'])/(b['station']-a['station'])
            pts=[(w+(v-w)*t,y+(q-y)*t) for (w,y),(v,q) in zip(a['points'],b['points'])]
            for (w,y),(v,q) in zip(pts,pts[1:]):
                if y<=z<=q:return w+(v-w)*(z-y)/max(.00001,q-y)
    return width(x)

def hull_height_at(x,y):
    # Author-owned hull only: seat shaft-strut roots inside the curved afterbody.
    station=x+half
    for a,b in zip(h['sections'],h['sections'][1:]):
        if a['station']<=station<=b['station']:
            t=(station-a['station'])/(b['station']-a['station'])
            pts=[(w+(v-w)*t,z+(q-z)*t) for (w,z),(v,q) in zip(a['points'],b['points'])]
            for (w,z),(v,q) in zip(pts,pts[1:]):
                if w<=abs(y)<=v:return z+(q-z)*(abs(y)-w)/max(.00001,v-w)
    raise ValueError('Shaft strut falls outside original hull')

# Blueprint station hull: deep raked stem, flared forebody, flat floor and rounded transom.
verts=[]
for section in h['sections']:
    pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
    verts += [(section['station']-half,w,z) for w,z in ring]
n=len(ring);faces=[]
for i in range(len(h['sections'])-1):
    faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n)]
faces += [tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))]
hull=mesh('hull.envelope',verts,faces,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface'
# A cambered steel deck, separate from the hull's closed CPU surface, meeting the
# shell at each section's deck edge.
edge_table=[(sec['station'],sec['points'][-1][0]) for sec in h['sections']]
deck_edge=lambda x:interp(edge_table,x+half)
verts=[]
for sec in h['sections']:
    x=sec['station']-half;w=sec['points'][-1][0];z=sec['points'][-1][1]+.018
    verts += [(x,-w,z),(x,0,z+.07*min(1,w/3)),(x,w,z)]
mesh('deck.main',verts,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(h['sections'])-1) for j in range(2)],materials['deck'])
# Low sheer strake, weld seams and a narrow waterways gutter.
for side in [-1,1]:
    edge=[(sec['station']-half,side*max(.005,sec['points'][-1][0]-.065),sec['points'][-1][1]+.06) for sec in h['sections'][::2] if .5<sec['station']<114.3]
    tube_path('hull.sheer-strake',edge,.052,materials['edge'],sides=8)
    for z in [.55,1.8]:
        seam=[(s-half,side*(hull_breadth_at(s-half,z)+.006),z) for s in range(6,103,2)]
        # Flush plate seams are fine; no oversized decorative armor belts.
        tube_path('hull.plate-seam',seam,.009,materials['wear'],sides=5)
    # Deck-edge rail at even stanchion spacing (the fine end stations would crowd it).
    railpts=[(x,side*max(.05,deck_edge(x)-.16),deckz(x)+.05) for x in [-55.35+i*1.8 for i in range(63)] if x<56.35]
    rails('rails.perimeter',railpts,spacing=1.9)

# Structural footprints remain the same source for visible deckhouses and CPU hits.
structures={s['id']:s for s in definition['structures']}
# Deckhouse roofs follow the sheer as the reference's do: (Blender x of the datum, roof height there, rise per
# metre forward). The blueprint keeps each block's mean roof as its flat hit and obstruction proxy.
ROOF_TILT={'forward-deckhouse':(28.5,6.84,.047),'machinery-deckhouse':(4.4,5.78,.030),
           'torpedo-deckhouse':(-8.2,5.38,.029),'aft-deckhouse':(-26.6,5.07,.0118)}
def roof(sid,x):
    s=structures[sid]
    if sid not in ROOF_TILT:return s['baseY']+s['height']
    x0,y0,k=ROOF_TILT[sid];return y0+k*(x-x0)
def half_width(sid,x):
    pts=[(-z,abs(xx)) for xx,z in structures[sid]['footprint']];w=0
    for (a,u),(c,v) in zip(pts,pts[1:]+pts[:1]):
        if min(a,c)-1e-6<=x<=max(a,c)+1e-6:w=max(w,u if abs(c-a)<1e-9 else u+(v-u)*(x-a)/(c-a))
    return w
for s in definition['structures']:
    if 'funnel' in s['id']:continue
    outline=[(-z,-x) for x,z in s['footprint']]
    ob=prism(s['id']+'.walls',outline,s['baseY'],s['baseY']+s['height'])
    nv=len(outline)
    for i in range(nv,2*nv):
        v=ob.data.vertices[i];v.co.z=roof(s['id'],v.co.x)
    if s['id'] in ['bridge','pilot-house']:
        for poly in list(ob.data.polygons)[:-2]:poly.use_smooth=True
    z=s['baseY']+s['height'];tube_path(s['id']+'.deck-edge',[(x,y,roof(s['id'],x)+.025) for x,y in outline],.055,materials['edge'],closed=True)
    # Side access, coamings, ventilation grilles and firefighting equipment.
    if s['id'] in ['forward-deckhouse','aft-deckhouse','machinery-deckhouse']:
        xmin=min(p[0] for p in outline);xmax=max(p[0] for p in outline)
        for side in [-1,1]:
            for i in range(int((xmax-xmin)/3.2)):
                x=xmin+1.45+i*3.2;w=half_width(s['id'],x);yy=side*(w+.028);base=max(s['baseY']+.12,deckz(x)+.12)
                if roof(s['id'],x)-base<2.0:continue
                if i%3!=2:door(s['id']+'.door',x,yy,base,side)
                else:
                    box(s['id']+'.vent',(x,yy+side*.015,base+1.25),(.65,.14,.65),materials['edge'],bev=.025)
                    for j in range(6):box(s['id']+'.louver',(x,yy+side*.115,base+1.0+j*.09),(.56,.065,.035),materials['naval'],bev=.004)
                if i%2==0:
                    portlight(s['id']+'.porthole',(x+.95,yy,base+1.45),(0,side,0),.15)
                    rod(s['id']+'.fire-main',(x-.55,yy+side*.06,base+.20),(x+1.9,yy+side*.06,base+.20),.025,materials['edge'])
                    for dx in [-.4,1.7]:rod(s['id']+'.fire-main-clip',(x+dx,yy-side*.03,base+.20),(x+dx,yy+side*.06,base+.20),.026,materials['naval'])
            run=[(x,side*(half_width(s['id'],x)+.03),roof(s['id'],x)-.32) for x in [xmin+.8+(xmax-xmin-1.6)*t/8 for t in range(9)]]
            tube_path(s['id']+'.cable-run',run,.023,materials['edge'])

# The rounded bridge front remains continuous through both full-height tiers.
# Broad stepped navigation wings and an overhanging flying bridge establish its
# mass; their decks and openings are independently authored from raster review.
pilot=structures['pilot-house'];pilot_base=pilot['baseY'];pilot_top=pilot_base+pilot['height']
o1=roof('forward-deckhouse',25.65)
for side in [-1,1]:
    # 20 mm tubs on the 01 level, overhanging the forward deckhouse on knees (reference 01 tubs).
    wing=outline_oval(25.65,side*3.60,2.35,1.55,40)
    prism('bridge.aa-wing',wing,o1-.14,o1)
    bulwark('bridge.aa-shield',[(25.65+2.35*math.cos(i*math.pi/20-math.pi/2*1.25),side*(3.60+1.55*math.sin(i*math.pi/20-math.pi/2*1.25))) for i in range(26)],o1,1.12,closed=False)
    for x in [24.1,25.65,27.2]:
        mesh('bridge.wing-knee',[(x,side*3.35,o1-.1),(x,side*4.9,o1-.1),(x,side*3.35,o1-1.5)],[(0,1,2)],materials['naval'])
    # Navigation wings on the 02 deck, which also carries the mast behind the pilot house.
    wing=[(15.50,side*1.60),(15.50,side*3.20),(16.90,side*4.85),(22.60,side*4.85),(23.40,side*4.20),(23.55,side*2.40)]
    prism('bridge.navigation-wing',wing,pilot_base-.15,pilot_base)
    bulwark('bridge.navigation-shield',wing[2:],pilot_base,1.10,closed=False)
    for x in [17.4,20.0,22.4]:
        mesh('bridge.navigation-knee',[(x,side*2.48,pilot_base),(x,side*4.8,pilot_base),(x,side*2.48,pilot_base-1.1)],[(0,1,2)],materials['naval'])
    stairs('bridge.access',(13.6,side*3.35,deckz(13.6)+.10),(17.1,side*3.35,roof('forward-deckhouse',17.1)))
    stairs('bridge.upper-access',(17.5,side*3.15,roof('forward-deckhouse',17.5)),(20.1,side*3.15,pilot_base),.56)
    # Bridge-wing portlights and visible lower chart-house doors.
    portlight('bridge.wing-port',(18.2,side*4.88,pilot_base+.53),(0,side,0),.17)
    door('bridge.chart-door',18.3,side*2.5,roof('forward-deckhouse',18.3)+.05,side,w=.65,h=1.58)
# Portholes round the pilot house, on its measured round front.
for i in range(13):
    a=-math.pi*.47+i*math.pi*.94/12
    p=(21.87+2.53*math.cos(a),2.52*math.sin(a),10.72)
    normal=Vector((math.cos(a),math.sin(a),0)).normalized()
    portlight('bridge.navigation-window',p,normal,.17)
for side in [-1,1]:
    for x in [17.4,18.6,19.8,21.0]:portlight('bridge.side-window',(x,side*2.52,10.72),(0,side,0),.17)
    portlight('bridge.lower-port',(20.0,side*2.52,8.0),(0,side,0),.19)
upper=[(-z,-x) for x,z in pilot['footprint']]
visor=[(20.5+(x-20.5)*1.02,y*1.06) for x,y in upper]
prism('bridge.visor',visor,pilot_top-.025,pilot_top+.10,materials['roof'])
flying=[(20.5+(x-20.5)*1.03,y*1.31) for x,y in upper]
prism('bridge.flying-deck',flying,pilot_top+.08,pilot_top+.18,materials['roof'])
bulwark('bridge.flying-shield',flying,pilot_top+.18,.75)
for side in [-1,1]:
    # Two round observation lobes at the front of the open bridge.
    observation=outline_oval(23.75,side*1.35,1.0,.95,36)
    prism('bridge.observation-deck',observation,pilot_top+.08,pilot_top+.18,materials['roof'])
    bulwark('bridge.observation-shield',[(23.75+1.0*math.cos(i*math.pi/24-math.pi/2),side*(1.35+.95*math.sin(i*math.pi/24-math.pi/2))) for i in range(37)],pilot_top+.18,.90,closed=False)
    cyl('bridge.pelorus',(23.75,side*1.35,pilot_top+.57),.13,.74,materials['edge'])
    box('bridge.pelorus-head',(23.75,side*1.35,pilot_top+.97),(.28,.25,.16),materials['naval'])
    rod('bridge.voice-pipe',(18.9,side*2.25,pilot_top+.16),(18.9,side*2.25,pilot_top+.87),.045,materials['edge'])
    x,y,z=17.4,side*4.50,pilot_base+.87
    cyl('bridge.signal-pedestal',(x,y,(pilot_base+z+.33)/2),.14,z+.33-pilot_base,materials['naval'])
    rod('bridge.signal-yoke',(x,y-.30,z+.3),(x,y+.30,z+.3),.035,materials['edge'])
    rod('bridge.signal-light',(x-.18,y,z+.56),(x+.22,y,z+.56),.24,materials['naval'],vertices=24)
    rod('bridge.signal-lens',(x+.221,y,z+.56),(x+.235,y,z+.56),.205,materials['glass'],vertices=24)

# Mk 37 director on its fixed pedestal (reference: base ring 13.4 m, sloped front face, 3.9 m long).
cyl('director.pedestal',(19.95,0,(pilot_top+.1+13.42)/2),1.52,13.42-pilot_top-.1,materials['naval'],vertices=48)
for z in [pilot_top+.35,12.7,13.3]:cyl('director.band',(19.95,0,z),1.56,.075,materials['edge'],vertices=48)
director_before=set(col.objects)
cyl('director.base-ring',(19.95,0,13.52),1.6,.2,materials['edge'],vertices=48)
# Side profile (Blender x, z): vertical back, flat roof, sloped upper front; a small after box.
prof=[(18.47,13.62),(21.31,13.62),(21.31,14.5),(20.22,15.51),(18.47,15.51)]
vs=[(x,y*(1 if z<15.3 else .96),z) for y in [-1.6,1.6] for x,z in prof]
n_=len(prof)
fs=[tuple(range(n_))[::-1],tuple(range(n_,2*n_))]+[(i,(i+1)%n_,n_+(i+1)%n_,n_+i) for i in range(n_)]
mesh('director.housing',vs,fs,materials['naval'])
box('director.after-box',(18.2,0,14.68),(.56,2.0,1.15),materials['naval'],bev=.04)
rod('director.rangefinder',(19.5,-2.39,14.94),(19.5,2.39,14.94),.2,materials['edge'],vertices=24)
for side in [-1,1]:
    box('director.optical-hood',(19.5,side*2.2,14.94),(.62,.42,.55),materials['naval'],bev=.12)
    portlight('director.optical-lens',(19.82,side*2.2,14.94),(1,0,0),.14)
    box('director.rangefinder-shield',(19.5,side*1.63,14.85),(.5,.08,1.3),materials['canvas'],bev=.03)
    ladder('director.ladder',(18.47+.05,side*.9,13.62),(18.47+.05,side*.9,15.45),.4)
for y in [-.7,0,.7]:
    portlight('director.front-glass',(20.8,y,15.0),Vector((1,0,1)).normalized(),.16)
# Early-war Mk 4 mattress antenna above the roof, with a shallow curved face.
for side in [-1,1]:rod('director.radar-support',(19.36,side*.7,15.5),(19.76,side*.8,16.35),.055,materials['edge'])
for z in [16.05,16.42,16.8,17.18]:
    tube_path('director.radar-horizontal',[(20.21-.26*(y/1.65)**2,y,z) for y in [-1.65,-1.32,-.99,-.66,-.33,0,.33,.66,.99,1.32,1.65]],.021,materials['edge'],sides=6)
for i in range(15):
    y=-1.65+i*3.3/14;x=20.21-.26*(y/1.65)**2
    rod('director.radar-vertical',(x,y,16.05),(x,y,17.18),.019,materials['edge'],vertices=6)
for side in [-1,1]:rod('director.radar-brace',(19.41,0,15.5),(19.94,side*1.65,17.18),.029,materials['edge'])
radar_pivot('director-mk37.yaw',(19.95,0,13.42),set(col.objects)-director_before)

FUNNEL_CAP={'forward-funnel':.72,'aft-funnel':.55}  # keep in step with author-shape.py
# Raked elliptical funnels with rolled, sloping open caps. Heights derive from the blueprint.
for s in definition['structures']:
    if 'funnel' not in s['id']:continue
    name=s['id'];outline=[(-z,-x) for x,z in s['footprint']]
    cx=sum(x for x,y in outline)/len(outline);ry=max(y for x,y in outline);rx=(max(x for x,y in outline)-min(x for x,y in outline))/2
    base=s['baseY'];height=s['height'];n=64
    def ring(t,scale=1,zoff=0):
        return [(cx-.15*height*t+rx*scale*math.cos(i*math.tau/n),ry*scale*math.sin(i*math.tau/n),base+height*t+zoff+FUNNEL_CAP[name]*math.cos(i*math.tau/n)*t*t) for i in range(n)]
    rings=[ring(t,scale) for t,scale in [(0,1.02),(.14,1),(.79,.98),(1,.92)]]
    o=mesh(name+'.jacket',[v for row in rings for v in row],[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)],materials['naval'],smooth=True)
    top=ring(1,.92);inside=ring(1,.82,-.08);deep=ring(.90,.82,-.12)
    mesh(name+'.cap-interior',top+inside+deep,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n+(i+1)%n,2*n+i) for i in range(n)]+[tuple(range(n*2,n*3))],materials['dark'],smooth=True)
    for t,sc in [(.13,1.005),(.79,.99),(1,.935)]:tube_path(name+'.rolled-band',ring(t,sc),.065 if t!=.13 else .05,materials['edge'],closed=True)
    for y in [-.85,0,.85]:
        xx=cx-.15*height;zz=base+height-.12
        rod(name+'.cap-grille',(xx-rx*.77,y,zz-.85),(xx+rx*.77,y,zz+.85),.042,materials['edge'])
    # Steam pipes follow the casing's rake, with separate elbows and supports.
    for side in [-1,1]:
        for offset in [.45]:
            x0=cx-rx*1.0-.04;top=base+height*.85
            path=[(x0,side*offset,base),(x0-.15*height*.85,side*offset,top),(x0-.15*height*.85+.10,side*offset,top+.30),(x0-.15*height*.85+.42,side*offset,top+.42)]
            tube_path(name+'.steam-pipe',path,.08,materials['edge'],sides=12)
            for t in [.2,.5,.8]:
                p=Vector(path[0]).lerp(Vector(path[1]),t);rod(name+'.pipe-clip',p,(p.x+.2,p.y,p.z),.03,materials['naval'])
        # Narrow maintenance walkway, external ladder, whistle and guardrail.
        x=cx-rx-.18
        ladder(name+'.access-ladder',(x,side*.65,base),(x-.15*height,side*.65,base+height-.25),.45)
    # Guy wires and external jacket seams stay thin at game scale.
    for side in [-1,1]:
        for dx in [-3,3]:
            gx=cx+dx;gz=roof('machinery-deckhouse',gx) if half_width('machinery-deckhouse',gx)>2.8 else deckz(gx)+.05
            rod(name+'.guy',(cx-.15*height,side*ry,base+height-.4),(gx,side*2.75,gz),.013,materials['dark'],vertices=6)
        rod(name+'.whistle',(cx-.5,side*(ry+.30),base+height-2.0),(cx-.5,side*(ry+.30),base+height-1.45),.10,materials['bronze'],vertices=12)

# Searchlight platform ahead of the fore funnel: two round lobes carrying the searchlights, on a braced
# post frame from the casing and the deckhouse roof (reference platform z -13.5..-10.4, 9.45-9.59 m).
sl=[(10.45,-2.45),(12.40,-2.45)]+[(12.40+1.05*math.cos(-math.pi/2+i*math.pi/12),-1.40+1.05*math.sin(-math.pi/2+i*math.pi/12)) for i in range(1,12)]
sl=sl+[(12.9,0)]+[(x,-y) for x,y in reversed(sl)]
prism('searchlight.platform',sl,9.45,9.59,materials['roof'])
bulwark('searchlight.screen',[(10.9,-2.45)]+[p for p in sl if p[0]>10.9]+[(10.9,2.45)],9.59,.95,closed=False)
for side in [-1,1]:
    for px,top in [(13.0,deckz(13.0)),(10.9,roof('machinery-deckhouse',10.9))]:
        rod('searchlight.post',(px,side*1.9,top),(px,side*1.9,9.46),.07,materials['edge'],vertices=10)
    rod('searchlight.brace',(13.0,side*1.9,deckz(13.0)+.3),(10.9,side*1.9,9.3),.035,materials['edge'],vertices=8)
    rod('searchlight.brace',(10.9,side*1.9,roof('machinery-deckhouse',10.9)+.2),(13.0,side*1.9,9.3),.035,materials['edge'],vertices=8)
    rod('searchlight.brace',(13.0,side*1.9,7.4),(13.0,-side*1.9,9.3),.035,materials['edge'],vertices=8)
    x,y=11.85,side*1.45
    cyl('searchlight.pedestal',(x,y,9.59+.4),.15,.8,materials['naval'],vertices=16)
    rod('searchlight.yoke',(x,y-.46,10.4),(x,y+.46,10.4),.035,materials['edge'])
    rod('searchlight.drum',(x-.45,y,10.75),(x+.40,y,10.75),.5,materials['naval'],vertices=28)
    rod('searchlight.lens',(x+.401,y,10.75),(x+.42,y,10.75),.44,materials['glass'],vertices=28)
    box('searchlight.vent',(x-.1,y,11.3),(.38,.32,.12),materials['edge'],bev=.02)
# Shelter on a platform ahead of the after funnel (reference z 1.3..2.9 at 9.25-9.9 m).
prism('aft-funnel.platform',outline_rect(-2.95,-1.25,-1.25,1.25,.12),9.13,9.25,materials['roof'])
box('aft-funnel.shelter',(-2.1,0,9.58),(1.6,1.3,.66),materials['naval'],bev=.05)
for side in [-1,1]:
    for px in [-1.4,-2.8]:rod('aft-funnel.post',(px,side*1.05,roof('machinery-deckhouse',px) if px>-2.5 else roof('torpedo-deckhouse',px)),(px,side*1.05,9.14),.06,materials['edge'],vertices=10)
rails('aft-funnel.rail',[(-1.25,-1.2,9.25),(-1.25,1.2,9.25)],.8)

# Raked pole mast behind the pilot house (reference pole: z -15.86 at 5.5 m to -14.10 at 24.3 m).
MAST_BASE,MAST_TOP=Vector((15.86,0,5.5)),Vector((14.10,0,24.30))
def mast_at(z):
    t=(z-MAST_BASE.z)/(MAST_TOP.z-MAST_BASE.z);return MAST_BASE.lerp(MAST_TOP,t)
rod('mast.fore',MAST_BASE,MAST_TOP,.28,materials['naval'],r2=.10,vertices=24)
yard=mast_at(21.24)
rod('mast.yard',(yard.x-.28,-3.30,21.24),(yard.x-.28,3.30,21.24),.07,materials['edge'])
for side in [-1,1]:
    rod('mast.yard-lamp-post',(yard.x-.28,side*3.0,21.24),(yard.x-.28,side*3.0,22.15),.025,materials['edge'],vertices=6)
    cyl('mast.yard-lamp',(yard.x-.28,side*3.0,22.2),.16,.05,materials['edge'],vertices=16)
    for y in [1.1,2.2,3.2]:
        tube_path('rigging.signal-halyard',[(yard.x-.28,side*y,21.24),(18.2,side*(2.4+y*.18),pilot_base+1.1)],.009,materials['rope'],sides=5)
    rod('rigging.fore-stay',mast_at(23.9),(30,side*2.65,roof('forward-deckhouse',30)),.014,materials['dark'],vertices=6)
    rod('rigging.aft-stay',mast_at(23.9),(-22.5,side*.35,15.4),.014,materials['dark'],vertices=6)
ladder('mast.rungs',mast_at(9.3)-Vector((.32,0,0)),mast_at(24.0)-Vector((.22,0,0)),.38)
# SC air-search bedspring at the masthead: a broad lower array under a narrower upper one.
radar_before=set(col.objects)
top=mast_at(24.3)
rod('radar.sc-pedestal',top,(top.x,0,24.72),.13,materials['edge'],vertices=16)
for (w,z0,z1) in [(1.93,24.72,25.78),(1.27,25.78,26.43)]:
    for z in [z0,(z0+z1)/2,z1]:rod('radar.sc-horizontal',(top.x,-w,z),(top.x,w,z),.022,materials['edge'],vertices=6)
    nx=int(w*2/.43)+1
    for i in range(nx+1):
        y=-w+i*2*w/nx;rod('radar.sc-vertical',(top.x,y,z0),(top.x,y,z1),.02,materials['edge'],vertices=6)
    for side in [-1,1]:rod('radar.sc-frame',(top.x,side*w,z0),(top.x,side*w,z1),.035,materials['edge'],vertices=8)
    mesh('radar.sc-reflector',[(top.x+.16,-w*.97,z0+.03),(top.x+.16,w*.97,z0+.03),(top.x+.16,w*.97,z1-.03),(top.x+.16,-w*.97,z1-.03)],[(0,1,2,3)],materials['dark'])
for side in [-1,1]:rod('radar.sc-strut',(top.x+.16,0,24.82),(top.x+.16,side*1.8,25.8),.03,materials['edge'],vertices=6)
radar_pivot('radar-sc.yaw',(top.x,0,24.55),set(col.objects)-radar_before)
# SG surface-search antenna on a bracket forward of the mast.
sg=mast_at(22.5)
prism('radar.sg-platform',outline_rect(sg.x,sg.x+1.15,-.45,.45,.1),22.70,22.80,materials['roof'])
rod('radar.sg-strut',mast_at(21.9),(sg.x+1.2,0,22.72),.04,materials['edge'])
rod('radar.sg-pedestal',(15.08,0,22.80),(15.08,0,23.22),.09,materials['edge'],vertices=12)
radar_pivot('radar-sg.yaw',(15.08,0,23.22),[box('radar.sg-head',(15.08,0,23.65),(.62,1.26,.80),materials['naval'],bev=.06),
    box('radar.sg-feed',(15.08,0,23.22),(.34,.34,.24),materials['edge'],bev=.03)])
# After pole mast on the Bofors house front, with fore-and-aft crossbars and whip antennas.
rod('mast.aft',(-22.5,0,roof('aft-deckhouse',-22.5)),(-22.5,0,15.9),.10,materials['edge'],r2=.05)
rod('mast.aft-yard',(-22.5,-1.67,15.5),(-22.5,1.67,15.5),.04,materials['edge'])
for side in [-1,1]:
    rod('mast.aft-tbs',(-22.5,side*1.5,15.5),(-22.5,side*1.72,16.12),.03,materials['edge'],vertices=6)
    rod('mast.aft-tbs',(-22.5,side*1.2,15.5),(-22.5,side*1.5,15.05),.03,materials['edge'],vertices=6)
cyl('mast.aft-star-hub',(-22.5,0,12.95),.2,.25,materials['edge'],vertices=12).rotation_euler.y=math.pi/2
for i in range(8):
    a_=i*math.tau/8;rod('mast.aft-star',(-22.5,0,12.95),(-22.5,1.15*math.cos(a_),12.95+1.15*math.sin(a_)),.018,materials['edge'],vertices=6)
rod('mast.aft-yard',(-22.5,-.9,10.75),(-22.5,.9,10.75),.035,materials['edge'])
for side in [-1,1]:
    rod('rigging.fore-aerial-outrigger',mast_at(23.4),mast_at(23.4)+Vector((0,side*.45,0)),.03,materials['edge'])
    rod('rigging.aft-aerial-outrigger',(-22.5,0,15.4),(-22.5,side*.4,15.4),.028,materials['edge'])
    rod('rigging.wireless',mast_at(23.4)+Vector((0,side*.45,0)),(-22.5,side*.4,15.4),.010,materials['dark'],vertices=6)
    rod('rigging.aft-downlead',(-22.5,side*.4,15.4),(-34,side*1.6,roof('aft-deckhouse',-34)+.05),.011,materials['dark'],vertices=6)

# Original articulated quintuple torpedo banks, above the machinery deckhouse.
for launcher in definition['torpedoLaunchers']:
    a,b,c=launcher['position'];x,y,z=-c,-a,b;name=launcher['id']
    cyl(name+'.fixed-race',(x,y,z+.08),1.43,.36,materials['edge'],vertices=64)
    for i in range(24):
        t=i*math.tau/24;cyl(name+'.race-bolt',(x+1.29*math.cos(t),y+1.29*math.sin(t),z+.28),.035,.055,materials['wear'],vertices=6)
    pivot=empty(name+'.yaw',(x,y,z))
    before=set(col.objects)
    prism(name+'.training-platform',outline_rect(x-1.55,x+1.55,y-1.45,y+1.45,.3),z+.28,z+.42,materials['roof'])
    for dx in [-1.2,.65,2.5]:box(name+'.transverse-saddle',(x+dx,y,z+.66),(.23,3.32,.30),materials['edge'])
    for dx in [-1.2,2.5]:
        for side in [-1,1]:rod(name+'.saddle-leg',(x+dx,y+side*1.2,z+.42),(x+(.3 if dx<0 else .9),y+side*.9,z+.3),.05,materials['edge'],vertices=8)
    for tube in [t for t in definition['torpedoTubes'] if t['launcherId']==name]:
        a,b,c=tube['position'];m=Vector((-c,-a,b));rear=m-Vector((8.0,0,0))
        rod(name+'.launch-tube',rear,m,.315,materials['naval'],vertices=32)
        # Distinct breach end caps, bands, rails, compressed-air piping and release rods.
        rod(name+'.breech',rear-Vector((.085,0,0)),rear+Vector((.05,0,0)),.345,materials['edge'],vertices=32)
        rod(name+'.door',rear-Vector((.10,0,0)),rear-Vector((.115,0,0)),.29,materials['naval'],vertices=24)
        rod(name+'.mouth',m+Vector((.002,0,0)),m+Vector((.018,0,0)),.279,materials['dark'],vertices=32)
        for dx in [.12,1.6,3.3,5.0,6.6,7.7]:
            p=m-Vector((dx,0,0));rod(name+'.tube-band',p-Vector((.04,0,0)),p+Vector((.04,0,0)),.336,materials['edge'],vertices=24)
        rod(name+'.guide-rail',rear+Vector((.2,0,.31)),m+Vector((-.25,0,.31)),.026,materials['edge'],vertices=8)
        rod(name+'.air-line',rear+Vector((.3,.29,.16)),m+Vector((-1,.29,.16)),.025,materials['edge'],vertices=8)
        for dx in [-2.3,-.8,.65,2.1,3.6]:box(name+'.tube-bracket',(x+dx,m.y,m.z+.34),(.12,.29,.09),materials['naval'],bev=.008)
        socket=empty(tube['id']+'.muzzle',m);attach(socket,pivot)
    if name=='torpedo-aft':
        # The after bank's enclosed round trainer's cab above its rear tubes (reference: 2.1 m across, to 8.4 m).
        cyl(name+'.trainer-cabin',(x-1.35,y,z+1.9),1.02,1.6,materials['naval'],vertices=40)
        cyl(name+'.trainer-roof',(x-1.35,y,z+2.74),1.05,.08,materials['roof'],vertices=40)
        for dy in [-.45,0,.45]:box(name+'.trainer-window',(x-.42,y+dy,z+2.35),(.05,.3,.22),materials['glass'],bev=.01)
        tube_path(name+'.handwheel',[(x-.2,y+.75+.20*math.cos(i*math.tau/24),z+1.6+.20*math.sin(i*math.tau/24)) for i in range(24)],.025,materials['edge'],closed=True)
    else:
        # The forward bank's open trainer's sight post above the centre tubes.
        cyl(name+'.trainer-cabin',(x-.95,y,z+1.3),.26,.7,materials['naval'],vertices=24)
        box(name+'.trainer-sight',(x-.95,y,z+1.78),(.45,.34,.26),materials['naval'],bev=.03)
        portlight(name+'.trainer-port',(x-.72,y,z+1.8),(1,0,0),.09)
        tube_path(name+'.handwheel',[(x-.6,y+.62+.20*math.cos(i*math.tau/24),z+1.45+.20*math.sin(i*math.tau/24)) for i in range(24)],.025,materials['edge'],closed=True)
    for dx in [-2.0,3.2]:
        for side in [-1,1]:rod(name+'.guard',(x+dx,y+side*1.82,z+.46),(x+dx,y+side*1.82,z+.94),.021,materials['edge'])
    for piece in set(col.objects)-before:
        if piece.type=='MESH':attach(piece,pivot)

# High 'sky top' aft twin 40 mm position, supported over the after deckhouse.
aa=next(m for m in definition['mounts'] if m['id']=='bofors-aft');aa_x=-aa['position'][2];aa_z=aa['position'][1]
platform=[(-22.90,-2.30),(-22.90,2.30)]+[(aa_x+2.30*math.cos(math.pi/2-i*math.pi/24),2.30*math.sin(math.pi/2-i*math.pi/24)) for i in range(25)]
prism('aa-platform.deck',platform,aa_z-.12,aa_z+.02,materials['roof']);bulwark('aa-platform.shield',platform[1:]+platform[:1],aa_z+.02,.95,closed=False)
ladder('aa-platform.ladder',(-22.82,-1.2,roof('aft-deckhouse',-22.82)),(-22.82,-1.2,aa_z),.55)
for side in [-1,1]:
    locker('aa-platform.ready-locker',(-29.8,side*1.55,roof('aft-deckhouse',-29.8)+.36),(1.6,.65,.70))
# The four waist Oerlikons occupy real cut-outs alongside the machinery house.
for mount in [m for m in definition['mounts'] if m['id'].startswith('oerlikon') and m['id'] not in ['oerlikon-1','oerlikon-2']]:
    a,z,c=mount['position'];x,y=-c,-a;side=1 if y>0 else -1
    locker('aa-waist.ammunition',(x,y-side*1.05,deckz(x)+.37),(.55,.62,.72))

# Depth charges: open stern roller tracks, breech detail, K-gun cradles and ready drums.
def charge(name,center,axis='Y'):
    x,y,z=center;d=Vector((0,.34,0) if axis=='Y' else (.34,0,0));p=Vector(center)
    rod(name+'.drum',p-d,p+d,.245,materials['naval'],vertices=24)
    for t in [-.30,.30]:
        v=Vector((0,t,0) if axis=='Y' else (t,0,0));a=(Vector((0,.025,0)) if axis=='Y' else Vector((.025,0,0)))
        rod(name+'.rim',p+v-a,p+v+a,.265,materials['edge'],vertices=24)
    # Hydrostatic end fitting remains visible without implying detailed fuze simulation.
    rod(name+'.end-plug',p+d,p+d*1.06,.077,materials['bronze'],vertices=12)
for launcher in definition['depthChargeLaunchers']:
    a,z,c=launcher['position'];x,y=-c,-a;name=launcher['id'];empty(name+'.release',(x,y,z))
    if 'rack' in name:
        for side in [-1,1]:
            yy=y+side*.47
            box(name+'.angle-track',(x+2.45,yy,z-.17),(5.65,.10,.15),materials['edge'],bev=.012)
            tube_path(name+'.guard',[(x-.25,yy,z+.32),(x+5.2,yy,z+.42)],.036,materials['naval'])
            for dx in [0,1.25,2.5,3.75,5.0]:rod(name+'.support',(x+dx,yy,deckz(x+dx)),(x+dx,yy,z+.39),.04,materials['edge'])
        for dx in [.15,1.05,1.95,2.85,3.75,4.65]:charge(name,(x+dx,y,z+.12))
        for i in range(15):rod(name+'.roller',(x+i*.36,y-.43,z-.05),(x+i*.36,y+.43,z-.05),.048,materials['wear'])
        box(name+'.release-gate',(x-.3,y,z+.32),(.07,1.0,.12),materials['naval'],bev=.01)
    else:
        side=1 if y>0 else -1
        cyl(name+'.foundation',(x,y,deckz(x)+.13),.30,.26,materials['edge'],vertices=24)
        rod(name+'.projector',(x,y,deckz(x)+.2),(x,y+side*.38,z-.05),.105,materials['naval'],vertices=20)
        box(name+'.cradle',(x,y,z+.02),(.58,.36,.13),materials['edge'])
        charge(name,(x,y,z+.28),'X')
        for dx in [-.62,.62]:
            rod(name+'.brace',(x+dx,y,deckz(x)+.06),(x,y,z-.03),.033,materials['edge'])
        charge(name+'.ready',(x+.94,y-side*.50,deckz(x)+.35),'X')
        box(name+'.ready-chock',(x+.94,y-side*.50,deckz(x)+.1),(.80,.58,.12),materials['roof'])

# Ship's boats are thin-walled, double-ended hulls with ribs, thwarts and davits.
for side in [-1,1]:
    cx,cy,z=13.0,side*4.42,6.72;L=7.7;B=1.95
    stations=[(-L/2,.02,.48),(-L*.4,.48,.15),(-L*.25,.83,-.2),(0,1,-.32),(L*.25,.83,-.12),(L*.4,.46,.18),(L/2,.02,.58)]
    vs=[]
    for x,w,k in stations:
        for yy,zz in [(-w*B/2,.6),(-w*B*.43,.10),(0,k),(w*B*.43,.1),(w*B/2,.6)]:vs.append((cx+x,cy+yy,z+zz))
    fs=[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)]
    boat=mesh('boats.whaleboat-shell',vs,fs,materials['canvas'],smooth=True)
    mod=boat.modifiers.new('Hull skin','SOLIDIFY');mod.thickness=.05
    for sign in [-1,1]:tube_path('boats.gunwale',[(cx+x,cy+sign*w*B/2,z+.6) for x,w,k in stations],.055,materials['wood'])
    for dx in [-2.1,-.9,.5,1.8]:box('boats.thwart',(cx+dx,cy,z+.38),(.28,1.63,.09),materials['wood'],bev=.025)
    box('boats.floor',(cx,cy,z+.00),(3.8,.8,.05),materials['wood'],bev=.02)
    for dx in [-2.3,2.3]:
        y=side*3.62;x=cx+dx
        tube_path('boats.davit',[(x,y,deckz(x)+.05),(x,y,7.92),(x,side*3.75,8.32),(x,side*4.67,8.37)],.075,materials['naval'],sides=12)
        rod('boats.fall',(x,side*4.67,8.37),(x,cy,z+.75),.015,materials['rope'],vertices=6)
        # Sling ends terminate at the actual hull gunwales, not in the open boat.
        beam=interp([(a,w) for a,w,k in stations],dx)*B/2
        for sign in [-1,1]:rod('boats.lifting-bridle',(x,cy,z+.75),(x,cy+sign*beam,z+.6),.020,materials['rope'],vertices=6)
        cyl('boats.davit-base',(x,y,deckz(x)+.15),.23,.30,materials['edge'],vertices=20)
    for dx in [-2,2]:rod('boats.lashing',(cx+dx,cy-.8,z+.6),(cx+dx,cy+.8,z+.6),.023,materials['rope'])
# Carley floats: rounded capsule tubes, internal gratings, straps, individual supports.
def raft(name,x,y,z,side=1,L=2.7,H=1.25):
    pts=[]
    for cx,start in [(x+L/2-H/2,-math.pi/2),(x-L/2+H/2,math.pi/2)]:
        pts += [(cx+H/2*math.cos(start+i*math.pi/16),y,z+H/2*math.sin(start+i*math.pi/16)) for i in range(17)]
    tube_path(name+'.float',pts,.145,materials['canvas'],sides=12,closed=True)
    for dz in [-.35,0,.35]:rod(name+'.grating',(x-L*.30,y-side*.06,z+dz),(x+L*.30,y-side*.06,z+dz),.022,materials['rope'])
    for dx in [-.8,-.4,0,.4,.8]:rod(name+'.grating',(x+dx,y-side*.06,z-H*.32),(x+dx,y-side*.06,z+H*.32),.021,materials['rope'])
    for dx in [-.8,.8]:
        rod(name+'.strap',(x+dx,y+side*.14,z-H/2),(x+dx,y+side*.14,z+H/2),.027,materials['edge'])
        rod(name+'.bracket',(x+dx,y-side*.2,z-H*.55),(x+dx,y+side*.18,z-H*.55),.04,materials['naval'])
for side in [-1,1]:
    for x in [21.0]:raft('lifesaving.forward-floats',x,side*(half_width('forward-deckhouse',x)+.2),5.05,side)
    for x in [-21.0,-32]:raft('lifesaving.after-floats',x,side*(half_width('aft-deckhouse',x)+.2),4.10,side)
    # Deckhouse roof rails.
    rails('after.roof-rail',[(x,side*2.40,roof('aft-deckhouse',x)) for x in [-33.6,-29,-23.4,-18.0]],.86)
    # Waist bulwark below the boat and exposed deck pipework.
    # Waist bulwark along the deck edge, its top sweeping up to the 01 deck at the forward deckhouse.
    xs_=[7.3+i*.5 for i in range(21)];o1_=roof('forward-deckhouse',17.3)
    top_=lambda x:deckz(x)+1.05+max(0,(x-12.3)/5.0)**2*(o1_-deckz(17.3)-1.05)
    vs_=[]
    for x in xs_:
        e=deck_edge(x)-.06;vs_ += [(x,side*e,deckz(x)-.02),(x,side*e,top_(x)),(x,side*(e-.06),top_(x)),(x,side*(e-.06),deckz(x)-.02)]
    fs_=[(i*4+j,(i+1)*4+j,(i+1)*4+(j+1)%4,i*4+(j+1)%4) for i in range(len(xs_)-1) for j in range(4)]
    fs_ += [(0,1,2,3),tuple((len(xs_)-1)*4+j for j in [3,2,1,0])]
    mesh('deck.boat-bulwark',vs_,fs_,materials['naval'])
    tube_path('deck.boat-bulwark-cap',[(x,side*(deck_edge(x)-.09),top_(x)+.02) for x in xs_],.035,materials['edge'])
    tube_path('deck.service-pipe',[(x,side*3.55,deckz(x)+.28) for x in range(-16,14,2)],.040,materials['edge'])
# Torpedo-deck and after-deckhouse access ladders.
stairs('deckhouse.stairs',(-16.7,0,deckz(-16.7)),(-14.0,0,roof('torpedo-deckhouse',-14.0)),.7)
stairs('after.stairs',(-38.6,0,deckz(-38.6)),(-35.95,0,roof('aft-deckhouse',-35.95)),.7)

# Ventilators, hatches, capstans, chocks, winches and cable reels, placed with working alleys.
for side in [-1,1]:
    for x in [-1.5,4.5,10.5]:
        y=side*2.65;z=roof('machinery-deckhouse',x)
        cyl('ventilation.gooseneck',(x,y,z+.35),.17,.74,materials['naval'],vertices=16)
        tube_path('ventilation.hood',[(x,y,z+.65),(x-.20,y,z+.90),(x-.48,y,z+.88)],.18,materials['naval'],sides=12)
        rod('ventilation.opening',(x-.48,y,z+.88),(x-.50,y,z+.88),.145,materials['dark'],vertices=16)
    for x in [-49,-43,-36,33,43,51]:
        yy=side*width(x)*.63;z=deckz(x)
        box('mooring.bitt-base',(x,yy,z+.10),(1.1,.47,.13),materials['edge'])
        for dx in [-.32,.32]:
            cyl('mooring.bitt',(x+dx,yy,z+.37),.13,.48,materials['naval'],vertices=16)
            cyl('mooring.bitt-cap',(x+dx,yy,z+.62),.18,.045,materials['edge'],vertices=16)
        tube_path('mooring.fairlead',[(x-.35,side*(width(x)-.20),z+.20),(x-.23,side*(width(x)-.20),z+.48),(x+.25,side*(width(x)-.20),z+.48),(x+.38,side*(width(x)-.20),z+.20)],.085,materials['naval'],sides=12)
    for x in [-41,-18,13,34]:
        y=side*3.25;z=deckz(x)+.50
        for dx in [-.5,.5]:box('reels.stand',(x+dx,y,z-.18),(.12,.64,.54),materials['edge'])
        rod('reels.cable',(x-.43,y,z),(x+.43,y,z),.25,materials['rope'],vertices=24)
        for dx in [-.44,.44]:rod('reels.flange',(x+dx-.025,y,z),(x+dx+.025,y,z),.34,materials['naval'],vertices=24)
        for i in range(14):
            xx=x-.39+i*.06;tube_path('reels.winding',[(xx,y+.254*math.cos(j*math.tau/16),z+.254*math.sin(j*math.tau/16)) for j in range(16)],.012,materials['edge'],sides=5,closed=True)
for x in [-48,-44,36,44,49]:
    z=deckz(x);box('deck.hatch-coaming',(x,0,z+.12),(1.1,.82,.22),materials['edge'])
    box('deck.hatch-lid',(x,0,z+.27),(1.15,.87,.08),materials['naval'])
    for y in [-.28,.28]:rod('deck.hatch-handle',(x-.12,y,z+.33),(x+.12,y,z+.33),.021,materials['edge'])
# Fire hoses, gas cylinders and intake banks give the working decks their scale.
for side in [-1,1]:
    for x,sid in [(-29.1,'aft-deckhouse'),(-20.6,'aft-deckhouse'),(10.2,'machinery-deckhouse'),(30.6,'forward-deckhouse')]:
        y=side*(half_width(sid,x)+.05);z=4.2 if x<25 else deckz(x)+.75
        for r in [.17,.22,.27,.32]:
            tube_path('damage-control.hose',[(x+r*math.cos(j*math.tau/24),y+side*.12,z+r*math.sin(j*math.tau/24)) for j in range(24)],.036,materials['canvas'],sides=8,closed=True)
        box('damage-control.hose-rack',(x,y,z+.37),(.55,.27,.08),materials['edge'])
        tube_path('damage-control.nozzle',[(x+.31,y+side*.13,z-.15),(x+.40,y+side*.13,z-.58),(x+.25,y+side*.13,z-.68)],.034,materials['edge'],sides=8)
    for x in [-24.2,14.0]:
        for dx in [-.20,.20]:
            y=side*3.55;z=deckz(x)
            cyl('damage-control.cylinder',(x+dx,y,z+.57),.125,1.14,materials['naval'],vertices=16)
            cyl('damage-control.bottle-shoulder',(x+dx,y,z+1.18),.125,.17,materials['naval'],vertices=16,r2=.045)
            cyl('damage-control.valve',(x+dx,y,z+1.30),.045,.11,materials['bronze'],vertices=12)
        for dz in [.28,.90]:box('damage-control.bottle-band',(x,side*3.68,z+dz),(.66,.05,.07),materials['edge'],bev=.006)
    for x in [3.0,9.9]:
        y=side*(half_width('machinery-deckhouse',x)+.04)
        box('ventilation.machinery-intake',(x,y,4.08),(1.6,.12,1.8),materials['edge'])
        for i in range(14):box('ventilation.intake-louver',(x,y+side*.10,3.31+i*.12),(1.46,.11,.038),materials['naval'],bev=.004)
# Bow ground tackle: twin capstans, chain links, hawse lips and independent anchors.
for side in [-1,1]:
    x,y=47.5,side*1.1;z=deckz(x)
    cyl('anchor.capstan-base',(x,y,z+.17),.52,.28,materials['edge'],vertices=32)
    cyl('anchor.capstan',(x,y,z+.48),.31,.46,materials['naval'],vertices=24)
    cyl('anchor.capstan-top',(x,y,z+.73),.43,.09,materials['edge'],vertices=32)
    for i in range(44):
        xx=47.9+i*.134;yy=side*(1.1+.11*(xx-47.9));zz=deckz(xx)+.10
        pts=[(xx+.10*math.cos(j*math.tau/12),yy+.057*math.sin(j*math.tau/12)*(1 if i%2 else .28),zz+.057*math.sin(j*math.tau/12)*(0 if i%2 else 1)) for j in range(12)]
        tube_path('anchor.chain-link',pts,.021,materials['edge'],sides=6,closed=True)
    xx=53.7;zz=5.35;yy=side*(hull_breadth_at(xx,zz)+.03)
    rod('anchor.hawse',(xx,yy-side*.10,zz),(xx,yy+side*.13,zz),.28,materials['edge'],vertices=24)
    rod('anchor.shank',(xx,yy+side*.16,zz-.10),(xx-.35,yy+side*.18,zz-1.04),.095,materials['edge'],vertices=12)
    rod('anchor.crown',(xx-.7,yy+side*.18,zz-.95),(xx+.08,yy+side*.18,zz-1.16),.11,materials['edge'])
    for dx in [-.66,.02]:mesh('anchor.fluke',[(xx+dx,yy+side*.08,zz-1.1),(xx+dx+.16,yy+side*.32,zz-.50),(xx+dx+.43,yy+side*.10,zz-1.03)],[(0,1,2)],materials['edge'])
# Small jackstaff and stern ensign staff, with rope cleats.
rod('rigging.jackstaff',(57.12,0,deckz(57.12)),(57.12,0,deckz(57.12)+2.6),.028,materials['edge'],r2=.018)
rod('rigging.ensign',(-56.5,0,2.78),(-56.85,0,4.35),.035,materials['edge'],r2=.021)

# Original, handed three-bladed screws. Broad rounded planforms and changing
# pitch replace the narrow strip approximation. All controls below are design
# estimates; All Hands October 1952 p.3 and GameModels rasters are visual evidence,
# not engineering pitch/offset tables. Each blade is a closed, cambered solid.
blade_sections = [(.25,.34),(.44,.88),(.72,1.54),(1.05,1.93),(1.38,2.00),
                  (1.65,1.88),(1.86,1.48),(2.02,.82),(2.10,.012)]
def blade_chord(r):
    # Monotone cubic Hermite interpolation avoids pointed or scalloped lobes.
    if r>2.02:return max(.012,.82*math.sqrt(max(0,(2.10-r)/.08)))
    slopes=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(blade_sections,blade_sections[1:])]
    tangents=[slopes[0]]+[0 if slopes[i-1]*slopes[i]<=0 else 2/(1/slopes[i-1]+1/slopes[i]) for i in range(1,len(slopes))]+[slopes[-1]]
    k=next((i for i in range(len(slopes)) if r<=blade_sections[i+1][0]),len(slopes)-1)
    a,b=blade_sections[k:k+2];d=b[0]-a[0];t=(r-a[0])/d
    return (2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*d*tangents[k]+(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*d*tangents[k+1]

# Underwater appendages measured from GameModels3D pasd021 (runtime z = reference z + 0.466):
# shafts leave the hull through short bossings near z 33, run bare past a single inclined strut at
# z 42 to an A-bracket at z 49.4, and carry 3.9 m screws at z 51.15. Blender x = -runtime z.
def shaft_line(xb):
    z=-xb
    return 2.615+.017*(z-43),-2.87-.0432*(z-43)
SHAFT_FWD,PROP_X,PROP_SCALE=-31.0,-51.15,.93
for side in [-1,1]:
    label='port' if side>0 else 'starboard'
    def sp(xb):
        w,zz=shaft_line(xb);return (xb,side*w,zz)
    rod('shafts.'+label,sp(SHAFT_FWD),sp(PROP_X+.35),.17,materials['edge'],vertices=24)
    # Bossing: faired sleeve from inside the hull to the after bearing.
    rod('shafts.fairing',sp(-28.8),sp(-33.0),.18,materials['underwater'],r2=.36,vertices=32)
    rod('shafts.fairing',sp(-33.0),sp(-36.4),.36,materials['underwater'],r2=.25,vertices=32)
    rod('shafts.'+label+'-bearing',sp(-36.3),sp(-37.2),.26,materials['underwater'],r2=.22,vertices=24)
    for xx,legs in [(-42.2,[1.75]),(-49.7,[2.95,.35])]:
        rod('shafts.'+label+'-bearing',sp(xx+.6),sp(xx-.6),.29,materials['underwater'],vertices=32)
        by=shaft_line(xx)
        for ty in legs:
            # Flared foil-section pylon from the bearing to the shell.
            top=hull_height_at(xx,ty)+.15;bottom=by[1];vs=[];n=20
            for t,chord in [(0,1.15),(.14,.62),(.86,.66),(1,1.1)]:
                for j in range(n):
                    a_=j*math.tau/n
                    vs.append((xx+chord*.5*math.cos(a_),side*(by[0]+(ty-by[0])*t)+.07*math.sin(a_),bottom+(top-bottom)*t))
            fs=[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(3) for j in range(n)]
            fs += [tuple(reversed(range(n))),tuple(3*n+j for j in range(n))]
            mesh('shafts.'+label+'-a-bracket',vs,fs,materials['underwater'],smooth=True)
    pw,pz=shaft_line(PROP_X)
    pivot=empty('propeller-'+label+'.pivot',(PROP_X,side*pw,pz))
    pivot.rotation_euler.y=-math.atan(.0432)
    name='propeller-'+label
    S=PROP_SCALE
    # Turned hub and ogival cap, both coaxial with the sloping shaft.
    profile=[(.65,.16),(.48,.28),(.20,.34),(-.22,.35),(-.48,.27),(-.74,.16),(-1.00,.025)]
    vs=[(x*S,r*S*math.cos(j*math.tau/48),r*S*math.sin(j*math.tau/48)) for x,r in profile for j in range(48)]
    fs=[(i*48+j,i*48+(j+1)%48,(i+1)*48+(j+1)%48,(i+1)*48+j) for i in range(len(profile)-1) for j in range(48)]
    fs += [tuple(reversed(range(48))),tuple((len(profile)-1)*48+j for j in range(48))]
    hub=local(mesh(name+'.hub',vs,fs,materials['bronze'],smooth=True),pivot,name)
    bm=bmesh.new();bm.from_mesh(hub.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(hub.data);bm.free()
    for i in range(3):
        a=math.pi/2+i*math.tau/3;verts=[];nr,nc=33,17
        for face in [-1,1]:
            for k in range(nr):
                r=.25+1.85*(.5-.5*math.cos(math.pi*k/(nr-1)))
                chord=blade_chord(r);pitch=math.atan2(3.8,math.tau*r)
                for j in range(nc):
                    u=-math.cos(math.pi*j/(nc-1));t=u*chord/2+.10*(r/2.1)**2
                    # Lenticular cross section, thick root, fine rounded edges.
                    thick=(.012+.125*(1-r/2.1)**1.4)*math.sqrt(max(0,1-u*u))+.004
                    camber=.038*chord*(1-u*u)
                    x=-t*math.sin(pitch)+.06*r+camber+face*thick/2*math.cos(pitch)
                    tang=t*math.cos(pitch)+face*thick/2*math.sin(pitch)
                    verts.append((x*S,side*(r*math.cos(a)-tang*math.sin(a))*S,(r*math.sin(a)+tang*math.cos(a))*S))
        stride=nr*nc;faces=[]
        for k in range(nr-1):
            for j in range(nc-1):
                n=k*nc+j;faces += [(n,n+nc,n+nc+1,n+1),(stride+n,stride+n+1,stride+n+nc+1,stride+n+nc)]
        edge=list(range(nc))+[k*nc+nc-1 for k in range(1,nr)]+[(nr-1)*nc+j for j in range(nc-2,-1,-1)]+[k*nc for k in range(nr-2,0,-1)]
        faces += [(n,edge[(j+1)%len(edge)],stride+edge[(j+1)%len(edge)],stride+n) for j,n in enumerate(edge)]
        blade=local(mesh(name+'.blade-'+str(i+1),verts,faces,materials['bronze'],smooth=True),pivot,name)
        bm=bmesh.new();bm.from_mesh(blade.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(blade.data);bm.free()
    # Bilge keel: a tapered plate on the turn of the bilge, normal to the shell, z -22..17.
    vv=[]
    for xb in [22.0,20.5]+[x*1.0 for x in range(18,-16,-3)]+[-16.5,-17.0]:
        pts=None
        for a_,b_ in zip(h['sections'],h['sections'][1:]):
            if a_['station']<=xb+half<=b_['station']:
                t=(xb+half-a_['station'])/(b_['station']-a_['station'])
                pts=[(w+(v-w)*t,y+(q-y)*t) for (w,y),(v,q) in zip(a_['points'],b_['points'])]
        root=min(pts,key=lambda p:abs((p[0]/max(1e-6,max(w for w,_ in pts)))-.86)+abs(p[1]-(pts[0][1]+.9)))
        depth=.45*min(1,(22.0-xb)/2.2,(xb+17.0)/2.2)
        nrm=Vector((1,-1)).normalized()
        vv += [(xb,side*(root[0]-.03),root[1]+.03),(xb,side*(root[0]+nrm.x*depth),root[1]+nrm.y*depth)]
    mesh('hull.bilge-keel',vv,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(vv)//2-1)],materials['underwater'])
# Skeg: a tapered centreline fin from z 22 to its raked after edge at z 39.7-40.5.
def keel_at(xb):
    return interp(h['keelHeights'],xb+half)
vs=[];rows=0
for xb in [-22.0,-24.0,-26.0,-28.0,-30.0,-32.0,-34.0,-36.0,-38.0,-39.78]:
    k=keel_at(xb)+.12
    vs += [(xb,-.30,k),(xb,-.19,-3.79),(xb,.19,-3.79),(xb,.30,k)];rows+=1
k=keel_at(-40.55)+.12
vs += [(-40.55,-.22,k),(-40.55,-.14,k-.05),(-40.55,.14,k-.05),(-40.55,.22,k)];rows+=1
fs=[(i*4+j,(i+1)*4+j,(i+1)*4+j+1,i*4+j+1) for i in range(rows-1) for j in range(3)]
fs += [(0,1,2,3),tuple((rows-1)*4+j for j in [3,2,1,0])]
mesh('hull.skeg',vs,fs,materials['underwater'])
# QC sonar dome under the forefoot, z -42.96..-41.43, 0.77 m deep.
vs=[];n=16;prof=[(41.40,.05),(41.47,.6),(41.65,.93),(42.2,1.0),(42.75,.93),(42.92,.6),(42.99,.05)]
for xb,f in prof:
    for j in range(n):
        a_=j*math.tau/n;yy=.21*f*math.cos(a_);zz=-3.80-.39*f+.39*f*math.sin(a_)
        vs.append((xb,yy,min(-3.72,zz)))
fs=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(prof)-1) for j in range(n)]
fs += [tuple(reversed(range(n))),tuple((len(prof)-1)*n+j for j in range(n))]
mesh('hull.sonar-dome',vs,fs,materials['underwater'],smooth=True)
# Rudder: one broad blade, leading edge raked forward to the counter, trailing edge vertical.
# Propeller guards: a bar just above the waterline over each screw, on struts to the deck edge.
for side in [-1,1]:
    guard=[(-48.6,hull_breadth_at(-48.6,1.45)-.05),(-49.5,4.78),(-50.4,5.08),(-51.0,5.16),(-51.6,5.06),(-52.3,hull_breadth_at(-52.3,1.45)-.05)]
    tube_path('hull.propeller-guard',[(x,side*w,1.45) for x,w in guard],.07,materials['naval'],sides=10)
    for x,w in guard[1:-1]:
        rod('hull.propeller-guard-strut',(x,side*w,1.45),(x,side*(hull_breadth_at(x,2.45)-.03),2.45),.05,materials['naval'],vertices=8)
rudder=empty('rudder.pivot',(-53.0,0,-1.35))
top_f=hull_height_at(-52.0,0)+.18;top_a=hull_height_at(-55.6,0)+.18
rv=[(-52.0,-.33,top_f),(-52.62,-.20,-4.36),(-55.5,-.20,-4.36),(-55.67,-.30,top_a),
    (-52.0,.33,top_f),(-52.62,.20,-4.36),(-55.5,.20,-4.36),(-55.67,.30,top_a)]
attach(mesh('rudder.blade',rv,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materials['underwater']),rudder)
attach(rod('rudder.stock',(-53.0,0,-4.2),(-53.0,0,top_f+.1),.16,materials['underwater'],vertices=16),rudder)

# Shared catalog and joint contract, with Fletcher-specific original Mk30 surface detail.
for mount in definition['mounts']:
    before=set(col.objects)
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
    if mount['battery']!='main':continue
    name=mount['id'];yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    recoil=next(o for o in col.objects if o.get('nodeId')==name+'.center.recoil')
    spec=mount['weapon'];H=spec['gunhouseSize'][2]
    elevation=next(o for o in col.objects if o.get('nodeId')==name+'.center.elevation')
    # Keep catalog joints/sockets; replace generic surface details and barrel only.
    for o in list(recoil.children):
        if o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
    for o in set(col.objects)-before:
        if o.type=='MESH' and 'roof hatch' in o.name:bpy.data.objects.remove(o,do_unlink=True)
    house=next(o for o in set(col.objects)-before if o.type=='MESH' and 'sloped gunhouse' in o.name)
    bevel=house.modifiers.new('Mk30 rolled plate edges','BEVEL');bevel.width=.035;bevel.segments=3
    # Curved elevating shield slides inside the catalog's actual central recess.
    # It follows elevation, while the gun and weather sleeve also follow recoil.
    vs=[];n=49
    for y in [-.355,.355]:
        vs.append((0,y,0))
        for i in range(n):
            a=math.radians(-78+190*i/(n-1));vs.append((.99*math.cos(a),y,.99*math.sin(a)))
    fs=[]
    for i in range(1,n):
        fs += [(0,i+1,i),(n+1,n+1+i,n+2+i),(i,i+1,n+2+i,n+1+i)]
    fs += [(0,1,n+2,n+1),(0,n+1,2*n+1,n)]
    shield=local(mesh(name+'.elevating-shield',vs,fs,materials['naval']),elevation,name)
    for i,p in enumerate(shield.data.polygons):p.use_smooth=i%3==2 and i<3*(n-1)
    bm=bmesh.new();bm.from_mesh(shield.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(shield.data);bm.free()
    # Original elliptical fabric sleeve, with a rolled retaining ring.
    sections=[(.66,.32,.36),(.90,.36,.38),(1.18,.31,.28),(1.40,.22,.19),(1.53,.155,.155)]
    vs=[(x,ry*math.cos(j*math.tau/32),rz*math.sin(j*math.tau/32)) for x,ry,rz in sections for j in range(32)]
    fs=[(k*32+j,k*32+(j+1)%32,(k+1)*32+(j+1)%32,(k+1)*32+j) for k in range(len(sections)-1) for j in range(32)]
    local(mesh(name+'.weather-sleeve',vs,fs,materials['canvas'],smooth=True),recoil,name)
    length=spec['muzzleForward']-spec['trunnionForward']
    for a,b,r0,r1 in [(1.49,1.60,.156,.148),(1.60,2.05,.148,.125),(2.05,length,.125,.079)]:
        local(rod(name+'.barrel',(a,0,0),(b,0,0),r0,materials['edge'],r2=r1,vertices=32),recoil,name)
    local(rod(name+'.bore',(length+.002,0,0),(length+.012,0,0),spec['caliberM']/2,materials['dark'],vertices=32),recoil,name)
    for side in [-1,1]:
        y=side*1.503
        # Long side grab rails, short rear grab, and the pair of sight shutters.
        for a,b,z in [(-1.9,.28,1.02),(-2.55,-1.94,2.20)]:
            local(rod(name+'.side-handhold',(a,y,z),(b,y,z),.019,materials['edge']),yaw,name)
            for x in [a,b]:local(rod(name+'.handhold-standoff',(x,side*1.48,z),(x,y,z),.022,materials['edge']),yaw,name)
        shutter=local(box(name+'.sight-shutter',(.67,side*.91,2.72),(.12,.57,.28),materials['naval'],bev=.025),yaw,name)
        shutter.rotation_euler.y=math.radians(31)
        local(tube_path(name+'.gunport-guide',[(-.25,side*.44,3.09),(.50,side*.44,2.94),(1.39,side*.44,1.65)],.025,materials['edge']),yaw,name)
        deflector=local(box(name+'.gunport-deflector',(1.12,side*.51,2.08),(.10,.23,.49),materials['naval'],bev=.018),yaw,name)
        deflector.rotation_euler.y=math.radians(31)
        # Rear access doors sit on the rear face, not on the uninterrupted sides.
        local(box(name+'.rear-door',(-2.841,side*.68,1.69),(.045,.89,1.88),materials['naval'],bev=.06),yaw,name)
        for z in [.94,2.30]:local(rod(name+'.rear-door-hinge',(-2.89,side*1.04,z-.09),(-2.89,side*1.04,z+.09),.026,materials['edge']),yaw,name)
        local(rod(name+'.rear-door-handle',(-2.91,side*.35,1.55),(-2.91,side*.35,1.76),.022,materials['edge']),yaw,name)
        local(tube_path(name+'.roof-grab',[(-2.59,side*.91,3.15),(-2.59,side*.91,3.30),(-2.22,side*.91,3.30),(-2.22,side*.91,3.20)],.024,materials['edge']),yaw,name)
        local(box(name+'.front-step',(1.38,side*.83,.42),(.31,.62,.23),materials['naval'],bev=.016),yaw,name)
        local(tube_path(name+'.step-handle',[(1.52,side*.61,.45),(1.52,side*.61,.67),(1.52,side*1.04,.67),(1.52,side*1.04,.45)],.020,materials['edge']),yaw,name)
    for z in [.70,1.06,1.42,1.78,2.14,2.50,2.86]:
        local(rod(name+'.rear-ladder',(-2.93,-.23,z),(-2.93,.23,z),.021,materials['edge']),yaw,name)
        for side in [-1,1]:local(rod(name+'.ladder-foot',(-2.93,side*.23,z),(-2.80,side*.23,z),.020,materials['edge']),yaw,name)
    # Low aft equipment blister and visible train-ring fasteners.
    local(box(name+'.rear-equipment',(-2.95,0,.92),(.32,.95,.86),materials['naval'],bev=.05),yaw,name)
    for i in range(24):
        a=i*math.tau/24
        local(cyl(name+'.train-ring-bolt',(1.32*math.cos(a),1.32*math.sin(a),.295),.026,.06,materials['edge'],vertices=6),yaw,name)
    # Open mount-captain sight is a ring on a bracket, not a roof hatch.
    local(box(name+'.sight-bracket',(-1.84,-.56,3.36),(.13,.15,.31),materials['naval'],bev=.012),yaw,name)
    local(tube_path(name+'.sight-ring',[(-1.84,-.56+.145*math.cos(i*math.tau/32),3.66+.145*math.sin(i*math.tau/32)) for i in range(32)],.012,materials['edge'],closed=True),yaw,name)
    local(rod(name+'.sight-crosshair',(-1.84,-.705,3.66),(-1.84,-.415,3.66),.008,materials['edge']),yaw,name)
    local(rod(name+'.sight-crosshair',(-1.84,-.56,3.515),(-1.84,-.56,3.805),.008,materials['edge']),yaw,name)

# Small 445 bow numbers. Original vector strokes, not text or imagery from a reference.
digits={'4': [[(0,.9),(0,.45),(.5,.45)],[(.38,.9),(.38,0)]],
        '5': [[(.5,.9),(0,.9),(0,.48),(.43,.48),(.5,.35),(.5,.10),(.39,0),(0,0)]]}
for side in [-1,1]:
    for j,d in enumerate('445'):
        for stroke in digits[d]:
            points=[]
            for u,v in stroke:
                x=49.4+j*.62+u if side<0 else 51.15-(j*.62+u)
                z=4.02+v*.62;points.append((x,side*(hull_breadth_at(x,z)+.026),z))
            tube_path('markings.bow-number',points,.027,materials['white'],sides=6)

# Independently generated paint: broad Measure-12-inspired fields, subtle plate
# variation and salt staining. All pixels originate here; no photograph is baked.
# Packed standard image + UV maps keep the Blender and glTF materials identical.
wtex,htex=2048,512
pixels=array('f')
for j in range(htex):
    z=-4.4+j/(htex-1)*21.0
    for i in range(wtex):
        x=-half+i/(wtex-1)*h['length']
        field=math.sin(x*.31+z*.91)+.50*math.sin(x*.73-z*1.45)+.25*math.sin(x*1.2+z*.65)
        if z<-.24:
            base=(.25,.061,.042)
        elif z<.14:
            base=(.032,.046,.055)
        elif z<4.85:
            base=(.20,.255,.30) if field>.10 else (.31,.36,.39)
        else:
            base=(.33,.38,.405) if field>-.27 else (.47,.50,.50)
        panel=(.985+.018*math.sin(math.floor((x+half)/3.1)*2.91+math.floor(z/.85)*1.63))
        grain=(math.sin(i*12.99+j*78.233)*43758.5453)%1
        streak=max(0,math.sin(x*6.4+.3*math.sin(x*3.2)))**16*.035*max(0,1-abs(z-2.3)/4)
        fade=.022*math.exp(-abs(z-.16)*2.6)
        pixels.extend([max(.003,min(1,c*panel+(grain-.5)*.012-streak+fade)) for c in base]+[1])
paint=bpy.data.images.new('Fletcher original naval paint',width=wtex,height=htex,alpha=False)
paint.colorspace_settings.name='Non-Color';paint.pixels.foreach_set(pixels);paint.pack()
for key in ['naval','hullgray']:
    mat=materials[key];node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=paint;node.interpolation='Linear';node.extension='EXTEND'
    # Some original fittings have other UV layers. Bind the authored paint map
    # explicitly so export never falls back to an unrelated active layer.
    uv_node=mat.node_tree.nodes.new('ShaderNodeUVMap');uv_node.uv_map='OriginalPaintUV'
    mat.node_tree.links.new(uv_node.outputs['UV'],node.inputs['Vector'])
    mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
bpy.context.view_layer.update()
for o in col.objects:
    if o.type!='MESH' or not any(m in [materials['naval'],materials['hullgray']] for m in o.data.materials):continue
    uv=o.data.uv_layers.new(name='OriginalPaintUV')
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            p=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
            # Same authored colour fields on both sides; port/starboard pattern evidence remains open.
            uv.data[li].uv=((p.x+half)/h['length'],(p.z+4.4)/21.0)
# Recalculate consistently wound original faces for one-sided glTF materials.
for o in col.objects:
    if o.type=='MESH':
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
scene['definitionHash']=definition['contentHash'];scene['authoringRevision']=3
scene['referenceBoundary']='Original blueprint / catalog / recipe only; reference rasters used for human review.'
from blender_rig import create_flagstaffs
create_flagstaffs(definition)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
print('FLETCHER REVISION 3',len(col.objects),'original objects',flush=True)
