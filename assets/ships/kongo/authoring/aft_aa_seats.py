"""Original aft single-AA seats and open shields in Blender metres.

The approved exterior shows a chamfered U shield and a level working pad.
The small mounting chock closes the reference mesh's visible footing gap;
its construction is provisional, while gun datums remain in the blueprint.
"""
import math
from weather_deck import height


def create(helpers, mats, hull, mounts):
    mesh, cyl = helpers['mesh'], helpers['cyl']
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),
             (2,3,7,6),(3,0,4,7)]
    for mount in mounts:
        if not mount['id'].startswith('aa25-'):
            continue
        number = int(mount['id'][5:])
        if not 35 <= number <= 48:
            continue
        rx, z, rz = mount['position']
        x, y = -rz, -rx
        sign = 1 if y > 0 else -1
        shift = -.055 if number == 48 else 0
        name = 'aft-seat-'+mount['id']
        def world(u, v):
            return (x+u, y+sign*(v+shift))
        outline = [(-.96,-1.15),(-.96,.34),(-.70,.575),
                   (.70,.575),(.96,.34),(.96,-1.15)]
        outline = [world(u, v) for u, v in outline]
        if sign > 0:
            outline.reverse()
        pad_top = z-(.085 if number in (37,39) else .022)
        n = len(outline)
        points = [(a,b,height(hull,a,b)-.025) for a,b in outline]
        points += [(a,b,pad_top) for a,b in outline]
        panel_faces = [tuple(reversed(range(n))),tuple(range(n,2*n))]
        panel_faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh(name+'.pad',points,panel_faces,mats['naval'])
        cyl(name+'.mounting-chock',(x,y,(pad_top+z)/2),.27,
            z-pad_top,mats['naval'],vertices=32)
        # Open rear; thin walls and a folded top edge follow the visible U.
        path = [(-.96,-.25),(-.96,.35),(-.70,.603),
                (.70,.603),(.96,.35),(.96,-.25)]
        top = z+.911
        for index, (a,b) in enumerate(zip(path,path[1:])):
            a,b = world(*a),world(*b)
            dx,dy = b[0]-a[0],b[1]-a[1]
            length = math.hypot(dx,dy)
            nx,ny = -dy/length,dx/length
            for label,thickness,upper,lower in [('wall',.017,top-.011,None),
                                               ('rim',.052,top,top-.022)]:
                corners = [(a[0]-nx*thickness/2,a[1]-ny*thickness/2),
                           (b[0]-nx*thickness/2,b[1]-ny*thickness/2),
                           (b[0]+nx*thickness/2,b[1]+ny*thickness/2),
                           (a[0]+nx*thickness/2,a[1]+ny*thickness/2)]
                vertices = [(u,v,height(hull,u,v)-.015 if lower is None else lower)
                            for u,v in corners]
                vertices += [(u,v,upper) for u,v in corners]
                mesh(f'{name}.{label}-{index}',vertices,faces,mats['naval'])
