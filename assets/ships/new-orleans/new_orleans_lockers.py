"""Ready-use lockers (am028/029/030/224) by the guns, as (x, centre y, z, across, high, along) in the reference frame
(x starboard, y up, z toward the stern, metres), read off the approved GameModels3D pasc107 B_Hull model's part bounds.

The recipe (new_orleans_fittings.py) seats each on the deck below it; author-blueprint.py makes the ones within a gun's
reach firing obstructions, so the barrels stop at them. The two lockers beside the bridge-wing Oerlikons stand 0.6 m
abaft the reference's, clear of the catalog Mk 4's working circle (the reference's gun is smaller).
"""
LOCKERS = [(-1.68, 8.86, -84.35, 1.38, .8, .62), (1.68, 8.86, -84.35, 1.38, .8, .62), (-3.32, 12.66, -30.75, .88, 1.07, 1.0),
           (-2.22, 9.45, -30.78, 1.05, 1.29, 1.2), (2.1, 9.45, -30.94, 1.05, 1.29, 1.2), (3.32, 12.65, -30.75, .88, 1.07, 1.0),
           (1.53, 9.45, -31.93, 1.05, 1.29, 1.2), (-1.64, 9.45, -31.78, 1.05, 1.29, 1.2), (.97, 10.07, -7.65, 1.38, .8, .62),
           (-3.62, 17.95, -29.02, .98, .84, .56), (-4.79, 4.18, 13.03, 1.67, 1.23, .78), (4.79, 4.18, 13.11, 1.67, 1.23, .78),
           (-1.63, 4.01, 13.02, 1.38, .8, .62), (-3.02, 6.62, 12.25, 1.38, .8, .62), (-3.6, 4.07, 51.3, 1.38, .8, .62),
           (3.02, 6.62, 12.25, 1.38, .8, .62), (-6.82, 10.14, 31.57, .62, .8, 1.38), (0.0, 10.14, 49.44, 1.38, .8, .62),
           (3.6, 4.07, 51.3, 1.38, .8, .62), (-1.96, 10.07, 2.74, .62, .8, 1.38), (1.96, 10.07, 2.74, .62, .8, 1.38),
           (1.63, 4.01, 13.02, 1.38, .8, .62), (2.43, 4.46, 79.12, 1.51, .8, 1.18), (-2.47, 4.46, 79.14, 1.51, .8, 1.18)]
