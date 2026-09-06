"""Reproducible U-570 exterior reconstruction; no downloaded geometry is consumed.

Run from any directory with Python 3. The versioned blueprint is the pipeline input.
Dimensioned datums: British C.B.4318 Plate 4. Intermediate contours: original
interpolation guided by the USN redraw's six sections, profile and upper-deck plan.
All table rows below are interpretations (not a recovered yard table of offsets).
Blender +X forward; blueprint station = X + half overall length.
"""
from pathlib import Path
import json, math
ROOT = Path(__file__).resolve().parents[1]
L, B, D = 67.10045, 6.15315, 4.7625
R, CY, DECK = 2.3622, -1.8796, 1.2192
# x, pressure/outer fairing half-width, lower rounded-body ordinate,
# upper rounded-body ordinate, keel ordinate, casing deck ordinate, deck half-width,
# saddle-tank fullness. End rows describe the free-flooding extremities.
OFFSETS = [
 [-L/2,.008,-.62,.44,-.65,.69,.005,0],
 [-33,.12,-.68,.44,-.69,.73,.10,0],
 [-31,.37,-.81,.40,-.85,.77,.31,0],
 [-29,.55,-1.02,.36,-1.12,.79,.46,0],
 [-27,.80,-1.55,.32,-1.64,.82,.61,0],
 [-25,1.07,-2.23,.28,-2.35,.86,.71,0],
 [-23,1.40,-2.76,.30,-3.04,.91,.82,0],
 [-21,1.72,-3.16,.36,-3.51,.97,.94,.04],
 [-18,2.05,-3.76,.43,-4.30,1.06,1.13,.28],
 [-15,2.26,-4.10,.47,-4.65,1.14,1.35,.65],
 [-12,R,CY-R,CY+R,-D,DECK,1.52,.92],
 [-8,R,CY-R,CY+R,-D,DECK,1.57,1],
 [0,R,CY-R,CY+R,-D,DECK,1.58,1],
 [7,R,CY-R,CY+R,-D,DECK,1.58,1],
 [12,R,CY-R,CY+R,-D,1.24,1.51,.90],
 [16,2.30,-4.20,.47,-D,1.28,1.36,.60],
 [20,2.18,-4.11,.45,-D,1.32,1.13,.23],
 [23,2.03,-3.94,.43,-4.60,1.37,.95,0],
 [25,1.81,-3.68,.41,-4.33,1.43,.80,0],
 [27,1.50,-3.24,.38,-3.87,1.51,.64,0],
 [29,1.12,-2.68,.34,-3.12,1.61,.48,0],
 [31,.65,-1.69,.42,-1.96,1.73,.30,0],
 [32,.39,-.82,.76,-.91,1.80,.19,0],
 [32.36,.29,-.22,1.01,-.30,1.82,.14,0],
 [32.55,.235,.07,1.14,.01,1.83,.11,0],
 [33,.12,.69,1.54,.66,1.84,.07,0],
 [33.40,.035,1.24,1.76,1.23,1.84,.025,0],
 [L/2,.008,1.54,1.79,1.52,1.81,.005,0],
]

def sample(x, j):
    """Monotone cubic Hermite interpolation, avoiding end/shoulder overshoot."""
    xs=[r[0] for r in OFFSETS]; vs=[r[j] for r in OFFSETS]
    ds=[(vs[i+1]-vs[i])/(xs[i+1]-xs[i]) for i in range(len(xs)-1)]
    ms=[ds[0]]
    for i in range(1,len(xs)-1):
        if ds[i-1]*ds[i]<=0: ms.append(0)
        else:
            a,b=xs[i]-xs[i-1],xs[i+1]-xs[i]
            ms.append(3*(a+b)/((2*b+a)/ds[i-1]+(b+2*a)/ds[i]))
    ms.append(ds[-1])
    for i in range(len(xs)-1):
        if xs[i]<=x<=xs[i+1]:
            h=xs[i+1]-xs[i]; t=(x-xs[i])/h
            return (2*t**3-3*t*t+1)*vs[i]+(t**3-2*t*t+t)*h*ms[i]+(-2*t**3+3*t*t)*vs[i+1]+(t**3-t*t)*h*ms[i+1]
    return vs[0] if x<xs[0] else vs[-1]

