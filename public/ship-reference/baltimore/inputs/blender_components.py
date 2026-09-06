"""Shared original gun geometry and articulation, driven by the part catalog.

Authoring axes: bow +X, port +Y, up +Z. All joint IDs survive the common export.
The primitive helpers and materials are supplied by each ship's visual recipe.
"""
import bpy
import math
from mathutils import Matrix


def create_gun_mount(mount, collection, helpers, materials, deck_height):
    if mount['weapon'].get('mountingStyle', 'enclosed') != 'enclosed':
        from blender_open_guns import create_open_mount
        return create_open_mount(mount, collection, helpers, materials)
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh','cyl','rod','box'])
    naval, roof, edge, hullgray, canvas, dark = (materials[k] for k in ['naval','roof','edge','hullgray','canvas','dark'])
    deckz = deck_height
    col = collection
    name = mount['name']
    a,b,c = mount['position']
    x,y,zbase = -c,-a,b
    bearing = -math.radians(mount['bearingDeg'])
    primary = mount['weapon']['caliberM'] > .2
    rangefinder = mount['rangefinder']
    before=set(bpy.context.scene.objects)
    spec=mount['weapon']
    def empty(suffix,loc,rotation=(0,0,0)):
        node=bpy.data.objects.new(mount['id']+'.'+suffix,None)
        col.objects.link(node);node.location=loc;node.rotation_euler=rotation
        node['nodeId']=node.name;node['assemblyId']=mount['id']
        node.empty_display_size=1.5
        bpy.context.view_layer.update()
        return node
    def attach(child,parent):
        bpy.context.view_layer.update()
        world=child.matrix_world.copy();child.parent=parent;child.matrix_parent_inverse=Matrix.Identity(4);child.matrix_world=world
        bpy.context.view_layer.update()
    r=spec['barbetteRadius']
    base_height=spec.get('gunhouseBaseHeight',.25)
    barbette_top=zbase+base_height-.25
    cyl(name+' • armored barbette',(x,y,(deckz(x)+barbette_top)/2),r,max(.02,barbette_top-deckz(x)),hullgray,col,64)
    cyl(name+' • roller race',(x,y,zbase+.13),spec.get('rollerRadius',r+.10),.26,edge,col,64)
    fixed_parts=set(bpy.context.scene.objects)-before
    yaw=empty('yaw',(x,y,zbase),(0,0,bearing))
    L,W,H=spec['gunhouseSize']
    outline=[(-L*.51,-W*.34),(-L*.37,-W*.5),(L*.31,-W*.5),(L*.50,-W*.30),(L*.50,W*.30),(L*.31,W*.5),(-L*.37,W*.5),(-L*.51,W*.34)]
    top=[(a*.89-.18,b*.91) for a,b in outline]
    vl=[(a,b,zbase+.25) for a,b in outline]+[(a,b,zbase+H) for a,b in top]
    if spec.get('gunhouseShape'):
        shape=spec['gunhouseShape'];outline=shape['footprint']
        vl=[(a,b,zbase+base_height) for a,b in outline]+[(a,b,zbase+c) for a,b,c in shape['roof']]
    n=len(outline)
    fc=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    if spec.get('gunhouseMesh'):
        shape=spec['gunhouseMesh']
        vl=[(a,b,zbase+c) for a,b,c in shape['vertices']]
        fc=[face['indices'] for face in shape['faces']]
    ob=mesh(name+' • sloped gunhouse',vl,fc,None,col)
    ob.data.materials.append(naval);ob.data.materials.append(roof)
    if spec.get('gunhouseMesh'):
        for polygon,face in zip(ob.data.polygons,spec['gunhouseMesh']['faces']):polygon.material_index=1 if face['finish']=='roof' else 0
    else:ob.data.polygons[1].material_index=1
    # Sloped frontal roof / face plates remain visibly faceted.
    ob.location=(x,y,0);ob.rotation_euler.z=bearing
    def pt(a,b,z):return (x+a*math.cos(bearing)-b*math.sin(bearing),y+a*math.sin(bearing)+b*math.cos(bearing),z)
    spacing=spec['barrelSpacing']
    exposed_start=spec['trunnionForward']
    muzzle=spec['muzzleForward']
    bore=spec['caliberM']/2
    gunz=zbase+spec['pivotHeight']
    elev=math.radians(1.0)
    sides={1:['center'],2:['left','right'],3:['left','center','right'],4:['left-outer','left','right','right-outer']}[spec.get('barrelCount',2)]
    for index,side in enumerate(sides):
        barrel_before=set(bpy.context.scene.objects)
        gy=((len(sides)-1)/2-index)*spacing
        rad=spec.get('barrelBaseRadius',.69 if primary else .30)
        rod(name+' • canvas mantlet',pt(exposed_start-.65,gy,gunz),pt(exposed_start+.7,gy,gunz),rad*1.12,canvas,col,rad*.78,24)
        sections=[(exposed_start+.4,rad*.83),(exposed_start+2.4,rad*.76),(exposed_start+2.6,rad*.64),(muzzle-2.0,rad*.43),(muzzle,rad*.40)]
        for (a,ra),(b,rb) in zip(sections,sections[1:]):
            rod(name+' • barrel',pt(a,gy,gunz+(a-exposed_start)*math.tan(elev)),pt(b,gy,gunz+(b-exposed_start)*math.tan(elev)),ra,edge,col,rb,24)
        end=pt(muzzle+.012,gy,gunz+(muzzle-exposed_start)*math.tan(elev))
        rod(name+' • recessed bore',end,pt(muzzle+.035,gy,end[2]),bore,dark,col,vertices=20)
        pieces=set(bpy.context.scene.objects)-barrel_before
        elevation=empty(side+'.elevation',pt(exposed_start,gy,gunz),(0,-elev,bearing))
        recoil=empty(side+'.recoil',pt(exposed_start,gy,gunz),(0,-elev,bearing))
        socket=empty(side+'.muzzle',pt(muzzle,gy,gunz+(muzzle-exposed_start)*math.tan(elev)),(0,-elev,bearing))
        attach(elevation,yaw);attach(recoil,elevation);attach(socket,recoil)
        for piece in pieces:attach(piece,recoil)
    for gy in (-W*.29,W*.29):
        h=cyl(name+' • roof hatch',pt(-2.7 if primary else -1.2,gy,zbase+H+.065),.36 if primary else .22,.13,edge,col,20)
    if rangefinder:
        rr=.31 if primary else .22
        half=spec.get('rangefinderWidth',10.5 if primary else 6.2)/2
        rx=spec.get('rangefinderForward',-2.35)
        rod(name+' • transverse rangefinder',pt(rx,-half,zbase+H-.85),pt(rx,half,zbase+H-.85),rr,naval,col,vertices=20)
        for gy in (-half,half):
            o=box(name+' • rangefinder hood',pt(rx,gy,zbase+H-.85),(1.35,.75,1.05) if primary else (.8,.45,.6),naval,col)
            o.rotation_euler.z=bearing
    ob['battery']=spec['name']
    for piece in set(bpy.context.scene.objects)-before:
        if piece.type=='MESH':
            piece['assemblyId']=mount['id']
            if piece not in fixed_parts and piece.parent is None:attach(piece,yaw)
    return ob
