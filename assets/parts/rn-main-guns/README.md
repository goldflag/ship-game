# Royal Navy KGV gun mounts

The original Mk VII twin/quad and QF Mk I twin recipes use the approved
[GameModels3D King George V resources](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb107)
`bgm056_14in45_bl_mkvii_quadro`, `bgm057_14in45_bl_mkvii_twin` and
`bgs055_5_25in_50_qf_mk_i` as visual references only. No source mesh or texture
is imported into the original builder.

The main mounts retain distinct roof outlines and rangefinder spans. The twin
includes the reference's rear roof guardrail. The secondary uses widely spaced
high trunnions, rear hatch coamings and a supported periscope; its catalog owns
the corrected barrel spacing and pivot height. Barrel profiles retain their
stepped sleeves with 16-sided principal tubes. Small fittings and cloth folds
are deliberately simplified.

Gun covers use the shared `gun_bloomers.py` fixed-rim/pitching-cuff contract.
The KGV main seams follow the whole rounded-bottom aperture and its roof
return. The secondary seam follows the face and roof slot. Each barrel slides
through its cuff during recoil; the covers are an authored visual approximation,
not a cloth simulation. Joint IDs and muzzle sockets remain stable.

Standalone fixed views and depressed/intermediate/maximum elevation with full
recoil are reviewed in the model viewer. Installation clearance, historical
accuracy and fine mechanism fidelity are not certified by those checks; library
review remains unreviewed until each required ship installation review passes.

The capital-gun shape pass compares against the merged PR #376 models at common
scale. The twin now has the source's narrower forward face, forward shoulder and
rounded, farther-aft roof guardrail. Both mains use smoother authored rear
contours, deeper chamfered rangefinder end housings and shorter closed-port
covers. Connected barrel surfaces remove hidden internal end caps and fund the
muzzle swell/recess and silhouette refinements; unmatched tall roof vents were
removed. Complete standalone exports are 3,728 triangles for the quad and 3,440
for the twin, including their fittings and canvas (ceilings 4,608 and 3,744).

The canvas remains a deliberate difference from the geometry-only source's open
ports. Its complete roof-return seam stays fixed, and the 0.48 m pitching cuff
overlaps the uninterrupted sleeve even at full 1.143 m recoil. The twin retains
a 4.95 m bearing shoulder around the unchanged 4.9 m native well, including
where its narrower visual shell exposes the roller edge. Local Blender
renders inspect −3°, 17.5° and 40° with full recoil. The existing combat pivots,
ballistics and armor/collision definition are retained: the twin's collision
shell therefore remains a broader approximation of the revised visual face.
Barrel height relative to the source, rear wall rake, fine roof hardware and
rangefinder corner radii remain approximate; the source resource identifies
the named variants but does not independently certify a historical refit.
