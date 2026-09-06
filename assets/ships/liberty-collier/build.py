"""Original versioned convoy components; see the registered recipe inputs."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1]/'convoy/geometry-v2.py'),run_name='__main__')
