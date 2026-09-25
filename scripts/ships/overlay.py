"""Silhouette overlay of a published ship GLB against a cached ship:reference.

Run by scripts/ships/overlay.ts in background Blender with one argument: a JSON job file.
Both models are drawn in the runtime frame (+X starboard, +Y up, -Z bow, waterline Y=0);
the reference is shifted by the job's offset, or by one measured from the waterlines and
refined on the side and top silhouettes (fore and aft, and up and down on the side view). Each shot renders ours and the
reference alone with the same camera and transparent film, then composites: ours only red,
reference only blue, both in the reference's own shading.
"""
import bpy
import json
import math
import os
import struct
import sys
import numpy as np
from mathutils import Matrix, Vector

job = json.loads(open(sys.argv[sys.argv.index('--') + 1]).read())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Blender frame after the glTF import: (X, Y, Z) = (x, -z, y) in runtime terms.
def to_blender(p):
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def to_runtime(b):
    return np.stack([b[:, 0], b[:, 2], -b[:, 1]], axis=1)


bpy.ops.import_scene.gltf(filepath=job['glb'])
ours = [o for o in scene.objects if o.type == 'MESH']
ours_root = bpy.data.collections.new('ours'); scene.collection.children.link(ours_root)
for o in ours:
    for c in list(o.users_collection): c.objects.unlink(o)
    ours_root.objects.link(o)


def world_vertices(objs):
    chunks = []
    for o in objs:
        me = o.data; n = len(me.vertices)
        if not n: continue
        co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
        m = np.array(o.matrix_world, np.float64)
        v = co.reshape(-1, 3).astype(np.float64) @ m[:3, :3].T + m[:3, 3]
        chunks.append(v)
    return np.concatenate(chunks) if chunks else np.zeros((0, 3))


ours_rt = to_runtime(world_vertices(ours))


def world_triangles(objs):
    """Runtime-frame triangles (n, 3, 3) of the meshes, only those that reach the waterline band."""
    chunks = []
    for o in objs:
        me = o.data
        if not len(me.polygons): continue
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
        m = np.array(o.matrix_world, np.float64)
        v = to_runtime(co.reshape(-1, 3).astype(np.float64) @ m[:3, :3].T + m[:3, 3])
        tri = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', tri)
        t = v[tri.reshape(-1, 3)]
        keep = (t[:, :, 1].min(1) < .5) & (t[:, :, 1].max(1) > -.5)
        chunks.append(t[keep])
    return np.concatenate(chunks) if chunks else np.zeros((0, 3, 3))


def waterplane(tris, level=.0137):
    """Points where the triangles' edges cross a plane just above the waterline. Authored hulls
    often carry a vertex row exactly at y = 0, whose edges would never register as crossing it."""
    out = []
    for i, j in [(0, 1), (1, 2), (2, 0)]:
        a, b = tris[:, i], tris[:, j]
        cross = ((a[:, 1] - level) * (b[:, 1] - level)) < 0
        t = ((a[cross, 1] - level) / (a[cross, 1] - b[cross, 1]))[:, None]
        out.append(a[cross] + t * (b[cross] - a[cross]))
    return np.concatenate(out) if out else np.zeros((0, 3))


ours_water = waterplane(world_triangles(ours))

raw = open(job['referenceMesh'], 'rb').read()
nv, ni = struct.unpack_from('<II', raw, 8)
P = np.frombuffer(raw, np.float32, nv * 3, 16).reshape(-1, 3).astype(np.float64)
I = np.frombuffer(raw, np.uint32, ni, 16 + nv * 12).reshape(-1, 3)
tris = np.concatenate([I[r['first']:r['first'] + r['count']] for r in job['ranges']]) if job['ranges'] else I
hull_tris = np.concatenate([I[r['first']:r['first'] + r['count']] for r in job['hullRanges']]) if job['hullRanges'] else tris


def waterline_span(points):
    if len(points) < 8:
        return None
    lo, hi = np.percentile(points[:, 2], [.2, 99.8])
    return float(lo), float(hi)


