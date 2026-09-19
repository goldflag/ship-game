"""Original SK C/33 in the open C/31 shield, approved Bismarck ggs003 fit.

The previous boxed shield conflated this named mount with the separate C/37
source. Reuse the registered original C/31 constructor; each catalog retains its
own gameplay dimensions and stable rig IDs. No reference geometry is loaded.
"""
import importlib.util
from pathlib import Path


def create_mount(mount, collection, helpers, materials):
    path = Path(__file__).resolve().parents[1] / 'german-cruiser-guns' / 'geometry.py'
    spec = importlib.util.spec_from_file_location('original_german_c31', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.create_secondary(mount, collection, helpers, materials)
