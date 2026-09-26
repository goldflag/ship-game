"""Windows and portholes the reference paints on its bridge, read off orthographic renders of the approved
GameModels3D pasc107 B_Hull textures with the wall each lies on (reference frame: x starboard, y up, z toward the
stern, metres), written by authoring/windows.py. No reference geometry or texture is loaded by the recipe."""

# (kind, z0, z1, y0, y1, starboard wall x): seen from starboard, mirrored to port.
SIDE = [
    ('porthole', -27.05, -26.713, 19.031, 19.369, 1.254),
    ('porthole', -28.062, -27.762, 16.781, 17.081, 2.16),
    ('porthole', -31.381, -31.119, 16.331, 16.688, 1.843),
    ('porthole', -32.131, -31.85, 16.35, 16.688, 1.24),
    ('porthole', -26.337, -25.981, 13.65, 13.988, 2.16),
    ('porthole', -20.319, -20.019, 13.162, 13.481, 7.049),
    ('porthole', -25.119, -24.762, 10.294, 10.631, 3.451),
    ('porthole', -20.75, -20.413, 10.088, 10.406, 2.817),
    ('porthole', -22.888, -22.588, 7.838, 8.137, 5.868),
    ('porthole', -25.475, -25.287, 7.819, 8.137, 5.868),
    ('porthole', -31.175, -30.819, 7.819, 8.137, 5.868),
    ('porthole', -34.287, -33.969, 7.819, 8.137, 5.868),
    ('porthole', -40.006, -39.688, 7.819, 8.137, 5.868),
    ('porthole', -35.938, -35.619, 7.819, 8.119, 5.868),
]
# (kind, x0, x1, y0, y1, wall z): seen from ahead.
FRONT = [
    ('porthole', -0.21, 0.165, 16.365, 16.74, -32.445),
    ('porthole', -0.78, -0.405, 16.35, 16.725, -32.445),
    ('porthole', 0.345, 0.705, 16.365, 16.695, -32.445),
    ('porthole', -1.965, -1.725, 16.32, 16.695, -31.248),
    ('porthole', 1.725, 1.95, 16.335, 16.68, -31.257),
    ('porthole', 1.125, 1.35, 16.35, 16.68, -31.994),
    ('porthole', -1.35, -1.125, 16.335, 16.665, -31.994),
]