def waterline_profile(points, grid):
    """Waterline half-breadth along the grid: the largest |x| per 0.5 m, interpolated where points exist."""
    edges = np.arange(grid[0], grid[-1] + .5, .5)
    k = np.clip(((points[:, 2] - edges[0]) / .5).astype(int), 0, len(edges) - 1)
    widest = np.full(len(edges), -1.0); np.maximum.at(widest, k, np.abs(points[:, 0]))
    have = widest >= 0
    if have.sum() < 2:
        return np.zeros(len(grid))
    centres = edges[have] + .25
    profile = np.interp(grid, centres, widest[have], left=0, right=0)
    profile[(grid < centres[0] - .25) | (grid > centres[-1] + .25)] = 0
    return profile


ref_water = waterplane(P[hull_tris])
ours_span = waterline_span(ours_water)
ref_span = waterline_span(ref_water)
if job['offset'] is not None:
    offset = job['offset']
elif job['align'] != 'none' and ours_span and ref_span:
    # Start from the span midpoints, then slide the reference's waterline half-breadths along ours
    # (±6 m in 5 cm steps) to the least absolute difference: exact when the hull shapes agree.
    guess = (ours_span[0] + ours_span[1]) / 2 - (ref_span[0] + ref_span[1]) / 2
    grid = np.arange(min(ours_span[0], ref_span[0] + guess) - 10, max(ours_span[1], ref_span[1] + guess) + 10, .05)
    mine = waterline_profile(ours_water, grid)
    best = min(((float(np.abs(mine - waterline_profile(ref_water + [0, 0, guess + shift], grid)).sum()), shift)
                for shift in np.arange(-6, 6.001, .05)))
    offset = [0.0, 0.0, guess + best[1]]
else:
    offset = [0.0, 0.0, 0.0]
Pr = P + np.array(offset)
used = np.unique(tris); remap = np.full(len(P), -1, np.int64); remap[used] = np.arange(len(used))
ref_mesh = bpy.data.meshes.new('reference')
ref_mesh.from_pydata(to_blender(Pr[used]).tolist(), [], remap[tris].tolist())
ref_mesh.update()
ref_obj = bpy.data.objects.new('reference', ref_mesh)
ref_root = bpy.data.collections.new('reference'); scene.collection.children.link(ref_root); ref_root.objects.link(ref_obj)
ref_rt = Pr[used]

scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'; shading.color_type = 'SINGLE'; shading.single_color = (.62, .64, .66)
shading.show_cavity = True; shading.cavity_type = 'BOTH'; shading.show_shadows = False
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
camera_data = bpy.data.cameras.new('overlay'); camera_data.type = 'ORTHO'; camera_data.sensor_fit = 'HORIZONTAL'
camera = bpy.data.objects.new('overlay', camera_data); scene.collection.objects.link(camera); scene.camera = camera

# View: (looking direction, image right, image up), runtime axes. Bow is to the right in
# side and top views; front looks aft from ahead, stern looks forward from astern.
VIEWS = {
    'side': ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),
    'top': ((0, -1, 0), (0, 0, -1), (-1, 0, 0)),
    'front': ((0, 0, 1), (-1, 0, 0), (0, 1, 0)),
    'stern': ((0, 0, -1), (1, 0, 0), (0, 1, 0)),
}
both = np.concatenate([ours_rt, ref_rt])


def bounds(box):
    lo = np.array([-np.inf if v is None else v for v in box[:3]], np.float64)
    hi = np.array([np.inf if v is None else v for v in box[3:]], np.float64)
    inside = np.all((both >= lo) & (both <= hi), axis=1)
    pts = both[inside] if inside.any() else both
    glo, ghi = pts.min(0), pts.max(0)
    lo = np.where(np.isfinite(lo), lo, glo); hi = np.where(np.isfinite(hi), hi, ghi)
    return lo, hi


