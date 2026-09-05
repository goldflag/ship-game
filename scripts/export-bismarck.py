"""Compatibility entry point. Prefer `bun run ship:build bismarck`."""
import subprocess
from pathlib import Path
subprocess.run(['bun','run','ship:build','bismarck'],cwd=Path(__file__).resolve().parent.parent,check=True)
