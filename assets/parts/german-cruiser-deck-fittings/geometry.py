"""Original reusable deck fittings from the approved original Hipper recipe."""
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

def create_capstan(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.cyl('bed',(0,0,.10),.68,.20,mat='edge',vertices=32)
    m.cyl('drum',(0,0,.48),.40,.60,vertices=32)
    m.cyl('head',(0,0,.81),.59,.15,mat='edge',vertices=32)
    return m.root

def create_hatch(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.box('coaming',(0,0,.12),(1.45,1.15,.24))
    m.box('lid',(0,0,.27),(1.51,1.20,.07),mat='roof')
    return m.root

def create_searchlight(part,col,helpers,materials):
    from deck_fittings import Fitting
    m=Fitting(col,helpers,materials)
    m.cyl('sole',(0,0,.08),.45,.16,mat='edge',vertices=32)
    m.cyl('training-column',(0,0,.43),.22,.60,vertices=32)
    # Original fork and 1.4 m drum, pointing local Blender +X (ship bow).
    for y in [-.74,.74]:
        m.rod('fork',(0,0,.70),(.35,y,1.0),.065)
        m.rod('fork-upright',(.35,y,1.0),(.35,y,1.46),.07)
    m.rod('trunnion',(.35,-.78,1.45),(.35,.78,1.45),.09,mat='edge')
    m.rod('drum',(.12,0,1.45),(.84,0,1.45),.67,vertices=40)
    m.rod('lens-rim',(.80,0,1.45),(.91,0,1.45),.70,mat='edge',vertices=40)
    m.rod('lens',(.912,0,1.45),(.92,0,1.45),.61,mat='glass',vertices=40)
    # Protective ring uses the registered original fitting helper.
    m.ring('protective-rim',(.94,0,1.45),.60,.025,axis='x')
    return m.root
