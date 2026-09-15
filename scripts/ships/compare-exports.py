"""Compare indexed rendering data, independent of vertex packing and GLB offsets.

Usage: python3 scripts/ships/compare-exports.py BEFORE.glb AFTER.glb
Requires NumPy, SciPy and Rtree. Nonzero exit means a fidelity difference outside float tolerances.
Reports stay on stdout; redirect diagnostics into .build/ when needed.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np


def load(path):
    data = Path(path).read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + size])
    binary = data[28 + size:]

    def accessor(index):
        spec = document['accessors'][index]
        view = document['bufferViews'][spec['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[spec['type']]
        dtype = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}[spec['componentType']])
        offset = view.get('byteOffset', 0) + spec.get('byteOffset', 0)
        stride = view.get('byteStride', width * dtype.itemsize)
        return np.ndarray((spec['count'], width), dtype=dtype, buffer=binary,
                          offset=offset, strides=(stride, dtype.itemsize))

    def image_bytes(image):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        return binary[start:start + view['byteLength']]

    return document, accessor, image_bytes


def compare_surfaces(left, right):
    """Compare surface samples when a planar polygon chose another diagonal.

    An AABB index includes long triangles even when their centroids are far from
    the sample. At seams, accept the matching normal/UV side among coincident
    triangles rather than arbitrarily selecting one side of a hard edge.
    """
    from rtree import index
    maxima = {}
    for source, target in ((left, right), (right, left)):
        triangles = target['POSITION']
        properties = index.Property(); properties.dimension = 3
        bounds = index.Index(((i, tuple(t.min(axis=0)) + tuple(t.max(axis=0)), None) for i, t in enumerate(triangles)), properties=properties)
        samples = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1], [.5, .5, 0], [0, .5, .5], [.5, 0, .5], [1/3, 1/3, 1/3]])
        for number, triangle in enumerate(source['POSITION']):
            for weights in samples:
                point = weights @ triangle
                candidates = list(bounds.intersection(tuple(point - 1e-4) + tuple(point + 1e-4)))
                if not candidates: return {'POSITION': float('inf')}
                t = triangles[candidates]
                a, b, c = t[:, 0], t[:, 1], t[:, 2]
                ab, ac, ap = b-a, c-a, point-a
                dot = lambda x, y: np.einsum('...i,...i->...', x, y)
                d00, d01, d11, d20, d21 = dot(ab, ab), dot(ab, ac), dot(ac, ac), dot(ap, ab), dot(ap, ac)
                den = d00*d11-d01*d01
                safe = np.where(np.abs(den) > 1e-24, den, 1)
                v, w = (d11*d20-d01*d21)/safe, (d00*d21-d01*d20)/safe
                bary = np.stack((1-v-w, v, w), axis=-1)
                projected = a + v[:, None]*ab + w[:, None]*ac
                distance = np.where((bary.min(axis=-1) >= 0) & (np.abs(den) > 1e-24), dot(point-projected, point-projected), np.inf)
                for first, second in ((0, 1), (1, 2), (2, 0)):
                    base, edge = t[:, first], t[:, second]-t[:, first]
                    fraction = np.clip(dot(point-base, edge)/np.maximum(dot(edge, edge), 1e-30), 0, 1)
                    nearest = base + fraction[:, None]*edge
                    ds = dot(point-nearest, point-nearest)
                    edge_weights = np.zeros_like(bary)
                    edge_weights[:, first], edge_weights[:, second] = 1-fraction, fraction
                    bary = np.where((ds < distance)[:, None], edge_weights, bary)
                    distance = np.minimum(distance, ds)
                differences, score = {}, np.zeros(len(candidates))
                for name in source:
                    expected = weights @ source[name][number]
                    actual = np.einsum('ni,nij->nj', bary, target[name][candidates])
                    if name.endswith(('NORMAL', 'TANGENT')):
                        expected /= max(float(np.linalg.norm(expected)), 1e-30)
                        actual /= np.maximum(np.linalg.norm(actual, axis=1, keepdims=True), 1e-30)
                    delta = np.max(np.abs(expected-actual), axis=1)
                    tolerance = 1e-4 if name.endswith('POSITION') else .003 if name.endswith(('NORMAL', 'TANGENT')) else 1e-5
                    score = np.maximum(score, delta/tolerance)
                    differences[name] = delta
                best = score.argmin()
                for name, delta in differences.items(): maxima[name] = max(maxima.get(name, 0), float(delta[best]))
    return maxima


def compare(before, after):
    from hashlib import sha256
    from scipy.spatial import cKDTree
    a, aa, ai = load(before)
    b, ba, bi = load(after)
    failures, maximum = [], {}
    # Float matrix decomposition can change the last few digits. Names, IDs,
    # extras and the hierarchy remain exact; translations remain within 0.1 mm.
    def node_map(document):
        result = {}
        for node in document['nodes']:
            value = {k: v for k, v in node.items() if k not in {'mesh', 'children'}}
            value['children'] = sorted(document['nodes'][i]['name'] for i in node.get('children', []))
            result[node['name']] = value
        return result
    an, bn = node_map(a), node_map(b)
    if an.keys() != bn.keys(): failures.append('node identities')
    for name in an.keys() & bn.keys():
        x, y = dict(an[name]), dict(bn[name])
        for key in ('matrix', 'translation', 'rotation', 'scale', 'weights'):
            av, bv = x.pop(key, None), y.pop(key, None)
            if av is None and bv is None: continue
            defaults = {'translation': [0, 0, 0], 'rotation': [0, 0, 0, 1], 'scale': [1, 1, 1], 'matrix': np.eye(4).ravel().tolist(), 'weights': []}
            av = defaults[key] if av is None else av
            bv = defaults[key] if bv is None else bv
            if len(av) != len(bv) or not np.allclose(av, bv, rtol=0, atol=1e-4): failures.append(name + ' ' + key)
        if x != y: failures.append(name + ' metadata/hierarchy')
    def scenes(document):
        result = []
        for original in document.get('scenes', []):
            scene = dict(original)
            scene['nodes'] = sorted(document['nodes'][i]['name'] for i in scene['nodes'])
            scene['extras'] = {k: v for k, v in scene.get('extras', {}).items() if k != 'definitionHash'}
            result.append(scene)
        return result
    if scenes(a) != scenes(b): failures.append('scenes')

    def groups(document, accessor, image_bytes):
        result = {}
        for node in document['nodes']:
            if 'mesh' not in node: continue
            for primitive in document['meshes'][node['mesh']]['primitives']:
                material = document.get('materials', [])[primitive['material']] if 'material' in primitive else {}
                texture_uvs = {}
                def normalize(value, path=''):
                    if isinstance(value, list): return [normalize(v, path) for v in value]
                    if not isinstance(value, dict): return value
                    if 'index' in value and 'texture' in path.lower():
                        texture = document['textures'][value['index']]
                        texture_uvs[path] = value.get('extensions', {}).get('KHR_texture_transform', {}).get('texCoord', value.get('texCoord', 0))
                        value = {**value, 'index': {'image': sha256(image_bytes(document['images'][texture['source']])).hexdigest(),
                                                  'sampler': document.get('samplers', [])[texture['sampler']] if 'sampler' in texture else {}}}
                    return {k: normalize(v, path + '/' + k) for k, v in value.items() if k != 'texCoord'}
                signature = json.dumps(normalize(material), sort_keys=True)
                mode = primitive.get('mode', 4)
                key = (node['name'], mode, signature)
                if mode != 4: raise ValueError('Comparison requires triangle primitives')
                indices = accessor(primitive['indices']).ravel() if 'indices' in primitive else np.arange(len(accessor(primitive['attributes']['POSITION'])))
                attrs = {name: accessor(index)[indices].reshape(-1, 3, accessor(index).shape[1]).astype(np.float64)
                         for name, index in primitive['attributes'].items() if not name.startswith('TEXCOORD_')}
                for slot, uv in texture_uvs.items():
                    index = primitive['attributes']['TEXCOORD_' + str(uv)]
                    attrs['UV' + slot] = accessor(index)[indices].reshape(-1, 3, 2).astype(np.float64)
                for number, target in enumerate(primitive.get('targets', [])):
                    for name, index in target.items(): attrs[f'target{number}/{name}'] = accessor(index)[indices].reshape(-1, 3, accessor(index).shape[1]).astype(np.float64)
                result.setdefault(key, []).append(attrs)
        return {key: {name: np.concatenate([chunk[name] for chunk in chunks]) for name in chunks[0]} for key, chunks in result.items()}
    ag, bg = groups(a, aa, ai), groups(b, ba, bi)
    if ag.keys() != bg.keys(): failures.append('render groups (nodes, materials, texture pixels or modes)')
    triangles = 0
    for key in ag.keys() & bg.keys():
        av, bv = ag[key], bg[key]
        x, y = av['POSITION'], bv['POSITION']
        triangles += len(x)
        label = key[0]
        if av.keys() != bv.keys(): failures.append(label + ' attributes/morph targets'); continue
        if x.shape != y.shape: failures.append(label + ' triangle count'); continue
        order = np.arange(len(x))
        rotations = np.zeros(len(x), dtype=np.int64)
        rematched = True
        if any(not np.allclose(av[name], bv[name], rtol=0, atol=1e-4 if name.endswith('POSITION') else .003 if name.endswith(('NORMAL', 'TANGENT')) else 1e-5) for name in av):
            # Packing order and material slots can change without changing the
            # rendered triangles. Match centroids, retaining winding and counts.
            tree = cKDTree(y.mean(axis=1))
            _, candidates = tree.query(x.mean(axis=1), k=min(8, len(y)))
            if candidates.ndim == 1: candidates = candidates[:, None]
            used = set()
            for i, choices in enumerate(candidates):
                best = None
                for j in choices:
                    if int(j) in used: continue
                    for rotation in range(3):
                        delta = float(np.max(np.abs(x[i] - np.roll(y[j], -rotation, axis=0))))
                        if delta > 1e-4: continue
                        score = max(float(np.max(np.abs(av[name][i] - np.roll(bv[name][j], -rotation, axis=0)))) /
                                    (1e-4 if name.endswith('POSITION') else .003 if name.endswith(('NORMAL', 'TANGENT')) else 1e-5) for name in av)
                        if best is None or score < best[0]: best = (score, int(j), rotation)
                if best is None:
                    rematched = False; break
                _, order[i], rotations[i] = best
                used.add(int(order[i]))
        if not rematched:
            differences = compare_surfaces(av, bv)
            for name, delta in differences.items():
                maximum[name] = max(maximum.get(name, 0), delta)
                tolerance = 1e-4 if name.endswith('POSITION') else .003 if name.endswith(('NORMAL', 'TANGENT')) else 1e-5
                if not np.isfinite(delta) or delta > tolerance: failures.append(f'{label} surface {name}: {delta:g} > {tolerance:g}')
            continue
        for name in av:
            target = bv[name][order]
            target = target[np.arange(len(target))[:, None], (np.arange(3)[None, :] + rotations[:, None]) % 3]
            delta = float(np.max(np.abs(av[name] - target), initial=0))
            maximum[name] = max(maximum.get(name, 0), delta)
            # Source positions are float32. Recomputing normals of millimetre
            # fittings amplifies that rounding; 0.003 is under 0.18 degrees.
            tolerance = 1e-4 if name.endswith('POSITION') else .003 if name.endswith(('NORMAL', 'TANGENT')) else 1e-5
            if not np.all(np.isfinite(av[name])) or not np.all(np.isfinite(target)) or delta > tolerance:
                failures.append(f'{label} {name}: {delta:g} > {tolerance:g}')
    return {'triangles': triangles, 'maximumAttributeDelta': maximum, 'failures': failures, 'result': 'failed' if failures else 'passed'}


if __name__ == '__main__':
    result = compare(*sys.argv[1:3])
    print(json.dumps(result, indent=2))
    sys.exit(bool(result['failures']))
