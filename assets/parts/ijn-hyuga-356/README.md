# Ise-class 356 mm twin turret (Hyūga 1942)

`type41-356-hyuga-twin`, built by `geometry.py` (`create_mount`), measured against the approved GameModels3D pjsb517
`jgm191` visual from plan and cross-section cuts: a lozenge plan widest at the training axis (4.3 m half-width at the
floor), chamfered face corners and a shallow V back, side plates leaning in about 15 degrees, and a gabled roof whose
ridge rises from 1.73 m over the inclined face plate to 2.64 m aft. The barrels stand 2.25 m apart with their trunnions
0.84 m above the floor and their muzzles 14.16 m ahead of the axis.

The yaw datum is the gunhouse floor (the reference hardpoint). A shallow fixed bearing ring under the floor has its
underside 0.25 m below the datum: the ship owns the barbette up to that plane. The armoured shell (`gunhouseMesh`) is a
closed 56-face enclosure; `sync_shape.py` rewrites the catalog entry from `gunhouse_shape()` and keeps the Type 41 gun's
ballistics from the Kongō 1942 twin.

Turned barrels, blast bags that pitch with the guns, bearing cheeks and trunnion pins, the sight hoods with their open
covers, the periscope hood and the face and back ladders are drawn over the shell. The gunhouse interior and its
machinery are not modelled; proportions and articulation remain under review.