def section(x):
    bw,lo,hi,keel,deck,dw,full = [sample(x,j) for j in range(1,8)]
    cy=(lo+hi)/2; ry=(hi-lo)/2
    # Circle at amidships; smoothly narrowing round sections at either end.
    def halfwidth(y):
        q=(y-cy)/ry
        circle=bw*math.sqrt(max(0,1-q*q)) if abs(q)<=1 else 0
        # Upper outboard saddle lobes on the dimensioned circular pressure body.
        q=(y+.82)/1.3026
        tank=(2.02+(B/2-2.02)*math.sqrt(max(0,1-q*q))) if abs(q)<=1 else 0
        tank=circle+max(0,tank-circle)*full
        # Free-flooding trapezoidal casing over the body; top follows deck plan.
        casing=0
        if y>=cy:
            t=max(0,min(1,(y-hi)/(deck-hi)))
            foot=max(dw,dw*1.20)
            casing=foot*(1-t)+dw*t
        # Flat ballast keel shoe, not the old V section.
        shoe=min(.5588,bw*.34) if y<=lo+ry*.08 else 0
        return max(circle,tank,casing,shoe,.003)
    fractions=sorted(set([i/64 for i in range(65)]+[(v+D)/(DECK+D) for v in [CY-R,-.82,CY+R]]))
    pts=[[0,round(keel,6)]]
    for t in fractions:
        y=keel+(deck-keel)*t
        pts.append([round(halfwidth(y),6),round(y,6)])
    return pts

b=json.loads((ROOT/'blueprint.json').read_text())
b['configuration']='U-570 as captured, August–September 1941 · raised periscopes; original reconstruction'
h=b['hull']; h.update(length=L,beam=B,draft=D,depth=round(D+1.84,6))
xs=sorted(set([r[0] for r in OFFSETS]+[round(-L/2+i*L/144,7) for i in range(1,144)]))
h['sections']=[{'station':round(x+L/2,7),'points':section(x)} for x in xs]
h['halfBreadths']=[[s['station'],max(p[0] for p in s['points'])] for s in h['sections']]
h['deckHeights']=[[s['station'],s['points'][-1][1]] for s in h['sections']]
h['keelHeights']=[[s['station'],s['points'][0][1]] for s in h['sections']]
for m in b['mounts']:
    m['position']=[0,round(sample(7.93,5)+.035,6),-7.93] if m['id']=='deck-gun' else [0,3.79,.83]
# Actual steel fairing is a lofted teardrop. CPU plates and render share its faces.
outline=[(5.15,0),(4.90,-.67),(4.25,-1.02),(3.3,-1.10),(1.8,-1.05),(.6,-.84),(-.10,-.48),(-.38,0),(-.10,.48),(.6,.84),(1.8,1.05),(3.3,1.10),(4.25,1.02),(4.90,.67)]
# The low forward fairing/casing extension stops below the bridge wall.
n=len(outline); verts=[]
for z,scale,stretch in [(DECK,1.04,1.24),(3.54,1,1),(4.60375,1.035,1)]:
    for x,y in outline: verts.append([-y*scale,z,-(1.8+(x-1.8)*stretch)])
tris=[]
for ring in range(2):
    for i in range(n):
        a=ring*n+i;c=ring*n+(i+1)%n;d=c+n;e=a+n
        tris += [[a,c,d],[a,d,e]]
