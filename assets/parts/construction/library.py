"""Original non-gun entry point; guns continue through assets/parts/library.py.

Only explicit registrations are supported. Published GLBs are never source inputs.
"""
import importlib.util
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]


def create_equipment(part, collection, helpers, materials):
    register = json.loads((ROOT / 'assets/parts/construction-library.json').read_text())
    entry = next((e for e in register['components'] if e['partId'] == part['id']), None)
    if not entry:
        raise ValueError('No original non-gun builder for ' + part['id'])
    builder = register['builders'][entry['builder']]
    spec = importlib.util.spec_from_file_location('construction_' + entry['builder'], ROOT / builder['path'])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, builder['function'])(part, collection, helpers, materials)
