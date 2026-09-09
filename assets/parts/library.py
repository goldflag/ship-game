"""Reusable original mount entry point. No generated scenes or reference assets.

Call with a compiled blueprint mount, ship primitive helpers and materials.
The registry selects explicit variants; unknown/legacy parts fail closed.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/ships'))


def create_mount(mount, collection, helpers, materials):
    register = json.loads((ROOT / 'assets/parts/library.json').read_text())
    entry = next((p for p in register['components'] if p['partId'] == mount['partId']), None)
    if not entry or not entry.get('builder'):
        raise ValueError('No reusable builder for ' + mount['partId'] + '; extract and register original source first')
    if mount['weapon']['id'] != mount['partId']:
        raise ValueError('Mount and weapon part IDs disagree')
    builder = register['builders'][entry['builder']]
    spec = importlib.util.spec_from_file_location('shared_' + entry['builder'], ROOT / builder['path'])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, builder['function'])(mount, collection, helpers, materials)
