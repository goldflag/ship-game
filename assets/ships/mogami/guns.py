"""Compatibility import of the extracted original Japanese AA builder."""
import importlib.util
from pathlib import Path
p=Path(__file__).resolve().parents[2]/'parts/ijn-destroyer-guns/aa.py'
spec=importlib.util.spec_from_file_location('original_japanese_aa',p)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
create_mount=module.create_mount
