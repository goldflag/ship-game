"""Original cylindrical 152 mm casemate, interpreted from the approved Kongō model."""
import bpy,math

def create_mount(m,col,helpers,mats):
 mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
 sp=m['weapon'];name=m['id'];gray,dark,steel=(mats[k] for k in ['naval','dark','edge'])
 def empty(suffix,parent=None,loc=(0,0,0)):
  o=bpy.data.objects.new(name+'.'+suffix,None);col.objects.link(o);o['nodeId']=o.name;o['assemblyId']=name;o.parent=parent;o.location=loc;return o
 def own(o,p):o.parent=p;o['assemblyId']=name;return o
 def cube(label,loc,size,p,mat=gray):return own(box(name+'.'+label,loc,size,mat,col),p)
 def bar(label,a,b,r,p,mat=steel,n=16,r2=None):return own(rod(name+'.'+label,a,b,r,mat,col,r2,n),p)
 def drum(label,loc,r,h,p,mat=gray,n=48):return own(cyl(name+'.'+label,loc,r,h,mat,col,n),p)
 a,z,c=m['position'];base=empty('base',loc=(-c,-a,z));yaw=empty('yaw',base);yaw.rotation_euler.z=-math.radians(m['bearingDeg'])
 drum('fixed-seat',(0,0,.34),1.23,.68,base)
 drum('roller-band',(0,0,.70),1.25,.08,yaw,steel)
 # Curved armor has thickness and an open vertical gun slot.
 for i in range(44):
  a0=math.radians(18+i*324/44);a1=math.radians(18+(i+1)*324/44)
  vs=[(r*math.cos(a),r*math.sin(a),zz) for zz in [.74,2.62] for r in [1.18,1.24] for a in [a0,a1]]
  own(mesh(name+'.curved-shield',vs,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],gray,col),yaw)
 drum('roof',(0,0,2.64),1.27,.055,yaw)
 # Bearings and internal carriage connect the gun to the revolving shell.
 cube('bed',(0,0,.82),(1.3,1.1,.18),yaw)
 for sy in [-.47,.47]:
  cube('bearing-cheek',(0,sy,1.12),(.55,.17,.55),yaw)
  bar('trunnion-cap',(0,sy-.12,1.4),(0,sy+.12,1.4),.17,yaw)
 H=sp['pivotHeight'];T=sp['trunnionForward'];elev=empty('center.elevation',yaw,(T,0,H));elev.rotation_euler.y=-math.radians(1)
 rec=empty('center.recoil',elev);L=sp['muzzleForward']-T;empty('center.muzzle',rec,(L,0,0))
 bar('bearing-seat',(0,-.39,0),(0,.39,0),.20,elev)
 cube('slide',(-.3,0,-.19),(1.5,.48,.17),elev)
 cube('breech',(-.65,0,0),(.9,.46,.45),rec,steel)
 cube('breech-block',(-1.14,0,.03),(.12,.50,.40),rec)
 bar('lever',(-1.15,.26,.08),(-1.02,.44,-.23),.035,rec)
 for y in [-.26,.26]:bar('recoil-cylinder',(-.6,y,.29),(1.0,y,.29),.105,elev)
 for x0,x1,r0,r1 in [(0,1.65,.25,.22),(1.65,3.25,.22,.17),(3.25,L,.17,.125)]:
  bar('barrel',(x0,0,0),(x1,0,0),r0,rec,n=24,r2=r1)
 bar('bore',(L-.004,0,0),(L+.004,0,0),.0762,rec,dark,n=24)
 # The approved view shows a full-height curtain over the shield slot.
 # Its perimeter stays on the rotating shield; only the barrel collar pitches.
 rings,sectors=12,40
 collar_x,collar_radius=1.65,.255
 def cover_points(degrees):
  theta=math.radians(degrees);c,s=math.cos(theta),math.sin(theta);points=[]
  for j in range(rings):
   t=j/(rings-1)
   for i in range(sectors):
    a=i*math.tau/sectors;ca,sa=math.cos(a),math.sin(a);square=max(abs(ca),abs(sa))
    y0=.40*ca/square;z0=1.69+.97*sa/square
    x0=math.sqrt(1.255**2-y0*y0)
    along=collar_x-T;up=collar_radius*sa
    end=(T+along*c-up*s,collar_radius*ca,H+along*s+up*c)
    fold=.026*math.sin(math.pi*t)*math.sin(9*a+3*t)
    points.append((x0+(end[0]-x0)*t+fold,
                   y0+(end[1]-y0)*t+fold*ca,
                   z0+(end[2]-z0)*t-.055*math.sin(math.pi*t)))
  return points
 faces=[(j*sectors+i,j*sectors+(i+1)%sectors,(j+1)*sectors+(i+1)%sectors,(j+1)*sectors+i)
        for j in range(rings-1) for i in range(sectors)]
 cover=own(mesh(name+'.center.canvas-curtain',cover_points(-5),faces,mats.get('canvas',gray),col,True),yaw)
 cover['nodeId']=name+'.center.cover';cover['gunCoverElevationId']=name+'.center.elevation'
 cover['gunCoverBaseAngle']=-5.0;cover['gunCoverAngles']=[float(a) for a in range(0,21,5)]
 cover.shape_key_add(name='Basis')
 for angle in range(0,21,5):
  shape=cover.shape_key_add(name='Elevation '+str(angle))
  for vertex,point in zip(shape.data,cover_points(angle)):vertex.co=point
  driver=shape.driver_add('value').driver;driver.type='SCRIPTED'
  var=driver.variables.new();var.name='pitch';var.type='TRANSFORMS'
  target=var.targets[0];target.id=elev;target.transform_type='ROT_Y';target.transform_space='LOCAL_SPACE'
  driver.expression=f'max(0,1-abs(-pitch*57.29577951308232-{angle})/5)'
 for i in range(sectors):
  a=i*math.tau/sectors;b=(i+1)*math.tau/sectors
  bar('canvas-collar',(collar_x-T,collar_radius*math.cos(a),collar_radius*math.sin(a)),
      (collar_x-T,collar_radius*math.cos(b),collar_radius*math.sin(b)),.017,elev,gray,n=6)
 cube('sight-hood',(1.13,-.57,1.35),(.16,.28,.30),yaw)
 bar('sight-glass',(1.2,-.57,1.35),(1.23,-.57,1.35),.08,yaw,dark)
 return yaw
