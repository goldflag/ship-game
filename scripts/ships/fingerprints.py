"""Canonical Python/JSON inputs and transitive local Python imports.

Comments and source locations do not affect Python execution. Constants,
statements, defaults, imports and dependency paths do affect the fingerprint.
"""
import ast
import json
import hashlib
import sys
from pathlib import Path

def canonical(node):
    if isinstance(node, ast.AST):
        # Python 3.12 added empty type_params to ordinary functions/classes.
        # Do not make unchanged pre-PEP-695 code host-version dependent.
        return [type(node).__name__, {key: canonical(value) for key, value in ast.iter_fields(node)
                                    if not (key == 'type_params' and not value)}]
    if isinstance(node, list):
        return [canonical(value) for value in node]
    if isinstance(node, bytes):
        return {'bytes': node.hex()}
    if isinstance(node, complex):
        return {'complex': [node.real, node.imag]}
    if node is Ellipsis:
        return {'ellipsis': True}
    return node

root = Path(sys.argv[1]).resolve()
pending = json.loads(sys.stdin.read())
inputs = {}
dependencies = {}
while pending:
    relative = pending.pop()
    if relative in inputs:
        continue
    dependencies[relative] = []
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Input outside repository: ' + relative)
    text = path.read_text() if path.suffix in {'.py', '.json'} else None
    if path.suffix == '.py':
        tree = ast.parse(text)
        inputs[relative] = json.dumps(canonical(tree), sort_keys=True, separators=(',', ':'))
        for node in ast.walk(tree):
            modules = ([node.module] if isinstance(node, ast.ImportFrom) and node.module
                       else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
            for module in modules:
                for base in (path.parent, root / 'scripts/ships', root):
                    candidate = base / (module.replace('.', '/') + '.py')
                    if candidate.is_file():
                        dependency = candidate.relative_to(root).as_posix()
                        pending.append(dependency)
                        dependencies[relative].append(dependency)
                        break
    elif path.suffix == '.json':
        inputs[relative] = json.dumps(json.loads(text), sort_keys=True, separators=(',', ':'))
    else:
        inputs[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
print(json.dumps({'sources': inputs, 'dependencies': dependencies}))
