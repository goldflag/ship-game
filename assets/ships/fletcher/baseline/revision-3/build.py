"""Fletcher revision 3: original reference-led, blueprint-driven ship authoring.

Axes are metres, +X bow, +Y port, +Z up, waterline Z=0. The July 1942
Bureau of Ships photographs and ONI recognition drawings were interpreted by
hand. GameModels3D is a raster comparison only; this recipe reads no reference
images, external meshes, attachment transforms or textures. See reports/shape-correction.md.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
from array import array
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/ships'))
from blender_components import create_gun_mount

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
    for side in [-1,1]:rod(name+'.rail',a+Vector((0,side*w/2,0)),b+Vector((0,side*w/2,.65)),.026,materials['edge'],vertices=8)
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
    outline=[(x-w/2,z+.12),(x-w/2+.12,z),(x+w/2-.12,z),(x+w/2,z+.12),(x+w/2,z+h-.12),(x+w/2-.12,z+h),(x-w/2+.12,z+h),(x-w/2,z+h-.12)]
    o=mesh(name+'.gasket',[(a,y,b) for a,b in outline],[tuple(range(8))],materials['dark'])
    mesh(name+'.leaf',[(x+(a-x)*.92,y+side*.028,z+h/2+(b-z-h/2)*.97) for a,b in outline],[tuple(range(8))],materials['naval'])
    for dz in [.35,1.15]:
        rod(name+'.hinge',(x-w/2+.06,y+side*.075,z+dz-.1),(x-w/2+.06,y+side*.075,z+dz+.1),.028,materials['edge'])
        box(name+'.dog',(x+w*.33,y+side*.065,z+dz),(.14,.06,.035),materials['edge'],bev=.005)
    rod(name+'.handle',(x+w*.28,y+side*.12,z+.72),(x+w*.28,y+side*.12,z+.9),.021,materials['edge'])

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
# A cambered steel deck, separate from the hull's closed CPU surface.
verts=[]
for s,w in h['halfBreadths']:
    x=s-half;z=deckz(x)+.018
    verts += [(x,-w,z),(x,0,z+.07),(x,w,z)]
mesh('deck.main',verts,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(h['halfBreadths'])-1) for j in range(2)],materials['deck'])
# Low sheer strake, weld seams and a narrow waterways gutter.
for side in [-1,1]:
    edge=[(s-half,side*max(.005,w-.065),deckz(s-half)+.06) for s,w in h['halfBreadths'] if .5<s<114.3]
    tube_path('hull.sheer-strake',edge,.052,materials['edge'],sides=8)
    for z in [.55,1.8]:
        seam=[(s-half,side*(hull_breadth_at(s-half,z)+.006),z) for s,w in h['halfBreadths'] if 5<s<103]
        # Flush plate seams are fine; no oversized decorative armor belts.
        tube_path('hull.plate-seam',seam,.009,materials['wear'],sides=5)
    railpts=[(s-half,side*max(.05,w-.16),deckz(s-half)+.05) for s,w in h['halfBreadths'] if 2<s<113.7]
    rails('rails.perimeter',railpts)

# Structural footprints remain the same source for visible deckhouses and CPU hits.
structures={s['id']:s for s in definition['structures']}
for s in definition['structures']:
    if 'funnel' in s['id']:continue
    outline=[(-z,-x) for x,z in s['footprint']]
    ob=prism(s['id']+'.walls',outline,s['baseY'],s['baseY']+s['height'])
    if s['id'] in ['bridge','pilot-house']:
        for poly in list(ob.data.polygons)[:-2]:poly.use_smooth=True
    z=s['baseY']+s['height'];tube_path(s['id']+'.deck-edge',[(x,y,z+.025) for x,y in outline],.055,materials['edge'],closed=True)
    # Side access, coamings, ventilation grilles and firefighting equipment.
    if s['id'] in ['forward-deckhouse','aft-deckhouse','machinery-deckhouse']:
        xmin=min(p[0] for p in outline);xmax=max(p[0] for p in outline);w=max(p[1] for p in outline)
        for side in [-1,1]:
            for i in range(int((xmax-xmin)/3.2)):
                x=xmin+1.45+i*3.2;yy=side*(w+.028);base=max(s['baseY']+.12,deckz(x)+.12)
                if i%3!=2:door(s['id']+'.door',x,yy,base,side)
                else:
                    box(s['id']+'.vent',(x,yy+side*.055,base+1.25),(.65,.1,.65),materials['edge'],bev=.025)
                    for j in range(6):box(s['id']+'.louver',(x,yy+side*.115,base+1.0+j*.09),(.56,.065,.035),materials['naval'],bev=.004)
                if i%2==0:
                    portlight(s['id']+'.porthole',(x+.95,yy,base+1.45),(0,side,0),.15)
                    rod(s['id']+'.fire-main',(x-.55,yy+side*.06,base+.20),(x+1.9,yy+side*.06,base+.20),.025,materials['edge'])
            tube_path(s['id']+'.cable-run',[(xmin+.8,side*(w+.03),z-.32),(xmax-.8,side*(w+.03),z-.32)],.023,materials['edge'])

# The rounded bridge front remains continuous through both full-height tiers.
# Broad stepped navigation wings and an overhanging flying bridge establish its
# mass; their decks and openings are independently authored from raster review.
pilot=structures['pilot-house'];pilot_base=pilot['baseY'];pilot_top=pilot_base+pilot['height']
for side in [-1,1]:
    wing=outline_oval(24.5,side*3.65,1.76,1.40,40)
    prism('bridge.aa-wing',wing,6.94,7.12)
    bulwark('bridge.aa-shield',wing,7.12,.80)
    for x in [23.4,25.6]:
        mesh('bridge.wing-knee',[(x,side*3.25,6.99),(x,side*4.80,6.99),(x,side*3.25,5.65)],[(0,1,2)],materials['naval'])
    wing=[(15.45,side*2.70),(15.45,side*4.76),(16.22,side*5.12),
          (19.60,side*5.12),(20.16,side*4.86),(22.16,side*4.86),(23.27,side*2.70)]
    prism('bridge.navigation-wing',wing,pilot_base-.15,pilot_base)
    bulwark('bridge.navigation-shield',wing[1:],pilot_base,1.27,closed=False)
    for x in [16.3,19.8,22.0]:
        mesh('bridge.navigation-knee',[(x,side*2.70,pilot_base),(x,side*4.83,pilot_base),(x,side*2.70,8.17)],[(0,1,2)],materials['naval'])
    stairs('bridge.access',(12.85,side*3.63,deckz(12.85)+.10),(16.65,side*3.63,7.08))
    stairs('bridge.upper-access',(16.1,side*3.73,7.1),(18.85,side*3.73,pilot_base),.56)
    # Bridge-wing portlights and visible lower chart-house doors.
    portlight('bridge.wing-port',(17.60,side*5.15,pilot_base+.53),(0,side,0),.17)
    door('bridge.chart-door',17.0,side*2.68,7.20,side,w=.65,h=1.58)
# Windows follow the actual full-width pilot footprint, not a narrower upper drum.
for i in range(13):
    a=-math.pi*.47+i*math.pi*.94/12
    p=(21.05+3.575*math.cos(a),2.745*math.sin(a),10.68)
    normal=Vector((math.cos(a)/3.55,math.sin(a)/2.72,0)).normalized()
    portlight('bridge.navigation-window',p,normal,.185)
for side in [-1,1]:
    for x in [16.8,18.0,19.3]:portlight('bridge.side-window',(x,side*2.745,10.68),(0,side,0),.185)
    portlight('bridge.lower-port',(20.0,side*2.68,8.63),(0,side,0),.19)
upper=[(-z,-x) for x,z in pilot['footprint']]
visor=[(20.6+(x-20.6)*1.025,y*1.07) for x,y in upper]
prism('bridge.visor',visor,pilot_top-.025,pilot_top+.10,materials['roof'])
flying=[(20.6+(x-20.6)*1.025,y*1.16) for x,y in upper]
prism('bridge.flying-deck',flying,pilot_top+.08,pilot_top+.18,materials['roof'])
bulwark('bridge.flying-shield',flying,pilot_top+.18,.74)
for side in [-1,1]:
    # Open forward observation lobes give the upper bridge its broad outline.
    observation=outline_oval(22.0,side*2.60,1.10,.58,36)
    prism('bridge.observation-deck',observation,pilot_top+.08,pilot_top+.18,materials['roof'])
    bulwark('bridge.observation-shield',[(22.0+1.10*math.cos(i*math.pi/24),side*(2.60+.58*math.sin(i*math.pi/24))) for i in range(25)],pilot_top+.18,.74,closed=False)
    cyl('bridge.pelorus',(22.0,side*2.60,pilot_top+.57),.13,.74,materials['edge'])
    box('bridge.pelorus-head',(22.0,side*2.60,pilot_top+.97),(.28,.25,.16),materials['naval'])
    rod('bridge.voice-pipe',(18.7,side*2.25,pilot_top+.22),(18.7,side*2.25,pilot_top+.87),.045,materials['edge'])
    x,y,z=16.80,side*4.55,pilot_base+.87
    cyl('bridge.signal-pedestal',(x,y,z),.14,.66,materials['naval'])
    rod('bridge.signal-yoke',(x,y-.30,z+.3),(x,y+.30,z+.3),.035,materials['edge'])
    rod('bridge.signal-light',(x-.18,y,z+.56),(x+.22,y,z+.56),.24,materials['naval'],vertices=24)
    rod('bridge.signal-lens',(x+.221,y,z+.56),(x+.235,y,z+.56),.205,materials['glass'],vertices=24)

# Mk 37 director: rounded base, original faceted enclosure, rangefinder and Mk 4 grid.
director_before=set(col.objects)
cyl('director.pedestal',(20.15,0,10.92),1.24,2.04,materials['naval'],vertices=48)
for z in [10.05,11.5,11.91]:cyl('director.band',(20.15,0,z),1.285,.075,materials['edge'],vertices=48)
director_outline=outline_rect(18.3,21.65,-1.45,1.45,.40)
prism('director.housing',director_outline,11.95,13.72)
# Chamfered roof cap breaks the otherwise block-like outline.
capverts=[(x,y,13.68) for x,y in director_outline]+[(19.95+(x-19.95)*.87,y*.88,14.03) for x,y in director_outline]
mesh('director.shoulders',capverts,[(i,(i+1)%8,8+(i+1)%8,8+i) for i in range(8)]+[tuple(range(8,16))],materials['naval'])
rod('director.rangefinder',(19.8,-2.18,12.98),(19.8,2.18,12.98),.24,materials['edge'],vertices=24)
for side in [-1,1]:
    box('director.optical-hood',(19.8,side*2.14,13.0),(.65,.45,.60),materials['naval'],bev=.13)
    portlight('director.optical-lens',(20.14,side*2.14,13.01),(1,0,0),.15)
    ladder('director.ladder',(18.1,side*1.5,9.9),(18.1,side*1.5,13.55),.43)
for y in [-.65,0,.65]:portlight('director.front-glass',(21.68,y,13.3),(1,0,0),.18)
# Early-war director mattress antenna, with shallow curved face, not a modern dish.
for side in [-1,1]:rod('director.radar-support',(19.6,side*.7,13.95),(20.0,side*.8,15.05),.055,materials['edge'])
for z in [14.75,15.12,15.5,15.88]:
    tube_path('director.radar-horizontal',[(20.45-.26*(y/1.65)**2,y,z) for y in [-1.65,-1.32,-.99,-.66,-.33,0,.33,.66,.99,1.32,1.65]],.021,materials['edge'],sides=6)
for i in range(15):
    y=-1.65+i*3.3/14;x=20.45-.26*(y/1.65)**2
    rod('director.radar-vertical',(x,y,14.75),(x,y,15.88),.019,materials['edge'],vertices=6)
for side in [-1,1]:rod('director.radar-brace',(19.65,0,14.25),(20.18,side*1.65,15.88),.029,materials['edge'])

for part in set(col.objects)-director_before:part.location.z+=1.38

# Raked elliptical funnels with rolled, sloping open caps. Heights derive from the blueprint.
for s in definition['structures']:
    if 'funnel' not in s['id']:continue
    name=s['id'];outline=[(-z,-x) for x,z in s['footprint']]
    cx=sum(x for x,y in outline)/len(outline);ry=max(y for x,y in outline);rx=(max(x for x,y in outline)-min(x for x,y in outline))/2
    base=s['baseY'];height=s['height'];n=64
    def ring(t,scale=1,zoff=0):
        return [(cx-.15*height*t+rx*scale*math.cos(i*math.tau/n),ry*scale*math.sin(i*math.tau/n),base+height*t+zoff+.90*math.cos(i*math.tau/n)*t*t+.30*math.sin(i*math.tau/n)**2*t**5) for i in range(n)]
    rings=[ring(t,scale) for t,scale in [(0,1.03),(.14,1),(.79,.94),(1,.82)]]
    o=mesh(name+'.jacket',[v for row in rings for v in row],[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)],materials['naval'],smooth=True)
    top=ring(1,.82);inside=ring(1,.72,-.08);deep=ring(.90,.72,-.12)
    mesh(name+'.cap-interior',top+inside+deep,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n+(i+1)%n,2*n+i) for i in range(n)]+[tuple(range(n*2,n*3))],materials['dark'],smooth=True)
    for t,sc in [(.13,1.015),(.79,.95),(1,.835)]:tube_path(name+'.rolled-band',ring(t,sc),.065 if t!=.13 else .05,materials['edge'],closed=True)
    for y in [-.85,0,.85]:
        xx=cx-.15*height;zz=base+height-.12
        rod(name+'.cap-grille',(xx-rx*.61,y,zz-.65),(xx+rx*.61,y,zz+.65),.042,materials['edge'])
    # Steam pipes follow the casing's rake, with separate elbows and supports.
    for side in [-1,1]:
        for offset in [-.50,.43]:
            path=[(cx+offset,side*(ry+.18),base),(cx+offset-.15*(height-.1),side*(ry*.85+.16),base+height-.1),(cx+offset-.15*(height-.1)+.14,side*(ry*.85+.16),base+height+.27)]
            tube_path(name+'.steam-pipe',path,.082,materials['edge'],sides=12)
            for t in [.2,.5,.8]:
                p=Vector(path[0]).lerp(Vector(path[1]),t);rod(name+'.pipe-clip',p,(p.x,p.y-side*.22,p.z),.03,materials['naval'])
        # Narrow maintenance walkway, external ladder, whistle and guardrail.
        x=cx-rx-.18
        ladder(name+'.access-ladder',(x,side*.65,base),(x-.15*height,side*.65,base+height-.25),.45)
    cat=outline_oval(cx-.15*height*.27,0,rx+1.0,ry+.6,40)
    prism(name+'.maintenance-platform',cat,base+height*.27-.10,base+height*.27,materials['roof'])
    rails(name+'.maintenance-rails',[(x,y,base+height*.27) for x,y in cat],.75,True)
    # Guy wires and external jacket seams stay thin at game scale.
    for side in [-1,1]:
        for dx in [-3,3]:rod(name+'.guy',(cx-.15*height,side*ry,base+height-.4),(cx+dx,side*2.75,5.30),.013,materials['dark'],vertices=6)
        rod(name+'.whistle',(cx-.5,side*(ry+.30),base+height-2.0),(cx-.5,side*(ry+.30),base+height-1.45),.10,materials['bronze'],vertices=12)

# Raked pole mast with a wider lower casing, aligned behind the bridge.
rod('mast.fore',(16.4,0,7.05),(15.0,0,25.05),.29,materials['naval'],r2=.095,vertices=24)
rod('mast.top',(15.0,0,25.05),(14.91,0,26.35),.067,materials['edge'],r2=.033)
rod('mast.yard',(15.37,-4.05,21.65),(15.37,4.05,21.65),.078,materials['edge'])
for side in [-1,1]:
    rod('mast.yard-brace',(15.26,0,23.0),(15.37,side*4.05,21.65),.036,materials['edge'])
    for y in [1.2,2.4,3.7]:
        tube_path('rigging.signal-halyard',[(15.37,side*y,21.65),(16.2,side*(2.6+y*.19),10.30)],.009,materials['rope'],sides=5)
    rod('rigging.fore-stay',(15.02,0,24.7),(30,side*2.65,7.15),.014,materials['dark'],vertices=6)
    rod('rigging.aft-stay',(15.02,0,24.7),(-22.6,side*.45,15.9),.014,materials['dark'],vertices=6)
ladder('mast.rungs',(16.14,0,8.7),(15.10,0,24.6),.38)
# A small working platform and open supports, below the yard.
platform=outline_rect(15.30,17.0,-1.0,1.0,.25)
prism('mast.working-platform',platform,13.20,13.30,materials['roof'])
rails('mast.working-rail',[(x,y,13.3) for x,y in platform],.78,True,1.4)
for z in [24.55,24.90,25.25]:rod('radar.sc-horizontal',(15.04,-1.6,z),(15.04,1.6,z),.023,materials['edge'],vertices=6)
for i in range(10):
    y=-1.6+i*3.2/9;rod('radar.sc-vertical',(15.04,y,24.55),(15.04,y,25.25),.022,materials['edge'],vertices=6)
rod('radar.sc-support',(15.1,0,24.05),(15.04,0,25.30),.048,materials['edge'])
rod('radar.sg-boom',(15.22,0,22.6),(16.15,0,22.6),.05,materials['edge'])
box('radar.sg-head',(16.15,0,23.0),(.22,.65,.18),materials['naval'])
rod('mast.aft',(-22.1,0,5.7),(-22.65,0,16.20),.095,materials['edge'],r2=.028)
rod('mast.aft-yard',(-22.55,-1.75,13.9),(-22.55,1.75,13.9),.037,materials['edge'])
for side in [-1,1]:
    rod('rigging.wireless',(15.08,side*.45,23.4),(-22.6,side*.5,15.9),.010,materials['dark'],vertices=6)
    rod('rigging.aft-downlead',(-22.6,side*.5,15.9),(-34,side*2.2,5.80),.011,materials['dark'],vertices=6)

# Original articulated quintuple torpedo banks, above the machinery deckhouse.
for launcher in definition['torpedoLaunchers']:
    a,b,c=launcher['position'];x,y,z=-c,-a,b;name=launcher['id']
    cyl(name+'.fixed-race',(x,y,z+.13),1.43,.26,materials['edge'],vertices=64)
    for i in range(24):
        t=i*math.tau/24;cyl(name+'.race-bolt',(x+1.29*math.cos(t),y+1.29*math.sin(t),z+.28),.035,.055,materials['wear'],vertices=6)
    pivot=empty(name+'.yaw',(x,y,z))
    before=set(col.objects)
    prism(name+'.training-platform',outline_rect(x-3.25,x+3.25,y-1.86,y+1.86,.3),z+.28,z+.45,materials['roof'])
    for dx in [-2.25,0,2.25]:box(name+'.transverse-saddle',(x+dx,y,z+.64),(.23,3.32,.36),materials['edge'])
    for tube in [t for t in definition['torpedoTubes'] if t['launcherId']==name]:
        a,b,c=tube['position'];m=Vector((-c,-a,b));rear=m-Vector((7.1,0,0))
        rod(name+'.launch-tube',rear,m,.315,materials['naval'],vertices=32)
        # Distinct breach end caps, bands, rails, compressed-air piping and release rods.
        rod(name+'.breech',rear-Vector((.085,0,0)),rear+Vector((.05,0,0)),.345,materials['edge'],vertices=32)
        rod(name+'.door',rear-Vector((.10,0,0)),rear-Vector((.115,0,0)),.29,materials['naval'],vertices=24)
        rod(name+'.mouth',m+Vector((.002,0,0)),m+Vector((.018,0,0)),.279,materials['dark'],vertices=32)
        for dx in [.12,1.5,3.1,4.8,6.7]:
            p=m-Vector((dx,0,0));rod(name+'.tube-band',p-Vector((.04,0,0)),p+Vector((.04,0,0)),.336,materials['edge'],vertices=24)
        rod(name+'.guide-rail',rear+Vector((.2,0,.31)),m+Vector((-.25,0,.31)),.026,materials['edge'],vertices=8)
        rod(name+'.air-line',rear+Vector((.3,.29,.16)),m+Vector((-1,.29,.16)),.025,materials['edge'],vertices=8)
        for dx in [-2.9,-1.4,0,1.4,2.9]:box(name+'.tube-bracket',(x+dx,m.y,m.z+.34),(.12,.29,.09),materials['naval'],bev=.008)
        socket=empty(tube['id']+'.muzzle',m);attach(socket,pivot)
    # A protected trainer's station above the rear centre tubes, with wheel and sight.
    cyl(name+'.trainer-cabin',(x-2.35,y,z+1.72),.62,1.5,materials['naval'],vertices=32)
    cyl(name+'.trainer-roof',(x-2.35,y,z+2.51),.65,.075,materials['roof'],vertices=32)
    portlight(name+'.trainer-port',(x-1.715,y,z+2.12),(1,0,0),.11)
    tube_path(name+'.handwheel',[(x-1.95,y+.70+.20*math.cos(i*math.tau/24),z+1.9+.20*math.sin(i*math.tau/24)) for i in range(24)],.025,materials['edge'],closed=True)
    for dx in [-2.4,2.4]:
        for side in [-1,1]:rod(name+'.guard',(x+dx,y+side*1.82,z+.46),(x+dx,y+side*1.82,z+.94),.021,materials['edge'])
    for piece in set(col.objects)-before:
        if piece.type=='MESH':attach(piece,pivot)

# High 'sky top' aft twin 40 mm position, supported over the after deckhouse.
aa=next(m for m in definition['mounts'] if m['id']=='bofors-aft');aa_x=-aa['position'][2];aa_z=aa['position'][1]
platform=outline_oval(aa_x,0,2.55,2.30,48)
prism('aa-platform.deck',platform,aa_z-.15,aa_z,materials['roof']);bulwark('aa-platform.shield',platform,aa_z,.74)
ladder('aa-platform.ladder',(aa_x+2.2,0,5.7),(aa_x+2.2,0,aa_z),.62)
for side in [-1,1]:
    locker('aa-platform.ready-locker',(aa_x,side*2.62,6.05),(1.6,.65,.70))
# The four waist Oerlikons occupy real cut-outs alongside the machinery house.
for mount in [m for m in definition['mounts'] if m['id'].startswith('oerlikon') and m['id'] not in ['oerlikon-1','oerlikon-2']]:
    a,z,c=mount['position'];x,y=-c,-a;side=1 if y>0 else -1
    shape=outline_oval(x,y,1.38,1.0,36)
    prism('aa-waist.platform',shape,z-.10,z,materials['roof'])
    # Open inboard for access; shield faces the sea.
    arc=[(x+1.38*math.cos(i*math.pi/24),y+side*1.0*math.sin(i*math.pi/24)) for i in range(25)]
    bulwark('aa-waist.splinter-shield',arc,z,.86,closed=False)
    locker('aa-waist.ammunition',(x+1.63,y,z+.37),(.55,.62,.72))

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
    cx,cy,z=12.5,side*4.42,6.72;L=7.25;B=1.90
    stations=[(-L/2,.02,.48),(-L*.4,.48,.15),(-L*.25,.83,-.2),(0,1,-.32),(L*.25,.83,-.12),(L*.4,.46,.18),(L/2,.02,.58)]
    vs=[]
    for x,w,k in stations:
        for yy,zz in [(-w*B/2,.6),(-w*B*.43,.10),(0,k),(w*B*.43,.1),(w*B/2,.6)]:vs.append((cx+x,cy+yy,z+zz))
    fs=[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)]
    boat=mesh('boats.whaleboat-shell',vs,fs,materials['canvas'],smooth=True)
    mod=boat.modifiers.new('Hull skin','SOLIDIFY');mod.thickness=.05
    for sign in [-1,1]:tube_path('boats.gunwale',[(cx+x,cy+sign*w*B/2,z+.6) for x,w,k in stations],.055,materials['wood'])
    for dx in [-2.1,-.9,.5,1.8]:box('boats.thwart',(cx+dx,cy,z+.38),(.28,1.4,.09),materials['wood'],bev=.025)
    box('boats.floor',(cx,cy,z+.00),(3.8,.8,.05),materials['wood'],bev=.02)
    for dx in [-2.3,2.3]:
        y=side*3.62;x=cx+dx
        tube_path('boats.davit',[(x,y,deckz(x)+.05),(x,y,7.92),(x,side*3.75,8.32),(x,side*4.67,8.37)],.075,materials['naval'],sides=12)
        rod('boats.fall',(x,side*4.67,8.37),(x,cy,z+.32),.015,materials['rope'],vertices=6)
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
    for x in [20.0]:raft('lifesaving.forward-floats',x,side*3.57,5.20,side)
    for x in [-19.3,-32]:raft('lifesaving.after-floats',x,side*3.45,4.35,side)
    # Torpedo-deck access and deckhouse rails.
    stairs('deckhouse.stairs',(-15.9,side*3.7,2.95),(-13.4,side*3.7,5.27),.6)
    stairs('after.stairs',(-37.0,side*2.8,2.85),(-34.2,side*2.8,5.72),.60)
    rails('after.roof-rail',[(x,side*3.12,5.76) for x in [-33.8,-29,-23,-18.0]],.86)
    # Waist bulwark below the boat and exposed deck pipework.
    bulwark('deck.boat-bulwark',[(7.3,side*5.50),(17.0,side*5.23)],3.35,1.05,closed=False)
    tube_path('deck.service-pipe',[(-16,side*3.55,3.11),(13,side*3.55,3.16)],.040,materials['edge'])

# Ventilators, hatches, capstans, chocks, winches and cable reels, placed with working alleys.
for side in [-1,1]:
    for x in [-17,-10,-2,5,11]:
        y=side*2.65;z=5.68
        cyl('ventilation.gooseneck',(x,y,z+.38),.17,.70,materials['naval'],vertices=16)
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
    for x in [-29.1,-22.2,-7.4,10.2,30.6]:
        y=side*3.28;z=4.2
        for r in [.17,.22,.27,.32]:
            tube_path('damage-control.hose',[(x+r*math.cos(j*math.tau/24),y+side*.12,z+r*math.sin(j*math.tau/24)) for j in range(24)],.036,materials['canvas'],sides=8,closed=True)
        box('damage-control.hose-rack',(x,y,z+.37),(.55,.27,.08),materials['edge'])
        tube_path('damage-control.nozzle',[(x+.31,y+side*.13,z-.15),(x+.40,y+side*.13,z-.58),(x+.25,y+side*.13,z-.68)],.034,materials['edge'],sides=8)
    for x in [-24.2,14.0]:
        for dx in [-.20,.20]:
            y=side*3.55;z=deckz(x)
            cyl('damage-control.cylinder',(x+dx,y,z+.62),.125,1.04,materials['naval'],vertices=16)
            cyl('damage-control.bottle-shoulder',(x+dx,y,z+1.18),.125,.17,materials['naval'],vertices=16,r2=.045)
            cyl('damage-control.valve',(x+dx,y,z+1.30),.045,.11,materials['bronze'],vertices=12)
        for dz in [.28,.90]:box('damage-control.bottle-band',(x,side*3.68,z+dz),(.66,.05,.07),materials['edge'],bev=.006)
    for x in [-6.4,9.9]:
        y=side*3.24
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
    xx=52.6;yy=side*(width(xx)+.03);zz=5.13
    rod('anchor.hawse',(xx,yy-side*.10,zz),(xx,yy+side*.13,zz),.28,materials['edge'],vertices=24)
    rod('anchor.shank',(xx,yy+side*.16,zz-.10),(xx-.35,yy+side*.18,zz-1.04),.095,materials['edge'],vertices=12)
    rod('anchor.crown',(xx-.7,yy+side*.18,zz-.95),(xx+.08,yy+side*.18,zz-1.16),.11,materials['edge'])
    for dx in [-.66,.02]:mesh('anchor.fluke',[(xx+dx,yy+side*.08,zz-1.1),(xx+dx+.16,yy+side*.32,zz-.50),(xx+dx+.43,yy+side*.10,zz-1.03)],[(0,1,2)],materials['edge'])
# Small jackstaff and stern ensign staff, with rope cleats.
rod('rigging.jackstaff',(56.5,0,6.13),(56.5,0,8.65),.028,materials['edge'],r2=.018)
rod('rigging.ensign',(-56.5,0,2.78),(-56.85,0,4.35),.035,materials['edge'],r2=.021)

# Proper twin shafts, A-brackets, three swept propeller blades and a faired rudder.
for side in [-1,1]:
    label='port' if side>0 else 'starboard';yy=side*2.05
    rod('shafts.'+label,(-28,yy,-2.55),(-48.8,yy,-2.60),.16,materials['edge'],vertices=20)
    rod('shafts.fairing',(-30,yy,-2.55),(-37,yy,-2.56),.31,materials['underwater'],r2=.20,vertices=24)
    for xx in [-39,-46]:
        for sign in [-1,1]:rod('shafts.a-bracket',(xx,yy,-2.60),(xx+1.0,yy+sign*.9,-.90),.105,materials['underwater'],vertices=12)
    pivot=empty('propeller-'+label+'.pivot',(-49,yy,-2.6))
    attach(rod('propeller-'+label+'.hub',(-48.5,yy,-2.6),(-49.7,yy,-2.6),.30,materials['bronze'],r2=.10,vertices=24),pivot)
    for i in range(3):
        a=i*math.tau/3;verts=[]
        # Original lofted twisted blade: radii and sweep are visual estimates.
        for r,ang,w,twist in [(.22,0,.17,0),(.6,.1,.36,.07),(1.18,.29,.43,.13),(1.63,.46,.25,.10),(1.72,.57,.04,0)]:
            for sign in [-1,1]:
                t=a+ang+sign*w/max(r,.3)*.5
                verts.append((-49+sign*.11+twist,yy+r*math.cos(t),-2.6+r*math.sin(t)))
        blade=mesh('propeller-'+label+'.blade',verts,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(4)],materials['bronze'],smooth=True)
        mod=blade.modifiers.new('Blade thickness','SOLIDIFY');mod.thickness=.05;attach(blade,pivot)
    # Bilge keel uses a tapered ribbon, rather than a rectangular slab.
    vv=[]
    for x,w in [(-28,0),(-23,.48),(24,.48),(30,0)]:
        y=side*(hull_breadth_at(x,-2.7)+.012);vv += [(x,y,-2.7),(x,y+side*w,-3.08)]
    mesh('hull.bilge-keel',vv,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(3)],materials['underwater'])
rudder=empty('rudder.pivot',(-53.2,0,-1.4))
rv=[(-51.7,-.12,-.75),(-54.3,-.12,-.75),(-54.75,-.08,-3.22),(-52.3,-.09,-3.45),(-51.7,.12,-.75),(-54.3,.12,-.75),(-54.75,.08,-3.22),(-52.3,.09,-3.45)]
attach(mesh('rudder.blade',rv,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],materials['underwater']),rudder)

# Shared catalog and joint contract, with Fletcher-specific original Mk30 surface detail.
for mount in definition['mounts']:
    before=set(col.objects)
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
    if mount['battery']!='main':continue
    name=mount['id'];yaw=next(o for o in col.objects if o.get('nodeId')==name+'.yaw')
    recoil=next(o for o in col.objects if o.get('nodeId')==name+'.center.recoil')
    spec=mount['weapon'];H=spec['gunhouseSize'][2]
    # Replace only the barrel visuals. The catalog muzzle, elevation and recoil empties survive.
    for o in list(recoil.children):
        if o.type=='MESH':bpy.data.objects.remove(o,do_unlink=True)
    length=spec['muzzleForward']-spec['trunnionForward'];radius=spec['barrelBaseRadius']
    for a,b,r0,r1 in [(0,.72,radius*1.34,radius*1.12),(.55,1.10,radius*.94,radius*.85),(1.10,1.65,radius*.85,radius*.62),(1.65,length,radius*.62,.077)]:
        local(rod(name+'.barrel',(a,0,0),(b,0,0),r0,materials['canvas'] if a==0 else materials['edge'],r2=r1,vertices=24),recoil,name)
    local(rod(name+'.bore',(length+.002,0,0),(length+.012,0,0),spec['caliberM']/2,materials['dark'],vertices=24),recoil,name)
    # Bevel the catalog enclosure in the durable recipe; this is original geometry.
    house=next(o for o in set(col.objects)-before if o.type=='MESH' and 'sloped gunhouse' in o.name)
    bevel=house.modifiers.new('Mk30 rolled plate corners','BEVEL');bevel.width=.085;bevel.segments=3
    for side in [-1,1]:
        local(box(name+'.side-access',(-.65,side*1.515,1.10),(1.13,.045,1.40),materials['naval'],bev=.08),yaw,name)
        for dx in [-1.1,-.2]:
            for z in [.57,1.66]:local(box(name+'.door-dog',(dx,side*1.56,z),(.16,.075,.04),materials['edge'],bev=.008),yaw,name)
        local(box(name+'.sight-hood',(.56,side*.92,H+.04),(.68,.46,.18),materials['naval'],bev=.06),yaw,name)
        for z in [.75,1.10,1.45,1.80,2.15]:local(rod(name+'.rear-ladder',(-1.935,side*.70-.20,z),(-1.935,side*.70+.20,z),.021,materials['edge']),yaw,name)
        local(rod(name+'.roof-handhold',(-1.1,side*.96,H+.13),(-.3,side*.96,H+.13),.026,materials['edge']),yaw,name)
    for x in [-1.5,.85]:
        for side in [-1,1]:local(cyl(name+'.lifting-eye',(x,side*1.11,H+.10),.075,.08,materials['edge'],vertices=12),yaw,name)

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
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
print('FLETCHER REVISION 3',len(col.objects),'original objects',flush=True)