def ortho(view, box, px, margin):
    """Aim the orthographic camera at the box from one of VIEWS; returns image and metre sizes."""
    camera_data.type = 'ORTHO'
    look, right, up = (np.array(v, np.float64) for v in VIEWS[view])
    lo, hi = bounds(box)
    lo = lo - margin; hi = hi + margin
    centre = (lo + hi) / 2
    span = hi - lo
    width = float(abs(span @ right)); height = float(abs(span @ up)); depth = float(abs(span @ look))
    px_w = px; px_h = max(64, min(6000, int(round(px_w * height / max(width, 1e-6)))))
    scene.render.resolution_x, scene.render.resolution_y = px_w, px_h
    camera_data.ortho_scale = width
    eye_rt = centre - look * (depth / 2 + .01)
    to_b = lambda v: Vector((v[0], -v[2], v[1]))
    r, u, f = to_b(right).normalized(), to_b(up).normalized(), to_b(look).normalized()
    camera.matrix_world = Matrix(((r.x, u.x, -f.x, 0), (r.y, u.y, -f.y, 0), (r.z, u.z, -f.z, 0), (0, 0, 0, 1)))
    camera.location = to_b(eye_rt)
    camera_data.clip_start = .001; camera_data.clip_end = depth + .02
    global last_camera
    last_camera = dict(eye=eye_rt.tolist(), target=(eye_rt + look).tolist(), up=up.tolist(), ortho=width,
                       size=[px_w, px_h], clip=[.001, depth + .02])
    return px_w, px_h, width, height


def render(name, collection_visible, path):
    ours_root.hide_render = collection_visible != 'ours'
    ref_root.hide_render = collection_visible != 'reference'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path)
    w, h = image.size
    px = np.empty(w * h * 4, np.float32); image.pixels.foreach_get(px)
    bpy.data.images.remove(image)
    return px.reshape(h, w, 4)


def aim(eye_rt, target_rt):
    """Point the camera from eye to target with runtime +Y up."""
    to_b = lambda v: Vector((v[0], -v[2], v[1]))
    eye, target = to_b(eye_rt), to_b(target_rt)
    camera.location = eye
    camera.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()


def overlap(a, b, reach_x, reach_y):
    """Intersection of mask a with mask b moved by every (dy, dx) pixel shift within reach, by FFT
    cross-correlation: inter[dy + reach_y, dx + reach_x] = sum a[p] * b[p - (dy, dx)]. The masks are
    rendered with at least `reach` of empty margin, so the circular shift equals the linear one."""
    fa = np.fft.rfft2(a.astype(np.float32))
    fb = np.fft.rfft2(b.astype(np.float32))
    c = np.fft.irfft2(fa * np.conj(fb), s=a.shape)
    rows = np.arange(-reach_y, reach_y + 1) % a.shape[0]
    cols = np.arange(-reach_x, reach_x + 1) % a.shape[1]
    return np.rint(c[np.ix_(rows, cols)])


def peak(values, k):
    """Sub-step position of a maximum from the parabola through it and its neighbours."""
    if 0 < k < len(values) - 1:
        l, c, r = values[k - 1], values[k], values[k + 1]
        if l - 2 * c + r < 0: return .5 * (l - r) / (l - 2 * c + r)
    return 0.0


def refine(offset, vertical):
    """Slide the reference's side and top silhouettes along ours (±4 m at about 4 cm a pixel) to the
    greatest combined overlap. Both views put the bow to the right, so a fore-and-aft shift is a
    horizontal image shift; with `vertical` the side view also slides up and down (±3 m), which finds
    a reference whose waterline datum differs from ours (Bismarck's sits 0.85 m low). The waterline
    match alone left Iowa 0.4 m short of the best fit."""
    reach, reach_up = 4.0, 3.0 if vertical else 0.0
    px_w = min(6000, int(math.ceil((np.ptp(both[:, 2]) + 2 * reach) / .04)))
    inter = union_parts = None
    for view in ('side', 'top'):
        _, _, width, _ = ortho(view, [None] * 6, px_w, reach)
        a = render('align', 'ours', job['out'] + '/align-ours.png')[:, :, 3] > .5
        b = render('align', 'reference', job['out'] + '/align-reference.png')[:, :, 3] > .5
        metres = width / px_w
        steps = int(reach / metres)
        rows = int(reach_up / metres) if view == 'side' else 0
        counts = overlap(a, b, steps, rows)
        if view == 'top':
            counts = counts[:1]
        area = float(a.sum() + b.sum())
        inter = counts if inter is None else inter + counts
        union_parts = area if union_parts is None else union_parts + area
        side_rows = rows if view == 'side' else side_rows
    for side in ('ours', 'reference'): os.remove(job['out'] + f'/align-{side}.png')
    iou = inter / np.maximum(union_parts - inter, 1)
    ky, kx = np.unravel_index(int(np.argmax(iou)), iou.shape)
    fx = peak(iou[ky], kx)
    fy = peak(iou[:, kx], ky)
    # Image right is runtime -Z, so moving the reference right by s pixels is a shift of -s * metres.
    # Rows count up from the bottom of the image, which is runtime +Y.
    dz = -(kx - steps + fx) * metres
    dy = (ky - side_rows + fy) * metres if vertical else 0.0
    return [offset[0], offset[1] + dy, offset[2] + dz]


