"""Aft superstructure: battery and control decks, aft director, mainmast, aerials, aft searchlight
and the stern derrick."""
from bismarck_kit import *
def stairs_and_intakes():
 # Runs inside legacy_frame(): authored 2 m forward, shifted back by the caller.
 for sign in [-1,1]:
  for name,a,b,inner in [
   ('Aft platform access',(-56.0,9.1,5.8),(-51.0,9.1,8.3),8.0),
   ('Aft deck stair',(-47.0,8.55,8.3),(-42.0,8.55,10.66),7.6),
   ('Aft control stair',(-39.0,4.6,10.66),(-35.6,4.6,12.9),3.8)]:
   a=(a[0],a[1]*sign,a[2]);b=(b[0],b[1]*sign,b[2]);stairs(name,a,b,.7);stair_landing(name,*b,inner*sign)
  aft_pts=[(-zz+2,-xx) for xx,zz in structures['aft-battery-deck']['footprint']]
  for xx in [-41,-37,-33]:
   yy,normal=house_side(aft_pts,xx,sign)
   vent('Aft intake',(xx,yy+sign*.06,9.3),(1.15,.25,1.0),sign)
def main_director():
 director('Aft main director',-37.8,17.5,10.5,16.2)
def searchlight_aft():
 searchlight_support=SupportSurface([*hullcol.objects,*supercol.objects])
 for sign in [-1,1]:
  searchlight('Aft searchlight',-34.8,sign*4.8,searchlight_support.below(-34.8,sign*4.8,20)+.02,sign*2.5)
def mainmast():
 pole_mast('mainmast',-22.0,10.96,48.5)
def aerials():
 for xx,zz in [(5.9,40),(-22.5,48)]:rod('Wireless spreader',(xx,-.42,zz),(xx,.42,zz),.045,materials['edge'],detailcol,vertices=8)
 for yy in [-.38,.38]:
  a=Vector((5.9,yy,40.0));b=Vector((-22.5,yy,48.0));pts=[a+(b-a)*(i/16)-Vector((0,0,1.15*math.sin(math.pi*i/16))) for i in range(17)];polyline('Aerial span',pts,.015,materials['dark'],vertices=5)
def derrick():
 rod('After derrick post',(-43,0,12.3),(-43,0,26.8),.13,materials['edge'],detailcol,.05,12)
 rod('After derrick boom',(-43,0,16.0),(-48,0,21.5),.09,materials['edge'],detailcol,vertices=10)
 rod('After derrick cable',(-43,0,26.5),(-48,0,21.5),.018,materials['dark'],detailcol,vertices=5)
def build():
 # Region entry point, after the forward and midships regions.
 with legacy_frame():stairs_and_intakes()
 main_director();searchlight_aft();mainmast();aerials();derrick()
def after_mounts():
 pass