# Bottom only: the bridge is open, with the walking floor in its own structure.
for i in range(1,n-1): tris.append([0,i+1,i])
b['structures']=[{'id':'conning-tower','name':'U-570 tower fairing and open bridge wall','footprint':[[v[0],v[2]] for v in verts[:n]],'baseY':DECK,'height':4.60375-DECK,'material':'naval','surface':{'vertices':verts,'triangles':tris}}, {'id':'bridge-floor','name':'Bridge walking platform','footprint':[[-y,-x] for x,y in outline],'baseY':3.49,'height':.05,'material':'roof'}]
b['obstructions']=[{'id':'tower-obstruction','center':[0,2.88,-2.65],'size':[2.30,3.40,5.85]}]
b['viewpoints']['bridge']=[.22,5.08,-3.65]
b['submarine']['periscopeEye']=[0,9.8495,-1.285]
# Keep stable space IDs. Inscribed, disjoint vertical strips approximate the
# round internal envelope. Capacities remain gameplay tuning; no false survey.
# Boundaries follow the six-space order in C.B.4318; raster positions ±0.4 m.
rooms=[('forward-torpedo-room',14.0,25.5),('forward-accommodation',5.8,14.0),('control-room',-1.9,5.8),('aft-accommodation',-7.8,-1.9),('diesel-room',-15.3,-7.8),('motor-room',-24.0,-15.3)]
for ident,a,z in rooms:
    c=next(c for c in b['compartments'] if c['id']==ident)
    cells=[]; steps=math.ceil((z-a)/1.5)
    for i in range(steps):
        x0=a+(z-a)*i/steps+.015; x1=a+(z-a)*(i+1)/steps-.015
        # 5 strips stay inside the pressure body, not the external saddle tank.
        lo=max(sample(x0,2),sample(x1,2))+.16
        hi=min(sample(x0,3),sample(x1,3))-.16
        for band in range(5):
            y0=lo+(hi-lo)*band/5; y1=lo+(hi-lo)*(band+1)/5
            widths=[]
            for x in (x0,(x0+x1)/2,x1):
                cy=(sample(x,2)+sample(x,3))/2; r=(sample(x,3)-sample(x,2))/2
                for y in (y0,y1): widths.append(sample(x,1)*math.sqrt(max(0,1-((y-cy)/r)**2))-.07)
            w=min(widths)
            cells.append({'center':[0,round((y0+y1)/2,6),round(-(x0+x1)/2,6)],'size':[round(2*w,6),round(y1-y0-.006,6),round(x1-x0,6)]})
    c['cells']=cells
    low=[min(p['center'][j]-p['size'][j]/2 for p in cells)-.000002 for j in range(3)]
    high=[max(p['center'][j]+p['size'][j]/2 for p in cells)+.000002 for j in range(3)]
    c['center']=[round((a+z)/2,6) for a,z in zip(low,high)]
    c['size']=[round(z-a,6) for a,z in zip(low,high)]
    assert sum(math.prod(p['size']) for p in cells)>=c['capacityM3'],ident
# Machinery stays within the narrowed pressure hull and its assigned compartment.
locations={'forward-torpedoes':([0,-1.75,-20.7],[2.3,2.2,7.2]),'deck-magazine':([0,-.9,-9.5],[1.4,1,2]),'diesels':([0,-1.7,11.4],[2.6,2.4,6.4]),'electric-motors':([0,-1.6,17.2],[2.1,1.7,2.5]),'aft-torpedoes':([0,-1.2,21.2],[1.3,1.1,3.4]),'steering-gear':([0,-1.7,22.7],[1.2,1.1,1.6])}
for m in b['modules']: m['center'],m['size']=locations[m['id']]
# Muzzle sockets at the shutter mouths, on the sloping free-flooding bow.
for i,t in enumerate(b['torpedoTubes']):
    if i<4:t['position']=[(-1 if i%2==0 else 1)*.38,-.92 if i<2 else -1.80,-31.0 if i<2 else -30.15]
    else:t['position']=[0,-.24,32.95]
b['accuracy']['exterior']='U-570 August–September 1941: British dimensioned docking section, captured general arrangement and ONI photographs. Circular midbody, saddle shoulders, deck, tower and stern fittings reconstructed independently. Interpolated offsets, exact slot counts and small fittings remain estimates; see fidelity-01 report.'
b['accuracy']['internals']='Six stable spaces follow the captured-boat arrangement and fit conservatively inside the rounded body using disjoint cells. Capacities, pump rates, damage and buoyancy remain game tuning; outer free-flooding plating and pressure boundary are not separately simulated.'
(ROOT/'blueprint.json').write_text(json.dumps(b,indent=2,ensure_ascii=False)+'\n')
(ROOT/'authoring/offset-interpretation.json').write_text(json.dumps({'sourceIds':['u570-docking-plate4','u570-usn-plan'],'basis':'Interpreted longitudinal controls, NOT an original table of offsets','units':'metres; Blender coordinates','columns':['x','bodyHalfWidth','bodyBottom','bodyTop','keel','deck','deckHalfWidth','saddleFullness'],'rows':OFFSETS,'sectionCount':len(xs),'midshipPressureDiameter':2*R,'pressureHullLengthReportedM':49.4,'pressureHullLengthNote':'Reported length is not separately certified by the single external envelope.'},indent=2)+'\n')
print('Wrote',len(xs),'stations;',len(h['sections'][0]['points']),'points per half section')