if job['offset'] is None and job['align'] in ('silhouette', 'fore-aft'):
    start = list(offset)
    offset = refine(offset, job['align'] == 'silhouette')
    shift_y, shift_z = offset[1] - start[1], offset[2] - start[2]
    ref_obj.location = (0, -shift_z, shift_y)
    ref_rt = ref_rt + [0, shift_y, shift_z]
    both = np.concatenate([ours_rt, ref_rt])

summary = []
for shot in job['shots']:
    if 'pin' in shot:
        pin = shot['pin']; px_w = shot['px']; px_h = int(round(px_w * .625))
        scene.render.resolution_x, scene.render.resolution_y = px_w, px_h
        if pin.get('ortho'):
            camera_data.type = 'ORTHO'; camera_data.ortho_scale = pin['ortho']
        else:
            camera_data.type = 'PERSP'; camera_data.sensor_width = 36
            camera_data.lens = 18 / math.tan(math.radians(pin.get('fov', 40)) / 2)
        camera_data.clip_start = .05; camera_data.clip_end = 5000
        aim(np.array(pin['eye'], np.float64), np.array(pin['target'], np.float64))
        width = height = 0.0
        # The same camera as reference_render.py describes it: a vertical field of view.
        fov = pin.get('fov', 40)
        lens = {'ortho': pin['ortho']} if pin.get('ortho') else {'fov': math.degrees(2 * math.atan(math.tan(math.radians(fov) / 2) * px_h / px_w))}
        last_camera = dict(eye=list(pin['eye']), target=list(pin['target']), up=[0, 1, 0], size=[px_w, px_h], **lens)
    else:
        px_w, px_h, width, height = ortho(shot['view'], shot['box'], shot['px'], shot.get('margin', 2.0))
    base = job['out'] + '/' + shot['name']
    a = render(shot['name'], 'ours', base + '-ours.png')
    b = render(shot['name'], 'reference', base + '-reference.png')
    ma = a[:, :, 3] > .5; mb = b[:, :, 3] > .5
    out = np.ones((px_h, px_w, 4), np.float32); out[:, :, :3] = .92
    shade = b[:, :, :3].mean(axis=2, keepdims=True) * .8
    out[ma & mb, :3] = np.repeat(shade, 3, axis=2)[ma & mb]
    out[ma & ~mb, :3] = (.86, .16, .16)
    out[mb & ~ma, :3] = (.16, .35, .86)
    image = bpy.data.images.new(shot['name'] + '-overlay', px_w, px_h, alpha=True)
    image.pixels.foreach_set(out.ravel())
    image.filepath_raw = base + '.png'; image.file_format = 'PNG'; image.save()
    union = int((ma | mb).sum())
    summary.append(dict(name=shot['name'], view=shot.get('view', 'camera'), file=base + '.png',
                        widthM=round(width, 2), heightM=round(height, 2), pixels=[px_w, px_h],
                        iou=round(float((ma & mb).sum()) / max(union, 1), 4),
                        oursOnly=round(float((ma & ~mb).sum()) / max(union, 1), 4),
                        referenceOnly=round(float((mb & ~ma).sum()) / max(union, 1), 4),
                        camera=last_camera))

result = dict(offset=[round(v, 4) for v in offset], fitted=job['offset'] is None and job['align'] != 'none',
              waterline=dict(ours=ours_span and [round(v, 3) for v in ours_span], reference=ref_span and [round(v, 3) for v in ref_span]),
              shots=summary)
open(job['out'] + '/summary.json', 'w').write(json.dumps(result, indent=2) + '\n')
print('OVERLAY_SUMMARY ' + json.dumps(result))
