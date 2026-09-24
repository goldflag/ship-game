"""Mount clearance sweep for `bun run ship:sweep` (acceptance check 4). Evidence, not a certificate.

blender --background --python articulation_sweep.py -- --model <source.blend|model.glb> --definition <id.json>
    --out <sweep.json> [--mounts id,prefix*,...] [--step 5] [--elevation-step 15] [--neighbour-step 15]
    [--no-neighbours] [--ignore substring,...]

Every mount's moving assembly (the descendants of `<mount>.yaw`) is posed through its installed traverse,
elevation from depression to maximum and the full recoil stroke, and triangle-intersected against the
fixed ship and every other mount at rest. Mounts whose reach overlaps are then posed independently
against each other on a coarser grid. A mount's own fixed parts (its `assemblyId`: barbette, roller race,
tub) are its intended bearing interfaces and are skipped. Joints are posed in world space about the
up axis, each barrel's horizontal axis through its trunnion and back along the barrel, so the retained
Blender scene and the published glTF are read the same way. Poses are matrix arithmetic on each moving
mesh's rest world matrix; the Blender scene is never re-evaluated.
"""
import bpy
import json
import time
import numpy as np
T0 = time.perf_counter()
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]


def selected(mount_id):
    return not only or any(mount_id == s or (s.endswith('*') and mount_id.startswith(s[:-1])) for s in only)


def option(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


model = Path(option('--model'))
definition = json.loads(Path(option('--definition')).read_text())
out = Path(option('--out'))
only = [s for s in option('--mounts', '').split(',') if s]
step = float(option('--step', 5))
elevation_step = float(option('--elevation-step', 15))
neighbour_step = float(option('--neighbour-step', 15))
ignore = [s.lower() for s in option('--ignore', '').split(',') if s]
UP = Vector((0, 0, 1))

if model.suffix == '.blend':
    bpy.ops.wm.open_mainfile(filepath=str(model))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
bpy.context.view_layer.update()


def node_id(o):
    return o.get('nodeId') or o.name


nodes = {}
for o in scene.objects:
    nodes.setdefault(node_id(o), o)
deps = bpy.context.evaluated_depsgraph_get()
cache = {}
for o in scene.objects:
    if o.type != 'MESH' or o.get('exportRole') == 'simulation' or o.hide_render:
        continue
    if any(s in o.name.lower() for s in ignore):
        continue
    e = o.evaluated_get(deps)
    data = e.to_mesh()
    data.calc_loop_triangles()
    if len(data.loop_triangles):
        local = np.ones((len(data.vertices), 4))
        local[:, :3] = [tuple(v.co) for v in data.vertices]
        faces = np.array([tuple(t.vertices) for t in data.loop_triangles], dtype=np.int64)
        cache[o.name] = (local, faces, np.array(o.matrix_world))
    e.to_mesh_clear()
meshes = [o for o in scene.objects if o.name in cache]
print(f'SWEEP loaded {len(meshes)} meshes in {time.perf_counter() - T0:.1f} s', flush=True)


def tree(items):
    """items: (object name, 4x4 world matrix as numpy) pairs; one BVH over all their triangles."""
    vertices, faces, owner, k = [], [], [], 0
    for name, world in items:
        local, f, _ = cache[name]
        vertices.append((local @ world.T)[:, :3])
        faces.append(f + k)
        owner.extend([name] * len(f))
        k += len(local)
    if not faces:
        return None, owner
    return BVHTree.FromPolygons(np.concatenate(vertices).tolist(), np.concatenate(faces).tolist(), all_triangles=True), owner


def descendants(o):
    out = []
    for c in o.children:
        out.append(c)
        out.extend(descendants(c))
    return out


def about(point, axis, angle):
    return Matrix.Translation(point) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-point)


class Mount:
    """One mount's moving meshes, posed by matrix arithmetic on their rest world matrices."""

    def __init__(self, m, yaw):
        w = m['weapon']
        self.m, self.id = m, m['id']
        self.origin = yaw.matrix_world.translation.copy()
        self.recoil = w.get('recoilM', 0) or 0
        self.barrels = []
        joint_of = {}
        for e in descendants(yaw):
            nid = node_id(e)
            if not nid.endswith('.elevation'):
                continue
            side = nid[:-len('.elevation')]
            muzzle = nodes.get(side + '.muzzle')
            if muzzle is None:
                continue
            p = e.matrix_world.translation.copy()
            d = (muzzle.matrix_world.translation - p).normalized()
            lateral = d.cross(UP)
            if lateral.length < 1e-6:
                continue
            self.barrels.append((p, d, lateral.normalized(), math.asin(max(-1, min(1, d.z)))))
            joint_of[e.name] = len(self.barrels) - 1
        self.moving = []
        for o in descendants(yaw):
            if o.name not in cache:
                continue
            barrel, recoils, a = None, False, o.parent
            while a is not None and a != yaw:
                if node_id(a).endswith('.recoil'):
                    recoils = True
                if a.name in joint_of:
                    barrel = joint_of[a.name]
                    break
                a = a.parent
            self.moving.append((o.name, barrel, recoils and barrel is not None))
        self.moving_names = {n for n, _, _ in self.moving}
        limits = m.get('traverseLimitsDeg')
        half = m.get('traverseDeg', w['traverseDeg'])
        self.train = limits or [-half, half]
        self.elevation = [m.get('elevationMinDeg', w['elevationMinDeg']), m.get('elevationMaxDeg', w['elevationMaxDeg'])]
        reach = 0.0
        o = np.array(list(self.origin) + [0])
        for name, _, _ in self.moving:
            local, _, world = cache[name]
            reach = max(reach, float(np.max(np.linalg.norm((local @ world.T)[:, :3] - o[:3], axis=1))))
        self.reach = reach + self.recoil + .3

    def pose(self, train, elevation, recoil):
        y = about(self.origin, UP, -math.radians(train))
        y3 = y.to_3x3()
        barrels = []
        for p, d, lateral, rest in self.barrels:
            py, dy, ly = y @ p, y3 @ d, y3 @ lateral
            delta = math.radians(elevation) - rest
            r = about(py, ly, delta)
            back = Matrix.Translation(-(Matrix.Rotation(delta, 3, ly) @ dy) * self.recoil * recoil)
            barrels.append((np.array(r @ y), np.array(back @ r @ y)))
        yn = np.array(y)
        items = []
        for name, barrel, recoils in self.moving:
            world = cache[name][2]
            m = yn if barrel is None else barrels[barrel][1 if recoils else 0]
            items.append((name, m @ world))
        return items

    def trains(self, spacing):
        lo, hi = self.train
        values = {round(lo, 3), round(hi, 3), 0.0} if lo <= 0 <= hi else {round(lo, 3), round(hi, 3)}
        k = math.ceil(lo / spacing)
        while k * spacing <= hi:
            values.add(round(k * spacing, 3))
            k += 1
        if hi - lo >= 360:
            values.discard(round(hi, 3))
        return sorted(values)

    def elevations(self, spacing):
        lo, hi = self.elevation
        values = {round(lo, 3), round(hi, 3)}
        if lo <= 0 <= hi:
            values.add(0.0)
        k = math.ceil(lo / spacing)
        while k * spacing <= hi:
            values.add(round(k * spacing, 3))
            k += 1
        return sorted(values)


mounts = []
for m in definition['mounts']:
    yaw = nodes.get(m['id'] + '.yaw')
    if yaw is None or m.get('parentMountId'):
        continue
    mount = Mount(m, yaw)
    if mount.moving:
        mounts.append(mount)


def near(o, origin, reach):
    corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector([min(c[i] for c in corners) for i in range(3)])
    hi = Vector([max(c[i] for c in corners) for i in range(3)])
    q = Vector([max(lo[i], min(origin[i], hi[i])) for i in range(3)])
    return (q - origin).length <= reach


report = {'model': str(model), 'contentHash': definition.get('contentHash'), 'step': step, 'elevationStep': elevation_step,
          'neighbourStep': neighbour_step, 'ignore': ignore, 'mounts': [], 'neighbours': []}
for mt in mounts:
    if not selected(mt.id):
        continue
    fixed, fixed_owner = tree([(o.name, cache[o.name][2]) for o in meshes
                               if o.name not in mt.moving_names and o.get('assemblyId') != mt.id and near(o, mt.origin, mt.reach)])
    clashes, samples = {}, 0
    for t in mt.trains(step):
        for e in mt.elevations(elevation_step):
            for r in ([0, 1] if mt.recoil else [0]):
                samples += 1
                if fixed is None:
                    continue
                moving, moving_owner = tree(mt.pose(t, e, r))
                for i, j in moving.overlap(fixed):
                    key = (moving_owner[i], fixed_owner[j])
                    poses = clashes.setdefault(key, [])
                    if not poses or poses[-1] != [t, e, r]:
                        poses.append([t, e, r])
    rows = [{'moving': a, 'fixed': b, 'fixedAssembly': bpy.data.objects[b].get('assemblyId'), 'poses': p} for (a, b), p in clashes.items()]
    report['mounts'].append({'id': mt.id, 'samples': samples, 'train': mt.train, 'elevation': mt.elevation, 'clashes': rows})
    print(f'SWEEP {mt.id}: {samples} poses, {len(rows)} clashing part pairs, {time.perf_counter() - T0:.1f} s', flush=True)

if '--no-neighbours' not in argv:
    for a_index, a in enumerate(mounts):
        for b in mounts[a_index + 1:]:
            if not (selected(a.id) or selected(b.id)):
                continue
            if (a.origin - b.origin).length > a.reach + b.reach:
                continue
            b_trees = []
            for t in b.trains(neighbour_step):
                for e in b.elevations(90):
                    for r in ([0, 1] if b.recoil else [0]):
                        b_trees.append(([t, e, r], tree(b.pose(t, e, r))[0]))
            hits = []
            for t in a.trains(neighbour_step):
                for e in a.elevations(90):
                    for r in ([0, 1] if a.recoil else [0]):
                        ta = tree(a.pose(t, e, r))[0]
                        for pose_b, tb in b_trees:
                            if ta.overlap(tb):
                                hits.append([t, e, r] + pose_b)
            if hits:
                report['neighbours'].append({'a': a.id, 'b': b.id, 'poses': hits})
            print(f'NEIGHBOURS {a.id} / {b.id}: {len(hits)} clashing pose pairs', flush=True)

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report))
print('SWEEP-DONE', out, flush=True)
